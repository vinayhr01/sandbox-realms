/**
 * Power bar model (13 section 4): favourites (at most 9, the recent row's size) and the cooldown fraction. Pure data, no DOM.
 */
export const MAX_FAVOURITES = 9;

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
