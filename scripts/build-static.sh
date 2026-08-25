#!/usr/bin/env bash
#
# Build the web client for publishing as plain files under a subdirectory of an
# existing site.
#
#   ./scripts/build-static.sh /aircraft-telemetry/ dist-static
#
# Two things this does beyond `vite build`:
#
#   1. Sets Vite's base path, so asset URLs and the router's basename both know
#      the application does not live at the root.
#
#   2. Copies index.html into a directory for every client-side route. A static
#      file server has no idea that /architecture is a route rather than a
#      missing file, and the usual fix is a rewrite rule on the web server. That
#      requires editing the server's configuration, which is not always
#      available or wise on a host serving other sites. Materialising the routes
#      as directories achieves the same thing with no server configuration at
#      all — the existing try_files/index.html behaviour finds them.
#
# The trade-off: only routes listed here work as deep links. Any route added to
# the application must be added to ROUTES below. That is why aircraft selection
# is a query parameter rather than a path segment — a dynamic segment cannot be
# pre-rendered this way.

set -euo pipefail

BASE_PATH="${1:-/}"
OUT_DIR="${2:-dist-static}"
# Empty means same origin. There is no API behind the published page, and the
# client detects that and says so — see packages/web/src/data-source.tsx.
API_BASE_URL="${VITE_API_BASE_URL:-}"

# Client-side routes that must be reachable as deep links.
ROUTES=(fleet alerts architecture research demo)

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "Building web client"
echo "  base path : ${BASE_PATH}"
echo "  API base  : ${API_BASE_URL:-<same origin — none attached>}"
echo "  output    : ${OUT_DIR}"
echo

VITE_API_BASE_URL="${API_BASE_URL}" \
  pnpm --filter @oat/web exec vite build --base "${BASE_PATH}"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"
cp -r packages/web/dist/. "${OUT_DIR}/"

if [ ! -f "${OUT_DIR}/index.html" ]; then
  echo "error: build produced no index.html" >&2
  exit 1
fi

echo
echo "Materialising client-side routes:"
for route in "${ROUTES[@]}"; do
  mkdir -p "${OUT_DIR}/${route}"
  cp "${OUT_DIR}/index.html" "${OUT_DIR}/${route}/index.html"
  echo "  ${BASE_PATH%/}/${route}/"
done

# Source maps are useful in the container image and are dead weight on a public
# static host — they roughly triple what is served.
find "${OUT_DIR}" -name '*.map' -delete

echo
echo "Built $(find "${OUT_DIR}" -type f | wc -l | tr -d ' ') files into ${OUT_DIR}/"
du -sh "${OUT_DIR}" | awk '{print "Total: " $1}'
