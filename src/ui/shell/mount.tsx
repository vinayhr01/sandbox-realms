/** Mounts the UI shell over the map (spec A). The map canvas stays where it is; the shell draws over it. */
import { render } from 'preact';
import { effect } from '@preact/signals';
import './tokens.css';
import { TopPills } from './TopPills.tsx';
import { PowerSheet } from './PowerSheet.tsx';
import { Toasts } from './Toasts.tsx';
import { InfoCard } from './InfoCard.tsx';
import type { ShellActions, UiStore } from './store.ts';

/** The one control that stays on screen while the interface is hidden, so a touch user can bring it back. */
export function RestoreInterface({ store }: { store: UiStore }) {
  if (!store.hidden.value) return null;
  return (
    <button type="button" class="btn restore-ui" onClick={() => (store.hidden.value = false)}>
      Show interface
    </button>
  );
}

function Shell({ store, actions }: { store: UiStore; actions: ShellActions }) {
  return (
    <>
      <TopPills store={store} actions={actions} />
      <PowerSheet store={store} actions={actions} />
      <InfoCard store={store} actions={actions} />
      <RestoreInterface store={store} />
      <div id="status" class="status" role="status" aria-live="polite">
        {store.status}
      </div>
    </>
  );
}

/** Toasts mount in their own root, outside the map, so they stack above the audio cues. */
export function mountToasts(root: HTMLElement, store: UiStore, actions: ShellActions): void {
  render(<Toasts store={store} actions={actions} />, root);
}

export function mountShell(root: HTMLElement, store: UiStore, actions: ShellActions): void {
  render(<Shell store={store} actions={actions} />, root);
  // The hidden flag is the one source for the `hide-ui` class that styles.css and PowerSheet.css read.
  effect(() => {
    document.documentElement.classList.toggle('hide-ui', store.hidden.value);
  });
  // The minimap and possession pad sit above the power sheet: they read its height from --sheet-h (styles.css).
  const sheet = root.querySelector<HTMLElement>('.power-sheet');
  if (sheet && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`)).observe(sheet);
  }
}
