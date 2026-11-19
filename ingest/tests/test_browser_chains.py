"""Vue and Picturehouse, the chains read through a real browser, against fakes of
that browser. Nothing here opens a browser or reaches a website."""

import json
import unittest
from datetime import date

from showtimes_ingest.chains import picturehouse, vue

TODAY = date(2026, 11, 11)


class FakeVue:
    """Vue's API as a browser page would answer it; counts requests."""

    def __init__(self):
        self.requests = 0

    def fetch(self, path, params=(), form=None, raw=False):
        self.requests += 1
        if path == f"{vue.API}/cinemas":
            return {
                "result": [
                    {
                        "alpha": "L",
                        "cinemas": [
                            {
                                "cinemaId": "10030",
                                "cinemaName": "London - West End (Leicester Square)",
                                "whatsOnUrl": "https://www.myvue.com/cinema/leicester-square/whats-on",
                            },
                            {
                                "cinemaId": "10051",
                                "cinemaName": "Accrington",
                                "whatsOnUrl": "https://www.myvue.com/cinema/accrington/whats-on",
                            },
                        ],
                    }
                ]
            }
        if path.startswith("/cinema/"):
            address = (
                "Leicester Square\\r\\n3 Cranbourn St\\r\\nLondon\\r\\nWC2H 7AL"
                if "leicester" in path
                else "The Viaduct\\r\\nAccrington\\r\\nBB5 1QF"
            )
            return f'<script>{{"cinemaLocationCoordinates":{{"value":"51.51, -0.12"}},"cinemaAddress":{{"value":"{address}"}}}}</script>'
        if path.endswith("/films"):
            cinema = path.split("/")[-2]
            return {
                "result": [
                    {
                        "filmId": "HO1",
                        "filmTitle": "Dune",
                        "runningTime": 155,
                        "isDurationUnknown": False,
                        "certificate": {"name": "12a"},
                        "releaseDate": "2026-11-06T00:00:00",
                        "director": "Denis Villeneuve",
                        "cast": "Zendaya, Timothée Chalamet",
                        "distributor": "Warner (UK + EIRE)",
                        "synopsisShort": "Sand.",
                        "trailers": [],
                        "showingGroups": [
                            {
                                "date": "2026-11-10T00:00:00",
                                "sessions": [
                                    {
                                        "sessionId": "1",
                                        "startTime": "2026-11-10T18:00:00",
                                        "endTime": "2026-11-10T21:00:00",
                                        "duration": 155,
                                        "screenName": "Screen 1",
                                        "attributes": [],
                                    }
                                ],
                            },
                            {
                                "date": "2026-11-12T00:00:00",
                                "sessions": [
                                    {
                                        "sessionId": f"{cinema}9",
                                        "startTime": "2026-11-12T18:00:00",
                                        "endTime": "2026-11-12T21:00:00",
                                        "duration": 155,
                                        "screenName": "Screen 6",
                                        "isSoldOut": True,
                                        "attributes": [
                                            {
                                                "name": "Laser",
                                                "attributeType": "Session_Special",
                                            },
                                            {
                                                "name": "English",
                                                "attributeType": "Language",
                                            },
                                        ],
                                    }
                                ],
                            },
                        ],
                    }
                ]
            }
        if path.endswith("/showingDates"):
            return {
                "result": [{"showingDate": "2026-11-19T00:00:00", "hasShowings": True}]
            }
        raise AssertionError(f"unexpected request {path}")


class VueTest(unittest.TestCase):
    def test_collect_reads_cinemas_once_their_addresses_and_every_showing_from_today(
        self,
    ):
        site = FakeVue()
        data = vue.collect(site, TODAY, {})
        cinemas = {row["id"]: row for row in data["cinemas"]}
        self.assertEqual(
            cinemas["10030"]["address"],
            {
                "line1": "Leicester Square, 3 Cranbourn St",
                "city": "London",
                "postcode": "WC2H 7AL",
            },
        )
        self.assertEqual(cinemas["10030"]["latitude"], 51.51)
        [show, _] = data["screenings"]  # the showing before today is left out
        self.assertEqual(
            (show["id"], show["time"], show["screen"], show["sold_out"]),
            ("HO1/100309", "18:00", "Screen 6", 1),
        )
        self.assertEqual(
            (show["film_starts_at"], show["film_ends_at"]),
            ("2026-11-12T18:25:00Z", "2026-11-12T21:00:00Z"),
        )
        self.assertEqual(
            show["experiences"], ["Session_Special: Laser", "Language: English"]
        )
        [film] = data["films"]
        self.assertEqual(
            (film["certificate"], film["people"][0], film["distributor"]),
            (
                "12A",
                {"name": "Denis Villeneuve", "roles": ["Director"]},
                "Warner (UK + EIRE)",
            ),
        )
        self.assertEqual(
            site.requests, 5
        )  # the cinemas, two addresses, two cinemas' films
        # A second run keeps the addresses it has.
        again = FakeVue()
        vue.collect(again, TODAY, {row["id"]: row for row in data["cinemas"]})
        self.assertEqual(again.requests, 3)
        self.assertTrue(vue.published(FakeVue(), date(2026, 11, 19)))
        self.assertFalse(vue.published(FakeVue(), date(2026, 11, 26)))

    def test_addresses_are_read_whatever_their_lines(self):
        self.assertEqual(
            vue.parse_address(
                "Hollywood Park, Hindpool Rd, Barrow-in-Furness\nLA14 2NA, UK"
            ),
            {
                "line1": "Hollywood Park, Hindpool Rd",
                "city": "Barrow-in-Furness",
                "postcode": "LA14 2NA",
            },
        )
        self.assertEqual(
            vue.parse_address("Unit 3, Mile End, Colchester\nEssex CO4 5UP")[
                "postcode"
            ],
            "CO4 5UP",
        )
        self.assertEqual(
            vue.parse_address("Liffey Valley, Dublin 22\nD22 W2F2"),
            {"line1": "Liffey Valley", "city": "Dublin", "postcode": "D22 W2F2"},
        )
        self.assertEqual(
            vue.parse_address("O2 Centre, 255 Finchley Road, London\n51.548, -0.181"),
            {"line1": "O2 Centre, 255 Finchley Road", "city": "London", "postcode": ""},
        )


class FakePicturehouse:
    """A Picturehouse page, whose own responses the browser keeps; counts page loads."""

    def __init__(self):
        self.requests, self.seen = 0, {}

    def open(self, path=None, keep=()):
        self.requests += 1
        self.seen = {
            picturehouse.CINEMAS: json.dumps(
                {
                    "cinema_list": [
                        {
                            "cinema_id": "022",
                            "name": "Picturehouse Central",
                            "address1": "Corner of Shaftesbury Avenue",
                            "address2": "London",
                            "city": "W1D 7DH",
                            "latitude": "51.51",
                            "longitude": "-0.13",
                        },
                        {
                            "cinema_id": "003",
                            "name": "Little Theatre Cinema",
                            "address1": "St Michaels Place",
                            "address2": "Bath",
                            "city": "BA1 1SF",
                            "latitude": "51.38",
                            "longitude": "-2.36",
                        },
                    ]
                }
            ),
            picturehouse.LISTINGS: json.dumps(
                {
                    "movies": [
                        {
                            "ScheduledFilmId": "HO9",
                            "Title": "Citizen Kane",
                            "Rating": "U",
                            "RunTime": "114",
                            "TrailerUrl": "https://youtu.be/x",
                            "OpeningDate": "27 Oct 2023",
                            "show_times": [
                                {
                                    "CinemaId": "022",
                                    "SessionId": "124085",
                                    "ScheduledFilmId": "HO9",
                                    "Showtime": "2026-11-19T20:30:00",
                                    "date_f": "2026-11-19",
                                    "ScreenName": "Screen 2",
                                    "SoldoutStatus": 0,
                                    "SessionAttributesNames": ["2D", "35mm"],
                                },
                                {
                                    "CinemaId": "003",
                                    "SessionId": "7",
                                    "ScheduledFilmId": "HO9",
                                    "Showtime": "2026-11-09T12:00:00",
                                    "date_f": "2026-11-09",
                                    "ScreenName": "Screen 1",
                                    "SoldoutStatus": 1,
                                    "SessionAttributesNames": [],
                                },
                            ],
                        }
                    ]
                }
            ),
        }


class PicturehouseTest(unittest.TestCase):
    def test_one_page_load_gives_every_cinema_and_showing(self):
        site = FakePicturehouse()
        self.assertTrue(picturehouse.published(site, date(2026, 11, 19)))
        data = picturehouse.collect(site, TODAY)
        self.assertEqual(
            site.requests, 1
        )  # the check's page load serves the ingest too
        cinemas = {row["id"]: row for row in data["cinemas"]}
        self.assertEqual(
            cinemas["022"]["address"],
            {
                "line1": "Corner of Shaftesbury Avenue",
                "city": "London",
                "postcode": "W1D 7DH",
            },
        )
        [show] = data["screenings"]
        self.assertEqual(
            (show["cinema_id"], show["id"], show["time"], show["experiences"]),
            ("022", "124085", "20:30", ["2D", "35mm"]),
        )
        [film] = data["films"]
        self.assertEqual(
            (film["runtime"], film["release_date"], film["trailer_url"]),
            (114, "2023-10-27", "https://youtu.be/x"),
        )


if __name__ == "__main__":
    unittest.main()
