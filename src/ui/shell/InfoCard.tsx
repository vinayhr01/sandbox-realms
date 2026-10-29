/**
 * The floating info card (UX redesign, spec D). A tap on a being opens it; it follows the being each frame and says
 * "Gone" once the being leaves the feed. Its actions call the shell actions in main.ts: Follow, Possess and More (the
 * being's Atlas inspector). Esc, its Close button, a tap on empty map or another card close it (the Esc order is in
 * Atlas.tsx, and taps are in main.ts).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ShellActions, UiStore } from './store.ts';
import './InfoCard.css';

/** Pulls the card along with its being: the screen point is written to CSS variables, so no re-render runs per frame. */
export function InfoCard({ store, actions }: { store: UiStore; actions: ShellActions }) {
  const target = store.info.value;
  const kind = target?.kind ?? null;
  const id = target?.id ?? null;
  const cardRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ name: string; gone: boolean }>({ name: 'Being', gone: false });

  useEffect(() => {
    if (kind !== 'being' || id === null) return;
    const beingId = Number(id);
    let frame = 0;
    let lastGone: boolean | null = null;
    let lastName = '';
    const step = (): void => {
      const at = actions.locateBeing(beingId);
      const el = cardRef.current;
      if (at && el) {
        el.style.setProperty('--card-x', `${Math.round(at.x)}px`);
        el.style.setProperty('--card-y', `${Math.round(at.y)}px`);
      }
      const gone = at === null;
      const name = at?.name ?? lastName;
      if (gone !== lastGone || name !== lastName) {
        lastGone = gone;
        lastName = name;
        setView({ name, gone });
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [kind, id, actions]);

  if (kind !== 'being' || id === null) return null;
  const beingId = Number(id);
  const close = (): void => {
    store.info.value = null;
  };
  return (
    <div ref={cardRef} class={view.gone ? 'info-card info-card-gone' : 'info-card'} role="dialog" aria-label={view.name} aria-modal="false">
      <div class="info-card-head">
        <span class="info-card-name">{view.gone ? `${view.name} (gone)` : view.name}</span>
        <button type="button" class="btn info-card-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      {view.gone ? (
        <p class="info-card-note">Gone: this being has left the realm.</p>
      ) : (
        <div class="info-card-actions">
          <button type="button" class="btn" onClick={() => actions.followBeing(beingId)}>
            Follow
          </button>
          <button type="button" class="btn" onClick={() => actions.possessBeing(beingId)}>
            Possess
          </button>
          <button type="button" class="btn" onClick={() => actions.openWindow('win_being', { id: beingId })}>
            More
          </button>
        </div>
      )}
    </div>
  );
}
