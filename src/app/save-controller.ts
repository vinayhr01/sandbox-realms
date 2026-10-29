/**
 * The save actions the UI runs (15 sections 5, 7, 11): manual and quick saves, load, delete, export,
 * import, autosave on a timer and on pause, and the suspend save on hide. The Chronicle bytes come
 * from a ChronicleSource. The sim worker has no Chronicle command in this build, so the default
 * source cannot capture or restore a realm. Everything else (the store, export, import, delete) works
 * without it. Every outcome is a plain message for the UI to show.
 */
import {
  AUTOSAVE_INTERVAL_MS,
  AUTOSAVE_RETRY_MS,
  AUTOSAVE_RING,
  AutosaveClock,
  SaveError,
  SaveService,
  classifyStorageError,
  decideAutosave,
  decideSuspend,
  exportFileName,
  firstFreeManualSlot,
  manualSlotId,
  QUICK_SLOT_ID,
  type AutosaveContext,
  type SaveBackendMode,
  type SaveResult,
  type SlotInfo,
  type SlotMeta,
} from './saves.ts';
import { chooseRestore, crumb, restoreOffers, type RestoreCandidate } from './recovery.ts';

/** The emergency save on a fatal path may take this long (19 section 7 step 3b, T-19-3). */
export const EMERGENCY_SAVE_BUDGET_MS = 1_500;
/** Emergency saves are at least this far apart. A main-thread error that repeats every frame must not write every frame. */
export const EMERGENCY_SAVE_MIN_MS = 10_000;

/** Produces and restores the live realm. The UI never touches the sim directly. */
export interface ChronicleSource {
  readonly canCapture: boolean;
  readonly canRestore: boolean;
  capture(): Promise<{ bytes: Uint8Array; info: SlotInfo } | null>;
  restore(bytes: Uint8Array): Promise<boolean>;
}

/** Fallback source for a controller built without a live realm (tests). The app passes the live client. */
export const NO_SIM_SOURCE: ChronicleSource = {
  canCapture: false,
  canRestore: false,
  capture: () => Promise.resolve(null),
  restore: () => Promise.resolve(false),
};

export const CANNOT_CAPTURE = 'Saving the live realm is not available in this build yet.';
export const CANNOT_RESTORE = 'Loading a realm is not available in this build yet.';

export interface ActionOutcome {
  ok: boolean;
  message: string;
}

export type SaveAction = 'save' | 'quick' | 'load' | 'delete';

/** What the autosave needs to know about the UI at this moment. */
export interface AutosaveState {
  /** Commands applied or years passed since the last successful save. */
  dirty: boolean;
  modalOpen: boolean;
  gestureActive: boolean;
  degradeLevel: number;
}

export interface ExportFile {
  name: string;
  bytes: Uint8Array;
}

/** How long a capture may take before a manual save gives up. */
export const CAPTURE_TIMEOUT_MS = 15_000;
/** How long the store may take to write a save before a manual save gives up. */
export const WRITE_TIMEOUT_MS = 10_000;
/** How long the store may take to list slots before the window reports it cannot read them. */
export const LIST_TIMEOUT_MS = 10_000;

export interface SaveControllerOptions {
  captureTimeoutMs?: number;
  writeTimeoutMs?: number;
  now?: () => number;
  /** Called after a successful autosave, so the caller can clear its dirty flag. */
  onAutosaved?: () => void;
}

const ok = (message: string): ActionOutcome => ({ ok: true, message });
const fail = (message: string): ActionOutcome => ({ ok: false, message });

function writeOutcome(result: SaveResult, label: string, memoryReason: string | null = null): ActionOutcome {
  if (result.ok) {
    return ok(
      memoryReason === null
        ? `Saved ${label}.`
        : `Saved ${label}, but only until this tab closes: this browser is not letting the game keep saves on this device (${memoryReason}).`,
    );
  }
  const biggest = result.biggest.length > 0 ? ` Largest saves: ${result.biggest.join(', ')}.` : '';
  return fail(`Not enough room to save ${label}. Delete a save first.${biggest}`);
}

/** How long a restore may wait for the sim to answer before the attempt is given up. */
export const RESTORE_TIMEOUT_MS = 10_000;
/** The boot resume shows "still resuming" after this long. Saves stay held until the restore settles, however long that is. */
export const RESUME_TIMEOUT_MS = 30_000;
export const STILL_RESUMING = 'Still resuming your world…';

/**
 * The autosaves as restore candidates. Manual, quick and suspend slots are not offered here. The
 * newest autosave is the current generation and older ones are previous, which is what Safe Mode
 * offers (19 section 7, step 5).
 */
export function autosaveCandidates(metas: readonly SlotMeta[]): RestoreCandidate[] {
  return metas
    .filter((m) => m.kind === 'auto')
    .sort((a, b) => b.savedAtMs - a.savedAtMs || (b.seq ?? 0) - (a.seq ?? 0))
    .map((m, i): RestoreCandidate => ({ slotId: m.slotId, savedAtMs: m.savedAtMs, valid: m.valid, generation: i === 0 ? 'current' : 'previous' }));
}

/** Rejects with a 'timeout' SaveError when the promise does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SaveError('timeout', what)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Resolves to the promise's value, or null when it does not settle within `ms`. */
function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class SaveController {
  private store: Promise<SaveService> | null = null;
  private readonly clock: AutosaveClock;
  /** Settings: autosave on or off, and how many autosaves the ring keeps. Off stops the timer and the pause save. */
  private autosaveOn = true;
  private autosaveKeep = AUTOSAVE_RING;
  private readonly now: () => number;
  private readonly captureTimeoutMs: number;
  private readonly writeTimeoutMs: number;
  private readonly onAutosaved: (() => void) | null;
  private state: AutosaveState = { dirty: false, modalOpen: false, gestureActive: false, degradeLevel: 0 };
  private failures = 0;
  private retries = 0;
  private inFlight = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly loadedAtMs: number;
  private lastAutosaveMs: number | null = null;
  private lastSuspendMs: number | null = null;
  private lastEmergencyMs: number | null = null;
  /** True from the start of the boot resume until it lands: nothing may capture the throwaway default world meanwhile. */
  private resuming = false;
  private lastResumed: { meta: SlotMeta; bytes: Uint8Array } | null = null;

  constructor(
    private readonly open: () => Promise<SaveService>,
    private readonly source: ChronicleSource,
    options: SaveControllerOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.captureTimeoutMs = options.captureTimeoutMs ?? CAPTURE_TIMEOUT_MS;
    this.writeTimeoutMs = options.writeTimeoutMs ?? WRITE_TIMEOUT_MS;
    this.onAutosaved = options.onAutosaved ?? null;
    this.loadedAtMs = this.now();
    // Autosave needs a capture. Without one the timer stays off rather than failing every interval.
    this.clock = new AutosaveClock(source.canCapture ? AUTOSAVE_INTERVAL_MS : 0);
  }

  /** Applies the Settings: `minutes` between autosaves and `keep` autosaves in the ring. Takes effect at once. */
  configureAutosave(on: boolean, minutes: number, keep: number): void {
    this.autosaveOn = on;
    this.autosaveKeep = keep;
    this.clock.setInterval(on && this.source.canCapture ? minutes * 60_000 : 0);
  }

  private async service(): Promise<SaveService> {
    this.store ??= this.open();
    const svc = await this.store;
    if (!svc.stale) return svc;
    // The browser closed the connection (another tab upgraded the database): open it again.
    this.store = this.open();
    return this.store;
  }

  /** Called before the first realm is made on a page that will try to resume: saves hold off until resumeNewest finishes. */
  beginResume(): void {
    this.resuming = true;
  }

  get isResuming(): boolean {
    return this.resuming;
  }

  /**
   * The store for a save the player asked for. When the last open fell back to memory because it was
   * blocked or timed out, that may have cleared (the other tab closed), so the open is tried again.
   */
  private async freshService(): Promise<SaveService> {
    const svc = await this.service();
    if (svc.mode === 'memory' && (svc.fallbackCode === 'blocked' || svc.fallbackCode === 'timeout')) {
      this.store = null;
      return this.service();
    }
    return svc;
  }

  /** A save cannot go ahead when the database is blocked, refused or too slow: say so rather than saving to memory. */
  private blockedOutcome(svc: SaveService): ActionOutcome | null {
    const code = svc.fallbackCode;
    if (svc.mode === 'memory' && (code === 'blocked' || code === 'private' || code === 'timeout')) return fail(this.describe(new SaveError(code, ''), 'save'));
    return null;
  }

  /** Storage mode and, when IndexedDB is not used, the reason for the banner. */
  async storage(): Promise<{ mode: SaveBackendMode; fallbackReason: string | null }> {
    const svc = await this.service();
    return { mode: svc.mode, fallbackReason: svc.fallbackReason };
  }

  get canSave(): boolean {
    return this.source.canCapture;
  }

  get canLoad(): boolean {
    return this.source.canRestore;
  }

  /** Slot list, newest first. */
  list(): Promise<SlotMeta[]> {
    return withTimeout(
      this.service().then((svc) => svc.list()),
      LIST_TIMEOUT_MS,
      'listing saves timed out',
    );
  }

  /**
   * The autosave the recovery dialog would restore: the newest valid one (19 section 7 step 4),
   * picked by chooseRestore. Null when there is none, or when the store cannot be read.
   */
  async restoreTarget(safeMode = false): Promise<SlotMeta | null> {
    try {
      const metas = await this.list();
      const pick = chooseRestore(autosaveCandidates(metas), safeMode);
      return metas.find((m) => m.slotId === pick?.slotId) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Loads the newest valid autosave into the live realm. A save that cannot be read is marked
   * invalid by the store and the next one is tried. A simulation that does not answer in time stops
   * the attempt, because older saves would wait the same way.
   */
  async restoreAutosave(safeMode = false): Promise<ActionOutcome> {
    if (!this.source.canRestore) return fail(CANNOT_RESTORE);
    try {
      const svc = await this.service();
      const offers = restoreOffers(autosaveCandidates(await svc.list()), safeMode);
      if (offers.length === 0) return fail('There is no valid autosave to restore.');
      for (const offer of offers) {
        let bytes: Uint8Array | null;
        try {
          bytes = await svc.read(offer.slotId);
        } catch {
          continue;
        }
        if (!bytes) continue;
        const loaded = await settleWithin(this.source.restore(bytes), RESTORE_TIMEOUT_MS);
        if (loaded === null) return fail('The simulation did not answer, so the autosave was not loaded.');
        if (loaded) return ok(`Restored the autosave from ${new Date(offer.savedAtMs).toLocaleString()}.`);
      }
      return fail('No autosave could be loaded.');
    } catch (err) {
      return fail(this.describe(err, 'load'));
    }
  }

  /**
   * Loads the newest save of any kind into the live realm, as the page does on start. Does nothing in
   * Safe Mode. A save that cannot be read is skipped for the next one. The message names realm and year.
   * The save guard stays up until the restore settles, however long that takes. `onSlow` runs once
   * after RESUME_TIMEOUT_MS while the restore is still going, so the UI can say so and free its input.
   */
  async resumeNewest(safeMode: boolean, onSlow?: () => void): Promise<ActionOutcome> {
    this.resuming = true;
    try {
      return await this.resumeNewestInner(safeMode, onSlow);
    } finally {
      this.resuming = false;
    }
  }

  /** Copies the resumed realm into a manual slot before the player starts a new world. Null when it already is one. */
  async keepResumedBeforeNewWorld(): Promise<ActionOutcome | null> {
    const kept = this.lastResumed;
    if (!kept || kept.meta.kind === 'manual') return null;
    this.lastResumed = null;
    try {
      const svc = await this.service();
      const n = firstFreeManualSlot(await svc.list());
      if (n === null) return fail('All 12 manual slots are full, so the old world was not kept.');
      const info = { realmName: `${kept.meta.realmName} (before new world)`, tick: kept.meta.tick, year: kept.meta.year };
      return writeOutcome(await svc.writeManual(n, kept.bytes, info, this.now()), `the old world in slot ${n}`);
    } catch (err) {
      return fail(this.describe(err, 'save'));
    }
  }

  private async resumeNewestInner(safeMode: boolean, onSlow?: () => void): Promise<ActionOutcome> {
    if (safeMode || !this.source.canRestore) return fail('Resuming is off.');
    try {
      const svc = await this.service();
      const metas = await withTimeout(svc.list(), LIST_TIMEOUT_MS, 'listing saves timed out');
      const candidates = metas.map((m): RestoreCandidate => ({ slotId: m.slotId, savedAtMs: m.savedAtMs, valid: m.valid, generation: 'current' }));
      for (const offer of restoreOffers(candidates, false)) {
        const meta = metas.find((m) => m.slotId === offer.slotId);
        if (!meta) continue;
        let bytes: Uint8Array | null;
        try {
          bytes = await svc.read(meta.slotId);
        } catch {
          continue;
        }
        if (!bytes) continue;
        // Waits for the restore to settle, not for a deadline: a half-restored realm must never be saved over.
        const slow = setTimeout(() => onSlow?.(), RESUME_TIMEOUT_MS);
        let loaded: boolean;
        try {
          loaded = await this.source.restore(bytes);
        } finally {
          clearTimeout(slow);
        }
        if (loaded) {
          this.lastResumed = { meta, bytes };
          return ok(`Resumed ${meta.realmName}, year ${meta.year}.`);
        }
      }
      return fail('There is no save to resume.');
    } catch (err) {
      return fail(this.describe(err, 'load'));
    }
  }

  /** Runs one action from the Chronicle window. `slotId` is 'new' for a save into the first free manual slot. */
  async perform(action: SaveAction, slotId: string): Promise<ActionOutcome> {
    if (action === 'save' || action === 'quick') crumb('SAVE_START', action);
    try {
      let outcome: ActionOutcome;
      switch (action) {
        case 'save':
          outcome = await this.saveManual(slotId);
          break;
        case 'quick':
          outcome = await this.saveQuick();
          break;
        case 'load':
          outcome = await this.load(slotId);
          break;
        case 'delete':
          outcome = await this.remove(slotId);
          break;
      }
      if (action === 'save' || action === 'quick') crumb('SAVE_DONE', `${action} ${outcome.ok ? 'ok' : 'failed'}`);
      return outcome;
    } catch (err) {
      if (action === 'save' || action === 'quick') crumb('SAVE_DONE', `${action} failed`);
      return fail(this.describe(err, action));
    }
  }

  private async saveManual(slotId: string): Promise<ActionOutcome> {
    if (!this.source.canCapture) return fail(CANNOT_CAPTURE);
    if (this.resuming) return fail(STILL_RESUMING);
    const svc = await this.freshService();
    const blocked = this.blockedOutcome(svc);
    if (blocked) return blocked;
    let n: number | null;
    if (slotId === 'new') {
      n = firstFreeManualSlot(await svc.list());
      if (n === null) return fail('All 12 manual slots are full. Delete a save first.');
    } else {
      n = Number(/^manual:(\d+)$/.exec(slotId)?.[1] ?? NaN);
      if (!Number.isInteger(n)) return fail('That slot does not exist.');
    }
    const captured = await withTimeout(this.source.capture(), this.captureTimeoutMs, 'capture timed out');
    if (!captured) return fail(CANNOT_CAPTURE);
    const atMs = this.now();
    return this.confirmedWrite(svc, manualSlotId(n), atMs, `slot ${n}`, () => svc.writeManual(n, captured.bytes, captured.info, atMs));
  }

  private async saveQuick(): Promise<ActionOutcome> {
    if (!this.source.canCapture) return fail(CANNOT_CAPTURE);
    if (this.resuming) return fail(STILL_RESUMING);
    const svc = await this.freshService();
    const blocked = this.blockedOutcome(svc);
    if (blocked) return blocked;
    const captured = await withTimeout(this.source.capture(), this.captureTimeoutMs, 'capture timed out');
    if (!captured) return fail(CANNOT_CAPTURE);
    const atMs = this.now();
    return this.confirmedWrite(svc, QUICK_SLOT_ID, atMs, 'the quick save', () => svc.writeQuick(captured.bytes, captured.info, atMs));
  }

  /**
   * Runs a write with a time limit. A write that outlives the limit may still commit, so the slot is
   * looked up again: found means saved, not found means "slow", never a hard failure.
   */
  private async confirmedWrite(svc: SaveService, slotId: string, atMs: number, label: string, write: () => Promise<SaveResult>): Promise<ActionOutcome> {
    try {
      const result = await withTimeout(write(), this.writeTimeoutMs, 'write timed out');
      return writeOutcome(result, label, svc.mode === 'memory' ? svc.fallbackReason : null);
    } catch (err) {
      if (!(err instanceof SaveError) || err.code !== 'timeout') throw err;
      try {
        const metas = await withTimeout(svc.list(), this.writeTimeoutMs, 'listing saves timed out');
        if (metas.some((m) => m.slotId === slotId && m.savedAtMs === atMs)) return ok(`Saved ${label}.`);
      } catch {
        // The store is not answering either: fall through to the slow message.
      }
      return fail('Saving is taking long — check the list in a moment.');
    }
  }

  private async load(slotId: string): Promise<ActionOutcome> {
    if (!this.source.canRestore) return fail(CANNOT_RESTORE);
    const bytes = await (await this.service()).read(slotId);
    if (!bytes) return fail('That save no longer exists.');
    return (await this.source.restore(bytes)) ? ok('Loaded the save.') : fail('The save could not be loaded.');
  }

  private async remove(slotId: string): Promise<ActionOutcome> {
    await (await this.service()).delete(slotId);
    return ok('Deleted the save.');
  }

  /** The file for a slot, named `<realm>-<year>.realm`. Null when the slot is empty. */
  async exportSave(slotId: string): Promise<ExportFile | null> {
    const svc = await this.service();
    const meta = (await svc.list()).find((m) => m.slotId === slotId);
    const bytes = await svc.read(slotId);
    if (!meta || !bytes) return null;
    return { name: exportFileName(meta.realmName, meta.year), bytes };
  }

  /**
   * Stores an imported file in the first free manual slot. The file is checked for the Chronicle magic
   * and size only. Its full decode happens when the realm is loaded, which this build cannot do yet.
   */
  async importFile(fileName: string, bytes: Uint8Array): Promise<ActionOutcome> {
    const svc = await this.service();
    const check = svc.checkImport(bytes);
    if (!check.ok) {
      const reasons = {
        empty: 'The file is empty.',
        too_large: 'The file is too large to be a realm.',
        not_a_chronicle: 'That file is not a Sandbox Realms save.',
      } as const;
      return fail(reasons[check.reason]);
    }
    const n = firstFreeManualSlot(await svc.list());
    if (n === null) return fail('All 12 manual slots are full. Delete a save first.');
    const realmName = fileName.replace(/\.realm$/i, '').trim().slice(0, 80) || 'Imported realm';
    return writeOutcome(await svc.writeManual(n, bytes, { realmName, tick: 0, year: 0 }, this.now()), `the imported realm in slot ${n}`);
  }

  /**
   * Advances the autosave timer by unpaused time and starts an autosave when one is due. The timer is
   * off when the source cannot capture, so nothing runs in that case.
   */
  frame(deltaMs: number, paused: boolean, state: AutosaveState): void {
    this.state = state;
    if (this.clock.advance(deltaMs, paused)) {
      // Reset now so a skipped autosave does not come due again on every frame.
      this.clock.markSaved();
      void this.autosave();
    }
  }

  /** An autosave on pause (15 section 5). Runs the same rules as the timer, without waiting for it. */
  onPause(state: AutosaveState): void {
    this.state = state;
    void this.autosave();
  }

  private async autosave(): Promise<void> {
    if (!this.source.canCapture || !this.autosaveOn || this.resuming) return;
    const ctx: AutosaveContext = {
      dirty: this.state.dirty,
      inFlight: this.inFlight,
      modalOpen: this.state.modalOpen,
      gestureActive: this.state.gestureActive,
      msSinceLoad: this.now() - this.loadedAtMs,
      degradeLevel: this.state.degradeLevel,
      consecutiveFailures: this.failures,
      retries: this.retries,
    };
    const decision = decideAutosave(ctx);
    if (decision.action === 'skip') {
      this.retries = 0;
      return;
    }
    if (decision.action === 'retry') {
      this.retries++;
      this.scheduleRetry(decision.delayMs);
      return;
    }
    this.retries = 0;
    this.inFlight = true;
    crumb('SAVE_START', 'auto');
    let outcome = 'failed';
    try {
      const captured = await this.source.capture();
      if (!captured) return;
      const result = await (await this.service()).writeAutosave(captured.bytes, captured.info, this.now(), this.autosaveKeep);
      if (result.ok) {
        this.failures = 0;
        this.lastAutosaveMs = this.now();
        this.clock.markSaved();
        this.onAutosaved?.();
        outcome = 'ok';
      } else {
        this.failures++;
      }
    } catch {
      this.failures++;
    } finally {
      this.inFlight = false;
      crumb('SAVE_DONE', `auto ${outcome}`);
    }
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.autosave();
    }, Math.max(delayMs, AUTOSAVE_RETRY_MS));
  }

  /** The suspend save on hide or pagehide (15 section 5). Throttled, and skipped after a recent autosave. */
  async suspend(): Promise<void> {
    if (!this.source.canCapture || this.resuming) return;
    const nowMs = this.now();
    if (decideSuspend({ nowMs, lastSuspendMs: this.lastSuspendMs, lastAutosaveMs: this.lastAutosaveMs }) === 'skip') return;
    crumb('SAVE_START', 'suspend');
    const captured = await this.source.capture();
    if (!captured) {
      crumb('SAVE_DONE', 'suspend no realm');
      return;
    }
    const result = await (await this.service()).writeSuspend(captured.bytes, captured.info, nowMs);
    if (result.ok) this.lastSuspendMs = nowMs;
    crumb('SAVE_DONE', `suspend ${result.ok ? 'ok' : 'failed'}`);
  }

  /**
   * The emergency save on a fatal path (19 section 7 step 3b, principle 1). It ignores the suspend throttle, writes the
   * suspend slot, and gives up after EMERGENCY_SAVE_BUDGET_MS. Resolves to a step name for the crash record.
   */
  async emergencySave(budgetMs: number = EMERGENCY_SAVE_BUDGET_MS): Promise<string> {
    if (!this.source.canCapture) return 'emergency_save_unavailable';
    if (this.resuming) return 'emergency_save_resuming';
    const nowMs = this.now();
    if (this.lastEmergencyMs !== null && nowMs - this.lastEmergencyMs < EMERGENCY_SAVE_MIN_MS) return 'emergency_save_throttled';
    this.lastEmergencyMs = nowMs;
    crumb('SAVE_START', 'emergency');
    const work = (async (): Promise<string> => {
      const captured = await this.source.capture();
      if (!captured) return 'emergency_save_no_realm';
      const result = await (await this.service()).writeSuspend(captured.bytes, captured.info, this.now());
      if (result.ok) {
        this.lastSuspendMs = this.now();
        return 'emergency_save_ok';
      }
      return 'emergency_save_full';
    })().catch((): string => 'emergency_save_failed');
    const outcome = (await settleWithin(work, budgetMs)) ?? 'emergency_save_timeout';
    crumb('SAVE_DONE', `emergency ${outcome}`);
    return outcome;
  }

  private describe(err: unknown, action: SaveAction): string {
    const verb = action === 'save' || action === 'quick' ? 'save' : action === 'delete' ? 'delete' : 'load';
    const gerund = verb === 'save' ? 'saving to' : verb === 'delete' ? 'deleting from' : 'loading from';
    const lead = `Couldn't ${verb}: `;
    const known = classifyStorageError(err);
    switch (known?.code) {
      case 'blocked':
        return `${lead}storage is blocked by another open tab of the game — close it and try again.`;
      case 'quota':
        return `${lead}storage is full — delete a save or free space on this device.`;
      case 'private':
        return `${lead}this browser blocks saving in private mode.`;
      case 'storage':
        // A dropped connection: forget the cached store so the next try opens a fresh one.
        this.store = null;
        return `${lead}storage error, try again.`;
      case 'timeout':
        if (/capture/.test(known.message)) return `${lead}the world took too long to capture.`;
        return `${lead}${gerund} this device timed out — close other tabs of the game and try again.`;
      default:
        break;
    }
    if (err instanceof Error && err.name === 'SaveError') {
      if (/checksum/.test(err.message)) return 'That save is damaged and cannot be read.';
      return err.message;
    }
    return 'The save store could not be used on this device.';
  }
}
