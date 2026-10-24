/// <reference lib="webworker" />
/**
 * Simulation worker shell (17 section 1-3). Owns the Sim, runs the MessageChannel pump at
 * ~60 Hz, applies the fixed-step tick budget, and publishes dirty tile rows to the renderer
 * in transfer mode (Mode T; Mode S is a later optimisation, see DECISIONS.md).
 */
import { PROTOCOL_VERSION, Cmd, Ev, type Command, type Event, type FrameRows, type FrameStats, type Speed } from '../shared/protocol.ts';
import { DEFAULT_SIZE_STEP } from '../shared/constants.ts';
import type { Sim } from './sim.ts';
import { generateRealm } from './worldgen.ts';
import { planPump } from './scheduler.ts';
import { snapshotDue } from './snapshot.ts';

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
const bufferPool: ArrayBuffer[] = [];

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
  if (!sim) return;

  if (speed === 0) {
    sim.applyQueued();
    accMs = 0;
    ticksThisPump = 0;
  } else {
    const plan = planPump(accMs, elapsed, speed, Number.POSITIVE_INFINITY);
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
  publishFrame(false);
  if (snapshotDue(lastSnapshotTick, sim.tick)) publishSnapshot();
}

function handle(cmd: Command): void {
  switch (cmd.kind) {
    case Cmd.Init:
      post({ kind: Ev.Ready, reply: cmd.seq, protocolVersion: PROTOCOL_VERSION, side: 0, sizeStep: 0, seed: 0 });
      return;
    case Cmd.NewRealm: {
      const sizeStep = cmd.sizeStep || DEFAULT_SIZE_STEP;
      const built = generateRealm({ seed: cmd.seed, sizeStep, template: cmd.template });
      sim = built.sim;
      accMs = 0;
      lastPublishedTick = -1;
      lastSnapshotTick = -1;
      lastHash = sim.stateHash();
      post({
        kind: Ev.Ready,
        reply: cmd.seq,
        protocolVersion: PROTOCOL_VERSION,
        side: sim.realm.side,
        sizeStep,
        seed: sim.realm.seed,
      });
      publishFrame(true);
      publishSnapshot();
      return;
    }
    case Cmd.Snapshot:
      publishSnapshot();
      return;
    case Cmd.SetSpeed:
      speed = cmd.speed;
      return;
    case Cmd.Stroke:
    case Cmd.Power:
    case Cmd.SetRule:
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
    });
  }
};

/** MessageChannel ping-pong pump: avoids setTimeout's 4 ms clamp (17 section 3.1). */
const channel = new MessageChannel();
channel.port1.onmessage = () => {
  try {
    pump();
  } catch (err: unknown) {
    post({
      kind: Ev.Fault,
      severity: 'fatal',
      code: 'SIM_PUMP',
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  channel.port2.postMessage(0);
};
channel.port2.postMessage(0);

