/**
 * Main <-> sim worker protocol (17 section 2.2). Numeric kinds, plain objects,
 * every command carries `seq`, every reply echoes it.
 */
export const PROTOCOL_VERSION = 3;

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
  SaveRealm = 10,
  LoadRealm = 11,
}

export enum Ev {
  Ready = 101,
  Frame = 102,
  QueryResult = 103,
  Fault = 104,
  Heartbeat = 105,
  Snapshot = 106,
  Saved = 107,
  Loaded = 108,
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
  | { kind: Cmd.Snapshot; seq: number }
  /** Encodes the live realm as a Chronicle save (src/sim/chronicle.ts). Replies with Ev.Saved. */
  | { kind: Cmd.SaveRealm; seq: number }
  /** Replaces the live realm with a decoded Chronicle save. Replies with Ev.Ready or Ev.Loaded. */
  | { kind: Cmd.LoadRealm; seq: number; bytes: Uint8Array };

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
  /**
   * Rows behind the culture and strain windows (13 section 7.1). Optional so older snapshot readers
   * keep working; buildSnapshot always fills it. Lists are capped at SNAPSHOT_DETAIL_ROWS each.
   */
  detail?: SnapshotDetail;
  /* windows-sim-data block: keep new fields of this window's data here, apart from other blocks. */
  /** Peace pacts between bordering dominions (pacts window). Optional: older readers ignore it. */
  pacts?: PactBlock;
  /** Id of the Age in effect (02 section 5). Optional: older snapshot readers ignore it. */
  age?: string;
  /** Tiles per biome id over the whole realm (src/content/biomes.ts). Biomes with no tiles are absent. */
  biomes?: Record<string, number>;
  /** Clans (kinbands window): counts and the capped rows, living clans first. Optional: older readers ignore it. */
  clans?: ClanBlock;
}

/** One clan (src/sim/clans). `chiefAgeYears` is -1 when the clan has no living member. */
export interface ClanRow {
  id: number;
  name: string;
  /** The strain whose living members make up the clan. */
  strain: number;
  strainName: string;
  species: string;
  foundedTick: number;
  members: number;
  limit: number;
  /** BeingRow id of the chief, or -1. */
  chief: number;
  chiefAgeYears: number;
  extinct: boolean;
}

/** Clans: `count` is every clan on record, `living` the ones with a member; `rows` is capped at SNAPSHOT_DETAIL_ROWS. */
export interface ClanBlock {
  count: number;
  living: number;
  rows: ClanRow[];
}

/**
 * One peace pact: two dominions that share a border and are at peace. The sim has no pact records
 * (10 section 12 is not built); the stats count the same pairs as pacts (src/sim/stats-hooks.ts).
 */
export interface PactRow {
  /** a * 256 + b for the lower dominion id a and the higher id b: stable while both dominions exist. */
  id: number;
  a: number;
  b: number;
  nameA: string;
  nameB: string;
  strengthA: number;
  strengthB: number;
  parcelsA: number;
  parcelsB: number;
}

/** Peace pacts: `count` is exact; `rows` is capped at SNAPSHOT_DETAIL_ROWS. */
export interface PactBlock {
  count: number;
  rows: PactRow[];
}

/** Row cap per list in SnapshotDetail; the totals in `counts` stay exact. */
export const SNAPSHOT_DETAIL_ROWS = 16;

export interface SnapshotDetail {
  /** Exact totals of each list, before the cap. */
  counts: { customs: number; creeds: number; dialects: number; families: number; intrigues: number; strains: number };
  /** `group` is a dominion or hamlet id (see Snapshot.dominions). Custom rows have no id: the index is the id. */
  customs: { group: number; traits: string[] }[];
  creeds: { id: number; holders: number[] }[];
  /** One row per group; groups with equal `word` speak one dialect. */
  dialects: { group: number; word: number }[];
  /** Family rows; the index is the id. */
  families: { child: number; parentA: number; parentB: number }[];
  intrigues: { id: number; kind: 'rebellion' | 'scheme'; group: number; progress: number; goal: number; outcome: 'success' | 'failure' | null }[];
  strains: StrainRow[];
  /**
   * Sample rows for the being, structure and realm windows (13 section 6). Optional: older readers
   * ignore it. Lists are capped at SNAPSHOT_DETAIL_ROWS; the counts stay exact.
   */
  notable?: NotableRows;
}

/** Oldest living beings and the buildings of every hamlet, capped; totals are exact. */
export interface NotableRows {
  beingCount: number;
  beings: BeingRow[];
  structureCount: number;
  structures: StructureRow[];
}

/** One living being. `id` names it while it lives: generation * MAX_BEINGS + slot. */
export interface BeingRow {
  id: number;
  species: string;
  folk: boolean;
  female: boolean;
  baby: boolean;
  /** Age in whole years (floor). */
  ageYears: number;
  vitality: number;
  maxVitality: number;
  /** Strain display name, or '' for none. */
  strain: string;
  children: number;
}

/** One hamlet building. `id` is y * 1024 + x (the tile), stable while the building stands. */
export interface StructureRow {
  id: number;
  /** Catalogue id (e.g. 'house'). */
  kind: string;
  name: string;
  /** Index of the hamlet in Snapshot.hamlets (the id of the hamlet window). */
  hamlet: number;
  x: number;
  y: number;
}

/** One strain (strains window). Trait names are display names from content/traits.ts. */
export interface StrainRow {
  id: number;
  name: string;
  species: string;
  generation: number;
  /** Parent strain id, or 0 for a founding strain. */
  parent: number;
  traits: string[];
  born: number;
  newAdults: number;
  reproduced: number;
}

export type Event =
  | { kind: Ev.Ready; reply: number; protocolVersion: number; side: number; sizeStep: number; seed: number }
  | { kind: Ev.Frame; rows: FrameRows | null; stats: FrameStats }
  | { kind: Ev.QueryResult; reply: number; tileX: number; tileY: number; elevation: number; ground: string; inBounds: boolean }
  | { kind: Ev.Fault; severity: 'warn' | 'error' | 'fatal'; code: string; detail: string }
  | { kind: Ev.Heartbeat; tick: number; avgTickMs: number }
  | { kind: Ev.Snapshot; snap: Snapshot }
  /** Reply to Cmd.SaveRealm. Empty bytes when there is no realm. */
  | { kind: Ev.Saved; reply: number; bytes: Uint8Array }
  /** Reply to a Cmd.LoadRealm that failed; ok is always false. */
  | { kind: Ev.Loaded; reply: number; ok: boolean; detail: string };
