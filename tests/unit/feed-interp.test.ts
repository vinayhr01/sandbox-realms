import { describe, expect, it } from 'vitest';
import { BeingState, FEED_STRIDE, type BeingFeed } from '../../src/shared/being-feed.ts';
import { FADE_MS, FeedInterp, SNAP_TILES, WALK_HOLD_MS, type DrawBeing } from '../../src/render/feed-interp.ts';

interface Row {
  slot: number;
  gen?: number;
  x: number;
  y: number;
  state?: BeingState;
}

/** Builds a feed by hand in the documented word order: slot, gen, x, y, species, state | child << 8. */
function feedOf(rows: Row[]): BeingFeed {
  const data = new Uint16Array(rows.length * FEED_STRIDE);
  rows.forEach((r, i) => {
    const o = i * FEED_STRIDE;
    data[o] = r.slot;
    data[o + 1] = r.gen ?? 1;
    data[o + 2] = r.x;
    data[o + 3] = r.y;
    data[o + 4] = 2;
    data[o + 5] = r.state ?? BeingState.Idle;
  });
  return { tick: 0, count: rows.length, data, buildings: null, boats: [] };
}

/** Samples at `now` and returns the drawn beings, copied so later samples cannot change them. */
function sampleAt(interp: FeedInterp, now: number): DrawBeing[] {
  const out: DrawBeing[] = [];
  const n = interp.sample(now, out);
  return out.slice(0, n).map((d) => ({ ...d }));
}

function byKey(list: DrawBeing[], key: number): DrawBeing {
  const found = list.find((d) => d.key === key);
  if (!found) throw new Error(`no being with key ${key}`);
  return found;
}

const KEY_1 = (1 << 16) | 1;

describe('feed interpolation', () => {
  it('lerps halfway', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.push(feedOf([{ slot: 1, x: 11, y: 5 }]), 100);
    expect(byKey(sampleAt(interp, 150), KEY_1).x).toBe(10.5);
  });

  it('snaps on big jump', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.push(feedOf([{ slot: 1, x: 20, y: 5 }]), 100);
    expect(byKey(sampleAt(interp, 150), KEY_1).x).toBe(20);
  });

  it('snaps a move of exactly SNAP_TILES plus one', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.push(feedOf([{ slot: 1, x: 10 + SNAP_TILES + 1, y: 5 }]), 100);
    expect(byKey(sampleAt(interp, 150), KEY_1).x).toBe(10 + SNAP_TILES + 1);
  });

  it('slot reuse snaps', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 3, gen: 1, x: 10, y: 5 }]), 0);
    interp.push(feedOf([{ slot: 3, gen: 2, x: 11, y: 5 }]), 100);
    expect(byKey(sampleAt(interp, 150), (3 << 16) | 2).x).toBe(11);
  });

  it('long gap snaps', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.push(feedOf([{ slot: 1, x: 11, y: 5 }]), 2000);
    expect(byKey(sampleAt(interp, 2000), KEY_1).x).toBe(11);
  });

  it('missing being fades', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 100);
    interp.push(feedOf([]), 200);
    expect(byKey(sampleAt(interp, 200 + FADE_MS / 2), KEY_1).alpha).toBe(0.5);
    expect(sampleAt(interp, 200 + FADE_MS)).toHaveLength(0);
  });

  it('facing', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.push(feedOf([{ slot: 1, x: 9, y: 5 }]), 100);
    expect(byKey(sampleAt(interp, 150), KEY_1).facing).toBe(-1);
    interp.push(feedOf([{ slot: 1, x: 9, y: 5 }]), 200);
    expect(byKey(sampleAt(interp, 250), KEY_1).facing).toBe(-1);
  });

  it('holds walk briefly', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 10, y: 5, state: BeingState.Walk }]), 0);
    interp.push(feedOf([{ slot: 1, x: 10, y: 5, state: BeingState.Idle }]), 100);
    expect(byKey(sampleAt(interp, 150), KEY_1).state).toBe(BeingState.Walk);
    interp.push(feedOf([{ slot: 1, x: 10, y: 5, state: BeingState.Idle }]), 500);
    expect(WALK_HOLD_MS).toBe(300);
    expect(byKey(sampleAt(interp, 550), KEY_1).state).toBe(BeingState.Idle);
  });

  it('reset clears', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.reset();
    expect(sampleAt(interp, 0)).toHaveLength(0);
  });

  it('snap reports no movement', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.push(feedOf([{ slot: 1, x: 10 + SNAP_TILES + 2, y: 5 }]), 100);
    expect(byKey(sampleAt(interp, 150), KEY_1).moved).toBe(0);
  });
});
