// The interface: a stack of keyboard-driven tables over the listings.
import { openListings } from './db';
import * as q from './queries';

const BOOKING = 'https://www.odeon.co.uk/ticketing/seat-picker/?showtimeId=';
const PAGE = 100;
const TICKS = 'odeon.cinemas';

// Accessibility and pricing tags are left out of the Formats column.
const HIDDEN_TAGS = new Set([
  'Wheelchair Accessible', 'Audio Described', 'Autism Friendly', 'Flash Warning', 'Saver', 'Bargain Wednesday',
]);
const TAG_LABELS: Record<string, string> = {
  'IMAX 3D_Web': 'IMAX 3D', '3D - Web': '3D', 'XL Web': 'XL', 'English (Sub)': 'English subtitles',
  'Open Captioned': 'Captioned',
};

type Cell = string | number | null | Node;
interface Column {
  label: string;
  right?: boolean;
  /** Hidden on narrow screens. */
  wide?: boolean;
  /** For tables sorted by the database: the name of its sort order. */
  order?: string;
  wrap?: boolean;
}
interface Row {
  cells: Cell[];
  /** Values to sort and search by, when they differ from what is shown. */
  values?: (string | number | null)[];
  /** Where Enter goes: a route, or a full address opened in a new tab. */
  open?: string;
  /** The cinema this row ticks. */
  tick?: string;
  book?: string;
  sold?: boolean;
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
  /** True when the database sorts, searches and pages (the showtimes tables). */
  paged?: boolean;
}
interface Ui {
  order: number | null;
  descending: boolean;
  text: string;
  page: number;
  selected: number;
}

let db: q.Db;
const app = document.getElementById('app')!;
const uis = new Map<string, Ui>();

// ---- Ticked cinemas, kept in this browser -------------------------------

function loadTicks(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(TICKS) ?? '[]') as string[]);
  } catch {
    return new Set(); // storage is blocked or holds something else: start unticked
  }
}
const ticks = loadTicks();
function toggleTick(cinema: string) {
  if (!ticks.delete(cinema)) ticks.add(cinema);
  try {
    localStorage.setItem(TICKS, JSON.stringify([...ticks]));
  } catch (error) {
    console.warn('Ticked cinemas could not be saved in this browser', error);
  }
}

// ---- Dates ---------------------------------------------------------------

function scope(cinemas: string[] = [...ticks]): q.Scope {
  return {
    cinemas,
    now: new Date().toISOString().slice(0, 19) + 'Z',
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()),
  };
}
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Europe/London' });
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
/** `Mon 16 Nov` for a stored time or a plain date. */
function day(value: string | null): string {
  if (!value) return '–';
  return DAY.format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value)).replace(',', '');
}
function when(value: string | null): string {
  if (!value) return '–';
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  return `${day(value)} ${time.format(new Date(value))}`;
}
function fullDate(value: string | null): string {
  return value ? DAY_YEAR.format(new Date(value + 'T12:00:00Z')) : '–';
}

// ---- Small helpers ------------------------------------------------------

function h(tag: string, props: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}
const count = (n: number, noun: string) => `${n.toLocaleString('en-GB')} ${noun}${n === 1 ? '' : 's'}`;
const formats = (tags: string[]) =>
  tags
    .filter((tag) => !HIDDEN_TAGS.has(tag) && !(/^[£€$]/.test(tag) && /web$/i.test(tag)))
    .map((tag) => TAG_LABELS[tag] ?? tag.replace(/ \(Audio\)$/, ''))
    .join(', ');
const shortCinema = (name: string) => name.replace(/^London /, '');

/** Sort, search and page a short list here; the database does it for showtimes. */
function local(columns: Column[], rows: Row[], ui: Ui): Table {
  const value = (row: Row, index: number) => {
    const cell = row.values?.[index] ?? row.cells[index];
    return cell instanceof Node ? cell.textContent : cell;
  };
  const needle = ui.text.toLowerCase();
  let found = needle
    ? rows.filter((row) => row.cells.some((_, index) => String(value(row, index) ?? '').toLowerCase().includes(needle)))
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

function homeView(): View {
  const home = q.home(db, scope());
  const [first, last] = q.weekend(scope().today);
  const ticked = ticks.size ? `${count(ticks.size, 'cinema')} ticked` : 'all';
  const rows: Row[] = [
    { cells: ['Films', count(home.films, 'film'), count(home.showings, 'showing')], open: 'films' },
    { cells: ['Cinemas', count(home.allCinemas, 'cinema'), ticked], open: 'cinemas' },
    { cells: ['Tonight', count(home.tonight, 'screening'), count(home.tonightFilms, 'film')], open: 'tonight' },
    { cells: ['This weekend', count(home.weekendShows, 'screening'), `${count(home.weekendFilms, 'film')} · ${day(first)} – ${day(last)}`], open: 'weekend' },
    { cells: ['Opening soon', count(home.soon, 'film'), home.next ? `next: ${home.next.title} (${fullDate(home.next.release)})` : ''], open: 'soon' },
    { cells: ['Dates', count(home.days, 'day'), home.from ? `${day(home.from)} – ${fullDate(home.to)}` : ''], open: 'dates' },
    { cells: ['All showtimes', count(home.showings, 'screening'), 'every film, cinema and day'], open: 'all' },
  ];
  const intro = h('div', { class: 'intro' },
    h('p', {}, "ODEON · what's on, on which screen, and how big it is."),
    h('dl', {},
      h('dt', {}, 'Quick start'), h('dd', {}, 'tick your favourite cinemas in Cinemas; everything then shows only those. Your ticks are remembered in this browser.'),
      h('dt', {}, 'Getting around'), h('dd', {}, '↑ ↓ move · Enter open · Esc back, or click and tap'),
      h('dt', {}, 'Every table'), h('dd', {}, 'click a heading or press s to sort · / to search'),
    ),
  );
  const columns = [{ label: 'Browse' }, { label: 'How many' }, { label: 'Showing', wrap: true }];
  return { title: 'Start', intro, table: (ui) => local(columns, rows, ui) };
}

function filmsView(): View {
  const columns: Column[] = [
    { label: 'Film', wrap: true }, { label: 'Cert' }, { label: 'Mins', right: true, wide: true },
    { label: 'IMDb', right: true }, { label: 'Meta', right: true, wide: true },
    { label: 'Cinemas', right: true }, { label: 'Showings', right: true }, { label: 'Next', wide: true },
  ];
  const rows = q.films(db, scope()).map((film): Row => ({
    cells: [film.title, film.certificate || 'TBC', film.runtime, film.imdb?.toFixed(1) ?? null, film.metacritic, film.cinemas, film.showings, when(film.next)],
    values: [film.title, film.certificate, film.runtime, film.imdb, film.metacritic, film.cinemas, film.showings, film.next],
    open: `film/${film.id}`,
  }));
  return { title: 'Films', table: (ui) => local(columns, rows, ui) };
}

function filmIntro(film: q.Film): Node {
  const named = (role: string) => film.people.filter((p) => p.roles.includes(role)).map((p) => p.name).join(', ');
  const facts: [string, Node | string][] = [
    ['Certificate', film.certificate || 'TBC'],
    ['Runtime', film.runtime ? `${film.runtime} minutes` : '–'],
    ['Released', fullDate(film.release)],
    ['Genres', film.genres.join(', ') || '–'],
  ];
  if (film.imdb !== null) {
    const score = `${film.imdb.toFixed(1)} / 10`;
    facts.push(['IMDb', film.imdbId ? h('a', { href: `https://www.imdb.com/title/${film.imdbId}/`, target: '_blank', rel: 'noopener' }, score) : score]);
  }
  if (film.metacritic !== null) facts.push(['Metacritic', `${film.metacritic} / 100`]);
  if (named('Director')) facts.push(['Director', named('Director')]);
  if (named('Actor')) facts.push(['Cast', named('Actor')]);
  if (film.distributor) facts.push(['Distributor', film.distributor]);
  if (film.trailer) facts.push(['Trailer', h('a', { href: film.trailer, target: '_blank', rel: 'noopener' }, 'watch')]);
  return h('div', { class: 'intro' },
    h('dl', {}, ...facts.flatMap(([name, value]) => [h('dt', {}, name), h('dd', {}, value)])),
    h('p', { class: 'dim' }, film.synopsis),
  );
}

function filmView(id: string): View {
  const film = q.film(db, id);
  if (!film) return missing('That film is no longer listed.');
  const columns: Column[] = [{ label: 'Cinema', wrap: true }, { label: 'City', wide: true }, { label: 'Showings', right: true }, { label: 'Next' }];
  const rows = q.cinemas(db, scope(), id)
    .filter((cinema) => !ticks.size || ticks.has(cinema.id))
    .map((cinema): Row => ({
      cells: [shortCinema(cinema.name), cinema.city, cinema.showings, when(cinema.next)],
      values: [cinema.name, cinema.city, cinema.showings, cinema.next],
      open: `film/${id}/${cinema.id}`,
    }));
  return { title: film.title, intro: filmIntro(film), table: (ui) => local(columns, rows, ui) };
}

function cinemasView(): View {
  const columns: Column[] = [{ label: '' }, { label: 'Cinema', wrap: true }, { label: 'City', wide: true }, { label: 'Films', right: true }, { label: 'Showings', right: true }];
  const table = (ui: Ui) => {
    const rows = q.cinemas(db, scope()).map((cinema): Row => ({
      cells: [ticks.has(cinema.id) ? '[x]' : '[ ]', cinema.name, cinema.city, cinema.films, cinema.showings],
      open: `cinema/${cinema.id}`,
      tick: cinema.id,
    }));
    return local(columns, rows, ui);
  };
  const intro = h('div', { class: 'intro' }, h('p', { class: 'dim' }, 'Space, or a click on the box, ticks a cinema. With any ticked, every other screen shows only those.'));
  return { title: 'Cinemas', intro, table };
}

function soonView(): View {
  const columns: Column[] = [{ label: 'Film', wrap: true }, { label: 'Cert' }, { label: 'Opens' }, { label: 'Cinemas', right: true }];
  const rows = q.soon(db, scope()).map((film): Row => ({
    cells: [film.title, film.certificate || 'TBC', fullDate(film.release), film.cinemas],
    values: [film.title, film.certificate, film.release, film.cinemas],
    open: `film/${film.id}`,
  }));
  return { title: 'Opening soon', table: (ui) => local(columns, rows, ui) };
}

function datesView(): View {
  const columns: Column[] = [{ label: 'Date' }, { label: 'Films', right: true }, { label: 'Showings', right: true }];
  const rows = q.dates(db, scope()).map((date): Row => ({
    cells: [`${day(date.date)} ${date.date.slice(0, 4)}`, date.films, date.showings],
    values: [date.date, date.films, date.showings],
    open: `date/${date.date}`,
  }));
  return { title: 'Dates', table: (ui) => local(columns, rows, ui) };
}

/** A showtimes table. Leaving a column out is for what the screen already fixes. */
function showingsView(title: string, filter: q.ShowingFilter, within: q.Scope = scope(), intro?: Node): View {
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
    intro,
    paged: true,
    table(ui) {
      const order = ui.order === null ? 'date' : (columns[ui.order].order ?? 'date');
      const found = q.showings(db, within, { ...filter, text: ui.text }, order, ui.descending, PAGE, ui.page * PAGE);
      return {
        columns,
        total: found.total,
        rows: found.rows.map((row): Row => ({
          cells: columns.map((column) => column.cell(row)),
          // Within one film the next step is booking; elsewhere it is the film.
          open: filter.film ? BOOKING + row.id : `film/${row.filmId}`,
          book: BOOKING + row.id,
          sold: row.soldOut,
        })),
      };
    },
  };
}

function missing(message: string): View {
  return { title: 'Not found', intro: h('p', { class: 'empty' }, message), table: () => ({ columns: [], rows: [], total: 0 }) };
}

function viewFor(route: string): View {
  const [name, a, b] = route.split('/').map(decodeURIComponent);
  const today = scope().today;
  const cinemaName = (id: string) => q.cinemas(db, scope()).find((cinema) => cinema.id === id)?.name;
  switch (name) {
    case '': return homeView();
    case 'films': return filmsView();
    case 'cinemas': return cinemasView();
    case 'soon': return soonView();
    case 'dates': return datesView();
    case 'tonight': return showingsView('Tonight', { from: today, to: today });
    case 'weekend': { const [from, to] = q.weekend(today); return showingsView('This weekend', { from, to }); }
    case 'all': return showingsView('All showtimes', {});
    case 'date': return showingsView(`${day(a)} ${a.slice(0, 4)}`, { from: a, to: a });
    case 'cinema': {
      const cinema = cinemaName(a);
      return cinema ? showingsView(cinema, { cinema: a }, scope([])) : missing('That cinema is not listed.');
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

function go(target: string) {
  if (/^https?:/.test(target)) window.open(target, '_blank', 'noopener');
  else location.hash = '#/' + target;
}

/** Build the page for a route. The search box lives here so that typing in it
 *  never replaces it; paint() then redraws only what a keystroke changes. */
function render() {
  const key = route();
  if (!uis.has(key)) uis.set(key, { order: null, descending: false, text: '', page: 0, selected: 0 });
  const ui = uis.get(key)!;
  const view = viewFor(key);
  document.title = key ? `${view.title} · ODEON` : 'ODEON';
  const search = h('input', { type: 'search', placeholder: 'Search this table ( / )', 'aria-label': 'Search this table' }) as HTMLInputElement;
  search.value = ui.text;
  search.oninput = () => { ui.text = search.value; ui.page = 0; ui.selected = 0; paint(); };
  const stamp = q.ingested(db);
  app.replaceChildren(
    h('header', {}, ...(key ? [h('a', { class: 'back', href: '#/' }, '← Start')] : []), h('h1', {}, 'ODEON ', h('span', {}, '— ' + view.title))),
    ...(view.intro ? [view.intro] : []),
    h('div', { class: 'tools' }, search, h('span', { class: 'pager' })),
    h('div', { class: 'scroll' }),
    h('footer', {},
      h('span', { class: 'keys' }, ...['↑↓ move', 'Enter open', 'Esc back', '/ search', 's sort', 'n p pages', 'b book', 'Space tick'].flatMap((hint) => {
        const [keys, ...words] = hint.split(' ');
        return [h('kbd', {}, keys), ` ${words.join(' ')}   `];
      })),
      h('span', { class: 'status' }, `listings from ${stamp ? day(stamp) : 'no ingest yet'}`)),
  );
  current = { view, ui, table: { columns: [], rows: [], total: 0 } };
  paint();
}

function paint() {
  const { view, ui } = current;
  let table = view.table(ui);
  const pages = Math.max(1, Math.ceil(table.total / PAGE));
  if (ui.page >= pages) { ui.page = pages - 1; table = view.table(ui); }
  ui.selected = Math.min(ui.selected, Math.max(table.rows.length - 1, 0));
  current.table = table;

  const head = h('tr', {}, ...table.columns.map((column, index) => {
    const sorted = ui.order === index;
    const th = h('th', { class: ['sortable', column.right ? 'right' : '', column.wide ? 'wide' : '', sorted ? 'sorted' : ''].join(' ') },
      column.label + (sorted ? (ui.descending ? ' ▼' : ' ▲') : ''));
    th.onclick = () => sortBy(index);
    return th;
  }));
  const body = h('tbody', {}, ...table.rows.map((row, index) => {
    const tr = h('tr', { class: index === ui.selected ? 'selected' : '' }, ...row.cells.map((cell, column) => {
      const spec = table.columns[column];
      const td = h('td', { class: [spec.right ? 'right' : '', spec.wide ? 'wide' : '', spec.wrap ? 'wrap' : '', row.tick && column === 0 ? 'tick' : '', row.sold ? 'sold' : ''].join(' ') },
        cell instanceof Node ? cell : cell === null || cell === '' ? '–' : String(cell));
      if (row.tick && column === 0) td.onclick = (event) => { event.stopPropagation(); ui.selected = index; tick(); };
      return td;
    }));
    tr.onclick = () => { ui.selected = index; open(); };
    return tr;
  }));

  const pager = (label: string, step: number, enabled: boolean) => {
    const button = h('button', {}, label) as HTMLButtonElement;
    button.disabled = !enabled;
    button.onclick = () => turn(step);
    return button;
  };
  const tools = app.querySelector<HTMLElement>('.tools')!;
  tools.hidden = !table.columns.length;
  app.querySelector('.pager')!.replaceChildren(
    ...(pages > 1 ? [pager('← Previous', -1, ui.page > 0), h('span', { class: 'dim' }, ` page ${ui.page + 1} of ${pages} `), pager('Next →', 1, ui.page < pages - 1)] : []),
    h('span', { class: 'dim' }, ' ' + count(table.total, 'row')));
  app.querySelector('.scroll')!.replaceChildren(...(table.columns.length ? [
    h('table', {}, h('thead', {}, head), body),
    ...(table.rows.length ? [] : [h('p', { class: 'empty' }, ticks.size ? 'Nothing here for your ticked cinemas.' : 'Nothing here.')]),
  ] : []));
  body.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function move(step: number) {
  const { ui, table } = current;
  ui.selected = Math.max(0, Math.min(table.rows.length - 1, ui.selected + step));
  paint();
}
function turn(step: number) {
  const { ui, table } = current;
  const pages = Math.ceil(table.total / PAGE);
  const page = ui.page + step;
  if (page < 0 || page >= pages) return;
  ui.page = page;
  ui.selected = 0;
  paint();
}
function sortBy(index: number) {
  const { ui, view, table } = current;
  if (view.paged && !table.columns[index].order) return;
  if (ui.order === index) ui.descending = !ui.descending;
  else { ui.order = index; ui.descending = false; }
  ui.page = 0;
  paint();
}
function nextSort() {
  const { ui, view, table } = current;
  const sortable = table.columns.map((column, index) => (!view.paged || column.order ? index : -1)).filter((index) => index >= 0);
  if (!sortable.length) return;
  sortBy(sortable[(sortable.indexOf(ui.order ?? -1) + 1) % sortable.length]);
}
function open() {
  const row = current.table.rows[current.ui.selected];
  if (row?.open) go(row.open);
}
function tick() {
  const row = current.table.rows[current.ui.selected];
  if (!row?.tick) return;
  toggleTick(row.tick);
  paint();
}
function back() {
  if (route()) history.length > 1 ? history.back() : go('');
}

document.addEventListener('keydown', (event) => {
  if (!current || event.metaKey || event.ctrlKey || event.altKey) return;
  const typing = event.target instanceof HTMLInputElement;
  if (typing) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'ArrowDown') {
      (event.target as HTMLInputElement).blur();
      event.preventDefault();
    }
    return;
  }
  const actions: Record<string, () => void> = {
    ArrowDown: () => move(1), ArrowUp: () => move(-1), j: () => move(1), k: () => move(-1),
    PageDown: () => move(20), PageUp: () => move(-20),
    Home: () => move(-Infinity), End: () => move(Infinity),
    Enter: open, ArrowRight: open, Escape: back, ArrowLeft: back, Backspace: back,
    ' ': tick, s: nextSort, n: () => turn(1), p: () => turn(-1),
    '/': () => app.querySelector<HTMLInputElement>('.tools input')?.focus(),
    b: () => { const row = current.table.rows[current.ui.selected]; if (row?.book) go(row.book); },
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  action();
});
window.addEventListener('hashchange', () => render());

openListings('./data/odeon.sqlite.gz').then(
  (listings) => { db = listings; render(); },
  (error) => { app.replaceChildren(h('p', { class: 'error' }, String(error.message ?? error))); },
);
