#!/usr/bin/env bash
# The published listings: one SQLite file, an asset of this repository's `data`
# release. The Ingest workflow uploads it; site builds download it.
#   listings.sh download   fetch it to data/odeon.sqlite, if one is published
#   listings.sh upload     publish data/odeon.sqlite
# Needs gh, signed in (or GH_TOKEN), and to run inside the repository.
set -euo pipefail
cd "$(dirname "$0")/.."
file=data/odeon.sqlite

case "${1:-}" in
download)
  mkdir -p data
  if gh release view data >/dev/null 2>&1; then
    gh release download data --pattern odeon.sqlite.gz --dir data --clobber
    gunzip --force "$file.gz"
    echo "Fetched the published listings."
  else
    echo "No listings are published yet."
  fi
  ;;
upload)
  gzip --keep --force "$file"
  gh release view data >/dev/null 2>&1 ||
    gh release create data --title "Listings" --latest=false \
      --notes "The stored ODEON listings, replaced by the Ingest workflow. Not a software release."
  gh release upload data "$file.gz" --clobber
  rm "$file.gz"
  echo "Published the listings."
  ;;
*)
  echo "usage: $0 download|upload" >&2
  exit 2
  ;;
esac
