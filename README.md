# ODEON listings

A static site for finding what is on at ODEON cinemas. It is one finder: columns
of choices side by side (a day, a film, a cinema, a picture format…), each counting
what the others leave, then the showtimes that match, then the highlighted one's
details: its screen and how many seats it has, double bills, and the film's
synopsis, ratings and trailer. You choose which columns to show and in what order,
from Day, Film, Cinema, Location, Picture, Language, Accessibility, Events,
Seating, Screen, Certificate, Genre, People, Distributor and Release. Nothing is
booked here; each showing links to ODEON's own booking page and can be added to
your calendar.

There is no server. Once a week a GitHub Actions workflow fetches the listings
from ODEON into one SQLite file. The site is plain files on GitHub Pages; the
browser downloads the listings once (under 1 MB, less when only Greater London
cinemas are ticked) and keeps them in memory. The columns, your choices in them,
the cinemas you tick and the films you hide are all kept in the page's address,
so a bookmark is a saved view and a shared link opens the same way. Concerts,
theatre and other Event Cinema screenings are left out unless you ask for them.
On a phone one column shows at a time; on a computer it is driven by keyboard
or mouse.

## Using the site

| Key | Does |
| --- | --- |
| ← → | Move between columns |
| ↑ ↓ | Choose in a column, or move through the showtimes |
| Esc | Back to All in a column, or clear its search |
| / | Search the column you are in |
| s | Order the column you are in (A–Z, most showings, or by rating) |
| [ ] | Move the column you are in left or right |
| x | Hide the column you are in |
| o | Columns & settings: add, remove and order columns; event cinema, hidden films, your cinemas |
| l | London only: show only Greater London's cinemas |
| h | Hide a film everywhere |
| t | Play the trailer |
| b | Book the highlighted showing on odeon.co.uk |
| c | Add the highlighted showing to your calendar |

Everything also works by clicking or tapping.

## How it is put together

| Part | Where | What it does |
| --- | --- | --- |
| Ingest | `ingest/` (Python) | Fetches the week's listings and ratings and writes the SQLite file |
| Site | `site/` (TypeScript, Vite) | The interface; its build turns the file into JSON, which the page downloads once and holds in memory |
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

Then, in `site/` (Node 26):

```bash
npm install
```

```bash
npm run listings
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
