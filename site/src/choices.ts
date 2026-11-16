// The visitor's choices live in the page's address, not in the browser, so a
// bookmark or a shared link carries them: ?cinemas=155,090&hidden=HO00012345

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
