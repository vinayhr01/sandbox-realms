/**
 * Main <-> sim worker protocol (17 section 2.2). Numeric kinds, plain objects,
 * every command carries `seq`, every reply echoes it.
 */
export const PROTOCOL_VERSION = 2;

/** Version of the Snapshot payload (Ev.Snapshot). Bump when a field changes meaning or shape. */
export const SNAPSHOT_VERSION = 1;

/** Largest Snapshot the worker posts, in bytes of its JSON form (the UI budget, 13 section 1). */
export const SNAPSHOT_MAX_BYTES = 32 * 1024;

export enum Cmd {
  Init = 1,
  NewRealm = 2,
  SetSpeed = 3,
  Stroke = 4,
  Query = 5,
  ReturnBuffer = 6,
  /** Applies one power from content/powers.ts at a tile (UI powers path). */
  Power = 7,
  /** Sets one Realm Rule (src/sim/rules.ts). */
  SetRule = 8,
  /** Asks for a Snapshot now, whatever the sim tick (windows open while paused). */
  Snapshot = 9,
}

export enum Ev {
  Ready = 101,
  Frame = 102,
  QueryResult = 103,
  Fault = 104,
  Heartbeat = 105,
  Snapshot = 106,
}

export type Speed = 0 | 0.5 | 1 | 2 | 5 | 10;

export type BrushOp = 'raise' | 'lower';
export type BrushShape = 'circle' | 'square' | 'diamond';

export type Command =
  | { kind: Cmd.Init; seq: number; protocolVersion: number }
  | { kind: Cmd.NewRealm; seq: number; seed: number; sizeStep: number; template: string }
  | { kind: Cmd.SetSpeed; seq: number; speed: Speed }
  /** Dabs along the line (x0,y0)->(x1,y1). includeStart=false skips the first tile, which an earlier segment already painted. */
  | { kind: Cmd.Stroke; seq: number; op: BrushOp; shape: BrushShape; size: number; x0: number; y0: number; x1: number; y1: number; includeStart: boolean }
  | { kind: Cmd.Query; seq: number; tileX: number; tileY: number }
  | { kind: Cmd.ReturnBuffer; seq: number; buffer: ArrayBuffer }
  | { kind: Cmd.Power; seq: number; powerId: string; x: number; y: number }
  | { kind: Cmd.SetRule; seq: number; rule: string; on: boolean }
  | { kind: Cmd.Snapshot; seq: number };

/** Rows of the index texture: RGBA8 per tile = [ground, cover, elevation, flags & 0xff]. */
export interface FrameRows {
  y0: number;
  y1: number;
  /** Packed RGBA rows y0..y1 inclusive, row-major. */
  data: Uint8Array;
}

export interface FrameStats {
  tick: number;
  avgTickMs: number;
  ticksThisPump: number;
  speed: Speed;
  stateHash: number;
}

/** One species with living members (population window). `folk` is true for the non-wild rows. */
export interface SpeciesRow {
  id: string;
  name: string;
  count: number;
  folk: boolean;
}

/** One dominion (dominions window). Relation counts are over the other dominions of the realm. */
export interface DominionRow {
  id: number;
  /** Display name derived from the id; dominions have no stored name yet. */
  name: string;
  parcels: number;
  strength: number;
  /** Pairs sharing a border with this dominion. */
  neighbours: number;
  peace: number;
  tension: number;
  war: number;
  /** True when any relation with another dominion is war. */
  atWar: boolean;
  /** Dominion id of the current campaign target, or -1. */
  campaignTarget: number;
}

/** One hamlet (hamlets window). */
export interface HamletRow {
  /** Display name derived from placement order; hamlets have no stored name yet. */
  name: string;
  folk: number;
  buildings: number;
  parcels: number;
}

/** One achievement: its current value against its target (achievements window). */
export interface AchievementRow {
  id: string;
  value: number;
  target: number;
  unlocked: boolean;
}

/**
 * Read-only view of the sim for the UI (13 section 1: the UI never reads sim memory). Built by
 * src/sim/snapshot.ts; posted every two sim-seconds and on Cmd.Snapshot. Plain data only.
 */
export interface Snapshot {
  v: number;
  tick: number;
  /** True when a list was cut to keep the message under SNAPSHOT_MAX_BYTES. */
  truncated: boolean;
  population: { total: number; folk: number; wild: number; species: SpeciesRow[] };
  /** Lifetime counters (14 section 3), keyed as in src/sim/stats.ts. */
  counters: Record<string, number>;
  /** Size of each lifetime set (agesReached, discoveries, ...). */
  sets: Record<string, number>;
  achievements: AchievementRow[];
  codex: { discoveries: number; traits: number; traitTotal: number; species: number; rosterTotal: number };
  dominions: DominionRow[];
  dominionCount: number;
  hamlets: HamletRow[];
  hamletCount: number;
  culture: {
    customs: number;
    creeds: number;
    creedHolders: number;
    /** Distinct dialect words among the groups (groups with equal words speak one dialect). */
    dialects: number;
    dialectGroups: number;
    intriguesActive: number;
    intriguesResolved: number;
    families: number;
  };
}

export type Event =
  | { kind: Ev.Ready; reply: number; protocolVersion: number; side: number; sizeStep: number; seed: number }
  | { kind: Ev.Frame; rows: FrameRows | null; stats: FrameStats }
  | { kind: Ev.QueryResult; reply: number; tileX: number; tileY: number; elevation: number; ground: string; inBounds: boolean }
  | { kind: Ev.Fault; severity: 'warn' | 'error' | 'fatal'; code: string; detail: string }
  | { kind: Ev.Heartbeat; tick: number; avgTickMs: number }
  | { kind: Ev.Snapshot; snap: Snapshot };
