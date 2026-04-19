<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent } from '@nostr/tools/core';

  import { type SiteConfig, type Block } from './config';
  import { documentTitle } from './stores/documentTitleStore';
  import Loading from './Loading.svelte';
  import type { NostrUser } from '@nostr/gadgets/metadata';
  import Articles from './Articles.svelte';
  import Notes from './Notes.svelte';
  import Images from './Images.svelte';
  import { loaded, totalDisplayedNotes, EventSource } from './blockUtils';
  import { getCache } from './cache';

  let npub = '';
  let topics: string[] = [];
  let blocks: Block[];

  let noteSource: EventSource;
  let imageSource: EventSource;
  let articleSource: EventSource;

  export let tag: string;
  export let profile: NostrUser | null;
  export let config: SiteConfig;

  $: documentTitle.subscribe((value) => {
    document.title = value;
  });

  onMount(async () => {
    if (!profile) {
      throw new Error('invalid npub');
    }
    npub = config.npub;
    topics = config.topics;

    documentTitle.set(profile.shortName + ' home, powered by Nostr');

    // fetch only required data — use defaultTag when no explicit tag is set
    const effectiveTag = tag || (config.defaultTag ? 'tags/' + config.defaultTag : '');
    const tagFilter = effectiveTag ? { '#t': [effectiveTag.substring('tags/'.length)] } : {};

    noteSource = new EventSource(config.writeRelays, {
      kinds: [1],
      authors: [profile.pubkey],
      ...tagFilter
    });
    imageSource = new EventSource(config.writeRelays, {
      kinds: [20],
      authors: [profile.pubkey],
      ...tagFilter
    });
    articleSource = new EventSource(config.writeRelays, {
      kinds: [30023],
      authors: [profile.pubkey],
      ...tagFilter
    });

    // Cache-first first paint:
    //  • If a cache-url is configured, fetch it (with a short timeout) and,
    //    on success, mark every relay as "done" so pluck() consumes only the
    //    in-memory items and never blocks on a relay roundtrip. The site is
    //    rendered entirely from cache for the first paint; the nightly cache
    //    refresh keeps it fresh.
    //  • If no cache, race relay prefetches against a 2.5s timeout so first
    //    paint still happens promptly.
    let cacheHit = false;
    if (config.cacheUrl) {
      try {
        const cacheTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
        const cache = await Promise.race([getCache(config.cacheUrl), cacheTimeout]);
        if (cache) {
          const kind1: NostrEvent[] = [];
          const kind20: NostrEvent[] = [];
          const kind30023: NostrEvent[] = [];
          for (const event of cache.events) {
            if (event.kind === 1) kind1.push(event);
            else if (event.kind === 20) kind20.push(event);
            else if (event.kind === 30023) kind30023.push(event);
          }
          noteSource.preload(kind1, cache.generated_at);
          imageSource.preload(kind20, cache.generated_at);
          articleSource.preload(kind30023, cache.generated_at);
          noteSource.markAllRelaysDone();
          imageSource.markAllRelaysDone();
          articleSource.markAllRelaysDone();
          cacheHit = true;
          // Fire-and-forget background refresh: render immediately from
          // cache, then merge in any events newer than cache.generated_at
          // via the EventSource.additions store. Non-blocking.
          noteSource.refreshSince(cache.generated_at);
          imageSource.refreshSince(cache.generated_at);
          articleSource.refreshSince(cache.generated_at);
        }
      } catch (err) {
        console.warn('cache load failed', err);
      }
    }

    if (!cacheHit) {
      const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
      await Promise.race([
        Promise.all([
          noteSource.prefetch(),
          imageSource.prefetch(),
          articleSource.prefetch()
        ]).catch((err) => console.warn('relay prefetch failed', err)),
        timeout
      ]);
    }

    blocks = config.blocks;
  });
</script>

{#if profile}
  <div class="header home">
    <div class="external-link">
      Profile: <a href="https://njump.me/{npub}">{npub.slice(0, 9) + '...' + npub.slice(-5)}</a>
    </div>
    <h1>
      <div class="picture-container">
        <!-- svelte-ignore a11y-missing-attribute -->
        <img src={profile?.image} />
      </div>
      {profile?.shortName}
    </h1>
    {#if config.bio || profile?.metadata?.about}
      <p class="about">{config.bio || profile?.metadata?.about}</p>
    {/if}
  </div>
{/if}

{#if topics.length > 0}
  <div class="topic-wrapper" class:hidden={!$loaded}>
    <!-- svelte-ignore a11y-invalid-attribute -->
    <div><a href="#" class={tag == '' ? 'selected' : ''}>Home</a></div>
    {#each topics as topic}
      <div><a href="#tags/{topic}" class={topic == tag ? 'selected' : ''}>#{topic}</a></div>
    {/each}
  </div>
{/if}

{#if blocks}
  <div
    class:hidden={!$loaded}
    style={config.articleImageFit
      ? `--oracolo-article-image-fit: ${config.articleImageFit};` +
        (config.articleImageFit === 'contain'
          ? ' --oracolo-article-image-height: auto; --oracolo-article-image-height-large: auto;'
          : '')
      : ''}
  >
    {#each blocks as block}
      {#if block.type === 'articles'}
        <Articles source={articleSource} {...block.config} />
      {:else if block.type === 'notes'}
        <Notes source={noteSource} {...block.config} noMoreEvents={$loaded} />
      {:else if block.type === 'images'}
        <Images source={imageSource} {...block.config} />
      {/if}
    {/each}
  </div>
{/if}

{#if tag.length > 0 && $loaded && $totalDisplayedNotes < 12}
  <Articles source={articleSource} minChars={10} count={40} style="grid" />
  <Images source={imageSource} minChars={0} count={40} style="grid" />
  <Notes source={noteSource} minChars={0} count={40} style="grid" />
{/if}

<div class:hidden={$loaded}>
  <Loading />
</div>

<style>
  .hidden {
    display: none;
  }
</style>
