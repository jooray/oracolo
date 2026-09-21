#!/bin/bash
#
# Rebuild a prerendered Oracolo site from the relays.
#
# Renders into a staging directory *inside* the web root — so the files inherit
# the directory's SELinux context and ownership, and the final move is a rename
# on the same filesystem — validates the result, and only then swaps it in.
#
# This replaces refresh-cache.sh: the cron now produces the site, not just the
# cache, so a bad run would take the site down rather than serve stale data.
# Hence the validation gate below.
#
# Expects, in SCRIPT_DIR:
#   prerender.mjs        esbuild bundle of oracolo's scripts/prerender.js
#   index.template.html  output of scripts/bundle.js --template
#
# Usage: refresh-site.sh            (paths configured below)

set -euo pipefail

SITE_DIR="${SITE_DIR:-$HOME/www/example.com}"
SCRIPT_DIR="${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
NODE="${NODE:-/usr/bin/node}"
ARTICLE_DIR="${ARTICLE_DIR:-a}"

TEMPLATE="$SCRIPT_DIR/index.template.html"
PRERENDER="$SCRIPT_DIR/prerender.mjs"

log() { echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] $*"; }
die() { log "ERROR: $*"; exit 1; }

[ -f "$TEMPLATE" ] || die "missing template: $TEMPLATE"
[ -f "$PRERENDER" ] || die "missing prerenderer: $PRERENDER"
[ -d "$SITE_DIR" ] || die "missing web root: $SITE_DIR"

STAGE="$SITE_DIR/.staging.$$"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE"

log "rendering into $STAGE"
"$NODE" "$PRERENDER" "$TEMPLATE" "$STAGE" || die "prerender failed"

# ---------------------------------------------------------------- validate
[ -s "$STAGE/index.html" ] || die "no index.html produced"
grep -q 'id="oracolo-seed"' "$STAGE/index.html" || die "index.html has no seed"

# `find` on a missing directory exits non-zero, and pipefail would take the
# whole script down with it — a first deploy has no article directory yet.
count_dirs() {
  [ -d "$1" ] || { echo 0; return 0; }
  find "$1" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '
}
new_count=$(count_dirs "$STAGE/$ARTICLE_DIR")
old_count=$(count_dirs "$SITE_DIR/$ARTICLE_DIR")

[ "$new_count" -ge 1 ] || die "no article pages produced"
if [ "$old_count" -gt 0 ]; then
  floor=$(( old_count * 80 / 100 ))
  [ "$new_count" -ge "$floor" ] ||
    die "article count fell from $old_count to $new_count (floor $floor) — relays flaky? not installing"
fi
log "validated: $new_count article pages (was $old_count)"

# ---------------------------------------------------------------- install
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +

# Assets and article pages first, index.html last: a visitor mid-deploy should
# never get a new page referencing an asset that is not there yet.
if [ -d "$STAGE/$ARTICLE_DIR" ]; then
  rm -rf "$SITE_DIR/$ARTICLE_DIR.old"
  if [ -d "$SITE_DIR/$ARTICLE_DIR" ]; then
    mv "$SITE_DIR/$ARTICLE_DIR" "$SITE_DIR/$ARTICLE_DIR.old"
  fi
  mv "$STAGE/$ARTICLE_DIR" "$SITE_DIR/$ARTICLE_DIR"
  rm -rf "$SITE_DIR/$ARTICLE_DIR.old"
fi

for f in app.js app.css site.css sitemap.xml feed.xml robots.txt \
         events-cache.json events-cache.json.gz; do
  [ -f "$STAGE/$f" ] || continue
  mv -f "$STAGE/$f" "$SITE_DIR/$f"
done

if [ -f "$SITE_DIR/index.html" ]; then
  cp -p "$SITE_DIR/index.html" "$SITE_DIR/index.html.bak"
fi
mv -f "$STAGE/index.html" "$SITE_DIR/index.html"

log "installed $new_count article pages + index.html into $SITE_DIR"
