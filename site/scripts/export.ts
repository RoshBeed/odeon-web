// Writes the listings the site downloads: node scripts/export.ts <odeon.sqlite> <folder>
//   listings.json.gz  every cinema
//   london.json.gz    Greater London only, for visitors who tick nothing else
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { exportListings } from '../src/export.ts';
import { LONDON } from '../src/tags.ts';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error('usage: node scripts/export.ts <odeon.sqlite> <folder>');
  process.exit(2);
}
const sqlite = new DatabaseSync(from, { readOnly: true });
mkdirSync(to, { recursive: true });
for (const [name, only] of [['listings', undefined], ['london', LONDON]] as const) {
  const data = exportListings(sqlite, only);
  writeFileSync(`${to}/${name}.json.gz`, gzipSync(JSON.stringify(data)));
  console.log(`Wrote ${data.rows.length} showings to ${to}/${name}.json.gz`);
}
