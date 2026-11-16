# Agent notes

- Two parts: `ingest/` (Python, uv) writes one SQLite file; `site/` (Vite, TypeScript, no UI
  framework) is a static page that downloads the file and queries it in the browser.
- The schema lives in `ingest/src/odeon_ingest/store.py`. The site's tests read it from there,
  so change the schema and `site/src/queries.ts` together.
- The file is both what the site shows and the ingest's only state between runs (release week,
  run history, screen sizes). It is published as the `data` release asset, never committed.
- Keep ODEON traffic minimal: one ingest per release week, no retry loops, and never fetch
  per-screening live data. Tests use a fake ODEON.
- There is no server and no secret in the site. Visitor settings stay in the browser
  (`localStorage`).
- This repository is public. Never commit credentials; the tailnet identity and the OMDb key are
  GitHub Actions secrets.
- Ship through a pull request and CI. The Deploy workflow publishes `main` to GitHub Pages.
