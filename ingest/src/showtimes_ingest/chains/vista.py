"""The shared Vista OCAPI response vocabulary and advertised-date collector."""

import re
from datetime import datetime
from itertools import batched

from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ


def cinema_row(site):
    contact = site.get("contactDetails") or {}
    address = contact.get("addressV2") or contact.get("address") or {}
    if "city" not in address:
        lines = [text(address.get(f"line{i}")).strip().strip(",") for i in range(1, 5)]
        lines = [line for line in lines if line]
        postcode = next(
            (
                line
                for line in lines
                if re.fullmatch(r"[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}", line, re.I)
            ),
            "",
        )
        lines = [line for line in lines if line != postcode]
        compact = postcode.replace(" ", "").upper()
        address = {
            "line1": ", ".join(lines[:-1]),
            "city": lines[-1] if lines else "",
            "postcode": compact[:-3] + " " + compact[-3:] if compact else "",
        }
    return {
        "id": str(site["id"]),
        "name": text(site["name"]),
        "stored": True,
        "address": address,
        "latitude": (site.get("location") or {}).get("latitude"),
        "longitude": (site.get("location") or {}).get("longitude"),
    }


def advertised(client, sites):
    """OCAPI accepts at most five site identifiers per request."""
    days = {}
    for batch in batched(sorted(sites), 5):
        params = [("siteIds", site) for site in batch]
        for row in client.get("film-screening-dates", params).get(
            "filmScreeningDates", []
        ):
            cinemas = {
                str(site["siteId"])
                for film in row.get("filmScreenings", [])
                for site in film.get("sites", [])
            }
            days.setdefault(row["businessDate"][:10], set()).update(cinemas or batch)
    return days


def collect(client, today, known=None):
    sites = client.get("sites").get("sites", [])
    if not sites:
        raise RuntimeError("Vista: empty cinema directory")
    stored = {str(site["id"]) for site in sites}
    days = advertised(client, stored)
    films, shows = {}, {}
    for day in sorted(days):
        if day < str(today):
            continue
        for batch in batched(sorted(days[day] & stored), 5):
            params = [("siteIds", site) for site in batch]
            rows, movies = screening_rows(
                client.get(f"showtimes/by-business-date/{day}", params), stored
            )
            films.update(movies)
            shows.update(((row["cinema_id"], row["id"]), row) for row in rows)
    if not shows:
        raise RuntimeError(
            "Vista: no published showings; keeping the previous programme"
        )
    return {
        "cinemas": [cinema_row(site) for site in sites],
        "films": list(films.values()),
        "screenings": list(shows.values()),
        "availability": {
            (row["cinema_id"], row["film_id"]): ["NowShowing"] for row in shows.values()
        },
    }


def published(client, day):
    sites = client.get("sites").get("sites", [])
    return str(day) in advertised(client, {str(site["id"]) for site in sites})


def text(value):
    if isinstance(value, dict):
        return value.get("text", "")
    return str(value or "")


def related(data):
    """{kind: {id: item}} for the reference lists a response carries."""
    return {
        kind: {str(item["id"]): item for item in items}
        for kind, items in data.get("relatedData", {}).items()
        if isinstance(items, list)
        and all(isinstance(item, dict) and "id" in item for item in items)
    }


def moment(value):
    return utc(datetime.fromisoformat(value)) if value else None


def film_row(film, maps):
    def entity(kind, key):
        return maps.get(kind, {}).get(str(key), {})

    people = []
    for person in film.get("castAndCrew", []):
        name = entity("castAndCrew", person["castAndCrewMemberId"]).get("name", {})
        people.append(
            {
                "name": " ".join(
                    str(name.get(part) or "").strip()
                    for part in ("givenName", "middleName", "familyName")
                    if name.get(part)
                ),
                "roles": person.get("roles", []),
            }
        )
    return {
        "id": film["id"],
        "title": text(film.get("title")) or film["id"],
        "runtime": film.get("runtimeInMinutes"),
        "certificate": text(
            entity("censorRatings", film.get("censorRatingId")).get("classification")
        ),
        "release_date": (film.get("releaseDate") or "")[:10] or None,
        "genres": [
            text(entity("genres", key).get("name")) or str(key)
            for key in film.get("genreIds", [])
        ],
        "people": people,
        "distributor": film.get("distributorName") or "",
        "synopsis": text(film.get("synopsis") or film.get("shortSynopsis")),
        "trailer_url": film.get("trailerUrl"),
    }


def screening_rows(data, stored):
    """One row per showtime at a stored cinema, and the films they show."""
    maps = related(data)

    def name(kind, key):
        return text(maps.get(kind, {}).get(str(key), {}).get("name")) or str(key)

    films = {key: film_row(film, maps) for key, film in maps.get("films", {}).items()}
    rows = []
    for show in data.get("showtimes", []):
        if show["siteId"] not in stored:
            continue
        schedule = show["schedule"]
        starts = datetime.fromisoformat(schedule["startsAt"])
        if starts.tzinfo is None:
            starts = starts.replace(tzinfo=TZ)
        rows.append(
            {
                "cinema_id": show["siteId"],
                "id": show["id"],
                "film_id": show["filmId"],
                "business_date": schedule["businessDate"][:10],
                "starts_at": utc(starts),
                "time": starts.astimezone(TZ).strftime("%H:%M"),
                "film_starts_at": moment(schedule.get("filmStartsAt")),
                "film_ends_at": moment(schedule.get("filmEndsAt")),
                "screen": name("screens", show["screenId"]),
                "screen_id": show["screenId"],
                "layout_id": show.get("seatLayoutId"),
                "experiences": [
                    name("attributes", key) for key in show.get("attributeIds", [])
                ]
                + (["3D"] if show.get("requires3dGlasses") else []),
                "seating": [
                    name("areaCategories", area["areaCategoryId"])
                    for area in show.get("areaCategories", [])
                ],
                "sold_out": show.get("isSoldOut"),
            }
        )
    return rows, films
