import './app.scss';
import App from './App.svelte';
import { readSeed } from './seed';

console.log('running');

// A prerendered page ships its events inline and its markup already in the
// DOM, so the app hydrates that markup instead of building it from scratch.
// Without a seed this is the classic boot: an empty #app the app fills in.
const seed = readSeed();

const app = new App({
  target: document.getElementById('app')!,
  hydrate: Boolean(seed),
  props: { seed }
});

export default app;

(window as any).destroySvelteApp = () => app.$destroy();
