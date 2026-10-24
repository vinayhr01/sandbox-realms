/**
 * Crash capture skeleton (19 sections 3-8): unclean-exit sentinel, a small local journal,
 * and a fatal dialog. Storage access is wrapped because it can throw in private windows.
 * Nothing leaves the device (no telemetry in v1).
 */
const SENTINEL_KEY = 'sr.session';
const JOURNAL_KEY = 'sr.journal';
const JOURNAL_MAX = 20;

interface JournalEntry {
  at: string;
  code: string;
  detail: string;
}

function readJournal(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch {
    return [];
  }
}

export function journal(code: string, detail: string): void {
  const entries = readJournal();
  entries.push({ at: new Date().toISOString(), code, detail: detail.slice(0, 300) });
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries.slice(-JOURNAL_MAX)));
  } catch {
    // Storage unavailable or full: the journal is best-effort.
  }
}

/** Returns true when the previous session did not reach pagehide cleanly. */
export function startSentinel(): boolean {
  let unclean = false;
  try {
    unclean = localStorage.getItem(SENTINEL_KEY) === 'running';
    localStorage.setItem(SENTINEL_KEY, 'running');
  } catch {
    // Without storage we cannot tell; treat as a clean start.
  }
  window.addEventListener('pagehide', () => {
    try {
      localStorage.setItem(SENTINEL_KEY, 'clean');
    } catch {
      // Ignored: nothing else to do while the page is going away.
    }
  });
  if (unclean) journal('UNCLEAN_EXIT', 'previous session did not exit cleanly');
  return unclean;
}

/** Shows the fatal dialog with a reload action. Safe to call more than once. */
export function showFatal(title: string, detail: string): void {
  const dialog = document.getElementById('fatal');
  const titleEl = document.getElementById('fatal-title');
  const detailEl = document.getElementById('fatal-detail');
  if (!dialog || !titleEl || !detailEl) return;
  titleEl.textContent = title;
  detailEl.textContent = detail;
  dialog.hidden = false;
  document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload(), { once: true });
}

/**
 * Recovery ladder decisions (19 sections 2, 4, 7). Pure: the caller supplies the fault, the recent
 * history and whether a valid autosave exists, then acts on the result. Nothing here touches storage
 * or the DOM, so the policy tests run in Node.
 */

/** Taxonomy ids from 19 section 2. */
export type FaultKind =
  | 'js_main'
  | 'js_worker'
  | 'sim_fatal'
  | 'worker_dead'
  | 'main_hang'
  | 'gl_lost'
  | 'audio_fail'
  | 'oom'
  | 'storage_fail'
  | 'load_corrupt'
  | 'asset_fail'
  | 'csp_violation'
  | 'unclean_exit'
  | 'desync';

export type Severity = 'warn' | 'error' | 'fatal';

export const FAULT_SEVERITY: Readonly<Record<FaultKind, Severity>> = {
  js_main: 'error',
  js_worker: 'error',
  sim_fatal: 'fatal',
  worker_dead: 'fatal',
  main_hang: 'error',
  gl_lost: 'error',
  audio_fail: 'warn',
  oom: 'fatal',
  storage_fail: 'error',
  load_corrupt: 'error',
  asset_fail: 'error',
  csp_violation: 'warn',
  unclean_exit: 'warn',
  desync: 'warn',
};

/** The ladder steps for a fatal fault, in the order they are tried (goal: restart, reset, dialog). */
export type RecoveryLevel = 'restart_from_autosave' | 'reset_realm' | 'fatal_dialog';

/** Window for counting repeated faults (19 section 7, step 5). */
export const RECOVERY_WINDOW_MS = 10 * 60_000;
/** Restart from autosave is tried once per window; a second fatal in the window resets the Realm. */
export const MAX_RESTARTS_PER_WINDOW = 1;
export const MAX_RESETS_PER_WINDOW = 1;
/** Two fatal faults inside the window enter Safe Mode (19 section 7, step 5). */
export const SAFE_MODE_FATAL_COUNT = 2;

/** Boot-loop guard (19 section 4): this many unclean boots inside the window enter Safe Mode. */
export const BOOT_LOOP_WINDOW_MS = 5 * 60_000;
export const BOOT_LOOP_COUNT = 3;
export const BOOT_HISTORY_MAX = 5;

/** One fatal fault and the level chosen for it. Kept in the journal so repeats can be counted. */
export interface RecoveryAttempt {
  atMs: number;
  kind: FaultKind;
  level: RecoveryLevel;
}

export interface RecoveryInput {
  kind: FaultKind;
  nowMs: number;
  attempts: readonly RecoveryAttempt[];
  /** A valid autosave exists to restart from. */
  hasValidAutosave: boolean;
}

export interface RecoveryDecision {
  /** null for warn and error faults: the sim disables the feature or shows a banner instead. */
  level: RecoveryLevel | null;
  /** True when the fault count in the window reaches SAFE_MODE_FATAL_COUNT. */
  enterSafeMode: boolean;
  reason: string;
}

/** Chooses the ladder step for one fault. */
export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  const severity = FAULT_SEVERITY[input.kind];
  if (severity !== 'fatal') {
    return { level: null, enterSafeMode: false, reason: `${input.kind} is ${severity}; no ladder step` };
  }
  const recent = input.attempts.filter((a) => input.nowMs - a.atMs < RECOVERY_WINDOW_MS && a.atMs <= input.nowMs);
  const restarts = recent.filter((a) => a.level === 'restart_from_autosave').length;
  const resets = recent.filter((a) => a.level === 'reset_realm').length;
  const fatalCount = recent.filter((a) => FAULT_SEVERITY[a.kind] === 'fatal').length + 1;
  const enterSafeMode = fatalCount >= SAFE_MODE_FATAL_COUNT;

  if (input.hasValidAutosave && restarts < MAX_RESTARTS_PER_WINDOW) {
    return { level: 'restart_from_autosave', enterSafeMode, reason: 'restart the sim from the last valid autosave' };
  }
  if (resets < MAX_RESETS_PER_WINDOW) {
    return { level: 'reset_realm', enterSafeMode, reason: input.hasValidAutosave ? 'restart already tried in this window' : 'no valid autosave; start a new Realm, keeping saves' };
  }
  return { level: 'fatal_dialog', enterSafeMode, reason: 'restart and reset already tried in this window' };
}

/** True when the unclean boots in the last BOOT_LOOP_WINDOW_MS reach BOOT_LOOP_COUNT. Pass unclean boot times only. */
export function isBootLoop(uncleanBootTimes: readonly number[], nowMs: number): boolean {
  const inWindow = uncleanBootTimes.filter((t) => t <= nowMs && nowMs - t < BOOT_LOOP_WINDOW_MS);
  return inWindow.length >= BOOT_LOOP_COUNT;
}

/** Adds a boot time and keeps only the newest BOOT_HISTORY_MAX. Returns a new array. */
export function recordBoot(boots: readonly number[], nowMs: number): number[] {
  return [...boots, nowMs].slice(-BOOT_HISTORY_MAX);
}

/** Safe Mode settings the engine applies (19 section 7, step 5). */
export interface SafeModeProfile {
  qualityTier: 'low';
  sharedMemory: false;
  workers: 1;
  audio: false;
  autosave: true;
  renderScale: 0.5;
  /** Only the previous-generation save is auto-offered in Safe Mode. */
  restoreGeneration: 'previous';
}

export const SAFE_MODE_PROFILE: SafeModeProfile = {
  qualityTier: 'low',
  sharedMemory: false,
  workers: 1,
  audio: false,
  autosave: true,
  renderScale: 0.5,
  restoreGeneration: 'previous',
};

/** A save that the unclean-exit prompt can offer (suspend or an autosave). */
export interface RestoreCandidate {
  slotId: string;
  savedAtMs: number;
  valid: boolean | 'unknown';
  generation: 'current' | 'previous';
}

/**
 * The restore offers, newest first. Invalid saves are left out. In Safe Mode only the previous
 * generation is offered.
 */
export function restoreOffers(candidates: readonly RestoreCandidate[], safeMode: boolean): RestoreCandidate[] {
  return candidates
    .filter((c) => c.valid !== false)
    .filter((c) => !safeMode || c.generation === 'previous')
    .sort((a, b) => b.savedAtMs - a.savedAtMs || a.slotId.localeCompare(b.slotId));
}

/** The default restore target: the newest valid offer, or null when there is nothing to restore. */
export function chooseRestore(candidates: readonly RestoreCandidate[], safeMode: boolean): RestoreCandidate | null {
  return restoreOffers(candidates, safeMode)[0] ?? null;
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    journal('UNCAUGHT', event.message);
    showFatal('Something went wrong', event.message);
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    journal('UNHANDLED_REJECTION', message);
    showFatal('Something went wrong', message);
  });
}
