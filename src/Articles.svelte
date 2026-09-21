<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { formatDate, isPinned, type EventData, type PermalinkMode } from './utils.js';
  import type { Config } from './config.js';
  import type { EventSource } from './blockUtils.js';
  import type { SeedPaths } from './seed.js';
  import { eventHref } from './router.js';

  // Block-specific props
  export let source: EventSource;
  export let count: Config['count'];
  export let style: Config['style'];
  export let minChars: Config['minChars'];
  export let ids: string[] | undefined = undefined;

  // Permalink strategy for article (kind 30023) links. Defaults keep links
  // stable across article edits by pointing at the permanent `d`-tag slug.
  export let permalinks: PermalinkMode = 'slug';
  export let permalinkRelays: string[] = [];
  // Set on a prerendered site, where articles also have a real path on disk.
  export let paths: SeedPaths | null = null;

  const hrefFor = (event: EventData) =>
    eventHref(event, { permalinks, relays: permalinkRelays, paths });

  let items: EventData[] = [];
  const seen = new Set<string>();
  let unsubAdditions: (() => void) | null = null;

  // With a seed in the page the events are already here, so the block fills
  // during init — server-side there is no onMount, and client-side hydration
  // needs this render to match the markup that was baked.
  const seeded = source?.preloaded === true;
  if (seeded) {
    if (ids) {
      style = 'grid';
      items = source.fetchPinnedSync(ids);
    } else {
      items = source.pluckSync(count, minChars);
    }
    for (const e of items) seen.add(e.id);
  }

  onMount(() => {
    (async () => {
      if (ids) {
        style = 'grid';
        // A pin the seed does not cover (a brand-new article, say) still
        // resolves from the relays.
        if (!seeded || items.length < ids.length) {
          items = await source.fetchPinned(ids);
        }
        return;
      }

      if (!seeded) {
        items = await source.pluck(count, minChars);
        for (const e of items) seen.add(e.id);
      }

      unsubAdditions = source.additions.subscribe((events) => {
        if (!events?.length) return;
        items = source.mergeAdditions(items, events, minChars, count, seen);
      });
    })();
  });

  onDestroy(() => unsubAdditions?.());
</script>

{#if items.length > 0}
  <section class="block articles">
    {#if style === 'grid'}
      <div class="grid {items.length % 2 !== 0 ? 'odd' : ''}">
        {#each items as event}
          <div class="item">
            <a href={hrefFor(event)}>
              <!-- svelte-ignore a11y-missing-attribute -->
              {#if event.image}
                <img src={event.image} />
              {/if}
              <div class="title">{event.title}</div>

              {#if event.summary}
                <div class="summary">{@html event.summary}</div>
              {/if}
              <div>
                <span class="date">{formatDate(event.created_at)}</span>
                {#if ids && isPinned(event, ids)}
                  <span class="pinned">- 📌 Pinned</span>
                {/if}
              </div>
            </a>
          </div>
        {/each}
      </div>
    {:else if style === 'list'}
      <div class="list">
        <ul>
          {#each items as event}
            <li>
              <a href={hrefFor(event)}>
                <h2>{event.title}</h2>
                {#if event.summary}
                  <div class="summary">{event.summary}</div>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}
