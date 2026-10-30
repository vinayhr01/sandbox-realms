/**
 * Crash capture and recovery (19 sections 3-8): unclean-exit sentinel, a small local journal, the
 * fatal dialog with its recovery actions, the boot-loop guard and Safe Mode. Storage access is
 * wrapped because it can throw in private windows. Nothing leaves the device (no telemetry in v1).
 */
const SENTINEL_KEY = 'sr.session';
const JOURNAL_KEY = 'sr.journal';
/** Breadcrumb ring: the last 50 entries (19 section 3). */
export const JOURNAL_MAX = 50;

export interface JournalEntry {
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

/** The newest journal entries, oldest first. Used as the breadcrumbs of a crash record (19 section 3). */
export function recentJournal(limit: number): JournalEntry[] {
  return readJournal().slice(-Math.max(0, limit));
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

/**
 * The breadcrumb types of 19 section 3. The detail carries ids and numbers only (a power id, a window id, a speed):
 * never coordinates, names or text typed by the player.
 */
export type CrumbCode = 'WINDOW_OPEN' | 'POWER_SELECT' | 'POWER_APPLY' | 'SAVE_START' | 'SAVE_DONE' | 'SPEED' | 'QUALITY' | 'AGE' | 'WORKER_RESTART';

export function crumb(code: CrumbCode, detail: string): void {
  journal(code, detail);
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
  /** Shown but not clickable, for example a restore when no valid autosave exists. */
  disabled?: boolean;
  run: () => void | Promise<void>;
}

/**
 * Shows the fatal dialog with a reload action plus any extra actions (19 section 7). Safe to call
 * more than once: the extra buttons are rebuilt each time, and the reload button is set, not added.
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
        btn.disabled = action.disabled === true;
        btn.addEventListener('click', () => void action.run());
        return btn;
      }),
    );
  }
  dialog.hidden = false;
  const reload = document.getElementById('fatal-reload');
  if (reload) reload.onclick = () => location.reload();
}

/** Replaces the detail text of the open fatal dialog (for example after a failed restore). */
export function setFatalDetail(text: string): void {
  const detailEl = document.getElementById('fatal-detail');
  if (detailEl) detailEl.textContent = text;
}

/** True while the fatal dialog is open. */
export function fatalOpen(): boolean {
  const dialog = document.getElementById('fatal');
  return dialog !== null && !dialog.hidden;
}

/** Closes the fatal dialog without reloading. */
export function hideFatal(): void {
  const dialog = document.getElementById('fatal');
  if (dialog) dialog.hidden = true;
}

/**
 * Runtime health on the main thread (17 section 10 watchdog, 17 section 3.4 ladder applied to the render side).
 * Pure: the caller supplies the clock and the frame times, and applies what comes back.
 */

/** The worker should post a heartbeat about this often (17 section 10). */
export const HEARTBEAT_EXPECT_MS = 2_000;
/** A worker silent this long is "not responding" (17 section 10: missing for 6 s). */
export const HEARTBEAT_STALL_MS = 6_000;

/** True when the last heartbeat is older than the stall threshold. Null means no heartbeat has been seen yet. */
export function workerStalled(lastSeenMs: number | null, nowMs: number, stallMs: number = HEARTBEAT_STALL_MS): boolean {
  return lastSeenMs !== null && nowMs - lastSeenMs > stallMs;
}

/** A main-thread frame gap this long is a freeze (19 section 2, main_hang: long task over 5 s). */
export const MAIN_HANG_MS = 5_000;

/**
 * True when a frame gap means the main thread was frozen. The overlay is shown when the thread wakes,
 * because a frozen thread cannot draw it (19 section 2). A gap with the page hidden is a tab switch.
 */
export function mainHangGap(deltaMs: number, hiddenDuringGap: boolean): boolean {
  return !hiddenDuringGap && deltaMs > MAIN_HANG_MS;
}

/** Mean frame time over this many times the frame budget counts as over budget. TUNE. */
export const DEGRADE_OVER_FACTOR = 1.2;
/** Mean frame time under this many times the budget counts as recovered. TUNE. */
export const DEGRADE_UNDER_FACTOR = 0.8;
/** Consecutive over-budget seconds before stepping down one level. TUNE (the spec says "N consecutive seconds"). */
export const DEGRADE_DOWN_SECONDS = 2;
/** Consecutive under-budget seconds before stepping back up one level (17 section 3.4 exit time). */
export const DEGRADE_UP_SECONDS = 8;
/** Minimum seconds between two level changes in either direction (17 section 3.4). */
export const DEGRADE_HOLD_SECONDS = 2;
/** Frames longer than this are gaps (hidden tab, debugger pause), not load; they are not sampled. */
export const DEGRADE_MAX_FRAME_MS = 500;
/** Highest degradation level: nine map effects off, then the render scale cap. */
export const DEGRADE_MAX_LEVEL = 10;
/**
 * Runtime-only map effects turned off, one per level from level 1 up. They are not settings: they are never saved
 * and never shown in the Options UI (the saved settings are never written).
 */
export const DEGRADE_OFF: readonly string[] = [
  'map.effects',
  'map.crowdAnim',
  'map.dust',
  'map.terrainClose',
  'map.terrainMedium',
  'map.creatureAnim',
  'map.bloom',
  'map.particles',
  'map.shadows',
];
/** From this level on, the render scale is capped at DEGRADE_RENDER_SCALE percent. */
export const DEGRADE_RENDER_SCALE_LEVEL = 10;
export const DEGRADE_RENDER_SCALE = 50;

/**
 * The 3D ladder (spec "Renderer choice", 3D part 1 Task 7). Levels 1 to 9 are the 2D steps above, then the 3D water and
 * terrain steps (day and night), then the five 3D steps that replace the 2D render-scale step. Only the 3D view takes
 * them. `map3d.waterReflect` drops the sea mirror, `map3d.terrainFine` drops the fine near chunks, `map3d.stars` is read
 * by the sky layer, and `map3d.billboards` is read by the billboard layer.
 */
export const DEGRADE_OFF_3D: readonly string[] = [
  ...DEGRADE_OFF,
  'map3d.waterReflect',
  'map3d.terrainFine',
  'map3d.stars',
  'map3d.shadows',
  'map3d.post',
  'map3d.billboards',
  'map3d.viewDistance',
  'map3d.renderScale',
];
/** The 3D view's render-scale cap, at the last 3D step. */
export const DEGRADE_RENDER_SCALE_3D = 60;

/** The runtime steps for a renderer kind, in the order they are taken. */
export function ladderFor(kind: '2d' | '3d'): readonly string[] {
  return kind === '3d' ? DEGRADE_OFF_3D : DEGRADE_OFF;
}

/** The highest level for a renderer kind. */
export function ladderMaxLevel(kind: '2d' | '3d'): number {
  return kind === '3d' ? DEGRADE_OFF_3D.length : DEGRADE_MAX_LEVEL;
}

/** True when the track is on the last step of the ladder (the level the 3D toast waits for). */
export function ladderExhausted(track: DegradeTrack, maxLevel: number = DEGRADE_MAX_LEVEL): boolean {
  return track.level >= maxLevel;
}

/** The render-scale cap a level imposes, in percent, or null for no cap. */
export function renderScaleCapFor(kind: '2d' | '3d', level: number): number | null {
  if (kind === '3d') return level >= DEGRADE_OFF_3D.length ? DEGRADE_RENDER_SCALE_3D : null;
  return level >= DEGRADE_RENDER_SCALE_LEVEL ? DEGRADE_RENDER_SCALE : null;
}

export interface DegradeTrack {
  level: number;
  overSeconds: number;
  underSeconds: number;
  holdSeconds: number;
}

export const DEGRADE_START: DegradeTrack = { level: 0, overSeconds: 0, underSeconds: 0, holdSeconds: DEGRADE_HOLD_SECONDS };

/**
 * One step per one-second window. `meanFrameMs` is the mean frame interval over the window and
 * `budgetMs` the frame budget for the current frame-rate cap. Steps down after DEGRADE_DOWN_SECONDS
 * over budget, steps up after DEGRADE_UP_SECONDS under it, and never changes more than once per hold.
 * `effectsIdle` says no deploy effect is alive. Then the map.effects step frees nothing, so a step down
 * counts it as done and goes on to the next one (the effects layer is still turned off at that level).
 */
export function stepDegrade(track: DegradeTrack, meanFrameMs: number, budgetMs: number, effectsIdle = false, maxLevel: number = DEGRADE_MAX_LEVEL): DegradeTrack {
  const over = meanFrameMs > budgetMs * DEGRADE_OVER_FACTOR;
  const under = meanFrameMs < budgetMs * DEGRADE_UNDER_FACTOR;
  const overSeconds = over ? track.overSeconds + 1 : 0;
  const underSeconds = under ? track.underSeconds + 1 : 0;
  const holdSeconds = Math.min(track.holdSeconds + 1, DEGRADE_HOLD_SECONDS);
  if (holdSeconds >= DEGRADE_HOLD_SECONDS) {
    if (overSeconds >= DEGRADE_DOWN_SECONDS && track.level < maxLevel) {
      const skipsEffects = effectsIdle && DEGRADE_OFF[track.level] === 'map.effects';
      const level = Math.min(track.level + (skipsEffects ? 2 : 1), maxLevel);
      return { level, overSeconds: 0, underSeconds: 0, holdSeconds: 0 };
    }
    if (underSeconds >= DEGRADE_UP_SECONDS && track.level > 0) {
      return { level: track.level - 1, overSeconds: 0, underSeconds: 0, holdSeconds: 0 };
    }
  }
  return { level: track.level, overSeconds, underSeconds, holdSeconds };
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

/** Reports a crash to the recovery dialog. `stack` is the JS stack when the fault has one. */
export type CrashReporter = (kind: FaultKind, title: string, detail: string, stack?: string) => void;

export function installGlobalErrorHandlers(report: CrashReporter = (_kind, title, detail) => showFatal(title, detail)): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    journal('UNCAUGHT', event.message);
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    report('js_main', 'Something went wrong', event.message, stack);
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    journal('UNHANDLED_REJECTION', message);
    const stack = reason instanceof Error ? reason.stack : undefined;
    report('js_main', 'Something went wrong', message, stack);
  });
}
