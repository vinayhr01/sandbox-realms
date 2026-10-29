/** Toast cards and their expiry (replaces the old #toasts host). */
import { useEffect } from 'preact/hooks';
import { pruneToasts, type ShellActions, type Toast, type UiStore } from './store.ts';
import { Coach } from './Coach.tsx';

/** How often expired toasts are dropped (ms). */
const PRUNE_EVERY_MS = 250;

/** The top-centre column (R1): the first-launch coach sits above the toasts, under the pills. */
export function Toasts({ store, actions }: { store: UiStore; actions: ShellActions }) {
  useEffect(() => {
    const id = window.setInterval(() => pruneToasts(store, Date.now()), PRUNE_EVERY_MS);
    return () => window.clearInterval(id);
  }, [store]);
  return (
    <div id="toasts" class="toasts">
      <Coach store={store} actions={actions} />
      <div class="toast-list" role="status" aria-live="polite">
        {store.toasts.value.map((toast) => (
          <div key={toast.id} class={toast.kind === 'new' ? 'toast toast-new' : 'toast'}>
            {toast.text}
            {toast.action && (
              <>
                {' '}
                <button type="button" class="btn" onClick={() => runAction(store, toast)}>
                  {toast.action.label}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Removes the toast, then runs its button's action. */
function runAction(store: UiStore, toast: Toast): void {
  store.toasts.value = store.toasts.value.filter((t) => t.id !== toast.id);
  toast.action?.run();
}
