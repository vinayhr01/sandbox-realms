import { describe, expect, it } from 'vitest';
import { POWER_BY_ID, POWERS } from '../../src/content/powers.ts';
import { SPECIES } from '../../src/content/beasts.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { executePower } from '../../src/sim/powers/handlers.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

describe('Folk spawners (12 section 8.5)', () => {
  it('has one spawner per roster species, Folk included', () => {
    const spawners = POWERS.filter((p) => p.handler === 'spawn_being');
    expect(spawners.length).toBe(SPECIES.length);
    const folk = SPECIES.filter((s) => s.folk);
    expect(folk.length).toBe(6);
    for (const s of folk) expect(POWER_BY_ID.has(`spawn_folk_${s.id}`)).toBe(true);
  });

  it('a Folk spawn places a founder of that lineage', () => {
    const sim = generateRealm({ seed: 3, sizeStep: 2, template: 'continent' }).sim;
    seedStartingBeasts(sim, 5);
    const def = POWER_BY_ID.get(`spawn_folk_${SPECIES.find((s) => s.folk)?.id}`);
    if (!def) throw new Error('no Folk spawner');
    const before = sim.beings.store.size;
    const side = sim.realm.side;
    // The first walkable tile takes the founder; spawns on water or in the sea are refused.
    let placed = false;
    for (let i = 0; i < side * side && !placed; i++) placed = executePower(sim, def, i % side, Math.floor(i / side));
    expect(placed).toBe(true);
    expect(sim.beings.store.size).toBe(before + 1);
  });
});
