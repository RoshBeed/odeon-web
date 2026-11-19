"""The weekly check for a chain that needs nothing ODEON does (a captured token,
seat layouts): once a week, when the chain has published the week's last day,
fetch everything and replace its listings.

A chain package passes its name and two functions:
    collect(client, today) -> {"cinemas", "films", "availability", "screenings"}
        in the shared schema (store.write)
    published(client, day) -> whether any showing on that day is listed yet
"""

from showtimes_ingest.log import log
from showtimes_ingest.store import (
    MAX_FAILURES,
    connect,
    failures_since,
    finish_run,
    get_state,
    last_success,
    start_run,
    write,
)
from showtimes_ingest.week import now, release_week


def ingest(path, name, collect, client, today=None):
    run_id = start_run(path, name)
    log.info("%s ingest %d started", name, run_id)
    today = today or now().date()
    tuesday, last_day = release_week(today)
    try:
        data = collect(client, today)
        with connect(path) as db:
            write(db, data)
            # The week counts as stored once its last day is.
            if any(row["business_date"] == str(last_day) for row in data["screenings"]):
                db.execute(
                    "INSERT INTO state VALUES ('release_week', ?)"
                    " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                    (str(tuesday),),
                )
            else:
                db.execute(
                    "DELETE FROM state WHERE key = 'release_week' AND value = ?",
                    (str(tuesday),),
                )
    except Exception as error:
        finish_run(path, run_id, "failed", client.requests, str(error)[:500])
        log.error("%s ingest %d failed: %s", name, run_id, error)
        raise
    finish_run(path, run_id, "ok", client.requests)
    summary = {
        "run": run_id,
        "requests": client.requests,
        "cinemas": len(data["cinemas"]),
        "films": len(data["films"]),
        "screenings": len(data["screenings"]),
    }
    log.info("%s ingest %d finished: %s", name, run_id, summary)
    return summary


def settled_reason(path, name, today=None):
    """Why a check would not contact the chain now, or None when it would."""
    tuesday, _ = release_week(today or now().date())
    if get_state(path, "release_week") == str(tuesday):
        return "done"
    if failures_since(path, name, str(tuesday)) >= MAX_FAILURES:
        log.warning("%s paused after %d failures; run it manually", name, MAX_FAILURES)
        return "paused"
    return None


def check(path, name, collect, published, client, moment=None):
    """Once a week: one request asks whether the week's last day is out yet;
    when it is, or when nothing is stored at all, fetch everything."""
    today = (moment or now()).date()
    tuesday, last_day = release_week(today)
    settled = settled_reason(path, name, today)
    if settled:
        return settled
    if last_success(path, name):
        try:
            out = published(client, last_day)
        except RuntimeError as error:
            finish_run(
                path, start_run(path, name), "failed", client.requests, str(error)[:500]
            )
            log.error("%s release check failed: %s", name, error)
            raise
        if not out:
            log.info(
                "%s: week of %s not published yet (nothing on %s)",
                name,
                tuesday,
                last_day,
            )
            return "waiting"
    ingest(path, name, collect, client, today)
    return "ingested"
