"""Reel's public Jacro pages: the cinema directory, then each film's schedule.

Hull, Morecambe and Quinton still use Admit One. Their public programme pages are
read through the shared admitone adapter, alongside the Jacro cinemas.
"""

import re
from datetime import datetime
from urllib.parse import urlsplit

from showtimes_ingest import weekly
from showtimes_ingest.chains import admitone
from showtimes_ingest.chains.jacro import fields, listing_day
from showtimes_ingest.chains.pages import parse
from showtimes_ingest.http import Client
from showtimes_ingest.scores import search_title as base_search_title
from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ

NAME = "reel"
SITE = "https://reelcinemas.co.uk"
LEGACY = {"hull", "morecambe", "quinton"}

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def search_title(title):
    return base_search_title(re.sub(r" - Subtitled Screening$", "", title, flags=re.I))


def directory(client):
    root = parse(client.text("/"))
    select = next(
        (
            node
            for node in root.find("select")
            if node.attrs.get("id") == "cinemaSelect"
        ),
        None,
    )
    if select is None:
        raise RuntimeError("Reel: no cinema directory")
    sites = []
    for option in select.find("option"):
        url = option.attrs.get("value") or ""
        if not url:
            continue
        host = urlsplit(url)
        if host.scheme != "https" or not (
            host.hostname == "reelcinemas.co.uk"
            or (host.hostname or "").endswith(".reelcinemas.co.uk")
        ):
            raise RuntimeError("Reel: unexpected cinema URL")
        sites.append(
            {
                "id": host.path.strip("/"),
                "name": option.text,
                "url": url,
                "stored": host.hostname == "reelcinemas.co.uk"
                or host.hostname in {f"{name}.reelcinemas.co.uk" for name in LEGACY},
            }
        )
    if not sites:
        raise RuntimeError("Reel: empty cinema directory")
    return sites


def film_links(root, cinema):
    pattern = re.compile(re.escape(SITE + "/" + cinema) + r"/film/\d+/[^/?#]+/?$")
    return sorted(
        {
            link.attrs["href"]
            for link in root.find("a")
            if pattern.fullmatch(link.attrs.get("href", ""))
        }
    )


def movie_page(root, cinema, url, today):
    title = next(root.find("h1"), None)
    if title is None:
        raise RuntimeError(f"Reel: missing film information on {url}")
    props = fields(root, "movie-info", "i")
    runtime = re.search(r"\d+", props.get("Running time", ""))
    plot = next(root.find(cls="plot"), None)
    synopsis = next(plot.find("p"), None) if plot else None
    film = f"{cinema}/{urlsplit(url).path.split('/film/')[1].split('/')[0]}"
    people = [
        {"name": name.strip(), "roles": [role]}
        for label, role in (("Directed by", "Director"), ("Starring", "Actor"))
        for name in props.get(label, "").split(",")
        if name.strip()
    ]
    row = {
        "id": film,
        "title": title.text,
        "runtime": int(runtime[0]) if runtime else None,
        "certificate": props.get("Rating", ""),
        "release_date": props.get("Released")
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", props.get("Released", ""))
        else None,
        "genres": [
            genre.strip()
            for genre in props.get("Genre", "").split(",")
            if genre.strip()
        ],
        "people": people,
        "distributor": "",
        "synopsis": synopsis.text if synopsis else "",
        "trailer_url": None,
    }
    shows = {}
    for date_row in root.find(cls="date-row"):
        heading = next(date_row.find("span"), None)
        if heading is None:
            raise RuntimeError("Reel: missing programme date")
        day = listing_day(heading.text, today)
        if day < today:
            continue
        for showing in date_row.find(cls="singlefilmperfs"):
            link = next(showing.find("a", "show_time_in"), None)
            if link is None:
                continue
            booking = re.fullmatch(
                re.escape(SITE + "/" + cinema) + r"/booknow/(\d+)/?",
                link.attrs.get("href", ""),
            )
            if not booking:
                raise RuntimeError("Reel: unexpected booking link")
            starts = datetime.combine(
                day, datetime.strptime(link.text, "%H:%M").time(), TZ
            )
            details = fields(showing, "popup-details", "span")
            screen = details.get("Screen") or "Screen"
            tags = [
                node.text for node in showing.find(cls="show_time_label") if node.text
            ]
            if details.get("2D / 3D"):
                tags.append(details["2D / 3D"])
            if details.get("Subtitled"):
                tags.append("Subtitled")
            shows[booking[1]] = {
                "cinema_id": cinema,
                "id": booking[1],
                "film_id": film,
                "business_date": str(day),
                "starts_at": utc(starts),
                "time": link.text,
                "film_starts_at": None,
                "film_ends_at": None,
                "screen": screen,
                "screen_id": screen if details.get("Screen") else "?",
                "experiences": tags,
                "seating": [],
                "sold_out": None,
            }
    return row, list(shows.values())


def collect(client, today, known=None):
    cinemas, films, shows, availability = [], {}, {}, {}
    for site in directory(client):
        cinema = site["id"]
        previous = (known or {}).get(cinema, {})
        cinemas.append(
            {
                "id": cinema,
                "name": site["name"],
                "stored": site["stored"],
                "address": previous.get("address")
                or {"line1": "", "city": site["name"], "postcode": ""},
                "latitude": previous.get("latitude"),
                "longitude": previous.get("longitude"),
            }
        )
        if not site["stored"]:
            continue
        if cinema in LEGACY:
            html = client.text(site["url"].rstrip("/") + "/whatson")
            movies, screenings = admitone.programme(html, cinema, today)
            films.update((movie["id"], movie) for movie in movies)
            shows.update(((cinema, row["id"]), row) for row in screenings)
            availability.update(
                ((cinema, row["film_id"]), ["NowShowing"]) for row in screenings
            )
            continue
        root = parse(client.text(site["url"]))
        links = film_links(root, cinema)
        if not links:
            raise RuntimeError(f"Reel: no film directory for {cinema}")
        for url in links:
            film, screenings = movie_page(parse(client.text(url)), cinema, url, today)
            films[film["id"]] = film
            if screenings:
                availability[(cinema, film["id"])] = ["NowShowing"]
                shows.update(((cinema, row["id"]), row) for row in screenings)
        if not any(key[0] == cinema for key in shows):
            raise RuntimeError(f"Reel: no bookable showings for {cinema}")
    return {
        "cinemas": cinemas,
        "films": list(films.values()),
        "screenings": list(shows.values()),
        "availability": availability,
    }


def published(client, day):
    cinema = next((site for site in directory(client) if site["stored"]), None)
    if cinema is None:
        return False
    # The cinema's own film slider advertises the dates it has published. No
    # need to fetch every film page just to ask if next Thursday is available.
    html = client.text(cinema["url"])
    return "nowshowingslider_" + day.strftime("%Y%m%d") in html


def ingest(path=None, today=None, client=None):
    return weekly.ingest(path, NAME, collect, client or Client(SITE), today)


def check(path=None, moment=None, client=None):
    return weekly.check(path, NAME, collect, published, client or Client(SITE), moment)


def settled_reason(path=None, today=None):
    return weekly.settled_reason(path, NAME, today)
