/**
 * App state for the UI shell (UX redesign, spec A). Plain Signals fed by main.ts: the shell components read them and
 * never touch game logic. Toast expiry takes the clock as an argument so it can be tested without timers.
 */
import { signal, type Signal } from '@preact/signals';
import type { BrushShape, Speed } from '../../shared/protocol.ts';
import type { WindowParams } from '../windowContent.ts';

/** How long a toast stays on screen (ms). */
export const TOAST_MS = 3000;

export const ATLAS_TABS = ['world', 'peoples', 'history', 'discoveries', 'settings'] as const;
export type AtlasTab = (typeof ATLAS_TABS)[number];

export interface RealmSummary {
  name: string;
  year: number;
  month: number;
  creatures: number;
  towns: number;
}

export interface ArmedState {
  powerId: string;
  /** The brush as the sheet shows it: the slider index (0..10), the radius it stands for, and the shape. */
  brush: { index: number; radius: number; shape: BrushShape };
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'new';
  /** When the toast was pushed (ms, same clock as pruneToasts). */
  at: number;
  /** An optional button; a toast with one stays up for ACTION_TOAST_MS. */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

/** How long a toast with a button stays up (ms). */
export const ACTION_TOAST_MS = 30_000;

/** What the floating info card points at: a being, a tile, a hamlet, a building or a dominion. */
export interface InfoTarget {
  kind: 'being' | 'tile' | 'hamlet' | 'building' | 'dominion';
  id: string;
}

/** The info card's view of its target this frame (ShellActions.locateInfo). */
export interface LocatedInfo {
  /** Screen point (client px) the card sits above. */
  x: number;
  y: number;
  name: string;
  facts: string;
  /** True when the target's full Atlas page can open from the latest snapshot (More is on). */
  detailed: boolean;
}

/** One page open in the Atlas: the window kind and its parameters. */
export interface AtlasPage {
  kind: string;
  params: WindowParams;
}

export interface UiStore {
  realm: Signal<RealmSummary>;
  speed: Signal<Speed>;
  paused: Signal<boolean>;
  armed: Signal<ArmedState | null>;
  status: Signal<string>;
  toasts: Signal<Toast[]>;
  recent: Signal<string[]>;
  favourites: Signal<string[]>;
  discovered: Signal<string[]>;
  /** Ids of the discovery entries met so far (the Discoveries tab lists them). */
  found: Signal<string[]>;
  /** The first-launch coach step id to show, or null when the coach is hidden. */
  coach: Signal<string | null>;
  sheet: Signal<'collapsed' | 'expanded'>;
  atlas: Signal<{ open: boolean; tab: AtlasTab; stack: AtlasPage[] }>;
  info: Signal<InfoTarget | null>;
  cooldowns: Signal<Record<string, number>>;
  /** Ids of powers that show a pressed state (an Insight toggle that is on). The armed power is in `armed`. */
  pressed: Signal<string[]>;
  /** Power id to the reason it cannot be used now (a rule or a requirement). The sheet dims these. */
  unavailable: Signal<Record<string, string>>;
}

/** The calls the shell makes back into main.ts. The game logic stays there. */
export interface ShellActions {
  setSpeed(speed: Speed): void;
  togglePause(): void;
  activatePower(id: string): void;
  openWindow(kind: string, params?: WindowParams): void;
  disarm(): void;
  setBrushSize(index: number): void;
  setBrushShape(shape: BrushShape): void;
  /**
   * Where the info card sits for its target this frame, or null once the target is gone: the screen point (client px),
   * the plain name, the key facts line, and `detailed` (true when its full Atlas page can open from the latest snapshot).
   */
  locateInfo(target: InfoTarget): LocatedInfo | null;
  followBeing(id: number): void;
  possessBeing(id: number): void;
  /** Zooms the map by a factor about the centre of the view. */
  zoomBy(factor: number): void;
  /** Ends the first-launch coach for good (its "Skip tutorial" button). */
  skipCoach(): void;
}

export function createStore(): UiStore {
  return {
    realm: signal<RealmSummary>({ name: 'Realm', year: 1, month: 1, creatures: 0, towns: 0 }),
    speed: signal<Speed>(1),
    paused: signal(false),
    armed: signal<ArmedState | null>(null),
    status: signal('Tap the map to inspect a tile.'),
    toasts: signal<Toast[]>([]),
    recent: signal<string[]>([]),
    favourites: signal<string[]>([]),
    discovered: signal<string[]>(['land', 'nature', 'creatures']),
    found: signal<string[]>([]),
    coach: signal<string | null>(null),
    sheet: signal<'collapsed' | 'expanded'>('collapsed'),
    atlas: signal({ open: false, tab: 'world' as AtlasTab, stack: [] as AtlasPage[] }),
    info: signal<InfoTarget | null>(null),
    cooldowns: signal<Record<string, number>>({}),
    pressed: signal<string[]>([]),
    unavailable: signal<Record<string, string>>({}),
  };
}

let nextToastId = 1;

/** Adds a toast. `now` is the clock in ms (defaults to Date.now()). */
export function pushToast(
  store: UiStore,
  text: string,
  kind: 'info' | 'new' = 'info',
  now: number = Date.now(),
  action?: ToastAction,
): void {
  const toast: Toast = { id: nextToastId++, text, kind, at: now, ...(action ? { action } : {}) };
  store.toasts.value = [...store.toasts.value, toast];
}

/** Drops toasts that are at least TOAST_MS old at `now`. Returns true when something was removed. */
export function pruneToasts(store: UiStore, now: number): boolean {
  const live = store.toasts.value.filter((t) => now - t.at < (t.action ? ACTION_TOAST_MS : TOAST_MS));
  if (live.length === store.toasts.value.length) return false;
  store.toasts.value = live;
  return true;
}
