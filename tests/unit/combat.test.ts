import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { spawnBeing } from '../../src/sim/beings/system.ts';
import { applyDamage, meleeSwing, stepProjectiles, type Projectile } from '../../src/sim/combat.ts';
import { SPECIES } from '../../src/content/beasts.ts';
import { G } from '../../src/content/grounds.ts';

function arena(): { sim: Sim; a: number; b: number } {
  const sim = new Sim(606, 1);
  for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) sim.realm.setGround(y * sim.realm.side + x, G.lowloam);
  const gloam = SPECIES.findIndex((s) => s.id === 'gloamfang');
  const a = spawnBeing(sim, gloam, 22, 22, true);
  const b = spawnBeing(sim, gloam, 23, 22, true);
  return { sim, a, b };
}

describe('combat (scripted)', () => {
  it('a melee hit inside the window deals no damage; after the window it does', () => {
    const { sim, a, b } = arena();
    const ctx = sim.combatContext();
    const first = applyDamage(ctx, b, 10, 'Weapon', true);
    expect(first.dealt).toBeGreaterThan(0);
    const second = applyDamage(ctx, b, 10, 'Weapon', true);
    expect(second.blocked).toBe(true);
    expect(second.dealt).toBe(0);
    for (let t = 0; t < 10; t++) sim.step();
    const later = applyDamage(sim.combatContext(), b, 10, 'Weapon', true);
    expect(later.dealt).toBeGreaterThan(0);
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it('plating reduces Weapon damage with integer math and never below 1', () => {
    const { sim, b } = arena();
    sim.combat.plating[b] = 90;
    const r = applyDamage(sim.combatContext(), b, 40, 'Weapon', false);
    expect(r.dealt).toBe(4);
    sim.combat.plating[b] = 100;
    sim.beings.store.vit[b] = 50;
    const min = applyDamage(sim.combatContext(), b, 3, 'Weapon', false);
    expect(min.dealt).toBe(1);
  });

  it('plating does not reduce Fire or Poison damage', () => {
    const { sim, b } = arena();
    sim.combat.plating[b] = 100;
    const r = applyDamage(sim.combatContext(), b, 20, 'Poison', false);
    expect(r.dealt).toBe(20);
  });

  it('a melee swing needs reach 1 and respects the attack timer', () => {
    const { sim, a, b } = arena();
    expect(meleeSwing(sim.combatContext(), a, b, 3)).toBeNull();
    const hit = meleeSwing(sim.combatContext(), a, b, 1);
    expect(hit).not.toBeNull();
    expect(meleeSwing(sim.combatContext(), a, b, 1)).toBeNull();
  });

  it('a being that reaches zero vitality dies and is counted as a combat death', () => {
    const { sim, b } = arena();
    sim.beings.store.vit[b] = 3;
    const r = applyDamage(sim.combatContext(), b, 50, 'Other', false);
    expect(r.killed).toBe(true);
    expect(sim.beings.store.alive[b]).toBe(0);
  });

  it('a status with periodic damage hurts a being over time, and expires', () => {
    const { sim, b } = arena();
    sim.effects.add(b, 'bleeding', sim.tick);
    const before = sim.beings.store.vit[b] ?? 0;
    for (let t = 0; t < 100; t++) sim.step();
    expect(sim.beings.store.vit[b] ?? 0).toBeLessThan(before);
    for (let t = 0; t < 500; t++) sim.step();
    expect(sim.effects.has(b, 'bleeding')).toBe(false);
    expect(sim.beings.store.alive[b]).toBe(1);
  });

  it('sheltered beings take no damage', () => {
    const { sim, b } = arena();
    sim.effects.add(b, 'sheltered', sim.tick);
    const before = sim.beings.store.vit[b] ?? 0;
    const r = applyDamage(sim.combatContext(), b, 30, 'Other', false);
    expect(r.blocked).toBe(true);
    expect(sim.beings.store.vit[b]).toBe(before);
  });

  it('a rimebound being cannot move', () => {
    const { sim, b } = arena();
    sim.effects.add(b, 'rimebound', sim.tick);
    const x0 = sim.beings.store.x[b] ?? 0;
    for (let t = 0; t < 200; t++) sim.beings.store.nextDecision[b] = 0, sim.step();
    expect(sim.beings.store.x[b]).toBe(x0);
  });

  it('a projectile flies to its tile and hits the being there', () => {
    const { sim, b } = arena();
    const x = sim.beings.store.x[b] ?? 0;
    const y = sim.beings.store.y[b] ?? 0;
    const list: Projectile[] = [{ x: x - 3, y, tx: x, ty: y, speed: 1, damage: 15, type: 'Other', collide: false, alive: true }];
    const before = sim.beings.store.vit[b] ?? 0;
    let landed = 0;
    for (let t = 0; t < 10; t++) landed += stepProjectiles(sim.combatContext(), list, (px, py) => sim.beingAt(px, py));
    expect(landed).toBe(1);
    expect(list.length).toBe(0);
    expect(sim.beings.store.vit[b]).toBeLessThan(before);
  });
});
