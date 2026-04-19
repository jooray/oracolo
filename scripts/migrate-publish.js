#!/usr/bin/env node

/**
 * Sign and publish kind-30023 articles from a curated draft JSON.
 *
 * Reads:
 *   - migration/articles-draft.json   (curated by hand; `_*` keys are stripped)
 *   - source.html                     (relays + author npub)
 *   - $NOSTR_SECRET_KEY               (nsec or 64-char hex; ephemeral)
 *
 * Refuses to publish unless the derived pubkey matches the npub in source.html.
 * Dry-run by default; pass `--publish` to actually finalize and broadcast.
 *
 * Usage:
 *   NOSTR_SECRET_KEY=nsec1... node scripts/migrate-publish.js
 *   NOSTR_SECRET_KEY=nsec1... node scripts/migrate-publish.js --publish
 */

import { readFileSync } from 'fs';
import { decode } from '@nostr/tools/nip19';
import { finalizeEvent, getPublicKey } from '@nostr/tools/pure';
import { SimplePool } from '@nostr/tools/pool';

const PUBLISH = process.argv.includes('--publish');
const DRAFT_PATH = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'migration/articles-draft.json';
const HTML_PATH = 'source.html';

function fail(msg) {
  console.error('error:', msg);
  process.exit(1);
}

function parseMeta(html, name) {
  const re = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}

const html = (() => {
  try { return readFileSync(HTML_PATH, 'utf8'); }
  catch { fail(`cannot read ${HTML_PATH} (run from the site root)`); }
})();

const npub = parseMeta(html, 'author');
if (!npub.startsWith('npub1')) fail(`no <meta name="author" content="npub1..."> in ${HTML_PATH}`);

const expectedPubkey = (() => {
  try {
    const { type, data } = decode(npub);
    if (type !== 'npub') fail(`author meta is not an npub: ${npub}`);
    return data;
  } catch (e) { fail(`bad npub in author meta: ${e.message}`); }
})();

const EXTRA_PUBLISH_RELAYS = ['wss://nostr.cypherpunk.today'];

const relaysRaw = parseMeta(html, 'relays') || '';
const siteRelays = relaysRaw.split(',').map(s => s.trim()).filter(Boolean);
if (siteRelays.length === 0) fail(`no <meta name="relays" content="..."> in ${HTML_PATH}`);
const relays = [...new Set([...siteRelays, ...EXTRA_PUBLISH_RELAYS])];

const draft = (() => {
  try { return JSON.parse(readFileSync(DRAFT_PATH, 'utf8')); }
  catch (e) { fail(`cannot parse ${DRAFT_PATH}: ${e.message}`); }
})();

if (!Array.isArray(draft.articles)) fail(`${DRAFT_PATH} must have an "articles" array`);
const updates = Array.isArray(draft.updates) ? draft.updates : [];
const rawEntries = [
  ...draft.articles.map((a) => ({ raw: a, kind: 'new' })),
  ...updates.map((a) => ({ raw: a, kind: 'update' }))
];

// Skip anything already marked _status: "published" so re-running publish.mjs
// is a no-op for already-broadcast events. To re-broadcast an entry (e.g. an
// edit), flip _status back to "ready" (or "to-publish") and bump created_at.
const allEntries = rawEntries.filter((e) => e.raw._status !== 'published');
const skippedPublished = rawEntries.length - allEntries.length;

const sk = (() => {
  if (!PUBLISH) return null;
  const env = process.env.NOSTR_SECRET_KEY;
  if (!env) fail('NOSTR_SECRET_KEY env var is required for --publish');
  if (env.startsWith('nsec1')) {
    try {
      const { type, data } = decode(env);
      if (type !== 'nsec') fail('env var is not an nsec');
      return data;
    } catch (e) { fail(`bad nsec: ${e.message}`); }
  }
  if (/^[0-9a-f]{64}$/i.test(env)) return Uint8Array.from(Buffer.from(env, 'hex'));
  fail('NOSTR_SECRET_KEY must be an nsec1... or 64-char hex secret key');
})();

if (sk) {
  const derived = getPublicKey(sk);
  if (derived !== expectedPubkey) {
    fail(`secret key derives ${derived.slice(0, 16)}…\n        but ${HTML_PATH} expects ${expectedPubkey.slice(0, 16)}… (npub ${npub.slice(0, 16)}…)\n        refusing to publish under the wrong identity.`);
  }
}

function stripUnderscoreKeys(o) {
  if (Array.isArray(o)) return o.map(stripUnderscoreKeys);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_')) continue;
      out[k] = stripUnderscoreKeys(v);
    }
    return out;
  }
  return o;
}

function isPlaceholderTag(tags, name) {
  const t = tags.find((x) => x[0] === name);
  if (!t) return false;
  return /TODO|FIXME|paste/i.test(t[1] || '');
}

const eventsToPublish = [];
const errors = [];

for (const { raw, kind } of allEntries) {
  const a = stripUnderscoreKeys(raw);

  if (a.kind !== 30023) errors.push(`${raw._source || a.tags?.find(t=>t[0]==='d')?.[1]}: kind must be 30023`);
  if (!a.tags?.find(t=>t[0]==='d')) errors.push(`${raw._source}: missing d tag`);
  if (!a.tags?.find(t=>t[0]==='title')) errors.push(`${raw._source}: missing title tag`);
  if (isPlaceholderTag(a.tags, 'image')) errors.push(`${raw._source}: image tag is still a placeholder ("TODO/paste...") — fill it in or drop the image tag`);
  if (typeof a.created_at !== 'number') errors.push(`${raw._source}: created_at must be a number`);
  if (typeof a.content !== 'string') errors.push(`${raw._source}: content must be a string`);

  eventsToPublish.push({ source: raw._source, status: raw._status, mode: kind, evt: a });
}

if (errors.length) {
  console.error('Validation errors:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}

console.log(`Author: ${npub}`);
console.log(`Relays: ${relays.join(', ')}`);
console.log(`Mode:   ${PUBLISH ? 'PUBLISH' : 'dry-run (pass --publish to broadcast)'}`);
console.log(`Articles: ${eventsToPublish.length}${skippedPublished ? ` (skipped ${skippedPublished} already-published)` : ''}`);
console.log('');

if (eventsToPublish.length === 0) {
  console.log('Nothing to publish. To re-broadcast an entry, set _status to "ready" (or remove the field) and bump created_at.');
  process.exit(0);
}

for (const { source, status, mode, evt } of eventsToPublish) {
  const d = evt.tags.find(t=>t[0]==='d')[1];
  const title = evt.tags.find(t=>t[0]==='title')[1];
  const date = new Date(evt.created_at * 1000).toISOString().slice(0, 10);
  const r = evt.tags.filter(t=>t[0]==='r').map(t=>t[2] || t[1]);
  const rStr = r.length ? `  [${r.join(', ')}]` : '';
  const tag = mode === 'update' ? '[UPDATE]' : '[NEW]   ';
  console.log(`  ${tag} ${date}  d=${d.padEnd(34)}  ${title}${rStr}`);
  console.log(`           source=${source}  status=${status || ''}`);
}

if (!PUBLISH) {
  console.log('');
  console.log('Dry-run only. Re-run with --publish to broadcast.');
  process.exit(0);
}

console.log('');
console.log('Signing and publishing...');

const pool = new SimplePool();
let okCount = 0;
let failCount = 0;

for (const { source, evt } of eventsToPublish) {
  const finalized = finalizeEvent(evt, sk);
  const d = evt.tags.find(t=>t[0]==='d')[1];

  let accepted = 0;
  let rejected = 0;
  const failures = [];

  await Promise.all(
    pool.publish(relays, finalized).map((p, i) =>
      p.then(() => { accepted++; })
       .catch((err) => { rejected++; failures.push(`${relays[i]}: ${err?.message || err}`); })
    )
  );

  if (accepted > 0) {
    okCount++;
    console.log(`  ok   d=${d.padEnd(34)}  ${accepted}/${relays.length} relays`);
  } else {
    failCount++;
    console.log(`  FAIL d=${d.padEnd(34)}  0/${relays.length} relays`);
  }
  for (const f of failures) console.log(`         · ${f}`);
}

pool.close(relays);

console.log('');
console.log(`Done. ok=${okCount} fail=${failCount}`);
if (okCount > 0) {
  console.log('');
  console.log('Mark each successfully-published entry with `"_status": "published"` in the JSON to prevent re-broadcast on the next run.');
}
process.exit(failCount > 0 ? 2 : 0);
