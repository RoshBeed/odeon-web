// Chains put what is special about some showings into the film's title: the format
// ("(4DX) Wicked", "Wicked - 3D"), the year, subtitles or the language spoken, or an
// event ("- Senior Screening", "+ Q&A", "(20th Anniversary)"). Those come off the title,
// so that each chain's listing of a film is one film, and stay on its showings as tags.
// Only what is known comes off: anything else may be part of the name
// ("Mission: Impossible - Dead Reckoning"), and stays.
import type { TagKind } from './tags';

export interface Tag { label: string; kind: TagKind }
export interface Edition {
  /** The title without its decorations. */
  title: string;
  /** The year it gives, as in "Heat (1995)"; a remake has another. */
  year: number | null;
  tags: Tag[];
}

const LANGUAGES = new Set([
  'arabic', 'bengali', 'bulgarian', 'cantonese', 'french', 'german', 'greek', 'gujarati', 'hindi', 'hungarian', 'italian',
  'japanese', 'kannada', 'korean', 'lithuanian', 'malayalam', 'mandarin', 'marathi', 'nepali', 'persian', 'polish',
  'portuguese', 'punjabi', 'romanian', 'russian', 'sinhala', 'spanish', 'tamil', 'telugu', 'turkish', 'ukrainian', 'urdu',
]);
const PICTURE: Record<string, string> = { '3d': '3D', '4dx': '4DX', imax: 'IMAX', screenx: 'ScreenX', 'd-box': 'D-BOX', '35mm': '35mm', '70mm': '70mm', '4k': '4K' };
const SUBTITLED: Tag = { label: 'English subtitles', kind: 'Language' };

/** What a decoration says about the showings, or null when it may be part of the name. */
function decoration(raw: string): { year?: number; tags: Tag[] } | null {
  const text = raw.trim().replace(/\.$/, '').replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  if (/^(19|20)\d\d$/.test(text)) return { year: Number(text), tags: [] };
  if (lower === '2d') return { tags: [] };
  if (PICTURE[lower]) return { tags: [{ label: PICTURE[lower], kind: 'Picture' }] };
  if (LANGUAGES.has(lower)) return { tags: [{ label: text[0].toUpperCase() + lower.slice(1), kind: 'Language' }] };
  if (/^(subbed|subtitled|subtitled screening)$/.test(lower)) return { tags: [SUBTITLED] };
  const tags: Tag[] = [];
  // "50th Anniversary 4K Restoration", "Re-Release 2026", "with Exclusive Preview"
  if (/\b\d+(st|nd|rd|th) anniversary\b/.test(lower)) tags.push({ label: 'Anniversary', kind: 'Events' });
  if (/\b(4k )?restoration\b|\b4k\b/.test(lower)) tags.push({ label: 'Restoration', kind: 'Picture' });
  if (/\bre-?release\b|^reissue$/.test(lower)) tags.push({ label: 'Re-release', kind: 'Events' });
  if (/\bpreview\b/.test(lower)) tags.push({ label: 'Preview', kind: 'Events' });
  if (/\bpremiere\b/.test(lower)) tags.push({ label: 'Premiere', kind: 'Events' });
  if (/\bencore\b/.test(lower)) tags.push({ label: 'Encore', kind: 'Events' });
  if (/\bq ?[&+] ?a\b/.test(lower)) tags.push({ label: 'Q&A', kind: 'Events' });
  if (/\bdirector'?s'? cut\b/.test(lower)) tags.push({ label: "Director's Cut", kind: 'Events' });
  if (/\b(pyjama|pj) party\b/.test(lower)) tags.push({ label: 'Pyjama Party', kind: 'Events' });
  if (/\bdiscussion\b/.test(lower)) tags.push({ label: 'Discussion', kind: 'Events' });
  if (/\bintro(duction)?\b/.test(lower)) tags.push({ label: 'Intro', kind: 'Events' });
  if (/\b(mulled wine|mince pies|carols|festive)\b/.test(lower)) tags.push({ label: 'Festive', kind: 'Events' });
  if (/\bsing[- ]?a?[- ]?long\b/.test(lower)) tags.push({ label: 'Sing-along', kind: 'Events' });
  if (/\bfilm club$/.test(lower)) tags.push({ label: 'Film Club', kind: 'Events' });
  if (/\blive on stage\b|\bbroadcast$/.test(lower)) tags.push({ label: 'Live', kind: 'Events' });
  if (/\b(relaxed|autism friendly)\b/.test(lower)) tags.push({ label: 'Relaxed', kind: 'Accessibility' });
  else if (/ screening$/.test(lower)) tags.push({ label: text.replace(/ screening$/i, ''), kind: 'Events' }); // "Senior Screening"
  return tags.length ? { tags } : null;
}

/** Series a cinema puts before the title ("Film Club: Sunset Boulevard"); each is an event. */
const SERIES = /^(film club|toddler club|throwback|see it first|green screen|[\w-]+(?: [\w-]+)? screening)\s*[:–—-]\s+(.+)$/i;
/** Words that end a title without a bracket or dash, and are never a film's own ("Dune: Part Two Reissue"). */
const ENDINGS = /^(.*?)[\s:]+(reissue|pyjama party|pj party|relaxed screening|sing[- ]?a?[- ]?long)$/i;

export function edition(raw: string): Edition {
  let title = raw.trim().replace(/[‘’]/g, "'").replace(/&amp;/g, '&');
  let year: number | null = null;
  const tags: Tag[] = [];
  const take = (found: ReturnType<typeof decoration>, rest: string) => {
    if (!found || !rest.trim()) return false;
    year ??= found.year ?? null;
    tags.push(...found.tags);
    title = rest.trim();
    return true;
  };
  for (let changed = true; changed;) {
    const leading = /^[([]([^)\]]+)[)\]]\s*(.*)$/.exec(title); // "(4DX) The Polar Express"
    const bracket = /^(.*?)\s*[([]([^)\]]+)[)\]]\.?$/.exec(title); // "Heat (1995)"
    const dash = /^(.*?)\s*[-–—]\s+([^-–—]+)$/.exec(title); // "Wicked - 3D"
    // "… + Q&A", "… + Mulled Wine & Mince Pies"; a "+" the add-on list does not know stays: Romeo + Juliet.
    const plus = /^(.*?)\s*\+\s+(.+)$/.exec(title);
    const colon = /^(.*?):\s+(.+)$/.exec(title); // "The Polar Express: Relaxed Screening"
    const series = SERIES.exec(title);
    const ending = ENDINGS.exec(title);
    changed = (leading !== null && take(decoration(leading[1]), leading[2]))
      || (bracket !== null && take(decoration(bracket[2]), bracket[1]))
      || (dash !== null && take(decoration(dash[2]), dash[1]))
      || (plus !== null && take(decoration(plus[2]), plus[1]))
      || (colon !== null && take(decoration(colon[2]), colon[1]))
      || (series !== null && take({ tags: [{ label: series[1].replace(/ screening$/i, '').replace(/-/g, ' '), kind: 'Events' }] }, series[2]))
      || (ending !== null && take(decoration(ending[2]), ending[1]));
  }
  return { title, year, tags };
}

/** Titles that match once case, punctuation and spacing are set aside. */
export const titleKey = (title: string) => title.toLowerCase().replace(/^nt live\b/, 'national theatre live').replace(/[^\p{L}\p{N}]+/gu, '');

/** A looser key that also drops every bracket and dash suffix, to find titles that may be one film yet were not merged. */
export const looseKey = (title: string) => titleKey(title.replace(/[([][^)\]]*[)\]]/g, '').split(/\s[-–—|+]\s/)[0]);
