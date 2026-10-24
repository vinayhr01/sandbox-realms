/**
 * Crash capture and recovery (19 sections 3-8): unclean-exit sentinel, a small local journal, the
 * fatal dialog with its recovery actions, the boot-loop guard and Safe Mode. Storage access is
 * wrapped because it can throw in private windows. Nothing leaves the device (no telemetry in v1).
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

/** One button on the fatal dialog. `run` is called when it is clicked. */
export interface FatalAction {
  label: string;
  primary?: boolean;
  run: () => void;
}

/**
 * Shows the fatal dialog with a reload action plus any extra actions (19 section 7). Safe to call
 * more than once: the extra buttons are rebuilt each time.
 */
export function showFatal(title: string, detail: string, actions: readonly FatalAction[] = []): void {
  const dialog = document.getElementById('fatal');
  const titleEl = document.getElementById('fatal-title');
  const detailEl = document.getElementById('fatal-detail');
  if (!dialog || !titleEl || !detailEl) return;
  titleEl.textContent = title;
  detailEl.textContent = detail;
  const host = document.getElementById('fatal-actions');
  if (host) {
    host.replaceChildren(
      ...actions.map((action) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = action.primary ? 'btn primary' : 'btn';
        btn.textContent = action.label;
        btn.addEventListener('click', () => action.run(), { once: true });
        return btn;
      }),
    );
  }
  dialog.hidden = false;
  document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload(), { once: true });
}

/** Closes the fatal dialog without reloading. */
export function hideFatal(): void {
  const dialog = document.getElementById('fatal');
  if (dialog) dialog.hidden = true;
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

// Boot history and Safe Mode storage. localStorage keeps the boot times across reloads; sessionStorage
// keeps Safe Mode and the fault attempts for this tab only. Every access can throw, so each is wrapped.

const BOOTS_KEY = 'sr.boots';
const SAFE_KEY = 'sr.safeMode';
const ATTEMPTS_KEY = 'sr.attempts';

function safeStore(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readJsonArray(storage: Storage | null, key: string): unknown[] {
  try {
    const raw = storage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Not stored: the guard simply has less history next time.
  }
}

/** Unclean-boot times kept for the boot-loop guard. */
export function loadBoots(): number[] {
  return readJsonArray(safeStore('local'), BOOTS_KEY).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
}

export function storeBoots(boots: readonly number[]): void {
  writeJson(safeStore('local'), BOOTS_KEY, boots);
}

/**
 * Runs at boot, after startSentinel. When the previous session did not exit cleanly the boot is
 * recorded; `loop` is true when the recent unclean boots reach the boot-loop count (19 section 4).
 */
export function bootGuard(nowMs: number, unclean: boolean): { loop: boolean } {
  if (!unclean) return { loop: false };
  const boots = recordBoot(loadBoots(), nowMs);
  storeBoots(boots);
  return { loop: isBootLoop(boots, nowMs) };
}

/** True when this tab chose Safe Mode. It lasts until the tab closes. */
export function safeModeOn(): boolean {
  try {
    return safeStore('session')?.getItem(SAFE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSafeMode(on: boolean): void {
  try {
    if (on) safeStore('session')?.setItem(SAFE_KEY, '1');
    else safeStore('session')?.removeItem(SAFE_KEY);
  } catch {
    // Without session storage Safe Mode does not survive the reload.
  }
}

/** Fault attempts in this tab, for the ladder's repeat counts. */
export function loadAttempts(): RecoveryAttempt[] {
  return readJsonArray(safeStore('session'), ATTEMPTS_KEY) as RecoveryAttempt[];
}

export function storeAttempt(attempt: RecoveryAttempt): void {
  writeJson(safeStore('session'), ATTEMPTS_KEY, [...loadAttempts(), attempt].slice(-20));
}

/** Reports a crash to the recovery dialog. The app supplies it; the default only shows the fatal dialog. */
export type CrashReporter = (kind: FaultKind, title: string, detail: string) => void;

export function installGlobalErrorHandlers(report: CrashReporter = (_kind, title, detail) => showFatal(title, detail)): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    journal('UNCAUGHT', event.message);
    report('js_main', 'Something went wrong', event.message);
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    journal('UNHANDLED_REJECTION', message);
    report('js_main', 'Something went wrong', message);
  });
}
