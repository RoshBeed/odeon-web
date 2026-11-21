// Writes the listings the site downloads, from each chain's SQLite file:
//   node scripts/export.ts <folder> <chain>.sqlite...
//   listings.json.gz  every cinema
//   london.json.gz    Greater London only, for visitors who tick nothing else
//   areas.json        which cinemas are Greater London's, built into the page
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { CHAINS } from '../src/chains/index.ts';
import { exportListings, unmerged, type Source } from '../src/export.ts';

const [to, ...files] = process.argv.slice(2);
if (!to || !files.length) {
  console.error('usage: node scripts/export.ts <folder> <chain>.sqlite...');
  process.exit(2);
}
// Each file is named after its chain: odeon.sqlite.
const sources: Source[] = files.map((file) => {
  const chain = CHAINS[basename(file, '.sqlite')];
  if (!chain) throw new Error(`${file}: no chain named ${basename(file, '.sqlite')} in src/chains/`);
  return { chain, sqlite: new DatabaseSync(file, { readOnly: true }) };
});
mkdirSync(to, { recursive: true });
const all = exportListings(sources);
const london = all.cinemas.filter((cinema) => cinema.town === 'Greater London').map((cinema) => cinema.id);
for (const [name, data] of [['listings', all], ['london', exportListings(sources, new Set(london))]] as const) {
  writeFileSync(`${to}/${name}.json.gz`, gzipSync(JSON.stringify(data)));
  console.log(`Wrote ${data.rows.length} showings to ${to}/${name}.json.gz`);
}
writeFileSync(`${to}/areas.json`, JSON.stringify({ 'Greater London': london }));
// Titles that look alike yet stayed apart: a decoration src/titles.ts does not know yet, or two films.
const apart = unmerged(all);
const lines = [`${apart.length} sets of films look alike but were not merged (src/titles.ts decides):`, '', ...apart.map((titles) => `- ${titles.join(' · ')}`)];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Films not merged\n\n${lines.join('\n')}\n`);
