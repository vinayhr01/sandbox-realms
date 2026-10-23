import { describe, expect, it } from 'vitest';
import { Cmd, type Command } from '../../src/shared/protocol.ts';
import { Sim, MAX_TICKS_PER_PUMP } from '../../src/sim/sim.ts';
import { Realm } from '../../src/sim/realm.ts';
import { applyStroke, brushOffsets, lineTiles, RAISE_STEP } from '../../src/sim/brush.ts';
import { planPump } from '../../src/sim/scheduler.ts';
import { GROUND_BY_ELEVATION, GROUNDS } from '../../src/content/grounds.ts';
import { MAX_CATCHUP_MS, TICK_MS } from '../../src/shared/constants.ts';

const stroke = (x0: number, y0: number, x1: number, y1: number, op: 'raise' | 'lower' = 'raise'): Command => ({
  kind: Cmd.Stroke,
  seq: 0,
  op,
  shape: 'circle',
  size: 4,
  x0,
  y0,
  x1,
  y1,
  includeStart: true,
});

describe('realm grid', () => {
  it('side is 64 x sizeStep and arrays match', () => {
    const r = new Realm(42, 4);
    expect(r.side).toBe(256);
    expect(r.elevation.length).toBe(256 * 256);
    expect(r.ground.length).toBe(256 * 256);
  });

  it('a new realm is blank: sea everywhere until worldgen runs', () => {
    const r = new Realm(42, 2);
    expect(r.elevation.every((e) => e === 0)).toBe(true);
    expect(r.ground.every((g) => g === 0)).toBe(true);
  });

  it('ground always matches the elevation table', () => {
    const r = new Realm(5, 2);
    for (let i = 0; i < r.tileCount; i++) {
      expect(r.ground[i]).toBe(GROUND_BY_ELEVATION[r.elevation[i] ?? 0]);
    }
  });

  it('elevation is clamped to 0..255 and dirty rows track changes', () => {
    const r = new Realm(1, 1);
    r.takeDirtyRows();
    r.setElevation(0, 300);
    expect(r.elevation[0]).toBe(255);
    r.setElevation(0, -4);
    expect(r.elevation[0]).toBe(0);
    r.setElevation(64 * 3 + 2, 90);
    expect(r.takeDirtyRows()).toEqual({ y0: 0, y1: 3 });
    expect(r.takeDirtyRows()).toBeNull();
  });

  it('ground table covers 0..255 with valid ids', () => {
    for (let e = 0; e < 256; e++) {
      expect(GROUND_BY_ELEVATION[e]).toBeLessThan(GROUNDS.length);
    }
    expect(GROUND_BY_ELEVATION[0]).toBe(0);
    expect(GROUND_BY_ELEVATION[255]).toBe(11);
  });
});

describe('brush', () => {
  it('offsets start with the centre and stay within radius', () => {
    const offs = brushOffsets('circle', 3);
    expect(offs[0]).toEqual({ dx: 0, dy: 0 });
    for (const { dx, dy } of offs) expect(Math.abs(dx)).toBeLessThanOrEqual(3);
  });

  it('square radius 2 covers 25 tiles, diamond radius 2 covers 13', () => {
    expect(brushOffsets('square', 2).length).toBe(25);
    expect(brushOffsets('diamond', 2).length).toBe(13);
  });

  it('circle is symmetric', () => {
    const offs = brushOffsets('circle', 6);
    const set = new Set(offs.map((o) => `${o.dx},${o.dy}`));
    for (const { dx, dy } of offs) {
      expect(set.has(`${-dx},${dy}`)).toBe(true);
      expect(set.has(`${dx},${-dy}`)).toBe(true);
    }
  });

  it('bresenham line includes both ends and is contiguous', () => {
    const pts: [number, number][] = [];
    lineTiles(0, 0, 5, 2, (x, y) => pts.push([x, y]));
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([5, 2]);
    for (let k = 1; k < pts.length; k++) {
      const prev = pts[k - 1];
      const cur = pts[k];
      expect(prev && cur && Math.max(Math.abs(cur[0] - prev[0]), Math.abs(cur[1] - prev[1]))).toBe(1);
    }
  });

  it('raising a dab moves the centre up by RAISE_STEP', () => {
    const r = new Realm(3, 1);
    const i = 32 * r.side + 32;
    const before = r.elevation[i] ?? 0;
    applyStroke(r, 'raise', 'circle', 0, 32, 32, 32, 32, true);
    expect(r.elevation[i]).toBe(Math.min(255, before + RAISE_STEP));
  });
});

describe('sim core', () => {
  it('queued commands apply at the start of the next tick', () => {
    const s = new Sim(9, 1);
    const i = 10 * s.realm.side + 10;
    const before = s.realm.elevation[i] ?? 0;
    s.enqueue(stroke(10, 10, 10, 10));
    expect(s.realm.elevation[i]).toBe(before);
    s.step();
    expect(s.tick).toBe(1);
    expect(s.realm.elevation[i]).toBe(Math.min(255, before + RAISE_STEP));
  });

  it('paused edits apply without advancing the clock', () => {
    const s = new Sim(9, 1);
    s.enqueue(stroke(5, 5, 5, 5));
    s.applyQueued();
    expect(s.tick).toBe(0);
  });

  it('replay of the same commands gives the same state hash', () => {
    const run = (): number => {
      const s = new Sim(2024, 2);
      for (let t = 0; t < 600; t++) {
        if (t % 7 === 0) s.enqueue(stroke(t % 128, (t * 3) % 128, (t * 5) % 128, (t * 2) % 128, t % 2 ? 'raise' : 'lower'));
        s.step();
      }
      return s.stateHash();
    };
    expect(run()).toBe(run());
  });

  it('speed does not change the result: same ticks, same hash', () => {
    const at = (speed: keyof typeof MAX_TICKS_PER_PUMP): number => {
      const s = new Sim(77, 1);
      s.enqueue(stroke(20, 20, 40, 30));
      let acc = 0;
      let ticks = 0;
      while (ticks < 200) {
        const plan = planPump(acc, TICK_MS * 2, speed, Number.POSITIVE_INFINITY);
        acc = plan.accMs;
        for (let k = 0; k < plan.ticks && ticks < 200; k++) {
          s.step();
          ticks++;
        }
      }
      return s.stateHash();
    };
    expect(at(1)).toBe(at(10));
    expect(at(0.5)).toBe(at(2));
  });

  it('calendar is derived from ticks', () => {
    const s = new Sim(1, 1);
    expect(s.calendar).toEqual({ year: 1, month: 1, day: 1 });
  });
});

describe('scheduler pacing', () => {
  it('x1 runs about 20 ticks per second of wall time', () => {
    let acc = 0;
    let ticks = 0;
    for (let frame = 0; frame < 60; frame++) {
      const plan = planPump(acc, 1000 / 60, 1, Number.POSITIVE_INFINITY);
      acc = plan.accMs;
      ticks += plan.ticks;
    }
    expect(ticks).toBeGreaterThanOrEqual(19);
    expect(ticks).toBeLessThanOrEqual(20);
  });

  it('clamps a stall to MAX_CATCHUP_MS of world time, never replaying the excess', () => {
    const stall = planPump(0, 4000, 10, Number.POSITIVE_INFINITY);
    expect(stall.ticks).toBe(Math.floor(MAX_CATCHUP_MS / TICK_MS));
    expect(stall.accMs).toBeLessThan(TICK_MS);
  });

  it('caps ticks per pump by speed', () => {
    const plan = planPump(0, 1000, 10, Number.POSITIVE_INFINITY);
    expect(plan.ticks).toBeLessThanOrEqual(MAX_TICKS_PER_PUMP[10]);
    expect(planPump(0, 1000, 2, Number.POSITIVE_INFINITY).ticks).toBeLessThanOrEqual(MAX_TICKS_PER_PUMP[2]);
  });

  it('pauses at speed 0', () => {
    expect(planPump(0, 5000, 0, Number.POSITIVE_INFINITY).ticks).toBe(0);
  });
});
