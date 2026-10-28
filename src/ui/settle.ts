import type { ChronicleOutcome } from './windowContent.ts';

/** How long the window waits for an action before it says so instead of sticking on "Working...". */
export const ACTION_WATCHDOG_MS = 30_000;

/**
 * Always settles: a rejection or a hang becomes a failure message the player can read, so no action
 * leaves the window on "Working..." forever.
 */
export function settleOutcome(
  task: Promise<ChronicleOutcome>,
  verb: string,
  watchdogMs: number = ACTION_WATCHDOG_MS,
  /** Called with the real outcome when the task finishes after the watchdog already answered. */
  onLate?: (out: ChronicleOutcome) => void,
): Promise<ChronicleOutcome> {
  let gaveUp = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<ChronicleOutcome>((resolve) => {
    timer = setTimeout(() => {
      gaveUp = true;
      resolve({ ok: false, message: `Couldn't ${verb}: this took too long. Close other tabs of the game and try again.` });
    }, watchdogMs);
  });
  const guarded = task.catch((): ChronicleOutcome => ({ ok: false, message: `Couldn't ${verb}: something went wrong.` }));
  void guarded.then((out) => {
    if (gaveUp) onLate?.(out);
  });
  return Promise.race([guarded, hung]).finally(() => clearTimeout(timer));
}
