/**
 * The Atlas (UX redesign, spec C): one full-screen overlay with five tabs (World, Peoples, History, Discoveries,
 * Settings). A tab lists its sections as buttons. Opening one pushes a page onto `atlas.stack` and renders the window
 * body from windowContent into the page. Back pops the stack; Esc pops, then closes, then clears the info card; focus
 * returns to the control that opened the layer.
 */
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { render } from 'preact';
import { ATLAS_TABS, type AtlasTab, type ShellActions, type UiStore } from './store.ts';
import { routeOf, sectionsOf } from './atlasRoutes.ts';
import { SettingsPanel } from './SettingsPanel.tsx';
import { windowFor, type WindowDeps, type WindowParams } from '../windowContent.ts';
import { windowTitle } from '../windowCatalog.ts';
import { DiscoveryList } from './Discoveries.tsx';
import './Atlas.css';

const TAB_LABELS: Readonly<Record<AtlasTab, string>> = {
  world: 'World',
  peoples: 'Peoples',
  history: 'History',
  discoveries: 'Discoveries',
  settings: 'Settings',
};

/** The control that opened the Atlas. Focus returns there when the Atlas closes. */
let atlasOpener: Element | null = null;
/** The section kind of a page that just popped. Focus moves to its section button once the tab view renders. */
let poppedKind: string | null = null;
/** The live refresh of the page on screen (its `live` callback), fed from each snapshot. */
let liveFeed: (() => void) | null = null;

function focusIfConnected(el: Element | null): void {
  if (el instanceof HTMLElement && el.isConnected) el.focus();
}

/** Opens the Atlas on a tab. Switches tabs only when it is already open. */
export function openAtlas(store: UiStore, tab: AtlasTab = 'world'): void {
  const cur = store.atlas.value;
  if (cur.open) {
    store.atlas.value = { ...cur, tab };
    return;
  }
  atlasOpener = document.activeElement;
  store.atlas.value = { open: true, tab, stack: [] };
}

/** Two page params are the same when every field matches (a page is one object, so the same kind with other params is another page). */
function sameParams(a: WindowParams, b: WindowParams): boolean {
  const keys = new Set<keyof WindowParams>([...(Object.keys(a) as (keyof WindowParams)[]), ...(Object.keys(b) as (keyof WindowParams)[])]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/**
 * Shows a window kind in the Atlas: its tab opens and its page is pushed. Settings is a tab root, so it opens the tab
 * with no page. Developer windows open on the Settings tab. Opening the page just below the top, with the same kind and
 * params, pops back to it (the Back of an inspector). Opening the page already on top refreshes it with the new params (Chronicle after a save).
 */
export function showAtlas(store: UiStore, kind: string, params: WindowParams = {}): void {
  const route = routeOf(kind);
  if (route === null || 'modal' in route) return;
  const tab: AtlasTab = 'tab' in route ? route.tab : 'settings';
  const cur = store.atlas.value;
  if (!cur.open) atlasOpener = document.activeElement;
  if (kind === 'win_settings') {
    store.atlas.value = { open: true, tab: 'settings', stack: [] };
    return;
  }
  const top = cur.stack[cur.stack.length - 1];
  const below = cur.stack[cur.stack.length - 2];
  if (cur.open && below?.kind === kind && sameParams(below.params, params)) {
    store.atlas.value = { ...cur, tab, stack: cur.stack.slice(0, -1) };
    return;
  }
  if (cur.open && top?.kind === kind) {
    store.atlas.value = { ...cur, tab, stack: [...cur.stack.slice(0, -1), { kind, params }] };
    return;
  }
  store.atlas.value = { open: true, tab, stack: [...(cur.open ? cur.stack : []), { kind, params }] };
}

/** Pops the top page. With no page open, Back closes the Atlas. */
export function atlasBack(store: UiStore): void {
  const cur = store.atlas.value;
  if (!cur.open) return;
  const top = cur.stack[cur.stack.length - 1];
  if (top === undefined) {
    closeAtlas(store);
    return;
  }
  store.atlas.value = { ...cur, stack: cur.stack.slice(0, -1) };
  poppedKind = top.kind;
}

/** Closes the Atlas and returns focus to the control that opened it. */
export function closeAtlas(store: UiStore): void {
  const cur = store.atlas.value;
  if (!cur.open) return;
  store.atlas.value = { ...cur, open: false, stack: [] };
  focusIfConnected(atlasOpener);
  atlasOpener = null;
  poppedKind = null;
}

/** Esc layer one: pops a page, or closes the Atlas when no page is open. Returns true when it took the key. */
export function atlasEscape(store: UiStore): boolean {
  const cur = store.atlas.value;
  if (!cur.open) return false;
  if (cur.stack.length > 0) atlasBack(store);
  else closeAtlas(store);
  return true;
}

/** The window kind on screen: the top page, the Settings tab, or null. Used by the window hooks. */
export function currentAtlasKind(store: UiStore): string | null {
  const cur = store.atlas.value;
  if (!cur.open) return null;
  const top = cur.stack[cur.stack.length - 1];
  if (top !== undefined) return top.kind;
  return cur.tab === 'settings' ? 'win_settings' : null;
}

/** Feeds the page on screen its latest snapshot (live windows only). */
export function feedAtlas(): void {
  liveFeed?.();
}

/**
 * Document-level Esc, registered once. It runs before the game's own Escape (which disarms a power), and stops the
 * event when it takes it. A native dialog (a confirmation) answers Esc itself, so the Atlas stays out of its way.
 * Layer three clears the info card (UX redesign, spec D); the card itself renders in Task 4.
 */
export function installAtlasKeys(store: UiStore): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]') !== null) return;
    if (atlasEscape(store)) {
      e.stopPropagation();
      return;
    }
    if (store.info.value !== null) {
      store.info.value = null;
      e.stopPropagation();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

/** Keeps Tab inside the Atlas card while it is open (a focus trap). */
function trapTab(e: KeyboardEvent, card: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = [...card.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter(
    (el) => el.tabIndex >= 0 && el.closest('[hidden]') === null && !el.hasAttribute('disabled'),
  );
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !card.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !card.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

interface AtlasProps {
  store: UiStore;
  actions: ShellActions;
  deps: WindowDeps;
}

function AtlasCard({ store, actions, deps }: AtlasProps) {
  const state = store.atlas.value;
  const page = state.stack[state.stack.length - 1] ?? null;
  const build = useMemo(() => (page ? windowFor(page.kind, deps, page.params) : null), [page, deps]);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastPage = useRef<unknown>(undefined);

  // The page's window body fills the page container. Leaving the page drops its live refresh.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!page || !body) return;
    body.replaceChildren();
    build?.build(body);
    liveFeed = build?.live ?? null;
    return () => {
      liveFeed = null;
      // A page may mount a preact tree (Settings, Privacy rows): unmount it before the container is emptied.
      render(null, body);
      body.replaceChildren();
    };
  }, [page, build]);

  // Focus: after a pop, the section button that opened the page; after a push, the page heading; on open, the heading.
  useLayoutEffect(() => {
    if (poppedKind !== null) {
      const kind = poppedKind;
      poppedKind = null;
      const section = page === null ? cardRef.current?.querySelector<HTMLElement>(`[data-section="${kind}"]`) : null;
      if (section) section.focus();
      else headingRef.current?.focus();
    } else if (lastPage.current !== page) {
      headingRef.current?.focus();
    }
    lastPage.current = page;
  });

  const heading = page ? (build?.title ?? windowTitle(page.kind)) : state.tab === 'settings' ? 'Settings' : 'Atlas';

  const moveTab = (e: KeyboardEvent): void => {
    const count = ATLAS_TABS.length;
    const index = ATLAS_TABS.indexOf(state.tab);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (index + 1) % count;
    else if (e.key === 'ArrowLeft') next = (index - 1 + count) % count;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    if (next === null) return;
    e.preventDefault();
    const tab = ATLAS_TABS[next] ?? 'world';
    store.atlas.value = { ...store.atlas.value, tab };
    document.getElementById(`atlas-tab-${tab}`)?.focus();
  };

  return (
    <div class="atlas-scrim" role="presentation">
      <div
        class="atlas"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-title"
        ref={cardRef}
        onKeyDown={(e) => {
          if (cardRef.current) trapTab(e, cardRef.current);
        }}
      >
        <header class="atlas-head">
          {page && (
            <button type="button" class="btn" onClick={() => atlasBack(store)}>
              Back
            </button>
          )}
          <h2 id="atlas-title" class="atlas-title" ref={headingRef} tabIndex={-1}>
            {heading}
          </h2>
          <button type="button" class="btn icon" aria-label="Close window" onClick={() => closeAtlas(store)}>
            &#10005;
          </button>
        </header>
        {page ? (
          <div class="window-body atlas-body" ref={bodyRef} />
        ) : (
          <>
            <div role="tablist" aria-label="Atlas sections" class="atlas-tabs" onKeyDown={moveTab}>
              {ATLAS_TABS.map((tab) => {
                const selected = tab === state.tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={`atlas-tab-${tab}`}
                    class="atlas-tab"
                    aria-selected={selected ? 'true' : 'false'}
                    aria-controls="atlas-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => {
                      store.atlas.value = { ...store.atlas.value, tab };
                    }}
                  >
                    {TAB_LABELS[tab]}
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" id="atlas-panel" class="atlas-panel" aria-labelledby={`atlas-tab-${state.tab}`}>
              {state.tab === 'settings' ? (
                <SettingsPanel deps={deps} onDone={() => closeAtlas(store)} />
              ) : (
                <>
                  {state.tab === 'discoveries' ? <DiscoveryList store={store} /> : null}
                  <div class="atlas-sections">
                  {sectionsOf(state.tab).map((w) => (
                    <button key={w.id} type="button" class="atlas-section" data-section={w.id} onClick={() => actions.openWindow(w.id)}>
                      {w.title}
                    </button>
                  ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The Atlas overlay. Renders nothing while it is closed. */
export function Atlas(props: AtlasProps) {
  return props.store.atlas.value.open ? <AtlasCard {...props} /> : null;
}

/** Mounts the Atlas and installs its Esc handling. Returns the function that removes the Esc handler. */
export function mountAtlas(root: HTMLElement, store: UiStore, actions: ShellActions, deps: WindowDeps): () => void {
  render(<Atlas store={store} actions={actions} deps={deps} />, root);
  return installAtlasKeys(store);
}
