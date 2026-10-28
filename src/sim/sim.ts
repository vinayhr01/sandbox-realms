import { TICK_MS } from '../shared/constants.ts';
import { Cmd, POSSESS_REFUSED, type Command } from '../shared/protocol.ts';
import { createRng, fnv1a, FNV_OFFSET, type Rng } from '../shared/rng.ts';
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
import { CombatState, applyDamage, stepProjectiles, tickAttackTimers, type CombatContext, type Projectile } from './combat.ts';
import { landProjectile, launchProjectile, shootStep } from './projectiles.ts';
import { ExplosionGuard, type ExplosionContext } from './explosions.ts';
import { createWeatherState, weatherStep, type WeatherContext, type WeatherState } from './weather.ts';
import { rainDrop } from './terrain/water.ts';
import { freeze, } from './terrain/freeze.ts';
import { startFire } from './terrain/fire.ts';
import { stepBeings, killBeing } from './beings/system.ts';
import { hamletsAtWar, hamletsOf, settlementsStep } from './settlements/adapter.ts';
import { boatsStep } from './boats/boats.ts';
import { hasTrait } from './beings/afflictions.ts';
import { captureTick, dominionsYearly, stepDominions } from './dominions/adapter.ts';
import { cultureTick, createCultureState, type CultureState } from './culture/adapter.ts';
import { rollAndRunCalamity, usePowerById } from './powers/handlers.ts';
import { buildSnapshot } from './snapshot.ts';
import { ItemStore } from './items/store.ts';
import { itemRain, itemsStep, setGear, setItemFavourite, setItemRain } from './items/system.ts';
import { hamletGearStep } from './items/hamlet-gear.ts';
import { possessCommand } from './beings/possession.ts';
import { possessAbilities } from './beings/abilities.ts';
import { addMood } from './beings/social.ts';
import { wearOnHit } from './items/wear.ts';
import type { Snapshot } from '../shared/protocol.ts';
import { clansStep, createClanState, type ClanState } from './clans/clans.ts';
import { SpellState } from './spells.ts';

export { TICK_MS };

/** FNV-1a of a name (char codes), mixed with the seed; names key the independent RNG streams. */
function streamSeed(seed: number, name: string): number {
  const codes = new Array<number>(name.length);
  for (let k = 0; k < name.length; k++) codes[k] = name.charCodeAt(k);
  return fnv1a(codes, FNV_OFFSET ^ seed);
}

/**
 * Fault gate for the parts of a tick (17 section 9). The worker supplies one: a throw in a part is handed to `fault`
 * (which counts it), and a part that `isOff` reports is skipped. A realm with no gate (tests, tools) lets a throw propagate.
 */
export interface PartGate {
  /** True while `part` is switched off at sim tick `tick`. */
  isOff(part: string, tick: number): boolean;
  /** Notes a throw in `part` at sim tick `tick`. The tick goes on with the next part. */
  fault(part: string, tick: number, err: unknown): void;
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
  /** Item instances, worn gear, hamlet stock and item rain (08 section 6; src/sim/items). */
  readonly items: ItemStore;
  readonly guard = new ExplosionGuard();
  readonly projectiles: Projectile[] = [];
  weather: WeatherState = createWeatherState();
  readonly culture: CultureState = createCultureState();
  /** Clan records (src/sim/clans): founded from strains, saved as chronicle tag 18. */
  readonly clans: ClanState = createClanState();
  /** Spell casting state: aether (saved, chronicle tag 23) and the recover and cooldown timers (not saved; spells.ts). */
  readonly spells = new SpellState();
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
  /** Queued commands refused when applied (e.g. unknown rule ids); drained by takeRefusals(). */
  private refusals: string[] = [];
  /** Fault gate of the parts (17 section 9). Null in tests and tools, where a throw propagates. Not saved. */
  private gate: PartGate | null = null;

  constructor(seed: number, sizeStep: number) {
    this.realm = new Realm(seed, sizeStep);
    this.beings = new Beings(this.realm.side);
    this.effects = new EffectStore(this.beings.store.capacity);
    this.combat = new CombatState(this.beings.store.capacity);
    this.items = new ItemStore(this.beings.store.capacity);
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

  /** Returns and clears the descriptions of queued commands the sim refused to apply. */
  takeRefusals(): string[] {
    const out = this.refusals;
    this.refusals = [];
    return out;
  }

  /** Runs the calamity roll and counts each calamity whose cooldown was set by this roll (14 section 3). */
  private rollCalamityCounted(): void {
    const before = new Map(this.calamityCooldowns);
    rollAndRunCalamity(this);
    for (const [id, until] of this.calamityCooldowns) {
      if (before.get(id) !== until) recordStat(this, { kind: 'calamity.fired', calamity: id });
    }
  }

  /** Installs the fault gate of this realm's parts (worker.ts). Set on every new Sim; a loaded realm gets its own. */
  setPartGate(gate: PartGate | null): void {
    this.gate = gate;
  }

  /**
   * Runs one part of a tick under the fault gate (17 section 9). A switched-off part is skipped; a throw goes to the gate and
   * the tick goes on. The tick counter is not a part, so it still advances while parts are off, and a switch-off can end.
   * The order of the parts is the order of the calls, with or without a gate.
   */
  private part(name: string, run: () => void): void {
    const gate = this.gate;
    if (gate === null) {
      run();
      return;
    }
    if (gate.isOff(name, this.tick)) return;
    try {
      run();
    } catch (err: unknown) {
      gate.fault(name, this.tick, err);
    }
  }

  /**
   * Runs one unit of a part under the fault gate (17 section 9): one hamlet (`hamlet`), one dominion (`dominion`), one
   * being (`being`) or one border pair (`border`, id `a-b`). The unit is counted under its own part name (`hamlet:3`,
   * `dominion:4`, `being:12`, `border:4-7`), with the same thresholds as a part, so a throw in one unit does not take the
   * rest of its slice for the tick. A switched-off unit is skipped. With no gate (tests, tools) a throw propagates, as in `part()`.
   */
  unit(kind: 'hamlet' | 'dominion' | 'being' | 'border', id: number | string, run: () => void): void {
    const gate = this.gate;
    if (gate === null) {
      run();
      return;
    }
    const name = `${kind}:${id}`;
    if (gate.isOff(name, this.tick)) return;
    try {
      run();
    } catch (err: unknown) {
      gate.fault(name, this.tick, err);
    }
  }

  /** Applies queued commands without advancing the clock (paused edit mode, 17 section 3.1). */
  applyQueued(): void {
    if (this.queue.length === 0) return;
    const pending = this.queue;
    this.queue = [];
    for (const cmd of pending) this.part('command', () => this.apply(cmd));
  }

  /** Advances one tick: queued player actions first, then world systems in fixed order (02 section 4). */
  step(): void {
    this.applyQueued();
    this.tick++;
    this.part('age', () => this.advanceAge());
    this.runTerrain();
    this.runBehaviours();
    this.part('settlements', () => settlementsStep(this));
    // Boats run once per sim-second, after hamlets and their docks (boats.ts).
    this.part('boats', () => {
      if (this.tick % 20 === 0) boatsStep(this, hamletsOf(this), undefined, hamletsAtWar(this));
    });
    this.part('culture', () => cultureTick(this));
    this.part('beings', () => stepBeings(this));
    this.part('clans', () => clansStep(this));
    this.part('items', () => itemsStep(this));
    this.part('hamletGear', () => hamletGearStep(this));
    this.part('combat', () => this.runCombatAndWeather());
    this.part('dominions', () => stepDominions(this));
    this.part('capture', () => captureTick(this));
    this.part('dominionsYearly', () => dominionsYearly(this));
    this.part('achievements', () => {
      if (this.due('achievements', SS_TICKS)) unlockAchievements(this);
    });
  }

  /** Combat context for this sim (structural, see combat.ts). */
  combatContext(): CombatContext {
    return {
      beings: { store: this.beings.store, kill: (slot, cause) => killBeing(this, slot, cause) },
      effects: this.effects,
      combat: this.combat,
      tick: this.tick,
      rng: this.rng('combat'),
      // Worn gear adds its might and plating (08 section 6); both are 0 for a Being with no gear.
      might: (slot) => this.beings.species(this.beings.store.species[slot] ?? 0).might + this.items.mightOf(slot),
      equipPlating: (slot) => this.items.platingOf(slot),
      onWeaponHit: (attacker, victim) => wearOnHit(this, attacker, victim),
      // Modifiers of the weapon in hand (08 section 6.3): the on-hit statuses of combat.applyOnHit.
      weaponMods: (slot) => this.weaponModsOf(slot),
    };
  }

  /** Modifier ids of the weapon a Being wields (worn items of the weapon slot), in slot order. */
  private weaponModsOf(slot: number): string[] {
    const out: string[] = [];
    for (const id of this.items.wornBy(slot)) {
      if (id <= 0) continue;
      const kind = this.items.kindOf(id);
      const inst = this.items.get(id);
      if (kind?.slot === 'weapon' && inst && inst.durability > 0) out.push(...inst.mods);
    }
    return out;
  }

  explosionContext(): ExplosionContext {
    return { ...this.combatContext(), realm: this.realm, guard: this.guard, startFire: (tile, force) => startFire(this, tile, force) };
  }

  /** A trading boat's cannon shot (boats.ts attackPass): a siege_ball flying from one sea tile to another, fired by no Being. */
  volley(x0: number, y0: number, x1: number, y1: number): void {
    launchProjectile(this, 'siege_ball', x0, y0, x1, y1, -1, 0, []);
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
    tickAttackTimers(this.combat, s);
    for (let k = s.size - 1; k >= 0; k--) {
      const slot = s.at(k);
      this.effects.expire(slot, this.tick, (code) => {
        // Expiry hook (08 section 5.4): an outburst that ends gives `outburst_done`.
        if (STATUSES[code - 1]?.id === 'outburst') addMood(this, slot, 'outburst_done');
      });
      for (let e = 0; e < MAX_EFFECTS; e++) {
        const code = this.effects.code[slot * MAX_EFFECTS + e] ?? 0;
        const def = code > 0 ? STATUSES[code - 1] : undefined;
        if (!def || def.every <= 0 || this.tick % def.every !== 0) continue;
        // venomed cannot kill (08 5.3): its tick stops at 1 vitality.
        if (def.cannotKill && (s.vit[slot] ?? 0) <= 1) continue;
        let amount = def.flat > 0 ? def.flat : Math.max(1, Math.floor((s.maxVit[slot] ?? 0) * def.fraction));
        if (def.cannotKill) amount = Math.min(amount, (s.vit[slot] ?? 0) - 1);
        applyDamage(this.combatContext(), slot, amount, def.fire ? 'Fire' : def.drown ? 'Drowning' : 'Poison', false);
        if (s.alive[slot] !== 1) break;
      }
    }
    shootStep(this);
    if (this.projectiles.length > 0) {
      stepProjectiles(this.combatContext(), this.projectiles, (x, y) => this.beingAt(x, y), (p) => landProjectile(this, p));
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
      ashDrop: (tile) => {
        const side = this.realm.side;
        const slot = this.beingAt(tile % side, Math.floor(tile / side));
        // Warded blood is immune to ash_sickness (18b warded_blood).
        if (slot >= 0 && !hasTrait(this, slot, 'warded_blood')) this.effects.add(slot, 'ash_sickness', this.tick);
      },
      startFire: (tile, force) => startFire(this, tile, force),
      blast: this.explosionContext(),
    };
    weatherStep(weatherCtx, this.weather);
  }

  private apply(cmd: Command): void {
    switch (cmd.kind) {
      case Cmd.Stroke:
        // Non-finite coordinates cannot name a tile: the stroke is dropped (brush.ts clamps the rest).
        if (![cmd.x0, cmd.y0, cmd.x1, cmd.y1].every(Number.isFinite)) break;
        applyStroke(this.realm, cmd.op, cmd.shape, cmd.size, cmd.x0, cmd.y0, cmd.x1, cmd.y1, cmd.includeStart);
        break;
      case Cmd.Power:
        this.usePower(cmd.powerId, cmd.x, cmd.y);
        break;
      case Cmd.SetRule:
        if (!this.rules.set(cmd.rule, cmd.on)) this.refusals.push(`rule ${cmd.rule} refused`);
        break;
      case Cmd.SetGear:
        setGear(this, cmd.beingId, cmd.slot, cmd.item);
        break;
      case Cmd.SetItemRain:
        setItemRain(this, cmd.ids);
        break;
      case Cmd.ItemRain:
        itemRain(this, cmd.x, cmd.y, cmd.radius);
        break;
      case Cmd.SetItemFavourite:
        setItemFavourite(this, cmd.itemId, cmd.on);
        break;
      case Cmd.Possess:
        // Architect possession of one Being (07 section 13, beings build 3). A stale id or an off-map order is refused.
        if (!possessCommand(this, cmd.beingId, cmd.on, cmd.x, cmd.y, cmd.attack)) this.refusals.push(POSSESS_REFUSED);
        else if (cmd.on) possessAbilities(this, cmd.beingId, cmd);
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
    if (this.due('fireSweep', 20)) this.part('fireSweep', () => fireSweep(this));
    if (this.due('heat', 20)) this.part('heat', () => heatStep(this));
    this.part('quake', () => quakeStep(this));
    if (this.due('seaRefill', 4)) this.part('seaRefill', () => seaRefill(this));
    if (this.due('slime', 2)) this.part('slime', () => slimeSweep(this));
    if (this.due('magma', 2) && r.molten.size > 0) this.part('magma', () => magmaSweep(this));
    this.part('eruption', () => eruptionStep(this));
    const bonus = this.ageDef().biomeGrowthBonus;
    if (this.due('biome', 2)) this.part('biome', () => biomeSweep(this, Math.floor(side / 16) * (5 + bonus)));
    if (this.due('freeze', 2) && this.ageDef().freezeWorld) this.part('freeze', () => freezeSweep(this, Math.floor(side / 16) * 10));
    if (this.due('thaw', 2) && this.ageDef().thawWorld && !this.rules.isOn('eternal_cold')) {
      this.part('thaw', () => thawSweep(this, Math.floor(side / 16) * 10));
    }
    this.part('creep', () => creepStep(this));
    if (this.due('mineral', 40)) this.part('mineral', () => mineralSeeding(this, 3));
    this.part('floraSpread', () => floraSpreadStep(this));
  }

  /**
   * Behaviour runner: `timer -= 1; when <= 0 run; reset to interval + random` (02 section 7). A throw in `run` is a fault of
   * the behaviour's part; its timer is still reset, so a switched-off behaviour waits its interval after it is back on.
   */
  private behaviour(name: string, intervalSs: number, randomSs: number, run: () => void): void {
    const next = this.timers.get(name);
    if (next === undefined) {
      this.timers.set(name, this.tick + ssToTicks(intervalSs));
      return;
    }
    if (this.tick < next) return;
    this.part(name, run);
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
    let h = FNV_OFFSET;
    h = fnvWord(h, this.tick);
    h = fnvWord(h, this.ages.elapsed);
    h = fnv1a(this.realm.elevation, h);
    h = fnv1a(this.realm.ground, h);
    h = fnv1a(this.realm.cover, h);
    h = fnv1a(new Uint8Array(this.realm.flags.buffer), h);
    h = fnv1a(new Uint8Array(this.realm.heat.buffer), h);
    h = fnv1a(this.realm.scar, h);
    h = fnv1a(this.realm.flora, h);
    h = fnv1a(new Uint8Array(this.realm.floraBlockedUntil.buffer), h);
    h = fnv1a(new Uint8Array(this.beings.store.x.buffer), h);
    h = fnv1a(new Uint8Array(this.beings.store.y.buffer), h);
    h = fnv1a(new Uint8Array(this.beings.store.vit.buffer), h);
    h = fnv1a(this.beings.store.alive, h);
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

/** Folds the low 32 bits of a number into a hash, least significant byte first. */
function fnvWord(h: number, v: number): number {
  return fnv1a([(v >>> 0) & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff], h);
}

