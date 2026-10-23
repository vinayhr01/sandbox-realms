import { expect, it, describe } from 'vitest';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { ground } from '../../src/content/grounds.ts';
import { createRng } from '../../src/shared/rng.ts';
import { createHamlet, hamletStep, buildable, PARCEL, type HamletContext } from '../../src/sim/settlements/hamlet.ts';

function setup(seed: number) {
  const { sim } = generateRealm({ seed, sizeStep: 3, template: 'continent', startingBeasts: false });
  const realm = sim.realm;
  const side = realm.side;
  // Find a land parcel with room (most tiles land).
  const perAxis = side / PARCEL;
  let best = 0;
  let bestLand = -1;
  for (let p = 0; p < perAxis * perAxis; p++) {
    let land = 0;
    for (let y = 0; y < PARCEL; y++) for (let x = 0; x < PARCEL; x++) {
      const i = (Math.floor(p / perAxis) * PARCEL + y) * side + (p % perAxis) * PARCEL + x;
      if (ground(realm.ground[i] ?? 0).layer === 'land') land++;
    }
    if (land > bestLand) { bestLand = land; best = p; }
  }
  const ctx: HamletContext = {
    realm,
    rng: createRng(seed),
    tick: 0,
    isOn: (id) => sim.rules.isOn(id),
  };
  return { realm, ctx, parcel: best, sim };
}

describe('settlements', () => {
  it('a well-supplied hamlet grows and builds over three sim years', () => {
    const { ctx, parcel } = setup(31);
    const h = createHamlet(parcel, 6);
    h.food = 5000;
    h.wood = 500;
    h.stone = 300;
    const startFolk = h.folk;
    for (let t = 0; t < 3600 * 3; t++) {
      ctx.tick = t;
      hamletStep(ctx, h);
    }
    expect(h.folk).toBeGreaterThan(startFolk);
    expect(h.buildings.length).toBeGreaterThan(0);
  });

  it('buildings never sit on water or molten tiles', () => {
    const { ctx, parcel, realm } = setup(32);
    const h = createHamlet(parcel, 6);
    h.wood = 2000;
    h.stone = 2000;
    for (let t = 0; t < 2000; t++) { ctx.tick = t; hamletStep(ctx, h); }
    for (const b of h.buildings) {
      const kind = ground(realm.ground[b.y * realm.side + b.x] ?? 0);
      expect(kind.layer).toBe('land');
    }
  });

  it('territory never exceeds the parcels it was given (only adjacent land parcels are added)', () => {
    const { ctx, parcel, realm } = setup(33);
    const h = createHamlet(parcel, 6);
    h.wood = 5000;
    h.stone = 5000;
    h.food = 9000;
    for (let t = 0; t < 4000; t++) { ctx.tick = t; hamletStep(ctx, h); }
    const perAxis = realm.side / PARCEL;
    expect(h.parcels.size).toBeLessThanOrEqual(perAxis * perAxis);
    for (const b of h.buildings) {
      expect(buildable(ctx, b.x, b.y, { ...h, buildings: [] }) || h.parcels.has(Math.floor(b.y / PARCEL) * perAxis + Math.floor(b.x / PARCEL))).toBe(true);
    }
  });
});
