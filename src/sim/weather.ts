import { ssToTicks } from './clock.ts';
import type { Realm } from './realm.ts';
import type { Rng } from '../shared/rng.ts';
import { explode, type ExplosionContext } from './explosions.ts';
import { raiseHeat } from './terrain/heat.ts';

/** Live cloud cap (02 section 6: 200). */
export const MAX_CLOUDS = 200;
/** Clouds that count as calamities (gated by natural_calamities). */
const CALAMITY_CLOUDS = new Set(['cloud_storm', 'cloud_wrath']);
/** Radius in tiles of the footprint a cloud drops onto. */
const DROP_RADIUS = 1;
/** Lightning chance per tick for storm clouds (02 section 6: 1% per 0.05 ss). */
const LIGHTNING_CHANCE = 0.01;
/** Ticks a cloud must live before it drops (02 section 6: 3 ss). */
const DROP_AFTER = 60;
/** Heat a lightning strike adds to every tile within the strike radius (04 section 7.1: 9). */
const STRIKE_HEAT = 9;
/** Radius in tiles of the heat from a lightning strike (TUNE; 04 gives no radius). */
const STRIKE_HEAT_RADIUS = 2;

/** Adds lightning heat to the tiles around a strike, without effects (applied by the heat step). */
export function strikeHeat(realm: Realm, cx: number, cy: number): void {
  for (let y = cy - STRIKE_HEAT_RADIUS; y <= cy + STRIKE_HEAT_RADIUS; y++) {
    for (let x = cx - STRIKE_HEAT_RADIUS; x <= cx + STRIKE_HEAT_RADIUS; x++) {
      if (realm.inBounds(x, y) && Math.hypot(x - cx, y - cy) <= STRIKE_HEAT_RADIUS) raiseHeat(realm, y * realm.side + x, STRIKE_HEAT);
    }
  }
}

export interface Cloud {
  type: string;
  x: number;
  y: number;
  /** Tiles per tick. */
  speed: number;
  age: number;
  dropTimer: number;
  /** Ticks between drops. */
  dropInterval: number;
}

export interface WeatherState {
  clouds: Cloud[];
  /** Tick of the next spawn attempt. */
  nextSpawn: number;
}

export function createWeatherState(): WeatherState {
  return { clouds: [], nextSpawn: 0 };
}

/**
 * Structural context for weather. Rain, freezing and fire are supplied as callbacks so the caller
 * decides which sim functions run; `blast` is what lightning and calamity clouds explode with.
 */
export interface WeatherContext {
  realm: Realm;
  rng: Rng;
  tick: number;
  /** Realm Rule lookup (`rules.isOn`). */
  isOn(id: string): boolean;
  /** Clouds of the current age as [id, weight] (ageDef().clouds). */
  ageClouds: readonly (readonly [string, number])[];
  /** Cloud spawn interval in sim seconds (ageDef cloudInterval, default 15). */
  cloudIntervalSs: number;
  rainDrop(tile: number): void;
  freeze(tile: number): void;
  startFire(tile: number, force: boolean): boolean;
  blast: ExplosionContext;
}

function speedFor(type: string, rng: Rng): number {
  // Tiles per second (02 section 6), converted to tiles per tick.
  const seconds = type === 'cloud_shower' ? 1 + rng.int(4) : 1 + rng.int(6);
  return seconds / 20;
}

/** Weighted pick among clouds allowed by the rules (02 section 6). */
function pickCloud(ctx: WeatherContext): string | null {
  const allowed = ctx.ageClouds.filter(([id]) => {
    if (CALAMITY_CLOUDS.has(id)) return ctx.isOn('natural_calamities');
    return ctx.isOn('sky_clouds');
  });
  let total = 0;
  for (const [, w] of allowed) total += w;
  if (total <= 0) return null;
  let r = ctx.rng.int(total);
  for (const [id, w] of allowed) {
    r -= w;
    if (r < 0) return id;
  }
  return null;
}

function spawn(ctx: WeatherContext, state: WeatherState): void {
  const type = pickCloud(ctx);
  if (type === null) return;
  const side = ctx.realm.side;
  state.clouds.push({
    type,
    x: ctx.rng.int(80) - 50,
    y: ctx.rng.int(side + 25),
    speed: speedFor(type, ctx.rng),
    age: 0,
    dropTimer: 0,
    dropInterval: type === 'cloud_plain' ? 40 : 1,
  });
}

function dropAt(ctx: WeatherContext, cloud: Cloud): void {
  const realm = ctx.realm;
  const x = Math.round(cloud.x) + ctx.rng.int(2 * DROP_RADIUS + 1) - DROP_RADIUS;
  const y = Math.round(cloud.y) + ctx.rng.int(2 * DROP_RADIUS + 1) - DROP_RADIUS;
  if (!realm.inBounds(x, y)) return;
  const tile = y * realm.side + x;
  switch (cloud.type) {
    case 'cloud_shower':
    case 'cloud_storm':
      ctx.rainDrop(tile);
      break;
    case 'cloud_flurry':
      ctx.freeze(tile);
      break;
    case 'cloud_wrath':
      ctx.startFire(tile, false);
      break;
    case 'cloud_vitriol':
      realm.setCover(tile, 0);
      break;
    default:
      // Plain, ash and arcane drops have no terrain effect in this milestone.
      break;
  }
}

/**
 * One weather tick (02 section 6): spawns clouds on the age's schedule, drifts them east, drops
 * their rain or snow every drop interval once they are three sim-seconds old, and fires lightning
 * from storm clouds. Clouds leave the map on the east edge. Pool capped at MAX_CLOUDS.
 */
export function weatherStep(ctx: WeatherContext, state: WeatherState): void {
  ctx.blast.guard.decay();
  if (ctx.tick >= state.nextSpawn && state.clouds.length < MAX_CLOUDS) {
    spawn(ctx, state);
    const jitter = ctx.rng.int(ssToTicks(ctx.cloudIntervalSs) + 1);
    state.nextSpawn = ctx.tick + ssToTicks(ctx.cloudIntervalSs) + jitter;
  }

  const side = ctx.realm.side;
  let w = 0;
  for (let k = 0; k < state.clouds.length; k++) {
    const cloud = state.clouds[k];
    if (!cloud) continue;
    cloud.x += cloud.speed;
    cloud.age++;
    if (cloud.x > side) continue;
    state.clouds[w++] = cloud;
    if (cloud.age >= DROP_AFTER) {
      cloud.dropTimer--;
      if (cloud.dropTimer <= 0) {
        dropAt(ctx, cloud);
        cloud.dropTimer = cloud.dropInterval;
      }
    }
    if (cloud.type === 'cloud_storm' && ctx.rng.next() < LIGHTNING_CHANCE) {
      // Lightning lands on the right half of the storm (02 section 6).
      const lx = Math.round(cloud.x) - ctx.rng.int(4);
      const ly = Math.round(cloud.y) + ctx.rng.int(5) - 2;
      if (ctx.realm.inBounds(lx, ly)) {
        strikeHeat(ctx.realm, lx, ly);
        explode(ctx.blast, lx, ly, 1, 20, 'Other', -1);
      }
    }
  }
  state.clouds.length = w;
}
