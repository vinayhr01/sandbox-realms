/**
 * Crash records (19 sections 5, 6, 8, 9). A record is written on each fatal fault and on a worker
 * stall. It stays on this device: the IndexedDB database `sr-crash` keeps the newest 20, and a
 * localStorage summary (`sr-crash-lite`) is the fallback when IndexedDB does not answer in time.
 *
 * Consent (brief item 2, 19 section 9): `privacy.errorReports` decides whether a record may be
 * exported. This build has no crash endpoint (OPEN-19-1 unset), so there is no network send at all.
 * "Send" is replaced by a JSON file download, and the download happens only on an explicit player
 * action. Nothing in this module calls fetch, sendBeacon or any other network API.
 *
 * Storage access can throw (private windows, blocked site data), so every access is wrapped.
 */
import pkg from '../../package.json';
import { contentHash } from '../content/content-hash.ts';
import { fnv1a } from '../shared/rng.ts';
import { FAULT_SEVERITY, recentJournal, type FaultKind, type Severity } from './recovery.ts';

const APP_VERSION: string = pkg.version;

/** Schema of the record itself (not the Chronicle save schema). Bump when the fields change. */
export const CRASH_RECORD_SCHEMA = 1;
/** No crash endpoint exists in this build. Recorded here so the decision is visible in code. */
export const NETWORK_SEND_AVAILABLE = false;

const DB_NAME = 'sr-crash';
const DB_VERSION = 1;
const STORE = 'crashes';
const RING_MAX = 20;
const WRITE_BUDGET_MS = 300;
const LITE_KEY = 'sr-crash-lite';
const LITE_MAX = 5;
const RECORD_MAX_BYTES = 64 * 1024;
const CRUMBS_MAX = 20;
const FRAMES_MAX = 30;
const MSG_MAX = 300;
/** The same fingerprint is not written twice inside this window (an error inside a frame loop would flood the ring). */
const SAME_FP_MIN_MS = 2_000;

export interface CrashFrame {
  fn: string;
  /** Chunk name only, or `<ext>` for a file from another origin. */
  file: string;
  line: number;
  col: number;
}

export interface CrashCrumb {
  at: string;
  code: string;
  detail: string;
}

export interface CrashRecord {
  id: string;
  fp: string;
  kind: FaultKind;
  severity: Severity;
  ctx: 'main' | 'worker';
  /** Epoch milliseconds when the fault was recorded. */
  at: number;
  app: {
    version: string;
    /** Build identity. No git hash is injected into this build, so it is the content hash of the registries. */
    build: string;
    contentHash: string;
    schemaVersion: number;
  };
  env: { uaFamily: string; touch: boolean; dpr: number; online: boolean; cores: number; memGB: number };
  run: { uptimeMs: number; tick: number | null; speed: number | null; age: string | null; safeMode: boolean };
  err: { name: string; msg: string; frames: CrashFrame[] };
  crumbs: CrashCrumb[];
  /** The recovery step the ladder chose (19 section 7), or 'none'. */
  recovery: string;
}

export interface CrashInput {
  kind: FaultKind;
  ctx: 'main' | 'worker';
  message: string;
  stack?: string | undefined;
  recovery: string;
}

// ---------------------------------------------------------------------------
// Run state: the main thread keeps the latest tick, speed and Age for the next record.
// ---------------------------------------------------------------------------

interface CrashRun {
  startedMs: number;
  tick: number | null;
  speed: number | null;
  age: string | null;
  safeMode: boolean;
}

const run: CrashRun = { startedMs: Date.now(), tick: null, speed: null, age: null, safeMode: false };

export function noteCrashRun(update: Partial<Omit<CrashRun, 'startedMs'>>): void {
  Object.assign(run, update);
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

let consent = false;

/** Set from the `privacy.errorReports` option at boot and on every change. Off by default. */
export function setCrashConsent(allowed: boolean): void {
  consent = allowed;
}

export function crashConsent(): boolean {
  return consent;
}

// ---------------------------------------------------------------------------
// Scrubbing and fingerprint (19 section 6)
// ---------------------------------------------------------------------------

/** Removes URLs, paths, e-mail addresses, long tokens and long digit runs, then truncates. */
export function scrubText(input: string, max = MSG_MAX): string {
  return input
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>')
    .replace(/[A-Za-z]:\\[^\s"']*/g, '<path>')
    .replace(/(^|[\s(])\/[^\s"')]+\/[^\s"')]*/g, '$1<path>')
    .replace(/[A-Za-z0-9_-]{32,}/g, '<token>')
    .replace(/"[^"]*"/g, '""')
    .replace(/\d{5,}/g, 'N')
    .slice(0, max);
}

// Chrome puts "at fn (url:line:col)" or "at url:line:col"; Firefox and Safari put "fn@url:line:col".
const CHROME_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const GECKO_FRAME = /^(.*?)@(.+?):(\d+):(\d+)\s*$/;

/** The chunk name of an own file, or `<ext>` for anything from another origin. Query and hash are dropped. */
function chunkName(url: string, origin: string): string {
  if (!url.startsWith(origin)) return '<ext>';
  const path = (url.slice(origin.length).split(/[?#]/)[0] ?? '').replace(/^\/+/, '');
  return scrubText(path.split('/').pop() ?? '', 80);
}

export function parseFrames(stack: string | undefined, origin: string): CrashFrame[] {
  if (!stack) return [];
  const frames: CrashFrame[] = [];
  for (const raw of stack.split('\n')) {
    const m = CHROME_FRAME.exec(raw) ?? GECKO_FRAME.exec(raw);
    if (!m) continue;
    const url = m[2] ?? '';
    frames.push({
      fn: scrubText(m[1] ?? '', 80) || '<anonymous>',
      file: chunkName(url, origin),
      line: Number(m[3]),
      col: Number(m[4]),
    });
    if (frames.length >= FRAMES_MAX) break;
  }
  return frames;
}

/** Two FNV-1a passes with different seeds, 16 hex digits. Same kind, top frames and message shape give the same value. */
export function fingerprint(kind: string, msg: string, frames: readonly CrashFrame[]): string {
  const top = frames
    .slice(0, 3)
    .map((f) => `${f.fn}:${f.file}`)
    .join('|');
  const bytes = new TextEncoder().encode(`${kind}|${top}|${msg.replace(/\d+/g, 'N')}`);
  return fnv1a(bytes).toString(16).padStart(8, '0') + fnv1a(bytes, 0x9e3779b9).toString(16).padStart(8, '0');
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function uaFamily(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'other';
}

function errorName(message: string): string {
  return /^([A-Za-z]*Error)\b/.exec(message)?.[1] ?? 'Error';
}

/** Builds a scrubbed record. Over the 64 KB cap, breadcrumbs and then frames are dropped first. */
export function buildRecord(input: CrashInput, nowMs: number = Date.now()): CrashRecord {
  const origin = location.origin;
  const msg = scrubText(input.message);
  const frames = parseFrames(input.stack, origin);
  const build = contentHash();
  const nav = navigator;
  let crumbs: CrashCrumb[] = recentJournal(CRUMBS_MAX).map((e) => ({ at: e.at, code: scrubText(e.code, 40), detail: scrubText(e.detail, 120) }));
  let kept = frames;
  const make = (): CrashRecord => ({
    id: randomId(),
    fp: fingerprint(input.kind, msg, kept),
    kind: input.kind,
    severity: FAULT_SEVERITY[input.kind],
    ctx: input.ctx,
    at: nowMs,
    app: { version: APP_VERSION, build, contentHash: build, schemaVersion: CRASH_RECORD_SCHEMA },
    env: {
      uaFamily: uaFamily(nav.userAgent),
      touch: nav.maxTouchPoints > 0,
      dpr: window.devicePixelRatio,
      online: nav.onLine,
      cores: nav.hardwareConcurrency ?? 0,
      memGB: (nav as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
    },
    run: { uptimeMs: Math.max(0, nowMs - run.startedMs), tick: run.tick, speed: run.speed, age: run.age, safeMode: run.safeMode },
    err: { name: errorName(msg), msg, frames: kept },
    crumbs,
    recovery: input.recovery,
  });
  let record = make();
  while (JSON.stringify(record).length > RECORD_MAX_BYTES && (crumbs.length > 0 || kept.length > 10)) {
    if (crumbs.length > 0) crumbs = crumbs.slice(1);
    else kept = kept.slice(0, 10);
    record = make();
  }
  return record;
}

// ---------------------------------------------------------------------------
// Storage: IndexedDB ring, localStorage lite fallback, in-memory copy
// ---------------------------------------------------------------------------

/** Records from this page, kept even when IndexedDB and localStorage both fail. Newest last. */
const memory: CrashRecord[] = [];
const lastWriteByFp = new Map<string, number>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('at', 'at');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('open failed'));
    req.onblocked = () => reject(new Error('open blocked'));
  });
}

/** One transaction: put the record, then delete the oldest beyond the ring size. */
async function writeIdb(rec: CrashRecord): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(rec);
      const keys = store.index('at').getAllKeys();
      keys.onsuccess = () => {
        const extra = keys.result.length - RING_MAX;
        for (let i = 0; i < extra; i++) store.delete(keys.result[i] as IDBValidKey);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('write aborted'));
    });
  } finally {
    db.close();
  }
}

async function readIdb(): Promise<CrashRecord[]> {
  const db = await openDb();
  try {
    return await new Promise<CrashRecord[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('at').getAll();
      req.onsuccess = () => resolve((req.result as CrashRecord[]).slice().reverse());
      req.onerror = () => reject(req.error ?? new Error('read failed'));
    });
  } finally {
    db.close();
  }
}

/** Resolves true when the write finished inside the budget (19 section 8: 300 ms on fatal paths). */
function withBudget(work: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

interface LiteEntry {
  id: string;
  kind: string;
  fp: string;
  ts: number;
  version: string;
}

/** The fallback summary (19 section 8): the last five records, id and kind only. */
function writeLite(rec: CrashRecord): void {
  try {
    const raw = localStorage.getItem(LITE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const list: LiteEntry[] = Array.isArray(parsed) ? (parsed as LiteEntry[]) : [];
    list.push({ id: rec.id, kind: rec.kind, fp: rec.fp, ts: rec.at, version: rec.app.version });
    localStorage.setItem(LITE_KEY, JSON.stringify(list.slice(-LITE_MAX)));
  } catch {
    // Storage blocked: the in-memory copy is the last place left.
  }
}

/**
 * Writes one record. Never throws and never blocks the caller for long: the caller should not
 * await it on a fatal path. Returns the stored record, or null when it was skipped as a repeat.
 */
export async function recordCrash(input: CrashInput): Promise<CrashRecord | null> {
  try {
    const rec = buildRecord(input);
    const now = Date.now();
    const last = lastWriteByFp.get(rec.fp);
    if (last !== undefined && now - last < SAME_FP_MIN_MS) return null;
    lastWriteByFp.set(rec.fp, now);
    memory.push(rec);
    if (memory.length > RING_MAX) memory.splice(0, memory.length - RING_MAX);
    const stored = await withBudget(writeIdb(rec), WRITE_BUDGET_MS);
    if (!stored) writeLite(rec);
    return rec;
  } catch {
    return null;
  }
}

/** Stored records, newest first: IndexedDB plus any from this page that did not reach it. */
export async function listCrashRecords(): Promise<CrashRecord[]> {
  let stored: CrashRecord[] = [];
  try {
    stored = await readIdb();
  } catch {
    stored = [];
  }
  const ids = new Set(stored.map((r) => r.id));
  const extra = memory.filter((r) => !ids.has(r.id));
  return [...stored, ...extra].sort((a, b) => b.at - a.at);
}

// ---------------------------------------------------------------------------
// Export (the send replacement)
// ---------------------------------------------------------------------------

export interface CrashExport {
  ok: boolean;
  message: string;
  name?: string;
  bytes?: Uint8Array;
}

/**
 * Builds the JSON file for one record (the newest when no id is given). Refused unless
 * `privacy.errorReports` is on. The caller downloads the bytes; nothing is uploaded.
 */
export async function exportCrashRecord(id?: string): Promise<CrashExport> {
  if (!consent) {
    return { ok: false, message: 'Crash records stay on this device. Turn on "Send error reports" in Privacy to export one.' };
  }
  const records = await listCrashRecords();
  const chosen = id === undefined ? records.slice(0, 1) : records.filter((r) => r.id === id);
  if (chosen.length === 0) return { ok: false, message: 'No crash record is stored on this device.' };
  const exported = new Date().toISOString();
  const body = JSON.stringify({ schema: CRASH_RECORD_SCHEMA, exported, network: NETWORK_SEND_AVAILABLE, records: chosen }, null, 2);
  const name = `sandbox-realms-crash-${exported.replace(/[:.]/g, '-')}.json`;
  return { ok: true, message: `Exported ${name}. Nothing was sent.`, name, bytes: new TextEncoder().encode(body) };
}
