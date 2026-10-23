import { TICK_MS } from '../shared/constants.ts';
import { Cmd, type Command, type Speed } from '../shared/protocol.ts';
import { createRng, type Rng } from '../shared/rng.ts';
import { groundKey } from '../content/grounds.ts';
import { biomeOfCover, BIOMES } from '../content/biomes.ts';
import { applyStroke } from './brush.ts';
import { ageDef, newAgeState, tickAge, type AgeState, type AgeDef, AGE_BY_ID } from './ages.ts';
import { calendar, ssToTicks, type Calendar } from './clock.ts';
import { Realm } from './realm.ts';
import { RuleSet, ageRuleId } from './rules.ts';
import { Runner } from './runner.ts';
import { heatStep } from './terrain/heat.ts';
import { magmaSweep } from './terrain/magma.ts';
import { seaRefill } from './terrain/water.ts';
import { fireSweep, scarFade } from './terrain/fire.ts';
import { freezeSweep, summitFreeze, thawSweep } from './terrain/freeze.ts';
import { biomeSweep } from './terrain/biome-spread.ts';
import { droughtPass, floraPass, frostPass, wildSeeding } from './flora.ts';
import { Beings } from './beings/system.ts';
import { stepBeings } from './beings/system.ts';

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
  ages: AgeState;
  tick = 0;
  private queue: Command[] = [];
  private readonly streams = new Map<string, Rng>();
  private readonly runners = new Map<string, Runner>();
  /** Behaviour timers: tick at which each behaviour next runs (02 section 7). */
  private readonly timers = new Map<string, number>();

  constructor(seed: number, sizeStep: number) {
    this.realm = new Realm(seed, sizeStep);
    this.beings = new Beings(this.realm.side);
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
    stepBeings(this);
  }

  private apply(cmd: Command): void {
    switch (cmd.kind) {
      case Cmd.Stroke:
        applyStroke(this.realm, cmd.op, cmd.shape, cmd.size, cmd.x0, cmd.y0, cmd.x1, cmd.y1, cmd.includeStart);
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
    if (this.due('seaRefill', 4)) seaRefill(this);
    if (this.due('magma', 2) && r.molten.size > 0) magmaSweep(this);
    const bonus = this.ageDef().biomeGrowthBonus;
    if (this.due('biome', 2)) biomeSweep(this, Math.floor(side / 16) * (5 + bonus));
    if (this.due('freeze', 2) && this.ageDef().freezeWorld) freezeSweep(this, Math.floor(side / 16) * 10);
    if (this.due('thaw', 2) && this.ageDef().thawWorld && !this.rules.isOn('eternal_cold')) {
      thawSweep(this, Math.floor(side / 16) * 10);
    }
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
    this.behaviour('scarFade', 3, 5, () => scarFade(this));
    this.behaviour('summitFreeze', 10, 50, () => {
      if (age.id !== 'scorch') summitFreeze(this);
    });
    this.behaviour('wildSeeding', 10, 10, () => {
      if (this.rules.isOn('wild_seeding') && age.growVegetation) wildSeeding(this, 5);
    });
    this.behaviour('floraPass', 5, 5, () => floraPass(this, 400));
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

