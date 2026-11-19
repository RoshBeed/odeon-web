"""The Prince Charles Cinema's whole public programme in one request."""

import re
from datetime import datetime

from showtimes_ingest import weekly
from showtimes_ingest.chains.jacro import listing_day
from showtimes_ingest.chains.pages import parse
from showtimes_ingest.http import Client
from showtimes_ingest.scores import search_title
from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ, now

NAME = "princecharles"
SITE = "https://princecharlescinema.com"
CINEMA = "prince-charles-cinema"
__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def programme(html, today):
    films, shows = {}, {}
    for block in parse(html).find("div", "jacro-event"):
        title = next(block.find("a", "liveeventtitle"), None)
        match = (
            re.fullmatch(
                re.escape(SITE) + r"/film/(\d+)/[^/?#]+/?", title.attrs.get("href", "")
            )
            if title
            else None
        )
        if match is None:
            raise RuntimeError("Prince Charles: missing film identity")
        film = match[1]
        detail = next(block.find("div", "running-time"), None)
        parts = [n.text for n in detail.find("span")] if detail else []
        runtime = next(
            (
                int(m[1])
                for part in parts
                if (m := re.fullmatch(r"(\d+)\s*mins?", part))
            ),
            None,
        )
        cert = next(
            (
                part.strip("()")
                for part in parts
                if re.fullmatch(r"\((?:U|PG|12A?|15|18|TBC)\)", part)
            ),
            "",
        )
        synopsis = next(block.find("p"), None)
        people = []
        for span in block.find("span"):
            for prefix, role in (("Directed by ", "Director"), ("Starring ", "Actor")):
                if span.text.startswith(prefix):
                    people += [
                        {"name": name.strip(), "roles": [role]}
                        for name in span.text.removeprefix(prefix).split(",")
                        if name.strip()
                    ]
        films[film] = {
            "id": film,
            "title": title.text,
            "runtime": runtime,
            "certificate": cert,
            "release_date": None,
            "genres": [],
            "people": people,
            "distributor": "",
            "synopsis": synopsis.text if synopsis else "",
            "trailer_url": None,
        }
        for performances in block.find("ul", "performance-list-items"):
            day = None
            for node in performances.find():
                if "heading" in node.attrs.get("class", "").split():
                    day = listing_day(node.text, today)
                if node.tag != "li":
                    continue
                time = next(node.find("span", "time"), None)
                if time is None:
                    continue
                if day is None:
                    raise RuntimeError("Prince Charles: showing without a date")
                if day < today:
                    continue
                link = next(node.find("a", "film_book_button"), None)
                href = link.attrs.get("href", "") if link else ""
                booking = re.fullmatch(
                    re.escape(SITE + "/" + CINEMA) + r"/booknow/(\d+)/?", href
                )
                sold = (
                    not href
                    or "soldout"
                    in (
                        node.attrs.get("class", "")
                        + " "
                        + (link.attrs.get("class", "") if link else "")
                    ).lower()
                )
                if href and booking is None:
                    raise RuntimeError("Prince Charles: unexpected booking link")
                starts = datetime.combine(
                    day, datetime.strptime(time.text.upper(), "%I:%M %p").time(), TZ
                )
                id = booking[1] if booking else f"soldout/{film}/{day}/{starts:%H%M}"
                shows[id] = {
                    "cinema_id": CINEMA,
                    "id": id,
                    "film_id": film,
                    "business_date": str(day),
                    "starts_at": utc(starts),
                    "time": starts.strftime("%H:%M"),
                    "film_starts_at": None,
                    "film_ends_at": None,
                    "screen": "Screen",
                    "screen_id": "?",
                    "experiences": [n.text for n in node.find("span", "tag") if n.text],
                    "seating": [],
                    "sold_out": 1 if sold else None,
                    **({"booking_url": None} if booking is None else {}),
                }
    if not shows:
        raise RuntimeError("Prince Charles: no showings in the programme")
    return list(films.values()), list(shows.values())


def collect(client, today, known=None):
    films, shows = programme(client.text("/whats-on/"), today)
    return {
        "cinemas": [
            {
                "id": CINEMA,
                "name": "Prince Charles Cinema",
                "stored": True,
                "address": {
                    "line1": "7 Leicester Place",
                    "city": "London",
                    "postcode": "WC2H 7BY",
                },
                "latitude": None,
                "longitude": None,
            }
        ],
        "films": films,
        "screenings": shows,
        "availability": {(CINEMA, row["film_id"]): ["NowShowing"] for row in shows},
    }


def ingest(path=None, today=None, client=None):
    return weekly.ingest(path, NAME, collect, client or Client(SITE), today)


def settled_reason(path=None, today=None):
    return weekly.programme_settled_reason(path, NAME, today)


def check(path=None, moment=None, client=None):
    today = (moment or now()).date()
    reason = settled_reason(path, today)
    if reason:
        return reason
    ingest(path, today, client)
    return "ingested"
