/**
 * The floating info card (UX redesign, spec D). A tap on a being, a hamlet or a building opens it; it follows its target
 * each frame and says "Gone" once the target leaves the latest feed or snapshot, which also stops its frame loop. It
 * shows the plain name and one key-facts line: a being's stage and state, a hamlet's tier and folk, a building's kind
 * and owner hamlet. Its actions call the shell actions in main.ts: Follow and Possess (beings only) and More, which
 * opens the target's Atlas page. More is off when the latest snapshot does not carry that page's row. The card stays
 * inside the viewport and is hidden while its target is off-screen. Esc, its Close button, a tap on empty map or
 * another card close it (the Esc order is in Atlas.tsx, and taps are in main.ts).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { InfoTarget, ShellActions, UiStore } from './store.ts';
import './InfoCard.css';

/** The feed's state words, indexed by BeingState (src/shared/being-feed.ts). */
const STATE_WORDS = ['Idle', 'Walking', 'Running', 'Swimming', 'Asleep', 'Hurt'] as const;

/** The Atlas page More opens for each kind of target. Its param is the target id (a being id, hamlet index or structure id). */
const MORE_PAGE: Partial<Record<InfoTarget['kind'], string>> = {
  being: 'win_being',
  hamlet: 'win_hamlet',
  building: 'win_structure',
};

/** The gap between the card and its target, and the margin kept to the viewport edge (tokens.css --space-3 and --space-2). */
const CARD_GAP_PX = 12;
const CARD_MARGIN_PX = 8;

/** Key facts of a being as the map feed knows them: its stage and what it is doing. */
export function feedFacts(at: { child: boolean; state: number }): string {
  return `${at.child ? 'Child' : 'Adult'}, ${STATE_WORDS[at.state] ?? 'Idle'}`;
}

/** Key facts of a hamlet from its snapshot row: its size tier and its folk. */
export function hamletFacts(at: { tier?: 'hamlet' | 'town'; folk: number }): string {
  return `${at.tier === 'town' ? 'Town' : 'Hamlet'}, ${at.folk} folk`;
}

/** Keeps v within [lo, hi]. When the range is empty (a card wider than the viewport), lo wins. */
function clampPx(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(hi, Math.max(lo, v));
}

/**
 * The point the card's anchor is applied to, moved so the whole card stays inside the viewport. The CSS puts the card's
 * bottom centre CARD_GAP_PX above that point (translate(-50%, -100% - gap)), so it is pulled in by half the card's width
 * on each side, and by its height plus the gap at the top.
 */
export function clampCardAnchor(at: { x: number; y: number }, card: { w: number; h: number }, view: { w: number; h: number }): { x: number; y: number } {
  return {
    x: clampPx(at.x, CARD_MARGIN_PX + card.w / 2, view.w - CARD_MARGIN_PX - card.w / 2),
    y: clampPx(at.y, CARD_MARGIN_PX + card.h + CARD_GAP_PX, view.h - CARD_MARGIN_PX),
  };
}

/** True when the target's screen point is inside the viewport. */
export function onScreen(at: { x: number; y: number }, view: { w: number; h: number }): boolean {
  return at.x >= 0 && at.y >= 0 && at.x <= view.w && at.y <= view.h;
}

interface CardView {
  name: string;
  gone: boolean;
  facts: string;
  detailed: boolean;
  hidden: boolean;
}

/** Pulls the card along with its target: the screen point is written to CSS variables, so no re-render runs per frame. */
export function InfoCard({ store, actions }: { store: UiStore; actions: ShellActions }) {
  const target = store.info.value;
  const cardRef = useRef<HTMLDivElement>(null);
  /** The card's size as last rendered. The clamp reads it, so the frame loop does not force a layout. */
  const sizeRef = useRef({ w: 0, h: 0 });
  const [view, setView] = useState<CardView>({ name: 'Being', gone: false, facts: '', detailed: false, hidden: false });

  // A new name or facts line can change the size, so it is measured after every render.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el) sizeRef.current = { w: el.offsetWidth, h: el.offsetHeight };
  });

  // Keyed on the target object, so a repeat tap on the same target starts the loop again after it went Gone.
  useEffect(() => {
    if (target === null || MORE_PAGE[target.kind] === undefined) return;
    let frame = 0;
    let lastKey = '';
    let last: CardView = { name: '', gone: false, facts: '', detailed: false, hidden: false };
    const step = (): void => {
      const at = actions.locateInfo(target);
      const el = cardRef.current;
      const size = { w: window.innerWidth, h: window.innerHeight };
      let next: CardView;
      if (at) {
        if (el) {
          const p = clampCardAnchor(at, sizeRef.current, size);
          el.style.setProperty('--card-x', `${Math.round(p.x)}px`);
          el.style.setProperty('--card-y', `${Math.round(p.y)}px`);
        }
        next = { name: at.name, gone: false, facts: at.facts, detailed: at.detailed, hidden: !onScreen(at, size) };
      } else {
        next = { ...last, gone: true };
      }
      const key = `${next.name}|${next.gone}|${next.facts}|${next.detailed}|${next.hidden}`;
      if (key !== lastKey) {
        lastKey = key;
        last = next;
        setView(next);
      }
      // Gone: the target has left the feed, so the loop stops. The card keeps saying so until it is closed or retapped.
      if (!next.gone) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target, actions]);

  if (target === null || MORE_PAGE[target.kind] === undefined) return null;
  const page = MORE_PAGE[target.kind] as string;
  const beingId = target.kind === 'being' ? Number(target.id) : null;
  const close = (): void => {
    store.info.value = null;
  };
  const classes = ['info-card'];
  if (view.gone) classes.push('info-card-gone');
  if (view.hidden) classes.push('info-card-off');
  return (
    <div ref={cardRef} class={classes.join(' ')} role="dialog" aria-label={view.name} aria-modal="false">
      <div class="info-card-head">
        <span class="info-card-name">{view.gone ? `${view.name} (gone)` : view.name}</span>
        <button type="button" class="btn info-card-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      {view.gone ? (
        <p class="info-card-note">Gone: this {target.kind} has left the realm.</p>
      ) : (
        <>
          <p class="info-card-facts">{view.facts}</p>
          <div class="info-card-actions">
            {beingId !== null && (
              <>
                <button type="button" class="btn" onClick={() => actions.followBeing(beingId)}>
                  Follow
                </button>
                <button type="button" class="btn" onClick={() => actions.possessBeing(beingId)}>
                  Possess
                </button>
              </>
            )}
            <button
              type="button"
              class="btn"
              disabled={!view.detailed}
              title={view.detailed ? undefined : 'Not in the latest realm overview, so it has no full page'}
              onClick={() => actions.openWindow(page, { id: Number(target.id) })}
            >
              More
            </button>
          </div>
        </>
      )}
    </div>
  );
}
