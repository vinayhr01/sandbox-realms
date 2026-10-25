/**
 * Main <-> sim worker protocol (17 section 2.2). Numeric kinds, plain objects,
 * every command carries `seq`, every reply echoes it.
 */
import type { ReplayEntry } from './replay-ring.ts';

export const PROTOCOL_VERSION = 3;

/** Version of the Snapshot payload (Ev.Snapshot). Bump when a field changes meaning or shape. */
export const SNAPSHOT_VERSION = 1;

/** Largest Snapshot the worker posts, in bytes of its JSON form (the UI budget, 13 section 1). */
export const SNAPSHOT_MAX_BYTES = 32 * 1024;

/** The page pings the worker this often (19 section 2, main_hang). Additive; PROTOCOL_VERSION unchanged. */
export const PING_EVERY_MS = 2_000;
/** The worker reports the page as hung after this long without a ping while the page is visible (19 section 2). */
export const PING_LOST_MS = 8_000;

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
  /** Equips a plain item kind in one gear slot of a Being, or empties it (item null). Gear editor. */
  SetGear = 12,
  /** Replaces the item-rain list (kind ids, src/content/items.ts). Item rain editor. */
  SetItemRain = 13,
  /** Gives one item from the rain list to each Being near a tile (radius in tiles). */
  ItemRain = 14,
  /** Marks or unmarks an item as a favourite (inspector star). */
  SetItemFavourite = 15,
  /**
   * Architect possession of one Being (07 section 13; beings build 3). `on` true gives an order to move to tile (x,y), and
   * with `attack` to strike what stands beside it; each order refreshes the control. `on` false releases the Being.
   * `beingId` is generation * MAX_BEINGS + slot, as in SetGear. Additive kind; PROTOCOL_VERSION unchanged.
   */
  Possess = 16,
  /**
   * Main-thread liveness ping, every PING_EVERY_MS (19 section 2, main_hang). `hidden` is the page's visibility: the worker
   * does not judge a hidden page, since browsers throttle its timers. The worker answers with Ev.Pong. Additive kind.
   */
  Ping = 17,
  /** Asks for the replay ring of player commands (17 section 7.3). Replies with Ev.Replay. Additive kind; PROTOCOL_VERSION unchanged. */
  Replay = 18,
}

export enum Ev {
  Ready = 101,
  Frame = 102,
  QueryResult = 103,
  Fault = 104,
  Snapshot = 106,
  Saved = 107,
  Loaded = 108,
  /** Sim liveness for the main-thread watchdog (17 section 10). Additive kind; PROTOCOL_VERSION unchanged. */
  Heartbeat = 109,
  /** Worldgen job progress (03 section 10). Additive kind; PROTOCOL_VERSION unchanged. */
  WorldgenProgress = 110,
  /** Reply to Cmd.Ping (19 section 2, main_hang). Additive kind; PROTOCOL_VERSION unchanged. */
  Pong = 111,
  /** Reply to Cmd.Replay: the replay ring, oldest first, and how many older entries were dropped. Additive kind. */
  Replay = 112,
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
  | { kind: Cmd.LoadRealm; seq: number; bytes: Uint8Array }
  /** `beingId` is the id the snapshot gives a Being (generation * MAX_BEINGS + slot); `slot` is an equipment slot name; `item` a kind id or null. */
  | { kind: Cmd.SetGear; seq: number; beingId: number; slot: string; item: string | null }
  | { kind: Cmd.SetItemRain; seq: number; ids: string[] }
  | { kind: Cmd.ItemRain; seq: number; x: number; y: number; radius: number }
  | { kind: Cmd.SetItemFavourite; seq: number; itemId: number; on: boolean }
  /**
   * Architect control of one Being (07 section 13). The six ability flags are one-shot actions run on the order's tick
   * (src/sim/beings/abilities.ts): `kick` stuns and pushes the nearest Being beside the controlled one, `jump` hops two
   * tiles toward the order tile, `talk` brings the nearest Being within two tiles under `tagalong`, `dash` runs three
   * tiles toward the order tile, `steal` takes one worn item from a Being within two tiles, `swear` lowers the mood of
   * Beings within three tiles. Absent flags are false.
   */
  | {
      kind: Cmd.Possess;
      seq: number;
      beingId: number;
      on: boolean;
      x: number;
      y: number;
      attack: boolean;
      kick?: boolean;
      jump?: boolean;
      talk?: boolean;
      dash?: boolean;
      steal?: boolean;
      swear?: boolean;
    }
  | { kind: Cmd.Ping; seq: number; hidden: boolean }
  | { kind: Cmd.Replay; seq: number };

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
  /** Cumulative tax receipts from the ruler's share (dominions/tax.ts). Optional: absent until a hamlet pays. */
  taxRaised?: number;
}

/** One hamlet (hamlets window). */
export interface HamletRow {
  /** Display name derived from placement order; hamlets have no stored name yet. */
  name: string;
  folk: number;
  buildings: number;
  parcels: number;
  /** Hamlet mood -100..100 (09 section 9, hamlet level). Optional: absent from older snapshots. */
  mood?: number;
  /** Size tier (09 section 2): `town` from 40 folk. Optional: absent from older snapshots. */
  tier?: 'hamlet' | 'town';
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
  /** Item summary (src/sim/items/summary.ts): counts, capped rows, worn gear and the rain list. Optional. */
  items?: ItemBlock;
  /** Living beings' tile positions for the map layers (src/render/marks.ts). Capped at MAP_POINT_CAP; optional. */
  mapPoints?: MapPoint[];
  /** Positions of armies, campaigns, battles, pact links and hamlet names for the map (src/render/marks.ts). Optional. */
  mapMarks?: MapMarks;
  /** Species group and size class per map point, keyed by id (src/render/sprites.ts). Optional; dropped first when over budget. */
  mapKinds?: MapKind[];
  /** Hamlet buildings with tile positions for the map (src/render/marks.ts). Capped at MAP_BUILDING_CAP; optional; dropped first. */
  mapBuildings?: MapBuilding[];
  /** Intrigues for the map (src/render/marks.ts): kind, whether still running, and the target's tile. Capped at MAP_INTRIGUE_CAP; optional; dropped first. */
  mapIntrigues?: MapIntrigue[];
  /** Boats for the map (src/render/marks.ts): kind and tile. Capped at MAP_BOAT_CAP; optional; dropped first. */
  mapBoats?: MapBoat[];
  /** Parcel owners and dominion attributes for the Insight layers (src/render/insight-layers.ts). Optional; dropped first over budget. */
  mapTiles?: MapTiles;
  /** Relation links of the sampled Beings for the cursor arrows (src/render/insight-layers.ts). Optional; dropped first over budget. */
  mapLinks?: MapLink[];
  /** Opinions, centres and pact candidates for the Ties and Accord rows (src/render/insight-layers.ts). Optional; dropped first over budget. */
  mapTies?: MapTies;
  /** Per-hamlet tax flows of the latest yearly pass for the Money flow overlay, O05 (src/render/insight-layers.ts). Optional; dropped first over budget. */
  mapTaxFlows?: MapTaxFlow[];
}

/** Most opinion entries in one snapshot's ties feed. Keeps the message inside SNAPSHOT_MAX_BYTES. */
export const MAP_TIE_CAP = 256;

/** Most tax flow rows in one snapshot's money feed. Keeps the message inside SNAPSHOT_MAX_BYTES. */
export const MAP_TAX_CAP = 128;

/**
 * Ties and Accord feed (12 section 8.8). `centres` holds each dominion's centroid tile. `opinions` lists [a, b, value] for
 * each bordering pair in both directions: a's opinion of b (opinion.ts), so a line can be coloured by its holder's view.
 * `formPact` and `joinPact` are the pact candidates the sim's gates allow now (intrigue.ts). Each list is capped.
 * `pactMembers` gives the members of each pact a `joinPact` row names (pact id, member dominion ids), so the Accord Finder
 * can draw the candidates of one selected dominion (src/render/insight-layers.ts). A pact id has no position otherwise.
 */
export interface MapTies {
  centres: [number, number, number][];
  opinions: [number, number, number][];
  formPact: [number, number][];
  joinPact: [number, number][];
  pactMembers: [number, number[]][];
}

/**
 * One hamlet's tax flow for the Money flow overlay (dominions/tax.ts TaxFlow). `x`, `y` is the tile of the hamlet's anchor
 * parcel centre; `to` the tile of the holding dominion's centroid parcel, where its ruler's share goes. `loot` and `toRuler`
 * are the gold of the yearly pass.
 */
export interface MapTaxFlow {
  x: number;
  y: number;
  dominion: number;
  to: [number, number];
  loot: number;
  toRuler: number;
}

/**
 * Links of one sampled Being (Insight A01..A07). Ids are map point ids; positions are tile coordinates. Only Beings with at
 * least one link are listed, and each list field is absent when empty.
 */
export interface MapLink {
  id: number;
  /** A02 home: the centre tile of the hamlet on the Being's parcel. */
  home?: [number, number];
  /** A01 destination: the possession order tile while an Architect order runs. */
  dest?: [number, number];
  /** A03 partner: the bond partner, else the lover, when living. */
  partner?: number;
  /** A05 parents: the parent, when living (at most one). */
  parents?: number[];
  /** A06 children: sampled Beings whose parent is this one. */
  children?: number[];
  /** A04 family: sampled members of the Being's family record, other than itself. */
  family?: number[];
  /** A07 attack target: living attackers the Being holds a grudge against. */
  foes?: number[];
}

/** Most boats in one snapshot's map feed. */
export const MAP_BOAT_CAP = 32;

/** One boat on the map: `id` is the boat id, `x`, `y` its tile. */
export interface MapBoat {
  id: number;
  kind: 'trading' | 'transport' | 'fishing';
  x: number;
  y: number;
}

/** Most intrigues in one snapshot's map feed. */
export const MAP_INTRIGUE_CAP = 16;

/**
 * One intrigue on the map. `x`, `y` are the tile of the dominion or hamlet it targets (parcel centre); both are -1
 * when its group id matches no dominion and no hamlet. `id` is the intrigue id.
 */
export interface MapIntrigue {
  id: number;
  kind: 'rebellion' | 'scheme';
  active: boolean;
  x: number;
  y: number;
}

/** Map sprite group: Folk, the 18a beast groups A to C, and the sea, insect, undead, monster and divine blocks. */
export type MapKindGroup = 'folk' | 'beast' | 'sea' | 'insect' | 'undead' | 'monster' | 'divine';

/** Roster size class of a being (18a section 0). */
export type MapSizeClass = 'T' | 'S' | 'M' | 'L' | 'H' | 'C';

/** One being's sprite kind. `id` is the MapPoint id it belongs to. */
export interface MapKind {
  id: number;
  group: MapKindGroup;
  size: MapSizeClass;
  /** Mood -100..+100 (06 section 4.1). Optional: absent in older snapshots (Insight happiness icons). */
  mood?: number;
  /** Id of the running decision task (content/decisions.ts), or '' when none. Optional (Insight task icons). */
  task?: string;
  /** Strain id of the Being. Optional (Insight strain layer). */
  strain?: number;
  /** Index of the creed (culture list) the Being holds, or -1. Optional (Insight creed layer). */
  creed?: number;
  /** Index of the family record the Being belongs to, or -1. Optional (Insight family layer). */
  family?: number;
  /** Id of the living clan of the Being's strain, or -1. Optional (Insight clan layer). */
  clan?: number;
}

/** Per dominion attributes for the Insight layers (src/render/insight-layers.ts). */
export interface MapGroup {
  /** Dominion id. */
  id: number;
  /** Index of the dominion's custom in the culture list, or -1. */
  custom: number;
  /** Dialect word of the dominion, or '' when it has none. */
  dialect: string;
  /** Id of the first pact the dominion belongs to, or -1. */
  pact: number;
  /** True when the dominion has an army on a parcel. */
  army: boolean;
}

/**
 * Parcel owners for the Insight layers (13 section 15, 12 section 8.8). `dominion` and `hamlet` hold one code
 * per parcel in row-major order (`perAxis` x `perAxis`), two characters each, decoded by src/shared/parcel-codec.ts;
 * the code of "none" decodes to -1. `hamlet` is the hamlet index (hamletsOf order). Optional; dropped first over budget.
 */
export interface MapTiles {
  /** Parcel size in tiles (PARCEL). */
  size: number;
  /** Parcels per axis of the realm. */
  perAxis: number;
  dominion: string;
  hamlet: string;
  groups: MapGroup[];
}

/** Most buildings in one snapshot's map feed. Keeps the message inside SNAPSHOT_MAX_BYTES. */
export const MAP_BUILDING_CAP = 96;

/** One hamlet building on the map: `id` is y * 1024 + x (as StructureRow.id), `kind` the catalogue id. */
export interface MapBuilding {
  id: number;
  kind: string;
  x: number;
  y: number;
}

/** Most beings that carry a position in one snapshot. Keeps the message inside SNAPSHOT_MAX_BYTES. */
export const MAP_POINT_CAP = 96;

/** Most rows of each kind in MapMarks. Keeps the message inside SNAPSHOT_MAX_BYTES. */
export const MAP_MARK_CAP = 32;

/** One living being on the map: `id` is the BeingRow id (generation * MAX_BEINGS + slot); x, y are tile coordinates. */
export interface MapPoint {
  id: number;
  x: number;
  y: number;
  folk: boolean;
}

/**
 * Map marks with tile positions (tile = parcel centre, from the army's parcel record). Each list is capped at
 * MAP_MARK_CAP. `pactLinks` rows are [x1, y1, x2, y2] between consecutive members of a pact that have an army.
 */
export interface MapMarks {
  armies: { dominionId: number; x: number; y: number }[];
  campaigns: { dominionId: number; x: number; y: number }[];
  battles: { x: number; y: number }[];
  pactLinks: [number, number, number, number][];
  hamlets: { name: string; x: number; y: number }[];
  /** Army target lines [x1, y1, x2, y2]: an army's tile to its campaign target's centroid parcel. Optional (Insight army lines). */
  armyLines?: [number, number, number, number][];
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
  /** Renown: 1 per year its chief leads. Optional: absent from older snapshots. */
  renown?: number;
  /** Id of the clan this one merged into, or -1 (optional: absent from older snapshots). */
  mergedInto?: number;
}

/** Clans: `count` is every clan on record, `living` the ones with a member; `rows` is capped at SNAPSHOT_DETAIL_ROWS. */
export interface ClanBlock {
  count: number;
  living: number;
  rows: ClanRow[];
}

/** One item instance (items window). `holder` says where it is kept; `at` is a being id, a hamlet index or -1. */
export interface ItemRow {
  id: number;
  kind: string;
  name: string;
  /** Equipment slot name (weapon, helm, body, boots, ring, amulet). */
  slot: string;
  group: string;
  quality: number;
  value: number;
  durability: number;
  /** Modifier display names. */
  mods: string[];
  holder: 'worn' | 'stock' | 'none';
  at: number;
  favourite: boolean;
}

/** Worn gear of one Being: the kind id in each equipment slot (ITEM_SLOTS order), '' when empty. */
export interface GearRow {
  being: number;
  kinds: string[];
}

/** Items block: totals are exact; `rows` and `gear` are capped at SNAPSHOT_DETAIL_ROWS. */
export interface ItemBlock {
  count: number;
  equipped: number;
  stored: number;
  /** Favourites first, then worn, then stored. */
  rows: ItemRow[];
  gear: GearRow[];
  /** Kind ids the item rain draws from (empty: every kind). */
  rain: string[];
}

/**
 * One pact record (10 section 12, src/sim/dominions/pacts.ts). `a` and `b` are the two founders, sized
 * here; `members` lists every current member, which can be more than two once dominions have joined.
 */
export interface PactRow {
  /** The pact id: stable while the pact lives. */
  id: number;
  name: string;
  a: number;
  b: number;
  nameA: string;
  nameB: string;
  strengthA: number;
  strengthB: number;
  parcelsA: number;
  parcelsB: number;
  /** Every current member dominion id, ascending. */
  members: number[];
  /** Sum of the members' strength. */
  power: number;
  renown: number;
  formedTick: number;
}

/** Pact records: `count` is exact; `rows` is capped at SNAPSHOT_DETAIL_ROWS. */
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
  /** `contentHash` is the worker's registry hash (src/content/content-hash.ts); the page refuses to run on a mismatch. */
  | { kind: Ev.Ready; reply: number; protocolVersion: number; side: number; sizeStep: number; seed: number; contentHash: string }
  /** Posted every HEARTBEAT_TICKS ticks, or after HEARTBEAT_PUMPS pumps with no tick (paused). Not a reply. */
  | { kind: Ev.Heartbeat; tick: number; avgTickMs: number }
  /**
   * A generation job advanced. `reply` is the NewRealm seq, or 0 for a job resumed after a reload.
   * `progress` runs 0..1 over the whole job; `stage` indexes the six 03 section 10 stage names.
   */
  | { kind: Ev.WorldgenProgress; reply: number; stage: number; name: string; progress: number; attempt: number; resumed: boolean }
  | { kind: Ev.Frame; rows: FrameRows | null; stats: FrameStats }
  | { kind: Ev.QueryResult; reply: number; tileX: number; tileY: number; elevation: number; ground: string; inBounds: boolean }
  /**
   * `sys` names the part of the sim that faulted (for example 'pump' or 'command'), when the worker knows it. `sysOff` is true
   * while that part is switched off (17 section 9, system isolation). Additive; PROTOCOL_VERSION unchanged.
   */
  | { kind: Ev.Fault; severity: 'warn' | 'error' | 'fatal'; code: string; detail: string; sys?: string; sysOff?: boolean }
  /** Reply to Cmd.Ping. Not a request reply: no seq is waited on. */
  | { kind: Ev.Pong; reply: number }
  /** Reply to Cmd.Replay. Entries are the player commands queued in this realm, oldest first (replay-ring.ts). */
  | { kind: Ev.Replay; reply: number; commands: ReplayEntry[]; dropped: number }
  | { kind: Ev.Snapshot; snap: Snapshot }
  /** Reply to Cmd.SaveRealm. Empty bytes when there is no realm. */
  | { kind: Ev.Saved; reply: number; bytes: Uint8Array }
  /** Reply to a Cmd.LoadRealm that failed; ok is always false. */
  | { kind: Ev.Loaded; reply: number; ok: boolean; detail: string };
