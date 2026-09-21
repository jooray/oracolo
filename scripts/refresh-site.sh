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

# A language mutation overrides these three and runs the script a second time
# against the same web root: its own template, its own homepage filename, and
# its own article directory, so the two runs never touch each other's files.
TEMPLATE="${TEMPLATE:-$SCRIPT_DIR/index.template.html}"
INDEX_NAME="${INDEX_NAME:-index.html}"
ARTICLE_DIR="${ARTICLE_DIR:-a}"

PRERENDER="$SCRIPT_DIR/prerender.mjs"

log() { echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] $*"; }
die() { log "ERROR: $*"; exit 1; }

[ -f "$TEMPLATE" ] || die "missing template: $TEMPLATE"
[ -f "$PRERENDER" ] || die "missing prerenderer: $PRERENDER"
[ -d "$SITE_DIR" ] || die "missing web root: $SITE_DIR"

STAGE="$SITE_DIR/.staging.$$"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE"

log "rendering $INDEX_NAME into $STAGE"
# --alternates points at the live root so a language mutation can find the
# manifest its sibling run installed, and cross-link the articles they share.
"$NODE" "$PRERENDER" "$TEMPLATE" "$STAGE" --index "$INDEX_NAME" \
  --alternates "$SITE_DIR" || die "prerender failed"

# ---------------------------------------------------------------- validate
[ -s "$STAGE/$INDEX_NAME" ] || die "no $INDEX_NAME produced"
grep -q 'id="oracolo-seed"' "$STAGE/$INDEX_NAME" || die "$INDEX_NAME has no seed"

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

while IFS= read -r staged; do
  base=$(basename "$staged")
  if [ "$base" = "$INDEX_NAME" ]; then
    continue
  fi
  # robots.txt is published, not generated: a site with several language
  # mutations wants one file listing every sitemap, and each run would only
  # know about its own.
  if [ "$base" = "robots.txt" ] && [ -f "$SITE_DIR/robots.txt" ]; then
    continue
  fi
  mv -f "$staged" "$SITE_DIR/$base"
done < <(find "$STAGE" -maxdepth 1 -type f)

if [ -f "$SITE_DIR/$INDEX_NAME" ]; then
  cp -p "$SITE_DIR/$INDEX_NAME" "$SITE_DIR/$INDEX_NAME.bak"
fi
mv -f "$STAGE/$INDEX_NAME" "$SITE_DIR/$INDEX_NAME"

log "installed $new_count article pages + $INDEX_NAME into $SITE_DIR"
