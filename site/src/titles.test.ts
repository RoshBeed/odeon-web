import { expect, test } from 'vitest';
import { edition, seriesOff, titleKey } from './titles';

const read = (title: string) => {
  const cut = edition(title);
  return [cut.title, cut.year, cut.tags.map((tag) => `${tag.kind}:${tag.label}`).sort()];
};

test('formats, years, languages and events come off the title as tags', () => {
  expect(read('(4DX) The Polar Express (20th Anniversary)')).toEqual(['The Polar Express', null, ['Events:Anniversary', 'Picture:4DX']]);
  expect(read('Avengers: Doomsday - 3D')).toEqual(['Avengers: Doomsday', null, ['Picture:3D']]);
  expect(read('Heat (1995)')).toEqual(['Heat', 1995, []]);
  expect(read('Ramayana: Rise Of A Legend (Tamil)')).toEqual(['Ramayana: Rise Of A Legend', null, ['Language:Tamil']]);
  expect(read('The Hunger Games: Sunrise On The Reaping - Subtitled Screening')).toEqual(['The Hunger Games: Sunrise On The Reaping', null, ['Language:English subtitles']]);
  expect(read('I Play Rocky - Senior Screening')).toEqual(['I Play Rocky', null, ['Events:Senior']]);
  expect(read('Love Actually - Pyjama Party')).toEqual(['Love Actually', null, ['Events:Pyjama Party']]);
  expect(read('We, The Hated + in person director Q&amp;A')).toEqual(['We, The Hated', null, ['Events:Q&A']]);
  expect(read("It's A Wonderful Life (80th Anniversary) + Mulled Wine & Mince Pies")).toEqual(["It's A Wonderful Life", null, ['Events:Anniversary', 'Events:Festive']]);
  expect(read('Prima Facie + panel')).toEqual(['Prima Facie', null, ['Events:Discussion']]);
  expect(read('Film Club: Sunset Boulevard (4K Restoration)')).toEqual(['Sunset Boulevard', null, ['Events:Film Club', 'Picture:Restoration']]);
  expect(read('Dune: Part Two Reissue')).toEqual(['Dune: Part Two', null, ['Events:Re-release']]);
  expect(read('The Polar Express: Relaxed Screening')).toEqual(['The Polar Express', null, ['Accessibility:Relaxed']]);
});

test('what may be part of the name stays', () => {
  for (const title of ['Mission: Impossible - Dead Reckoning', "William Shakespeare's Romeo + Juliet", 'Dune: Part Three', 'Die Hard [is a Christmas Movie]', 'X-Men', '2046', '(500) Days of Summer']) {
    expect(edition(title).title).toBe(title);
  }
});

test('curly quotes, spacing and NT Live do not keep one film apart', () => {
  expect(titleKey(edition('Andrew Lloyd Webber’s Starlight Express').title)).toBe(titleKey("Andrew Lloyd Webber's Starlight Express"));
  expect(titleKey('Home Alone 2 : Lost in New York')).toBe(titleKey('Home Alone 2: Lost In New York'));
  expect(titleKey('NT Live: The Motive and the Cue')).toBe(titleKey('National Theatre Live: The Motive and the Cue'));
  expect(titleKey('Jet Lag: The Game – Hide and Seek Italy')).toBe(titleKey('Jet Lag: The Game – Hide + Seek Italy'));
  expect(titleKey("We're Going on a Bear Hunt + The Tiger Who Came to Tea")).toBe(titleKey("We're Going on a Bear Hunt + Tiger Who Came To Tea"));
});

test('opera and ballet broadcasts have one name, whatever each chain calls the season', () => {
  const names = ['RBO Live 2026-27: The Nutcracker', 'RBO Cinema Season 2026-27: THE NUTCRACKER', 'ROYAL BALLET & OPERA LIVE: The Nutcracker', 'Royal Ballet & Opera 2026/27: The Nutcracker'];
  expect(new Set(names.map((name) => titleKey(edition(name).title)))).toEqual(new Set([titleKey('Royal Ballet & Opera: The Nutcracker')]));
  expect(read('RBO Encore 2026-27: Manon')).toEqual(['Royal Ballet & Opera: Manon', null, ['Events:Encore']]);
  expect(read('Met Opera Live 2026-27: Manon')).toEqual(['Met Opera: Manon', null, ['Events:Live']]);
  expect(titleKey('Così Fan Tutte')).toBe(titleKey('Cosi fan tutte'));
});

test("a cinema's series comes off a film listed in its own name too; a name's own prefix stays", () => {
  const off = seriesOff([
    'IFF: Hamlet', 'IFF: Charlie the Wonderdog', 'Hamlet', 'Members Preview: Paper Tiger', 'Paper Tiger',
    'Dune: Part Three', 'Dune: Part Two', 'Avengers: Doomsday',
    'The Hunger Games: Sunrise on the Reaping', 'The Hunger Games: Sunrise On The Reaping', 'Sunrise on the Reaping',
    'Twin Peaks: Fire Walk With Me',
  ]);
  expect(off('IFF: Hamlet')).toEqual({ title: 'Hamlet', tags: [{ label: 'IFF', kind: 'Events' }] });
  expect(off('Members Preview: Paper Tiger')).toEqual({ title: 'Paper Tiger', tags: [{ label: 'Preview', kind: 'Events' }] });
  expect(off('IFF: Charlie the Wonderdog')).toBeNull(); // not listed alone
  for (const name of ['Dune: Part Three', 'Avengers: Doomsday', 'The Hunger Games: Sunrise on the Reaping', 'Twin Peaks: Fire Walk With Me']) expect(off(name)).toBeNull();
});
