// Turns the ingest's SQLite file into the one JSON document the site reads.
// Runs in Node when the site is built (scripts/export.ts) and in the tests.
import type { DatabaseSync } from 'node:sqlite';
import type { Data, Film } from './queries';

/** Everything, or with `only`, the showings and announcements of just those cinemas. */
export function exportListings(sqlite: DatabaseSync, only?: Set<string>): Data {
  // Most of a showing repeats in others (its cinema, film, date, formats),
  // so each distinct value is written once and showings refer to it by number.
  const values: unknown[] = [];
  const numbers = new Map<string, number>();
  const number = (value: unknown) => {
    const key = JSON.stringify(value);
    if (!numbers.has(key)) numbers.set(key, values.push(value) - 1);
    return numbers.get(key)!;
  };
  const all = (sql: string) => {
    const statement = sqlite.prepare(sql);
    statement.setReturnArrays(true); // two columns may share a name
    return statement.all() as unknown as never[][];
  };
  // ODEON lists a film once for the UK and once for Ireland, under two IDs.
  // Titles that match once case and punctuation are set aside become one film:
  // the edition with the most showings, which borrows any rating it lacks.
  const editions = new Map<string, Film[]>();
  const showings = new Map(all('SELECT film_id, count(*) FROM screenings GROUP BY film_id') as unknown as [string, number][]);
  for (const film of all(
    `SELECT f.id, f.title, f.runtime, f.certificate, f.release_date, f.genres, f.people,
            f.distributor, f.synopsis, f.trailer_url, imdb.score, imdb.external_id, mc.score
     FROM films f
     LEFT JOIN ratings imdb ON imdb.film_id = f.id AND imdb.source = 'imdb'
     LEFT JOIN ratings mc ON mc.film_id = f.id AND mc.source = 'metacritic'
     ORDER BY f.id`,
  ).map(([id, title, runtime, certificate, release, genres, people, distributor, synopsis, trailer, imdb, imdbId, metacritic]): Film => ({
    id, title, runtime, certificate, release, distributor, synopsis, trailer, imdb, imdbId, metacritic,
    genres: JSON.parse(genres),
    people: JSON.parse(people),
  }))) {
    const key = film.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') || film.id;
    editions.set(key, [...(editions.get(key) ?? []), film]);
  }
  const merged = new Map<string, string>();
  const films = [...editions.values()].map((group) => {
    const main = group.reduce((best, film) => ((showings.get(film.id) ?? 0) > (showings.get(best.id) ?? 0) ? film : best));
    for (const film of group) {
      merged.set(film.id, main.id);
      main.imdb ??= film.imdb;
      main.imdbId ??= film.imdbId;
      main.metacritic ??= film.metacritic;
    }
    return main;
  });
  const film = (id: string) => merged.get(id) ?? id;
  // ODEON publishes each Friday-to-Thursday week on a Tuesday. The ingest
  // records the Tuesday whose week it holds; that week ends nine days later.
  const [[week] = []] = all("SELECT value FROM state WHERE key = 'release_week'") as unknown as string[][];
  const fullUntil = week ? new Date(Date.parse(week + 'T00:00:00Z') + 9 * 86400000).toISOString().slice(0, 10) : null;
  return {
    fullUntil,
    ingested: all("SELECT max(finished_at) FROM runs WHERE source = 'odeon' AND status = 'ok'")[0][0],
    cinemas: all('SELECT id, name, stored, address FROM cinemas').map(([id, name, stored, address]) => ({
      id, name, stored: Boolean(stored), address: JSON.parse(address),
    })),
    films,
    availability: all('SELECT cinema_id, film_id FROM availability')
      .filter(([cinema]) => !only || only.has(cinema))
      .map(([cinema, id]): [string, string] => [cinema, film(id)]),
    screens: all('SELECT cinema_id, screen_id, capacity FROM screens') as unknown as Data['screens'],
    // From every cinema's showings, so that a film is an event whichever cinemas are exported.
    events: [...new Set(all(
      `SELECT DISTINCT s.film_id FROM screenings s, json_each(s.experiences) tag WHERE tag.value = 'Event Cinema'`,
    ).map(([id]) => film(id)))],
    // In the order the site lists them, which it relies on.
    rows: all(
      `SELECT cinema_id, id, film_id, business_date, starts_at, time, film_starts_at, film_ends_at,
              screen, screen_id, experiences, seating, sold_out
       FROM screenings ORDER BY starts_at, cinema_id, id`,
    ).filter(([cinema]) => !only || only.has(cinema)).map((row) => row.map((value, column) => number(column === 2 ? film(value) : column === 10 || column === 11 ? JSON.parse(value) : value))),
    values,
  };
}
