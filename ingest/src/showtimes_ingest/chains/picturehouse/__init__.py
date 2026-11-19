"""Picturehouse, read as ODEON is: its website in a real browser
(showtimes_ingest.browser). A cinema's page fetches, as it loads, the list of
every Picturehouse cinema and every cinema's showings; the ingest keeps those two
responses. One page load a week, and no request of its own.

    /ajax-cinema-list        the cinemas: name, street, town, postcode, position
    /api/get-movies-ajax     every film with every showing at every cinema
"""

import json
import re
from contextlib import nullcontext
from datetime import datetime

from showtimes_ingest import weekly
from showtimes_ingest.browser import Browser
from showtimes_ingest.scores import search_title
from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ

NAME = "picturehouse"
SITE = "https://www.picturehouses.com"
# Any cinema's page loads every cinema's listings.
PAGE = "/cinema/picturehouse-central"
CINEMAS, LISTINGS = "ajax-cinema-list", "get-movies-ajax"

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def load(client):
    """The page's own two responses, read once per run."""
    if LISTINGS not in client.seen or CINEMAS not in client.seen:
        client.open(PAGE, keep=(CINEMAS, LISTINGS))
    return json.loads(client.seen[CINEMAS]), json.loads(client.seen[LISTINGS])


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def cinema_row(cinema):
    # The site keeps the town in address2 and the postcode in city.
    postcode, town = (
        (cinema.get("city") or "").strip(),
        (cinema.get("address2") or "").strip(),
    )
    if not re.search(r"\d", postcode):
        postcode, town = "", postcode or town
    return {
        "id": cinema["cinema_id"],
        "name": cinema.get("name") or cinema["cinema_id"],
        "stored": cinema.get("is_active") not in (0, "0", False),
        "address": {
            "line1": (cinema.get("address1") or "").strip(),
            "city": town,
            "postcode": postcode.upper(),
        },
        "latitude": number(cinema.get("latitude")),
        "longitude": number(cinema.get("longitude")),
    }


def release(value):
    try:
        return datetime.strptime(value, "%d %b %Y").date().isoformat()
    except (TypeError, ValueError):
        return None


def film_row(movie):
    runtime = str(movie.get("RunTime") or "")
    return {
        "id": movie["ScheduledFilmId"],
        "title": movie.get("Title") or movie["ScheduledFilmId"],
        "runtime": int(runtime) if runtime.isdigit() and int(runtime) else None,
        "certificate": movie.get("Rating") or "",
        "release_date": release(movie.get("OpeningDate")),
        "genres": [],
        "people": [],
        "distributor": "",
        "synopsis": "",
        "trailer_url": movie.get("TrailerUrl") or None,
    }


def screening_row(show):
    starts = datetime.fromisoformat(show["Showtime"])
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=TZ)
    return {
        "cinema_id": show["CinemaId"],
        "id": str(show["SessionId"]),
        "film_id": show["ScheduledFilmId"],
        "business_date": show.get("date_f") or starts.date().isoformat(),
        "starts_at": utc(starts),
        "time": starts.astimezone(TZ).strftime("%H:%M"),
        "film_starts_at": None,
        "film_ends_at": None,
        "screen": show.get("ScreenName") or "Screen",
        "screen_id": show.get("ScreenName") or "?",
        "experiences": list(show.get("SessionAttributesNames") or []),
        "seating": [],
        "sold_out": int(bool(show.get("SoldoutStatus"))),
    }


def collect(client, today, known=None):
    cinemas, listings = load(client)
    rows = [
        cinema_row(cinema)
        for cinema in cinemas.get("cinema_list") or []
        if cinema.get("cinema_id")
    ]
    films, screenings, availability = {}, {}, {}
    for movie in listings.get("movies") or []:
        films.setdefault(movie["ScheduledFilmId"], film_row(movie))
        for show in movie.get("show_times") or []:
            row = screening_row(show)
            if row["business_date"] >= str(today):
                screenings.setdefault((row["cinema_id"], row["id"]), row)
                availability[(row["cinema_id"], row["film_id"])] = ["NowShowing"]
    return {
        "cinemas": rows,
        "films": list(films.values()),
        "availability": availability,
        "screenings": list(screenings.values()),
    }


def published(client, day):
    """Whether the week's last day is listed yet; the page read here serves the ingest too."""
    _, listings = load(client)
    return any(
        show.get("date_f") == str(day)
        for movie in listings.get("movies") or []
        for show in movie.get("show_times") or []
    )


def session(client):
    return nullcontext(client) if client else Browser(SITE, settle=6000)


def ingest(path=None, today=None, client=None):
    with session(client) as browser:
        return weekly.ingest(path, NAME, collect, browser, today)


def check(path=None, moment=None, client=None):
    with session(client) as browser:
        return weekly.check(path, NAME, collect, published, browser, moment)


def settled_reason(path=None, today=None):
    return weekly.settled_reason(path, NAME, today)
