"""Fetch one week's listings from ODEON and shape them for the site."""

import os

from showtimes_ingest.chains.vista import film_row, related, screening_rows, text
from showtimes_ingest.week import TZ, now, release_week  # noqa: F401  (ODEON's run imports them from here)


def configured_sites():
    """An explicit limit on which cinemas are stored, or None for every cinema."""
    configured = os.environ.get("ODEON_CINEMAS", "")
    return set(configured.replace(",", " ").split()) or None


def collect(api, today):
    """Everything one ingest stores, fetched before anything is written.

    A failure part-way leaves the database exactly as the last ingest left it.
    """
    sites = api.get("sites")["sites"]
    scope = configured_sites()
    unknown = (scope or set()) - {site["id"] for site in sites}
    if unknown:
        raise RuntimeError(
            "ODEON has no cinema with ID %s; check ODEON_CINEMAS"
            % ", ".join(sorted(unknown))
        )
    stored = {site["id"] for site in sites if scope is None or site["id"] in scope}
    params = [("siteIds", site) for site in sorted(stored)]
    catalogue = api.get("films")
    maps = related(catalogue)
    films = {film["id"]: film_row(film, maps) for film in catalogue.get("films", [])}
    availability = {}
    for site in sorted(stored):
        data = api.get(f"sites/{site}/films/availability")
        for item in data.get("filmAvailabilities", []):
            availability[(site, item["filmId"])] = item.get("categories", [])
    published = api.get("film-screening-dates", params).get("filmScreeningDates", [])
    days = sorted({entry["businessDate"][:10] for entry in published})
    screenings = []
    for day in days:
        if day >= str(today):
            rows, shown = screening_rows(
                api.get(f"showtimes/by-business-date/{day}", params), stored
            )
            screenings.extend(rows)
            # The catalogue's entry wins; a showtime's film fills any gap.
            films = shown | films
    return {
        "cinemas": [
            {
                "id": site["id"],
                "name": text(site["name"]),
                "stored": site["id"] in stored,
                "address": site.get("contactDetails", {}).get("address", {}),
                "latitude": site.get("location", {}).get("latitude"),
                "longitude": site.get("location", {}).get("longitude"),
            }
            for site in sites
        ],
        "stored_cinemas": stored,
        "films": list(films.values()),
        "availability": availability,
        "screenings": screenings,
    }
