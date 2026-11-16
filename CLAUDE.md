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
- There is no server and no secret in the site. Visitor choices (ticked cinemas, hidden films)
  live in the page's address (`?cinemas=…&hidden=…`), and so does each page's sort, search
  and highlighted row (`#/films?sort=3&row=12`). Lists have no pages: rows are drawn 100 at a
  time as the reader scrolls or moves down. On a wide screen the pages
  show side by side, as Finder's column view does, and the pages that led here are listed in
  the address, separated by `|`; `?view=pages` shows one page at a time, as phones always do.
- `#/find` is the finder (wide screens only): a day, a film, a cinema and a format chosen
  together, each column counting what the other three leave. It is an experiment reached from
  the menu; the menu's other paths do not depend on it.
- `#/` is the welcome page, `#/browse` the menu (always the first column). Each thing has one
  place: cinemas and locations in the menu, the other choices in Settings. A bookmark keeps all of it; nothing is
  stored in the browser.
- This repository is public. Never commit credentials; the tailnet identity and the OMDb key are
  GitHub Actions secrets.
- `site/e2e/` holds Playwright tests that drive the built site by keys, clicks and scrolling
  against a small set of listings (`npm run e2e`; `PW_CHANNEL=chrome` uses an installed Chrome).
  Add one for any change to how the site is navigated.
- Ship through a pull request and CI. The Deploy workflow publishes `main` to GitHub Pages.
