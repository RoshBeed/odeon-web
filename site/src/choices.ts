// The visitor's choices live in the page's address, not in the browser, so a
// bookmark or a shared link carries them: ?cinemas=155,090&hidden=HO00012345
import { LONDON } from './tags';

// Greater London's cinemas all ticked are written as one word: ?cinemas=london
const AREA = 'london';

export function readChoice(search: string, name: string): Set<string> {
  const values = (new URLSearchParams(search).get(name) ?? '').split(',').filter(Boolean);
  return new Set(name === 'cinemas' ? values.flatMap((value) => (value === AREA ? [...LONDON] : [value])) : values);
}

/** The query string for these choices; empty when nothing is chosen. */
export function writeChoices(choices: Record<string, Set<string>>): string {
  const parts = Object.entries(choices)
    .filter(([, chosen]) => chosen.size)
    .map(([name, chosen]) => {
      let values = [...chosen];
      if (name === 'cinemas' && [...LONDON].every((id) => chosen.has(id))) values = [AREA, ...values.filter((id) => !LONDON.has(id))];
      return `${name}=${values.map(encodeURIComponent).join(',')}`;
    });
  return parts.length ? '?' + parts.join('&') : '';
}

/** Whether a page needs every cinema's showings. Greater London's alone will do
 *  while only its cinemas are ticked and the page is not about another one. */
export function needsEveryCinema(route: string, ticks: Set<string>): boolean {
  if (!ticks.size || [...ticks].some((id) => !LONDON.has(id))) return true;
  const [name, a, b] = route.split('/').map(decodeURIComponent);
  if (['cinemas', 'locations', 'location'].includes(name)) return true; // where any cinema can be ticked
  if (['cinema', 'screen', 'show'].includes(name)) return !LONDON.has(a);
  return name === 'film' && b !== undefined && b !== 'all' && !LONDON.has(b);
}

/** Lists are drawn this many rows at a time; more follow as the reader nears the end. */
export const PAGE = 100;

/** How one page is being looked at. */
export interface Ui {
  /** The column sorted by, counted from 0; null for the page's own order. */
  order: number | null;
  descending: boolean;
  text: string;
  /** How many further batches of rows have been drawn. Not in the address: enough for `selected`. */
  page: number;
  selected: number;
}

/** A page and how it is being looked at, from the address after the `#`:
 *  `#/films?sort=3&desc=1&q=wick&row=5`. Rows count from 1 there.
 *  The columns view lists the pages that led here first, each written the same
 *  way and separated by `|`; those come back as `trail`. */
export function readPage(hash: string): { trail: string[]; route: string; ui: Ui } {
  const trail = hash.replace(/^#\/?/, '').split('|');
  const [route, query = ''] = trail.pop()!.split('?');
  const params = new URLSearchParams(query);
  const number = (name: string, missing: number) => {
    const value = Number(params.get(name) ?? missing);
    return Number.isInteger(value) && value >= 0 ? value : missing;
  };
  return {
    trail,
    route,
    ui: {
      order: params.has('sort') ? number('sort', 0) : null,
      descending: params.get('desc') === '1',
      text: params.get('q') ?? '',
      page: Math.floor((Math.max(number('row', 1), 1) - 1) / PAGE),
      selected: Math.max(number('row', 1), 1) - 1,
    },
  };
}

export const PLAIN: Ui = { order: null, descending: false, text: '', page: 0, selected: 0 };

export function writePage(route: string, ui: Ui = PLAIN, trail: string[] = []): string {
  const parts = [
    ui.order === null ? '' : `sort=${ui.order}`,
    ui.descending ? 'desc=1' : '',
    ui.text ? `q=${encodeURIComponent(ui.text)}` : '',
    ui.selected ? `row=${ui.selected + 1}` : '',
  ].filter(Boolean);
  return '#/' + [...trail, route + (parts.length ? '?' + parts.join('&') : '')].join('|');
}
