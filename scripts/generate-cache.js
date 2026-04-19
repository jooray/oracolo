#!/usr/bin/env node

/**
 * Cache generator for Oracolo
 *
 * Reads an Oracolo HTML file to extract configuration (npub, relays, default-tag, blocks),
 * connects to the configured relays, fetches all relevant events, and writes an
 * events-cache.json file for instant page loading.
 *
 * Usage: node scripts/generate-cache.js <path-to-index.html> [output-path]
 *
 * Example: node scripts/generate-cache.js index.html events-cache.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { decode } from '@nostr/tools/nip19';
import { SimplePool } from '@nostr/tools/pool';

const htmlPath = process.argv[2];
const outputPath = process.argv[3] || 'events-cache.json';

if (!htmlPath) {
  console.error('Usage: node scripts/generate-cache.js <path-to-index.html> [output-path]');
  process.exit(1);
}

// Parse meta tags from HTML
function parseMeta(html, name) {
  // Match both content="..." name="..." and name="..." content="..." orders
  // Also handle value="..." for older oracolo format
  const patterns = [
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'gi'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'gi'),
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'gi'),
    new RegExp(`<meta[^>]*value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'gi'),
  ];

  const results = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      results.push(match[1]);
    }
  }
  return results;
}

const html = readFileSync(htmlPath, 'utf-8');

// Extract config
const authorValues = parseMeta(html, 'author');
const npub = authorValues[0];
if (!npub) {
  console.error('No author meta tag found in HTML');
  process.exit(1);
}

const relayValues = parseMeta(html, 'relays');
const relays = relayValues[0]
  ? relayValues[0].split(',').map((r) => {
      const trimmed = r.trim();
      return trimmed.startsWith('wss://') || trimmed.startsWith('ws://') ? trimmed : 'wss://' + trimmed;
    })
  : ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.nostr.band'];

const defaultTagValues = parseMeta(html, 'default-tag');
const defaultTag = defaultTagValues[0] || '';

// Decode npub to hex
let pubkeyHex;
try {
  const decoded = decode(npub);
  pubkeyHex = decoded.data;
} catch (err) {
  console.error('Failed to decode npub:', err.message);
  process.exit(1);
}

console.log(`Author: ${npub}`);
console.log(`Pubkey: ${pubkeyHex}`);
console.log(`Relays: ${relays.join(', ')}`);
if (defaultTag) console.log(`Default tag: ${defaultTag}`);

// Fetch events
const pool = new SimplePool();

async function fetchEvents() {
  const kinds = [1, 20, 30023];
  const allEvents = [];

  for (const kind of kinds) {
    console.log(`Fetching kind ${kind} events...`);
    const filter = {
      kinds: [kind],
      authors: [pubkeyHex],
      limit: 500
    };
    if (defaultTag) {
      filter['#t'] = [defaultTag];
    }

    try {
      const events = await pool.querySync(relays, filter);
      console.log(`  Got ${events.length} kind ${kind} events`);
      allEvents.push(...events);
    } catch (err) {
      console.warn(`  Error fetching kind ${kind}:`, err.message);
    }
  }

  return allEvents;
}

try {
  const events = await fetchEvents();

  // Deduplicate by event ID
  const seen = new Set();
  const uniqueEvents = events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const cacheData = {
    generated_at: Math.round(Date.now() / 1000),
    npub,
    events: uniqueEvents
  };

  const jsonStr = JSON.stringify(cacheData);
  writeFileSync(outputPath, jsonStr);

  const jsonBytes = Buffer.byteLength(jsonStr);
  const gzipped = gzipSync(Buffer.from(jsonStr));
  const gzPath = outputPath + '.gz';
  writeFileSync(gzPath, gzipped);

  console.log(`\nCache written to ${outputPath} (${(jsonBytes / 1024).toFixed(1)} KB)`);
  console.log(`Compressed:    ${gzPath} (${(gzipped.length / 1024).toFixed(1)} KB)`);
  console.log(`Total events: ${uniqueEvents.length}`);
  console.log(`Generated at: ${new Date(cacheData.generated_at * 1000).toISOString()}`);
} catch (err) {
  console.error('Failed to generate cache:', err);
  process.exit(1);
} finally {
  pool.close(relays);
}
