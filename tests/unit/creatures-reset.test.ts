import { describe, expect, it } from 'vitest';
import { resetCreatureView } from '../../src/render/creatures.ts';
import { FeedInterp, type DrawBeing } from '../../src/render/feed-interp.ts';
import { BeingState, FEED_STRIDE, type BeingFeed } from '../../src/shared/being-feed.ts';

function oneBeingFeed(): BeingFeed {
  const data = new Uint16Array(FEED_STRIDE);
  data.set([1, 1, 10, 5, 2, BeingState.Idle]);
  return { tick: 0, count: 1, data, buildings: null, boats: [] };
}

describe('resetCreatureView', () => {
  it('empties the feed sample, clears the creature layer and counts the reset', () => {
    const interp = new FeedInterp();
    interp.push(oneBeingFeed(), 0);
    const out: DrawBeing[] = [];
    expect(interp.sample(0, out)).toBe(1);

    let cleared = 0;
    const count = { resets: 0 };
    resetCreatureView(interp, { clear: () => cleared++ }, count);

    expect(interp.sample(0, [])).toBe(0);
    expect(cleared).toBe(1);
    expect(count.resets).toBe(1);
  });
});
