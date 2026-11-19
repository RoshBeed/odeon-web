"""Everyman, on Webedia's boxoffice platform (chains/boxoffice.py)."""

from showtimes_ingest import weekly
from showtimes_ingest.chains import boxoffice
from showtimes_ingest.http import Client
from showtimes_ingest.scores import search_title

NAME = "everyman"
SITE = "https://www.everymancinema.com"

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def ingest(path=None, today=None, client=None):
    return weekly.ingest(path, NAME, boxoffice.collect, client or Client(SITE), today)


def check(path=None, moment=None, client=None):
    return weekly.check(
        path,
        NAME,
        boxoffice.collect,
        boxoffice.published,
        client or Client(SITE),
        moment,
    )


def settled_reason(path=None, today=None):
    return weekly.settled_reason(path, NAME, today)
