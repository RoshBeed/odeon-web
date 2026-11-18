// The site is one finder: columns of choices side by side, each counting what the
// others leave, then the showtimes that match, then the highlighted one's details.
// The visitor picks which columns to show and in what order, and all of it is in
// the page's address, so a bookmark is a saved view. Driven by keys, clicks or taps.
import { ics } from './calendar';
import { DEFAULT_COLUMNS, needsEveryCinema, PAGE, readChoice, readView, writeChoices, writeView, type Order, type View } from './choices';
import { openListings } from './db';
import * as q from './queries';
import { certificateAge, formats, LONDON, place, shortCinema, tagLabel } from './tags';

const BOOKING = 'https://www.odeon.co.uk/ticketing/seat-picker/?showtimeId=';

let db: q.Listings;
/** Whether `db` holds every cinema's showings, or only Greater London's. */
let whole = false;
let everything: Promise<void> | undefined;
const app = document.getElementById('app')!;
const narrow = matchMedia('(max-width: 640px)');

// ---- What is shown at all, kept in the query string ------------------------

const ticks = readChoice(location.search, 'cinemas');
const hidden = readChoice(location.search, 'hidden');
/** What the visitor has asked to see that is otherwise left out: `events`. */
const extras = readChoice(location.search, 'show');
function address() {
  const search = writeChoices({ cinemas: ticks, hidden, show: extras });
  if (search !== location.search) history.replaceState(null, '', location.pathname + search + location.hash);
}
function toggle(set: Set<string>, ids: string[], on?: boolean) {
  for (const id of ids) {
    if (on ?? !set.has(id)) set.add(id);
    else set.delete(id);
  }
  address();
}
/** Whether the ticked cinemas are Greater London's, no more and no fewer. */
const londonOnly = () => ticks.size === LONDON.size && [...LONDON].every((id) => ticks.has(id));

function scope(): q.Scope {
  return {
    cinemas: [...ticks],
    hidden: [...hidden],
    noEvents: !extras.has('events'),
    now: new Date().toISOString().slice(0, 19) + 'Z',
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()),
  };
}

// ---- Dates and small helpers ----------------------------------------------

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Europe/London' });
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
/** `Mon 16 Nov` for a stored time or a plain date. */
function day(value: string | null): string {
  if (!value) return '–';
  return DAY.format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value)).replace(',', '');
}
const fullDate = (value: string | null) => (value ? DAY_YEAR.format(new Date(value + 'T12:00:00Z')) : '–');
const clock = (value: string | null) => (value ? TIME.format(new Date(value)) : '');

function h(tag: string, props: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}
function button(label: string, act: () => void, props: Record<string, string> = {}): HTMLButtonElement {
  const element = h('button', { type: 'button', ...props }, label) as HTMLButtonElement;
  element.onclick = act;
  return element;
}
function checkbox(label: string | Node, checked: boolean, change: (on: boolean) => void, mixed = false): HTMLElement {
  const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
  box.checked = checked;
  box.indeterminate = mixed;
  box.onchange = () => change(box.checked);
  return h('label', { class: 'check' }, box, label);
}
const link = (label: string, href: string) => h('a', { href, target: '_blank', rel: 'noopener' }, label);
const count = (n: number, noun: string) => `${n.toLocaleString('en-GB')} ${noun}${n === 1 ? '' : 's'}`;
const facts = (pairs: [string, Node | string][]) =>
  h('dl', {}, ...pairs.flatMap(([name, value]) => [h('dt', {}, name), h('dd', {}, value)]));
const bar = (title: string, ...beside: Node[]) => h('div', { class: 'bar' }, h('h2', { title }, title), ...beside);

function addToCalendar(cinema: string, id: string) {
  const show = q.showing(db, cinema, id);
  if (!show) return;
  const address = URL.createObjectURL(new Blob([ics(show)], { type: 'text/calendar' }));
  const anchor = h('a', { href: address, download: `${show.title.replace(/[^\w]+/g, '-')}.ics` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(address), 1000);
}

// ---- The kinds of column ----------------------------------------------------

interface Kind {
  title: string;
  /** What it lets a visitor choose by, for the columns panel. */
  about: string;
  /** How a choice reads, and a note beside its count. */
  label(value: string): [name: string, note: string];
  /** The column's own order. */
  natural(values: string[], counts: Map<string, number>): string[];
}
const alphabetical = (kind: () => Kind) => (values: string[]) =>
  [...values].sort((a, b) => kind().label(a)[0].toLowerCase().localeCompare(kind().label(b)[0].toLowerCase()));
const busiest = (values: string[], counts: Map<string, number>) => [...values].sort((a, b) => counts.get(b)! - counts.get(a)!);
const plain = (value: string): [string, string] => [value, ''];
const tag = (value: string): [string, string] => [tagLabel(value), ''];
const cinemaNames = () => new Map(db.cinemas.map((cinema) => [cinema.id, cinema.name]));
let names = new Map<string, string>();

const KINDS: Record<q.Facet, Kind> = {
  day: {
    title: 'Day', about: 'today, this weekend or any date',
    label: (value) => (value === 'weekend' ? ['This weekend', ''] : [value === scope().today ? 'Today' : day(value), '']),
    natural: (values) => {
      const dates = values.filter((value) => value !== 'weekend').sort();
      if (values.includes('weekend')) dates.splice(dates[0] === scope().today ? 1 : 0, 0, 'weekend');
      return dates;
    },
  },
  film: {
    title: 'Film', about: 'every film, with its IMDb rating',
    label: (value) => {
      const film = q.film(db, value);
      return [film?.title ?? value, film?.imdb ? `★${film.imdb.toFixed(1)}` : ''];
    },
    natural: alphabetical(() => KINDS.film),
  },
  cinema: { title: 'Cinema', about: 'each ODEON', label: (value) => [shortCinema(names.get(value) ?? value), ''], natural: alphabetical(() => KINDS.cinema) },
  location: { title: 'Location', about: 'towns and cities, and Greater London', label: plain, natural: alphabetical(() => KINDS.location) },
  picture: { title: 'Picture', about: 'IMAX, Dolby, 3D, Laser and the like', label: tag, natural: busiest },
  language: { title: 'Language', about: 'subtitles, captions and the language spoken', label: tag, natural: busiest },
  access: { title: 'Accessibility', about: 'audio description, wheelchair access and more', label: tag, natural: busiest },
  event: { title: 'Events', about: 'Kids, Newbies, Silver and other specials', label: tag, natural: busiest },
  seat: { title: 'Seating', about: 'recliners, Luxe, VIP beds and the like', label: plain, natural: busiest },
  screen: {
    title: 'Screen', about: 'each screen, biggest first',
    label: (key) => {
      const screen = q.screenOf(db, key);
      if (!screen) return [key, ''];
      // The screen first, so that a narrow column cuts the cinema's name, not the screen's.
      return [`${screen.screen.replace(/^Screen /, '#')} ${shortCinema(screen.cinema)}`, screen.capacity ? `${screen.capacity} seats` : ''];
    },
    natural: (values) => [...values].sort((a, b) => (q.screenOf(db, b)?.capacity ?? -1) - (q.screenOf(db, a)?.capacity ?? -1)),
  },
  cert: {
    title: 'Certificate', about: 'U, PG, 12A, 15, 18',
    label: plain, natural: (values) => [...values].sort((a, b) => (certificateAge(a) ?? 99) - (certificateAge(b) ?? 99) || a.localeCompare(b)),
  },
  genre: { title: 'Genre', about: 'drama, comedy, animation…', label: plain, natural: alphabetical(() => KINDS.genre) },
  person: { title: 'People', about: 'directors and cast', label: plain, natural: busiest },
  distributor: { title: 'Distributor', about: 'the studio that releases the film', label: plain, natural: alphabetical(() => KINDS.distributor) },
  release: {
    title: 'Release', about: 'out now, or opening soon',
    label: (value) => [value === 'soon' ? 'Opening soon' : 'Out now', ''],
    natural: (values) => ['out', 'soon'].filter((value) => values.includes(value)),
  },
};
const ORDERS: Record<Order, string> = { name: 'A–Z', count: 'most', rating: '★' };
function ordered(facet: q.Facet, values: string[], counts: Map<string, number>, order: Order): string[] {
  if (order === 'count') return busiest(values, counts);
  if (order === 'rating') return [...values].sort((a, b) => (q.film(db, b)?.imdb ?? -1) - (q.film(db, a)?.imdb ?? -1));
  return KINDS[facet].natural(values, counts);
}
const ordersOf = (facet: q.Facet): Order[] => (facet === 'film' ? ['name', 'count', 'rating'] : ['name', 'count']);

// ---- The finder ---------------------------------------------------------------

let view: View;
/** The page as drawn: what the keys act on. */
let page: {
  options: (string | undefined)[][];
  rows: q.Showing[];
  total: number;
  /** Extra batches of showtimes drawn. */
  more: number;
  /** Text typed into each column's search, which is not kept in the address. */
  filters: string[];
  draw(): void;
  mark(): void;
  focusSearch(): void;
} | undefined;
/** The address last drawn; a change from elsewhere (going back, an edited address) draws again. */
let drawn = '';
let noting = 0;
/** Put the view in the address after a short pause: browsers limit how often an address may change. */
function note() {
  clearTimeout(noting);
  noting = window.setTimeout(noteNow, 300);
}
function noteNow() {
  clearTimeout(noting);
  const hash = writeView(view);
  if (hash !== location.hash) history.replaceState(null, '', location.pathname + location.search + hash);
  drawn = location.hash;
}
/** Change the columns themselves, then draw the finder again. */
function rebuild() {
  noteNow();
  render();
}

const lastColumn = () => view.columns.length + (narrow.matches ? 1 : 0); // a phone shows the details as a column of their own

function render() {
  address();
  drawn = location.hash;
  if (!whole && needsEveryCinema(ticks)) {
    app.querySelector('.status')?.replaceChildren('loading every cinema…');
    everything ??= load(true);
    return;
  }
  if (!db) return; // still downloading; load() draws the page when it arrives
  names = cinemaNames();
  view = readView(location.hash);
  view.focus = Math.min(view.focus, lastColumn());
  const columns = view.columns;
  const results = columns.length;
  const details = results + 1;
  const filters = page?.filters.length === columns.length + 1 ? page.filters : columns.map(() => '').concat(view.text);
  filters[results] = view.text;

  const searches = [...columns, 'showtimes'].map((_, index) => {
    const input = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search this column' }) as HTMLInputElement;
    input.value = filters[index];
    input.oninput = () => {
      filters[index] = input.value;
      view.focus = index;
      if (index === results) { view.text = input.value; view.row = 0; state.more = 0; }
      draw();
    };
    return input;
  });
  /** A column's search box, and the button that opens it. */
  const finding = (index: number) => [searches[index], button('⌕', () => { view.focus = index; mark(); searches[index].focus(); }, { class: 'find', 'aria-label': 'Search this column' })];
  const sorters = columns.map((facet) => button(ORDERS[view.orders[facet] ?? 'name'], () => cycle(facet), { title: 'Order this column', class: 'order' }));
  const sortShowtimes = h('select', { 'aria-label': 'Order the showtimes' },
    ...Object.entries({ date: 'Date', time: 'Time', film: 'Film', cinema: 'Cinema', screen: 'Screen', seats: 'Seats' })
      .map(([value, label]) => h('option', { value }, label))) as HTMLSelectElement;
  sortShowtimes.value = view.sort;
  sortShowtimes.onchange = () => { view.sort = sortShowtimes.value; view.row = 0; state.more = 0; draw(); };
  const flip = button(view.descending ? '▼' : '▲', () => { view.descending = !view.descending; view.row = 0; state.more = 0; draw(); }, { 'aria-label': 'Reverse the order' });

  const lists = columns.map(() => h('ul', { class: 'facet' }));
  const shows = h('ul', { class: 'cards' });
  const total = h('span', { class: 'dim count' });
  const detail = h('div', { class: 'column details' });
  const panes = [
    ...columns.map((facet, index) => h('div', { class: `column ${facet}` }, bar(KINDS[facet].title, ...finding(index), sorters[index]), lists[index])),
    h('div', { class: 'column showtimes' }, bar('Showtimes', ...finding(results), sortShowtimes, flip, total), shows),
    detail,
  ];
  panes[results].addEventListener('scroll', () => {
    const column = panes[results];
    if (state.rows.length < state.total && column.scrollTop + column.clientHeight > column.scrollHeight - 600) { state.more += 1; draw(); }
  }, { passive: true });
  // On a phone one column shows at a time; these steps name each, with what is chosen in it.
  const steps = h('nav', { class: 'steps' });

  document.title = 'ODEON showtimes';
  app.className = 'finder-page';
  app.replaceChildren(
    h('header', {},
      h('h1', {}, h('a', { href: '#/' }, 'ODEON'), h('span', {}, ' showtimes')),
      button('Columns & settings', openPanel, { class: 'open-panel', 'aria-keyshortcuts': 'o' }),
      checkbox(' London only', londonOnly(), () => flipLondon())),
    steps,
    h('div', { class: 'columns finder' }, ...panes),
    footer(['←→ column', '↑↓ choose', 'Esc all', '/ search', 's order', '[ ] move column', 'x hide column', 'o columns',
      'h hide film', 't trailer', 'b book', 'c calendar', 'l London only']),
  );

  const state = {
    options: [] as (string | undefined)[][],
    rows: [] as q.Showing[],
    total: 0,
    more: Math.floor(view.row / PAGE),
    filters,
    draw,
    mark,
    focusSearch: () => searches[Math.min(view.focus, results)].focus(),
  };
  page = state;

  function cycle(facet: q.Facet) {
    const orders = ordersOf(facet);
    const next = orders[(orders.indexOf(view.orders[facet] ?? 'name') + 1) % orders.length];
    if (next === 'name') delete view.orders[facet];
    else view.orders[facet] = next;
    sorters[columns.indexOf(facet)].textContent = ORDERS[next];
    draw();
  }

  function draw() {
    const found = q.find(db, scope(), columns, view.picks, view.text);
    state.options = columns.map((facet, index) => {
      const counted = found.counts[index];
      const order = view.orders[facet] ?? 'name';
      let values = ordered(facet, [...counted.keys()], counted, order);
      const picked = view.picks[facet];
      if (picked && !values.includes(picked)) values.unshift(picked); // a choice the others have emptied stays in view
      const needle = filters[index].toLowerCase();
      if (needle) values = values.filter((value) => value === picked || KINDS[facet].label(value)[0].toLowerCase().includes(needle));
      // Days past the published week are set apart, once, instead of each saying so.
      const advance = facet === 'day' && order === 'name' && db.fullUntil ? values.find((value) => value !== 'weekend' && value > db.fullUntil!) : undefined;
      const all = [undefined, ...values];
      lists[index].replaceChildren(...all.flatMap((value) => {
        const [name, note] = value === undefined ? ['All', ''] : KINDS[facet].label(value);
        const item = h('li', { class: [value === picked ? 'selected' : '', value === undefined ? 'pinned' : ''].join(' '), title: name },
          h('strong', {}, name),
          ...(note ? [h('span', { class: 'dim' }, note)] : []),
          h('span', { class: 'dim count' }, value === undefined ? '' : (counted.get(value) ?? 0).toLocaleString('en-GB')));
        item.onclick = () => {
          view.focus = index;
          choose(facet, value);
          if (narrow.matches) { view.focus = index + 1; mark(); } // on a phone any choice, All too, moves on
        };
        return value !== undefined && value === advance ? [h('li', { class: 'note' }, 'advance bookings only'), item] : [item];
      }));
      return all;
    });

    const arranged = q.arrange(found.shows, view.sort, view.descending, (state.more + 1) * PAGE);
    state.rows = arranged.rows;
    state.total = arranged.total;
    view.row = Math.min(view.row, Math.max(state.rows.length - 1, 0));
    total.textContent = state.total.toLocaleString('en-GB');
    // In date order the showtimes are headed day by day, unless one day is chosen.
    const oneDay = Boolean(view.picks.day && view.picks.day !== 'weekend');
    const headed = view.sort === 'date' && !view.descending && !oneDay;
    shows.replaceChildren(
      ...state.rows.flatMap((row, index) => {
        const ends = clock(row.endsAt);
        const item = h('li', { class: [index === view.row ? 'selected' : '', row.soldOut ? 'sold' : ''].join(' ') },
          h('strong', {}, view.picks.film ? (ends ? `${row.time}–${ends}` : row.time) : `${row.time}  ${row.title}`),
          h('span', { class: 'dim' }, [
            formats(row.experiences, ['Picture']),
            headed || oneDay ? '' : day(row.startsAt),
            view.picks.cinema ? row.screen.replace(/^Screen /, '#') : shortCinema(row.cinema),
            row.capacity ? String(row.capacity) : '',
            row.soldOut ? 'sold out' : '',
          ].filter(Boolean).join(' · ')));
        item.title = `${row.title} · ${day(row.startsAt)} ${row.time}${ends ? '–' + ends : ''} · ${row.cinema} · ${row.screen}${row.capacity ? ` · ${row.capacity} seats` : ''}`;
        item.onclick = () => { view.focus = narrow.matches ? details : results; view.row = index; mark(); };
        const heading = headed && row.date !== state.rows[index - 1]?.date
          ? [h('li', { class: 'day' }, day(row.date) + (db.fullUntil && row.date > db.fullUntil ? ' · advance bookings only so far' : ''))]
          : [];
        return [...heading, item];
      }),
      ...(state.total ? [] : [h('li', { class: 'day' }, ticks.size ? 'Nothing matches every column at your cinemas.' : 'Nothing matches every column.')]),
    );
    mark();
  }

  /** Mark the focused column and the highlighted showtime, and show its details. */
  function mark() {
    panes.forEach((pane, index) => pane.classList.toggle('focused', index === view.focus));
    shows.querySelector('.selected')?.classList.remove('selected');
    shows.querySelectorAll('li:not(.day)')[view.row]?.classList.add('selected');
    for (const pane of panes) pane.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    steps.replaceChildren(...[...columns, 'showtimes', 'details'].map((name, index) => {
      const facet = columns[index];
      const picked = facet && view.picks[facet];
      const label = facet ? `${KINDS[facet].title}: ${picked ? KINDS[facet].label(picked)[0] : 'All'}` : index === results ? `Showtimes ${state.total}` : 'Details';
      const step = button(label, () => { view.focus = index; mark(); }, { class: index === view.focus ? 'here' : '' });
      if (name === 'details' && !state.rows.length) step.disabled = true;
      return step;
    }));
    steps.querySelector('.here')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const shown = state.rows[view.row];
    const film = shown ? q.film(db, shown.filmId) : view.picks.film ? q.film(db, view.picks.film) : null;
    detail.replaceChildren(
      ...(shown ? showingDetails(shown) : film ? [bar(film.title)] : [bar('Details'), quickStart()]),
      ...(film ? filmDetails(film) : []),
    );
    note();
  }

  function choose(facet: q.Facet, value: string | undefined) {
    if (value === undefined) delete view.picks[facet];
    else view.picks[facet] = value;
    view.row = 0;
    state.more = 0;
    draw();
  }

  /** A double bill: choose its film (and keep the cinema and day), and highlight it. */
  function follow(next: q.Neighbour) {
    if (columns.includes('film')) view.picks.film = next.filmId;
    if (view.picks.day && view.picks.day !== next.date) view.picks.day = next.date;
    view.row = 0;
    state.more = 0;
    draw();
    const index = state.rows.findIndex((row) => row.cinemaId === next.cinemaId && row.id === next.id);
    if (index >= 0) { view.row = index; view.focus = narrow.matches ? details : results; mark(); }
  }

  /** The highlighted showtime: when, where, booking, and what else could make a double bill. */
  function showingDetails(row: q.Showing): Node[] {
    const show = q.showing(db, row.cinemaId, row.id);
    if (!show) return [];
    const where = [show.address.line1, show.address.line2, show.address.city].filter(Boolean).join(', ');
    const seats = [...new Set(show.seating.map((seat) => seat.replace(/ (Saver|Popular)$/, '')))];
    const optional = (name: string, value: string): [string, string][] => (value ? [[name, value]] : []);
    const near = q.around(db, { ...scope(), cinemas: [] }, show.cinemaId, show.id);
    const bill = (rows: q.Neighbour[], heading: string) => rows.length ? [
      h('li', { class: 'day' }, heading),
      ...rows.map((next) => {
        const item = h('li', {},
          h('strong', {}, `${next.time}–${clock(next.endsAt)}  ${next.title}`),
          h('span', { class: 'dim' }, `${next.gap} min gap · ${next.screen.replace(/^Screen /, '#')}${next.capacity ? ' · ' + next.capacity : ''}`));
        item.onclick = () => follow(next);
        return item;
      }),
    ] : [];
    return [
      bar(`${show.title} · ${show.time}`),
      h('div', { class: 'intro' },
        facts([
          ['When', `${day(show.startsAt)} at ${show.time}${show.soldOut ? ' · sold out' : ''}`],
          ...optional('Film runs', show.filmStartsAt ? `${clock(show.filmStartsAt)}${show.filmEndsAt ? '–' + clock(show.filmEndsAt) : ''}` : ''),
          ['Cinema', `ODEON ${show.cinema}`],
          ...optional('Address', where),
          ['Screen', `${show.screen}${show.capacity ? ` · ${show.capacity} seats` : ''}`],
          ...optional('Picture', formats(show.experiences, ['Picture'])),
          ...optional('Language', formats(show.experiences, ['Language'])),
          ...optional('Event', formats(show.experiences, ['Events'])),
          ...optional('Seating', seats.join(', ')),
          ...optional('Access', formats(show.experiences, ['Accessibility'])),
        ]),
        h('p', { class: 'actions' }, link('Book on odeon.co.uk', BOOKING + show.id), button('Add to calendar', () => addToCalendar(show.cinemaId, show.id)))),
      ...(near.after.length || near.before.length
        ? [h('ul', { class: 'cards bills' }, ...bill(near.after, 'Straight after this'), ...bill(near.before, 'Just before this'))]
        : []),
    ];
  }

  draw();
  for (const pane of panes) pane.querySelector('.selected')?.scrollIntoView({ block: 'center' });
}

/** What a film is: its facts, synopsis and trailer, and a way to hide it. */
function filmDetails(film: q.Film): Node[] {
  const named = (role: string) => film.people.filter((person) => person.roles.includes(role)).map((person) => person.name);
  const cast = named('Actor');
  const pairs: [string, Node | string][] = [
    ['Certificate', film.certificate || 'TBC'],
    ['Runtime', film.runtime ? `${film.runtime} minutes` : '–'],
    ['Released', fullDate(film.release)],
    ['Genres', film.genres.join(', ') || '–'],
  ];
  if (film.imdb !== null) pairs.push(['IMDb', film.imdbId ? link(`${film.imdb.toFixed(1)} / 10`, `https://www.imdb.com/title/${film.imdbId}/`) : `${film.imdb.toFixed(1)} / 10`]);
  if (film.metacritic !== null) pairs.push(['Metacritic', `${film.metacritic} / 100`]);
  if (named('Director').length) pairs.push(['Director', named('Director').join(', ')]);
  if (cast.length) pairs.push(['Cast', cast.slice(0, 6).join(', ') + (cast.length > 6 ? ` and ${cast.length - 6} more` : '')]);
  if (film.distributor) pairs.push(['Distributor', film.distributor]);
  return [h('div', { class: 'intro film' },
    h('h3', {}, film.title),
    facts(pairs),
    h('p', { class: 'dim' }, film.synopsis),
    ...(film.trailer ? [trailer(film.trailer)] : []),
    h('p', { class: 'actions' }, button(hidden.has(film.id) ? 'Show this film again' : 'Hide this film', () => hideFilm(film.id))),
  )];
}

/** The trailer, in place: a still that becomes the player when pressed. */
function trailer(address: string): Node {
  const id = /[?&]v=([\w-]{11})/.exec(address)?.[1];
  if (!id) return h('p', { class: 'actions' }, link('Watch the trailer', address));
  const frame = h('div', { class: 'trailer' });
  const still = button('', () => frame.replaceChildren(h('iframe', {
    src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`,
    title: 'Trailer',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowfullscreen: '',
  })), { 'aria-label': 'Play the trailer' });
  still.append(h('img', { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: '', loading: 'lazy' }), h('span', {}, '▶ Trailer'));
  frame.append(still);
  return frame;
}

function quickStart(): Node {
  return h('div', { class: 'intro' },
    h('p', {}, "What's on at ODEON, on which screen, and how big that screen is."),
    facts([
      ['Choose', 'a day, a film, a cinema… in any column; each counts what the others leave. Esc goes back to All.'],
      ['Columns', 'Columns & settings (o) adds or removes columns, and orders them; [ and ] move the one you are in.'],
      ['Bookmark', 'the columns, your choices and your cinemas are all in the page address. Bookmark it and it opens the same way anywhere.'],
    ]));
}

function hideFilm(id: string) {
  toggle(hidden, [id]);
  if (view.picks.film === id) delete view.picks.film;
  page?.draw();
}
function flipLondon() {
  const on = !londonOnly();
  ticks.clear();
  toggle(ticks, on ? [...LONDON] : [], true);
  rebuild();
  if (panel.open) fillPanel();
}

/** The line at the foot of the page: the keys, and how fresh the listings are. */
function footer(hints: string[]): HTMLElement {
  const stamp = db.ingested;
  const old = stamp !== null && Date.now() - Date.parse(stamp) > 8 * 86400000;
  return h('footer', {},
    h('span', { class: 'keys' }, ...hints.flatMap((hint) => {
      const [keys, ...words] = hint.split(' ');
      const shown = keys === '[' ? '[ ]' : keys;
      return [h('kbd', {}, shown), ` ${words.filter((word) => word !== ']').join(' ')}   `];
    })),
    h('span', { class: 'status' },
      `listings from ${stamp ? day(stamp) : 'no ingest yet'}`,
      ...(db.fullUntil ? [` · full to ${day(db.fullUntil)}`] : []),
      ...(old ? [h('span', { class: 'stale' }, ' · more than a week old')] : [])));
}

// ---- Columns & settings ----------------------------------------------------------

const panel = h('dialog', { class: 'panel', 'aria-label': 'Columns and settings' }) as HTMLDialogElement;
document.body.append(panel);
panel.addEventListener('click', (event) => { if (event.target === panel) panel.close(); }); // a click outside it

function openPanel() {
  noteNow();
  fillPanel();
  panel.showModal();
}

function fillPanel() {
  const scrolled = panel.scrollTop;
  const shown = view.columns;
  const move = (facet: q.Facet, step: number) => {
    const at = shown.indexOf(facet);
    const to = at + step;
    if (to < 0 || to >= shown.length) return;
    [shown[at], shown[to]] = [shown[to], shown[at]];
    rebuild();
    fillPanel();
  };
  const columnRows = [...shown, ...q.FACETS.filter((facet) => !shown.includes(facet))].map((facet) => {
    const on = shown.includes(facet);
    return h('li', {},
      checkbox(h('span', {}, h('strong', {}, ` ${KINDS[facet].title}`), h('span', { class: 'dim' }, ` ${KINDS[facet].about}`)), on, (now) => {
        if (now) shown.push(facet);
        else { shown.splice(shown.indexOf(facet), 1); delete view.picks[facet]; }
        view.focus = 0;
        rebuild();
        fillPanel();
      }),
      ...(on ? [
        button('←', () => move(facet, -1), { 'aria-label': `Move ${KINDS[facet].title} left` }),
        button('→', () => move(facet, 1), { 'aria-label': `Move ${KINDS[facet].title} right` }),
      ] : []));
  });

  const groups = new Map<string, { id: string; name: string }[]>();
  for (const cinema of db.cinemas.filter((item) => item.stored)) {
    const where = place({ id: cinema.id, name: cinema.name, city: cinema.address.city ?? '' });
    groups.set(where, [...(groups.get(where) ?? []), cinema]);
  }
  const cinemaRows = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([where, cinemas]) => {
    const ids = cinemas.map((cinema) => cinema.id);
    const ticked = ids.filter((id) => ticks.has(id)).length;
    const change = (list: string[], on: boolean) => { toggle(ticks, list, on); rebuild(); fillPanel(); };
    return h('li', {},
      checkbox(h('strong', {}, ` ${where}`), ticked === ids.length, (on) => change(ids, on), ticked > 0 && ticked < ids.length),
      ...(cinemas.length > 1 || cinemas[0].name !== where
        ? [h('ul', {}, ...cinemas.sort((a, b) => a.name.localeCompare(b.name)).map((cinema) =>
            h('li', {}, checkbox(` ${shortCinema(cinema.name)}`, ticks.has(cinema.id), (on) => change([cinema.id], on)))))]
        : []));
  });

  const copied = h('span', { class: 'dim' });
  panel.replaceChildren(
    h('div', { class: 'panel-head' }, h('h2', {}, 'Columns & settings'), button('Close', () => panel.close())),
    h('p', { class: 'dim' }, 'Everything here is part of the page address; nothing is saved in the browser. Set it up, then bookmark the page.'),
    h('p', { class: 'actions' },
      button('Copy the address', () => {
        noteNow();
        navigator.clipboard.writeText(location.href).then(() => copied.replaceChildren('Copied.'), () => copied.replaceChildren('Could not copy; use the address bar.'));
      }),
      button('Default columns', () => { view.columns = [...DEFAULT_COLUMNS]; view.picks = {}; view.orders = {}; view.focus = 0; rebuild(); fillPanel(); }),
      copied),
    h('h3', {}, 'Columns'),
    h('p', { class: 'dim' }, 'Tick the columns to show, and order them with the arrows. In the finder, [ and ] move the column you are in, and x hides it.'),
    h('ul', { class: 'choices' }, ...columnRows),
    h('h3', {}, 'Showing'),
    h('ul', { class: 'choices' },
      h('li', {}, checkbox(' London only: the cinemas in Greater London', londonOnly(), () => flipLondon())),
      h('li', {}, checkbox(' Event cinema: concerts, theatre and other specials not in Limitless', extras.has('events'), () => {
        toggle(extras, ['events']);
        rebuild();
        fillPanel();
      }))),
    h('h3', {}, 'Hidden films'),
    hidden.size
      ? h('ul', { class: 'choices' }, ...q.titles(db, [...hidden]).map((film) => h('li', {}, button('Show again', () => { hideFilm(film.id); fillPanel(); }), ` ${film.title}`)))
      : h('p', { class: 'dim' }, 'None. Press h on a film or showtime to hide that film everywhere.'),
    h('h3', {}, 'Your cinemas'),
    h('p', { class: 'dim' }, ticks.size ? `${count(ticks.size, 'cinema')} ticked: everything shows only those. ` : 'None ticked: every cinema is shown. Tick the ones you go to.',
      ...(ticks.size ? [button('Untick all', () => { ticks.clear(); address(); rebuild(); fillPanel(); })] : [])),
    h('ul', { class: 'choices cinemas' }, ...cinemaRows),
  );
  panel.scrollTop = scrolled;
}

// ---- Keys ----------------------------------------------------------------------

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || panel.open || !page) return;
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.type === 'search') {
    if (['Escape', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      target.blur();
      event.preventDefault();
    }
    return;
  }
  if (target instanceof HTMLInputElement) target.blur(); // a tick box keeps no hold on the keys
  if (target instanceof HTMLSelectElement || (target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' '))) return;
  const results = view.columns.length;
  const facet = view.columns[view.focus] as q.Facet | undefined;
  const shown = page.rows[view.row];
  const step = ({ ArrowDown: 1, j: 1, ArrowUp: -1, k: -1, PageDown: 10, PageUp: -10, Home: -Infinity, End: Infinity } as Record<string, number>)[event.key];
  const within = (value: number, length: number) => Math.max(0, Math.min(length - 1, value));
  const swap = (by: number) => {
    const to = view.focus + by;
    if (!facet || to < 0 || to >= results) return;
    [view.columns[view.focus], view.columns[to]] = [view.columns[to], view.columns[view.focus]];
    view.focus = to;
    rebuild();
  };
  const actions: Record<string, () => void> = {
    ArrowLeft: () => { view.focus = Math.max(0, view.focus - 1); page!.mark(); },
    ArrowRight: () => { view.focus = Math.min(lastColumn(), view.focus + 1); page!.mark(); },
    Enter: () => { view.focus = Math.min(lastColumn(), view.focus + 1); page!.mark(); },
    Escape: () => {
      if (facet && page!.filters[view.focus]) { page!.filters[view.focus] = ''; rebuild(); }
      else if (facet && view.picks[facet]) { delete view.picks[facet]; view.row = 0; page!.draw(); }
      else if (!facet && view.text) { view.text = ''; rebuild(); }
    },
    '/': () => page!.focusSearch(),
    s: () => {
      if (facet) {
        const orders = ordersOf(facet);
        const next = orders[(orders.indexOf(view.orders[facet] ?? 'name') + 1) % orders.length];
        if (next === 'name') delete view.orders[facet];
        else view.orders[facet] = next;
        rebuild();
      } else {
        view.sort = q.SORTS[(q.SORTS.indexOf(view.sort) + 1) % q.SORTS.length];
        view.row = 0;
        rebuild();
      }
    },
    '[': () => swap(-1),
    ']': () => swap(1),
    x: () => {
      if (!facet) return;
      view.columns.splice(view.focus, 1);
      delete view.picks[facet];
      view.focus = Math.min(view.focus, view.columns.length);
      rebuild();
    },
    o: openPanel,
    h: () => {
      const id = (facet === 'film' ? view.picks.film : undefined) ?? shown?.filmId; // the chosen film, or the highlighted showtime's
      if (id) hideFilm(id);
    },
    t: () => {
      const play = app.querySelector<HTMLElement>('.details .trailer button');
      play?.parentElement!.scrollIntoView({ block: 'nearest' });
      play?.click();
    },
    b: () => { if (shown) window.open(BOOKING + shown.id, '_blank', 'noopener'); },
    c: () => { if (shown) addToCalendar(shown.cinemaId, shown.id); },
    l: flipLondon,
  };
  actions.Backspace = actions.Escape;
  if (step !== undefined) {
    event.preventDefault();
    if (facet) {
      const options = page.options[view.focus];
      const value = options[within(options.indexOf(view.picks[facet]) + step, options.length)];
      if (value === undefined) delete view.picks[facet];
      else view.picks[facet] = value;
      view.row = 0;
      page.more = 0;
      page.draw();
    } else if (view.focus === results) {
      const past = Number.isFinite(step) && view.row + step > page.rows.length - 1 && page.rows.length < page.total;
      if (past) { page.more += 1; view.row += step; page.draw(); }
      else { view.row = within(view.row + step, page.rows.length); page.mark(); }
    }
    return;
  }
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  action();
});
window.addEventListener('hashchange', () => { if (location.hash !== drawn) render(); });
narrow.addEventListener('change', () => { if (page) render(); });

function load(all: boolean): Promise<void> {
  return openListings(all ? './data/listings.json.gz' : './data/london.json.gz').then(
    (listings) => {
      db = listings;
      whole = all;
      render();
    },
    (error) => { app.replaceChildren(h('p', { class: 'error' }, String(error.message ?? error))); },
  );
}
if (needsEveryCinema(ticks)) everything = load(true);
else load(false);
