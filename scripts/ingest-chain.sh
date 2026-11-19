#!/usr/bin/env bash
# One chain's turn in the Ingest workflow, for chains fetched with plain requests
# (no captured token, no tailnet): check whether it is due, ingest, rate the
# films, and publish its file if it changed. Prints changed=true when it did.
#   ingest-chain.sh <chain> check|run
# Needs: data/<chain>.sqlite downloaded first (scripts/listings.sh download),
# uv, gh signed in, and OMDB_API_KEY for the ratings (optional).
set -euo pipefail
cd "$(dirname "$0")/.."
chain=${1:?usage: $0 <chain> check|run}
command=${2:-check}
export SHOWTIMES_DATABASE="$PWD/data/$chain.sqlite"
before=$(sha256sum "$SHOWTIMES_DATABASE" 2>/dev/null || true)
status=0
cd ingest
# One attempt: a failure is recorded in the chain's file and the next hourly
# check tries again, up to three times a week.
if [ "$command" = run ] || uv run showtimes-ingest "$chain" due; then
  uv run showtimes-ingest "$chain" "$command" || status=$?
fi
uv run showtimes-ingest "$chain" ratings || status=$?
cd ..
# Also after a failure, so that the failed run is on record next time.
if [ -f "$SHOWTIMES_DATABASE" ] && [ "$(sha256sum "$SHOWTIMES_DATABASE")" != "$before" ]; then
  bash scripts/listings.sh upload "$chain"
  echo "changed=true"
else
  echo "Nothing new to publish for $chain."
fi
exit "$status"
