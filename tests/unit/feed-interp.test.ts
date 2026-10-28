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

describe('swap-removal of faded beings', () => {
  it('keeps every other being sampled when one in the middle fades out', () => {
    const interp = new FeedInterp();
    interp.push(feedOf([{ slot: 1, x: 1, y: 1 }, { slot: 2, x: 2, y: 2 }, { slot: 3, x: 3, y: 3 }, { slot: 4, x: 4, y: 4 }]), 0);
    interp.push(feedOf([{ slot: 1, x: 1, y: 1 }, { slot: 3, x: 3, y: 3 }, { slot: 4, x: 4, y: 4 }]), 100);
    // Slot 2 is gone and has faded out; the rest are all still drawn, none twice.
    const after = sampleAt(interp, 100 + FADE_MS + 1);
    expect(after.map((d) => d.key >> 16).sort()).toEqual([1, 3, 4]);
    interp.push(feedOf([{ slot: 1, x: 1, y: 1 }, { slot: 2, gen: 2, x: 9, y: 9 }, { slot: 3, x: 3, y: 3 }, { slot: 4, x: 4, y: 4 }]), 700);
    expect(sampleAt(interp, 700).map((d) => d.key >> 16).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('coalesced feeds', () => {
  it('holds a feed until the next sample and applies only the latest of several', () => {
    const interp = new FeedInterp({ coalesce: true });
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.push(feedOf([{ slot: 1, x: 12, y: 5 }]), 50);
    interp.push(feedOf([{ slot: 1, x: 13, y: 5 }]), 100);
    // One feed was applied: the being starts and stays at the latest position.
    expect(byKey(sampleAt(interp, 100), KEY_1).x).toBe(13);
    interp.push(feedOf([{ slot: 1, x: 14, y: 5 }]), 150);
    interp.push(feedOf([{ slot: 1, x: 15, y: 5 }]), 200);
    // The latest feed is lerped to from the last sampled one (13), using the latest push's time.
    expect(byKey(sampleAt(interp, 200), KEY_1).x).toBe(13);
    expect(byKey(sampleAt(interp, 250), KEY_1).x).toBeCloseTo(14, 10);
  });

  it('copies the feed, so its buffer can be handed back at once', () => {
    const interp = new FeedInterp({ coalesce: true });
    const feed = feedOf([{ slot: 1, x: 10, y: 5 }]);
    interp.push(feed, 0);
    feed.data.fill(0);
    expect(byKey(sampleAt(interp, 0), KEY_1).x).toBe(10);
  });

  it('scales the snap distance by the feeds coalesced into one', () => {
    // A fast mover covers 2 tiles per feed. Five feeds coalesce into one: 10 tiles apart, which is a walk, not a jump.
    const interp = new FeedInterp({ coalesce: true });
    interp.push(feedOf([{ slot: 1, x: 10, y: 5, state: BeingState.Run }]), 0);
    sampleAt(interp, 0);
    for (let i = 1; i <= 5; i++) interp.push(feedOf([{ slot: 1, x: 10 + 2 * i, y: 5, state: BeingState.Run }]), 100 * i);
    expect(10).toBeGreaterThan(SNAP_TILES);
    expect(byKey(sampleAt(interp, 500), KEY_1).x).toBe(10);
    expect(byKey(sampleAt(interp, 600), KEY_1).x).toBeGreaterThan(10);
    expect(byKey(sampleAt(interp, 600), KEY_1).moved).toBe(10);
    // The same distance in one uncoalesced feed is still a snap.
    const single = new FeedInterp({ coalesce: true });
    single.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    sampleAt(single, 0);
    single.push(feedOf([{ slot: 1, x: 20, y: 5 }]), 100);
    expect(byKey(sampleAt(single, 100), KEY_1).x).toBe(20);
    expect(byKey(sampleAt(single, 100), KEY_1).moved).toBe(0);
  });

  it('drops a held feed on reset', () => {
    const interp = new FeedInterp({ coalesce: true });
    interp.push(feedOf([{ slot: 1, x: 10, y: 5 }]), 0);
    interp.reset();
    expect(sampleAt(interp, 0)).toEqual([]);
  });
});
