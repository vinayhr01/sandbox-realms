/**
 * The floating info card (UX redesign, spec D). A tap on a being opens it; it follows the being each frame and says
 * "Gone" once the being leaves the feed. It shows the plain name and the feed's key facts (stage and state). Its actions
 * call the shell actions in main.ts: Follow, Possess and More (the being's Atlas inspector). More is off for a being
 * the latest snapshot does not sample (its full page has no row to read). Esc, its Close button, a tap on empty map or
 * another card close it (the Esc order is in Atlas.tsx, and taps are in main.ts).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ShellActions, UiStore } from './store.ts';
import './InfoCard.css';

/** The feed's state words, indexed by BeingState (src/shared/being-feed.ts). */
const STATE_WORDS = ['Idle', 'Walking', 'Running', 'Swimming', 'Asleep', 'Hurt'] as const;

/** Key facts of a being as the map feed knows them: its stage and what it is doing. */
export function feedFacts(at: { child: boolean; state: number }): string {
  return `${at.child ? 'Child' : 'Adult'}, ${STATE_WORDS[at.state] ?? 'Idle'}`;
}

interface CardView {
  name: string;
  gone: boolean;
  facts: string;
  detailed: boolean;
}

/** Pulls the card along with its being: the screen point is written to CSS variables, so no re-render runs per frame. */
export function InfoCard({ store, actions }: { store: UiStore; actions: ShellActions }) {
  const target = store.info.value;
  const kind = target?.kind ?? null;
  const id = target?.id ?? null;
  const cardRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CardView>({ name: 'Being', gone: false, facts: '', detailed: false });

  useEffect(() => {
    if (kind !== 'being' || id === null) return;
    const beingId = Number(id);
    let frame = 0;
    let lastKey = '';
    let last: CardView = { name: '', gone: false, facts: '', detailed: false };
    const step = (): void => {
      const at = actions.locateBeing(beingId);
      const el = cardRef.current;
      if (at && el) {
        el.style.setProperty('--card-x', `${Math.round(at.x)}px`);
        el.style.setProperty('--card-y', `${Math.round(at.y)}px`);
      }
      const next: CardView = at
        ? { name: at.name, gone: false, facts: at.facts, detailed: at.detailed }
        : { ...last, gone: true };
      const key = `${next.name}|${next.gone}|${next.facts}|${next.detailed}`;
      if (key !== lastKey) {
        lastKey = key;
        last = next;
        setView(next);
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
        <>
          <p class="info-card-facts">{view.facts}</p>
          <div class="info-card-actions">
            <button type="button" class="btn" onClick={() => actions.followBeing(beingId)}>
              Follow
            </button>
            <button type="button" class="btn" onClick={() => actions.possessBeing(beingId)}>
              Possess
            </button>
            <button
              type="button"
              class="btn"
              disabled={!view.detailed}
              title={view.detailed ? undefined : 'Not in the latest realm overview, so it has no full page'}
              onClick={() => actions.openWindow('win_being', { id: beingId })}
            >
              More
            </button>
          </div>
        </>
      )}
    </div>
  );
}
