# Fork notes

This fork (`jooray/oracolo`) adds a small set of features on top of upstream
[`dtonon/oracolo`](https://github.com/dtonon/oracolo). Everything here is
opt-in via meta tags or extra scripts — sites that don't set the new tags
behave exactly like upstream.

## Index

- [Local cache for instant first paint](#local-cache-for-instant-first-paint)
- [Bio in the homepage header](#bio-in-the-homepage-header)
- [Square / non-cropped article cover art](#square--non-cropped-article-cover-art)
- [Top menu](#top-menu)
- [Language menu](#language-menu)
- [Page language for date formatting](#page-language-for-date-formatting)
- [Promo popup](#promo-popup)
- [Default tag (single-topic site)](#default-tag-single-topic-site)
- [Auto-redirect](#auto-redirect)
- [YouTube embeds](#youtube-embeds)
- [Latest-version-only for replaceable events](#latest-version-only-for-replaceable-events)
- [CLI bundler (no Go server required)](#cli-bundler-no-go-server-required)
- [Migration: republish kind-1 as kind-30023](#migration-republish-kind-1-as-kind-30023)
- [Open Graph / Twitter cards for social link previews](#open-graph--twitter-cards-for-social-link-previews)

---

## Local cache for instant first paint

`<meta name="cache-url" content="events-cache.json">`

When set, the site fetches `events-cache.json` (or `events-cache.json.gz` if
the URL ends with `.gz`) on load and renders the homepage and individual
articles entirely from the cached events — no relay roundtrip on first
paint. Relays are queried in the background for events newer than
`generated_at`; new events stream into the page reactively without
blocking. Article navigation is also cache-first: clicking a card on the
home grid renders the article instantly from the in-process memoized
cache.

Generate the cache file with `scripts/generate-cache.js`:

```sh
node scripts/generate-cache.js path/to/source.html path/to/events-cache.json
```

It reads the `<meta name="author">` and `<meta name="relays">` tags from
the HTML, queries those relays for kinds 0, 1, 20, 30023, dedupes
replaceable events (keeping the latest version), and writes both
`events-cache.json` and `events-cache.json.gz`.

The kind-0 event in the cache also pre-populates the author profile
(name, avatar, bio) so the header paints without a relay roundtrip.

Refresh nightly via cron — see `scripts/refresh-cache.sh` referenced in
deployment notes for an atomic install pattern (write to a temp file,
`mv` into place).

## Bio in the homepage header

By default, the homepage now shows the author's kind-0 `metadata.about`
under the avatar. To override (e.g. with a shorter, site-specific bio):

```html
<meta name="bio" content="One-paragraph site-specific bio.">
```

Empty / unset → falls back to kind-0 `about`.

## Square / non-cropped article cover art

The default article-grid cover crop (`object-fit: cover`) crops square
album art into landscape thumbnails. Sites with square cover art can
opt into letterboxing instead:

```html
<meta name="article-image-fit" content="contain">
```

Allowed values: `cover` (default, current behaviour), `contain`. Anything
else is ignored.

## Top menu

A floating top-right menu of external links (e.g. social profiles,
podcast feeds):

```html
<meta name="menu" content="YouTube|https://youtube.com/@me, Mastodon|https://mas.to/@me">
```

Comma-separated `Label|URL` pairs. The menu is rendered as
`position: fixed` and tucks under the existing theme switch on mobile.

## Language menu

A single language-switcher entry, separate from the main menu:

```html
<meta name="menu-lang" content="EN|/en/">
```

Same `Label|URL` syntax, but only one entry.

## Page language for date formatting

```html
<meta name="page-language" content="en-US">
```

Sets `document.documentElement.lang` and the `Intl.DateTimeFormat` locale
used for "12 March 2026"-style dates.

## Promo popup

A dismissible promo banner on first visit:

```html
<meta name="promo-image" content="/promo.jpg">
<meta name="promo-url"   content="https://my.shop/album">
<meta name="promo-text"  content="New album out — listen now">
```

All three optional. The popup is shown once per browser; the dismissal
is remembered in `localStorage`.

## Default tag (single-topic site)

```html
<meta name="default-tag" content="the-ohm">
```

When set, only events tagged with `#t the-ohm` are fetched (and only
those land in the cache). Useful when the same npub posts about multiple
unrelated topics and the site should be a slice.

## Auto-redirect

```html
<meta name="auto-redirect-url" content="https://other-site.example">
```

Renders a small landing page that redirects after a short delay. Set
when retiring a domain.

## YouTube embeds

`https://www.youtube.com/watch?v=...` and `https://youtu.be/...` URLs
inside article bodies are turned into responsive 16:9 inline embeds
(playlist `&list=...` parameter is preserved). Markdown link syntax
(`[text](url)`) is left untouched, so wrap a URL in `[…]()` to force a
plain link instead of an embed.

## Latest-version-only for replaceable events

Replaceable + parameterized-replaceable events (NIP-01 / NIP-33) are
deduped by identity (`kind:pubkey:d-tag` for parameterized; `kind:pubkey`
for plain replaceable), keeping the highest `created_at`. Applied at:

- cache build (`scripts/generate-cache.js`),
- cache preload + every relay query inside `EventSource`,
- background refresh — a freshly-fetched updated version replaces the
  older one in-place in the rendered list.

So if a relay still holds an older version of a kind-30023 article you
republished, the site shows only the latest.

## CLI bundler (no Go server required)

To produce the self-contained single-file `index.html` without running
the Go server's `?bundled=1`:

```sh
node build.js prod                              # builds dist/out.{js,css}
node scripts/bundle.js source.html index.html   # inlines into source.html
```

`bundle.js` reads `<meta>` (and `<meta property=...>`) tags, the `<html
lang>`, `<title>`, and any inline `<script>` blocks from the head of
`source.html`, then emits a fully-inlined HTML. Use this for pure-static
deployments behind nginx / a CDN.

## Migration: republish kind-1 as kind-30023

`scripts/migrate-publish.js` signs and broadcasts curated kind-30023
articles from `migration/articles-draft.json`. Useful when migrating
older kind-1 release announcements into proper long-form articles. See
the script's header comment for the JSON schema. Dry-run by default;
pass `--publish` to actually broadcast. Refuses to publish unless the
secret key derived pubkey matches the npub in `source.html`. Entries
marked `"_status": "published"` are skipped on re-runs.

## Open Graph / Twitter cards for social link previews

This is **not** a code change — Open Graph and Twitter Card tags are
plain `<meta>` tags that messengers (Slack, iMessage, WhatsApp,
Telegram) and social sites (X, Mastodon, LinkedIn) read to build link
previews. The CLI bundler already passes both `name=` and `property=`
meta tags through to the bundled HTML, so just add them to your
`source.html`:

```html
<meta property="og:title"       content="The Ohm">
<meta property="og:description" content="Sonic philosophy for cypherpunks.">
<meta property="og:image"       content="https://theohm.art/og-image.jpg">
<meta property="og:url"         content="https://theohm.art/">
<meta property="og:type"        content="website">
<meta property="og:site_name"   content="The Ohm">

<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="The Ohm">
<meta name="twitter:description" content="Sonic philosophy for cypherpunks.">
<meta name="twitter:image"       content="https://theohm.art/og-image.jpg">
```

Notes:

- **Image must be an absolute URL** — relative paths don't work.
  Recommended size: at least 1200×630 (×2 for retina). Host it next to
  `index.html`.
- **A single index.html means a single set of OG tags for the whole
  site.** Article-level previews would need server-side rendering per
  article, which the static bundle doesn't do — the upstream Go server
  (`html_modifier.go` / `og_tags.go`) supports per-article OG tags when
  you serve via the dynamic blog engine, but the static deploy path
  shows the same homepage preview for every article URL.
- After publishing, validate the tags with the platform debuggers:
  Facebook Sharing Debugger, X Card Validator, LinkedIn Post Inspector,
  Telegram's `@WebpageBot`. They also bust their own caches when you
  re-fetch.
