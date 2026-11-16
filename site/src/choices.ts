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
