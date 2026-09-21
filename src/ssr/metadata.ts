// Node stand-in for `@nostr/gadgets/metadata`.
//
// The real module opens an IndexedDB store at import time, which throws the
// moment it is loaded outside a browser. The SSR build aliases it to this
// file: same surface, same NostrUser shape, but profiles are fetched straight
// from the relays and memoized in a plain Map for the life of the process.

import { npubEncode } from '@nostr/tools/nip19';
import { type NostrEvent } from '@nostr/tools/core';
import { pool } from '@nostr/gadgets/global';

// Same list @nostr/gadgets uses internally; it is not on the package exports.
const METADATA_QUERY_RELAYS = [
  'wss://purplepag.es',
  'wss://relay.nos.social',
  'wss://user.kindpag.es'
];

export type NostrUser = {
  pubkey: string;
  npub: string;
  shortName: string;
  image?: string;
  metadata: Record<string, any>;
  lastUpdated: number;
  lastAttempt?: number;
};

let siteRelays: string[] = [];
let lookupTimeout = 4000;

/** Relays to consult for profile metadata, on top of the public defaults. */
export function setMetadataRelays(relays: string[], timeoutMs = 4000): void {
  siteRelays = relays;
  lookupTimeout = timeoutMs;
}

/** Close the sockets the profile lookups opened, so the process can exit. */
export function closePools(): void {
  const relays = Array.from(new Set([...siteRelays, ...METADATA_QUERY_RELAYS]));
  try {
    pool.close(relays);
  } catch {
    /* best-effort */
  }
}

export function bareNostrUser(input: string): NostrUser {
  const pubkey = input.startsWith('npub1') || input.startsWith('nprofile') ? input : input;
  return blankNostrUser(pubkey);
}

function blankNostrUser(pubkey: string): NostrUser {
  const npub = npubEncode(pubkey);
  return {
    pubkey,
    npub,
    shortName: npub.substring(0, 8) + '…' + npub.substring(59),
    lastUpdated: 0,
    metadata: {}
  };
}

function enhance(nu: NostrUser, evt: NostrEvent): NostrUser {
  let md: Record<string, any> = {};
  try {
    md = JSON.parse(evt.content);
  } catch {
    /**/
  }
  nu.metadata = md;
  nu.shortName = md.name || md.display_name || md.nip05?.split('@')?.[0] || nu.shortName;
  if (md.picture) nu.image = md.picture;
  return nu;
}

export function nostrUserFromEvent(evt: NostrEvent): NostrUser {
  return enhance(blankNostrUser(evt.pubkey), evt);
}

const cache = new Map<string, Promise<NostrUser>>();

export function loadNostrUser(
  request: string | { pubkey: string; relays?: string[] }
): Promise<NostrUser> {
  const pubkey = typeof request === 'string' ? request : request.pubkey;
  const relays = typeof request === 'string' ? [] : request.relays || [];

  let pending = cache.get(pubkey);
  if (!pending) {
    pending = fetchUser(pubkey, relays);
    cache.set(pubkey, pending);
  }
  return pending;
}

async function fetchUser(pubkey: string, relays: string[]): Promise<NostrUser> {
  const urls = Array.from(new Set([...relays, ...siteRelays, ...METADATA_QUERY_RELAYS]));
  try {
    const timeout = new Promise<NostrEvent[]>((resolve) =>
      setTimeout(() => resolve([]), lookupTimeout)
    );
    const events = await Promise.race([
      pool.querySync(urls, { kinds: [0], authors: [pubkey] }),
      timeout
    ]);
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (latest) return nostrUserFromEvent(latest);
  } catch (err) {
    console.warn(`metadata lookup failed for ${pubkey.slice(0, 8)}:`, err);
  }
  return blankNostrUser(pubkey);
}
