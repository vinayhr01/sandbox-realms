/** Toast cards and their expiry (replaces the old #toasts host). */
import { useEffect } from 'preact/hooks';
import { pruneToasts, type UiStore } from './store.ts';

/** How often expired toasts are dropped (ms). */
const PRUNE_EVERY_MS = 250;

export function Toasts({ store }: { store: UiStore }) {
  useEffect(() => {
    const id = window.setInterval(() => pruneToasts(store, Date.now()), PRUNE_EVERY_MS);
    return () => window.clearInterval(id);
  }, [store]);
  return (
    <div id="toasts" class="toasts" role="status" aria-live="polite">
      {store.toasts.value.map((toast) => (
        <div key={toast.id} class={toast.kind === 'new' ? 'toast toast-new' : 'toast'}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
