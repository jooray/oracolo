#!/usr/bin/env node

/**
 * Oracolo prerenderer
 *
 * Bakes a site's events into real HTML. Reads a prerender template (produced
 * by `scripts/bundle.js --template`), queries the relays for the author's
 * events, renders the actual Svelte components server-side, and writes:
 *
 *   index.html            homepage markup + the events inlined as a seed
 *   a/<d-tag>/index.html  one page per article, with its own title/OG/JSON-LD
 *   app.js, app.css       assets shared by the article pages
 *   sitemap.xml, feed.xml
 *   events-cache.json[.gz]  (compatibility; --no-cache to skip)
 *
 * The browser hydrates the baked markup from the inline seed and then does
 * what it has always done: ask the relays for anything newer and merge it in.
 *
 * Usage: node scripts/prerender.js <template.html> <outdir> [options]
 *
 *   --no-cache     don't write events-cache.json[.gz]
 *   --limit <n>    max events per kind to request (default 500)
 *   --quiet        only print the summary
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';
import { decode } from '@nostr/tools/nip19';
import { SimplePool } from '@nostr/tools/pool';

import {
  parseConfigFromHtml,
  renderPage,
  serializeSeed,
  getEventData,
  processAll,
  dedupeReplaceable,
  isBakeableSlug,
  articlePath,
  setLocale,
  setMetadataRelays,
  closePools
} from '../dist/ssr.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const templatePath = positional[0];
const outDir = positional[1];
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1], 10) || 500 : 500;
const quiet = flags.has('--quiet');
const writeCache = !flags.has('--no-cache');

if (!templatePath || !outDir) {
  console.error('Usage: node scripts/prerender.js <template.html> <outdir> [options]');
  process.exit(1);
}

const log = (...a) => {
  if (!quiet) console.log(...a);
};

const template = readFileSync(templatePath, 'utf-8');
for (const slot of ['<!--oracolo:app-->', '<!--oracolo:seed-->', '<!--oracolo:head-->']) {
  if (!template.includes(slot)) {
    console.error(
      `Template is missing the ${slot} slot. Rebuild it with:\n` +
        `  node scripts/bundle.js --template <source.html> <template.html>`
    );
    process.exit(1);
  }
}

const { config, needsRelayList } = parseConfigFromHtml(template);
if (needsRelayList) {
  console.error('Prerendering needs an explicit <meta name="relays" content="…"> in the source.');
  process.exit(1);
}

let pubkeyHex;
try {
  pubkeyHex = decode(config.npub).data;
} catch (err) {
  console.error('Failed to decode npub:', err.message);
  process.exit(1);
}

log(`Author:  ${config.npub}`);
log(`Relays:  ${config.writeRelays.join(', ')}`);
log(`Output:  ${resolve(outDir)}`);
if (config.defaultTag) log(`Tag:     ${config.defaultTag}`);
if (!config.siteUrl) {
  console.warn(
    'No <meta name="site-url">: canonical, Open Graph and sitemap URLs need an ' +
      'absolute origin and will be skipped.'
  );
}

// ---------------------------------------------------------------- relays

const pool = new SimplePool();

async function fetchEvents() {
  // kind 0 = profile metadata, so the header paints without a relay roundtrip.
  const kinds = [0, 1, 20, 30023];
  const all = [];

  for (const kind of kinds) {
    const filter = { kinds: [kind], authors: [pubkeyHex], limit };
    // Profile metadata is not topic-tagged; only narrow content kinds.
    if (config.defaultTag && kind !== 0) filter['#t'] = [config.defaultTag];
    try {
      // querySync verifies signatures; these events are about to be baked into
      // HTML served to everyone, so that matters more here than in a browser.
      const events = await pool.querySync(config.writeRelays, filter);
      log(`  kind ${kind}: ${events.length}`);
      all.push(...events);
    } catch (err) {
      console.warn(`  kind ${kind} failed:`, err.message);
    }
  }
  return all;
}

// ---------------------------------------------------------------- helpers

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * String.replace() treats `$&`, `$'` and friends in the replacement as
 * backreferences — and rendered article HTML is full of arbitrary text. A
 * function replacement is inserted verbatim.
 */
function fill(html, slot, value) {
  return html.replace(slot, () => value);
}

function setTitle(html, title) {
  return html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`);
}

/**
 * Drop the site-wide social tags so an article page can carry its own. A
 * second og:title would just be ignored by most scrapers.
 */
function stripSocialMeta(html) {
  return html
    .replace(/[ \t]*<meta\s+property=["']og:[^>]*>\s*\n?/gi, '')
    .replace(/[ \t]*<meta\s+name=["'](?:twitter:[^"']*|description)["'][^>]*>\s*\n?/gi, '');
}

function absoluteUrl(path) {
  if (!config.siteUrl) return '';
  return config.siteUrl + path;
}

function plainSummary(event, data) {
  const summary = (data.summary || '').trim();
  const source = summary || event.content || '';
  const text = source
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 300 ? text.slice(0, 297).trimEnd() + '…' : text;
}

function jsonLd(object) {
  // `<` cannot appear raw inside a <script> block.
  return JSON.stringify(object).replace(/</g, '\\u003c');
}

function writeFile(relativePath, contents) {
  const full = join(outDir, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
  return full;
}

// ---------------------------------------------------------------- assets

/**
 * Pull the inlined bundle out of the template so article pages can share one
 * cached copy instead of shipping 500 KB of JavaScript per article. index.html
 * keeps everything inline: it stays a single self-contained file, which is
 * what the "download it" button hands people.
 */
function extractAssets(html) {
  const assets = [];
  let out = html;

  const appScript = /<script data-oracolo-app>([\s\S]*?)<\/script>/i.exec(html);
  if (appScript) {
    assets.push({ name: 'app.js', content: appScript[1] });
    out = out.replace(
      appScript[0],
      () => `<script defer src="${config.sitePath}app.js"></script>`
    );
  }

  const appStyle = /<style data-oracolo-app>([\s\S]*?)<\/style>/i.exec(html);
  if (appStyle) {
    assets.push({ name: 'app.css', content: appStyle[1] });
    out = out.replace(
      appStyle[0],
      () => `<link rel="stylesheet" href="${config.sitePath}app.css">`
    );
  }

  const siteStyles = [...html.matchAll(/<style data-oracolo-site>([\s\S]*?)<\/style>/gi)];
  if (siteStyles.length) {
    assets.push({ name: 'site.css', content: siteStyles.map((m) => m[1]).join('\n') });
    let first = true;
    for (const match of siteStyles) {
      out = out.replace(match[0], () =>
        first
          ? ((first = false), `<link rel="stylesheet" href="${config.sitePath}site.css">`)
          : ''
      );
    }
  }

  return { html: out, assets };
}

// ---------------------------------------------------------------- render

async function main() {
  const fetched = await fetchEvents();
  if (fetched.length === 0) {
    console.error('No events fetched — refusing to bake an empty site.');
    process.exit(2);
  }

  const events = dedupeReplaceable(fetched).sort((a, b) => b.created_at - a.created_at);
  const profileEvent = events.find((e) => e.kind === 0);
  if (!profileEvent) {
    console.error('No kind-0 profile event found — refusing to bake a site without a header.');
    process.exit(2);
  }

  const generatedAt = Math.round(Date.now() / 1000);
  if (config.pageLanguage) setLocale(config.pageLanguage);
  setMetadataRelays(config.writeRelays);

  const articles = events
    .filter((e) => e.kind === 30023)
    .map((event) => {
      const data = getEventData(event);
      return { event, data, slug: data.identifier };
    });
  const bakeable = articles.filter((a) => isBakeableSlug(a.slug));
  const skipped = articles.length - bakeable.length;

  const paths = {
    base: config.articleBase,
    root: config.sitePath,
    slugs: bakeable.map((a) => a.slug)
  };

  const { html: articleTemplate, assets } = extractAssets(template);
  for (const asset of assets) writeFile(asset.name, asset.content);
  log(`Assets:  ${assets.map((a) => a.name).join(', ') || 'none'}`);

  const profileName = (() => {
    try {
      const md = JSON.parse(profileEvent.content);
      return md.display_name || md.displayName || md.name || config.npub;
    } catch {
      return config.npub;
    }
  })();

  // ---- homepage -------------------------------------------------------
  const homeSeed = { generated_at: generatedAt, events, route: { type: 'home' }, paths };
  const home = renderPage({ config, seed: homeSeed });

  let homeHtml = fill(template, '<!--oracolo:app-->', home.html);
  homeHtml = fill(
    homeHtml,
    '<!--oracolo:seed-->',
    `<script type="application/json" id="oracolo-seed">${serializeSeed(homeSeed)}</script>`
  );
  homeHtml = fill(homeHtml, '<!--oracolo:head-->', homeHead());
  writeFile('index.html', homeHtml);
  log(`Home:    index.html (${(Buffer.byteLength(homeHtml) / 1024).toFixed(0)} KB)`);

  // ---- article pages --------------------------------------------------
  for (const article of bakeable) {
    const rendered = await processAll(article.data);
    const seed = {
      generated_at: generatedAt,
      events: [profileEvent, article.event],
      rendered: { [article.data.replKey]: rendered },
      route: { type: 'event', ref: article.slug },
      paths
    };

    const page = renderPage({ config, seed });
    let html = stripSocialMeta(articleTemplate);
    html = setTitle(html, article.data.title);
    html = fill(html, '<!--oracolo:app-->', page.html);
    html = fill(
      html,
      '<!--oracolo:seed-->',
      `<script type="application/json" id="oracolo-seed">${serializeSeed(seed)}</script>`
    );
    html = fill(html, '<!--oracolo:head-->', articleHead(article, profileName));

    writeFile(join(config.articleBase.replace(/^\//, ''), article.slug, 'index.html'), html);
  }
  log(`Articles: ${bakeable.length} pages${skipped ? ` (${skipped} skipped: unsafe d tag)` : ''}`);

  // ---- sitemap, feed, robots, cache -----------------------------------
  if (config.siteUrl) {
    writeFile('sitemap.xml', sitemap(bakeable));
    writeFile('feed.xml', await feed(bakeable, profileName, generatedAt));
    log('Extras:  sitemap.xml, feed.xml');

    const robotsPath = join(outDir, 'robots.txt');
    if (!existsSync(robotsPath)) {
      writeFile(
        'robots.txt',
        `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`
      );
      log('Extras:  robots.txt');
    }
  }

  if (writeCache) {
    const cache = JSON.stringify({ generated_at: generatedAt, npub: config.npub, events });
    writeFile('events-cache.json', cache);
    writeFile('events-cache.json.gz', gzipSync(Buffer.from(cache)));
  }

  console.log(
    `Prerendered ${bakeable.length + 1} pages from ${events.length} events ` +
      `(${new Date(generatedAt * 1000).toISOString()})`
  );
}

function homeHead() {
  const lines = [];
  const url = absoluteUrl(config.sitePath);
  if (url) lines.push(`<link rel="canonical" href="${escapeHtml(url)}">`);
  if (config.siteUrl) {
    lines.push(
      `<link rel="alternate" type="application/atom+xml" href="${escapeHtml(
        absoluteUrl('/feed.xml')
      )}">`
    );
  }
  return lines.map((l) => `    ${l}`).join('\n');
}

function articleHead(article, profileName) {
  const { data, event, slug } = article;
  const url = absoluteUrl(articlePath(slug, { base: config.articleBase }));
  const description = plainSummary(event, data);
  const published = new Date(event.created_at * 1000).toISOString();

  const lines = [];
  if (description) lines.push(`<meta name="description" content="${escapeHtml(description)}">`);
  if (url) lines.push(`<link rel="canonical" href="${escapeHtml(url)}">`);
  lines.push(`<meta property="og:type" content="article">`);
  lines.push(`<meta property="og:title" content="${escapeHtml(data.title)}">`);
  if (description) {
    lines.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
  }
  if (url) lines.push(`<meta property="og:url" content="${escapeHtml(url)}">`);
  if (data.image) lines.push(`<meta property="og:image" content="${escapeHtml(data.image)}">`);
  lines.push(
    `<meta name="twitter:card" content="${data.image ? 'summary_large_image' : 'summary'}">`
  );
  lines.push(`<meta name="twitter:title" content="${escapeHtml(data.title)}">`);
  if (description) {
    lines.push(`<meta name="twitter:description" content="${escapeHtml(description)}">`);
  }
  if (data.image) lines.push(`<meta name="twitter:image" content="${escapeHtml(data.image)}">`);

  if (url) {
    lines.push(
      `<script type="application/ld+json">${jsonLd({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: data.title,
        description: description || undefined,
        image: data.image ? [data.image] : undefined,
        datePublished: published,
        dateModified: published,
        inLanguage: config.pageLanguage || undefined,
        author: { '@type': 'Person', name: profileName, url: `https://njump.me/${config.npub}` },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        url
      })}</script>`
    );
  }

  return lines.map((l) => `    ${l}`).join('\n');
}

function sitemap(articles) {
  const entries = [
    { loc: absoluteUrl(config.sitePath), lastmod: null },
    ...articles.map((a) => ({
      loc: absoluteUrl(articlePath(a.slug, { base: config.articleBase })),
      lastmod: new Date(a.event.created_at * 1000).toISOString()
    }))
  ];

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map(
        (e) =>
          `  <url><loc>${escapeHtml(e.loc)}</loc>` +
          (e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : '') +
          `</url>`
      )
      .join('\n') +
    `\n</urlset>\n`
  );
}

async function feed(articles, profileName, generatedAt) {
  const site = absoluteUrl(config.sitePath);
  const entries = [];
  for (const a of articles.slice(0, 40)) {
    const url = absoluteUrl(articlePath(a.slug, { base: config.articleBase }));
    entries.push(
      `  <entry>\n` +
        `    <title>${escapeHtml(a.data.title)}</title>\n` +
        `    <link href="${escapeHtml(url)}"/>\n` +
        `    <id>${escapeHtml(url)}</id>\n` +
        `    <updated>${new Date(a.event.created_at * 1000).toISOString()}</updated>\n` +
        `    <summary>${escapeHtml(plainSummary(a.event, a.data))}</summary>\n` +
        `  </entry>`
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom"${
      config.pageLanguage ? ` xml:lang="${escapeHtml(config.pageLanguage)}"` : ''
    }>\n` +
    `  <title>${escapeHtml(titleOf(template))}</title>\n` +
    `  <link href="${escapeHtml(site)}"/>\n` +
    `  <link rel="self" href="${escapeHtml(absoluteUrl('/feed.xml'))}"/>\n` +
    `  <id>${escapeHtml(site)}</id>\n` +
    `  <updated>${new Date(generatedAt * 1000).toISOString()}</updated>\n` +
    `  <author><name>${escapeHtml(profileName)}</name></author>\n` +
    entries.join('\n') +
    `\n</feed>\n`
  );
}

function titleOf(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : 'Oracolo';
}

try {
  await main();
} catch (err) {
  console.error('Prerender failed:', err);
  process.exitCode = 1;
} finally {
  // Open relay sockets keep the event loop alive; a cron job has to exit.
  try {
    pool.close(config.writeRelays);
    closePools();
  } catch {
    /* closing is best-effort */
  }
  process.exit(process.exitCode || 0);
}
