// The prerender seed: the machine-readable twin of the baked DOM.
//
// A prerendered page ships its events inline, in a <script type="application/
// json"> block, instead of making the browser fetch events-cache.json. The
// same events produced the markup that is already in the DOM, so the client
// can hydrate that markup instead of rebuilding it — and then keep doing
// exactly what it does today: query the relays for anything newer than
// `generated_at` and merge it in reactively.

import { type NostrEvent } from '@nostr/tools/core';
import type { Route } from './router';

export const SEED_ELEMENT_ID = 'oracolo-seed';

export interface SeedPaths {
  /** Path prefix for baked article pages, e.g. "/a/". */
  base: string;
  /** Site root, used for asset and homepage links. */
  root: string;
  /** `d` tags that have a baked page on disk. */
  slugs: string[];
}

export interface Seed {
  generated_at: number;
  events: NostrEvent[];
  /** Pre-rendered article bodies, keyed by replaceable identity. */
  rendered?: Record<string, string>;
  /** The route this page was baked for — what hydration must reproduce. */
  route: Route;
  paths?: SeedPaths;
}

/** Reads the inline seed, or null on a page that was not prerendered. */
export function readSeed(): Seed | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(SEED_ELEMENT_ID);
  if (!el?.textContent) return null;
  try {
    const seed = JSON.parse(el.textContent);
    if (typeof seed?.generated_at !== 'number' || !Array.isArray(seed?.events)) {
      console.warn('Invalid seed format, ignoring');
      return null;
    }
    if (!seed.route) seed.route = { type: 'home' };
    return seed as Seed;
  } catch (err) {
    console.warn('Failed to parse seed', err);
    return null;
  }
}

/**
 * Serialize a seed for embedding in HTML.
 *
 * The events come from relays, so they are untrusted input being written into
 * a document: escaping `<` closes off `</script>` (and `<!--`) breakouts. The
 * result is still valid JSON — < is just an escaped character.
 */
export function serializeSeed(seed: Seed): string {
  return JSON.stringify(seed).replace(/</g, '\\u003c');
}
