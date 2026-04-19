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
  import { loadCache } from './cache';

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

    // Race cache and relay prefetch in parallel so first paint happens as
    // soon as either source returns. Cache normally wins (local fetch),
    // but if it's slow or missing the relay results are already on the wire.
    const cachePromise = config.cacheUrl
      ? loadCache(config.cacheUrl).then((cache) => {
          if (!cache) return;
          const since = cache.generated_at;
          const kind1: NostrEvent[] = [];
          const kind20: NostrEvent[] = [];
          const kind30023: NostrEvent[] = [];
          for (const event of cache.events) {
            if (event.kind === 1) kind1.push(event);
            else if (event.kind === 20) kind20.push(event);
            else if (event.kind === 30023) kind30023.push(event);
          }
          noteSource.preload(kind1, since);
          imageSource.preload(kind20, since);
          articleSource.preload(kind30023, since);
        }).catch((err) => console.warn('cache load failed', err))
      : Promise.resolve();

    const relayPromise = Promise.all([
      noteSource.prefetch(),
      imageSource.prefetch(),
      articleSource.prefetch()
    ]).catch((err) => console.warn('relay prefetch failed', err));

    const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
    await Promise.race([cachePromise, relayPromise, timeout]);

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
    style={config.articleImageFit ? `--oracolo-article-image-fit: ${config.articleImageFit}` : ''}
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
