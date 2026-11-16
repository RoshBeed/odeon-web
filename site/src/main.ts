// The interface: a stack of tables over the listings, driven by keys, clicks or taps.
import { ics } from './calendar';
import { needsEveryCinema, readChoice, writeChoices } from './choices';
import { openListings } from './db';
import * as q from './queries';
import { formats, place, shortCinema, tagKind, tagLabel, type TagKind } from './tags';

const BOOKING = 'https://www.odeon.co.uk/ticketing/seat-picker/?showtimeId=';
const PAGE = 100;

type Cell = string | number | null;
interface Column {
  label: string;
  right?: boolean;
  /** Hidden on narrow screens. */
  wide?: boolean;
  /** For the showtimes tables: the name of its sort order. */
  order?: string;
  wrap?: boolean;
}
interface Row {
  cells: Cell[];
  /** Values to sort and search by, when they differ from what is shown. */
  values?: Cell[];
  /** Where Enter or a tap goes: a route. */
  open?: string;
  /** A tick box: its state, and what ticking does. */
  tick?: { state: 'all' | 'some' | 'none'; toggle(): void };
  book?: string;
  calendar?: () => void;
  /** The film that `h` hides or shows again. */
  film?: string;
  sold?: boolean;
  /** How the row reads on a phone, when columns alone would not. */
  card?: { title: string; meta: string };
}
interface Table {
  columns: Column[];
  rows: Row[];
  total: number;
}
interface View {
  title: string;
  intro?: Node;
  /** Rows for the current sort, search and page. */
  table(ui: Ui): Table;
  /** True when showings() sorts, searches and pages (the showtimes tables). */
  paged?: boolean;
  /** Keys that act on the page itself, not on a row. */
  keys?: Record<string, () => void>;
}
interface Ui {
  order: number | null;
  descending: boolean;
  text: string;
  page: number;
  selected: number;
}

let db: q.Listings;
/** Whether `db` holds every cinema's showings, or only Greater London's. */
let whole = false;
let everything: Promise<void> | undefined;
const app = document.getElementById('app')!;
const uis = new Map<string, Ui>();
const narrow = matchMedia('(max-width: 640px)');

// ---- What the visitor has chosen, kept in the page's address ---------------

const ticks = readChoice(location.search, 'cinemas');
const hidden = readChoice(location.search, 'hidden');
/** What the visitor has left out altogether: `events`. */
const without = readChoice(location.search, 'without');
let version = 0;
/** Put the choices in the address, where a bookmark or a shared link keeps them. */
function address() {
  const search = writeChoices({ cinemas: ticks, hidden, without });
  if (search !== location.search) history.replaceState(null, '', location.pathname + search + location.hash);
}
function toggle(set: Set<string>, ids: string[], on?: boolean) {
  for (const id of ids) {
    if (on ?? !set.has(id)) set.add(id);
    else set.delete(id);
  }
  version += 1; // every remembered count is now stale
  address();
}

/** Counts that scan every showing are kept until a choice or the hour changes. */
const remembered = new Map<string, unknown>();
function remember<T>(name: string, make: () => T): T {
  const key = `${version}/${new Date().toISOString().slice(0, 13)}/${name}`;
  if (!remembered.has(key)) {
    if (remembered.size > 40) remembered.clear();
    remembered.set(key, make());
  }
  return remembered.get(key) as T;
}

// ---- Dates ---------------------------------------------------------------

function scope(cinemas: string[] = [...ticks]): q.Scope {
  return {
    cinemas,
    hidden: [...hidden],
    noEvents: without.has('events'),
    now: new Date().toISOString().slice(0, 19) + 'Z',
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()),
  };
}
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Europe/London' });
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
/** `Mon 16 Nov` for a stored time or a plain date. */
function day(value: string | null): string {
  if (!value) return '–';
  return DAY.format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value)).replace(',', '');
}
const when = (value: string | null) => (value ? `${day(value)} ${TIME.format(new Date(value))}` : '–');
const fullDate = (value: string | null) => (value ? DAY_YEAR.format(new Date(value + 'T12:00:00Z')) : '–');

// ---- Small helpers ------------------------------------------------------

function h(tag: string, props: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}
function button(label: string, act: () => void): HTMLElement {
  const element = h('button', { type: 'button' }, label);
  element.onclick = act;
  return element;
}
const link = (label: string, href: string, outside = false) =>
  h('a', outside ? { href, target: '_blank', rel: 'noopener' } : { href }, label);
const count = (n: number, noun: string) => `${n.toLocaleString('en-GB')} ${noun}${n === 1 ? '' : 's'}`;
const path = (...parts: string[]) => parts.map(encodeURIComponent).join('/');
const facts = (pairs: [string, Node | string][]) =>
  h('dl', {}, ...pairs.flatMap(([name, value]) => [h('dt', {}, name), h('dd', {}, value)]));

function download(name: string, text: string, type: string) {
  const address = URL.createObjectURL(new Blob([text], { type }));
  const anchor = h('a', { href: address, download: name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(address), 1000);
}
function addToCalendar(cinema: string, id: string) {
  const show = q.showing(db, cinema, id);
  if (show) download(`${show.title.replace(/[^\w]+/g, '-')}.ics`, ics(show), 'text/calendar');
}

/** Sort, search and page a short list here; showings() does it for showtimes. */
function local(columns: Column[], rows: Row[], ui: Ui): Table {
  const value = (row: Row, index: number) => (row.values ? row.values[index] : row.cells[index]);
  const needle = ui.text.toLowerCase();
  let found = needle
    ? rows.filter((row) => row.cells.some((cell) => String(cell ?? '').toLowerCase().includes(needle)))
    : rows;
  if (ui.order !== null) {
    const index = ui.order;
    const sign = ui.descending ? -1 : 1;
    found = [...found].sort((a, b) => {
      const [x, y] = [value(a, index), value(b, index)];
      if (x === null || x === '') return 1; // blanks last, whichever way
      if (y === null || y === '') return -1;
      return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
  }
  return { columns, rows: found.slice(ui.page * PAGE, (ui.page + 1) * PAGE), total: found.length };
}

// ---- Views --------------------------------------------------------------

const TAG_MENUS: [string, TagKind, string][] = [
  ['Picture', 'Picture', 'format'],
  ['Language', 'Language', 'language'],
  ['Events', 'Events', 'kind'],
  ['Accessibility', 'Accessibility', 'kind'],
];
const FACET_MENUS = [
  ['Rating', 'certificate', 'rating'],
  ['People', 'person', 'person'],
  ['Genres', 'genre', 'genre'],
  ['Distributors', 'distributor', 'distributor'],
] as const;

const experienceTags = () => remember('tags', () => q.tags(db, scope(), 'experiences'));
const seatTypes = () => remember('seats', () => q.tags(db, scope(), 'seating'));
const allScreens = () => remember('screens', () => q.screens(db, scope()));
const facetRows = (kind: 'certificate' | 'person' | 'genre' | 'distributor') =>
  remember(kind, () => q.facet(db, scope(), kind));
const allCinemas = () => remember('cinemas', () => q.cinemas(db, scope()));
const some = (names: string[]) => names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '');

function homeView(): View {
  const rows = (): Row[] => {
    const home = q.home(db, scope());
    const [first, last] = q.weekend(scope().today);
    const places = new Set(allCinemas().map(place));
    const events = !without.has('events');
    const [screens, tags, seats] = [allScreens(), experienceTags(), seatTypes()];
    return [
      { cells: ['Films', count(home.films, 'film'), count(home.showings, 'showing')], open: 'films' },
      { cells: ['Cinemas', count(home.allCinemas, 'cinema'), ticks.size ? `${count(ticks.size, 'cinema')} ticked` : 'all'], open: 'cinemas' },
      { cells: ['Location', count(places.size, 'location'), 'browse or tick cinema groups'], open: 'locations' },
      { cells: ['Tonight', count(home.tonight, 'screening'), count(home.tonightFilms, 'film')], open: 'tonight' },
      { cells: ['This weekend', count(home.weekendShows, 'screening'), `${count(home.weekendFilms, 'film')} · ${day(first)} – ${day(last)}`], open: 'weekend' },
      { cells: ['Opening soon', count(home.soon, 'film'), home.next ? `next: ${home.next.title} (${fullDate(home.next.release)})` : ''], open: 'soon' },
      { cells: ['Dates', count(home.days, 'day'), home.from ? `${day(home.from)} – ${fullDate(home.to)}` : ''], open: 'dates' },
      { cells: ['Screens', count(screens.length, 'screen'), 'by size, with formats'], open: 'screens' },
      ...TAG_MENUS.map(([name, kind, noun]): Row => {
        const found = tags.filter((row) => tagKind(row.tag) === kind);
        return { cells: [name, count(found.length, noun), some(found.map((row) => tagLabel(row.tag)))], open: path('tags', kind) };
      }),
      { cells: ['Seating', count(seats.length, 'seat type'), some(seats.map((row) => row.tag))], open: 'seats' },
      ...FACET_MENUS.map(([name, kind, noun]): Row => {
        const found = facetRows(kind);
        const busiest = [...found].sort((a, b) => b.showings - a.showings).map((row) => row.name);
        return { cells: [name, count(found.length, noun), some(busiest)], open: path('by', kind) };
      }),
      { cells: ['All showtimes', count(home.showings, 'screening'), 'every film, cinema and day'], open: 'all' },
      ...(hidden.size ? [{ cells: ['Hidden films', count(hidden.size, 'film'), 'show them again'], open: 'hidden' }] : []),
      {
        cells: ['Event cinema', events ? 'shown' : 'hidden', 'concerts, theatre, opera and other specials · untick to leave them out'],
        tick: { state: events ? 'all' : 'none', toggle: () => toggle(without, ['events']) },
      },
    ];
  };
  const intro = h('div', { class: 'intro' },
    h('p', {}, "ODEON · what's on, on which screen, and how big it is."),
    h('p', { class: 'dim phone' }, 'Tick your cinemas in Cinemas or Location and everything shows only those. Your ticks are kept in the page address: bookmark it to keep them.'),
    facts([
      ['Quick start', 'tick your favourite cinemas in Cinemas or whole groups in Location; everything then shows only those. Your ticks are kept in the page address: bookmark it to keep them.'],
      ['Getting around', 'tap or click a row · or ↑ ↓ move, Enter open, Esc back'],
      ['Every table', 'sort by a heading · search with the box or /'],
      ['Then', 'a film → a cinema → its showtimes → book, or add to your calendar'],
    ]),
  );
  const columns = [{ label: 'Browse' }, { label: 'How many' }, { label: 'Showing', wrap: true }];
  return { title: 'Start', intro, table: (ui) => local(columns, rows(), ui) };
}

function filmsView(title = 'Films', filter: q.FilmFilter = {}): View {
  const columns: Column[] = [
    { label: 'Film', wrap: true }, { label: 'Cert' }, { label: 'Mins', right: true, wide: true },
    { label: 'IMDb', right: true }, { label: 'Meta', right: true, wide: true },
    { label: 'Cinemas', right: true }, { label: 'Showings', right: true }, { label: 'Next', wide: true },
  ];
  const table = (ui: Ui) => {
    const rows = remember('films/' + JSON.stringify(filter), () => q.films(db, scope(), filter).map((film): Row => ({
      cells: [film.title, film.certificate || 'TBC', film.runtime, film.imdb?.toFixed(1) ?? null, film.metacritic, film.cinemas, film.showings, when(film.next)],
      values: [film.title, film.certificate, film.runtime, film.imdb, film.metacritic, film.cinemas, film.showings, film.next],
      open: path('film', film.id),
      film: film.id,
      card: {
        title: film.title,
        meta: [film.certificate || 'TBC', film.runtime ? `${film.runtime} min` : '', film.imdb ? `IMDb ${film.imdb.toFixed(1)}` : '', count(film.cinemas, 'cinema'), count(film.showings, 'showing')].filter(Boolean).join(' · '),
      },
    })));
    return local(columns, rows, ui);
  };
  return { title, table };
}

function hideButton(id: string): HTMLElement {
  const isHidden = hidden.has(id);
  return button(isHidden ? 'Show this film again' : 'Hide this film', () => {
    toggle(hidden, [id]);
    render();
  });
}

function filmIntro(film: q.Film): Node {
  const named = (role: string) => film.people.filter((p) => p.roles.includes(role)).map((p) => p.name).join(', ');
  const pairs: [string, Node | string][] = [
    ['Certificate', film.certificate || 'TBC'],
    ['Runtime', film.runtime ? `${film.runtime} minutes` : '–'],
    ['Released', fullDate(film.release)],
    ['Genres', film.genres.join(', ') || '–'],
  ];
  if (film.imdb !== null) {
    const score = `${film.imdb.toFixed(1)} / 10`;
    pairs.push(['IMDb', film.imdbId ? link(score, `https://www.imdb.com/title/${film.imdbId}/`, true) : score]);
  }
  if (film.metacritic !== null) pairs.push(['Metacritic', `${film.metacritic} / 100`]);
  if (named('Director')) pairs.push(['Director', named('Director')]);
  if (named('Actor')) pairs.push(['Cast', named('Actor')]);
  if (film.distributor) pairs.push(['Distributor', film.distributor]);
  return h('div', { class: 'intro' },
    facts(pairs),
    h('p', { class: 'dim' }, film.synopsis),
    h('p', { class: 'actions' }, ...(film.trailer ? [link('Watch the trailer', film.trailer, true)] : []), hideButton(film.id)),
  );
}

function filmView(id: string): View {
  const film = q.film(db, id);
  if (!film) return missing('That film is no longer listed.');
  const columns: Column[] = [{ label: 'Cinema', wrap: true }, { label: 'Location', wide: true }, { label: 'Showings', right: true }, { label: 'Next' }];
  const rows = q.cinemas(db, scope(), id)
    .filter((cinema) => !ticks.size || ticks.has(cinema.id))
    .map((cinema): Row => ({
      cells: [shortCinema(cinema.name), place(cinema), cinema.showings, when(cinema.next)],
      values: [cinema.name, place(cinema), cinema.showings, cinema.next],
      open: path('film', id, cinema.id),
    }));
  return {
    title: film.title,
    intro: filmIntro(film),
    table: (ui) => local(columns, rows, ui),
    keys: { h: () => { toggle(hidden, [id]); render(); } },
  };
}

function hiddenView(): View {
  const columns: Column[] = [{ label: 'Hidden film', wrap: true }];
  const table = (ui: Ui) =>
    local(columns, q.titles(db, [...hidden]).map((film): Row => ({ cells: [film.title], open: path('film', film.id), film: film.id })), ui);
  const intro = h('div', { class: 'intro' }, h('p', { class: 'dim' }, 'Hidden films are left out of every list. Open one to show it again, or press h.'));
  return { title: 'Hidden films', intro, table };
}

function cinemasView(location?: string): View {
  const columns: Column[] = [{ label: 'Cinema', wrap: true }, { label: 'Location', wide: true }, { label: 'Films', right: true }, { label: 'Showings', right: true }];
  const table = (ui: Ui) => {
    const rows = allCinemas()
      .filter((cinema) => !location || place(cinema) === location)
      .map((cinema): Row => ({
        cells: [cinema.name, place(cinema), cinema.films, cinema.showings],
        open: path('cinema', cinema.id),
        tick: { state: ticks.has(cinema.id) ? 'all' : 'none', toggle: () => toggle(ticks, [cinema.id]) },
      }));
    return local(columns, rows, ui);
  };
  const intro = h('div', { class: 'intro' }, h('p', { class: 'dim' }, 'Tick a cinema with its box, or Space. With any ticked, every other screen shows only those.'));
  return { title: location ?? 'Cinemas', intro, table };
}

function locationsView(): View {
  const columns: Column[] = [{ label: 'Location', wrap: true }, { label: 'Cinemas', right: true }, { label: 'Showings', right: true }];
  const table = (ui: Ui) => {
    const groups = new Map<string, q.CinemaRow[]>();
    for (const cinema of allCinemas()) groups.set(place(cinema), [...(groups.get(place(cinema)) ?? []), cinema]);
    const rows = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, cinemas]): Row => {
      const ids = cinemas.map((cinema) => cinema.id);
      const ticked = ids.filter((id) => ticks.has(id)).length;
      return {
        cells: [name, cinemas.length, cinemas.reduce((sum, cinema) => sum + cinema.showings, 0)],
        open: path('location', name),
        tick: {
          state: ticked === ids.length ? 'all' : ticked ? 'some' : 'none',
          toggle: () => toggle(ticks, ids, ticked !== ids.length),
        },
      };
    });
    return local(columns, rows, ui);
  };
  const intro = h('div', { class: 'intro' }, h('p', { class: 'dim' }, 'Tick a location to tick every cinema in it.'));
  return { title: 'Location', intro, table };
}

function soonView(): View {
  const columns: Column[] = [{ label: 'Film', wrap: true }, { label: 'Cert' }, { label: 'Opens' }, { label: 'Cinemas', right: true }];
  const rows = q.soon(db, scope()).map((film): Row => ({
    cells: [film.title, film.certificate || 'TBC', fullDate(film.release), film.cinemas],
    values: [film.title, film.certificate, film.release, film.cinemas],
    open: path('film', film.id),
    film: film.id,
  }));
  return { title: 'Opening soon', table: (ui) => local(columns, rows, ui) };
}

function datesView(): View {
  const columns: Column[] = [{ label: 'Date' }, { label: 'Films', right: true }, { label: 'Showings', right: true }];
  const rows = q.dates(db, scope()).map((date): Row => ({
    cells: [`${day(date.date)} ${date.date.slice(0, 4)}`, date.films, date.showings],
    values: [date.date, date.films, date.showings],
    open: path('date', date.date),
  }));
  return { title: 'Dates', table: (ui) => local(columns, rows, ui) };
}

function tagsView(kind: TagKind): View {
  const columns: Column[] = [{ label: kind, wrap: true }, { label: 'Showings', right: true }, { label: 'Films', right: true }, { label: 'Cinemas', right: true }];
  const rows = experienceTags().filter((row) => tagKind(row.tag) === kind).map((row): Row => ({
    cells: [tagLabel(row.tag), row.showings, row.films, row.cinemas],
    open: path('tag', row.tag),
  }));
  return { title: kind, table: (ui) => local(columns, rows, ui) };
}

function seatsView(): View {
  const columns: Column[] = [{ label: 'Seat type', wrap: true }, { label: 'Showings', right: true }, { label: 'Films', right: true }, { label: 'Cinemas', right: true }];
  const rows = seatTypes().map((row): Row => ({ cells: [row.tag, row.showings, row.films, row.cinemas], open: path('seat', row.tag) }));
  return { title: 'Seating', table: (ui) => local(columns, rows, ui) };
}

function facetView(title: string, kind: 'certificate' | 'person' | 'genre' | 'distributor'): View {
  const people = kind === 'person';
  const columns: Column[] = [{ label: title, wrap: true }, ...(people ? [{ label: 'Role' }] : []), { label: 'Films', right: true }, { label: 'Showings', right: true }];
  const rows = facetRows(kind).map((row): Row => ({
    cells: [row.name, ...(people ? [row.role] : []), row.films, row.showings],
    open: path('by', kind, row.name),
  }));
  return { title, table: (ui) => local(columns, rows, ui) };
}

function screensView(): View {
  const columns: Column[] = [{ label: 'Cinema', wrap: true }, { label: 'Screen' }, { label: 'Seats', right: true }, { label: 'Showings', right: true }, { label: 'Formats', wide: true }];
  const rows = allScreens().map((screen): Row => ({
    cells: [shortCinema(screen.cinema), screen.screen.replace(/^Screen /, ''), screen.capacity, screen.showings, formats(screen.tags, ['Picture'])],
    open: path('screen', screen.cinemaId, screen.screenId),
    card: {
      title: `${shortCinema(screen.cinema)} · ${screen.screen}`,
      meta: [screen.capacity ? `${screen.capacity} seats` : '', count(screen.showings, 'showing'), formats(screen.tags, ['Picture'])].filter(Boolean).join(' · '),
    },
  }));
  return { title: 'Screens', table: (ui) => local(columns, rows, ui) };
}

/** A showtimes table. Leaving a column out is for what the screen already fixes. */
function showingsView(title: string, filter: q.ShowingFilter, within: q.Scope = scope()): View {
  const all: (Column & { cell(row: q.Showing): Cell })[] = [
    { label: 'Date', order: 'date', cell: (row) => day(row.startsAt) },
    { label: 'Time', order: 'time', cell: (row) => row.time },
    { label: 'Film', order: 'film', wrap: true, cell: (row) => row.title },
    { label: 'Cinema', order: 'cinema', cell: (row) => shortCinema(row.cinema) },
    { label: 'Screen', order: 'screen', cell: (row) => row.screen.replace(/^Screen /, '') },
    { label: 'Seats', order: 'seats', right: true, cell: (row) => row.capacity },
    { label: 'Formats', wide: true, cell: (row) => formats(row.experiences) },
  ];
  const columns = all.filter((column) => !(filter.film && column.label === 'Film') && !(filter.cinema && column.label === 'Cinema'));
  return {
    title,
    paged: true,
    table(ui) {
      const order = ui.order === null ? 'date' : (columns[ui.order].order ?? 'date');
      const found = q.showings(db, within, { ...filter, text: ui.text }, order, ui.descending, PAGE, ui.page * PAGE);
      return {
        columns,
        total: found.total,
        rows: found.rows.map((row): Row => ({
          cells: columns.map((column) => column.cell(row)),
          open: path('show', row.cinemaId, row.id),
          book: BOOKING + row.id,
          calendar: () => addToCalendar(row.cinemaId, row.id),
          sold: row.soldOut,
          card: {
            title: `${row.time}  ${filter.film ? day(row.startsAt) : row.title}`,
            meta: [
              filter.film ? '' : day(row.startsAt),
              filter.cinema ? '' : shortCinema(row.cinema),
              row.screen,
              row.capacity ? `${row.capacity} seats` : '',
              formats(row.experiences),
              row.soldOut ? 'sold out' : '',
            ].filter(Boolean).join(' · '),
          },
        })),
      };
    },
  };
}

function showView(cinema: string, id: string): View {
  const show = q.showing(db, cinema, id);
  if (!show) return missing('That showing is no longer listed.');
  const address = [show.address.line1, show.address.line2, show.address.city].filter(Boolean).join(', ');
  const types = [...new Set(show.seating.map((seat) => seat.replace(/ (Saver|Popular)$/, '')))];
  const book = BOOKING + show.id;
  const calendar = () => addToCalendar(cinema, id);
  const intro = h('div', { class: 'intro' },
    facts([
      ['Film', link(show.title, '#/' + path('film', show.filmId))],
      ['When', `${day(show.startsAt)} at ${show.time}${show.soldOut ? ' · sold out' : ''}`],
      ...(show.filmStartsAt ? [['Film starts', `${TIME.format(new Date(show.filmStartsAt))}${show.filmEndsAt ? ', ends ' + TIME.format(new Date(show.filmEndsAt)) : ''}`] as [string, string]] : []),
      ['Cinema', link(`ODEON ${show.cinema}`, '#/' + path('cinema', show.cinemaId))],
      ...(address ? [['Address', address] as [string, string]] : []),
      ['Screen', `${show.screen}${show.capacity ? ` · ${show.capacity} seats` : ''}`],
      ...(formats(show.experiences) ? [['Formats', formats(show.experiences)] as [string, string]] : []),
      ...(formats(show.experiences, ['Events']) ? [['Event', formats(show.experiences, ['Events'])] as [string, string]] : []),
      ...(types.length ? [['Seating', types.join(', ')] as [string, string]] : []),
      ...(formats(show.experiences, ['Accessibility']) ? [['Accessibility', formats(show.experiences, ['Accessibility'])] as [string, string]] : []),
    ]),
    h('p', { class: 'actions' }, link('Book on odeon.co.uk', book, true), button('Add to calendar', calendar)),
  );
  return {
    title: `${show.title} · ${show.time}`,
    intro,
    table: () => ({ columns: [], rows: [], total: 0 }),
    keys: { b: () => window.open(book, '_blank', 'noopener'), c: calendar },
  };
}

function missing(message: string): View {
  return { title: 'Not found', intro: h('p', { class: 'empty' }, message), table: () => ({ columns: [], rows: [], total: 0 }) };
}

function viewFor(route: string): View {
  const [name, a, b] = route.split('/').map(decodeURIComponent);
  const today = scope().today;
  const cinemaName = (id: string) => allCinemas().find((cinema) => cinema.id === id)?.name;
  switch (name) {
    case '': return homeView();
    case 'films': return filmsView();
    case 'hidden': return hiddenView();
    case 'cinemas': return cinemasView();
    case 'locations': return locationsView();
    case 'location': return cinemasView(a);
    case 'soon': return soonView();
    case 'dates': return datesView();
    case 'screens': return screensView();
    case 'seats': return seatsView();
    case 'tags': return tagsView(a as TagKind);
    case 'tag': return showingsView(tagLabel(a), { tag: a });
    case 'seat': return showingsView(a, { seat: a });
    case 'by': {
      const menu = FACET_MENUS.find(([, kind]) => kind === a);
      if (!menu) return missing('There is no such page.');
      return b ? filmsView(b, { [menu[1]]: b }) : facetView(menu[0], menu[1]);
    }
    case 'tonight': return showingsView('Tonight', { from: today, to: today });
    case 'weekend': { const [from, to] = q.weekend(today); return showingsView('This weekend', { from, to }); }
    case 'all': return showingsView('All showtimes', {});
    case 'date': return showingsView(`${day(a)} ${a.slice(0, 4)}`, { from: a, to: a });
    case 'show': return showView(a, b);
    case 'cinema': {
      const cinema = cinemaName(a);
      return cinema ? showingsView(cinema, { cinema: a }, scope([])) : missing('That cinema is not listed.');
    }
    case 'screen': {
      const screen = allScreens().find((row) => row.cinemaId === a && row.screenId === b)
        ?? q.screens(db, scope([])).find((row) => row.cinemaId === a && row.screenId === b);
      if (!screen) return missing('That screen has no showings listed.');
      return showingsView(`${shortCinema(screen.cinema)} · ${screen.screen}`, { cinema: a, screen: b }, scope([]));
    }
    case 'film': {
      if (!b) return filmView(a);
      const film = q.film(db, a);
      const cinema = cinemaName(b);
      if (!film || !cinema) return missing('That film is no longer showing there.');
      return showingsView(`${film.title} · ${shortCinema(cinema)}`, { film: a, cinema: b }, scope([]));
    }
    default: return missing('There is no such page.');
  }
}

// ---- Rendering and keys -------------------------------------------------

const route = () => location.hash.replace(/^#\/?/, '');
let current: { view: View; ui: Ui; table: Table };

const go = (target: string) => { location.hash = '#/' + target; };
function back() {
  if (!route()) return;
  if (history.length > 1) history.back();
  else go('');
}

/** Build the page for a route. The search box lives here so that typing in it
 *  never replaces it; paint() then redraws only what a keystroke changes. */
function render() {
  address(); // going back can land on an address from before a choice changed
  const key = route();
  if (!whole && needsEveryCinema(key, ticks)) {
    // This page is about more than Greater London: fetch the rest, then show it.
    app.querySelector('.status')?.replaceChildren('loading every cinema…');
    everything ??= load(true);
    return;
  }
  if (!db) return; // still downloading; load() draws the page when it arrives
  if (!uis.has(key)) uis.set(key, { order: null, descending: false, text: '', page: 0, selected: 0 });
  const ui = uis.get(key)!;
  const view = viewFor(key);
  document.title = key ? `${view.title} · ODEON` : 'ODEON';
  const search = h('input', { type: 'search', placeholder: 'Search this table', 'aria-label': 'Search this table' }) as HTMLInputElement;
  search.value = ui.text;
  search.oninput = () => { ui.text = search.value; ui.page = 0; ui.selected = 0; paint(); };
  const stamp = db.ingested;
  const hints = ['↑↓ move', 'Enter open', 'Esc back', '/ search', 's sort', 'n p pages', 'Space tick', 'h hide film', 'b book', 'c calendar'];
  app.replaceChildren(
    h('header', {},
      ...(key ? [button('← Back', back), link('Start', '#/')] : []),
      h('h1', {}, 'ODEON ', h('span', {}, '— ' + view.title))),
    ...(view.intro ? [view.intro] : []),
    h('div', { class: 'tools' }, search, h('span', { class: 'sorter' }), h('span', { class: 'pager' })),
    h('div', { class: 'scroll' }),
    h('footer', {},
      h('span', { class: 'keys' }, ...hints.flatMap((hint) => {
        const [keys, ...words] = hint.split(' ');
        return [h('kbd', {}, keys), ` ${words.join(' ')}   `];
      })),
      h('span', { class: 'status' }, `listings from ${stamp ? day(stamp) : 'no ingest yet'}`)),
  );
  current = { view, ui, table: { columns: [], rows: [], total: 0 } };
  paint();
  window.scrollTo(0, 0);
}

const BOXES = { all: '[x]', some: '[-]', none: '[ ]' };

function paint() {
  const { view, ui } = current;
  let table = view.table(ui);
  const pages = Math.max(1, Math.ceil(table.total / PAGE));
  if (ui.page >= pages) { ui.page = pages - 1; table = view.table(ui); }
  ui.selected = Math.min(ui.selected, Math.max(table.rows.length - 1, 0));
  current.table = table;
  const sortable = table.columns.map((column, index) => (!view.paged || column.order ? index : -1)).filter((index) => index >= 0);
  const ticking = table.rows.some((row) => row.tick);
  const tickBox = (row: Row, index: number, tag: string) => {
    const box = h(tag, { class: 'tick', role: 'checkbox', 'aria-checked': row.tick!.state === 'all' ? 'true' : row.tick!.state === 'some' ? 'mixed' : 'false' }, BOXES[row.tick!.state]);
    box.onclick = (event) => { event.stopPropagation(); event.preventDefault(); ui.selected = index; tick(); };
    return box;
  };

  let list: HTMLElement;
  if (narrow.matches) {
    // Phones: one card a row, the whole card a tap target.
    list = h('ul', { class: 'cards' }, ...table.rows.map((row, index) => {
      const shown = row.card ?? {
        title: String(row.cells[0] ?? '–'),
        meta: row.cells.slice(1).map((cell, offset) => {
          const column = table.columns[offset + 1];
          if (cell === null || cell === '') return '';
          const noun = column.label.toLowerCase();
          return column.right ? `${cell} ${cell === 1 ? noun.replace(/s$/, '') : noun}` : String(cell);
        }).filter(Boolean).join(' · '),
      };
      const card = h('li', { class: [index === ui.selected ? 'selected' : '', row.sold ? 'sold' : ''].join(' ') },
        ...(row.tick ? [tickBox(row, index, 'span')] : []),
        h('span', { class: 'text' }, h('strong', {}, shown.title), ...(shown.meta ? [h('span', { class: 'dim' }, shown.meta)] : [])),
        ...(row.open ? [h('span', { class: 'go dim' }, '›')] : []));
      card.onclick = () => { ui.selected = index; open(); };
      return card;
    }));
  } else {
    const head = h('tr', {}, ...(ticking ? [h('th', {})] : []), ...table.columns.map((column, index) => {
      const sorted = ui.order === index;
      const th = h('th', { class: [sortable.includes(index) ? 'sortable' : '', column.right ? 'right' : '', column.wide ? 'wide' : '', sorted ? 'sorted' : ''].join(' ') },
        column.label + (sorted ? (ui.descending ? ' ▼' : ' ▲') : ''));
      th.onclick = () => sortBy(index);
      return th;
    }));
    const body = h('tbody', {}, ...table.rows.map((row, index) => {
      const tr = h('tr', { class: index === ui.selected ? 'selected' : '' },
        ...(ticking ? [row.tick ? tickBox(row, index, 'td') : h('td', {})] : []),
        ...row.cells.map((cell, column) => {
          const spec = table.columns[column];
          return h('td', { class: [spec.right ? 'right' : '', spec.wide ? 'wide' : '', spec.wrap ? 'wrap' : '', row.sold ? 'sold' : ''].join(' ') },
            cell === null || cell === '' ? '–' : String(cell));
        }));
      tr.onclick = () => { ui.selected = index; open(); };
      return tr;
    }));
    list = h('table', {}, h('thead', {}, head), body);
  }

  // Sorting without a keyboard or headings: a menu of the sortable columns.
  const sorter = h('select', { 'aria-label': 'Sort by' }, h('option', { value: '' }, 'Sort…'),
    ...sortable.map((index) => h('option', { value: String(index) }, table.columns[index].label))) as HTMLSelectElement;
  sorter.value = ui.order === null ? '' : String(ui.order);
  sorter.onchange = () => { if (sorter.value) sortBy(Number(sorter.value), false); };
  const flip = button(ui.descending ? '▼' : '▲', () => { if (ui.order !== null) sortBy(ui.order); });
  flip.setAttribute('aria-label', 'Reverse the order');
  app.querySelector('.sorter')!.replaceChildren(...(sortable.length ? [sorter, flip] : []));

  const pager = (label: string, step: number, enabled: boolean) => {
    const control = button(label, () => turn(step)) as HTMLButtonElement;
    control.disabled = !enabled;
    return control;
  };
  app.querySelector<HTMLElement>('.tools')!.hidden = !table.columns.length;
  app.querySelector('.pager')!.replaceChildren(
    ...(pages > 1 ? [pager('←', -1, ui.page > 0), h('span', { class: 'dim' }, `${ui.page + 1} / ${pages}`), pager('→', 1, ui.page < pages - 1)] : []),
    h('span', { class: 'dim' }, count(table.total, 'row')));
  app.querySelector('.scroll')!.replaceChildren(...(table.columns.length ? [
    list,
    ...(table.rows.length ? [] : [h('p', { class: 'empty' }, ticks.size ? 'Nothing here for your ticked cinemas.' : 'Nothing here.')]),
  ] : []));
  if (!narrow.matches) list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function move(step: number) {
  // Only the highlight moves: no query, and nothing is rebuilt.
  const { ui, table } = current;
  const items = app.querySelectorAll('.scroll tbody tr, .scroll .cards li');
  items[ui.selected]?.classList.remove('selected');
  ui.selected = Math.max(0, Math.min(table.rows.length - 1, ui.selected + step));
  items[ui.selected]?.classList.add('selected');
  if (!narrow.matches) items[ui.selected]?.scrollIntoView({ block: 'nearest' });
}
function turn(step: number) {
  const { ui, table } = current;
  const page = ui.page + step;
  if (page < 0 || page >= Math.ceil(table.total / PAGE)) return;
  ui.page = page;
  ui.selected = 0;
  paint();
  window.scrollTo(0, 0);
}
function sortBy(index: number, flipSame = true) {
  const { ui, view, table } = current;
  if (view.paged && !table.columns[index].order) return;
  if (ui.order === index) { if (flipSame) ui.descending = !ui.descending; }
  else { ui.order = index; ui.descending = false; }
  ui.page = 0;
  paint();
}
function nextSort() {
  const { ui, view, table } = current;
  const sortable = table.columns.map((column, index) => (!view.paged || column.order ? index : -1)).filter((index) => index >= 0);
  if (sortable.length) sortBy(sortable[(sortable.indexOf(ui.order ?? -1) + 1) % sortable.length]);
}
const selectedRow = (): Row | undefined => current.table.rows[current.ui.selected];
function open() {
  const row = selectedRow();
  if (row?.open) go(row.open);
}
function tick() {
  const row = selectedRow();
  if (!row?.tick) return;
  row.tick.toggle();
  paint();
}

document.addEventListener('keydown', (event) => {
  if (!current || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'ArrowDown') {
      target.blur();
      event.preventDefault();
    }
    return;
  }
  if (target instanceof HTMLSelectElement || (target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' '))) return;
  const actions: Record<string, () => void> = {
    ArrowDown: () => move(1), ArrowUp: () => move(-1), j: () => move(1), k: () => move(-1),
    PageDown: () => move(20), PageUp: () => move(-20),
    Home: () => move(-Infinity), End: () => move(Infinity),
    Enter: open, ArrowRight: open, Escape: back, ArrowLeft: back, Backspace: back,
    ' ': tick, s: nextSort, n: () => turn(1), p: () => turn(-1),
    '/': () => app.querySelector<HTMLInputElement>('.tools input')?.focus(),
    b: () => { const row = selectedRow(); if (row?.book) window.open(row.book, '_blank', 'noopener'); },
    c: () => selectedRow()?.calendar?.(),
    h: () => { const row = selectedRow(); if (row?.film) { toggle(hidden, [row.film]); paint(); } },
    ...current.view.keys,
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  action();
});
window.addEventListener('hashchange', render);
narrow.addEventListener('change', () => { if (current) paint(); });

function load(all: boolean): Promise<void> {
  return openListings(all ? './data/listings.json.gz' : './data/london.json.gz').then(
    (listings) => {
      db = listings;
      whole = all;
      version += 1; // every remembered count came from the other listings
      render();
    },
    (error) => { app.replaceChildren(h('p', { class: 'error' }, String(error.message ?? error))); },
  );
}
const start = needsEveryCinema(route(), ticks);
if (start) everything = load(true);
else load(false);
