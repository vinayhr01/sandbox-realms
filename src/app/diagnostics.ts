/**
 * Diagnostics bundle (17 section 9, "Diagnostics bundle"): the file the fatal dialog and the sim-stop dialog offer as
 * "Export diagnostics". It holds the app version and content hash, the device class (UA family, memory, cores, and the
 * GPU renderer string when the browser gives one), the quality level and degrade history, the last 500 warn-and-up log
 * lines, the realm's start condition, the perf summary, and the newest crash record (19 section 5).
 *
 * User-triggered only, never automatic. Export is not gated by consent: `privacy.errorReports` gates sending, and this
 * module never sends (19 section 9). Nothing here calls fetch, sendBeacon or any other network API. Every string goes
 * through scrubText (19 section 6) before it is written.
 *
 * Replay: 17 section 7.3 asks for the command log and the last autosave. The worker keeps a bounded ring of the player
 * commands of the realm (replay-ring.ts), stamped with the worker tick, outside the sim. The bundle has that ring with
 * the realm's seed and side, which reproduce the start of a Realm. `commandLog` is false when the worker did not answer
 * in time, so the commands are then missing. Free text in a command is renamed (19 section 6) before it is stored.
 */
import pkg from '../../package.json';
import { contentHash } from '../content/content-hash.ts';
import { deviceClass, listCrashRecords, scrubText, type CrashExport, type CrashRecord } from './crash-record.ts';
import { DIAGNOSTIC_LOG_LINES, recentLogLines } from './log-ring.ts';
import { perfSummary, type PerfSummary } from './perf-sample.ts';
import { JOURNAL_MAX, recentJournal } from './recovery.ts';
import { REPLAY_RING_MAX, type ReplayEntry } from '../shared/replay-ring.ts';
import type { ReplayRead } from './sim-client.ts';

const APP_VERSION: string = pkg.version;

/** Schema of the bundle file. Bump when the fields change. 2: replay.commands, replay.dropped, replay.ringMax. */
export const DIAGNOSTICS_SCHEMA = 2;
/** Longest GPU renderer string kept (the browser's own text, scrubbed). */
const GPU_MAX = 120;
/** Longest log line kept in the bundle (the same cap a crash record uses). */
const LOG_LINE_MAX = 320;
/** How long the export waits for the worker's replay ring. A worker that stopped answering must not hold the export. */
const REPLAY_READ_MS = 1_500;

/** What the page knows at export time and the bundle cannot read itself. */
export interface DiagnosticsSource {
  degradeLevel: number;
  degradedOff: readonly string[];
  renderScale: number;
  safeMode: boolean;
  /** The realm the page shows. Zero before a realm starts. */
  realmSeed: number;
  realmSide: number;
  /** Reads the worker's replay ring (17 section 7.3). May never settle if the worker is stuck; the export waits REPLAY_READ_MS at most. */
  readCommands: () => Promise<ReplayRead>;
}

export interface DiagnosticsBundle {
  schema: number;
  /** ISO time of the export. */
  exported: string;
  app: { version: string; contentHash: string };
  device: { uaFamily: string; memGB: number; cores: number; gpuRenderer: string | null };
  quality: {
    degradeLevel: number;
    degradedOff: string[];
    renderScale: number;
    safeMode: boolean;
    /** Degrade steps from the breadcrumb journal, oldest first (19 section 3, DEGRADE). */
    history: { at: string; detail: string }[];
  };
  /** The newest lines of the warn-and-up log, oldest first, scrubbed. */
  logs: string[];
  /**
   * Start condition of the realm and its player commands (17 section 7.3). `commands` is oldest first, each stamped with
   * the worker tick it was queued at. `dropped` counts older commands that the ring pushed out. `commandLog` is false
   * when the worker did not answer in time (then `commands` is empty).
   */
  replay: {
    seed: number;
    side: number;
    commandLog: boolean;
    commands: ReplayEntry[];
    dropped: number;
    ringMax: number;
  };
  /** Frame and sim timings, or null when nothing was sampled yet. */
  perf: PerfSummary | null;
  /** The newest stored crash record, or null when there is none. */
  crash: CrashRecord | null;
}

/**
 * The GPU renderer string from WEBGL_debug_renderer_info, or null when the browser withholds it or there is no WebGL.
 * A throwaway canvas is used so the game's own context is never touched. The probe context is released at once.
 */
export function gpuRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl: WebGLRenderingContextBase | null = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const value: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof value === 'string' && value !== '' ? scrubText(value, GPU_MAX) : null;
  } catch {
    return null;
  }
}

/** Resolves with the promise's value, or with null when it has not settled within `ms` or rejects. */
function within<T>(pending: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** Builds the bundle. Reads storage through the modules that already wrap it, so it does not throw on blocked storage. */
export async function buildDiagnostics(source: DiagnosticsSource, nowMs: number = Date.now()): Promise<DiagnosticsBundle> {
  const records = await listCrashRecords();
  const degradeSteps = recentJournal(JOURNAL_MAX).filter((e) => e.code === 'DEGRADE');
  const ring = await within(source.readCommands(), REPLAY_READ_MS);
  return {
    schema: DIAGNOSTICS_SCHEMA,
    exported: new Date(nowMs).toISOString(),
    app: { version: APP_VERSION, contentHash: contentHash() },
    device: { ...deviceClass(), gpuRenderer: gpuRenderer() },
    quality: {
      degradeLevel: source.degradeLevel,
      degradedOff: source.degradedOff.map((id) => scrubText(id, 40)),
      renderScale: source.renderScale,
      safeMode: source.safeMode,
      history: degradeSteps.map((e) => ({ at: e.at, detail: scrubText(e.detail, 160) })),
    },
    logs: recentLogLines(DIAGNOSTIC_LOG_LINES).map((line) => scrubText(line, LOG_LINE_MAX)),
    replay: {
      seed: source.realmSeed,
      side: source.realmSide,
      commandLog: ring !== null,
      commands: ring?.commands ?? [],
      dropped: ring?.dropped ?? 0,
      ringMax: REPLAY_RING_MAX,
    },
    perf: perfSummary() ?? null,
    crash: records[0] ?? null,
  };
}

/**
 * Builds the bundle file for a download. Nothing is sent: the caller downloads the bytes when the player asks.
 * Returns ok false with a message when the bundle cannot be built.
 */
export async function exportDiagnostics(source: DiagnosticsSource): Promise<CrashExport> {
  try {
    const bundle = await buildDiagnostics(source);
    const name = `sandbox-realms-diagnostics-${bundle.exported.replace(/[:.]/g, '-')}.json`;
    const body = JSON.stringify(bundle, null, 2);
    return { ok: true, message: `Exported ${name}. Nothing was sent.`, name, bytes: new TextEncoder().encode(body) };
  } catch {
    return { ok: false, message: 'The diagnostics could not be built on this device.' };
  }
}
