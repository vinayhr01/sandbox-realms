/**
 * Save store, slot model, autosave policy, quota planning and import/export naming
 * (15-chronicle-saves sections 4, 5, 7, 11). The Chronicle bytes are produced in the sim worker by
 * `encodeChronicle` in src/sim/chronicle.ts; this module only stores, lists, times and names them.
 *
 * Deviations from the spec, on purpose: the codec writes raw 'SRCH' bytes with a trailing FNV-1a
 * checksum (no gzip, no SHA-256), so slots record that FNV-1a sum and imports sniff the 'SRCH' magic.
 * The codec format is not changed. Thumbnails and the quarantine store are not implemented yet.
 *
 * Pure helpers come first and need no IndexedDB, so they test in Node. The IndexedDB backend and
 * the in-memory fallback implement the same `SaveBackend` interface. Nothing here touches the DOM
 * or the sim, so this module stays out of the main chunk until the UI imports it.
 */

/** Database name and version (15 section 4). Bump only for structural changes. */
export const DB_NAME = 'sandbox-realms';
export const DB_VERSION = 1;

/** Slot counts (15 section 4, TUNE). */
export const MANUAL_SLOT_COUNT = 12;
export const AUTOSAVE_RING = 5;
export const QUICK_SLOT_ID = 'quick';
export const SUSPEND_SLOT_ID = 'suspend';

/** Autosave timing (15 section 5, TUNE). Times count unpaused play, not wall time. */
export const AUTOSAVE_INTERVAL_MS = 5 * 60_000;
export const AUTOSAVE_RETRY_MS = 10_000;
export const AUTOSAVE_MAX_RETRIES = 6;
export const AUTOSAVE_FAILURE_LIMIT = 3;
export const AUTOSAVE_LOAD_GRACE_MS = 120_000;
/** Autosave is skipped while the sim is at degradation level 3 or worse (17). */
export const AUTOSAVE_DEGRADE_SKIP_LEVEL = 3;

/** Suspend save throttle (15 section 5). */
export const SUSPEND_THROTTLE_MS = 30_000;

/** Size caps (15 sections 4 and 7). */
const MB = 1024 * 1024;
export const MAX_CHRONICLE_BYTES = 12 * MB;
const DESKTOP_CAP_FRACTION = 0.25;
const DESKTOP_CAP_MAX_BYTES = 400 * MB;
const PHONE_CAP_FRACTION = 0.2;
const PHONE_CAP_MAX_BYTES = 150 * MB;

/** First four bytes of every Chronicle written by src/sim/chronicle.ts ('SRCH'). */
const CHRONICLE_MAGIC = [0x53, 0x52, 0x43, 0x48];
const MIN_CHRONICLE_BYTES = 20;

export type SlotKind = 'manual' | 'quick' | 'auto' | 'suspend';

/** Metadata the UI shows for a save. The Chronicle header is not parsed here; callers pass it in. */
export interface SlotInfo {
  realmName: string;
  tick: number;
  year: number;
}

export interface SlotMeta extends SlotInfo {
  slotId: string;
  kind: SlotKind;
  /** Autosave sequence number; null for the other kinds. */
  seq: number | null;
  byteSize: number;
  /** FNV-1a of the Chronicle bytes, used to detect a damaged blob on read. */
  checksum: number;
  savedAtMs: number;
  /** false after a failed load; 'unknown' until the blob has been loaded once. */
  valid: boolean | 'unknown';
}

export type SaveErrorCode = 'invalid_slot' | 'too_large' | 'corrupt' | 'not_found' | 'unavailable' | 'blocked' | 'timeout' | 'private' | 'quota' | 'storage';

export class SaveError extends Error {
  constructor(
    readonly code: SaveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

// ---------------------------------------------------------------------------
// Slot naming and selection
// ---------------------------------------------------------------------------

/** Slot id for manual slot n (1..12). */
export function manualSlotId(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MANUAL_SLOT_COUNT) {
    throw new SaveError('invalid_slot', `manual slot ${n} is outside 1..${MANUAL_SLOT_COUNT}`);
  }
  return `manual:${n}`;
}

/** Slot id for autosave sequence number seq (1 or more). */
export function autosaveSlotId(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new SaveError('invalid_slot', `autosave seq ${seq} must be a positive integer`);
  return `auto:${seq}`;
}

/** Reads a slot id back into its kind and autosave sequence. Returns null for an unknown id. */
export function parseSlotId(slotId: string): { kind: SlotKind; seq: number | null } | null {
  if (slotId === QUICK_SLOT_ID) return { kind: 'quick', seq: null };
  if (slotId === SUSPEND_SLOT_ID) return { kind: 'suspend', seq: null };
  const manual = /^manual:(\d+)$/.exec(slotId);
  if (manual) {
    const n = Number(manual[1]);
    return n >= 1 && n <= MANUAL_SLOT_COUNT ? { kind: 'manual', seq: null } : null;
  }
  const auto = /^auto:(\d+)$/.exec(slotId);
  if (auto) {
    const seq = Number(auto[1]);
    return seq >= 1 ? { kind: 'auto', seq } : null;
  }
  return null;
}

/** The next autosave sequence number: one above the highest existing, so ids never repeat. */
export function nextAutosaveSeq(metas: readonly SlotMeta[]): number {
  let max = 0;
  for (const m of metas) if (m.kind === 'auto' && m.seq !== null && m.seq > max) max = m.seq;
  return max + 1;
}

/** Autosave ids to delete so that only the newest `keep` remain (oldest by seq go first). */
export function autosavesToPrune(metas: readonly SlotMeta[], keep: number = AUTOSAVE_RING): string[] {
  const autos = metas.filter((m) => m.kind === 'auto').sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
  return autos.slice(Math.max(0, keep)).map((m) => m.slotId);
}

/** Save list order for the UI: newest first, ties broken by the higher autosave seq. */
export function orderForList(metas: readonly SlotMeta[]): SlotMeta[] {
  return [...metas].sort((a, b) => b.savedAtMs - a.savedAtMs || (b.seq ?? 0) - (a.seq ?? 0) || a.slotId.localeCompare(b.slotId));
}

/** The first manual slot with no save in it, or null when all twelve are used. */
export function firstFreeManualSlot(metas: readonly SlotMeta[]): number | null {
  const used = new Set(metas.filter((m) => m.kind === 'manual').map((m) => m.slotId));
  for (let n = 1; n <= MANUAL_SLOT_COUNT; n++) if (!used.has(manualSlotId(n))) return n;
  return null;
}

/** The largest slots, for the "refused, free some space" message. */
export function biggestSlots(metas: readonly SlotMeta[], count = 3): string[] {
  return [...metas]
    .sort((a, b) => b.byteSize - a.byteSize || a.slotId.localeCompare(b.slotId))
    .slice(0, count)
    .map((m) => m.slotId);
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

/** Soft cap for all Chronicles together (15 section 4). */
export function softCapBytes(quota: number, isPhone: boolean): number {
  if (!Number.isFinite(quota) || quota <= 0) return Number.POSITIVE_INFINITY;
  return isPhone
    ? Math.min(PHONE_CAP_FRACTION * quota, PHONE_CAP_MAX_BYTES)
    : Math.min(DESKTOP_CAP_FRACTION * quota, DESKTOP_CAP_MAX_BYTES);
}

export type QuotaPlan =
  | { ok: true; drop: string[] }
  | { ok: false; needBytes: number; biggest: string[] };

/**
 * Decides whether a write fits under the soft cap. When it does not, the oldest autosaves are
 * dropped first. If that is still not enough the write is refused and the biggest slots are named.
 * The slot being replaced does not count, because its old blob moves to `prev` in the same write.
 */
export function planQuota(input: {
  metas: readonly SlotMeta[];
  replacingId: string | null;
  incomingBytes: number;
  softCap: number;
}): QuotaPlan {
  const kept = input.metas.filter((m) => m.slotId !== input.replacingId);
  let total = kept.reduce((sum, m) => sum + m.byteSize, 0) + input.incomingBytes;
  if (total <= input.softCap) return { ok: true, drop: [] };

  const drop: string[] = [];
  const oldestAutos = kept.filter((m) => m.kind === 'auto').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const m of oldestAutos) {
    drop.push(m.slotId);
    total -= m.byteSize;
    if (total <= input.softCap) return { ok: true, drop };
  }
  return { ok: false, needBytes: total - input.softCap, biggest: biggestSlots(input.metas) };
}

// ---------------------------------------------------------------------------
// Autosave policy
// ---------------------------------------------------------------------------

/**
 * Counts unpaused play time and says when an autosave is due. Interval 0 turns autosave off.
 * Call `advance` each frame with the frame delta; call `markSaved` after a successful save.
 */
export class AutosaveClock {
  private accumulatedMs = 0;
  private intervalMs: number;

  constructor(intervalMs: number = AUTOSAVE_INTERVAL_MS) {
    this.intervalMs = Math.max(0, intervalMs);
  }

  get enabled(): boolean {
    return this.intervalMs > 0;
  }

  /** Changes the interval in ms (0 turns autosave off). */
  setInterval(intervalMs: number): void {
    this.intervalMs = Math.max(0, intervalMs);
    if (!this.enabled) this.accumulatedMs = 0;
  }

  /** Adds unpaused time and returns true when an autosave is due. */
  advance(deltaMs: number, paused: boolean): boolean {
    if (!this.enabled || paused || !Number.isFinite(deltaMs) || deltaMs <= 0) return false;
    this.accumulatedMs += deltaMs;
    return this.accumulatedMs >= this.intervalMs;
  }

  /** Resets the timer after a successful autosave. */
  markSaved(): void {
    this.accumulatedMs = 0;
  }

  /** Unpaused play time since the last autosave, in ms. */
  get pendingMs(): number {
    return this.accumulatedMs;
  }
}

export interface AutosaveContext {
  /** Any command applied or any year boundary passed since the last successful save. */
  dirty: boolean;
  /** A save is already being written. */
  inFlight: boolean;
  /** A modal window is open. */
  modalOpen: boolean;
  /** A brush stroke or drag is in progress. */
  gestureActive: boolean;
  /** Milliseconds since the last load. */
  msSinceLoad: number;
  /** Current 17 degradation level (0 = full). */
  degradeLevel: number;
  /** Autosave failures in a row. */
  consecutiveFailures: number;
  /** Retries already spent on this autosave cycle. */
  retries: number;
}

export type AutosaveDecision =
  | { action: 'save' }
  | { action: 'retry'; delayMs: number }
  | { action: 'skip'; reason: 'unchanged' | 'degraded' | 'busy_too_long' | 'disabled_after_failures' };

/** Decides what an autosave cycle does now (15 section 5 skip rules). */
export function decideAutosave(c: AutosaveContext): AutosaveDecision {
  if (c.consecutiveFailures >= AUTOSAVE_FAILURE_LIMIT) return { action: 'skip', reason: 'disabled_after_failures' };
  if (!c.dirty) return { action: 'skip', reason: 'unchanged' };
  if (c.degradeLevel >= AUTOSAVE_DEGRADE_SKIP_LEVEL) return { action: 'skip', reason: 'degraded' };
  const busy = c.inFlight || c.modalOpen || c.gestureActive || c.msSinceLoad < AUTOSAVE_LOAD_GRACE_MS;
  if (!busy) return { action: 'save' };
  if (c.retries >= AUTOSAVE_MAX_RETRIES) return { action: 'skip', reason: 'busy_too_long' };
  return { action: 'retry', delayMs: AUTOSAVE_RETRY_MS };
}

/**
 * Suspend saves run on hide and on pagehide. They are throttled to one per 30 s and skipped when
 * an autosave ran in the last 30 s, because that autosave already holds the same state.
 */
export function decideSuspend(input: { nowMs: number; lastSuspendMs: number | null; lastAutosaveMs: number | null }): 'write' | 'skip' {
  if (input.lastSuspendMs !== null && input.nowMs - input.lastSuspendMs < SUSPEND_THROTTLE_MS) return 'skip';
  if (input.lastAutosaveMs !== null && input.nowMs - input.lastAutosaveMs < SUSPEND_THROTTLE_MS) return 'skip';
  return 'write';
}

// ---------------------------------------------------------------------------
// Import and export
// ---------------------------------------------------------------------------

/** True when the bytes start with the Chronicle magic. This is a sniff only, not validation. */
export function looksLikeChronicle(bytes: Uint8Array): boolean {
  if (bytes.length < MIN_CHRONICLE_BYTES) return false;
  return CHRONICLE_MAGIC.every((b, i) => bytes[i] === b);
}

export type ImportCheck = { ok: true; byteSize: number } | { ok: false; reason: 'empty' | 'too_large' | 'not_a_chronicle' };

/**
 * Cheap checks run before a file is handed to the sim worker for full validation. The full decode
 * (codec checksum, schema, sizes) happens in the worker, never on the main thread.
 */
export function checkImport(bytes: Uint8Array): ImportCheck {
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > MAX_CHRONICLE_BYTES) return { ok: false, reason: 'too_large' };
  if (!looksLikeChronicle(bytes)) return { ok: false, reason: 'not_a_chronicle' };
  return { ok: true, byteSize: bytes.length };
}

/**
 * File name for an export: `<slug>-<year>.realm`. The slug is lowercase [a-z0-9-], at most 40
 * characters, and falls back to "realm" when nothing is left. Accents are folded to ASCII.
 */
export function exportFileName(realmName: string, year: number): string {
  const slug = realmName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const base = slug.length > 0 ? slug : 'realm';
  return `${base}-${Math.max(0, Math.floor(year))}.realm`;
}

export type ExportRoute = 'share' | 'save_picker' | 'download';

/** Delivery order for an export file (15 section 11). */
export function chooseExportRoute(caps: { touch: boolean; canShareFiles: boolean; hasSaveFilePicker: boolean }): ExportRoute {
  if (caps.touch && caps.canShareFiles) return 'share';
  if (caps.hasSaveFilePicker) return 'save_picker';
  return 'download';
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/** FNV-1a over bytes. Same algorithm as the codec trailer. Kept local so the main chunk does not import the sim. */
export function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

export type SaveBackendMode = 'indexeddb' | 'memory';

/** Storage facade. Every write is atomic: the new blob and metadata commit together, or nothing changes. */
export interface SaveBackend {
  readonly mode: SaveBackendMode;
  /** True once the connection was closed under us (another tab upgraded the database); the store must be reopened. */
  readonly stale?: boolean;
  list(): Promise<SlotMeta[]>;
  /** Writes a slot. The previous blob of the same slot moves to `prev`. `prune` ids are deleted in the same commit. */
  write(slotId: string, bytes: Uint8Array, meta: SlotMeta, prune: readonly string[]): Promise<void>;
  read(slotId: string): Promise<Uint8Array | null>;
  readPrev(slotId: string): Promise<Uint8Array | null>;
  setValid(slotId: string, valid: boolean): Promise<void>;
  delete(slotId: string): Promise<void>;
  close(): void;
}

interface BlobRow {
  slotId: string;
  bytes: ArrayBuffer;
  checksum: number;
  byteSize: number;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** How long the database open may take before saving reports a problem instead of waiting. */
export const DB_OPEN_TIMEOUT_MS = 5_000;

/** Turns whatever IndexedDB threw into a SaveError with a code the UI can explain. */
export function classifyStorageError(err: unknown): SaveError | null {
  if (err instanceof SaveError) return err;
  const name = err instanceof Error ? err.name : '';
  const text = err instanceof Error ? err.message : '';
  if (name === 'QuotaExceededError' || /quota/i.test(text)) return new SaveError('quota', text || 'storage is full');
  if (name === 'SecurityError') return new SaveError('private', text || 'storage is blocked by the browser');
  // A closing or dropped connection, or an engine fault: worth another try, not a private-mode verdict.
  if (name === 'InvalidStateError' || name === 'UnknownError' || name === 'NotAllowedError' || name === 'TransactionInactiveError') {
    return new SaveError('storage', text || 'storage error');
  }
  return null;
}

/** Opens (and upgrades) the save database. Rejects when storage is blocked, unavailable or too slow. */
export function openSaveDatabase(factory: IDBFactory, name: string = DB_NAME, timeoutMs: number = DB_OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (err: SaveError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, DB_VERSION);
    } catch (err) {
      fail(classifyStorageError(err) ?? new SaveError('unavailable', 'IndexedDB open failed'));
      return;
    }
    timer = setTimeout(() => fail(new SaveError('timeout', 'IndexedDB open timed out')), timeoutMs);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'slotId' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'slotId' });
      if (!db.objectStoreNames.contains('prev')) db.createObjectStore('prev', { keyPath: 'slotId' });
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        // The open finished after we gave up (the other tab let go): do not keep the connection.
        db.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      // A newer build in another tab wants to upgrade: let go so it is not blocked by this one.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => fail(classifyStorageError(req.error) ?? new SaveError('unavailable', req.error?.message || 'IndexedDB open failed'));
    req.onblocked = () => fail(new SaveError('blocked', 'IndexedDB open blocked'));
  });
}

class IndexedDbBackend implements SaveBackend {
  readonly mode = 'indexeddb' as const;

  stale = false;

  constructor(private readonly db: IDBDatabase) {
    db.onversionchange = () => {
      this.stale = true;
      db.close();
    };
    db.onclose = () => {
      this.stale = true;
    };
  }

  list(): Promise<SlotMeta[]> {
    const tx = this.db.transaction('slots', 'readonly');
    return requestToPromise(tx.objectStore('slots').getAll());
  }

  async write(slotId: string, bytes: Uint8Array, meta: SlotMeta, prune: readonly string[]): Promise<void> {
    const row: BlobRow = { slotId, bytes: bytes.slice().buffer as ArrayBuffer, checksum: meta.checksum, byteSize: bytes.byteLength };
    const tx = this.db.transaction(['slots', 'blobs', 'prev'], 'readwrite');
    const slots = tx.objectStore('slots');
    const blobs = tx.objectStore('blobs');
    const prev = tx.objectStore('prev');
    // The old blob is read and rewritten inside the same transaction; no delete-then-write.
    const old = blobs.get(slotId);
    old.onsuccess = () => {
      const previous = old.result as BlobRow | undefined;
      if (previous) prev.put(previous);
      blobs.put(row);
      slots.put(meta);
      for (const id of prune) {
        slots.delete(id);
        blobs.delete(id);
        prev.delete(id);
      }
    };
    await transactionDone(tx);
  }

  async read(slotId: string): Promise<Uint8Array | null> {
    const tx = this.db.transaction('blobs', 'readonly');
    const row = (await requestToPromise(tx.objectStore('blobs').get(slotId))) as BlobRow | undefined;
    return rowBytes(row, slotId);
  }

  async readPrev(slotId: string): Promise<Uint8Array | null> {
    const tx = this.db.transaction('prev', 'readonly');
    const row = (await requestToPromise(tx.objectStore('prev').get(slotId))) as BlobRow | undefined;
    return rowBytes(row, slotId);
  }

  async setValid(slotId: string, valid: boolean): Promise<void> {
    const tx = this.db.transaction('slots', 'readwrite');
    const store = tx.objectStore('slots');
    const get = store.get(slotId);
    get.onsuccess = () => {
      const meta = get.result as SlotMeta | undefined;
      if (meta) store.put({ ...meta, valid });
    };
    await transactionDone(tx);
  }

  async delete(slotId: string): Promise<void> {
    const tx = this.db.transaction(['slots', 'blobs', 'prev'], 'readwrite');
    tx.objectStore('slots').delete(slotId);
    tx.objectStore('blobs').delete(slotId);
    tx.objectStore('prev').delete(slotId);
    await transactionDone(tx);
  }

  close(): void {
    this.db.close();
  }
}

/** Checks a stored blob against its checksum. A mismatch means the stored bytes were damaged. */
function rowBytes(row: BlobRow | undefined, slotId: string): Uint8Array | null {
  if (!row) return null;
  const bytes = new Uint8Array(row.bytes);
  if (bytes.byteLength !== row.byteSize || fnv1a32(bytes) !== row.checksum) {
    throw new SaveError('corrupt', `save ${slotId} failed its checksum`);
  }
  return bytes;
}

/** Same contract as the IndexedDB backend, held in RAM. Used when storage is blocked (15 section 4). */
class MemoryBackend implements SaveBackend {
  readonly mode = 'memory' as const;
  private readonly metas = new Map<string, SlotMeta>();
  private readonly blobs = new Map<string, BlobRow>();
  private readonly prevs = new Map<string, BlobRow>();

  async list(): Promise<SlotMeta[]> {
    return [...this.metas.values()].map((m) => ({ ...m }));
  }

  async write(slotId: string, bytes: Uint8Array, meta: SlotMeta, prune: readonly string[]): Promise<void> {
    const old = this.blobs.get(slotId);
    if (old) this.prevs.set(slotId, old);
    this.blobs.set(slotId, { slotId, bytes: bytes.slice().buffer as ArrayBuffer, checksum: meta.checksum, byteSize: bytes.byteLength });
    this.metas.set(slotId, { ...meta });
    for (const id of prune) {
      this.metas.delete(id);
      this.blobs.delete(id);
      this.prevs.delete(id);
    }
  }

  async read(slotId: string): Promise<Uint8Array | null> {
    return rowBytes(this.blobs.get(slotId), slotId);
  }

  async readPrev(slotId: string): Promise<Uint8Array | null> {
    return rowBytes(this.prevs.get(slotId), slotId);
  }

  async setValid(slotId: string, valid: boolean): Promise<void> {
    const meta = this.metas.get(slotId);
    if (meta) this.metas.set(slotId, { ...meta, valid });
  }

  async delete(slotId: string): Promise<void> {
    this.metas.delete(slotId);
    this.blobs.delete(slotId);
    this.prevs.delete(slotId);
  }

  close(): void {
    // Nothing to release.
  }
}

/**
 * Opens IndexedDB when it works and falls back to memory-only mode otherwise. `fallbackReason` is
 * the message to show in the banner ("saving to this device is unavailable").
 */
export async function openSaveBackend(
  factory: IDBFactory | undefined,
  openTimeoutMs: number = DB_OPEN_TIMEOUT_MS,
): Promise<{ backend: SaveBackend; fallbackReason: string | null; fallbackCode: SaveErrorCode | null }> {
  if (!factory) return { backend: new MemoryBackend(), fallbackReason: 'IndexedDB is not available in this browser', fallbackCode: 'unavailable' };
  try {
    const db = await openSaveDatabase(factory, DB_NAME, openTimeoutMs);
    return { backend: new IndexedDbBackend(db), fallbackReason: null, fallbackCode: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'IndexedDB failed to open';
    return { backend: new MemoryBackend(), fallbackReason: reason, fallbackCode: err instanceof SaveError ? err.code : 'unavailable' };
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SaveEnvironment {
  /** True on phones and tablets (the smaller soft cap applies). */
  isPhone: boolean;
  /** navigator.storage, when present. Its estimate() feeds the quota plan. */
  storage?: Pick<StorageManager, 'estimate'>;
  /** Overrides DB_OPEN_TIMEOUT_MS (tests). */
  openTimeoutMs?: number;
}

export type SaveResult =
  | { ok: true; meta: SlotMeta; pruned: string[] }
  | { ok: false; reason: 'over_soft_cap'; needBytes: number; biggest: string[] };

/**
 * The API the UI calls. The sim worker produces the Chronicle bytes (encodeChronicle); the UI passes
 * them here with the realm name, tick and year. Every write goes through the quota plan first.
 */
export class SaveService {
  private lastAutosaveMs: number | null = null;
  private lastSuspendMs: number | null = null;

  private constructor(
    private readonly backend: SaveBackend,
    readonly fallbackReason: string | null,
    private readonly env: SaveEnvironment,
    /** Why IndexedDB was not used: 'blocked' and 'timeout' can clear by themselves, so callers may reopen. */
    readonly fallbackCode: SaveErrorCode | null = null,
  ) {}

  /** Opens the store. Never rejects: on failure it falls back to memory-only mode. */
  static async open(factory: IDBFactory | undefined, env: SaveEnvironment): Promise<SaveService> {
    const { backend, fallbackReason, fallbackCode } = await openSaveBackend(factory, env.openTimeoutMs);
    return new SaveService(backend, fallbackReason, env, fallbackCode);
  }

  get mode(): SaveBackendMode {
    return this.backend.mode;
  }

  /** True when the database connection was closed by the browser or another tab: open the store again. */
  get stale(): boolean {
    return this.backend.stale === true;
  }

  /** Slot list for the UI, newest first. */
  async list(): Promise<SlotMeta[]> {
    return orderForList(await this.backend.list());
  }

  /** Writes a manual slot (1..12). Replacing a slot keeps its previous blob as the undo generation. */
  writeManual(n: number, bytes: Uint8Array, info: SlotInfo, nowMs: number): Promise<SaveResult> {
    return this.write(manualSlotId(n), 'manual', null, bytes, info, nowMs, []);
  }

  /** Writes the quick slot. */
  writeQuick(bytes: Uint8Array, info: SlotInfo, nowMs: number): Promise<SaveResult> {
    return this.write(QUICK_SLOT_ID, 'quick', null, bytes, info, nowMs, []);
  }

  /** Writes the suspend slot. Callers check decideSuspend first. */
  async writeSuspend(bytes: Uint8Array, info: SlotInfo, nowMs: number): Promise<SaveResult> {
    const result = await this.write(SUSPEND_SLOT_ID, 'suspend', null, bytes, info, nowMs, []);
    if (result.ok) this.lastSuspendMs = nowMs;
    return result;
  }

  /** Writes a new autosave and prunes the ring to `keep` (the Settings value; default AUTOSAVE_RING) in the same commit. */
  async writeAutosave(bytes: Uint8Array, info: SlotInfo, nowMs: number, keep: number = AUTOSAVE_RING): Promise<SaveResult> {
    const metas = await this.backend.list();
    const seq = nextAutosaveSeq(metas);
    // The new autosave takes one place in the ring, so keep one fewer of the existing ones.
    const prune = autosavesToPrune(metas, Math.max(1, Math.floor(keep)) - 1);
    const result = await this.write(autosaveSlotId(seq), 'auto', seq, bytes, info, nowMs, prune);
    if (result.ok) this.lastAutosaveMs = nowMs;
    return result;
  }

  /** Reads a slot's Chronicle bytes. Throws SaveError 'corrupt' (and marks the slot invalid) on a checksum failure. */
  async read(slotId: string): Promise<Uint8Array | null> {
    try {
      return await this.backend.read(slotId);
    } catch (err) {
      if (err instanceof SaveError && err.code === 'corrupt') await this.backend.setValid(slotId, false);
      throw err;
    }
  }

  /** Reads the previous generation of a slot (one level of undo). */
  readPrev(slotId: string): Promise<Uint8Array | null> {
    return this.backend.readPrev(slotId);
  }

  /** Deletes a slot. The UI must confirm first; this does not ask. */
  delete(slotId: string): Promise<void> {
    return this.backend.delete(slotId);
  }

  /** Checks a file chosen by the player or dropped on the page, before the worker validates it. */
  checkImport(bytes: Uint8Array): ImportCheck {
    return checkImport(bytes);
  }

  close(): void {
    this.backend.close();
  }

  private async write(
    slotId: string,
    kind: SlotKind,
    seq: number | null,
    bytes: Uint8Array,
    info: SlotInfo,
    nowMs: number,
    prune: readonly string[],
  ): Promise<SaveResult> {
    if (bytes.byteLength > MAX_CHRONICLE_BYTES) throw new SaveError('too_large', `Chronicle is ${bytes.byteLength} bytes, over the ${MAX_CHRONICLE_BYTES} cap`);
    const metas = await this.backend.list();
    const plan = planQuota({
      metas,
      replacingId: slotId,
      incomingBytes: bytes.byteLength,
      softCap: await this.softCap(),
    });
    if (!plan.ok) return { ok: false, reason: 'over_soft_cap', needBytes: plan.needBytes, biggest: plan.biggest };

    const meta: SlotMeta = {
      slotId,
      kind,
      seq,
      realmName: info.realmName.slice(0, 80),
      tick: info.tick,
      year: info.year,
      byteSize: bytes.byteLength,
      checksum: fnv1a32(bytes),
      savedAtMs: nowMs,
      valid: 'unknown',
    };
    const pruneAll = [...new Set([...plan.drop, ...prune])].filter((id) => id !== slotId);
    await this.backend.write(slotId, bytes, meta, pruneAll);
    return { ok: true, meta, pruned: pruneAll };
  }

  private async softCap(): Promise<number> {
    const estimate = await settleEstimate(this.env.storage);
    const quota = estimate?.quota;
    return quota === undefined ? Number.POSITIVE_INFINITY : softCapBytes(quota, this.env.isPhone);
  }
}

/** navigator.storage.estimate(), but a rejection, a throw or a hang (2 s) means "no limit known" rather than a stuck save. */
async function settleEstimate(storage: SaveEnvironment['storage']): Promise<StorageEstimate | undefined> {
  if (!storage) return undefined;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), 2_000);
    });
    return await Promise.race([storage.estimate().catch(() => undefined), timeout]).finally(() => clearTimeout(timer));
  } catch {
    return undefined;
  }
}
