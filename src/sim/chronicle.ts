import { AGE_BY_ID, type AgeState } from './ages.ts';
import { Sim } from './sim.ts';
import type { WeatherState } from './weather.ts';
import type { Projectile } from './combat.ts';
import { culturePayload, cultureFromPayload, type CulturePayload } from './culture/adapter.ts';
import { snapshotDominions, restoreDominions, snapshotPacts, restorePacts, type DominionSnapshot, type PactSnapshot } from './dominions/adapter.ts';
import { snapshotHamlets, restoreHamlets, type HamletSnapshot } from './settlements/adapter.ts';
import { refreshStats } from './beings/system.ts';
import { restoreItems, saveItems, type ItemSave } from './items/system.ts';
import { SPECIES } from '../content/beasts.ts';
import { DECISION_ROWS } from '../content/decisions.ts';
import { STRAIN_TRAIT_BY_ID } from '../content/traits.ts';
import { CASTES, MORPHS, PALETTES } from '../content/variants.ts';
import { freshCounters, type Strain } from './beings/strains.ts';
import { AGGRO_SLOTS } from './beings/store.ts';
import {
  SEED_SALT_RANGE,
  SEGMENT_KINDS,
  STRAND_TYPES,
  segmentIndex,
  strandCapacity,
  type Genome,
  type Strand,
} from './beings/genome.ts';
import { restoreClans, type ClanState } from './clans/clans.ts';
import { snapshotBoats, restoreBoats, type BoatSave } from './boats/boats.ts';
import { fnv1a } from '../shared/rng.ts';
import { QUAKE_SHAPE_COUNT } from './terrain/quake.ts';
import { QUAKE_REACH, restoreTerrain, snapshotTerrain, terrainHasState, type TerrainSave } from './terrain/save.ts';

/** FNV-1a over raw bytes (the same hash as Sim.stateHash); re-exported for the save tests and tools. */
export { fnv1a };

/**
 * Chronicle save codec (15-chronicle-saves, section 3 in spirit): a versioned, sectioned binary
 * format with a trailing checksum. Little-endian throughout; typed arrays are written as raw bytes,
 * so the codec assumes a little-endian host (every supported browser is).
 *
 * Layout: header (magic 'SRCH', u16 format, u16 schema, u32 content hash placeholder, u32 body
 * length), body (sections: u8 tag, u32 length, payload), trailer (u32 FNV-1a of the body).
 *
 * Schema 6 (beings build 3): each Being in the beings section also carries its egg end tick (0 when not an egg), its rooting
 * flag, and its lover and best friend links (partner slot and generation; -1 for none). Partner links must name a Being in
 * the save. Possession (the Architect's orders) and the step index of a running task are not saved (07 section 14).
 * Schema 5 saves are rejected: their beings section has none of these fields.
 *
 * Covered: clock, realm arrays, ages, rules, stats, beings (with generations and exact list and
 * free-stack order), RNG streams, behaviour timers, tile runners, combat state, status effects and
 * weather (clouds, blast guard, projectiles), and the lifetime stats with the unlocked achievements
 * (optional section: saves written before it existed still load, with empty stats), and the dominion
 * state (tag 15: dominions, relations, borders, owner bytes) and the hamlet state (tag 16), both optional
 * so older saves still load with no dominions or hamlets, and the terrain state (tag 22: vents, the quake in
 * progress, the fissure shape cycle), optional and written only when non-empty. A save
 * continued to any later tick matches an uninterrupted run (tests/unit/chronicle.test.ts). The pending command queue is empty between
 * ticks by construction, so it is not written.
 */
export const CHRONICLE_MAGIC = 'SRCH';
export const FORMAT_VERSION = 1;
/**
 * Schema 5 (beings round 8): each Being in the beings section also carries its biome morph, caste, colour palette and
 * shade, its rebirth flag, its next enemy search tick, and its aggro entries (AGGRO_SLOTS of attacker slot, generation
 * and grudge end). The strain records (section 17) gain `phenotypes` and the `died` and `killed` counters; older strain
 * records are filled with defaults on load. Schema 4 saves are rejected: their beings section has none of these fields.
 * Beings round 7 (still schema 4 at the time): the beings section ends with one lineage
 * code per strain (05 section 5): strain id, seed salt, then each Strand's type and each slot's kind code and
 * special. Its strain count must equal the strain registry's. Corpses are not saved (none are built).
 * Schema 4 (beings round 6): each Being in the beings section also carries mood, endurance, sleep (end tick
 * and last vitality), bond and close-contact links, and one decision cooldown per decision (the decision
 * count is written first and must match content/decisions.ts). Schema 3 saves are rejected: their beings
 * section has none of these fields.
 * Schema 3 (beings round 2): the beings section carries each Being's parent link (slot and generation,
 * 06 section 6.1), strain id, stored aptitudes and marks; section 17 holds the strain registry. Schema 2
 * saves are rejected: they have no parent links or strains to restore.
 */
export const SCHEMA_VERSION = 6;
const HEADER_BYTES = 16;
/** Realm size steps a save (and a NewRealm command) may name. */
export const MIN_SIZE_STEP = 2;
export const MAX_SIZE_STEP = 9;

const TAG = { clock: 1, realm: 2, ages: 3, rules: 4, stats: 5, beings: 6, streams: 7, runners: 8, combat: 9, effects: 10, weather: 11, culture: 12, calamity: 13, lifetime: 14, dominions: 15, hamlets: 16, strains: 17, clans: 18, items: 19, pacts: 20, boats: 21, terrain: 22 } as const;
/** Sections a save may lack (written by later builds); absent means the empty default. */
const OPTIONAL_TAGS: readonly number[] = [TAG.culture, TAG.calamity, TAG.lifetime, TAG.dominions, TAG.hamlets, TAG.clans, TAG.items, TAG.pacts, TAG.boats, TAG.terrain];
/** Vent kinds (terrain/state.ts Vent) and quake modes (terrain/state.ts Quake) a terrain section may name. */
const VENT_KINDS: readonly string[] = ['volcano', 'water', 'acid'];
const QUAKE_MODES: readonly string[] = ['lower', 'raise', 'small'];
const REALM_ARRAYS = [
  'elevation',
  'ground',
  'cover',
  'flags',
  'hp',
  'scar',
  'fireStart',
  'heat',
  'lavaSince',
  'variant',
  'flora',
  'floraSince',
  'floraBlockedUntil',
  'region',
] as const;

class Writer {
  private buf = new Uint8Array(4096);
  private view = new DataView(this.buf.buffer);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.len, v);
    this.len += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.len, v, true);
    this.len += 2;
  }

  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.len, v, true);
    this.len += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.len, v >>> 0, true);
    this.len += 4;
  }

  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.len, v, true);
    this.len += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.len, v, true);
    this.len += 4;
  }

  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.len, v, true);
    this.len += 8;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class Reader {
  private readonly view: DataView;
  pos = 0;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  private need(n: number): void {
    if (this.pos + n > this.data.length) throw new Error('chronicle: truncated data');
  }

  u8(): number {
    this.need(1);
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }
}

function view(a: Uint8Array | Uint16Array | Uint32Array | Float32Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

function section(w: Writer, tag: number, write: (inner: Writer) => void): void {
  const inner = new Writer();
  write(inner);
  const payload = inner.finish();
  w.u8(tag);
  w.u32(payload.length);
  w.bytes(payload);
}

/** Serialises a Sim into a checksummed Chronicle byte array. */
export function encodeChronicle(sim: Sim): Uint8Array {
  const body = new Writer();
  section(body, TAG.clock, (w) => w.f64(sim.tick));
  section(body, TAG.realm, (w) => {
    w.u32(sim.realm.seed);
    w.u8(sim.realm.sizeStep);
    for (const name of REALM_ARRAYS) {
      const arr = sim.realm[name];
      w.u32(arr.byteLength);
      w.bytes(view(arr));
    }
  });
  section(body, TAG.ages, (w) => {
    const a: AgeState = sim.ages;
    w.bytes(new TextEncoder().encode(JSON.stringify(a)));
  });
  section(body, TAG.rules, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(sim.rules.snapshot()))));
  section(body, TAG.stats, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(sim.beings.stats))));
  const streamSaved = sim.streamState();
  section(body, TAG.streams, (w) => w.bytes(new TextEncoder().encode(JSON.stringify({ streams: streamSaved.streams, timers: streamSaved.timers }))));
  section(body, TAG.runners, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(streamSaved.runners))));
  section(body, TAG.culture, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(culturePayload(sim.culture)))));
  section(body, TAG.calamity, (w) => w.bytes(new TextEncoder().encode(JSON.stringify([...sim.calamityCooldowns]))));
  section(body, TAG.beings, (w) => {
    const s = sim.beings.store;
    const alive: number[] = [];
    for (let slot = 0; slot < s.capacity; slot++) if (s.alive[slot] === 1) alive.push(slot);
    w.u32(s.capacity);
    w.u8(DECISION_ROWS.length);
    w.u32(alive.length);
    for (const slot of alive) {
      w.u32(slot);
      w.u8(s.species[slot] ?? 0);
      w.u16(s.x[slot] ?? 0);
      w.u16(s.y[slot] ?? 0);
      w.i16(s.vit[slot] ?? 0);
      w.u16(s.maxVit[slot] ?? 0);
      w.u8(s.fuel[slot] ?? 0);
      w.u8(s.female[slot] ?? 0);
      w.i32(s.born[slot] ?? 0);
      w.u32(s.nextDecision[slot] ?? 0);
      w.u32(s.lull[slot] ?? 0);
      w.u8(s.expecting[slot] ?? 0);
      w.u32(s.expectUntil[slot] ?? 0);
      w.u8(s.brood[slot] ?? 0);
      w.f32(s.moveAcc[slot] ?? 0);
      w.i32(s.mate[slot] ?? -1);
      w.u32(s.mateGen[slot] ?? 0);
      w.i32(s.parent[slot] ?? -1);
      w.u32(s.parentGen[slot] ?? 0);
      w.u32(s.strain[slot] ?? 0);
      for (let k = 0; k < 4; k++) w.u16(s.attrs[slot * 4 + k] ?? 0);
      for (let k = 0; k < 5; k++) w.u32(s.marks[slot * 5 + k] ?? 0);
      // Round 6 (schema 4): mood, endurance, sleep, bonds, and the decision cooldowns (07 section 14).
      w.i16(s.mood[slot] ?? 0);
      w.u16(s.endurance[slot] ?? 0);
      w.u32(s.sleepUntil[slot] ?? 0);
      w.i16(s.sleepVit[slot] ?? 0);
      w.i32(s.bondWith[slot] ?? -1);
      w.u32(s.bondGen[slot] ?? 0);
      w.i32(s.closeWith[slot] ?? -1);
      w.u32(s.closeGen[slot] ?? 0);
      w.u32(s.closeSince[slot] ?? 0);
      w.i16(sim.beings.task[slot] ?? -1);
      for (let k = 0; k < DECISION_ROWS.length; k++) w.u32(sim.beings.cooldown[slot * DECISION_ROWS.length + k] ?? 0);
      // Round 8 (schema 5): variants, rebirth flag, search timer and the aggro entries (07 sections 8, 10.4).
      w.u8(s.morph[slot] ?? 0);
      w.u8(s.caste[slot] ?? 0);
      w.u8(s.palette[slot] ?? 0);
      w.u8(s.shade[slot] ?? 0);
      w.u8(s.reborn[slot] ?? 0);
      w.u32(s.searchAt[slot] ?? 0);
      for (let k = 0; k < AGGRO_SLOTS; k++) {
        const i = slot * AGGRO_SLOTS + k;
        w.i32(s.aggroId[i] ?? -1);
        w.u32(s.aggroGen[i] ?? 0);
        w.u32(s.aggroUntil[i] ?? 0);
      }
      // Schema 6 (beings build 3): the egg stage, rooting, and the lover and best friend links (06 sections 3.2, 4.4, 6.3).
      w.u32(s.shelledUntil[slot] ?? 0);
      w.u8(s.rooted[slot] ?? 0);
      w.i32(s.loverWith[slot] ?? -1);
      w.u32(s.loverGen[slot] ?? 0);
      w.i32(s.friendWith[slot] ?? -1);
      w.u32(s.friendGen[slot] ?? 0);
    }
    // Full generation table (dead slots keep their counters) and the exact list and free-stack order.
    for (let slot = 0; slot < s.capacity; slot++) w.u32(s.generation[slot] ?? 0);
    const layout = s.layout();
    w.u32(layout.list.length);
    for (const slot of layout.list) w.u32(slot);
    w.u32(layout.free.length);
    for (const slot of layout.free) w.u32(slot);
    // Lineage codes (beings round 7): kind code 0 is empty, else library index + 1; special 0 none, 1 booster, 2 blocked.
    const codes = sim.beings.strains.genomeEntries();
    w.u32(codes.length);
    for (const [id, code] of codes) {
      w.u32(id);
      w.u32(code.seedSalt);
      w.u8(code.strands.length);
      for (const strand of code.strands) {
        w.u8(STRAND_TYPES.indexOf(strand.type));
        for (let i = 0; i < strand.slots.length; i++) {
          const kind = strand.slots[i];
          w.u8(kind ? segmentIndex(kind) + 1 : 0);
          w.u8(strand.specials[i] === 'booster' ? 1 : strand.specials[i] === 'blocked' ? 2 : 0);
        }
      }
    }
  });

  section(body, TAG.combat, (w) => {
    w.u32(sim.combat.plating.byteLength);
    w.bytes(view(sim.combat.plating));
    w.bytes(view(sim.combat.hitUntil));
    w.bytes(view(sim.combat.attackTimer));
  });
  section(body, TAG.effects, (w) => {
    w.bytes(view(sim.effects.code));
    w.bytes(view(sim.effects.until));
  });
  section(body, TAG.weather, (w) => {
    const payload = { weather: sim.weather, guard: sim.guard.level, projectiles: sim.projectiles };
    w.bytes(new TextEncoder().encode(JSON.stringify(payload)));
  });

  section(body, TAG.lifetime, (w) => {
    const payload = { counters: sim.lifetime.counters, sets: sim.lifetime.sets, unlocked: [...sim.unlocked] };
    w.bytes(new TextEncoder().encode(JSON.stringify(payload)));
  });

  section(body, TAG.dominions, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(snapshotDominions(sim)))));
  section(body, TAG.hamlets, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(snapshotHamlets(sim)))));
  section(body, TAG.strains, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(sim.beings.strains.snapshot()))));
  // Clans (tag 18, optional): saves without it load with no clans.
  section(body, TAG.clans, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(sim.clans))));
  // Optional items section (tag 19, 08 section 6): written only when the realm holds items, so a realm
  // without any saves exactly as before.
  if (sim.items.items.size > 0 || sim.items.stock.size > 0 || sim.items.rain.length > 0) {
    section(body, TAG.items, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(saveItems(sim)))));
  }
  // Optional pact records (tag 20, 10 section 12): written only once a pact exists or has formed, so a realm
  // without pacts saves exactly as before.
  const pactSnap = snapshotPacts(sim);
  if (pactSnap) section(body, TAG.pacts, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(pactSnap))));
  // Optional boat section (tag 21, 10 section 13): written only when a boat or a dock build timer exists, so a realm
  // without boats saves exactly as before.
  const boatSnap = snapshotBoats(sim);
  if (boatSnap) section(body, TAG.boats, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(boatSnap))));
  // Optional terrain section (tag 22, 04 sections 7.2 and 9): vents, the quake in progress and the fissure shape cycle.
  // Written only when one of them holds state, so a realm without vents or quakes saves exactly as before.
  if (terrainHasState(sim)) section(body, TAG.terrain, (w) => w.bytes(new TextEncoder().encode(JSON.stringify(snapshotTerrain(sim)))));

  const bodyBytes = body.finish();
  const header = new Writer();
  for (let k = 0; k < CHRONICLE_MAGIC.length; k++) header.u8(CHRONICLE_MAGIC.charCodeAt(k));
  header.u16(FORMAT_VERSION);
  header.u16(SCHEMA_VERSION);
  header.u32(0);
  header.u32(bodyBytes.length);
  const out = new Writer();
  out.bytes(header.finish());
  out.bytes(bodyBytes);
  out.u32(fnv1a(bodyBytes));
  return out.finish();
}

/**
 * Parses and verifies a Chronicle, then rebuilds a Sim from it. Throws an Error naming the failed
 * check (magic, format, schema, length or checksum) and never returns partial state.
 */
export function decodeChronicle(bytes: Uint8Array): Sim {
  if (bytes.length < HEADER_BYTES + 4) throw new Error('chronicle: file too short');
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  if (magic !== CHRONICLE_MAGIC) throw new Error(`chronicle: bad magic "${magic}"`);
  const head = new Reader(bytes.subarray(0, HEADER_BYTES));
  head.bytes(4);
  const format = head.u16();
  if (format !== FORMAT_VERSION) throw new Error(`chronicle: unsupported format version ${format}`);
  const schema = head.u16();
  if (schema !== SCHEMA_VERSION) throw new Error(`chronicle: unsupported schema version ${schema}`);
  head.u32();
  const bodyLength = head.u32();
  if (HEADER_BYTES + bodyLength + 4 !== bytes.length) throw new Error('chronicle: body length mismatch');
  const body = bytes.subarray(HEADER_BYTES, HEADER_BYTES + bodyLength);
  const stored = new Reader(bytes.subarray(HEADER_BYTES + bodyLength)).u32();
  if (fnv1a(body) !== stored) throw new Error('chronicle: checksum mismatch (file corrupted)');

  const sections = new Map<number, Uint8Array>();
  const r = new Reader(body);
  while (r.remaining > 0) {
    const tag = r.u8();
    const len = r.u32();
    const payload = r.bytes(len);
    if (sections.has(tag)) throw new Error(`chronicle: duplicate section ${tag}`);
    sections.set(tag, payload);
  }
  for (const need of Object.values(TAG)) {
    if (!sections.has(need) && !OPTIONAL_TAGS.includes(need)) throw new Error(`chronicle: missing section ${need}`);
  }

  const realmBytes = sections.get(TAG.realm) ?? new Uint8Array();
  const rr = new Reader(realmBytes);
  const seed = rr.u32();
  const sizeStep = rr.u8();
  if (sizeStep < MIN_SIZE_STEP || sizeStep > MAX_SIZE_STEP) throw new Error(`chronicle: size step ${sizeStep} out of range`);
  const sim = new Sim(seed, sizeStep);
  const realm = sim.realm;

  for (const name of REALM_ARRAYS) {
    const len = rr.u32();
    const target = realm[name];
    if (len !== target.byteLength) throw new Error(`chronicle: realm array ${name} has wrong size`);
    view(target).set(rr.bytes(len));
  }
  if (rr.remaining !== 0) throw new Error('chronicle: trailing bytes in realm section');

  const clock = new Reader(sections.get(TAG.clock) ?? new Uint8Array()).f64();
  if (!Number.isFinite(clock) || clock < 0) throw new Error('chronicle: bad tick');
  sim.tick = clock;

  const decoder = new TextDecoder('utf-8', { fatal: true });
  sim.ages = checkAges(parseJson<unknown>(decoder, sections.get(TAG.ages), 'ages'));
  const rules = parseJson<unknown>(decoder, sections.get(TAG.rules), 'rules');
  if (!isRecord(rules) || !Object.values(rules).every((v) => typeof v === 'boolean')) throw new Error('chronicle: rules are not valid');
  for (const [id, on] of Object.entries(rules)) {
    if (!sim.rules.set(id, on as boolean)) throw new Error(`chronicle: unknown rule ${id}`);
  }
  const stats = parseJson<unknown>(decoder, sections.get(TAG.stats), 'stats');
  if (!isRecord(stats) || !Object.values(stats).every(isFiniteNumber)) throw new Error('chronicle: stats are not valid');
  Object.assign(sim.beings.stats, stats);

  decodeStrains(sim, parseJson<{ next: number; list: Strain[] }>(decoder, sections.get(TAG.strains), 'strains'));
  decodeBeings(sim, new Reader(sections.get(TAG.beings) ?? new Uint8Array()));
  const combatBytes = sections.get(TAG.combat) ?? new Uint8Array();
  const cr = new Reader(combatBytes);
  const plen = cr.u32();
  if (plen !== sim.combat.plating.byteLength) throw new Error('chronicle: combat section size mismatch');
  view(sim.combat.plating).set(cr.bytes(plen));
  view(sim.combat.hitUntil).set(cr.bytes(sim.combat.hitUntil.byteLength));
  view(sim.combat.attackTimer).set(cr.bytes(sim.combat.attackTimer.byteLength));
  if (cr.remaining !== 0) throw new Error('chronicle: trailing bytes in combat section');
  const effectBytes = sections.get(TAG.effects) ?? new Uint8Array();
  const er = new Reader(effectBytes);
  view(sim.effects.code).set(er.bytes(sim.effects.code.byteLength));
  view(sim.effects.until).set(er.bytes(sim.effects.until.byteLength));
  if (er.remaining !== 0) throw new Error('chronicle: trailing bytes in effects section');
  const weatherPayload = checkWeather(parseJson<unknown>(decoder, sections.get(TAG.weather), 'weather'));
  sim.weather = weatherPayload.weather;
  sim.guard.level = weatherPayload.guard;
  sim.projectiles.length = 0;
  sim.projectiles.push(...weatherPayload.projectiles);
  const streamPayload = parseJson<{ streams: Record<string, number[]>; timers: Record<string, number> }>(decoder, sections.get(TAG.streams), 'streams');
  const runnerPayload = parseJson<Record<string, { order: number[]; cursor: number }>>(decoder, sections.get(TAG.runners), 'runners');
  sim.loadStreamState({ streams: streamPayload.streams, timers: streamPayload.timers, runners: runnerPayload });
  const cultureBytes = sections.get(TAG.culture);
  if (cultureBytes) Object.assign(sim.culture, cultureFromPayload(checkCulture(parseJson<unknown>(decoder, cultureBytes, 'culture'))));
  if (sections.has(TAG.calamity)) {
    const cooldowns = parseJson<[string, number][]>(decoder, sections.get(TAG.calamity), "calamity");
    sim.calamityCooldowns.clear();
    for (const [id, tick] of cooldowns) sim.calamityCooldowns.set(id, tick);
  }
  if (sections.has(TAG.lifetime)) {
    const life = parseLifetime(decoder, sections.get(TAG.lifetime) ?? new Uint8Array());
    sim.lifetime = { counters: life.counters, sets: life.sets };
    sim.unlocked.clear();
    for (const id of life.unlocked) sim.unlocked.add(id);
  }

  const dominionBytes = sections.get(TAG.dominions);
  if (dominionBytes) {
    const snap = checkDominions(parseJson<unknown>(decoder, dominionBytes, 'dominions'));
    if (snap) restoreDominions(sim, snap);
  }
  const pactBytes = sections.get(TAG.pacts);
  if (pactBytes) restorePacts(sim, checkPacts(parseJson<unknown>(decoder, pactBytes, 'pacts')));
  const hamletBytes = sections.get(TAG.hamlets);
  if (hamletBytes) {
    const snap = checkHamlets(parseJson<unknown>(decoder, hamletBytes, 'hamlets'));
    if (snap) restoreHamlets(sim, snap);
  }
  const clanBytes = sections.get(TAG.clans);
  if (clanBytes) restoreClans(sim.clans, parseJson<ClanState>(decoder, clanBytes, 'clans'));

  const itemBytes = sections.get(TAG.items);
  if (itemBytes) restoreItems(sim, parseJson<ItemSave>(decoder, itemBytes, 'items'));

  const boatBytes = sections.get(TAG.boats);
  if (boatBytes) restoreBoats(sim, checkBoats(parseJson<unknown>(decoder, boatBytes, 'boats'), realm.side));

  const terrainBytes = sections.get(TAG.terrain);
  if (terrainBytes) restoreTerrain(sim, checkTerrain(parseJson<unknown>(decoder, terrainBytes, 'terrain'), realm.side));

  realm.rebuildSets();
  realm.markAllDirty();
  sim.beings.rebuildBuckets();
  return sim;
}

function parseJson<T>(decoder: TextDecoder, payload: Uint8Array | undefined, name: string): T {
  try {
    return JSON.parse(decoder.decode(payload ?? new Uint8Array())) as T;
  } catch {
    throw new Error(`chronicle: ${name} section is not valid`);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Checks the ages section: eight known slot ids, a slot index in range, finite timing fields. */
function checkAges(raw: unknown): AgeState {
  if (!isRecord(raw)) throw new Error('chronicle: ages are not valid');
  const slotsOk = Array.isArray(raw.slots) && raw.slots.length === 8 && raw.slots.every((s) => typeof s === 'string' && AGE_BY_ID.has(s));
  const currentOk = typeof raw.current === 'string' && AGE_BY_ID.has(raw.current);
  const slotIndexOk = Number.isInteger(raw.slotIndex) && (raw.slotIndex as number) >= 0 && (raw.slotIndex as number) < 8;
  if (!slotsOk || !currentOk || !slotIndexOk) throw new Error('chronicle: ages are not valid');
  if (![raw.elapsed, raw.durationTicks, raw.speedMultiplier, raw.startedAtTick].every(isFiniteNumber)) throw new Error('chronicle: ages are not valid');
  return raw as unknown as AgeState;
}

/** Checks the weather section: clouds and projectiles with their numeric fields, and a finite guard level. */
function checkWeather(raw: unknown): { weather: WeatherState; guard: number; projectiles: Projectile[] } {
  const fail = new Error('chronicle: weather section is not valid');
  if (!isRecord(raw) || !isRecord(raw.weather) || !isFiniteNumber(raw.guard) || !Array.isArray(raw.projectiles)) throw fail;
  const weather = raw.weather;
  if (!Array.isArray(weather.clouds) || !isFiniteNumber(weather.nextSpawn)) throw fail;
  for (const c of weather.clouds as unknown[]) {
    if (!isRecord(c) || typeof c.type !== 'string' || ![c.x, c.y, c.speed, c.age, c.dropTimer, c.dropInterval].every(isFiniteNumber)) throw fail;
  }
  for (const p of raw.projectiles as unknown[]) {
    if (!isRecord(p) || typeof p.type !== 'string' || typeof p.collide !== 'boolean' || typeof p.alive !== 'boolean') throw fail;
    if (![p.x, p.y, p.tx, p.ty, p.speed, p.damage].every(isFiniteNumber)) throw fail;
  }
  return raw as unknown as { weather: WeatherState; guard: number; projectiles: Projectile[] };
}

/** Checks the culture payload: the list fields, and creed rosters of numeric ids. */
function checkCulture(raw: unknown): CulturePayload {
  if (!isRecord(raw) || !isFiniteNumber(raw.nextId)) throw new Error('chronicle: culture payload is not valid');
  const creeds = raw.creeds;
  const listsOk = [raw.customs, raw.creeds, raw.dialects, raw.intrigues, raw.families].every(Array.isArray);
  const creedsOk = Array.isArray(creeds) && creeds.every((c) => isRecord(c) && isFiniteNumber(c.id) && Array.isArray(c.holders) && c.holders.every(isFiniteNumber));
  // Customs (11 section 4.1): each has a group (a dominion id) and a list of trait id strings. Ids are read against the catalogue on load.
  const customsOk =
    Array.isArray(raw.customs) &&
    raw.customs.every((c) => isRecord(c) && isFiniteNumber(c.group) && Array.isArray(c.traits) && c.traits.every((t) => typeof t === 'string'));
  if (!listsOk || !creedsOk || !customsOk) throw new Error('chronicle: culture payload is not valid');
  // Optional family records (11 section 7): when present, each has an id, two founders, a member list and a banner.
  if (raw.familyRecords !== undefined) {
    const records = raw.familyRecords;
    const recordsOk =
      Array.isArray(records) &&
      records.every(
        (f) =>
          isRecord(f) &&
          isFiniteNumber(f.id) &&
          typeof f.name === 'string' &&
          Array.isArray(f.founders) &&
          f.founders.length === 2 &&
          f.founders.every(isFiniteNumber) &&
          Array.isArray(f.members) &&
          f.members.every(isFiniteNumber) &&
          isFiniteNumber(f.originHamletId) &&
          isRecord(f.banner) &&
          [f.banner.background, f.banner.icon, f.banner.frame].every(isFiniteNumber),
      );
    if (!recordsOk) throw new Error('chronicle: culture family records are not valid');
  }
  // Optional study records (11 section 9.1 study traits): keys are being keys (digits), each with an xp and a level.
  if (raw.studies !== undefined) {
    const studies = raw.studies;
    const studiesOk =
      isRecord(studies) &&
      Object.entries(studies).every(
        ([k, v]) => /^\d+$/.test(k) && isRecord(v) && isFiniteNumber(v.xp) && isFiniteNumber(v.level) && v.xp >= 0 && v.level >= 0,
      );
    if (!studiesOk) throw new Error('chronicle: culture study records are not valid');
  }
  // Optional defections (convertOrElse): being key (digits) -> dominion group id.
  if (raw.allegiance !== undefined) {
    const allegiance = raw.allegiance;
    const allegianceOk = isRecord(allegiance) && Object.entries(allegiance).every(([k, v]) => /^\d+$/.test(k) && isFiniteNumber(v));
    if (!allegianceOk) throw new Error('chronicle: culture allegiance records are not valid');
  }
  // Optional books (11 section 5): each has an id, the group that wrote it, its mood and its xp.
  if (raw.books !== undefined) {
    const books = raw.books;
    const booksOk =
      Array.isArray(books) && books.every((b) => isRecord(b) && [b.id, b.group, b.mood, b.xp].every(isFiniteNumber));
    if (!booksOk) throw new Error('chronicle: culture book records are not valid');
  }
  return raw as unknown as CulturePayload;
}

/** Checks the dominion section: null, or a snapshot whose lists exist (restoreDominions checks the contents). */
function checkDominions(raw: unknown): DominionSnapshot | null {
  if (raw === null) return null;
  if (!isRecord(raw) || !Array.isArray(raw.dominions) || !Array.isArray(raw.relations) || !Array.isArray(raw.borders) || !Array.isArray(raw.owner)) {
    throw new Error('chronicle: dominion section is not valid');
  }
  // Optional intrigue records (intrigue.ts): when present, the item and cooldown lists must be arrays.
  if (raw.intrigues !== undefined && (!isRecord(raw.intrigues) || !Array.isArray(raw.intrigues.items) || !Array.isArray(raw.intrigues.cooldowns))) {
    throw new Error('chronicle: dominion section intrigues are not valid');
  }
  // Optional tax records (dominions/tax.ts): the hamlet gold list is a list of [parcel, gold] pairs, and each dominion's
  // traits (when present) are a list of strings. restoreDominions checks the values.
  if (raw.taxSeen !== undefined && (!Array.isArray(raw.taxSeen) || !raw.taxSeen.every((p) => Array.isArray(p) && p.length === 2))) {
    throw new Error('chronicle: dominion section tax records are not valid');
  }
  // Optional ruler (rulers.ts): a record whose slot and generation are numbers, and a finite succession-wait tick. restoreDominions checks the ranges.
  const rulerShape = (r: unknown): boolean => isRecord(r) && isFiniteNumber(r.slot) && isFiniteNumber(r.gen);
  if (!raw.dominions.every((d) => isRecord(d) && (d.traits === undefined || Array.isArray(d.traits)) && (d.taxRaised === undefined || isFiniteNumber(d.taxRaised)) && (d.ruler === undefined || rulerShape(d.ruler)) && (d.rulerWaitUntil === undefined || isFiniteNumber(d.rulerWaitUntil)))) {
    throw new Error('chronicle: dominion section records are not valid');
  }
  return raw as unknown as DominionSnapshot;
}

/**
 * Checks the settlements (hamlet) section's shape before any of it is applied: null, or a snapshot whose hamlet
 * list exists and whose optional landmark, creep hub and creep guard lists hold records of the right kinds.
 * restoreHamlets checks the contents against the content tables.
 */
function checkHamlets(raw: unknown): HamletSnapshot | null {
  if (raw === null) return null;
  if (!isRecord(raw) || !Array.isArray(raw.hamlets)) throw new Error('chronicle: hamlet section is not valid');
  const fail = new Error('chronicle: hamlet section is not valid');
  // Per hamlet (hamlet.ts, jobs build 3): an optional construction site (catalogue id, origin, builder progress) and an
  // optional road queue (tile indices). Their contents are checked against the tables in restoreHamlets.
  for (const h of raw.hamlets) {
    if (!isRecord(h)) throw fail;
    if (h.site !== undefined) {
      if (!isRecord(h.site) || typeof h.site.id !== 'string' || !isFiniteNumber(h.site.x) || !isFiniteNumber(h.site.y) || !isFiniteNumber(h.site.progress)) throw fail;
    }
    if (h.road !== undefined) {
      if (!Array.isArray(h.road) || !h.road.every(isFiniteNumber)) throw fail;
    }
  }
  if (raw.structures !== undefined) {
    if (!Array.isArray(raw.structures)) throw fail;
    for (const s of raw.structures) {
      if (!isRecord(s) || typeof s.id !== 'string' || !isFiniteNumber(s.tile) || !isFiniteNumber(s.next)) throw fail;
    }
  }
  if (raw.hubs !== undefined) {
    if (!Array.isArray(raw.hubs)) throw fail;
    for (const h of raw.hubs) {
      if (!isRecord(h) || typeof h.def !== 'string' || !isFiniteNumber(h.tile) || !isFiniteNumber(h.nextPulse) || typeof h.alive !== 'boolean') throw fail;
      if (!Array.isArray(h.tiles) || !h.tiles.every(isFiniteNumber)) throw fail;
    }
  }
  // garrisons (garrison.ts): optional records of a hamlet index, a dominion id, a soldier count, a recruit timer and a
  // wage timer (absent in saves written before wages). Whole numbers for the indexes and the soldier count; the soldier
  // count may sit over the limit (the next garrison pass releases the surplus). Contents are checked in restoreGarrisons.
  if (raw.garrisons !== undefined) {
    if (!Array.isArray(raw.garrisons)) throw fail;
    for (const g of raw.garrisons) {
      if (!isRecord(g)) throw fail;
      if (!Number.isInteger(g.hamlet) || (g.hamlet as number) < 0) throw fail;
      if (!Number.isInteger(g.dominion) || (g.dominion as number) < 0) throw fail;
      if (!Number.isInteger(g.soldiers) || (g.soldiers as number) < 0) throw fail;
      if (!isFiniteNumber(g.timer)) throw fail;
      if (g.wage !== undefined && !isFiniteNumber(g.wage)) throw fail;
    }
  }
  if (raw.creepGuard !== undefined) {
    if (!Array.isArray(raw.creepGuard)) throw fail;
    for (const pair of raw.creepGuard) {
      if (!Array.isArray(pair) || pair.length !== 2 || !isFiniteNumber(pair[0]) || !isFiniteNumber(pair[1])) throw fail;
    }
  }
  // Hamlet iron (settlements iron store): optional per record, absent in older saves; when present, finite and not negative.
  for (const h of raw.hamlets) {
    if (isRecord(h) && h.iron !== undefined && !(isFiniteNumber(h.iron) && h.iron >= 0)) throw fail;
  }
  // Road decay (roads.ts pathDecay): optional; a next-run tick and a list of [tile, base ground] pairs. Contents are checked in restoreHamlets.
  if (raw.roadDecay !== undefined) {
    const rd = raw.roadDecay;
    if (!isRecord(rd) || !isFiniteNumber(rd.next) || !Array.isArray(rd.bases)) throw fail;
    for (const pair of rd.bases) {
      if (!Array.isArray(pair) || pair.length !== 2 || !isFiniteNumber(pair[0]) || !isFiniteNumber(pair[1])) throw fail;
    }
  }
  return raw as unknown as HamletSnapshot;
}

const BOAT_KINDS: readonly string[] = ['trading', 'transport', 'fishing'];
const BOAT_TRIPS: readonly string[] = ['idle', 'trade', 'fish', 'home'];

/**
 * Checks the boat section's shape before any of it is applied: a next id, boat rows with known kinds and trips,
 * tiles inside the realm (target may be -1), finite non-negative cargo, and [tile, tick] build pairs.
 */
function checkBoats(raw: unknown, side: number): BoatSave {
  const fail = new Error('chronicle: boat section is not valid');
  if (!isRecord(raw) || !isFiniteNumber(raw.nextId) || !Array.isArray(raw.boats) || !Array.isArray(raw.builds)) throw fail;
  const cells = side * side;
  const tile = (v: unknown, min: number): boolean => Number.isInteger(v) && (v as number) >= min && (v as number) < cells;
  const num = (v: unknown): boolean => isFiniteNumber(v);
  for (const b of raw.boats) {
    if (!isRecord(b) || !Number.isInteger(b.id) || typeof b.kind !== 'string' || !BOAT_KINDS.includes(b.kind)) throw fail;
    if (typeof b.trip !== 'string' || !BOAT_TRIPS.includes(b.trip)) throw fail;
    const xOk = Number.isInteger(b.x) && (b.x as number) >= 0 && (b.x as number) < side;
    const yOk = Number.isInteger(b.y) && (b.y as number) >= 0 && (b.y as number) < side;
    if (!xOk || !yOk || !tile(b.home, -1) || !tile(b.berth, 0) || !tile(b.target, -1)) throw fail;
    if (!num(b.hp) || !num(b.wait) || !num(b.progress) || !num(b.orphan)) throw fail;
    if (!num(b.cargoGold) || !num(b.cargoFood) || (b.cargoGold as number) < 0 || (b.cargoFood as number) < 0) throw fail;
    // Optional combat and path fields (boats.ts): a hit flag, and a planned route of tiles that ends at the target.
    if (b.hit !== undefined && typeof b.hit !== 'boolean') throw fail;
    if (b.path !== undefined && (!Array.isArray(b.path) || !b.path.every((t) => tile(t, 0)))) throw fail;
  }
  for (const pair of raw.builds) {
    if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || !isFiniteNumber(pair[1])) throw fail;
  }
  return raw as unknown as BoatSave;
}

/**
 * Checks the terrain section's shape before any of it is applied. Vents: a known kind, a tile in the realm, whole radii
 * with rMin <= rMax, whole interval and burst counts and a whole next tick. Quake: null or an origin in the realm, an even
 * list of whole step offsets within QUAKE_REACH, a position inside the list and a known mode. Shape cycle: known shape
 * indexes and a cursor no further than the cycle's end.
 */
function checkTerrain(raw: unknown, side: number): TerrainSave {
  const fail = new Error('chronicle: terrain section is not valid');
  if (!isRecord(raw) || !Array.isArray(raw.vents) || !Array.isArray(raw.shapeOrder)) throw fail;
  const whole = (v: unknown, lo: number, hi: number): boolean => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  const cells = side * side;
  for (const v of raw.vents as unknown[]) {
    if (!isRecord(v) || typeof v.kind !== 'string' || !VENT_KINDS.includes(v.kind)) throw fail;
    if (!whole(v.tile, 0, cells - 1) || !whole(v.rMin, 0, side) || !whole(v.rMax, 0, side) || (v.rMin as number) > (v.rMax as number)) throw fail;
    if (!whole(v.interval, 0, Number.MAX_SAFE_INTEGER) || !whole(v.intervalMax, 0, Number.MAX_SAFE_INTEGER) || !whole(v.burst, 0, Number.MAX_SAFE_INTEGER)) throw fail;
    if (!whole(v.next, 0, Number.MAX_SAFE_INTEGER)) throw fail;
  }
  const shapeOrder = raw.shapeOrder as unknown[];
  if (!shapeOrder.every((k) => whole(k, 0, QUAKE_SHAPE_COUNT - 1)) || !whole(raw.shapeCursor, 0, shapeOrder.length)) throw fail;
  const q = raw.quake ?? null;
  if (q !== null) {
    if (!isRecord(q) || !whole(q.ox, 0, side - 1) || !whole(q.oy, 0, side - 1) || !Array.isArray(q.steps)) throw fail;
    const steps = q.steps as unknown[];
    if (steps.length % 2 !== 0 || !steps.every((v) => whole(v, -QUAKE_REACH, QUAKE_REACH))) throw fail;
    if (!whole(q.pos, 0, steps.length / 2) || typeof q.mode !== 'string' || !QUAKE_MODES.includes(q.mode)) throw fail;
  }
  return { vents: raw.vents, quake: q, shapeOrder, shapeCursor: raw.shapeCursor } as unknown as TerrainSave;
}

/** Checks the pact section's shape; restorePacts checks the records. */
function checkPacts(raw: unknown): PactSnapshot {
  if (!isRecord(raw) || !Array.isArray(raw.pacts) || typeof raw.nextId !== 'number' || typeof raw.lastFormedTick !== 'number') {
    throw new Error('chronicle: pact section is not valid');
  }
  return raw as unknown as PactSnapshot;
}

/** Checks the shape of the lifetime section before any of it is applied. */
function parseLifetime(decoder: TextDecoder, payload: Uint8Array): { counters: Record<string, number>; sets: Record<string, string[]>; unlocked: string[] } {
  const raw = parseJson<{ counters?: unknown; sets?: unknown; unlocked?: unknown }>(decoder, payload, 'lifetime');
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (!isRecord(raw.counters) || !Object.values(raw.counters).every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('chronicle: lifetime counters are not valid');
  }
  if (!isRecord(raw.sets) || !Object.values(raw.sets).every(isStrings)) throw new Error('chronicle: lifetime sets are not valid');
  if (!isStrings(raw.unlocked)) throw new Error('chronicle: unlocked achievements are not valid');
  return { counters: raw.counters as Record<string, number>, sets: raw.sets as Record<string, string[]>, unlocked: raw.unlocked };
}

function decodeBeings(sim: Sim, r: Reader): void {
  const s = sim.beings.store;
  const capacity = r.u32();
  if (capacity !== s.capacity) throw new Error('chronicle: being capacity mismatch');
  if (r.u8() !== DECISION_ROWS.length) throw new Error('chronicle: being decision count mismatch');
  const count = r.u32();
  const seen = new Set<number>();
  // Read everything first so a corrupt section fails before any state is applied.
  const raw: { slot: number; fields: Record<string, number> }[] = [];
  for (let k = 0; k < count; k++) {
    const slot = r.u32();
    if (slot >= capacity || seen.has(slot)) throw new Error(`chronicle: bad being slot ${slot}`);
    seen.add(slot);
    const species = r.u8();
    const x = r.u16();
    const y = r.u16();
    if (species >= SPECIES.length) throw new Error(`chronicle: being ${slot} has an unknown species ${species}`);
    if (x >= sim.realm.side || y >= sim.realm.side) throw new Error(`chronicle: being ${slot} stands outside the realm`);
    const fields: Record<string, number> = {
        species,
        x,
        y,
        vit: r.i16(),
        maxVit: r.u16(),
        fuel: r.u8(),
        female: r.u8(),
        born: r.i32(),
        nextDecision: r.u32(),
        lull: r.u32(),
        expecting: r.u8(),
        expectUntil: r.u32(),
        brood: r.u8(),
        moveAcc: r.f32(),
        mate: r.i32(),
        mateGen: r.u32(),
        parent: r.i32(),
        parentGen: r.u32(),
        strain: r.u32(),
        attr0: r.u16(),
        attr1: r.u16(),
        attr2: r.u16(),
        attr3: r.u16(),
        mark0: r.u32(),
        mark1: r.u32(),
        mark2: r.u32(),
        mark3: r.u32(),
        mark4: r.u32(),
        mood: r.i16(),
        endurance: r.u16(),
        sleepUntil: r.u32(),
        sleepVit: r.i16(),
        bondWith: r.i32(),
        bondGen: r.u32(),
        closeWith: r.i32(),
        closeGen: r.u32(),
        closeSince: r.u32(),
        task: r.i16(),
    };
    for (let c = 0; c < DECISION_ROWS.length; c++) fields[`cool${c}`] = r.u32();
    fields['morph'] = r.u8();
    fields['caste'] = r.u8();
    fields['palette'] = r.u8();
    fields['shade'] = r.u8();
    fields['reborn'] = r.u8();
    fields['searchAt'] = r.u32();
    for (let k = 0; k < AGGRO_SLOTS; k++) {
      fields[`agId${k}`] = r.i32();
      fields[`agGen${k}`] = r.u32();
      fields[`agUntil${k}`] = r.u32();
    }
    fields['shelledUntil'] = r.u32();
    fields['rooted'] = r.u8();
    fields['loverWith'] = r.i32();
    fields['loverGen'] = r.u32();
    fields['friendWith'] = r.i32();
    fields['friendGen'] = r.u32();
    // Shape checks (schema 4): mood in range, endurance within the species maximum, bond links name a
    // being in this save (checked below once every slot is known).
    if ((fields['mood'] ?? 0) < -100 || (fields['mood'] ?? 0) > 100) throw new Error(`chronicle: being ${slot} has a mood out of range`);
    if ((fields['endurance'] ?? 0) > sim.beings.species(species).endurance) throw new Error(`chronicle: being ${slot} has endurance above its species`);
    // Shape checks (schema 5): variant indices name catalogue entries, the shade is 0..3, the rebirth flag is 0 or 1.
    if ((fields['morph'] ?? 0) > MORPHS.length) throw new Error(`chronicle: being ${slot} has an unknown morph`);
    if ((fields['caste'] ?? 0) > CASTES.length) throw new Error(`chronicle: being ${slot} has an unknown caste`);
    if ((fields['palette'] ?? 0) >= PALETTES.length) throw new Error(`chronicle: being ${slot} has an unknown palette`);
    if ((fields['shade'] ?? 0) > 3) throw new Error(`chronicle: being ${slot} has a shade out of range`);
    if ((fields['reborn'] ?? 0) > 1) throw new Error(`chronicle: being ${slot} has a bad rebirth flag`);
    // Shape checks (schema 6): the rooted flag is 0 or 1; a shelled egg has an end tick (0 is no egg).
    if ((fields['rooted'] ?? 0) > 1) throw new Error(`chronicle: being ${slot} has a bad rooting flag`);
    if ((fields['shelledUntil'] ?? 0) < 0) throw new Error(`chronicle: being ${slot} has a bad egg end tick`);
    raw.push({ slot, fields });
  }
  const generation: number[] = [];
  for (let slot = 0; slot < capacity; slot++) generation.push(r.u32());
  const listLen = r.u32();
  const list: number[] = [];
  for (let k = 0; k < listLen; k++) list.push(r.u32());
  const freeLen = r.u32();
  const free: number[] = [];
  for (let k = 0; k < freeLen; k++) free.push(r.u32());
  const codeCount = r.u32();
  const codes: [number, Genome][] = [];
  for (let k = 0; k < codeCount; k++) codes.push(readLineageCode(r));
  if (r.remaining !== 0) throw new Error('chronicle: trailing bytes in beings section');

  // The layout must describe exactly the live slots and the dead ones, each once.
  if (listLen !== count || new Set(list).size !== count || list.some((slot) => !seen.has(slot))) {
    throw new Error('chronicle: being list does not match the live records');
  }
  if (freeLen + count !== capacity) throw new Error('chronicle: free stack size mismatch');
  // Every strain has exactly one lineage code, and each code names a strain in the registry.
  const codeIds = new Set(codes.map(([id]) => id));
  if (codeIds.size !== codeCount || codeCount !== sim.beings.strains.size) throw new Error('chronicle: lineage codes do not match the strains');
  for (const [id] of codes) if (!sim.beings.strains.get(id)) throw new Error(`chronicle: lineage code names a missing strain ${id}`);
  for (const rec of raw) {
    for (const link of [rec.fields['bondWith'] ?? -1, rec.fields['closeWith'] ?? -1, rec.fields['loverWith'] ?? -1, rec.fields['friendWith'] ?? -1]) {
      if (link !== -1 && !seen.has(link)) throw new Error(`chronicle: being ${rec.slot} names a missing bond partner`);
    }
    // Aggro entries are empty (-1) or name an attacker slot. An entry whose attacker is no longer current (the slot
    // was reused, or the attacker died and its generation moved on) counts for nothing and is kept as saved; only an
    // entry whose attacker is still current (generation matches) must name a Being in this save (aggro.ts `live`).
    for (let k = 0; k < AGGRO_SLOTS; k++) {
      const id = rec.fields[`agId${k}`] ?? -1;
      if (id === -1) continue;
      if (id < 0 || id >= capacity) throw new Error(`chronicle: being ${rec.slot} names a missing aggro attacker`);
      const current = generation[id] === (rec.fields[`agGen${k}`] ?? 0);
      if (current && !seen.has(id)) throw new Error(`chronicle: being ${rec.slot} names a missing aggro attacker`);
    }
  }

  // The running task is saved so a loaded run continues exactly as the live one (07 section 14 leaves this open).
  sim.beings.task.fill(-1);
  sim.beings.cooldown.fill(0);
  for (const rec of raw) {
    const f = rec.fields;
    const slot = rec.slot;
    s.alive[slot] = 1;
    s.species[slot] = f['species'] ?? 0;
    s.x[slot] = f['x'] ?? 0;
    s.y[slot] = f['y'] ?? 0;
    s.vit[slot] = f['vit'] ?? 0;
    s.maxVit[slot] = f['maxVit'] ?? 0;
    s.fuel[slot] = f['fuel'] ?? 0;
    s.female[slot] = f['female'] ?? 0;
    s.born[slot] = f['born'] ?? 0;
    s.nextDecision[slot] = f['nextDecision'] ?? 0;
    s.lull[slot] = f['lull'] ?? 0;
    s.expecting[slot] = f['expecting'] ?? 0;
    s.expectUntil[slot] = f['expectUntil'] ?? 0;
    s.brood[slot] = f['brood'] ?? 0;
    s.moveAcc[slot] = f['moveAcc'] ?? 0;
    s.mate[slot] = f['mate'] ?? -1;
    s.mateGen[slot] = f['mateGen'] ?? 0;
    s.parent[slot] = f['parent'] ?? -1;
    s.parentGen[slot] = f['parentGen'] ?? 0;
    s.strain[slot] = f['strain'] ?? 0;
    for (let k = 0; k < 4; k++) s.attrs[slot * 4 + k] = f[`attr${k}`] ?? 0;
    for (let k = 0; k < 5; k++) s.marks[slot * 5 + k] = f[`mark${k}`] ?? 0;
    if (!sim.beings.strains.get(s.strain[slot] ?? 0)) throw new Error(`chronicle: being ${slot} names a missing strain`);
    s.mood[slot] = f['mood'] ?? 0;
    s.endurance[slot] = f['endurance'] ?? 0;
    s.sleepUntil[slot] = f['sleepUntil'] ?? 0;
    s.sleepVit[slot] = f['sleepVit'] ?? 0;
    s.bondWith[slot] = f['bondWith'] ?? -1;
    s.bondGen[slot] = f['bondGen'] ?? 0;
    s.closeWith[slot] = f['closeWith'] ?? -1;
    s.closeGen[slot] = f['closeGen'] ?? 0;
    s.closeSince[slot] = f['closeSince'] ?? 0;
    sim.beings.task[slot] = f['task'] ?? -1;
    for (let c = 0; c < DECISION_ROWS.length; c++) sim.beings.cooldown[slot * DECISION_ROWS.length + c] = f[`cool${c}`] ?? 0;
    s.morph[slot] = f['morph'] ?? 0;
    s.caste[slot] = f['caste'] ?? 0;
    s.palette[slot] = f['palette'] ?? 0;
    s.shade[slot] = f['shade'] ?? 0;
    s.reborn[slot] = f['reborn'] ?? 0;
    s.searchAt[slot] = f['searchAt'] ?? 0;
    s.shelledUntil[slot] = f['shelledUntil'] ?? 0;
    s.rooted[slot] = f['rooted'] ?? 0;
    s.loverWith[slot] = f['loverWith'] ?? -1;
    s.loverGen[slot] = f['loverGen'] ?? 0;
    s.friendWith[slot] = f['friendWith'] ?? -1;
    s.friendGen[slot] = f['friendGen'] ?? 0;
    for (let k = 0; k < AGGRO_SLOTS; k++) {
      const i = slot * AGGRO_SLOTS + k;
      s.aggroId[i] = f[`agId${k}`] ?? -1;
      s.aggroGen[i] = f[`agGen${k}`] ?? 0;
      s.aggroUntil[i] = f[`agUntil${k}`] ?? 0;
    }
  }
  for (let slot = 0; slot < capacity; slot++) s.generation[slot] = generation[slot] ?? 0;
  s.restoreLayout(list, free);
  for (const [id, code] of codes) sim.beings.strains.setGenome(id, code);
  // Child counts and the derived stats are not saved: both are rebuilt from the restored records.
  s.rebuildChildCounts();
  for (const rec of raw) refreshStats(sim, rec.slot);
}

/**
 * Reads one lineage code (beings round 7) with its shape checks: known strand types, kind codes in the library,
 * specials in 0..2, every usable slot holding a kind, and at least one usable slot per strand.
 */
function readLineageCode(r: Reader): [number, Genome] {
  const id = r.u32();
  const seedSalt = r.u32();
  if (seedSalt >= SEED_SALT_RANGE) throw new Error(`chronicle: lineage code of strain ${id} has a bad seed salt`);
  const strandCount = r.u8();
  if (strandCount < 1) throw new Error(`chronicle: lineage code of strain ${id} has no strands`);
  const strands: Strand[] = [];
  for (let s = 0; s < strandCount; s++) {
    const type = STRAND_TYPES[r.u8()];
    if (!type) throw new Error(`chronicle: lineage code of strain ${id} has an unknown strand type`);
    const slots: (string | null)[] = [];
    const specials: Strand['specials'] = [];
    let blocked = 0;
    for (let i = 0; i < strandCapacity(type); i++) {
      const kindCode = r.u8();
      const specialCode = r.u8();
      if (kindCode > SEGMENT_KINDS.length) throw new Error(`chronicle: lineage code of strain ${id} has an unknown segment`);
      if (specialCode > 2) throw new Error(`chronicle: lineage code of strain ${id} has an unknown special`);
      const kind = kindCode === 0 ? null : (SEGMENT_KINDS[kindCode - 1]?.id ?? null);
      const special: Strand['specials'][number] = specialCode === 1 ? 'booster' : specialCode === 2 ? 'blocked' : null;
      if (special === 'blocked') {
        blocked++;
        if (kind !== null) throw new Error(`chronicle: lineage code of strain ${id} has a segment on a blocked slot`);
      } else if (kind === null) {
        throw new Error(`chronicle: lineage code of strain ${id} has an empty usable slot`);
      }
      slots.push(kind);
      specials.push(special);
    }
    if (blocked >= strandCapacity(type)) throw new Error(`chronicle: lineage code of strain ${id} has no usable slot`);
    strands.push({ type, slots, specials });
  }
  return [id, { strands, seedSalt }];
}

/** Restores the strain registry (section 17). Traits are kept only when the content still defines them. */
function decodeStrains(sim: Sim, data: { next: number; list: Strain[] }): void {
  if (!Array.isArray(data.list) || !Number.isInteger(data.next)) throw new Error('chronicle: strains section is not valid');
  const ids = new Set<number>();
  for (const st of data.list) {
    if (!Number.isInteger(st.id) || st.id < 1 || ids.has(st.id) || st.id >= data.next) throw new Error('chronicle: bad strain id');
    ids.add(st.id);
    if (!Number.isInteger(st.species) || st.species < 0 || st.species >= SPECIES.length) throw new Error(`chronicle: strain ${st.id} has an unknown species`);
    st.traits = st.traits.filter((t) => STRAIN_TRAIT_BY_ID.has(t));
    // Round 8 (schema 5): counters are filled to the current set; the palette list must name palettes.
    st.counters = { ...freshCounters(), ...st.counters };
    if (!Array.isArray(st.phenotypes) || st.phenotypes.length === 0) st.phenotypes = [0];
    if (st.phenotypes.some((p) => !Number.isInteger(p) || p < 0 || p >= PALETTES.length)) {
      throw new Error(`chronicle: strain ${st.id} has a bad palette list`);
    }
  }
  sim.beings.strains.restore(data);
}
