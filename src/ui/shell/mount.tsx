/** Mounts the UI shell over the map (spec A). The map canvas stays where it is; the shell draws over it. */
import { render } from 'preact';
import './tokens.css';
import { TopPills } from './TopPills.tsx';
import { Toasts } from './Toasts.tsx';
import type { ShellActions, UiStore } from './store.ts';

function Shell({ store, actions }: { store: UiStore; actions: ShellActions }) {
  return (
    <>
      <TopPills store={store} actions={actions} />
      <Toasts store={store} />
      <div id="status" class="status" role="status" aria-live="polite">
        {store.status}
      </div>
    </>
  );
}

export function mountShell(root: HTMLElement, store: UiStore, actions: ShellActions): void {
  render(<Shell store={store} actions={actions} />, root);
}
