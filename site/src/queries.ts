// Every question the site asks of the listings. The listings are held in
// memory as plain arrays, so each answer is a loop: nothing here waits.

/** The listings as the site downloads them (see export.ts). */
export interface Data {
  /** When the listings were last fetched from ODEON, or null before the first ingest. */
  ingested: string | null;
  cinemas: Cinema[];
  films: Film[];
  /** Which cinemas have announced which films: cinema ID, film ID. */
  availability: [string, string][];
  /** Seats per screen: cinema ID, screen ID, capacity. */
  screens: [string, string, number][];
  /** The showings, ordered by start, then cinema ID, then ID. Each is a list of
   *  positions in `values`: cinema ID, ID, film ID, date, start, time, film start,
   *  film end, screen, screen ID, formats, seat types, sold out. */
  rows: number[][];
  /** Every distinct value a showing holds, written once. */
  values: unknown[];
}

interface Cinema {
  id: string;
  name: string;
  /** Whether its screenings are stored. */
  stored: boolean;
  address: Record<string, string>;
}

interface Show {
  cinemaId: string;
  id: string;
  filmId: string;
  date: string;
  startsAt: string;
  time: string;
  filmStartsAt: string | null;
  filmEndsAt: string | null;
  screen: string;
  screenId: string;
  experiences: string[];
  seating: string[];
  soldOut: boolean;
  film?: Film;
  cinema?: Cinema;
  capacity: number | null;
  /** The film's title and the cinema's name in lower case, to sort by. */
  title: string;
  place: string;
  /** What a search looks through; made the first time one does. */
  text?: string;
}

export interface Listings {
  ingested: string | null;
  films: Map<string, Film>;
  cinemas: Cinema[];
  availability: [string, string][];
  /** Every showing, in the order of `Data.rows`. */
  shows: Show[];
  /** Showings by cinema ID and ID; made the first time one is asked for. */
  byId?: Map<string, Show>;
}

export function open(data: Data): Listings {
  const films = new Map(data.films.map((film) => [film.id, film]));
  const cinemas = new Map(data.cinemas.map((cinema) => [cinema.id, cinema]));
  const capacity = new Map(data.screens.map(([cinema, screen, seats]) => [`${cinema}/${screen}`, seats]));
  const lowered = new Map<string, string>();
  const low = (text = '') => lowered.get(text) ?? (lowered.set(text, lower(text)), lowered.get(text)!);
  const shows = data.rows.map((row): Show => {
    const [cinemaId, id, filmId, date, startsAt, time, filmStartsAt, filmEndsAt, screen, screenId, experiences, seating, soldOut] =
      row.map((position) => data.values[position]) as never[];
    const [film, cinema] = [films.get(filmId), cinemas.get(cinemaId)];
    return {
      cinemaId, id, filmId, date, startsAt, time, filmStartsAt, filmEndsAt, screen, screenId, experiences, seating,
      soldOut: Boolean(soldOut),
      film,
      cinema,
      capacity: capacity.get(`${cinemaId}/${screenId}`) ?? null,
      title: low(film?.title),
      place: low(cinema?.name),
    };
  });
  return {
    ingested: data.ingested,
    films,
    cinemas: data.cinemas,
    availability: data.availability,
    shows,
  };
}

/** What the visitor is looking at: their ticked cinemas, and the present moment. */
export interface Scope {
  /** Ticked cinema IDs; empty means every cinema. */
  cinemas: string[];
  /** Films the visitor has hidden. */
  hidden: string[];
  /** Now, as stored times are written: UTC, `2026-11-16T18:00:00Z`. */
  now: string;
  /** Today's date in London. */
  today: string;
}

export interface Showing {
  cinemaId: string;
  id: string;
  filmId: string;
  date: string;
  startsAt: string;
  time: string;
  title: string;
  cinema: string;
  screen: string;
  capacity: number | null;
  experiences: string[];
  soldOut: boolean;
}

export interface ShowingFilter {
  from?: string;
  to?: string;
  film?: string;
  cinema?: string;
  /** A screen's ID, within `cinema`. */
  screen?: string;
  /** A format or language tag exactly as ODEON names it. */
  tag?: string;
  /** A seat type, without its price tier. */
  seat?: string;
  text?: string;
}

export interface FilmFilter {
  certificate?: string;
  genre?: string;
  person?: string;
  distributor?: string;
}

const order = <T>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
const lower = (text: string) => text.toLowerCase();
/** Sorts by each key in turn. */
const by = <T>(...keys: ((item: T) => string | number)[]) => (a: T, b: T) => {
  for (const key of keys) {
    const result = order(key(a), key(b));
    if (result) return result;
  }
  return 0;
};

/** Showings that have not started; with `scoped`, only the visitor's cinemas, less their hidden films. */
function upcoming(l: Listings, scope: Scope, scoped = true): Show[] {
  // The showings are in start order, so the first one still to come is found by halving.
  let [low, high] = [0, l.shows.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (l.shows[middle].startsAt > scope.now) high = middle;
    else low = middle + 1;
  }
  const rest = l.shows.slice(low);
  if (!scoped || (!scope.cinemas.length && !scope.hidden.length)) return rest;
  const ticked = new Set(scope.cinemas);
  const hidden = new Set(scope.hidden);
  return rest.filter((show) => (!ticked.size || ticked.has(show.cinemaId)) && !hidden.has(show.filmId));
}

// ODEON prices one seat type in tiers ("Recliner Saver"); the type is what matters.
const seatType = (seat: string) => seat.replace(/ (Saver|Popular)$/, '');
const certificate = (film: Film) => film.certificate || 'TBC';

/** Friday to Sunday of this week; from today when the weekend has begun. */
export function weekend(today: string): [string, string] {
  const day = new Date(today + 'T00:00:00Z');
  const weekday = (day.getUTCDay() + 6) % 7; // Monday is 0
  const shift = (days: number) =>
    new Date(day.getTime() + days * 86400000).toISOString().slice(0, 10);
  return [shift(Math.max(4 - weekday, 0)), shift(6 - weekday)];
}

export function home(l: Listings, scope: Scope) {
  const shows = upcoming(l, scope);
  const [first, last] = weekend(scope.today);
  const [films, cinemas, days, tonightFilms, weekendFilms] = [1, 2, 3, 4, 5].map(() => new Set<string>());
  let [tonight, weekendShows] = [0, 0];
  for (const show of shows) {
    films.add(show.filmId);
    cinemas.add(show.cinemaId);
    days.add(show.date);
    if (show.date === scope.today) {
      tonight += 1;
      tonightFilms.add(show.filmId);
    }
    if (show.date >= first && show.date <= last) {
      weekendShows += 1;
      weekendFilms.add(show.filmId);
    }
  }
  const dates = [...days].sort();
  const opening = soon(l, scope);
  return {
    films: films.size,
    showings: shows.length,
    cinemas: cinemas.size,
    tonight,
    tonightFilms: tonightFilms.size,
    weekendShows,
    weekendFilms: weekendFilms.size,
    days: days.size,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    soon: opening.length,
    next: opening[0] ?? null,
    allCinemas: l.cinemas.filter((cinema) => cinema.stored).length,
  };
}

export interface FilmRow {
  id: string;
  title: string;
  certificate: string;
  runtime: number | null;
  release: string | null;
  imdb: number | null;
  metacritic: number | null;
  cinemas: number;
  showings: number;
  next: string;
}

export function films(l: Listings, scope: Scope, filter: FilmFilter = {}): FilmRow[] {
  const found = new Map<Film, { cinemas: Set<string>; showings: number; next: string }>();
  for (const show of upcoming(l, scope)) {
    if (!show.film) continue;
    let row = found.get(show.film);
    if (!row) found.set(show.film, (row = { cinemas: new Set(), showings: 0, next: show.startsAt }));
    row.cinemas.add(show.cinemaId);
    row.showings += 1;
  }
  return [...found]
    .filter(([film]) =>
      (!filter.certificate || certificate(film) === filter.certificate) &&
      (!filter.genre || film.genres.includes(filter.genre)) &&
      (!filter.person || film.people.some((person) => person.name === filter.person)) &&
      (!filter.distributor || film.distributor === filter.distributor))
    .map(([film, row]): FilmRow => ({
      id: film.id, title: film.title, certificate: film.certificate, runtime: film.runtime, release: film.release,
      imdb: film.imdb, metacritic: film.metacritic, cinemas: row.cinemas.size, showings: row.showings, next: row.next,
    }))
    .sort(by((film) => lower(film.title)));
}

export interface Film {
  id: string;
  title: string;
  runtime: number | null;
  certificate: string;
  release: string | null;
  genres: string[];
  people: { name: string; roles: string[] }[];
  distributor: string;
  synopsis: string;
  trailer: string | null;
  imdb: number | null;
  imdbId: string | null;
  metacritic: number | null;
}

export const film = (l: Listings, id: string): Film | null => l.films.get(id) ?? null;

export interface CinemaRow {
  id: string;
  name: string;
  city: string;
  films: number;
  showings: number;
  next: string | null;
}

/** Every stored cinema, or only those showing one film. Ticks do not narrow this list. */
export function cinemas(l: Listings, scope: Scope, filmId?: string): CinemaRow[] {
  const found = new Map<string, { films: Set<string>; showings: number; next: string }>();
  for (const show of upcoming(l, scope, false)) {
    if (filmId && show.filmId !== filmId) continue;
    let row = found.get(show.cinemaId);
    if (!row) found.set(show.cinemaId, (row = { films: new Set(), showings: 0, next: show.startsAt }));
    row.films.add(show.filmId);
    row.showings += 1;
  }
  return l.cinemas
    .filter((cinema) => cinema.stored && (!filmId || found.has(cinema.id)))
    .map((cinema): CinemaRow => {
      const row = found.get(cinema.id);
      return {
        id: cinema.id, name: cinema.name, city: cinema.address.city ?? '',
        films: row?.films.size ?? 0, showings: row?.showings ?? 0, next: row?.next ?? null,
      };
    })
    .sort(by((cinema) => lower(cinema.name)));
}

export interface SoonRow {
  id: string;
  title: string;
  certificate: string;
  release: string;
  cinemas: number;
}

/** Films not yet released that the scoped cinemas have announced. */
export function soon(l: Listings, scope: Scope): SoonRow[] {
  const ticked = new Set(scope.cinemas);
  const hidden = new Set(scope.hidden);
  const found = new Map<Film, Set<string>>();
  for (const [cinemaId, filmId] of l.availability) {
    const film = l.films.get(filmId);
    if (!film?.release || film.release <= scope.today) continue;
    if ((ticked.size && !ticked.has(cinemaId)) || hidden.has(filmId)) continue;
    if (!found.has(film)) found.set(film, new Set());
    found.get(film)!.add(cinemaId);
  }
  return [...found]
    .map(([film, cinemas]): SoonRow => ({
      id: film.id, title: film.title, certificate: film.certificate, release: film.release!, cinemas: cinemas.size,
    }))
    .sort(by((film) => film.release, (film) => lower(film.title)));
}

export interface DateRow {
  date: string;
  films: number;
  showings: number;
}

export function dates(l: Listings, scope: Scope): DateRow[] {
  const found = new Map<string, { films: Set<string>; showings: number }>();
  for (const show of upcoming(l, scope)) {
    let row = found.get(show.date);
    if (!row) found.set(show.date, (row = { films: new Set(), showings: 0 }));
    row.films.add(show.filmId);
    row.showings += 1;
  }
  return [...found]
    .map(([date, row]): DateRow => ({ date, films: row.films.size, showings: row.showings }))
    .sort(by((row) => row.date));
}

/** A screen's name without "Screen ", and its number when that is all the name is. */
function screenName(show: Show): [name: string, number: number | null] {
  let found = screenNames.get(show.screen);
  if (!found) {
    const name = show.screen.startsWith('Screen ') ? show.screen.slice(7) : show.screen;
    screenNames.set(show.screen, (found = [name, /^[0-9]+$/.test(name) ? Number(name) : null]));
  }
  return found;
}
const screenNames = new Map<string, [string, number | null]>();

/** Sort orders for the showtimes table. Ties keep the order of start, cinema and ID. */
const SHOWING_ORDERS: Record<string, (sign: number) => (a: Show, b: Show) => number> = {
  date: (sign) => (a, b) => sign * order(a.startsAt, b.startsAt),
  time: (sign) => (a, b) => sign * order(a.time, b.time),
  film: (sign) => (a, b) => sign * order(a.title, b.title),
  cinema: (sign) => (a, b) => sign * order(a.place, b.place),
  // Numbered screens come before named ones, in number order.
  screen: (sign) => (a, b) => {
    const [[nameA, numberA], [nameB, numberB]] = [screenName(a), screenName(b)];
    if (numberA !== null && numberB !== null) return sign * (numberA - numberB || order(nameA, nameB));
    if (numberA === null && numberB === null) return sign * order(nameA, nameB);
    return sign * (numberA === null ? 1 : -1);
  },
  // Screens of unknown size come last, whichever way.
  seats: (sign) => (a, b) =>
    a.capacity === null || b.capacity === null
      ? Number(a.capacity === null) - Number(b.capacity === null)
      : sign * (a.capacity - b.capacity),
};

export function showings(
  l: Listings,
  scope: Scope,
  filter: ShowingFilter,
  sort = 'date',
  descending = false,
  limit = 200,
  offset = 0,
): { rows: Showing[]; total: number } {
  const text = filter.text ? lower(filter.text) : '';
  const found = upcoming(l, scope).filter((show) => {
    if (!show.film || !show.cinema) return false;
    if (filter.from && show.date < filter.from) return false;
    if (filter.to && show.date > filter.to) return false;
    if (filter.film && show.filmId !== filter.film) return false;
    if (filter.cinema && show.cinemaId !== filter.cinema) return false;
    if (filter.screen && show.screenId !== filter.screen) return false;
    if (filter.tag && !show.experiences.includes(filter.tag)) return false;
    if (filter.seat && !show.seating.some((seat) => seatType(seat) === filter.seat)) return false;
    if (text) {
      show.text ??= lower([show.film.title, show.cinema.name, show.screen, show.time, ...show.experiences].join(' '));
      if (!show.text.includes(text)) return false;
    }
    return true;
  });
  // Already in date order; sorting is stable, so any other order keeps it for ties.
  if (sort !== 'date' || descending) found.sort((SHOWING_ORDERS[sort] ?? SHOWING_ORDERS.date)(descending ? -1 : 1));
  return {
    total: found.length,
    rows: found.slice(offset, offset + limit).map((show): Showing => ({
      cinemaId: show.cinemaId, id: show.id, filmId: show.filmId, date: show.date, startsAt: show.startsAt,
      time: show.time, title: show.film!.title, cinema: show.cinema!.name, screen: show.screen,
      capacity: show.capacity, experiences: show.experiences, soldOut: show.soldOut,
    })),
  };
}

export interface TagRow {
  tag: string;
  showings: number;
  films: number;
  cinemas: number;
}

/** How many showings carry each format tag, or offer each seat type. */
export function tags(l: Listings, scope: Scope, kind: 'experiences' | 'seating'): TagRow[] {
  const found = new Map<string, { showings: number; films: Set<string>; cinemas: Set<string> }>();
  for (const show of upcoming(l, scope)) {
    const names = kind === 'seating' ? show.seating.map(seatType) : show.experiences;
    for (const tag of new Set(names)) {
      let row = found.get(tag);
      if (!row) found.set(tag, (row = { showings: 0, films: new Set(), cinemas: new Set() }));
      row.showings += 1;
      row.films.add(show.filmId);
      row.cinemas.add(show.cinemaId);
    }
  }
  return [...found]
    .map(([tag, row]): TagRow => ({ tag, showings: row.showings, films: row.films.size, cinemas: row.cinemas.size }))
    .sort(by((row) => -row.showings, (row) => row.tag));
}

export interface FacetRow {
  name: string;
  /** For people: what they did on the film. */
  role: string | null;
  films: number;
  showings: number;
}

const FACETS: Record<string, (film: Film) => [name: string, role: string | null][]> = {
  certificate: (film) => [[certificate(film), null]],
  distributor: (film) => [[film.distributor, null]],
  genre: (film) => film.genres.map((genre) => [genre, null]),
  person: (film) => film.people.map((person) => [person.name, person.roles[0] ?? null]),
};

/** The films now showing, grouped by something about the film. */
export function facet(l: Listings, scope: Scope, kind: 'certificate' | 'distributor' | 'genre' | 'person'): FacetRow[] {
  const shown = new Map<Film, number>();
  for (const show of upcoming(l, scope)) if (show.film) shown.set(show.film, (shown.get(show.film) ?? 0) + 1);
  const found = new Map<string, FacetRow>();
  for (const [film, count] of shown) {
    for (const [name, role] of FACETS[kind](film)) {
      if (!name) continue;
      let row = found.get(name);
      if (!row) found.set(name, (row = { name, role: null, films: 0, showings: 0 }));
      if (role !== null && (row.role === null || role < row.role)) row.role = role;
      row.films += 1;
      row.showings += count;
    }
  }
  return [...found.values()].sort(by((row) => lower(row.name)));
}

export interface ScreenRow {
  cinemaId: string;
  screenId: string;
  cinema: string;
  screen: string;
  capacity: number | null;
  showings: number;
  /** Every tag any showing on the screen carries. */
  tags: string[];
}

/** Every screen with a showing to come, biggest first. */
export function screens(l: Listings, scope: Scope): ScreenRow[] {
  const found = new Map<string, ScreenRow>();
  for (const show of upcoming(l, scope)) {
    if (!show.cinema) continue;
    const key = `${show.cinemaId}/${show.screenId}`;
    let row = found.get(key);
    if (!row) {
      row = {
        cinemaId: show.cinemaId, screenId: show.screenId, cinema: show.cinema.name, screen: show.screen,
        capacity: show.capacity, showings: 0, tags: [],
      };
      found.set(key, row);
    }
    if (show.screen < row.screen) row.screen = show.screen;
    row.showings += 1;
    for (const tag of show.experiences) if (!row.tags.includes(tag)) row.tags.push(tag);
  }
  return [...found.values()].sort(by((row) => -(row.capacity ?? -1), (row) => lower(row.cinema)));
}

export interface ShowingDetail extends Showing {
  filmStartsAt: string | null;
  filmEndsAt: string | null;
  runtime: number | null;
  seating: string[];
  address: Record<string, string>;
}

/** One showing with what its own page and a calendar entry need. */
export function showing(l: Listings, cinemaId: string, id: string): ShowingDetail | null {
  l.byId ??= new Map(l.shows.map((show) => [`${show.cinemaId}/${show.id}`, show]));
  const show = l.byId.get(`${cinemaId}/${id}`);
  if (!show?.film || !show.cinema) return null;
  return {
    cinemaId, id, filmId: show.filmId, date: show.date, startsAt: show.startsAt, time: show.time,
    title: show.film.title, cinema: show.cinema.name, screen: show.screen, capacity: show.capacity,
    experiences: show.experiences, soldOut: show.soldOut, filmStartsAt: show.filmStartsAt,
    filmEndsAt: show.filmEndsAt, runtime: show.film.runtime, seating: show.seating, address: show.cinema.address,
  };
}

/** Titles of the given films, for listing what a visitor has hidden. */
export function titles(l: Listings, ids: string[]): { id: string; title: string }[] {
  return ids
    .flatMap((id) => {
      const film = l.films.get(id);
      return film ? [{ id, title: film.title }] : [];
    })
    .sort(by((film) => lower(film.title)));
}
