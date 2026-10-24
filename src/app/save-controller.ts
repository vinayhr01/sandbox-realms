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
  AutosaveClock,
  SaveService,
  decideAutosave,
  decideSuspend,
  exportFileName,
  firstFreeManualSlot,
  type AutosaveContext,
  type SaveBackendMode,
  type SaveResult,
  type SlotInfo,
  type SlotMeta,
} from './saves.ts';
import { chooseRestore, restoreOffers, type RestoreCandidate } from './recovery.ts';

/** Produces and restores the live realm. The UI never touches the sim directly. */
export interface ChronicleSource {
  readonly canCapture: boolean;
  readonly canRestore: boolean;
  capture(): Promise<{ bytes: Uint8Array; info: SlotInfo } | null>;
  restore(bytes: Uint8Array): Promise<boolean>;
}

/** The default source for this build: the sim worker has no Chronicle encode or decode command yet. */
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

export interface SaveControllerOptions {
  now?: () => number;
  /** Called after a successful autosave, so the caller can clear its dirty flag. */
  onAutosaved?: () => void;
}

const ok = (message: string): ActionOutcome => ({ ok: true, message });
const fail = (message: string): ActionOutcome => ({ ok: false, message });

function writeOutcome(result: SaveResult, label: string): ActionOutcome {
  if (result.ok) return ok(`Saved ${label}.`);
  const biggest = result.biggest.length > 0 ? ` Largest saves: ${result.biggest.join(', ')}.` : '';
  return fail(`Not enough room to save ${label}. Delete a save first.${biggest}`);
}

/** How long a restore may wait for the sim to answer before the attempt is given up. */
export const RESTORE_TIMEOUT_MS = 10_000;

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
  private readonly now: () => number;
  private readonly onAutosaved: (() => void) | null;
  private state: AutosaveState = { dirty: false, modalOpen: false, gestureActive: false, degradeLevel: 0 };
  private failures = 0;
  private retries = 0;
  private inFlight = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly loadedAtMs: number;
  private lastAutosaveMs: number | null = null;
  private lastSuspendMs: number | null = null;

  constructor(
    private readonly open: () => Promise<SaveService>,
    private readonly source: ChronicleSource,
    options: SaveControllerOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.onAutosaved = options.onAutosaved ?? null;
    this.loadedAtMs = this.now();
    // Autosave needs a capture. Without one the timer stays off rather than failing every interval.
    this.clock = new AutosaveClock(source.canCapture ? AUTOSAVE_INTERVAL_MS : 0);
  }

  private service(): Promise<SaveService> {
    this.store ??= this.open();
    return this.store;
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
    return this.service().then((svc) => svc.list());
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
      return fail(this.describe(err));
    }
  }

  /** Runs one action from the Chronicle window. `slotId` is 'new' for a save into the first free manual slot. */
  async perform(action: SaveAction, slotId: string): Promise<ActionOutcome> {
    try {
      switch (action) {
        case 'save':
          return await this.saveManual(slotId);
        case 'quick':
          return await this.saveQuick();
        case 'load':
          return await this.load(slotId);
        case 'delete':
          return await this.remove(slotId);
      }
    } catch (err) {
      return fail(this.describe(err));
    }
  }

  private async saveManual(slotId: string): Promise<ActionOutcome> {
    if (!this.source.canCapture) return fail(CANNOT_CAPTURE);
    const svc = await this.service();
    let n: number | null;
    if (slotId === 'new') {
      n = firstFreeManualSlot(await svc.list());
      if (n === null) return fail('All 12 manual slots are full. Delete a save first.');
    } else {
      n = Number(/^manual:(\d+)$/.exec(slotId)?.[1] ?? NaN);
      if (!Number.isInteger(n)) return fail('That slot does not exist.');
    }
    const captured = await this.source.capture();
    if (!captured) return fail(CANNOT_CAPTURE);
    return writeOutcome(await svc.writeManual(n, captured.bytes, captured.info, this.now()), `slot ${n}`);
  }

  private async saveQuick(): Promise<ActionOutcome> {
    if (!this.source.canCapture) return fail(CANNOT_CAPTURE);
    const captured = await this.source.capture();
    if (!captured) return fail(CANNOT_CAPTURE);
    const svc = await this.service();
    return writeOutcome(await svc.writeQuick(captured.bytes, captured.info, this.now()), 'the quick save');
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
    if (!this.source.canCapture) return;
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
    try {
      const captured = await this.source.capture();
      if (!captured) return;
      const result = await (await this.service()).writeAutosave(captured.bytes, captured.info, this.now());
      if (result.ok) {
        this.failures = 0;
        this.lastAutosaveMs = this.now();
        this.clock.markSaved();
        this.onAutosaved?.();
      } else {
        this.failures++;
      }
    } catch {
      this.failures++;
    } finally {
      this.inFlight = false;
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
    if (!this.source.canCapture) return;
    const nowMs = this.now();
    if (decideSuspend({ nowMs, lastSuspendMs: this.lastSuspendMs, lastAutosaveMs: this.lastAutosaveMs }) === 'skip') return;
    const captured = await this.source.capture();
    if (!captured) return;
    const result = await (await this.service()).writeSuspend(captured.bytes, captured.info, nowMs);
    if (result.ok) this.lastSuspendMs = nowMs;
  }

  private describe(err: unknown): string {
    if (err instanceof Error && err.name === 'SaveError') {
      if (/checksum/.test(err.message)) return 'That save is damaged and cannot be read.';
      return err.message;
    }
    return 'The save store could not be used on this device.';
  }
}
