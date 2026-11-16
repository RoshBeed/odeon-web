// Turns the ingest's SQLite file into the one JSON document the site reads.
// Runs in Node when the site is built (scripts/export.ts) and in the tests.
import type { DatabaseSync } from 'node:sqlite';
import type { Data } from './queries';

export function exportListings(sqlite: DatabaseSync): Data {
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
  return {
    ingested: all("SELECT max(finished_at) FROM runs WHERE source = 'odeon' AND status = 'ok'")[0][0],
    cinemas: all('SELECT id, name, stored, address FROM cinemas').map(([id, name, stored, address]) => ({
      id, name, stored: Boolean(stored), address: JSON.parse(address),
    })),
    films: all(
      `SELECT f.id, f.title, f.runtime, f.certificate, f.release_date, f.genres, f.people,
              f.distributor, f.synopsis, f.trailer_url, imdb.score, imdb.external_id, mc.score
       FROM films f
       LEFT JOIN ratings imdb ON imdb.film_id = f.id AND imdb.source = 'imdb'
       LEFT JOIN ratings mc ON mc.film_id = f.id AND mc.source = 'metacritic'`,
    ).map(([id, title, runtime, certificate, release, genres, people, distributor, synopsis, trailer, imdb, imdbId, metacritic]) => ({
      id, title, runtime, certificate, release, distributor, synopsis, trailer, imdb, imdbId, metacritic,
      genres: JSON.parse(genres),
      people: JSON.parse(people),
    })),
    availability: all('SELECT cinema_id, film_id FROM availability') as unknown as Data['availability'],
    screens: all('SELECT cinema_id, screen_id, capacity FROM screens') as unknown as Data['screens'],
    // In the order the site lists them, which it relies on.
    rows: all(
      `SELECT cinema_id, id, film_id, business_date, starts_at, time, film_starts_at, film_ends_at,
              screen, screen_id, experiences, seating, sold_out
       FROM screenings ORDER BY starts_at, cinema_id, id`,
    ).map((row) => row.map((value, column) => number(column === 10 || column === 11 ? JSON.parse(value) : value))),
    values,
  };
}
