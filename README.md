# ODEON listings

A static site for browsing what is on at ODEON cinemas: films, cinemas and
locations, tonight, this weekend, what opens soon, and every showtime with its
screen and how many seats that screen has. You can also browse by screen size,
picture format, language, seating, rating, people, genre and distributor.
Nothing is booked here; each showing links to ODEON's own booking page and can
be added to your calendar.

There is no server. Once a week a GitHub Actions workflow fetches the listings
from ODEON into one SQLite file. The site is plain files on GitHub Pages; the
browser downloads that file (about 2 MB) and runs every query itself. Cinemas
you tick and films you hide are remembered in your browser. It works on a phone
by tapping, and on a computer by keyboard or mouse.

## Using the site

| Key | Does |
| --- | --- |
| ↑ ↓ | Move |
| Enter | Open the selected row |
| Esc | Go back |
| / | Search the table |
| s, or a click on a heading | Sort |
| n, p | Next and previous page |
| Space | Tick a cinema, or every cinema in a location |
| h | Hide a film everywhere, or show it again |
| b | Book the selected showing on odeon.co.uk |
| c | Add the selected showing to your calendar |

Everything also works by clicking or tapping. On a phone each row is a card and
sorting is a menu above the list.

## How it is put together

| Part | Where | What it does |
| --- | --- | --- |
| Ingest | `ingest/` (Python) | Fetches the week's listings and ratings and writes the SQLite file |
| Site | `site/` (TypeScript, Vite) | The interface; queries the file with SQLite compiled to WebAssembly |
| Listings | the `data` release of this repository | The published `odeon.sqlite.gz`; also the ingest's only memory between runs |
| Workflows | `.github/workflows/` | `Ingest` (weekly), `Deploy` (GitHub Pages), `CI` |

The Ingest workflow checks hourly on Tuesdays and Wednesdays, when ODEON
publishes the week. Once the week is stored a check contacts nobody. When the
file changes it calls Deploy, which builds the new listings into the site.

ODEON refuses requests from cloud providers' addresses, GitHub's runners
included. The ingest therefore sends its ODEON traffic through a Tailscale exit
node on a home network (`scripts/via-tailnet.sh`). Nothing else uses it.

### Repository settings

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `TAILSCALE_STATE` | The runner's permanent identity on the tailnet (base64 of a tailscaled state file) |
| Secret | `OMDB_API_KEY` | Optional. Enables IMDb and Metacritic scores |
| Variable | `TAILSCALE_EXIT_NODE` | Name of the exit node device |
| Variable | `ODEON_CINEMAS` | Optional. ODEON site IDs to store, comma-separated; empty stores every cinema |
| Variable | `ODEON_INGEST` | Optional. `false` pauses the schedule |

Start an ingest by hand:

```bash
gh workflow run ingest.yml -f command=run
```

`check` ingests only if this week is not stored yet; `run` ingests now. A failed
ingest is recorded in the file and tried again at the next check, at most three
times a week.

## Working on it

The site needs the listings file to show anything:

```bash
scripts/listings.sh download
```

```bash
mkdir -p site/public/data && gzip --stdout data/odeon.sqlite > site/public/data/odeon.sqlite.gz
```

Then, in `site/` (Node 26):

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

In `ingest/` (Python 3.13, [uv](https://docs.astral.sh/uv/)):

```bash
uv run python -m unittest discover -s tests
```

The ingest tests use a fake ODEON and a temporary database. To keep ODEON's
traffic minimal, do not run the real ingest more than the schedule does.
