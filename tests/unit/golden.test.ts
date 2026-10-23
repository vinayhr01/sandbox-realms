import { describe, expect, it } from 'vitest';
import { Cmd, type Command } from '../../src/shared/protocol.ts';
import { Sim } from '../../src/sim/sim.ts';

/**
 * Golden replay (17 section 7.3, acceptance test 10 in CI form): a fixed seed and command script
 * must always produce the same checkpoint hash. If this fails after an intentional sim change,
 * update GOLDEN_HASH and say so in the commit message.
 */
const GOLDEN_HASH = 3538745459;

function replay(): number[] {
  const sim = new Sim(20240601, 2);
  const checkpoints: number[] = [];
  const script: Command[] = [];
  for (let k = 0; k < 40; k++) {
    script.push({
      kind: Cmd.Stroke,
      seq: k,
      op: k % 3 === 0 ? 'lower' : 'raise',
      shape: k % 2 === 0 ? 'circle' : 'diamond',
      size: 3 + (k % 4),
      x0: 10 + k * 2,
      y0: 20 + (k % 7),
      x1: 14 + k * 2,
      y1: 26 + (k % 5),
      includeStart: true,
    });
  }
  for (let t = 0; t < 1200; t++) {
    if (t % 30 === 0) {
      const cmd = script[(t / 30) % script.length];
      if (cmd) sim.enqueue(cmd);
    }
    sim.step();
    if (t % 200 === 199) checkpoints.push(sim.stateHash());
  }
  return checkpoints;
}

describe('golden replay', () => {
  it('checkpoint hashes are stable across runs', () => {
    expect(replay()).toEqual(replay());
  });

  it('matches the recorded golden checkpoints', () => {
    const checkpoints = replay();
    expect(checkpoints[checkpoints.length - 1]).toBe(GOLDEN_HASH);
  });
});
