<script lang="ts">
  export let menuItems: { label: string; url: string }[] = [];
  export let menuLang: { label: string; url: string } | null = null;
</script>

{#if menuItems.length > 0 || menuLang}
  <div class="oracolo-menu">
    {#if menuLang}
      <a class="oracolo-menu__link oracolo-menu__lang" href={menuLang.url}>{menuLang.label}</a>
    {/if}
    {#each menuItems as item}
      <a class="oracolo-menu__link oracolo-menu__item" href={item.url} rel="noopener" target="_blank">{item.label}</a>
    {/each}
  </div>
{/if}

<style>
  :root {
    --menu-shell-bg: rgba(255, 255, 255, 0.84);
    --menu-shell-border: rgba(20, 20, 24, 0.12);
    --menu-shell-shadow: 0 14px 34px rgba(15, 23, 42, 0.16);
    --menu-muted-bg: rgba(245, 241, 233, 0.96);
    --menu-muted-border: rgba(140, 126, 99, 0.18);
    --menu-muted-text: #171717;
    --menu-item-bg: #171717;
    --menu-item-border: #171717;
    --menu-item-text: #f6f1e7;
  }

  :global(html.dark) {
    --menu-shell-bg: rgba(24, 24, 29, 0.82);
    --menu-shell-border: rgba(255, 255, 255, 0.08);
    --menu-shell-shadow: 0 16px 38px rgba(0, 0, 0, 0.34);
    --menu-muted-bg: rgba(245, 241, 233, 0.96);
    --menu-muted-border: rgba(255, 255, 255, 0.08);
    --menu-muted-text: #171717;
    --menu-item-bg: #111214;
    --menu-item-border: rgba(255, 255, 255, 0.08);
    --menu-item-text: #f7f3eb;
  }

  .oracolo-menu {
    position: fixed;
    top: 1rem;
    right: 4.25rem;
    z-index: 1200;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem;
    border: 1px solid var(--menu-shell-border);
    border-radius: 999px;
    background: var(--menu-shell-bg);
    box-shadow: var(--menu-shell-shadow);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  .oracolo-menu__link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.5rem;
    padding: 0.55rem 1rem;
    border-radius: 999px;
    border: 1px solid transparent;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 0.84rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-decoration: none;
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
  }

  .oracolo-menu__link:visited {
    text-decoration: none;
  }

  .oracolo-menu__link:hover {
    transform: translateY(-1px);
  }

  .oracolo-menu__lang,
  .oracolo-menu__lang:visited {
    min-width: 2.85rem;
    padding-inline: 0.85rem;
    background: var(--menu-muted-bg);
    border-color: var(--menu-muted-border);
    color: var(--menu-muted-text);
  }

  :global(html.dark) .oracolo-menu__lang,
  :global(html.dark) .oracolo-menu__lang:visited {
    background: var(--menu-muted-bg);
    border-color: var(--menu-muted-border);
    color: var(--menu-muted-text);
  }

  .oracolo-menu__lang:hover,
  :global(html.dark) .oracolo-menu__lang:hover {
    background: #fff;
    color: #111;
  }

  .oracolo-menu__item,
  .oracolo-menu__item:visited {
    background: var(--menu-item-bg);
    border-color: var(--menu-item-border);
    color: var(--menu-item-text);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  :global(html.dark) .oracolo-menu__item,
  :global(html.dark) .oracolo-menu__item:visited {
    background: var(--menu-item-bg);
    border-color: var(--menu-item-border);
    color: var(--menu-item-text);
  }

  .oracolo-menu__item:hover {
    background: #26272b;
    color: #fff;
  }

  @media (max-width: 720px) {
    .oracolo-menu {
      top: 0.75rem;
      right: 3.8rem;
      left: 0.75rem;
      justify-content: flex-end;
      flex-wrap: wrap;
      row-gap: 0.4rem;
    }
    .oracolo-menu__item {
      padding-inline: 0.95rem;
    }
  }

  @media (max-width: 480px) {
    .oracolo-menu {
      gap: 0.45rem;
      padding: 0.3rem;
      left: 0.6rem;
      right: 3.55rem;
    }
    .oracolo-menu__link {
      min-height: 2.3rem;
      font-size: 0.8rem;
    }
    .oracolo-menu__lang {
      min-width: 2.45rem;
      padding-inline: 0.7rem;
    }
    .oracolo-menu__item {
      padding-inline: 0.85rem;
    }
  }
</style>
