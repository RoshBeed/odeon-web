"""Cineworld's public ticketing guest session and Vista programme."""

from showtimes_ingest import weekly
from showtimes_ingest.chains.vista import collect, published
from showtimes_ingest.guest import Client, Source
from showtimes_ingest.scores import search_title

NAME = "cineworld"
SOURCE = Source(
    NAME,
    "https://digital-api.cineworld.co.uk/ocapi/v1/",
    "https://web.cineworld.co.uk/",
    "next",
    "GB",
)
__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def ingest(path=None, today=None, client=None):
    return weekly.ingest(path, NAME, collect, client or Client(SOURCE), today)


def check(path=None, moment=None, client=None):
    return weekly.check(
        path, NAME, collect, published, client or Client(SOURCE), moment
    )


def settled_reason(path=None, today=None):
    return weekly.settled_reason(path, NAME, today)
