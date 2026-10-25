/**
 * Crash records (19 sections 5, 6, 8, 9). A record is written on each fatal fault and on a worker
 * stall. It stays on this device: the IndexedDB database `sr-crash` keeps the newest 20, and a
 * localStorage summary (`sr-crash-lite`) is the fallback when IndexedDB does not answer in time.
 *
 * Consent (19 section 9): `privacy.errorReports` is a three-way choice, `ask`, `always` or `never`; Do Not Track
 * or Global Privacy Control force `never`. Consent gates sending only. Export (19 section 8) is not gated:
 * the file is downloaded on an explicit player action and stays on the device until the player shares it.
 * This build has no crash endpoint (OPEN-19-1 unset), so nothing is sent. Records that would have been
 * sent wait in the unsent queue (max 20). Nothing in this module calls fetch, sendBeacon or any other
 * network API.
 *
 * Storage access can throw (private windows, blocked site data), so every access is wrapped.
 */
import pkg from '../../package.json';
import { contentHash } from '../content/content-hash.ts';
import { fnv1a } from '../shared/rng.ts';
import { FAULT_SEVERITY, recentJournal, type FaultKind, type Severity } from './recovery.ts';
import { CRASH_LOG_LINES, logLine, recentLogLines, type LogLevel } from './log-ring.ts';
import { perfSummary, type PerfSummary } from './perf-sample.ts';

const APP_VERSION: string = pkg.version;

/** Schema of the record itself (not the Chronicle save schema). Bump when the fields change. 2: logs, perf, sys, recovery list. */
export const CRASH_RECORD_SCHEMA = 2;
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
/** Breadcrumb ring size (19 section 3). */
const CRUMBS_MAX = 50;
const FRAMES_MAX = 30;
const MSG_MAX = 300;
/** The same fingerprint is not written twice inside this window (an error inside a frame loop would flood the ring). */
const SAME_FP_MIN_MS = 2_000;
/** A simulation part counts its faults over this window for the `sys` block (19 section 5). */
const SYS_WINDOW_MS = 10_000;

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
  /** Warn-and-up lines, oldest first, collapsed repeats, scrubbed (19 section 5: last 200). */
  logs: string[];
  /** Frame and sim timings near the fault. Absent before anything was sampled. */
  perf?: PerfSummary;
  /** The simulation part that faulted. `disabled` is true while the worker has the part switched off (17 section 9). */
  sys?: { id: string; errorCount: number; disabled: boolean };
  /** The steps taken, in order: the emergency save result, then the ladder step (19 section 5, section 7). */
  recovery: string[];
}

export interface CrashInput {
  kind: FaultKind;
  ctx: 'main' | 'worker';
  message: string;
  stack?: string | undefined;
  /** Steps taken so far, in order (see CrashRecord.recovery). */
  recovery: string[];
  /** The simulation part that faulted, when the fault names one (for example 'pump'). */
  sys?: string | undefined;
  /** True when the worker has that part switched off after this fault (Fault.sysOff; 17 section 9). */
  sysOff?: boolean | undefined;
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

/**
 * ask: a preview before anything leaves the device (the default).
 * always: sends without asking (the player chose it in Settings > Privacy).
 * never: nothing is queued or sent. Also forced by Do Not Track or Global Privacy Control.
 */
export type ConsentMode = 'ask' | 'always' | 'never';

export interface ConsentInput {
  /** The player's choice from `privacy.errorReports`. */
  choice: ConsentMode;
  dnt: boolean;
  gpc: boolean;
}

/** Pure: DNT or GPC forces `never`; otherwise the player's choice stands. */
export function resolveConsentMode(input: ConsentInput): ConsentMode {
  if (input.dnt || input.gpc) return 'never';
  return input.choice;
}

/** Reads the `privacy.errorReports` value. Anything unknown counts as the default, `ask`. */
export function consentFromOption(value: string): ConsentMode {
  return value === 'always' || value === 'never' ? value : 'ask';
}

let choice: ConsentMode = 'ask';

/** Set from the `privacy.errorReports` option at boot and on every change. Defaults to `ask`. */
export function setCrashConsent(next: ConsentMode): void {
  choice = next;
}

/** The browser's privacy signals. Any access that throws counts as not set. */
function privacySignals(): { dnt: boolean; gpc: boolean } {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    const values: unknown[] = [navigator.doNotTrack, (window as Window & { doNotTrack?: string }).doNotTrack];
    return { dnt: values.some((v) => v === '1' || v === 'yes'), gpc: nav.globalPrivacyControl === true };
  } catch {
    return { dnt: false, gpc: false };
  }
}

/** The consent mode in force now (19 section 9). */
export function crashMode(): ConsentMode {
  const signals = privacySignals();
  return resolveConsentMode({ choice, dnt: signals.dnt, gpc: signals.gpc });
}

// ---------------------------------------------------------------------------
// Scrubbing and fingerprint (19 section 6)
// ---------------------------------------------------------------------------

/** Removes URLs, paths, e-mail addresses, long tokens and long digit runs, then truncates. */
export function scrubText(input: string, max = MSG_MAX): string {
  return input
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>')
    .replace(/[A-Za-z]:\\[^"'\r\n]*/g, '<path>')
    .replace(/(^|[\s(])\/[^\s"')]+\/[^\s"')]*/g, '$1<path>')
    .replace(/\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?\b/gi, '<host>')
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

/** Counts of recent faults per simulation part, newest last (19 section 5, `sys`). */
const sysFaults = new Map<string, number[]>();

/** Notes one fault in a simulation part and returns how many it has had inside SYS_WINDOW_MS, this one included. */
export function noteSysFault(id: string, nowMs: number): number {
  const recent = [...(sysFaults.get(id) ?? []).filter((t) => nowMs - t < SYS_WINDOW_MS && t <= nowMs), nowMs];
  sysFaults.set(id, recent);
  return recent.length;
}

/**
 * Builds a scrubbed record. Over the 64 KB cap, the oldest log lines go first, then the oldest breadcrumbs,
 * then frames beyond the first ten (19 section 5).
 */
export function buildRecord(input: CrashInput, nowMs: number = Date.now()): CrashRecord {
  const origin = location.origin;
  const msg = scrubText(input.message);
  const frames = parseFrames(input.stack, origin);
  const build = contentHash();
  const nav = navigator;
  let crumbs: CrashCrumb[] = recentJournal(CRUMBS_MAX).map((e) => ({ at: e.at, code: scrubText(e.code, 40), detail: scrubText(e.detail, 120) }));
  let logs: string[] = recentLogLines(CRASH_LOG_LINES).map((line) => scrubText(line, 320));
  let kept = frames;
  const perf = perfSummary();
  const sys = input.sys === undefined ? undefined : { id: scrubText(input.sys, 40), errorCount: noteSysFault(input.sys, nowMs), disabled: input.sysOff === true };
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
    logs,
    ...(perf === undefined ? {} : { perf }),
    ...(sys === undefined ? {} : { sys }),
    recovery: input.recovery.map((step) => scrubText(step, 60)),
  });
  let record = make();
  while (JSON.stringify(record).length > RECORD_MAX_BYTES && (logs.length > 0 || crumbs.length > 0 || kept.length > 10)) {
    if (logs.length > 0) logs = logs.slice(1);
    else if (crumbs.length > 0) crumbs = crumbs.slice(1);
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
    // Every record also goes into the warn-and-up log, so the next record's logs show it (19 section 3).
    logLine(logLevelOf(FAULT_SEVERITY[input.kind]), `${input.kind}: ${input.message}`);
    const rec = buildRecord(input);
    const now = Date.now();
    const last = lastWriteByFp.get(rec.fp);
    if (last !== undefined && now - last < SAME_FP_MIN_MS) return null;
    lastWriteByFp.set(rec.fp, now);
    memory.push(rec);
    if (memory.length > RING_MAX) memory.splice(0, memory.length - RING_MAX);
    if (crashMode() !== 'never') enqueueUnsent(rec);
    const stored = await withBudget(writeIdb(rec), WRITE_BUDGET_MS);
    if (!stored) writeLite(rec);
    return rec;
  } catch {
    return null;
  }
}

function logLevelOf(severity: Severity): LogLevel {
  return severity === 'fatal' ? 'fatal' : severity === 'error' ? 'error' : 'warn';
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
// Unsent queue and rate limits (19 section 9)
// ---------------------------------------------------------------------------

/** Sends one record. Resolves true when the endpoint accepted it. No transport exists in this build. */
export type SendTransport = (rec: CrashRecord) => Promise<boolean>;

/** At most this many sends per session, and one per fingerprint per day (19 section 9). */
export const SEND_PER_SESSION_MAX = 3;
export const SEND_PER_FINGERPRINT_MS = 24 * 60 * 60_000;
/** The unsent queue keeps the newest this many; the oldest are dropped. */
export const UNSENT_MAX = 20;
const UNSENT_KEY = 'sr-crash-unsent';

interface UnsentEntry {
  id: string;
  fp: string;
  at: number;
}

/** What has been sent in this session: the count and the last send time per fingerprint. */
export interface SendLedger {
  sent: number;
  lastByFp: Map<string, number>;
}

const ledger: SendLedger = { sent: 0, lastByFp: new Map() };

/** Pure: true when the session cap and the per-fingerprint daily limit both allow another send. */
export function sendAllowed(fp: string, ledgerNow: SendLedger, nowMs: number): boolean {
  if (ledgerNow.sent >= SEND_PER_SESSION_MAX) return false;
  const last = ledgerNow.lastByFp.get(fp);
  return last === undefined || nowMs - last >= SEND_PER_FINGERPRINT_MS;
}

function readUnsent(): UnsentEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(UNSENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as UnsentEntry[]) : [];
  } catch {
    return [];
  }
}

function writeUnsent(list: readonly UnsentEntry[]): void {
  try {
    localStorage.setItem(UNSENT_KEY, JSON.stringify(list.slice(-UNSENT_MAX)));
  } catch {
    // Storage blocked: the queue lasts only as long as the page does, and the records stay in memory.
  }
}

/** Queues a record for sending. Only the id, fingerprint and time are kept, never the record itself. */
export function enqueueUnsent(rec: CrashRecord): void {
  writeUnsent([...readUnsent(), { id: rec.id, fp: rec.fp, at: rec.at }]);
}

export function unsentCount(): number {
  return readUnsent().length;
}

/**
 * Sends queued records, oldest first, that the limits allow. Returns how many were sent. A null
 * transport sends nothing and keeps the queue (this build). Failed sends stay queued.
 */
export async function flushUnsent(transport: SendTransport | null, nowMs: number = Date.now()): Promise<number> {
  if (transport === null) return 0;
  const records = await listCrashRecords();
  let sent = 0;
  const kept: UnsentEntry[] = [];
  for (const entry of readUnsent()) {
    const rec = records.find((r) => r.id === entry.id);
    if (rec === undefined || !sendAllowed(rec.fp, ledger, nowMs)) {
      kept.push(entry);
      continue;
    }
    const ok = await transport(rec).catch(() => false);
    if (ok) {
      ledger.sent++;
      ledger.lastByFp.set(rec.fp, nowMs);
      sent++;
    } else {
      kept.push(entry);
    }
  }
  writeUnsent(kept);
  return sent;
}

// ---------------------------------------------------------------------------
// First-fatal explanation (19 section 9)
// ---------------------------------------------------------------------------

const EXPLAINED_KEY = 'sr-crash-explained';
let explainedThisPage = false;

const FIRST_FATAL_NOTE: Readonly<Record<ConsentMode, string>> = {
  ask: 'Crash reports stay on this device. Nothing is sent. You can export this one from this dialog or from Help.',
  always: 'Crash reports are set to send automatically under Privacy. This build has no report server, so nothing is sent and this one stays on this device.',
  never: 'Crash reports stay on this device because Do Not Track or Global Privacy Control is on. Nothing is sent. You can export this one.',
};

/** The one-time explanation of the consent choice for the first fatal dialog. Null once it has been shown. */
export function firstFatalNote(mode: ConsentMode = crashMode()): string | null {
  if (explainedThisPage) return null;
  explainedThisPage = true;
  try {
    if (localStorage.getItem(EXPLAINED_KEY) === '1') return null;
    localStorage.setItem(EXPLAINED_KEY, '1');
  } catch {
    // Storage blocked: the note is shown once per page load instead.
  }
  return FIRST_FATAL_NOTE[mode];
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
 * Builds the JSON file for one record (the newest when no id is given). Not gated by consent
 * (19 section 8): the file is only downloaded on the player's action and nothing is uploaded.
 */
export async function exportCrashRecord(id?: string): Promise<CrashExport> {
  const records = await listCrashRecords();
  const chosen = id === undefined ? records.slice(0, 1) : records.filter((r) => r.id === id);
  if (chosen.length === 0) return { ok: false, message: 'No crash record is stored on this device.' };
  const exported = new Date().toISOString();
  const body = JSON.stringify(
    { schema: CRASH_RECORD_SCHEMA, exported, network: NETWORK_SEND_AVAILABLE, consentMode: crashMode(), records: chosen },
    null,
    2,
  );
  const name = `sandbox-realms-crash-${exported.replace(/[:.]/g, '-')}.json`;
  return { ok: true, message: `Exported ${name}. Nothing was sent.`, name, bytes: new TextEncoder().encode(body) };
}
