// Writes the listings the site downloads: node scripts/export.ts <odeon.sqlite> <listings.json.gz>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { exportListings } from '../src/export.ts';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error('usage: node scripts/export.ts <odeon.sqlite> <listings.json.gz>');
  process.exit(2);
}
const data = exportListings(new DatabaseSync(from, { readOnly: true }));
mkdirSync(dirname(to), { recursive: true });
writeFileSync(to, gzipSync(JSON.stringify(data)));
console.log(`Wrote ${data.rows.length} showings to ${to}`);
