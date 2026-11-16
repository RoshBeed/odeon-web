import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test } from 'vitest';
import { exportListings } from './export';
import * as q from './queries';

// The tables are the ingest's own, so a schema change that breaks the export fails here.
const store = readFileSync(new URL('../../ingest/src/odeon_ingest/store.py', import.meta.url), 'utf8');
const SCHEMA = /SCHEMA = """([\s\S]*?)"""/.exec(store)![1];

let sqlite: DatabaseSync;
let db: q.Listings;
// Wednesday 11 November 2026, 09:00 in London.
const scope: q.Scope = { cinemas: [], hidden: [], now: '2026-11-11T09:00:00Z', today: '2026-11-11' };

function screening(id: string, cinema: string, film: string, date: string, time: string, extra: Partial<Record<string, unknown>> = {}) {
  const row = { screen: 'Screen 1', screen_id: `${cinema}-1`, experiences: '[]', seating: '[]', sold_out: 0, ...extra };
  sqlite
    .prepare('INSERT INTO screenings VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)')
    .run(cinema, id, film, date, `${date}T${time}:00Z`, time, row.screen as string, row.screen_id as string, row.experiences as string, row.seating as string, row.sold_out as number);
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.exec(`
    INSERT INTO cinemas VALUES ('155', 'London West End', 1, '{"city":"London"}', 51.5, -0.1),
                               ('001', 'Aberdeen', 1, '{}', NULL, NULL);
    INSERT INTO films VALUES ('F1', 'Dune', 155, '12A', '2026-11-06', '["Sci-Fi"]',
                              '[{"name":"Denis Villeneuve","roles":["Director"]}]', 'Warner', 'Sand.', NULL),
                             ('F2', 'Paddington', 100, 'PG', '2026-10-01', '[]', '[]', '', '', NULL),
                             ('F3', 'Later', NULL, '', '2026-12-25', '[]', '[]', '', '', NULL);
    INSERT INTO availability VALUES ('155', 'F3', '["ComingSoon"]'), ('155', 'F1', '["NowShowing"]');
    INSERT INTO screens VALUES ('155', '155-1', 300);
    INSERT INTO ratings VALUES ('F1', 'imdb', 8.4, 'tt1'), ('F1', 'metacritic', 74, NULL);
    INSERT INTO runs (source, started_at, finished_at, status) VALUES ('odeon', 'a', '2026-11-10T05:00:00Z', 'ok');
  `);
  screening('155-0', '155', 'F1', '2026-11-11', '08:00'); // already started
  screening('155-1', '155', 'F1', '2026-11-11', '18:00', { experiences: '["IMAX"]', seating: '["Recliner Saver","Recliner","Premier"]' });
  screening('155-2', '155', 'F2', '2026-11-14', '12:00', { screen: 'The Lounge', screen_id: '155-L', sold_out: 1 });
  screening('001-1', '001', 'F1', '2026-11-20', '20:00', { screen: 'Screen 10', screen_id: '001-10' });
  db = q.open(exportListings(sqlite));
});

describe('queries', () => {
  test('the weekend is Friday to Sunday, or what is left of it', () => {
    expect(q.weekend('2026-11-11')).toEqual(['2026-11-13', '2026-11-15']);
    expect(q.weekend('2026-11-14')).toEqual(['2026-11-14', '2026-11-15']);
  });

  test('home counts only what has not started', () => {
    const home = q.home(db, scope);
    expect([home.films, home.showings, home.cinemas, home.tonight, home.weekendShows]).toEqual([2, 3, 2, 1, 1]);
    expect([home.days, home.from, home.to, home.soon, home.next?.title]).toEqual([3, '2026-11-11', '2026-11-20', 1, 'Later']);
  });

  test('ticked cinemas narrow every count', () => {
    const ticked = { ...scope, cinemas: ['001'] };
    expect(q.home(db, ticked).showings).toBe(1);
    expect(q.films(db, ticked).map((film) => film.title)).toEqual(['Dune']);
    expect(q.soon(db, ticked)).toEqual([]);
    expect(q.dates(db, ticked)).toEqual([{ date: '2026-11-20', films: 1, showings: 1 }]);
    expect(q.showings(db, ticked, {}).total).toBe(1);
  });

  test('films carry ratings, cinema counts and their next showing', () => {
    expect(q.films(db, scope)[0]).toEqual({
      id: 'F1', title: 'Dune', certificate: '12A', runtime: 155, release: '2026-11-06',
      imdb: 8.4, metacritic: 74, cinemas: 2, showings: 2, next: '2026-11-11T18:00:00Z',
    });
    const film = q.film(db, 'F1')!;
    expect([film.genres, film.people[0].name, film.imdbId]).toEqual([['Sci-Fi'], 'Denis Villeneuve', 'tt1']);
    expect(q.film(db, 'nope')).toBeNull();
  });

  test('cinemas list every stored cinema, or those showing one film', () => {
    expect(q.cinemas(db, scope).map((c) => [c.name, c.city, c.films, c.showings])).toEqual([
      ['Aberdeen', '', 1, 1],
      ['London West End', 'London', 2, 2],
    ]);
    expect(q.cinemas(db, scope, 'F2').map((c) => c.id)).toEqual(['155']);
  });

  test('showtimes filter, search, sort and page', () => {
    const ids = (filter: q.ShowingFilter, order = 'date', descending = false) =>
      q.showings(db, scope, filter, order, descending).rows.map((row) => row.id);
    expect(ids({})).toEqual(['155-1', '155-2', '001-1']);
    expect(ids({ from: '2026-11-13', to: '2026-11-15' })).toEqual(['155-2']);
    expect(ids({ film: 'F1', cinema: '155' })).toEqual(['155-1']);
    expect(ids({ text: 'IMAX' })).toEqual(['155-1']);
    expect(ids({ text: 'aberdeen' })).toEqual(['001-1']);
    // Screen 1, Screen 10, then the named screen.
    expect(ids({}, 'screen')).toEqual(['155-1', '001-1', '155-2']);
    expect(ids({}, 'screen', true)).toEqual(['155-2', '001-1', '155-1']);
    expect(ids({}, 'seats')[0]).toBe('155-1');
    expect(ids({}, 'film', true)[0]).toBe('155-2');
    const page = q.showings(db, scope, {}, 'date', false, 1, 1);
    expect([page.total, page.rows[0].id, page.rows[0].soldOut, page.rows[0].capacity]).toEqual([3, '155-2', true, null]);
    expect(q.showings(db, scope, {}).rows[0]).toMatchObject({ experiences: ['IMAX'], capacity: 300, cinema: 'London West End' });
  });

  test('hidden films drop out of every list', () => {
    const hiding = { ...scope, hidden: ['F1'] };
    expect(q.films(db, hiding).map((film) => film.id)).toEqual(['F2']);
    expect(q.showings(db, hiding, {}).total).toBe(1);
    expect(q.soon(db, { ...scope, hidden: ['F3'] })).toEqual([]);
    expect(q.titles(db, ['F2', 'F1'])).toEqual([{ id: 'F1', title: 'Dune' }, { id: 'F2', title: 'Paddington' }]);
  });

  test('films narrow by certificate, genre, person and distributor', () => {
    const ids = (filter: q.FilmFilter) => q.films(db, scope, filter).map((film) => film.id);
    expect(ids({ certificate: 'PG' })).toEqual(['F2']);
    expect(ids({ genre: 'Sci-Fi' })).toEqual(['F1']);
    expect(ids({ person: 'Denis Villeneuve' })).toEqual(['F1']);
    expect(ids({ distributor: 'Warner' })).toEqual(['F1']);
    expect(ids({ genre: 'Western' })).toEqual([]);
  });

  test('facets count films and showings by what the film is', () => {
    expect(q.facet(db, scope, 'certificate')).toEqual([
      { name: '12A', role: null, films: 1, showings: 2 },
      { name: 'PG', role: null, films: 1, showings: 1 },
    ]);
    expect(q.facet(db, scope, 'genre')).toEqual([{ name: 'Sci-Fi', role: null, films: 1, showings: 2 }]);
    expect(q.facet(db, scope, 'person')).toEqual([{ name: 'Denis Villeneuve', role: 'Director', films: 1, showings: 2 }]);
    expect(q.facet(db, scope, 'distributor').map((row) => row.name)).toEqual(['Warner']);
  });

  test('tags and seat types are counted once per showing, without price tiers', () => {
    expect(q.tags(db, scope, 'experiences')).toEqual([{ tag: 'IMAX', showings: 1, films: 1, cinemas: 1 }]);
    expect(q.tags(db, scope, 'seating')).toEqual([
      { tag: 'Premier', showings: 1, films: 1, cinemas: 1 },
      { tag: 'Recliner', showings: 1, films: 1, cinemas: 1 },
    ]);
    const ids = (filter: q.ShowingFilter) => q.showings(db, scope, filter).rows.map((row) => row.id);
    expect(ids({ tag: 'IMAX' })).toEqual(['155-1']);
    expect(ids({ seat: 'Recliner' })).toEqual(['155-1']);
    expect(ids({ seat: 'Recliner Saver' })).toEqual([]);
    expect(ids({ cinema: '155', screen: '155-L' })).toEqual(['155-2']);
  });

  test('screens list their size, showings and tags, biggest first', () => {
    expect(q.screens(db, scope)[0]).toEqual({
      cinemaId: '155', screenId: '155-1', cinema: 'London West End', screen: 'Screen 1',
      capacity: 300, showings: 1, tags: ['IMAX'],
    });
    expect(q.screens(db, scope)).toHaveLength(3);
  });

  test('one showing carries what its page and a calendar entry need', () => {
    expect(q.showing(db, '155', '155-1')).toMatchObject({
      title: 'Dune', cinema: 'London West End', runtime: 155, capacity: 300,
      seating: ['Recliner Saver', 'Recliner', 'Premier'], address: { city: 'London' }, filmEndsAt: null,
    });
    expect(q.showing(db, '155', 'gone')).toBeNull();
  });

  test('editions of one film are merged, and event cinema can be left out', () => {
    sqlite.exec(`
      INSERT INTO films VALUES ('F1-IE', 'DUNE ', 150, '12', '2026-11-06', '[]', '[]', 'Warner IR', '', NULL),
                               ('F4', 'Live: Opera!', 180, '', '2026-11-01', '[]', '[]', '', '', NULL),
                               ('F4-IE', 'Live Opera', 180, '', '2026-11-01', '[]', '[]', '', '', NULL);
      INSERT INTO ratings VALUES ('F4-IE', 'imdb', 7.1, 'tt4');
      INSERT INTO availability VALUES ('001', 'F1-IE', '["NowShowing"]');
    `);
    screening('001-2', '001', 'F1-IE', '2026-11-21', '20:00');
    screening('155-3', '155', 'F4', '2026-11-12', '19:00', { experiences: '["Event Cinema"]' });
    screening('155-4', '155', 'F4', '2026-11-13', '19:00', { experiences: '["Event Cinema"]' });
    screening('001-3', '001', 'F4-IE', '2026-11-12', '19:00'); // an event even where a showing lacks the tag
    db = q.open(exportListings(sqlite));
    expect(q.films(db, scope).map((film) => [film.id, film.title, film.showings, film.imdb])).toEqual([
      ['F1', 'Dune', 3, 8.4],
      ['F4', 'Live: Opera!', 3, 7.1],
      ['F2', 'Paddington', 1, null],
    ]);
    expect(q.film(db, 'F1-IE')).toBeNull();
    const quiet = { ...scope, noEvents: true };
    expect(q.films(db, quiet).map((film) => film.id)).toEqual(['F1', 'F2']);
    expect(q.showings(db, quiet, {}).total).toBe(4);
    expect(q.home(db, quiet).showings).toBe(4);
    expect(q.cinemas(db, quiet).map((cinema) => cinema.showings)).toEqual([2, 2]);
    // The film is an event at cinema 001 too, though only cinema 155's showings carry the tag.
    const some = q.open(exportListings(sqlite, new Set(['001'])));
    expect(q.films(some, quiet).map((film) => film.id)).toEqual(['F1']);
  });

  test('listings for some cinemas keep every cinema and film, but only their showings', () => {
    const some = q.open(exportListings(sqlite, new Set(['001'])));
    expect(q.showings(some, scope, {}).rows.map((row) => row.id)).toEqual(['001-1']);
    expect(q.soon(some, scope)).toEqual([]);
    expect(q.cinemas(some, scope).map((cinema) => [cinema.name, cinema.showings])).toEqual([['Aberdeen', 1], ['London West End', 0]]);
    expect(q.film(some, 'F2')?.title).toBe('Paddington');
  });

  test('the last successful ingest is reported', () => {
    expect(db.ingested).toBe('2026-11-10T05:00:00Z');
  });
});
