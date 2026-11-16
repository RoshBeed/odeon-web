// The visitor's choices live in the page's address, not in the browser, so a
// bookmark or a shared link carries them: ?cinemas=155,090&hidden=HO00012345
import { LONDON } from './tags';

export function readChoice(search: string, name: string): Set<string> {
  return new Set((new URLSearchParams(search).get(name) ?? '').split(',').filter(Boolean));
}

/** The query string for these choices; empty when nothing is chosen. */
export function writeChoices(choices: Record<string, Set<string>>): string {
  const parts = Object.entries(choices)
    .filter(([, chosen]) => chosen.size)
    .map(([name, chosen]) => `${name}=${[...chosen].map(encodeURIComponent).join(',')}`);
  return parts.length ? '?' + parts.join('&') : '';
}

/** Whether a page needs every cinema's showings. Greater London's alone will do
 *  while only its cinemas are ticked and the page is not about another one. */
export function needsEveryCinema(route: string, ticks: Set<string>): boolean {
  if (!ticks.size || [...ticks].some((id) => !LONDON.has(id))) return true;
  const [name, a, b] = route.split('/').map(decodeURIComponent);
  if (['cinemas', 'locations', 'location'].includes(name)) return true; // where any cinema can be ticked
  if (['cinema', 'screen', 'show'].includes(name)) return !LONDON.has(a);
  return name === 'film' && b !== undefined && !LONDON.has(b);
}

/** How one page is being looked at. */
export interface Ui {
  /** The column sorted by, counted from 0; null for the page's own order. */
  order: number | null;
  descending: boolean;
  text: string;
  page: number;
  selected: number;
}

/** A page and how it is being looked at, from the address after the `#`:
 *  `#/films?sort=3&desc=1&q=wick&page=2&row=5`. Pages and rows count from 1 there. */
export function readPage(hash: string): { route: string; ui: Ui } {
  const [route, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const number = (name: string, missing: number) => {
    const value = Number(params.get(name) ?? missing);
    return Number.isInteger(value) && value >= 0 ? value : missing;
  };
  return {
    route,
    ui: {
      order: params.has('sort') ? number('sort', 0) : null,
      descending: params.get('desc') === '1',
      text: params.get('q') ?? '',
      page: Math.max(number('page', 1), 1) - 1,
      selected: Math.max(number('row', 1), 1) - 1,
    },
  };
}

export function writePage(route: string, ui: Ui): string {
  const parts = [
    ui.order === null ? '' : `sort=${ui.order}`,
    ui.descending ? 'desc=1' : '',
    ui.text ? `q=${encodeURIComponent(ui.text)}` : '',
    ui.page ? `page=${ui.page + 1}` : '',
    ui.selected ? `row=${ui.selected + 1}` : '',
  ].filter(Boolean);
  return '#/' + route + (parts.length ? '?' + parts.join('&') : '');
}
