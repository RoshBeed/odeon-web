// The interface: a stack of tables over the listings, driven by keys, clicks or taps.
import { ics } from './calendar';
import { needsEveryCinema, PAGE, PLAIN, readChoice, readPage, writeChoices, writePage, type Ui } from './choices';
import { openListings } from './db';
import * as q from './queries';
import { certificateAge, formats, place, shortCinema, tagKind, tagLabel, type TagKind } from './tags';

const BOOKING = 'https://www.odeon.co.uk/ticketing/seat-picker/?showtimeId=';

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
  /** A heading drawn above the row in a list of cards: the day a run of showings is on. */
  day?: string;
  /** Stays first on every page of its table, whatever the sort or search. */
  pinned?: boolean;
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
  /** Rows for the current sort and search: the first `(ui.page + 1) * PAGE` of them. */
  table(ui: Ui): Table;
  /** A short fixed list (the menu, the settings) that needs no search or sort. */
  plain?: boolean;
  /** True when showings() sorts and searches (the showtimes tables). */
  paged?: boolean;
  /** Keys that act on the page itself, not on a row. */
  keys?: Record<string, () => void>;
}

let db: q.Listings;
/** Whether `db` holds every cinema's showings, or only Greater London's. */
let whole = false;
let everything: Promise<void> | undefined;
const app = document.getElementById('app')!;
const narrow = matchMedia('(max-width: 640px)');

// ---- What the visitor has chosen, kept in the page's address ---------------

const ticks = readChoice(location.search, 'cinemas');
const hidden = readChoice(location.search, 'hidden');
/** What the visitor has asked to see that is otherwise left out: `events`. */
const extras = readChoice(location.search, 'show');
/** How the pages are laid out: side by side in columns, unless this holds `pages`. */
const layout = readChoice(location.search, 'view');
let version = 0;
/** Put the choices in the address, where a bookmark or a shared link keeps them. */
function address() {
  const search = writeChoices({ cinemas: ticks, hidden, show: extras, view: layout });
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
    noEvents: !extras.has('events'),
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

/** Sort and search a short list here; showings() does it for showtimes. */
function local(columns: Column[], rows: Row[], ui: Ui, all?: Row): Table {
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
  const page = found.slice(0, (ui.page + 1) * PAGE);
  return { columns, rows: all ? [{ ...all, cells: columns.map((_, index) => (index ? '' : 'All')) }, ...page] : page, total: found.length };
}

/** The row that heads a list of ways to narrow things down: skip this one, see everything. */
function allRow(target: string, what: string): Row {
  return { cells: [], open: target, pinned: true, card: { title: 'All', meta: what } };
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

/** The page the site opens on: what it is and how to set it up. */
function welcomeView(): View {
  const enter = () => go('browse');
  const chosen = [
    ticks.size ? `${count(ticks.size, 'cinema')} ticked` : 'every cinema',
    extras.has('events') ? 'event cinema shown' : 'event cinema left out',
    ...(hidden.size ? [`${count(hidden.size, 'film')} hidden`] : []),
  ].join(' · ');
  const intro = h('div', { class: 'intro' },
    h('p', {}, "What's on at ODEON, on which screen, and how big that screen is."),
    h('p', { class: 'actions' }, button('Browse the listings', enter)),
    facts([
      ['1. Your cinemas', 'open Cinemas or Location and tick the ones you go to. Everything then shows only those.'],
      ['2. Bookmark', 'your choices are part of the page address; nothing is saved in the browser. Bookmark the page and it opens the same way anywhere.'],
      ['Now', chosen],
      ['Keys', '↑ ↓ move · → or Enter open · ← or Esc back · / search · s sort · Space tick'],
    ]),
  );
  return { title: 'Welcome', intro, table: () => ({ columns: [], rows: [], total: 0 }), keys: { Enter: enter, ArrowRight: enter } };
}

/** Everything there is to browse or choose, each in one place. */
function menuView(): View {
  const rows = (): Row[] => {
    const home = q.home(db, scope());
    const [first, last] = q.weekend(scope().today);
    const places = new Set(allCinemas().map(place));
    const [screens, tags, seats] = [allScreens(), experienceTags(), seatTypes()];
    return [
      { cells: ['Films', count(home.films, 'film'), count(home.showings, 'showing')], open: 'films' },
      { cells: ['Cinemas', count(home.allCinemas, 'cinema'), ticks.size ? `${count(ticks.size, 'cinema')} ticked` : 'all'], open: 'cinemas' },
      { cells: ['Location', count(places.size, 'location'), 'browse or tick cinema groups'], open: 'locations' },
      { cells: ['Tonight', count(home.tonight, 'screening'), count(home.tonightFilms, 'film')], open: 'tonight' },
      { cells: ['This weekend', count(home.weekendShows, 'screening'), `${count(home.weekendFilms, 'film')} · ${day(first)} – ${day(last)}${db.fullUntil && first > db.fullUntil ? ' · advance bookings only so far' : ''}`], open: 'weekend' },
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
      { cells: ['Settings', '', 'event cinema, layout, hidden films · copy the address'], open: 'settings' },
    ];
  };
  const columns = [{ label: 'Browse' }, { label: 'How many' }, { label: 'Showing', wrap: true }];
  return { title: 'Browse', plain: true, table: (ui) => local(columns, rows(), ui) };
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
      values: [film.title, certificateAge(film.certificate), film.runtime, film.imdb, film.metacritic, film.cinemas, film.showings, film.next],
      open: path('film', film.id),
      film: film.id,
      card: {
        title: film.title,
        meta: [film.certificate || 'TBC', film.runtime ? `${film.runtime} min` : '', film.imdb ? `IMDb ${film.imdb.toFixed(1)}` : '', count(film.cinemas, 'cinema'), count(film.showings, 'showing')].filter(Boolean).join(' · '),
      },
    })));
    return local(columns, rows, ui, Object.keys(filter).length ? undefined : allRow('all', 'every showtime, whatever the film'));
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

/** The trailer, in place: a still that becomes the player when pressed, so
 *  that moving past a film loads one picture and no player. */
function trailer(address: string): Node {
  const id = /[?&]v=([\w-]{11})/.exec(address)?.[1];
  if (!id) return h('p', { class: 'actions' }, link('Watch the trailer', address, true));
  const frame = h('div', { class: 'trailer' });
  const still = h('button', { type: 'button', 'aria-label': 'Play the trailer' },
    h('img', { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: '', loading: 'lazy' }),
    h('span', {}, '▶ Trailer'));
  still.onclick = () => frame.replaceChildren(h('iframe', {
    src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`,
    title: 'Trailer',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowfullscreen: '',
  }));
  frame.append(still);
  return frame;
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
  const cast = film.people.filter((p) => p.roles.includes('Actor')).map((p) => p.name);
  if (cast.length) pairs.push(['Cast', cast.slice(0, 6).join(', ') + (cast.length > 6 ? ` and ${cast.length - 6} more` : '')]);
  if (film.distributor) pairs.push(['Distributor', film.distributor]);
  return h('div', { class: 'intro' },
    facts(pairs),
    h('p', { class: 'dim' }, film.synopsis),
    ...(film.trailer ? [trailer(film.trailer)] : []),
    h('p', { class: 'actions' }, hideButton(film.id)),
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
    table: (ui) => local(columns, rows, ui, allRow(path('film', id, 'all'), 'every showtime of this film')),
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

function settingsView(): View {
  const columns: Column[] = [{ label: 'Setting' }, { label: 'Now' }, { label: 'What it does', wrap: true }];
  const rows = (): Row[] => [
    {
      cells: ['Event cinema', extras.has('events') ? 'shown' : 'hidden', 'concerts, theatre, opera and other specials, which ODEON marks Event Cinema'],
      tick: { state: extras.has('events') ? 'all' : 'none', toggle: () => toggle(extras, ['events']) },
    },
    {
      cells: ['Columns', layout.has('pages') ? 'off' : 'on', 'show pages side by side, as the column view in Finder does (never on a phone)'],
      tick: { state: layout.has('pages') ? 'none' : 'all', toggle: switchLayout },
    },
    { cells: ['Hidden films', count(hidden.size, 'film'), 'films you hid with h or the Hide button; open to show them again'], open: 'hidden' },
  ];
  const copied = h('span', { class: 'dim' });
  const intro = h('div', { class: 'intro' },
    h('p', {}, 'Nothing is saved in this browser. Every choice here, and how each page is sorted and searched, is part of the page address.'),
    h('p', {}, 'Tick your cinemas under Cinemas or Location, set things up here, then bookmark the page. Opening the bookmark brings it all back, on any device.'),
    h('p', { class: 'actions' },
      button('Copy the address', () => {
        navigator.clipboard.writeText(location.href).then(
          () => copied.replaceChildren('Copied.'),
          () => copied.replaceChildren('Could not copy; use the address bar.'),
        );
      }),
      button('Clear every choice', () => {
        for (const chosen of [ticks, hidden, extras, layout]) chosen.clear();
        version += 1;
        render();
      }),
      copied),
  );
  return { title: 'Settings', plain: true, intro, table: (ui) => local(columns, rows(), ui) };
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
    return local(columns, rows, ui, location ? undefined : allRow('all', 'every showtime, whatever the cinema'));
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
    return local(columns, rows, ui, allRow('cinemas', 'every cinema'));
  };
  const intro = h('div', { class: 'intro' }, h('p', { class: 'dim' }, 'Tick a location to tick every cinema in it.'));
  return { title: 'Location', intro, table };
}

function soonView(): View {
  const columns: Column[] = [{ label: 'Film', wrap: true }, { label: 'Cert' }, { label: 'Opens' }, { label: 'Cinemas', right: true }];
  const rows = q.soon(db, scope()).map((film): Row => ({
    cells: [film.title, film.certificate || 'TBC', fullDate(film.release), film.cinemas],
    values: [film.title, certificateAge(film.certificate), film.release, film.cinemas],
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
  return { title: 'Dates', table: (ui) => local(columns, rows, ui, allRow('all', 'every showtime, whatever the day')) };
}

function tagsView(kind: TagKind): View {
  const columns: Column[] = [{ label: kind, wrap: true }, { label: 'Showings', right: true }, { label: 'Films', right: true }, { label: 'Cinemas', right: true }];
  const rows = experienceTags().filter((row) => tagKind(row.tag) === kind).map((row): Row => ({
    cells: [tagLabel(row.tag), row.showings, row.films, row.cinemas],
    open: path('tag', row.tag),
  }));
  return { title: kind, table: (ui) => local(columns, rows, ui, allRow('all', 'every showtime')) };
}

function seatsView(): View {
  const columns: Column[] = [{ label: 'Seat type', wrap: true }, { label: 'Showings', right: true }, { label: 'Films', right: true }, { label: 'Cinemas', right: true }];
  const rows = seatTypes().map((row): Row => ({ cells: [row.tag, row.showings, row.films, row.cinemas], open: path('seat', row.tag) }));
  return { title: 'Seating', table: (ui) => local(columns, rows, ui, allRow('all', 'every showtime, whatever the seats')) };
}

function facetView(title: string, kind: 'certificate' | 'person' | 'genre' | 'distributor'): View {
  const people = kind === 'person';
  const columns: Column[] = [{ label: title, wrap: true }, ...(people ? [{ label: 'Role' }] : []), { label: 'Films', right: true }, { label: 'Showings', right: true }];
  const age = (name: string) => certificateAge(name) ?? 99;
  const found = kind === 'certificate' ? [...facetRows(kind)].sort((a, b) => age(a.name) - age(b.name)) : facetRows(kind);
  const rows = found.map((row): Row => ({
    cells: [row.name, ...(people ? [row.role] : []), row.films, row.showings],
    ...(kind === 'certificate' ? { values: [certificateAge(row.name), row.films, row.showings] } : {}),
    open: path('by', kind, row.name),
  }));
  return { title, table: (ui) => local(columns, rows, ui, allRow('films', 'every film')) };
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
  return { title: 'Screens', table: (ui) => local(columns, rows, ui, allRow('all', 'every showtime, whatever the screen')) };
}

/** A showtimes table. Leaving a column out is for what the screen already fixes. */
function showingsView(title: string, filter: q.ShowingFilter, within: q.Scope = scope()): View {
  const ends = (row: q.Showing) => (row.endsAt ? TIME.format(new Date(row.endsAt)) : null);
  const all: (Column & { cell(row: q.Showing): Cell })[] = [
    { label: 'Date', order: 'date', cell: (row) => day(row.startsAt) },
    { label: 'Time', order: 'time', cell: (row) => row.time },
    { label: 'Ends', cell: ends },
    { label: 'Film', order: 'film', wrap: true, cell: (row) => row.title },
    { label: 'Cinema', order: 'cinema', cell: (row) => shortCinema(row.cinema) },
    { label: 'Screen', order: 'screen', cell: (row) => row.screen.replace(/^Screen /, '') },
    { label: 'Seats', order: 'seats', right: true, cell: (row) => row.capacity },
    { label: 'Formats', wide: true, cell: (row) => formats(row.experiences) },
  ];
  // What the page already fixes is left out: its film, its cinema, its one day.
  const oneDay = Boolean(filter.from && filter.from === filter.to);
  const columns = all.filter((column) =>
    !(filter.film && column.label === 'Film') && !(filter.cinema && column.label === 'Cinema') && !(oneDay && column.label === 'Date'));
  return {
    title,
    paged: true,
    table(ui) {
      const order = ui.order === null ? 'date' : (columns[ui.order].order ?? 'date');
      const found = q.showings(db, within, { ...filter, text: ui.text }, order, ui.descending, (ui.page + 1) * PAGE);
      // In date order a list of cards is headed day by day, so the cards need not repeat the date.
      const headed = order === 'date' && !oneDay;
      const dated = !oneDay && !headed;
      return {
        columns,
        total: found.total,
        rows: found.rows.map((row, index): Row => {
          const span = ends(row) ? `${row.time}–${ends(row)}` : row.time;
          return {
            cells: columns.map((column) => column.cell(row)),
            open: path('show', row.cinemaId, row.id),
            book: BOOKING + row.id,
            calendar: () => addToCalendar(row.cinemaId, row.id),
            sold: row.soldOut,
            day: headed && row.date !== found.rows[index - 1]?.date
              ? day(row.date) + (db.fullUntil && row.date > db.fullUntil ? ' · advance bookings only so far' : '')
              : undefined,
            card: {
              title: filter.film ? span + (dated ? `  ${day(row.startsAt)}` : '') : `${span}  ${row.title}`,
              meta: [
                !filter.film && dated ? day(row.startsAt) : '',
                filter.cinema ? '' : shortCinema(row.cinema),
                row.screen,
                row.capacity ? `${row.capacity} seats` : '',
                formats(row.experiences),
                row.soldOut ? 'sold out' : '',
              ].filter(Boolean).join(' · '),
            },
          };
        }),
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
      ['Film', inner(show.title, path('film', show.filmId))],
      ['When', `${day(show.startsAt)} at ${show.time}${show.soldOut ? ' · sold out' : ''}`],
      ...(show.filmStartsAt ? [['Film starts', `${TIME.format(new Date(show.filmStartsAt))}${show.filmEndsAt ? ', ends ' + TIME.format(new Date(show.filmEndsAt)) : ''}`] as [string, string]] : []),
      ['Cinema', inner(`ODEON ${show.cinema}`, path('cinema', show.cinemaId))],
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
    case '': return welcomeView();
    case 'browse': return menuView();
    case 'films': return filmsView();
    case 'hidden': return hiddenView();
    case 'settings': return settingsView();
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
      if (film && b === 'all') return showingsView(film.title, { film: a });
      const cinema = cinemaName(b);
      if (!film || !cinema) return missing('That film is no longer showing there.');
      return showingsView(`${film.title} · ${shortCinema(cinema)}`, { film: a, cinema: b }, scope([]));
    }
    default: return missing('There is no such page.');
  }
}

// ---- Rendering and keys -------------------------------------------------

const route = () => readPage(location.hash).route;
let current: {
  trail: string[]; route: string; view: View; ui: Ui; table: Table;
  /** Where the rows are drawn, and how one is made, so that more can be added. */
  body?: HTMLElement; make?: (row: Row, index: number) => Node;
};

/** The sort, search, page and highlighted row go in the address too, so that a
 *  bookmark, a link or going back returns to exactly this. They are written
 *  after a short pause, because browsers limit how often an address may change. */
let noting = 0;
function note() {
  clearTimeout(noting);
  noting = window.setTimeout(noteNow, 300);
}
function noteNow() {
  clearTimeout(noting);
  if (!current || current.route !== route()) return;
  const hash = writePage(current.route, current.ui, current.trail);
  if (hash !== (location.hash || '#/')) history.replaceState(null, '', location.pathname + location.search + hash);
}

function go(target: string) {
  noteNow(); // so that going back finds this page as it was left
  // The welcome page stands alone; every other page opens alongside in the columns view.
  location.hash = columns() && current.route ? writePage(target, PLAIN, here()) : '#/' + target;
}
/** A link to another page here; in the columns view it opens alongside. */
function inner(label: string, target: string): HTMLElement {
  const anchor = link(label, '#/' + target);
  anchor.onclick = (event) => { event.preventDefault(); go(target); };
  return anchor;
}
function back() {
  if (columns()) {
    if (current.route) location.hash = '#/' + current.trail.join('|'); // from the first column, the welcome page
    return;
  }
  if (!route()) return;
  if (history.length > 1) history.back();
  else go('');
}

// ---- The columns view: pages side by side, as in Finder's column view ----
// The pages that led here stay on screen to the left, and the highlighted
// row's page shows to the right before it is opened. The address lists them.

/** Columns unless the visitor asked for pages, or the screen is a phone's. */
const columns = () => !layout.has('pages') && !narrow.matches;
/** The trail a deeper page would have: this page's, and this page as it stands. */
const here = () => [...current.trail, writePage(current.route, current.ui).slice(2)];

/** One row as a card: how a phone, and each column, shows it. */
function cardItem(columns: Column[], row: Row, index: number, selected: number, pick: (index: number) => void, box?: (row: Row, index: number) => Node): HTMLElement {
  const shown = row.card ?? {
    title: String(row.cells[0] ?? '–'),
    meta: row.cells.slice(1).map((cell, offset) => {
      const column = columns[offset + 1];
      if (cell === null || cell === '') return '';
      const noun = column.label.toLowerCase();
      return column.right ? `${cell} ${cell === 1 ? noun.replace(/s$/, '') : noun}` : String(cell);
    }).filter(Boolean).join(' · '),
  };
  const card = h('li', { class: [index === selected ? 'selected' : '', row.sold ? 'sold' : '', row.pinned ? 'pinned' : ''].join(' ') },
    ...(row.tick ? [box ? box(row, index) : h('span', { class: 'tick' }, BOXES[row.tick.state])] : []),
    h('span', { class: 'text' }, h('strong', {}, shown.title), ...(shown.meta ? [h('span', { class: 'dim' }, shown.meta)] : [])),
    ...(row.open ? [h('span', { class: 'go dim' }, '›')] : []));
  card.onclick = () => pick(index);
  return card;
}
/** A row's card, under the day's heading when it begins a day. */
function cardNodes(...card: Parameters<typeof cardItem>): Node[] {
  const day = card[1].day;
  return [...(day ? [h('li', { class: 'day' }, day)] : []), cardItem(...card)];
}
function cardList(table: Table, selected: number, pick: (index: number) => void): HTMLElement {
  return h('ul', { class: 'cards' }, ...table.rows.flatMap((row, index) => cardNodes(table.columns, row, index, selected, pick)));
}
/** A column's heading line: its title, then whatever goes beside it. */
const bar = (title: string, ...beside: Node[]) => h('div', { class: 'bar' }, h('h2', { title }, title), ...beside);
const tally = (table: Table) => (table.columns.length ? [h('span', { class: 'dim' }, table.total.toLocaleString('en-GB'))] : []);

/** A page that led here: its list, with the row that was followed highlighted. */
function passed(segment: string, index: number, trail: string[]): HTMLElement {
  const { route: place, ui } = readPage('#/' + segment);
  const view = viewFor(place);
  const table = view.table(ui);
  const list = cardList(table, ui.selected, (row) => {
    location.hash = writePage(place, { ...ui, selected: row }, trail.slice(0, index));
  });
  return h('div', { class: 'column' }, bar(view.title, ...tally(table)), ...(table.columns.length ? [list] : []), ...(view.intro ? [view.intro] : []));
}

/** Show the highlighted row's page in the last column, before it is opened. */
function preview() {
  const box = app.querySelector('.preview');
  if (!box) return;
  const row = selectedRow();
  if (!row?.open) return box.replaceChildren();
  const target = row.open;
  if (!whole && needsEveryCinema(target, ticks)) {
    // Its listings are not downloaded yet; opening it fetches them.
    return box.replaceChildren(bar(String(row.cells[0] ?? '')), h('p', { class: 'dim' }, 'Press → to open.'));
  }
  const view = viewFor(target);
  const table = view.table({ ...PLAIN });
  const shown = { ...table, rows: table.rows.slice(0, 50) };
  box.replaceChildren(
    bar(view.title, ...tally(table)),
    ...(table.columns.length ? [cardList(shown, -1, (index) => {
      noteNow();
      location.hash = writePage(target, { ...PLAIN, selected: index }, here());
    })] : []),
    ...(table.total > shown.rows.length ? [h('p', { class: 'dim' }, `and ${count(table.total - shown.rows.length, 'more row')}`)] : []),
    ...(view.intro ? [view.intro] : []),
  );
}
function switchLayout() {
  noteNow();
  toggle(layout, ['pages']);
  render();
}

/** Build the page for a route. The search box lives here so that typing in it
 *  never replaces it; paint() then redraws only what a keystroke changes. */
function render() {
  address(); // going back can land on an address from before a choice changed
  const { trail: led, route: key, ui } = readPage(location.hash);
  const side = columns() && key !== '';
  // The first column is always the menu, however this address was reached.
  const trail = side && readPage('#/' + (led[0] ?? key)).route !== 'browse' ? ['browse', ...led] : led;
  if (!whole && [...(side ? trail : []).map((segment) => readPage('#/' + segment).route), key].some((place) => needsEveryCinema(place, ticks))) {
    // This page is about more than Greater London: fetch the rest, then show it.
    app.querySelector('.status')?.replaceChildren('loading every cinema…');
    everything ??= load(true);
    return;
  }
  if (!db) return; // still downloading; load() draws the page when it arrives
  const view = viewFor(key);
  document.title = key ? `${view.title} · ODEON` : 'ODEON';
  const search = h('input', { type: 'search', placeholder: side ? 'Search' : 'Search this table', 'aria-label': 'Search this table' }) as HTMLInputElement;
  search.value = ui.text;
  search.oninput = () => {
    ui.text = search.value; ui.page = 0; ui.selected = 0;
    paint();
    // Highlight the first match, not the All row above it, so that Enter opens what was searched for.
    if (ui.text && current.table.rows[0]?.pinned && current.table.rows.length > 1) move(1);
  };
  const stamp = db.ingested;
  const hints = ['↑↓ move', 'Enter open', 'Esc back', '/ search', 's sort', 'Space tick', 'h hide film', 't trailer', 'b book', 'c calendar', 'v columns'];
  const old = stamp !== null && Date.now() - Date.parse(stamp) > 8 * 86400000;
  const tools = h('div', { class: 'tools' }, search, h('span', { class: 'sorter' }), h('span', { class: 'pager' }));
  const list = h('div', { class: 'scroll' });
  // A column is its heading line, with the search and sort in it, then its list, then any details.
  const parts = side
    ? [bar(view.title, tools), list, ...(view.intro ? [view.intro] : [])]
    : narrow.matches
      ? [tools, list, ...(view.intro ? [view.intro] : [])] // on a phone the list comes first
      : [...(view.intro ? [view.intro] : []), tools, list];
  app.classList.toggle('side', side);
  app.replaceChildren(
    h('header', {},
      // Columns show where you are; pages need a way back and a way to the menu.
      ...(key && !side ? [button('← Back', back), ...(key === 'browse' ? [] : [inner('Menu', 'browse')])] : []),
      h('h1', {}, link('ODEON', '#/'), h('span', {}, ' — ' + view.title))),
    ...(side
      ? [h('div', { class: 'columns' },
          ...trail.map(passed),
          h('div', { class: 'column focused' }, ...parts),
          h('div', { class: 'column preview' }))]
      : parts),
    h('footer', {},
      h('span', { class: 'keys' }, ...hints.flatMap((hint) => {
        const [keys, ...words] = hint.split(' ');
        return [h('kbd', {}, keys), ` ${words.join(' ')}   `];
      })),
      h('span', { class: 'status' },
        `listings from ${stamp ? day(stamp) : 'no ingest yet'}`,
        ...(db.fullUntil ? [` · full to ${day(db.fullUntil)}`] : []),
        ...(old ? [h('span', { class: 'stale' }, ' · more than a week old')] : []))),
  );
  current = { trail: side ? trail : [], route: key, view, ui, table: { columns: [], rows: [], total: 0 } };
  paint();
  window.scrollTo(0, 0);
  const strip = app.querySelector('.columns');
  if (!ui.selected) app.querySelector('.focused')?.scrollTo(0, 0); // start a column at its top, above its details
  for (const followed of app.querySelectorAll('.column:not(.focused) .selected')) followed.scrollIntoView({ block: 'center' });
  if (strip) strip.scrollLeft = strip.scrollWidth; // keep the newest columns in view
}

const BOXES = { all: '[x]', some: '[-]', none: '[ ]' };

/** Draws more rows while the end of the list is in, or close to, view. */
function fill() {
  const near = () => {
    const rest = app.querySelector('.rest');
    return rest !== null && rest.getBoundingClientRect().top < innerHeight + 600;
  };
  while (current && near() && more());
}
// Scrolling does not bubble, so listen on the way down: the page or a column may be what scrolls.
document.addEventListener('scroll', fill, { capture: true, passive: true });
const complete = (table: Table) => table.rows.length - (table.rows[0]?.pinned ? 1 : 0) >= table.total;

/** Add the next batch of rows to the list. False when there are no more. */
function more(): boolean {
  const { view, ui, table, body, make } = current;
  if (!body || !make || complete(table)) return false;
  ui.page += 1;
  const next = view.table(ui);
  body.append(...next.rows.slice(table.rows.length).map((row, offset) => make(row, table.rows.length + offset)));
  current.table = next;
  if (complete(next)) app.querySelector('.rest')?.remove();
  return true;
}

function paint() {
  const { view, ui } = current;
  const table = view.table(ui);
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
  let body: HTMLElement;
  let make: (row: Row, index: number) => Node;
  if (narrow.matches || columns()) {
    // Phones: one card a row, the whole card a tap target that opens it.
    // Columns: a click highlights, which shows the row's page alongside.
    const pick = narrow.matches ? (index: number) => { ui.selected = index; open(); } : (index: number) => move(index - ui.selected);
    make = (row, index) => {
      const nodes = document.createDocumentFragment();
      nodes.append(...cardNodes(table.columns, row, index, ui.selected, pick, (boxed, at) => tickBox(boxed, at, 'span')));
      return nodes;
    };
    list = body = h('ul', { class: 'cards' });
  } else {
    const head = h('tr', {}, ...(ticking ? [h('th', {})] : []), ...table.columns.map((column, index) => {
      const sorted = ui.order === index;
      const th = h('th', { class: [sortable.includes(index) ? 'sortable' : '', column.right ? 'right' : '', column.wide ? 'wide' : '', sorted ? 'sorted' : ''].join(' ') },
        column.label + (sorted ? (ui.descending ? ' ▼' : ' ▲') : ''));
      th.onclick = () => sortBy(index);
      return th;
    }));
    make = (row, index) => {
      const tr = h('tr', { class: [index === ui.selected ? 'selected' : '', row.pinned ? 'pinned' : ''].join(' ') },
        ...(ticking ? [row.tick ? tickBox(row, index, 'td') : h('td', {})] : []),
        ...row.cells.map((cell, column) => {
          const spec = table.columns[column];
          return h('td', { class: [spec.right ? 'right' : '', spec.wide ? 'wide' : '', spec.wrap ? 'wrap' : '', row.sold ? 'sold' : ''].join(' ') },
            cell === null || cell === '' ? '–' : String(cell));
        }));
      tr.onclick = () => { ui.selected = index; open(); };
      return tr;
    };
    body = h('tbody', {});
    list = h('table', {}, h('thead', {}, head), body);
  }
  body.append(...table.rows.map(make));
  current.body = body;
  current.make = make;

  // Sorting without a keyboard or headings: a menu of the sortable columns.
  const sorter = h('select', { 'aria-label': 'Sort by' }, h('option', { value: '' }, 'Sort…'),
    ...sortable.map((index) => h('option', { value: String(index) }, table.columns[index].label))) as HTMLSelectElement;
  sorter.value = ui.order === null ? '' : String(ui.order);
  sorter.onchange = () => { if (sorter.value) sortBy(Number(sorter.value), false); };
  const flip = button(ui.descending ? '▼' : '▲', () => { if (ui.order !== null) sortBy(ui.order); });
  flip.setAttribute('aria-label', 'Reverse the order');
  app.querySelector('.sorter')!.replaceChildren(...(sortable.length ? [sorter, flip] : []));

  app.querySelector<HTMLElement>('.tools')!.hidden = !table.columns.length || Boolean(view.plain);
  app.querySelector('.pager')!.replaceChildren(
    h('span', { class: 'dim' }, columns() ? table.total.toLocaleString('en-GB') : count(table.total, 'row')));
  const rest = complete(table) ? null : h('p', { class: 'rest dim' }, 'more…');
  app.querySelector('.scroll')!.replaceChildren(...(table.columns.length ? [
    list,
    ...(table.rows.length ? [] : [h('p', { class: 'empty' }, ticks.size ? 'Nothing here for your ticked cinemas.' : 'Nothing here.')]),
    ...(rest ? [rest] : []),
  ] : []));
  if (!narrow.matches) list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  note();
  preview();
  fill();
}

function move(step: number) {
  // Only the highlight moves: no query, and nothing is rebuilt.
  const { ui } = current;
  // Moving past the last row drawn draws the next batch first.
  while (Number.isFinite(step) && ui.selected + step > current.table.rows.length - 1 && more());
  const items = app.querySelectorAll('.scroll tbody tr, .scroll .cards li:not(.day)');
  items[ui.selected]?.classList.remove('selected');
  ui.selected = Math.max(0, Math.min(current.table.rows.length - 1, ui.selected + step));
  items[ui.selected]?.classList.add('selected');
  if (!narrow.matches) items[ui.selected]?.scrollIntoView({ block: 'nearest' });
  note();
  preview();
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
  else if (row?.tick) tick(); // a setting: opening it switches it
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
    ' ': tick, s: nextSort, v: switchLayout,
    t: () => (['.focused', '.preview', '#app'].map((where) => document.querySelector<HTMLElement>(`${where} .trailer button`)).find(Boolean))?.click(),
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
narrow.addEventListener('change', () => { if (current) render(); });

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
