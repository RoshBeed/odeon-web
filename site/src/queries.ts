// Every question the site asks of the listings. Pure SQL over a small
// interface, so the same code runs on SQLite in the browser and in tests.

export interface Db {
  all(sql: string, params?: unknown[]): unknown[][];
}

/** What the visitor is looking at: their ticked cinemas, and the present moment. */
export interface Scope {
  /** Ticked cinema IDs; empty means every cinema. */
  cinemas: string[];
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
  text?: string;
}

const UPCOMING = 's.starts_at > ?';

function scoped(scope: Scope, column = 's.cinema_id'): [string, unknown[]] {
  return scope.cinemas.length
    ? [`${column} IN (SELECT value FROM json_each(?))`, [JSON.stringify(scope.cinemas)]]
    : ['1', []];
}

/** Friday to Sunday of this week; from today when the weekend has begun. */
export function weekend(today: string): [string, string] {
  const day = new Date(today + 'T00:00:00Z');
  const weekday = (day.getUTCDay() + 6) % 7; // Monday is 0
  const shift = (days: number) =>
    new Date(day.getTime() + days * 86400000).toISOString().slice(0, 10);
  return [shift(Math.max(4 - weekday, 0)), shift(6 - weekday)];
}

export function home(db: Db, scope: Scope) {
  const [where, params] = scoped(scope);
  const [first, last] = weekend(scope.today);
  const [row] = db.all(
    `SELECT count(DISTINCT s.film_id), count(*), count(DISTINCT s.cinema_id),
            count(*) FILTER (WHERE s.business_date = ?),
            count(DISTINCT s.film_id) FILTER (WHERE s.business_date = ?),
            count(*) FILTER (WHERE s.business_date BETWEEN ? AND ?),
            count(DISTINCT s.film_id) FILTER (WHERE s.business_date BETWEEN ? AND ?),
            count(DISTINCT s.business_date), min(s.business_date), max(s.business_date)
     FROM screenings s WHERE ${where} AND ${UPCOMING}`,
    [scope.today, scope.today, first, last, first, last, ...params, scope.now],
  );
  const opening = soon(db, scope);
  const [films, showings, cinemas, tonight, tonightFilms, weekendShows, weekendFilms, days, from, to] =
    row as number[];
  return {
    films, showings, cinemas, tonight, tonightFilms, weekendShows, weekendFilms, days,
    from: from as unknown as string | null,
    to: to as unknown as string | null,
    soon: opening.length,
    next: opening[0] ?? null,
    allCinemas: db.all('SELECT count(*) FROM cinemas WHERE stored')[0][0] as number,
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

const RATINGS = `
  LEFT JOIN ratings imdb ON imdb.film_id = f.id AND imdb.source = 'imdb'
  LEFT JOIN ratings mc ON mc.film_id = f.id AND mc.source = 'metacritic'`;

export function films(db: Db, scope: Scope): FilmRow[] {
  const [where, params] = scoped(scope);
  return db
    .all(
      `SELECT f.id, f.title, f.certificate, f.runtime, f.release_date, imdb.score, mc.score,
              count(DISTINCT s.cinema_id), count(*), min(s.starts_at)
       FROM screenings s JOIN films f ON f.id = s.film_id ${RATINGS}
       WHERE ${where} AND ${UPCOMING}
       GROUP BY f.id ORDER BY lower(f.title)`,
      [...params, scope.now],
    )
    .map(([id, title, certificate, runtime, release, imdb, metacritic, cinemas, showings, next]) => ({
      id, title, certificate, runtime, release, imdb, metacritic, cinemas, showings, next,
    })) as FilmRow[];
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

export function film(db: Db, id: string): Film | null {
  const rows = db.all(
    `SELECT f.id, f.title, f.runtime, f.certificate, f.release_date, f.genres, f.people,
            f.distributor, f.synopsis, f.trailer_url, imdb.score, imdb.external_id, mc.score
     FROM films f ${RATINGS} WHERE f.id = ?`,
    [id],
  );
  if (!rows.length) return null;
  const [, title, runtime, certificate, release, genres, people, distributor, synopsis, trailer, imdb, imdbId, metacritic] =
    rows[0] as never[];
  return {
    id, title, runtime, certificate, release, distributor, synopsis, trailer, imdb, imdbId, metacritic,
    genres: JSON.parse(genres),
    people: JSON.parse(people),
  };
}

export interface CinemaRow {
  id: string;
  name: string;
  city: string;
  films: number;
  showings: number;
  next: string | null;
}

/** Every stored cinema, or only those showing one film. Ticks do not narrow this list. */
export function cinemas(db: Db, scope: Scope, filmId?: string): CinemaRow[] {
  const film = filmId ? 'AND s.film_id = ?' : '';
  return db
    .all(
      `SELECT c.id, c.name, coalesce(c.address->>'city', ''), count(DISTINCT s.film_id),
              count(s.id), min(s.starts_at)
       FROM cinemas c
       ${filmId ? 'JOIN' : 'LEFT JOIN'} screenings s
         ON s.cinema_id = c.id AND ${UPCOMING} ${film}
       WHERE c.stored GROUP BY c.id ORDER BY lower(c.name)`,
      filmId ? [scope.now, filmId] : [scope.now],
    )
    .map(([id, name, city, films, showings, next]) => ({ id, name, city, films, showings, next })) as CinemaRow[];
}

export interface SoonRow {
  id: string;
  title: string;
  certificate: string;
  release: string;
  cinemas: number;
}

/** Films not yet released that the scoped cinemas have announced. */
export function soon(db: Db, scope: Scope): SoonRow[] {
  const [where, params] = scoped(scope, 'a.cinema_id');
  return db
    .all(
      `SELECT f.id, f.title, f.certificate, f.release_date, count(DISTINCT a.cinema_id)
       FROM availability a JOIN films f ON f.id = a.film_id
       WHERE ${where} AND f.release_date > ?
       GROUP BY f.id ORDER BY f.release_date, lower(f.title)`,
      [...params, scope.today],
    )
    .map(([id, title, certificate, release, cinemas]) => ({ id, title, certificate, release, cinemas })) as SoonRow[];
}

export interface DateRow {
  date: string;
  films: number;
  showings: number;
}

export function dates(db: Db, scope: Scope): DateRow[] {
  const [where, params] = scoped(scope);
  return db
    .all(
      `SELECT s.business_date, count(DISTINCT s.film_id), count(*)
       FROM screenings s WHERE ${where} AND ${UPCOMING}
       GROUP BY s.business_date ORDER BY s.business_date`,
      [...params, scope.now],
    )
    .map(([date, films, showings]) => ({ date, films, showings })) as DateRow[];
}

const SCREEN_NAME = "CASE WHEN s.screen GLOB 'Screen *' THEN substr(s.screen, 8) ELSE s.screen END";
const NUMBERED = `(${SCREEN_NAME} <> '' AND ${SCREEN_NAME} NOT GLOB '*[^0-9]*')`;

/** Sort orders for the showtimes table. Numbered screens come before named ones. */
export const SHOWING_ORDERS: Record<string, (direction: string) => string> = {
  date: (d) => `s.starts_at ${d}`,
  time: (d) => `s.time ${d}`,
  film: (d) => `lower(f.title) ${d}`,
  cinema: (d) => `lower(c.name) ${d}`,
  screen: (d) =>
    `NOT ${NUMBERED} ${d}, CASE WHEN ${NUMBERED} THEN CAST(${SCREEN_NAME} AS INTEGER) END ${d}, ${SCREEN_NAME} ${d}`,
  seats: (d) => `sc.capacity ${d} NULLS LAST`,
};

export function showings(
  db: Db,
  scope: Scope,
  filter: ShowingFilter,
  order = 'date',
  descending = false,
  limit = 200,
  offset = 0,
): { rows: Showing[]; total: number } {
  const [where, params] = scoped(scope);
  const clauses = [where, UPCOMING];
  params.push(scope.now);
  const add = (clause: string, ...values: unknown[]) => {
    clauses.push(clause);
    params.push(...values);
  };
  if (filter.from) add('s.business_date >= ?', filter.from);
  if (filter.to) add('s.business_date <= ?', filter.to);
  if (filter.film) add('s.film_id = ?', filter.film);
  if (filter.cinema) add('s.cinema_id = ?', filter.cinema);
  if (filter.text)
    add(
      `instr(lower(f.title || ' ' || c.name || ' ' || s.screen || ' ' || s.time || ' ' || s.experiences), ?) > 0`,
      filter.text.toLowerCase(),
    );
  const ordering = (SHOWING_ORDERS[order] ?? SHOWING_ORDERS.date)(descending ? 'DESC' : 'ASC');
  const rows = db.all(
    `SELECT s.cinema_id, s.id, s.film_id, s.business_date, s.starts_at, s.time, f.title, c.name,
            s.screen, sc.capacity, s.experiences, s.sold_out, count(*) OVER ()
     FROM screenings s
     JOIN films f ON f.id = s.film_id
     JOIN cinemas c ON c.id = s.cinema_id
     LEFT JOIN screens sc ON sc.cinema_id = s.cinema_id AND sc.screen_id = s.screen_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY ${ordering}, s.starts_at, s.cinema_id, s.id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return {
    total: rows.length ? (rows[0][12] as number) : 0,
    rows: rows.map(
      ([cinemaId, id, filmId, date, startsAt, time, title, cinema, screen, capacity, experiences, soldOut]) =>
        ({
          cinemaId, id, filmId, date, startsAt, time, title, cinema, screen, capacity,
          experiences: JSON.parse(experiences as string),
          soldOut: Boolean(soldOut),
        }) as Showing,
    ),
  };
}

/** When the listings were last fetched from ODEON, or null before the first ingest. */
export function ingested(db: Db): string | null {
  return db.all("SELECT max(finished_at) FROM runs WHERE source = 'odeon' AND status = 'ok'")[0][0] as
    | string
    | null;
}
