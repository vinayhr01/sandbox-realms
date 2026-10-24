import { TICK_MS } from '../shared/constants.ts';
import { Cmd, type Command, type Speed } from '../shared/protocol.ts';
import { createRng, type Rng } from '../shared/rng.ts';
import { groundKey } from '../content/grounds.ts';
import { biomeOfCover, BIOMES } from '../content/biomes.ts';
import { applyStroke } from './brush.ts';
import { ageDef, newAgeState, tickAge, type AgeState, type AgeDef, AGE_BY_ID } from './ages.ts';
import { calendar, ssToTicks, SS_TICKS, type Calendar } from './clock.ts';
import { emptyStats, type StatsRecord } from './stats.ts';
import { recordStat, unlockAchievements } from './stats-hooks.ts';
import { Realm } from './realm.ts';
import { RuleSet, ageRuleId } from './rules.ts';
import { Runner } from './runner.ts';
import { heatStep } from './terrain/heat.ts';
import { magmaSweep } from './terrain/magma.ts';
import { seaRefill } from './terrain/water.ts';
import { fireSweep, scarFade } from './terrain/fire.ts';
import { freezeSweep, summitFreeze, thawSweep } from './terrain/freeze.ts';
import { biomeSweep } from './terrain/biome-spread.ts';
import { droughtPass, floraPass, floraSpreadStep, frostPass, mineralSeeding, wildSeeding } from './flora.ts';
import { quakeStep } from './terrain/quake.ts';
import { slimeSweep } from './terrain/slime.ts';
import { eruptionStep } from './terrain/eruption.ts';
import { creepStep } from './terrain/creep.ts';
import { Beings } from './beings/system.ts';
import { TUNING } from './beings/tuning.ts';
import { EffectStore, MAX_EFFECTS, STATUSES, UNTIL_CLEARED } from './effects.ts';
import { CombatState, applyDamage, stepProjectiles, type CombatContext, type Projectile } from './combat.ts';
import { ExplosionGuard, type ExplosionContext } from './explosions.ts';
import { createWeatherState, weatherStep, type WeatherContext, type WeatherState } from './weather.ts';
import { rainDrop } from './terrain/water.ts';
import { freeze, } from './terrain/freeze.ts';
import { startFire } from './terrain/fire.ts';
import { stepBeings, killBeing } from './beings/system.ts';
import { settlementsStep } from './settlements/adapter.ts';
import { stepDominions } from './dominions/adapter.ts';
import { cultureTick, createCultureState, type CultureState } from './culture/adapter.ts';
import { rollAndRunCalamity, usePowerById } from './powers/handlers.ts';
import { buildSnapshot } from './snapshot.ts';
import type { Snapshot } from '../shared/protocol.ts';

export { TICK_MS };

/** Speed -> ticks allowed per pump (17 section 3.1). The tick length never changes. */
export const MAX_TICKS_PER_PUMP: Readonly<Record<Speed, number>> = { 0: 0, 0.5: 1, 1: 1, 2: 2, 5: 5, 10: 10 };

/** FNV-1a of a name, mixed with the realm seed; names key the independent RNG streams. */
function streamSeed(seed: number, name: string): number {
  let h = 0x811c9dc5 ^ seed;
  for (let k = 0; k < name.length; k++) {
    h ^= name.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic simulation core. Owns the Realm, the clock, the Ages and Realm Rules, the named
 * RNG streams and the periodic/behaviour schedule. No timers, no DOM: the worker drives `step()`.
 * Player commands are queued and applied at the start of the next tick (17 section 2.2), or
 * immediately via `applyQueued()` while paused.
 */
export class Sim {
  readonly realm: Realm;
  readonly rules = new RuleSet();
  readonly beings: Beings;
  readonly effects: EffectStore;
  readonly combat: CombatState;
  readonly guard = new ExplosionGuard();
  readonly projectiles: Projectile[] = [];
  weather: WeatherState = createWeatherState();
  readonly culture: CultureState = createCultureState();
  /** Lifetime counters (14 section 3). Counted from events; never read back by the sim. */
  lifetime: StatsRecord = emptyStats();
  /** Achievement ids unlocked so far (14 section 2). Each id is added once and never removed. */
  readonly unlocked = new Set<string>();
  ages: AgeState;
  tick = 0;
  private queue: Command[] = [];
  private readonly streams = new Map<string, Rng>();
  private readonly runners = new Map<string, Runner>();
  /** Behaviour timers: tick at which each behaviour next runs (02 section 7). */
  private readonly timers = new Map<string, number>();
  /** Calamity cooldowns: calamity id -> tick it may next occur (02 section 8.1; saved in the Chronicle). */
  readonly calamityCooldowns = new Map<string, number>();

  constructor(seed: number, sizeStep: number) {
    this.realm = new Realm(seed, sizeStep);
    this.beings = new Beings(this.realm.side);
    this.effects = new EffectStore(this.beings.store.capacity);
    this.combat = new CombatState(this.beings.store.capacity);
    this.ages = newAgeState(this.rng('age'), 0);
  }

  /** Independent named RNG stream (17 section 7.1). Stateful: the same name continues its sequence. */
  rng(name: string): Rng {
    let r = this.streams.get(name);
    if (!r) {
      r = createRng(streamSeed(this.realm.seed, name));
      this.streams.set(name, r);
    }
    return r;
  }

  /** Shuffled tile runner with its own stream (01 section 12.3). */
  runner(name: string): Runner {
    let r = this.runners.get(name);
    if (!r) {
      r = new Runner(this.realm.tileCount, this.rng(`runner:${name}`));
      this.runners.set(name, r);
    }
    return r;
  }

  /** Saved form of every named RNG stream, behaviour timer and tile runner (for the Chronicle). */
  streamState(): { streams: Record<string, number[]>; timers: Record<string, number>; runners: Record<string, { order: number[]; cursor: number }> } {
    const streams: Record<string, number[]> = {};
    for (const [name, r] of this.streams) streams[name] = r.state();
    const timers: Record<string, number> = {};
    for (const [name, t] of this.timers) timers[name] = t;
    const runners: Record<string, { order: number[]; cursor: number }> = {};
    for (const [name, r] of this.runners) runners[name] = r.snapshot();
    return { streams, timers, runners };
  }

  /** Restores what streamState() saved. Runners must be created before restore (their order is saved). */
  loadStreamState(saved: { streams: Record<string, number[]>; timers: Record<string, number>; runners: Record<string, { order: number[]; cursor: number }> }): void {
    // Creating a runner draws from its RNG stream, so runners come first and streams are restored last.
    this.runners.clear();
    for (const [name, snap] of Object.entries(saved.runners)) this.runner(name).restore(snap);
    this.streams.clear();
    for (const [name, words] of Object.entries(saved.streams)) this.rng(name).restore(words);
    this.timers.clear();
    for (const [name, t] of Object.entries(saved.timers)) this.timers.set(name, t);
  }

  ageDef(): AgeDef {
    return ageDef(this.ages);
  }

  /** Biome def of a cover, or null when the cover is not a biome. */
  biomeAt(i: number): (typeof BIOMES)[number] | null {
    const idx = biomeOfCover(this.realm.cover[i] ?? 0);
    return idx >= 0 ? (BIOMES[idx] ?? null) : null;
  }

  enqueue(command: Command): void {
    this.queue.push(command);
  }

  /** Applies one power (content/powers.ts id) at tile (x,y) now. Returns true when it ran; direct call, between ticks. */
  usePower(id: string, x: number, y: number): boolean {
    const ran = usePowerById(this, id, x, y);
    if (ran) recordStat(this, { kind: 'power.used', power: id });
    return ran;
  }

  /** Runs the calamity roll and counts each calamity whose cooldown was set by this roll (14 section 3). */
  private rollCalamityCounted(): void {
    const before = new Map(this.calamityCooldowns);
    rollAndRunCalamity(this);
    for (const [id, until] of this.calamityCooldowns) {
      if (before.get(id) !== until) recordStat(this, { kind: 'calamity.fired', calamity: id });
    }
  }

  /** Applies queued commands without advancing the clock (paused edit mode, 17 section 3.1). */
  applyQueued(): void {
    if (this.queue.length === 0) return;
    const pending = this.queue;
    this.queue = [];
    for (const cmd of pending) this.apply(cmd);
  }

  /** Advances one tick: queued player actions first, then world systems in fixed order (02 section 4). */
  step(): void {
    this.applyQueued();
    this.tick++;
    this.advanceAge();
    this.runTerrain();
    this.runBehaviours();
    settlementsStep(this);
    cultureTick(this);
    stepBeings(this);
    this.runCombatAndWeather();
    stepDominions(this);
    if (this.due('achievements', SS_TICKS)) unlockAchievements(this);
  }

  /** Combat context for this sim (structural, see combat.ts). */
  combatContext(): CombatContext {
    return {
      beings: { store: this.beings.store, kill: (slot, cause) => killBeing(this, slot, cause) },
      effects: this.effects,
      combat: this.combat,
      tick: this.tick,
      rng: this.rng('combat'),
      might: (slot) => this.beings.species(this.beings.store.species[slot] ?? 0).might,
    };
  }

  explosionContext(): ExplosionContext {
    return { ...this.combatContext(), realm: this.realm, guard: this.guard, startFire: (tile, force) => startFire(this, tile, force) };
  }

  /** Being occupying a tile, or -1. Linear scan: only used for projectile impacts. */
  beingAt(x: number, y: number): number {
    const s = this.beings.store;
    for (let k = 0; k < s.size; k++) {
      const slot = s.at(k);
      if ((s.x[slot] ?? -1) === x && (s.y[slot] ?? -1) === y) return slot;
    }
    return -1;
  }

  /** Status timers, periodic status damage, projectiles, blast guard and weather (02 section 4, 08). */
  private runCombatAndWeather(): void {
    const s = this.beings.store;
    for (let k = s.size - 1; k >= 0; k--) {
      const slot = s.at(k);
      this.effects.expire(slot, this.tick);
      for (let e = 0; e < MAX_EFFECTS; e++) {
        const code = this.effects.code[slot * MAX_EFFECTS + e] ?? 0;
        const def = code > 0 ? STATUSES[code - 1] : undefined;
        if (!def || def.every <= 0 || this.tick % def.every !== 0) continue;
        const amount = Math.max(1, Math.floor((s.maxVit[slot] ?? 0) * def.fraction));
        applyDamage(this.combatContext(), slot, amount, 'Poison', false);
        if (s.alive[slot] !== 1) break;
      }
    }
    if (this.projectiles.length > 0) {
      stepProjectiles(this.combatContext(), this.projectiles, (x, y) => this.beingAt(x, y));
    }
    this.guard.decay();
    const weatherCtx: WeatherContext = {
      realm: this.realm,
      rng: this.rng('weather'),
      tick: this.tick,
      isOn: (id) => this.rules.isOn(id),
      ageClouds: this.ageDef().clouds,
      cloudIntervalSs: 15,
      rainDrop: (tile) => {
        recordStat(this, { kind: 'counter.add', name: 'rainTiles' });
        return rainDrop(this, tile);
      },
      freeze: (tile) => freeze(this, tile),
      startFire: (tile, force) => startFire(this, tile, force),
      blast: this.explosionContext(),
    };
    weatherStep(weatherCtx, this.weather);
  }

  private apply(cmd: Command): void {
    switch (cmd.kind) {
      case Cmd.Stroke:
        applyStroke(this.realm, cmd.op, cmd.shape, cmd.size, cmd.x0, cmd.y0, cmd.x1, cmd.y1, cmd.includeStart);
        break;
      case Cmd.Power:
        usePowerById(this, cmd.powerId, cmd.x, cmd.y);
        break;
      case Cmd.SetRule:
        this.rules.set(cmd.rule, cmd.on);
        break;
      default:
        break;
    }
  }

  /** True on the ticks where a periodic system runs. The phase is derived from its name (04 section 11). */
  due(name: string, period: number): boolean {
    const phase = streamSeed(0, name) % period;
    return (this.tick + phase) % period === 0;
  }

  private advanceAge(): void {
    tickAge(this.ages, this.rng('age'), this.tick, (id) => this.rules.isOn(ageRuleId(id)));
  }

  private runTerrain(): void {
    const r = this.realm;
    const side = r.side;
    if (this.due('fireSweep', 20)) fireSweep(this);
    if (this.due('heat', 20)) heatStep(this);
    quakeStep(this);
    if (this.due('seaRefill', 4)) seaRefill(this);
    if (this.due('slime', 2)) slimeSweep(this);
    if (this.due('magma', 2) && r.molten.size > 0) magmaSweep(this);
    eruptionStep(this);
    const bonus = this.ageDef().biomeGrowthBonus;
    if (this.due('biome', 2)) biomeSweep(this, Math.floor(side / 16) * (5 + bonus));
    if (this.due('freeze', 2) && this.ageDef().freezeWorld) freezeSweep(this, Math.floor(side / 16) * 10);
    if (this.due('thaw', 2) && this.ageDef().thawWorld && !this.rules.isOn('eternal_cold')) {
      thawSweep(this, Math.floor(side / 16) * 10);
    }
    creepStep(this);
    if (this.due('mineral', 40)) mineralSeeding(this, 3);
    floraSpreadStep(this);
  }

  /** Behaviour runner: `timer -= 1; when <= 0 run; reset to interval + random` (02 section 7). */
  private behaviour(name: string, intervalSs: number, randomSs: number, run: () => void): void {
    const next = this.timers.get(name);
    if (next === undefined) {
      this.timers.set(name, this.tick + ssToTicks(intervalSs));
      return;
    }
    if (this.tick < next) return;
    run();
    const jitter = randomSs > 0 ? this.rng(`beh:${name}`).int(ssToTicks(randomSs) + 1) : 0;
    this.timers.set(name, this.tick + ssToTicks(intervalSs) + jitter);
  }

  private runBehaviours(): void {
    const age = this.ageDef();
    this.behaviour('calamity', 80, 0, () => this.rollCalamityCounted());
    this.behaviour('scarFade', 3, 5, () => scarFade(this));
    this.behaviour('summitFreeze', 10, 50, () => {
      if (age.id !== 'scorch') summitFreeze(this);
    });
    this.behaviour('wildSeeding', 10, 10, () => {
      if (this.rules.isOn('wild_seeding') && age.growVegetation) wildSeeding(this, TUNING.wildAttempts);
    });
    this.behaviour('floraPass', 5, 5, () => floraPass(this, Math.ceil(this.realm.tileCount * TUNING.floraCoverage / 8)));
    this.behaviour('droughtPass', 7, 0, () => {
      if (age.id === 'scorch') droughtPass(this, 5);
    });
    this.behaviour('frostPass', 10, 0, () => {
      if (age.freezeWorld) frostPass(this, 5);
    });
  }

  get currentAge(): string {
    return this.ages.current;
  }

  /** Calendar read-out from ticks (02 section 1). */
  get calendar(): Calendar {
    return calendar(this.tick);
  }

  /** Ages by display name, for the HUD. */
  ageName(): string {
    return AGE_BY_ID.get(this.ages.current)?.name ?? this.ages.current;
  }

  /** Read-only snapshot for the UI (src/sim/snapshot.ts). Writes nothing and draws no randomness. */
  snapshot(): Snapshot {
    return buildSnapshot(this);
  }

  /** Stable FNV-1a hash over the authoritative state plus the tick (replay checkpoint). */
  stateHash(): number {
    let h = 0x811c9dc5;
    h = fnv(h, this.tick);
    h = fnv(h, this.ages.elapsed);
    h = fnvBytes(h, this.realm.elevation);
    h = fnvBytes(h, this.realm.ground);
    h = fnvBytes(h, this.realm.cover);
    h = fnvBytes(h, new Uint8Array(this.realm.flags.buffer));
    h = fnvBytes(h, new Uint8Array(this.realm.heat.buffer));
    h = fnvBytes(h, this.realm.scar);
    h = fnvBytes(h, this.realm.flora);
    h = fnvBytes(h, new Uint8Array(this.realm.floraBlockedUntil.buffer));
    h = fnvBytes(h, new Uint8Array(this.beings.store.x.buffer));
    h = fnvBytes(h, new Uint8Array(this.beings.store.y.buffer));
    h = fnvBytes(h, new Uint8Array(this.beings.store.vit.buffer));
    h = fnvBytes(h, this.beings.store.alive);
    return h >>> 0;
  }

  tileInfo(x: number, y: number): { elevation: number; ground: string; cover: number; flora: number; burning: boolean; frozen: boolean } | null {
    if (!this.realm.inBounds(x, y)) return null;
    const i = y * this.realm.side + x;
    return {
      elevation: this.realm.elevation[i] ?? 0,
      ground: groundKey(this.realm.ground[i] ?? 0),
      cover: this.realm.cover[i] ?? 0,
      flora: this.realm.flora[i] ?? 0,
      burning: this.realm.hasFlag(i, 1 << 1),
      frozen: this.realm.hasFlag(i, 1 << 0),
    };
  }
}

function fnv(h: number, v: number): number {
  let x = h;
  for (let s = 0; s < 32; s += 8) {
    x ^= (v >>> s) & 0xff;
    x = Math.imul(x, 0x01000193);
  }
  return x >>> 0;
}

function fnvBytes(h: number, bytes: Uint8Array): number {
  let x = h;
  for (let i = 0; i < bytes.length; i++) {
    x ^= bytes[i] ?? 0;
    x = Math.imul(x, 0x01000193);
  }
  return x >>> 0;
}

