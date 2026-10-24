import type { AgeState } from './ages.ts';
import { Sim } from './sim.ts';
import type { WeatherState } from './weather.ts';
import type { Projectile } from './combat.ts';
import { culturePayload, cultureFromPayload, type CulturePayload } from './culture/adapter.ts';
import { snapshotDominions, restoreDominions, type DominionSnapshot } from './dominions/adapter.ts';
import { snapshotHamlets, restoreHamlets, type HamletSnapshot } from './settlements/adapter.ts';
import { refreshStats } from './beings/system.ts';
import { restoreItems, saveItems, type ItemSave } from './items/system.ts';
import { SPECIES } from '../content/beasts.ts';
import { STRAIN_TRAIT_BY_ID } from '../content/traits.ts';
import type { Strain } from './beings/strains.ts';
import { restoreClans, type ClanState } from './clans/clans.ts';

/**
 * Chronicle save codec (15-chronicle-saves, section 3 in spirit): a versioned, sectioned binary
 * format with a trailing checksum. Little-endian throughout; typed arrays are written as raw bytes,
 * so the codec assumes a little-endian host (every supported browser is).
 *
 * Layout: header (magic 'SRCH', u16 format, u16 schema, u32 content hash placeholder, u32 body
 * length), body (sections: u8 tag, u32 length, payload), trailer (u32 FNV-1a of the body).
 *
 * Covered: clock, realm arrays, ages, rules, stats, beings (with generations and exact list and
 * free-stack order), RNG streams, behaviour timers, tile runners, combat state, status effects and
 * weather (clouds, blast guard, projectiles), and the lifetime stats with the unlocked achievements
 * (optional section: saves written before it existed still load, with empty stats), and the dominion
 * state (tag 15: dominions, relations, borders, owner bytes) and the hamlet state (tag 16), both optional
 * so older saves still load with no dominions or hamlets. A save
 * continued to any later tick matches an uninterrupted run (tests/unit/chronicle.test.ts). The pending command queue is empty between
 * ticks by construction, so it is not written.
 */
export const CHRONICLE_MAGIC = 'SRCH';
export const FORMAT_VERSION = 1;
/**
 * Schema 3 (beings round 2): the beings section carries each Being's parent link (slot and generation,
 * 06 section 6.1), strain id, stored aptitudes and marks; section 17 holds the strain registry. Schema 2
 * saves are rejected: they have no parent links or strains to restore.
 */
export const SCHEMA_VERSION = 3;
const HEADER_BYTES = 16;

const TAG = { clock: 1, realm: 2, ages: 3, rules: 4, stats: 5, beings: 6, streams: 7, runners: 8, combat: 9, effects: 10, weather: 11, culture: 12, calamity: 13, lifetime: 14, dominions: 15, hamlets: 16, strains: 17, clans: 18, items: 19 } as const;
/** Sections a save may lack (written by later builds); absent means the empty default. */
const OPTIONAL_TAGS: readonly number[] = [TAG.culture, TAG.calamity, TAG.lifetime, TAG.dominions, TAG.hamlets, TAG.clans, TAG.items];
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

/** FNV-1a over raw bytes (the same hash as Sim.stateHash). */
export function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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
    }
    // Full generation table (dead slots keep their counters) and the exact list and free-stack order.
    for (let slot = 0; slot < s.capacity; slot++) w.u32(s.generation[slot] ?? 0);
    const layout = s.layout();
    w.u32(layout.list.length);
    for (const slot of layout.list) w.u32(slot);
    w.u32(layout.free.length);
    for (const slot of layout.free) w.u32(slot);
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
  if (sizeStep < 2 || sizeStep > 9) throw new Error(`chronicle: size step ${sizeStep} out of range`);
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
  sim.ages = parseJson<AgeState>(decoder, sections.get(TAG.ages), 'ages');
  const rules = parseJson<Record<string, boolean>>(decoder, sections.get(TAG.rules), 'rules');
  for (const [id, on] of Object.entries(rules)) sim.rules.set(id, on);
  const stats = parseJson<Record<string, number>>(decoder, sections.get(TAG.stats), 'stats');
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
  const weatherPayload = parseJson<{ weather: WeatherState; guard: number; projectiles: Projectile[] }>(decoder, sections.get(TAG.weather), 'weather');
  sim.weather = weatherPayload.weather;
  sim.guard.level = weatherPayload.guard;
  sim.projectiles.length = 0;
  sim.projectiles.push(...weatherPayload.projectiles);
  const streamPayload = parseJson<{ streams: Record<string, number[]>; timers: Record<string, number> }>(decoder, sections.get(TAG.streams), 'streams');
  const runnerPayload = parseJson<Record<string, { order: number[]; cursor: number }>>(decoder, sections.get(TAG.runners), 'runners');
  sim.loadStreamState({ streams: streamPayload.streams, timers: streamPayload.timers, runners: runnerPayload });
  const cultureBytes = sections.get(TAG.culture);
  if (cultureBytes) Object.assign(sim.culture, cultureFromPayload(parseJson<CulturePayload>(decoder, cultureBytes, 'culture')));
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
    const snap = parseJson<DominionSnapshot | null>(decoder, dominionBytes, 'dominions');
    if (snap) restoreDominions(sim, snap);
  }
  const hamletBytes = sections.get(TAG.hamlets);
  if (hamletBytes) {
    const snap = parseJson<HamletSnapshot | null>(decoder, hamletBytes, 'hamlets');
    if (snap) restoreHamlets(sim, snap);
  }
  const clanBytes = sections.get(TAG.clans);
  if (clanBytes) restoreClans(sim.clans, parseJson<ClanState>(decoder, clanBytes, 'clans'));

  const itemBytes = sections.get(TAG.items);
  if (itemBytes) restoreItems(sim, parseJson<ItemSave>(decoder, itemBytes, 'items'));

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
  const count = r.u32();
  const seen = new Set<number>();
  // Read everything first so a corrupt section fails before any state is applied.
  const raw: { slot: number; fields: Record<string, number> }[] = [];
  for (let k = 0; k < count; k++) {
    const slot = r.u32();
    if (slot >= capacity || seen.has(slot)) throw new Error(`chronicle: bad being slot ${slot}`);
    seen.add(slot);
    raw.push({
      slot,
      fields: {
        species: r.u8(),
        x: r.u16(),
        y: r.u16(),
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
      },
    });
  }
  const generation: number[] = [];
  for (let slot = 0; slot < capacity; slot++) generation.push(r.u32());
  const listLen = r.u32();
  const list: number[] = [];
  for (let k = 0; k < listLen; k++) list.push(r.u32());
  const freeLen = r.u32();
  const free: number[] = [];
  for (let k = 0; k < freeLen; k++) free.push(r.u32());
  if (r.remaining !== 0) throw new Error('chronicle: trailing bytes in beings section');

  // The layout must describe exactly the live slots and the dead ones, each once.
  if (listLen !== count || new Set(list).size !== count || list.some((slot) => !seen.has(slot))) {
    throw new Error('chronicle: being list does not match the live records');
  }
  if (freeLen + count !== capacity) throw new Error('chronicle: free stack size mismatch');

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
  }
  for (let slot = 0; slot < capacity; slot++) s.generation[slot] = generation[slot] ?? 0;
  s.restoreLayout(list, free);
  // Child counts and the derived stats are not saved: both are rebuilt from the restored records.
  s.rebuildChildCounts();
  for (const rec of raw) refreshStats(sim, rec.slot);
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
  }
  sim.beings.strains.restore(data);
}
