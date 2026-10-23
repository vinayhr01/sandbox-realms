/**
 * Power bar model (13 section 4): tabs, armed power, cooldown fraction, favourites (at most 12) and
 * brush size stepping on a logarithmic 1..72 scale. Pure data, no DOM.
 */
export const MAX_FAVOURITES = 12;
export const BRUSH_MIN = 1;
export const BRUSH_MAX = 72;
/** Slider steps across the whole logarithmic range. */
const STEPS_PER_RANGE = 12;

export function favourite(list: readonly string[], id: string): string[] {
  if (list.includes(id) || list.length >= MAX_FAVOURITES) return [...list];
  return [...list, id];
}

export function unfavourite(list: readonly string[], id: string): string[] {
  return list.filter((x) => x !== id);
}

/** Fraction of the cooldown still to wait: 1 just used, 0 ready. */
export function cooldownFraction(now: number, readyAt: number, cooldownTicks: number): number {
  if (cooldownTicks <= 0 || now >= readyAt) return 0;
  return Math.min(1, (readyAt - now) / cooldownTicks);
}

/** Steps the brush size by n slider steps on the logarithmic scale; the result stays in 1..72. */
export function stepBrush(size: number, n: number): number {
  const s = Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, Math.round(size)));
  const position = Math.log(s) / Math.log(BRUSH_MAX);
  const next = Math.min(1, Math.max(0, position + n / STEPS_PER_RANGE));
  return Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, Math.round(Math.pow(BRUSH_MAX, next))));
}

export interface TabState {
  active: string;
  tabs: readonly string[];
}

/** Selects a tab; unknown tabs leave the state unchanged. */
export function selectTab(state: TabState, tab: string): TabState {
  return state.tabs.includes(tab) ? { ...state, active: tab } : state;
}
