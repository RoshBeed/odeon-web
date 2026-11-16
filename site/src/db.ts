// The listings: one SQLite file, downloaded once and queried in the browser.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Db } from './queries';

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // Some hosts decompress a .gz file on the way; only unpack what is still packed.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function openListings(url: string): Promise<Db> {
  const [sqlite3, response] = await Promise.all([sqlite3InitModule(), fetch(url)]);
  if (!response.ok) throw new Error(`The listings could not be downloaded (HTTP ${response.status})`);
  const bytes = await gunzip(new Uint8Array(await response.arrayBuffer()));
  const db = new sqlite3.oo1.DB();
  // Hand the downloaded file to SQLite as an in-memory database.
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  db.checkRc(
    sqlite3.capi.sqlite3_deserialize(
      db.pointer!, 'main', pointer, bytes.length, bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE,
    ),
  );
  return {
    all: (sql, params = []) =>
      db.exec({ sql, bind: params.length ? (params as never[]) : undefined, rowMode: 'array', returnValue: 'resultRows' }),
  };
}
