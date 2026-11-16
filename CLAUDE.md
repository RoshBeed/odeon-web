# Agent notes

- Two parts: `ingest/` (Python, uv) writes one SQLite file; `site/` (Vite, TypeScript, no UI
  framework) is a static page that holds the listings in memory. Its build (`npm run listings`)
  turns the file into one JSON document; the browser runs no SQL and no WebAssembly.
- The schema lives in `ingest/src/odeon_ingest/store.py`. The site's tests read it from there,
  so change the schema and `site/src/export.ts` together. `site/src/queries.ts` answers every
  question with a loop over the showings; keep key presses free of anything slower.
- The file is both what the site shows and the ingest's only state between runs (release week,
  run history, screen sizes). It is published as the `data` release asset, never committed.
- Keep ODEON traffic minimal: one ingest per release week, no retry loops, and never fetch
  per-screening live data. Tests use a fake ODEON.
- There is no server and no secret in the site. Visitor settings stay in the browser
  (`localStorage`).
- This repository is public. Never commit credentials; the tailnet identity and the OMDb key are
  GitHub Actions secrets.
- Ship through a pull request and CI. The Deploy workflow publishes `main` to GitHub Pages.
