/** Mounts the UI shell over the map (spec A). The map canvas stays where it is; the shell draws over it. */
import { render } from 'preact';
import './tokens.css';
import { TopPills } from './TopPills.tsx';
import { PowerSheet } from './PowerSheet.tsx';
import { Toasts } from './Toasts.tsx';
import { InfoCard } from './InfoCard.tsx';
import type { ShellActions, UiStore } from './store.ts';

function Shell({ store, actions }: { store: UiStore; actions: ShellActions }) {
  return (
    <>
      <TopPills store={store} actions={actions} />
      <PowerSheet store={store} actions={actions} />
      <InfoCard store={store} actions={actions} />
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
  // The minimap and possession pad sit above the power sheet: they read its height from --sheet-h (styles.css).
  const sheet = root.querySelector<HTMLElement>('.power-sheet');
  if (sheet && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`)).observe(sheet);
  }
}
