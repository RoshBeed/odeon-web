# Agent notes

- Two parts: `ingest/` (Python, uv) writes one SQLite file; `site/` (Vite, TypeScript, no UI
  framework) is a static page that holds the listings in memory. Its build (`npm run listings`)
  turns the file into JSON documents (every cinema, and Greater London alone, which is loaded
  while only its cinemas are ticked); the browser runs no SQL and no WebAssembly.
- The schema lives in `ingest/src/odeon_ingest/store.py`. The site's tests read it from there,
  so change the schema and `site/src/export.ts` together. `site/src/queries.ts` answers every
  question with a loop over the showings; keep key presses free of anything slower.
- Films with a showing ODEON tags `Event Cinema` are left out unless the address has
  `?show=events`. That tag is the only marker of such screenings in ODEON's data.
- ODEON lists each film twice, once for the UK and once for Ireland. The export merges films
  whose titles match apart from case and punctuation into the edition with the most showings.
- The file is both what the site shows and the ingest's only state between runs (release week,
  run history, screen sizes). It is published as the `data` release asset, never committed.
- Keep ODEON traffic minimal: one ingest per release week, no retry loops, and never fetch
  per-screening live data. Tests use a fake ODEON.
- There is no server and no secret in the site. The site is one finder (`site/src/main.ts`):
  columns of choices, then the showtimes, then the details. Every page the site once had is a
  column a visitor can add (`FACETS` in `queries.ts`; `q.find` counts each column with the
  others' choices applied). What is shown at all is in the query string
  (`?cinemas=london&hidden=…&show=events`; Greater London ticked whole is written `london`),
  and the view in the hash (`#/?cols=day,film,screen&film=…&order=film:rating&col=2&row=5`),
  so a bookmark is a saved view. Nothing is stored in the browser. The default view is Cinema then
  Film, over every cinema. On a phone one column shows at a time.
- This repository is public. Never commit credentials; the tailnet identity and the OMDb key are
  GitHub Actions secrets.
- `site/e2e/` holds Playwright tests that drive the built site by keys, clicks and scrolling
  against a small set of listings (`npm run e2e`; `PW_CHANNEL=chrome` uses an installed Chrome).
  Add one for any change to how the site is navigated.
- Ship through a pull request and CI. The Deploy workflow publishes `main` to GitHub Pages.
