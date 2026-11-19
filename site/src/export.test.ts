import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { everyman } from './chains/boxoffice';
import { odeon } from './chains/odeon';
import { exportListings } from './export';

const store = readFileSync(new URL('../../ingest/src/showtimes_ingest/store.py', import.meta.url), 'utf8');
const SCHEMA = /SCHEMA = """([\s\S]*?)"""/.exec(store)![1];

function chain(cinema: string, film: [string, string, string | null, string], shows: number) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.prepare("INSERT INTO cinemas VALUES (?, 'Somewhere', 1, '{\"city\":\"Bath\",\"postcode\":\"BA1 1SS\"}', NULL, NULL)").run(cinema);
  sqlite.prepare("INSERT INTO films VALUES (?, ?, NULL, '', NULL, '[]', '[]', '', ?, ?)").run(film[0], film[1], film[3], film[2]);
  const add = sqlite.prepare("INSERT INTO screenings VALUES (?, ?, ?, '2026-11-20', ?, '18:00', NULL, NULL, 'Screen 1', '1', '[]', '[]', 0)");
  for (let n = 0; n < shows; n += 1) add.run(cinema, `s${n}`, film[0], `2026-11-20T18:0${n}:00Z`);
  return sqlite;
}

test("a film two chains list is one film, with the busier listing's own details and the other's to fill the gaps", () => {
  const data = exportListings([
    { chain: odeon, sqlite: chain('155', ['HO1', 'Dune', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'Sand.'], 1) },
    { chain: everyman, sqlite: chain('X1', ['6272', 'DUNE', 'https://m.example/dune.mp4', ''], 3) },
  ]);
  expect(data.films).toHaveLength(1);
  const [film] = data.films;
  expect(film.id).toBe('everyman-6272'); // more showings
  expect(film.synopsis).toBe('Sand.'); // borrowed
  expect(film.trailer).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa'); // the one that plays in the page
  const filmIds = new Set(data.rows.map((row) => data.values[row[2]]));
  expect([...filmIds]).toEqual(['everyman-6272']); // both chains' showings point at it
  expect(data.chains.map((each) => each.id)).toEqual(['odeon', 'everyman']);
});
