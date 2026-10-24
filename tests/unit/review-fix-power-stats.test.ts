import { describe, expect, it } from 'vitest';
import { Cmd, type Command } from '../../src/shared/protocol.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

function seeded() {
  return generateRealm({ seed: 4242, sizeStep: 2, template: 'continent' }).sim;
}

describe('queued powers count in lifetime stats (review fix 1)', () => {
  it('a Cmd.Power applied by the tick counts power.used like a direct usePower', () => {
    const sim = seeded();
    sim.enqueue({ kind: Cmd.Power, seq: 0, powerId: 'shape_raise', x: 40, y: 40 } as Command);
    sim.step();
    expect(sim.lifetime.counters['powerUsesTotal']).toBe(1);
  });

  it('a refused power (unknown id) does not count', () => {
    const sim = seeded();
    sim.enqueue({ kind: Cmd.Power, seq: 0, powerId: 'no_such_power', x: 40, y: 40 } as Command);
    sim.step();
    expect(sim.lifetime.counters['powerUsesTotal']).toBeUndefined();
  });
});
