import { expect, test } from 'vitest';
import { ics } from './calendar';
import { DEFAULT_COLUMNS, needsEveryCinema, readChoice, readView, writeChoices, writeView } from './choices';
import type { ShowingDetail } from './queries';
import { certificateAge, formats, LONDON, place, tagKind, tagLabel } from './tags';

test('tags are grouped and renamed for people', () => {
  expect(['IMAX 3D_Web', 'Hindi (Audio)', 'English (Sub)', 'Audio Described', '£5 Web', 'Kids', 'Recliner'].map(tagKind)).toEqual([
    'Picture', 'Language', 'Language', 'Accessibility', 'Pricing', 'Events', 'Seating',
  ]);
  // ODEON's variants of a picture format are picture formats too.
  expect(['3D - Web', 'XL 3D Web', 'Laser 3D', 'Infinity Vision', 'Dolby', 'Dubbed', 'Watchword'].map(tagKind)).toEqual([
    'Picture', 'Picture', 'Picture', 'Picture', 'Picture', 'Language', 'Accessibility',
  ]);
  expect(['Hindi (Audio)', '3D - Web', 'XL 3D Web', 'XL Web', 'IMAX'].map(tagLabel)).toEqual(['Hindi', '3D', 'XL 3D', 'XL', 'IMAX']);
  expect(formats(['IMAX 3D_Web', 'Saver', 'Wheelchair Accessible', 'English (Sub)', 'Kids'])).toBe('IMAX 3D, English subtitles');
});

test('cinemas are placed by borough, override or address', () => {
  expect(place({ id: '555', name: 'Wimbledon', city: 'London' })).toBe('Greater London');
  expect(place({ id: '031', name: 'Coolock', city: 'Coolock' })).toBe('Dublin');
  expect(place({ id: '1', name: 'Bath', city: ' Bath ' })).toBe('Bath');
  expect(place({ id: '2', name: 'Somewhere', city: '' })).toBe('Somewhere');
});

const show: ShowingDetail = {
  cinemaId: '155', id: '155-1', filmId: 'F1', date: '2026-11-12', startsAt: '2026-11-12T18:00:00Z', time: '18:00', endsAt: '2026-11-12T21:00:00Z',
  title: 'Dune; Part, Two', cinema: 'London West End', screen: 'Screen 1', capacity: 300, experiences: ['IMAX', 'Saver'],
  soldOut: false, filmStartsAt: '2026-11-12T18:25:00Z', filmEndsAt: '2026-11-12T21:00:00Z', runtime: 155,
  seating: [], address: { line1: 'Leicester Square', city: 'London' },
};

test('a calendar entry covers the film, with the cinema as its place', () => {
  const file = ics(show, new Date('2026-11-11T09:00:00Z'));
  expect(file).toContain('DTSTART:20261112T182500Z\r\nDTEND:20261112T210000Z');
  expect(file).toContain('SUMMARY:Dune\\; Part\\, Two · ODEON West End');
  expect(file).toContain('LOCATION:ODEON London West End\\, Leicester Square\\, London');
  expect(file).toContain('DESCRIPTION:Doors 18:00 · Screen 1 · 300 seats · IMAX');
  expect(file).toContain('UID:155.155-1@odeon-web');
});

test('without film times the entry starts after the adverts and lasts the runtime', () => {
  const file = ics({ ...show, filmStartsAt: null, filmEndsAt: null, runtime: 100 }, new Date());
  expect(file).toContain('DTSTART:20261112T182500Z\r\nDTEND:20261112T200500Z');
});

test('choices are read from and written to the address', () => {
  expect([...readChoice('?cinemas=155,090&hidden=HO1', 'cinemas')]).toEqual(['155', '090']);
  expect([...readChoice('?cinemas=155%2C090', 'cinemas')]).toEqual(['155', '090']);
  expect(readChoice('', 'cinemas').size).toBe(0);
  expect(writeChoices({ cinemas: new Set(['155', '090']), hidden: new Set(['HO 1']) })).toBe('?cinemas=155,090&hidden=HO%201');
  expect(writeChoices({ cinemas: new Set(), hidden: new Set(['HO1']) })).toBe('?hidden=HO1');
  expect(writeChoices({ cinemas: new Set(), hidden: new Set() })).toBe('');
});

test("Greater London's listings will do while only its cinemas are ticked", () => {
  expect(needsEveryCinema(new Set())).toBe(true);
  expect(needsEveryCinema(new Set(['155', '090']))).toBe(false);
  expect(needsEveryCinema(new Set(['155', '001']))).toBe(true);
});

test('the view is read from and written to the address', () => {
  const view = readView('#/?cols=film,cinema,screen&film=HO1&cinema=155&order=film:rating&sort=seats&desc=1&q=imax&col=3&row=12');
  expect(view).toEqual({
    columns: ['film', 'cinema', 'screen'], picks: { film: 'HO1', cinema: '155' }, orders: { film: 'rating' },
    focus: 2, row: 11, sort: 'seats', descending: true, text: 'imax',
  });
  expect(writeView(view)).toBe('#/?cols=film,cinema,screen&film=HO1&cinema=155&order=film:rating&sort=seats&desc=1&q=imax&col=3&row=12');
  // The default view is a bare address; unknown columns and choices for hidden columns are dropped.
  expect(writeView(readView('#/'))).toBe('#/');
  expect(readView('#/?cols=film,nonsense,film&day=2026-11-20').columns).toEqual(['film']);
  expect(readView('#/?cols=film&day=2026-11-20').picks).toEqual({});
  expect(readView('').columns).toEqual(DEFAULT_COLUMNS);
});

test('certificates sort by age, with unrated films last', () => {
  const sorted = ['18', 'TBC', 'PG', '12A', 'U', '15', '', 'PG Ire', '15A', 'G']
    .sort((a, b) => (certificateAge(a) ?? 99) - (certificateAge(b) ?? 99));
  expect(sorted).toEqual(['U', 'G', 'PG', 'PG Ire', '12A', '15', '15A', '18', 'TBC', '']);
});

test('Greater London ticked whole is written as one word, and read back as its cinemas', () => {
  const ticks = readChoice('?cinemas=london,001', 'cinemas');
  expect(ticks.size).toBe(LONDON.size + 1);
  expect(writeChoices({ cinemas: ticks })).toBe('?cinemas=london,001');
  ticks.delete('155'); // one London cinema unticked: each is listed again
  expect(writeChoices({ cinemas: ticks })).not.toContain('london');
  expect(readChoice('?hidden=london', 'hidden')).toEqual(new Set(['london']));
});
