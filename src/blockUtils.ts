import { type NostrEvent } from '@nostr/tools/core';
import { type Filter } from '@nostr/tools/filter';
import * as nip27 from '@nostr/tools/nip27';
import { pool } from '@nostr/gadgets/global';
import { Mutex } from '@livekit/mutex';

import { getEventData, isRootNote, dedupeReplaceable, replaceableKey, type EventData } from './utils';
import { writable } from 'svelte/store';

export const loaded = writable(false);
export const totalDisplayedNotes = writable(0);

export class EventSource {
  relays: string[];
  filter: Filter;

  #items: NostrEvent[] = [];
  #until = Math.round(Date.now() / 1000);
  #kind: number;

  #done: { [relay: string]: boolean } = {};
  #mutex = new Mutex();
  #sinceOverride: number | null = null;

  constructor(relays: string[], filter: Filter) {
    this.relays = relays;
    this.filter = filter;
    this.#kind = filter.kinds?.[0] || 1;
  }

  preload(events: NostrEvent[], sinceTimestamp?: number) {
    this.#items.push(...events);
    this.#items = dedupeReplaceable(this.#items);
    this.#items.sort((a, b) => a.created_at - b.created_at);
    if (sinceTimestamp !== undefined) {
      this.#sinceOverride = sinceTimestamp;
    }
  }

  // Reactive notifier: emits a list of newly-fetched events whenever
  // refreshSince() finds events the cache didn't have. Each block component
  // subscribes, dedupes against its own already-rendered set, and merges in.
  additions = writable<NostrEvent[]>([]);

  // Mark every configured relay as already-queried so pluck() will only
  // consume the in-memory #items (preloaded from cache) and never block on
  // a relay roundtrip. Use this when the cache is authoritative for first
  // paint — typically after a successful loadCache() preload.
  markAllRelaysDone(): void {
    for (const r of this.relays) {
      this.#done[r] = true;
    }
  }

  // Background relay query for events newer than the cache. Non-blocking:
  // call without awaiting so first paint happens immediately from cache,
  // then any newer events stream in via the `additions` store.
  async refreshSince(sinceTimestamp: number): Promise<void> {
    if (!this.relays.length) return;
    try {
      const fresh = await pool.querySync(this.relays, {
        ...this.filter,
        since: sinceTimestamp
      });
      if (fresh.length > 0) {
        this.additions.set(fresh);
      }
    } catch (err) {
      console.warn('background refresh failed', err);
    }
  }

  passesFilter(event: NostrEvent, minChars: number): boolean {
    if (this.#kind === 1 && !isRootNote(event)) return false;
    if (minChars > 0) {
      if (event.kind === 30023) return event.content.length >= minChars;
      return isLengthEqualOrGreaterThanThreshold(event, minChars);
    }
    return true;
  }

  // Merge background-fetched events into a component's current item list,
  // deduping by id and by replaceable identity. A new version of a
  // parameterized-replaceable event (same kind+pubkey+`d` tag, higher
  // created_at) replaces the older one in-place.
  mergeAdditions(
    current: EventData[],
    events: NostrEvent[],
    minChars: number,
    count: number,
    seen: Set<string>
  ): EventData[] {
    const existingByKey = new Map<string, EventData>();
    for (const it of current) existingByKey.set(it.replKey, it);

    const fresh: EventData[] = [];
    const replacedKeys = new Set<string>();
    for (const e of events) {
      if (seen.has(e.id)) continue;
      if (!this.passesFilter(e, minChars)) continue;
      const key = replaceableKey(e);
      const existing = existingByKey.get(key);
      if (existing && existing.created_at >= e.created_at) {
        seen.add(e.id);
        continue;
      }
      seen.add(e.id);
      fresh.push(getEventData(e));
      replacedKeys.add(key);
    }
    if (!fresh.length) return current;
    const filtered = current.filter((it) => !replacedKeys.has(it.replKey));
    return [...fresh, ...filtered]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, count);
  }

  // Eagerly query the relays once and stash results into #items.
  // Lets Blog.svelte race a cache fetch and a relay query in parallel:
  // whichever finishes first populates #items so pluck() never has to wait.
  // The relays we hit here are marked done so pluck() won't re-query them.
  async prefetch(limit = 100): Promise<void> {
    const relays = this.relays.slice(0, 3);
    if (relays.length === 0) return;
    try {
      const downloaded = await pool.querySync(relays, {
        ...this.filter,
        until: this.#until,
        limit
      });
      this.#items.push(...downloaded);
      this.#items = dedupeReplaceable(this.#items);
      this.#items.sort((a, b) => a.created_at - b.created_at);
    } finally {
      relays.forEach((r) => {
        this.#done[r] = true;
      });
    }
  }

  async pluck(count: number, minChars: number): Promise<EventData[]> {
    const unlock = await this.#mutex.lock();

    const results: EventData[] = [];

    let events = this.#items;
    this.#items = [];

    while (events.length > 0 || Object.keys(this.#done).length < this.relays.length) {
      if (events.length < count) {
        const relays = this.relays.filter((r) => !this.#done[r]).slice(0, 2);

        if (relays.length) {
          let downloaded = await pool.querySync(relays, {
            ...this.filter,
            until: this.#until,
            ...(this.#sinceOverride ? { since: this.#sinceOverride } : {}),
            limit: Math.floor(
              count *
                (minChars > (this.#kind === 1 ? 20 : 200)
                  ? minChars / (this.#kind === 1 ? 20 : 200)
                  : 1) *
                20 // Apply a x20 multiplier to handle the root notes filter
            )
          });

          if (downloaded.length === 0) {
            relays.forEach((r) => {
              this.#done[r] = true;
            });
          } else {
            if (this.#kind === 1) {
              downloaded = downloaded.filter(isRootNote);
            }

            events.push(...downloaded);
            events = dedupeReplaceable(events);
            events.sort((a, b) => a.created_at - b.created_at);

            this.#until = events[0]?.created_at - 1;
          }
        }
      }

      // iterate backwards so we can easily remove items
      for (let i = events.length - 1; i >= 0; i--) {
        let item = events[i];

        // Check min length
        if (minChars > 0) {
          if (item.kind === 30023 /* won't try to render markdown here, just count raw */) {
            if (item.content.length < minChars) {
              this.#items.push(item);
              events.splice(i, 1);
              continue;
            }
          } else if (!isLengthEqualOrGreaterThanThreshold(item, minChars)) {
            this.#items.push(item);
            events.splice(i, 1);
            continue;
          }
        }

        // This one passed all the filters:
        events.splice(i, 1);
        results.push(getEventData(item));

        // Exit early if we got everything we needed
        if (results.length === count) {
          unlock();
          this.#items.push(...events);
          this.#items.sort((a, b) => a.created_at - b.created_at);
          totalDisplayedNotes.update((v) => v + results.length);
          loaded.set(true);
          return results;
        }
      }
    }

    this.#items.sort((a, b) => a.created_at - b.created_at);
    totalDisplayedNotes.update((v) => v + results.length);
    loaded.set(true);
    return results;
  }

  async fetchIds(ids: string[]): Promise<EventData[]> {
    const events = await pool.querySync(this.relays.slice(0, 5), { ids });
    loaded.set(true);
    return events.map(getEventData);
  }
}

// this function reads the event content progressively and exits early when the threshold has been met
// this may save us some nanoseconds.
function isLengthEqualOrGreaterThanThreshold(event: NostrEvent, threshold: number): boolean {
  let curr = 0;
  for (let block of nip27.parse(event.content)) {
    switch (block.type) {
      case 'text':
        curr += block.text.length;
      case 'url':
      case 'image':
      case 'video':
      case 'audio':
      case 'reference':
        // each one of these items are supposed to be parsed and rendered in a custom way
        // for the matter of counting the note size and filtering we will assign a static
        // "length-value" to each
        curr += 14;
    }

    if (curr >= threshold) {
      return true;
    }
  }

  return false;
}
