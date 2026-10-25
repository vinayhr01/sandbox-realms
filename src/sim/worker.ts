/// <reference lib="webworker" />
/**
 * Simulation worker shell (17 section 1-3). Owns the Sim, runs the MessageChannel pump at
 * ~60 Hz, applies the fixed-step tick budget, and publishes dirty tile rows to the renderer
 * in transfer mode (Mode T; Mode S is a later optimisation, see DECISIONS.md).
 */
import { PROTOCOL_VERSION, Cmd, Ev, type Command, type Event, type FrameRows, type FrameStats, type Speed } from '../shared/protocol.ts';
import type { Sim } from './sim.ts';
import { startGenerateJob, type GenOutcome, type WorldgenJob } from './worldgen.ts';
import { heartbeatDue, mainPingLost, planPump, pumpFaultAction } from './scheduler.ts';
import { snapshotDue } from './snapshot.ts';
import { decodeChronicle, encodeChronicle, MAX_SIZE_STEP, MIN_SIZE_STEP } from './chronicle.ts';
import { contentHash } from '../content/content-hash.ts';

/** Sim time budget per pump in ms (17 section 3.1; 8 ms desktop, 6 ms phones TUNE). Desktop default. */
const FRAME_BUDGET_MS = 8;
/** Stats are published at most this often even if nothing changes (ms). */
const HASH_EVERY_TICKS = 20;

let sim: Sim | null = null;
let speed: Speed = 1;
let accMs = 0;
let lastWall = performance.now();
let avgTickMs = 0;
let ticksThisPump = 0;
let lastHash = 0;
let lastPublishedTick = -1;
let lastSnapshotTick = -1;
/** Tick of the last Heartbeat posted (-1 before the first one for a realm) and pumps since then. */
let lastHeartbeatTick = -1;
let pumpsSinceHeartbeat = 0;
/** Page liveness (19 section 2, main_hang): performance.now() of the last Cmd.Ping, whether the page was hidden then,
 * and whether this silence has already been reported (one report per silence). */
let lastPingAt: number | null = null;
let pingHidden = false;
let mainHangReported = false;
const bufferPool: ArrayBuffer[] = [];

/** Worldgen slice budget per pump, ms (03 section 10: slices of at most 12 ms). */
const JOB_SLICE_MS = 12;
/** What a generation job needs to be rebuilt: the request. */
interface JobRequest {
  seed: number | string;
  sizeStep: number;
  template: string;
}
interface PendingJob {
  gen: WorldgenJob;
  request: JobRequest;
  /** NewRealm seq for the Ready reply; 0 for a job resumed after a reload. */
  seq: number;
  resumed: boolean;
  lastPct: number;
}
/** The generation job in progress, if any. The previous realm stays frozen until it finishes. */
let job: PendingJob | null = null;

/**
 * Starts a generation job. Generation is deterministic, so the checkpoint is only the request: a
 * reload rebuilds the same realm by running the job again (the progress events start from 0).
 */
function startJob(request: JobRequest, seq: number, resumed: boolean): void {
  job = { gen: startGenerateJob(request), request, seq, resumed, lastPct: -1 };
  accMs = 0;
  void writeCheckpoint(request);
}

/** Runs the job for up to JOB_SLICE_MS, posting progress whenever the whole-percent figure moves. */
function runJobSlice(): void {
  const current = job;
  if (!current) return;
  const started = performance.now();
  for (;;) {
    const step = current.gen.next();
    if (step.done) {
      finishJob(step.value);
      return;
    }
    const p = step.value;
    const pct = Math.floor(p.progress * 100);
    if (pct !== current.lastPct) {
      current.lastPct = pct;
      post({ kind: Ev.WorldgenProgress, reply: current.seq, stage: p.stage, name: p.name, progress: p.progress, attempt: p.attempt, resumed: current.resumed });
    }
    if (performance.now() - started >= JOB_SLICE_MS) return;
  }
}

/** Installs a finished job as the live realm and publishes it as NewRealm always did. */
function finishJob(done: GenOutcome): void {
  const finished = job;
  if (!finished) return;
  job = null;
  sim = done.sim;
  accMs = 0;
  lastPublishedTick = -1;
  lastSnapshotTick = -1;
  lastHeartbeatTick = -1;
  pumpsSinceHeartbeat = 0;
  lastHash = sim.stateHash();
  void writeCheckpoint(null);
  post({
    kind: Ev.Ready,
    reply: finished.seq,
    protocolVersion: PROTOCOL_VERSION,
    side: sim.realm.side,
    sizeStep: finished.request.sizeStep,
    seed: sim.realm.seed,
    contentHash: contentHash(),
  });
  publishFrame(true);
  publishSnapshot();
}

/* Checkpoint store (IndexedDB is reachable from workers; a blocked store only disables resume). */
const DB_NAME = 'sandbox-realms-worldgen';
const STORE = 'jobs';
const KEY = 'pending';

function openJobStore(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Stores the request of the job in progress, or clears it when `request` is null. */
async function writeCheckpoint(request: JobRequest | null): Promise<void> {
  const db = await openJobStore();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (request) tx.objectStore(STORE).put(request, KEY);
      else tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Storage may be blocked (private windows): the job still runs, it just cannot resume after a reload.
  } finally {
    db.close();
  }
}

async function readCheckpoint(): Promise<JobRequest | null> {
  const db = await openJobStore();
  if (!db) return null;
  try {
    return await new Promise<JobRequest | null>((resolve, reject) => {
      const get = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      get.onsuccess = () => resolve((get.result as JobRequest | undefined) ?? null);
      get.onerror = () => reject(get.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

const post = (event: Event, transfer: Transferable[] = []): void => {
  self.postMessage(event, transfer);
};

function publishFrame(force: boolean): void {
  if (!sim) return;
  const realm = sim.realm;
  const range = realm.takeDirtyRows();
  if (!range && !force && sim.tick === lastPublishedTick) return;
  lastPublishedTick = sim.tick;
  let rows: FrameRows | null = null;
  const transfer: Transferable[] = [];
  if (range) {
    const rowCount = range.y1 - range.y0 + 1;
    const bytes = rowCount * realm.side * 4;
    const buffer = takeBuffer(bytes);
    const out = new Uint8Array(buffer, 0, bytes);
    let o = 0;
    for (let y = range.y0; y <= range.y1; y++) {
      const row = y * realm.side;
      for (let x = 0; x < realm.side; x++) {
        const i = row + x;
        out[o++] = realm.ground[i] ?? 0;
        out[o++] = realm.cover[i] ?? 0;
        out[o++] = realm.elevation[i] ?? 0;
        out[o++] = (realm.flags[i] ?? 0) & 0xff;
      }
    }
    rows = { y0: range.y0, y1: range.y1, data: out };
    transfer.push(buffer);
  }
  const stats: FrameStats = {
    tick: sim.tick,
    avgTickMs,
    ticksThisPump,
    speed,
    stateHash: lastHash,
  };
  post({ kind: Ev.Frame, rows, stats }, transfer);
}

/** Posts a read-only snapshot of the sim for the UI windows (src/sim/snapshot.ts). */
function publishSnapshot(): void {
  if (!sim) return;
  lastSnapshotTick = sim.tick;
  post({ kind: Ev.Snapshot, snap: sim.snapshot() });
}

/** Reuses a pooled buffer that is large enough, otherwise allocates a fresh one. */
function takeBuffer(bytes: number): ArrayBuffer {
  for (let k = 0; k < bufferPool.length; k++) {
    const candidate = bufferPool[k];
    if (candidate && candidate.byteLength >= bytes) {
      bufferPool.splice(k, 1);
      return candidate;
    }
  }
  return new ArrayBuffer(bytes);
}

function pump(): void {
  const wall = performance.now();
  const elapsed = wall - lastWall;
  lastWall = wall;
  checkMainPings(wall);
  if (job) {
    runJobSlice();
    return;
  }
  if (!sim) return;

  if (speed === 0) {
    sim.applyQueued();
    accMs = 0;
    ticksThisPump = 0;
  } else {
    const plan = planPump(accMs, elapsed, speed);
    accMs = plan.accMs;
    const start = performance.now();
    let ran = 0;
    for (let k = 0; k < plan.ticks; k++) {
      if (performance.now() - start > FRAME_BUDGET_MS) break;
      const t0 = performance.now();
      sim.step();
      const dt = performance.now() - t0;
      avgTickMs = avgTickMs === 0 ? dt : avgTickMs * 0.9 + dt * 0.1;
      ran++;
      if (sim.tick % HASH_EVERY_TICKS === 0) lastHash = sim.stateHash();
    }
    // Ticks not run inside the budget are discarded: the world runs slower instead (17 section 3.1).
    ticksThisPump = ran;
  }
  for (const detail of sim.takeRefusals()) post({ kind: Ev.Fault, severity: 'warn', code: 'COMMAND_REFUSED', detail });
  publishFrame(false);
  if (snapshotDue(lastSnapshotTick, sim.tick)) publishSnapshot();
  pumpsSinceHeartbeat++;
  if (heartbeatDue(sim.tick, lastHeartbeatTick, pumpsSinceHeartbeat)) {
    lastHeartbeatTick = sim.tick;
    pumpsSinceHeartbeat = 0;
    post({ kind: Ev.Heartbeat, tick: sim.tick, avgTickMs });
  }
}

/**
 * Judges the page from its pings (19 section 2, main_hang). Posted as a Fault when the page wakes, because a frozen
 * page cannot draw the overlay itself; the queued Fault arrives first.
 */
function checkMainPings(now: number): void {
  if (mainHangReported || !mainPingLost(lastPingAt, now, pingHidden)) return;
  mainHangReported = true;
  post({ kind: Ev.Fault, severity: 'error', code: 'MAIN_HANG', detail: 'the page sent no ping for 8 s', sys: 'ping' });
}

function handle(cmd: Command): void {
  switch (cmd.kind) {
    case Cmd.Init:
      if (cmd.protocolVersion !== PROTOCOL_VERSION) {
        post({
          kind: Ev.Fault,
          severity: 'fatal',
          code: 'PROTOCOL_MISMATCH',
          detail: `worker speaks protocol ${PROTOCOL_VERSION}, client sent ${cmd.protocolVersion}`,
        });
        return;
      }
      post({ kind: Ev.Ready, reply: cmd.seq, protocolVersion: PROTOCOL_VERSION, side: 0, sizeStep: 0, seed: 0, contentHash: contentHash() });
      // A generation job cut short by a reload is started again from its stored request (replay).
      void readCheckpoint().then((request) => {
        if (!request || job || sim) return;
        if (!Number.isInteger(request.sizeStep) || request.sizeStep < MIN_SIZE_STEP || request.sizeStep > MAX_SIZE_STEP) return;
        startJob(request, 0, true);
      });
      return;
    case Cmd.NewRealm: {
      const sizeStep = cmd.sizeStep;
      if (!Number.isInteger(sizeStep) || sizeStep < MIN_SIZE_STEP || sizeStep > MAX_SIZE_STEP) {
        post({ kind: Ev.Fault, severity: 'error', code: 'BAD_SIZE', detail: `size step ${sizeStep} is outside ${MIN_SIZE_STEP}..${MAX_SIZE_STEP}` });
        return;
      }
      // The job replies with Ready when it finishes (03 section 10); the old realm stays until then.
      startJob({ seed: cmd.seed, sizeStep, template: cmd.template }, cmd.seq, false);
      return;
    }
    case Cmd.SaveRealm: {
      const bytes = (sim ? encodeChronicle(sim) : new Uint8Array(0)).slice();
      post({ kind: Ev.Saved, reply: cmd.seq, bytes }, [bytes.buffer]);
      return;
    }
    case Cmd.LoadRealm:
      // A loaded save supersedes any generation job, including one resumed after a reload.
      job = null;
      void writeCheckpoint(null);
      try {
        sim = decodeChronicle(cmd.bytes);
        accMs = 0;
        lastPublishedTick = -1;
        lastSnapshotTick = -1;
        lastHeartbeatTick = -1;
        pumpsSinceHeartbeat = 0;
        lastHash = sim.stateHash();
        post({
          kind: Ev.Ready,
          reply: cmd.seq,
          protocolVersion: PROTOCOL_VERSION,
          side: sim.realm.side,
          sizeStep: sim.realm.sizeStep,
          seed: sim.realm.seed,
          contentHash: contentHash(),
        });
        publishFrame(true);
      } catch (error) {
        post({ kind: Ev.Loaded, reply: cmd.seq, ok: false, detail: error instanceof Error ? error.message : 'unreadable save' });
      }
      return;
    case Cmd.Snapshot:
      publishSnapshot();
      return;
    case Cmd.SetSpeed:
      speed = cmd.speed;
      return;
    case Cmd.Stroke:
    case Cmd.Power:
    case Cmd.SetRule:
    case Cmd.SetGear:
    case Cmd.SetItemRain:
    case Cmd.ItemRain:
    case Cmd.SetItemFavourite:
      sim?.enqueue(cmd);
      return;
    case Cmd.Query: {
      const info = sim?.tileInfo(cmd.tileX, cmd.tileY) ?? null;
      post({
        kind: Ev.QueryResult,
        reply: cmd.seq,
        tileX: cmd.tileX,
        tileY: cmd.tileY,
        elevation: info?.elevation ?? 0,
        ground: info?.ground ?? '',
        inBounds: info !== null,
      });
      return;
    }
    case Cmd.ReturnBuffer:
      if (bufferPool.length < 4) bufferPool.push(cmd.buffer);
      return;
    case Cmd.Ping:
      lastPingAt = performance.now();
      pingHidden = cmd.hidden;
      mainHangReported = false;
      post({ kind: Ev.Pong, reply: cmd.seq });
      return;
  }
}

self.onmessage = (event: MessageEvent<Command>) => {
  try {
    handle(event.data);
  } catch (err: unknown) {
    post({
      kind: Ev.Fault,
      severity: 'error',
      code: 'SIM_COMMAND',
      detail: err instanceof Error ? err.message : String(err),
      sys: 'command',
    });
  }
};

/** MessageChannel ping-pong pump: avoids setTimeout's 4 ms clamp (17 section 3.1). */
const channel = new MessageChannel();
/** Pump throws in a row; reset by every pump that completes. */
let pumpFaults = 0;
channel.port1.onmessage = () => {
  try {
    pump();
    pumpFaults = 0;
  } catch (err: unknown) {
    pumpFaults++;
    const fatal = pumpFaultAction(pumpFaults) === 'fatal';
    post({
      kind: Ev.Fault,
      severity: fatal ? 'fatal' : 'error',
      code: 'SIM_PUMP',
      detail: err instanceof Error ? err.message : String(err),
      sys: 'pump',
    });
    // A single fault keeps the pump running (the world must not stop until reload); repeats end it.
    if (fatal) return;
  }
  channel.port2.postMessage(0);
};
channel.port2.postMessage(0);

