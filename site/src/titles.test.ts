import { expect, test } from 'vitest';
import { edition, titleKey } from './titles';

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
});
