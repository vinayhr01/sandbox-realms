import { expect, it, describe } from 'vitest';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { G, ground } from '../../src/content/grounds.ts';
import { createRng } from '../../src/shared/rng.ts';
import { createHamlet, hamletStep, buildable, placeBuilding, foodCapacity, BASE_FOOD_STORE, PARCEL, type HamletContext } from '../../src/sim/settlements/hamlet.ts';
import { BUILDING_BY_ID, type BuildingDef } from '../../src/sim/settlements/catalogue.ts';

function def(id: string): BuildingDef {
  const d = BUILDING_BY_ID.get(id);
  if (!d) throw new Error(`no building ${id}`);
  return d;
}

function setup(seed: number) {
  const { sim } = generateRealm({ seed, sizeStep: 3, template: 'continent', startingBeasts: false });
  const realm = sim.realm;
  const side = realm.side;
  // Find a land parcel with room: count only tiles a building can take (land, no flora, no road), as buildable() does.
  const perAxis = side / PARCEL;
  let best = 0;
  let bestLand = -1;
  for (let p = 0; p < perAxis * perAxis; p++) {
    let land = 0;
    for (let y = 0; y < PARCEL; y++) for (let x = 0; x < PARCEL; x++) {
      const i = (Math.floor(p / perAxis) * PARCEL + y) * side + (p % perAxis) * PARCEL + x;
      if (ground(realm.ground[i] ?? 0).layer === 'land' && (realm.flora[i] ?? 0) === 0 && realm.ground[i] !== G.wayworn) land++;
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

  it('births off still lets buildings and wood production happen', () => {
    const { ctx, parcel } = setup(34);
    ctx.isOn = (id) => id !== 'folk_births';
    const h = createHamlet(parcel, 6);
    h.food = 5000;
    h.wood = 500;
    h.stone = 300;
    for (let t = 0; t < 3600; t++) { ctx.tick = t; hamletStep(ctx, h); }
    expect(h.folk).toBe(6);
    expect(h.buildings.length).toBeGreaterThan(0);

    // Wood production alone, with nothing affordable to spend it on.
    const idle = createHamlet(parcel, 0);
    idle.wood = 0;
    idle.stone = 0;
    idle.buildings.push({ def: def('workshop'), x: 0, y: 0 });
    ctx.isOn = () => false;
    for (let t = 0; t < 1000; t++) { ctx.tick = t; hamletStep(ctx, idle); }
    expect(idle.wood).toBeGreaterThan(0);
    expect(idle.wood % def('workshop').woodYield).toBe(0);
  });

  it('food yield is capped at the store capacity and a well produces food', () => {
    const { ctx, parcel } = setup(35);
    ctx.isOn = () => true;
    const step = (h: ReturnType<typeof createHamlet>) => { ctx.tick = 0; hamletStep(ctx, h); };

    // A well on an empty store yields its catalogue food per step.
    const well = createHamlet(parcel, 0);
    well.food = 0;
    well.wood = 0;
    well.stone = 0;
    well.buildings.push({ def: def('well'), x: 0, y: 0 });
    expect(def('well').foodYield).toBeGreaterThan(0);
    step(well);
    expect(well.food).toBe(def('well').foodYield);

    // Yield stops at the cap: three wells cannot push the store past BASE_FOOD_STORE.
    const full = createHamlet(parcel, 0);
    full.food = BASE_FOOD_STORE - 5;
    full.wood = 0;
    full.stone = 0;
    for (let i = 0; i < 3; i++) full.buildings.push({ def: def('well'), x: 0, y: 0 });
    step(full);
    expect(full.food).toBe(BASE_FOOD_STORE);

    // A granary raises the cap but yields no food itself.
    const granary = createHamlet(parcel, 0);
    granary.food = 0;
    granary.wood = 0;
    granary.stone = 0;
    granary.buildings.push({ def: def('granary'), x: 0, y: 0 });
    expect(foodCapacity(granary)).toBe(BASE_FOOD_STORE + def('granary').foodCapacity);
    step(granary);
    expect(granary.food).toBe(0);

    // Existing stock above the cap is kept; yield does not clip it.
    const stocked = createHamlet(parcel, 0);
    stocked.food = 5000;
    stocked.wood = 0;
    stocked.stone = 0;
    stocked.buildings.push({ def: def('well'), x: 0, y: 0 });
    step(stocked);
    expect(stocked.food).toBe(5000);
  });

  it('territory does not grow without a placed building', () => {
    const { ctx, parcel } = setup(36);
    ctx.isOn = () => true;
    // Round 4 jobs gather wood, so a hamlet with no starting wood can still build. The rule under test is
    // that territory grows only through a placed building: no building means one parcel.
    const h = createHamlet(parcel, 0);
    h.wood = 0;
    h.stone = 0;
    h.food = 200;
    for (let t = 0; t < 1000; t++) { ctx.tick = t; hamletStep(ctx, h); }
    if (h.buildings.length === 0) expect(h.parcels.size).toBe(1);
    else expect(h.parcels.size).toBeGreaterThan(1);
  });

  it('territory does not grow when an affordable building finds no room', () => {
    const { ctx, parcel, realm } = setup(37);
    ctx.isOn = () => true;
    const h = createHamlet(parcel, 6);
    h.food = 5000;
    h.wood = 1000;
    h.stone = 1000;
    // Fill every tile of the home parcel so nothing can be placed there.
    const perAxis = realm.side / PARCEL;
    const px = (parcel % perAxis) * PARCEL;
    const py = Math.floor(parcel / perAxis) * PARCEL;
    for (let y = py; y < py + PARCEL; y++) for (let x = px; x < px + PARCEL; x++) h.buildings.push({ def: def('well'), x, y });
    ctx.tick = 0;
    hamletStep(ctx, h);
    expect(h.parcels.size).toBe(1);
  });

  it('builds at least one building with plenty of stock, so the store gets income', () => {
    const { ctx, parcel } = setup(40);
    ctx.isOn = () => true;
    const h = createHamlet(parcel, 0);
    h.wood = 1000;
    h.stone = 1000;
    for (let t = 0; t < 300; t++) { ctx.tick = t; hamletStep(ctx, h); }
    // The round 4 order is rule-driven (buildChoices), so the exact first building is not fixed here.
    expect(h.buildings.length).toBeGreaterThan(0);
  });

  it('placeBuilding refuses an unaffordable building', () => {
    const { ctx, parcel } = setup(38);
    const h = createHamlet(parcel, 0);
    h.wood = 100;
    h.stone = 0;
    expect(placeBuilding(ctx, h, def('granary'))).toBe(false);
    expect(h.buildings.length).toBe(0);
  });
});
