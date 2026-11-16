"""Command line for the ingest. The database is the file in $ODEON_DATABASE."""

import argparse
import json
import sys

from odeon_ingest import run
from odeon_ingest.log import log, log_to_stdout


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "command",
        choices=["check", "run", "due", "ratings"],
        help="check: ingest if this week is not stored. run: ingest now."
        " due: exit 0 if a check would contact ODEON, 3 if not."
        " ratings: rate the films once after each ingest.",
    )
    args = parser.parse_args(argv)
    log_to_stdout()
    try:
        if args.command == "run":
            print(json.dumps(run.ingest()))
        elif args.command == "check":
            print(json.dumps({"result": run.check()}))
        elif args.command == "ratings":
            print(json.dumps({"result": run.check_ratings()}))
        else:
            settled = run.settled_reason()
            print(json.dumps({"due": settled is None, "reason": settled}))
            sys.exit(3 if settled else 0)
    except RuntimeError as error:
        log.error("%s failed: %s", args.command, error)
        sys.exit(1)
