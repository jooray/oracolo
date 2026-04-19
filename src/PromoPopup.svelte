<script lang="ts">
  import { onMount } from 'svelte';

  export let promoImage: string = '';
  export let promoUrl: string = '';
  export let promoText: string = '';

  let visible = false;

  onMount(() => {
    const timer = setTimeout(() => {
      visible = true;
    }, 2000);
    return () => clearTimeout(timer);
  });

  function close() {
    visible = false;
  }
</script>

{#if visible}
  <div class="promo-float-box">
    <button class="promo-float-close" aria-label="Close" on:click={close}>&times;</button>
    {#if promoImage}
      <a href={promoUrl} target="_blank" rel="noopener">
        <!-- svelte-ignore a11y-missing-attribute -->
        <img src={promoImage} class="promo-float-image" />
      </a>
    {/if}
    <a class="promo-float-link" href={promoUrl} target="_blank" rel="noopener">
      {promoText || 'Learn more'}
    </a>
  </div>
{/if}

<style>
  .promo-float-box {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 1100;
    background: rgba(32, 32, 40, 0.98);
    box-shadow: 0 3px 24px rgba(0, 0, 0, 0.22);
    border-radius: 10px;
    padding: 14px;
    padding-top: 25px;
    text-align: center;
    max-width: 210px;
    width: 63vw;
  }

  .promo-float-close {
    position: absolute;
    top: 5px;
    right: 8px;
    cursor: pointer;
    font-size: 18px;
    font-weight: bold;
    color: #aaa;
    background: none;
    border: none;
    outline: none;
    line-height: 1;
    padding: 0;
    width: 22px;
    height: 22px;
    transition: color 0.2s;
  }

  .promo-float-close:hover {
    color: #ff3b3b;
  }

  .promo-float-image {
    display: block;
    width: 100%;
    height: auto;
    max-height: 175px;
    object-fit: contain;
    border-radius: 6px;
    margin-bottom: 10px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.13);
  }

  .promo-float-link {
    display: inline-block;
    margin: 7px 0;
    font-weight: 800;
    font-size: 0.85rem;
    color: #46f738;
    text-shadow: 0 2px 9px #111, 0 1px 0 #191919;
    text-decoration: none;
    letter-spacing: 0.5px;
    transition: color 0.17s;
    padding: 6px 12px;
    border: 2px solid #46f738;
    border-radius: 4px;
  }

  .promo-float-link:hover {
    color: #48a768;
    border-color: #48a768;
    text-decoration: none;
  }

  @media (max-width: 450px) {
    .promo-float-box {
      max-width: calc(70vw - 20px);
      bottom: 15px;
      right: 15px;
    }
    .promo-float-image {
      max-height: 140px;
    }
    .promo-float-link {
      font-size: 0.8rem;
    }
  }
</style>
