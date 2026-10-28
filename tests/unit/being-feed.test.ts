import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { G } from '../../src/content/grounds.ts';
import { BeingFeedEncoder, BeingState, FEED_STRIDE, encodeBeings, readBeing, type BeingFeed } from '../../src/shared/being-feed.ts';

/** A feed over a fresh buffer sized for the sim's whole store, as the worker allocates it. */
function feedOf(sim: Sim, count: number, data: Uint16Array): BeingFeed {
  return { tick: sim.tick, count, data, buildings: null, boats: [] };
}

function bufferFor(sim: Sim): Uint16Array {
  return new Uint16Array(sim.beings.store.capacity * FEED_STRIDE);
}

/** Makes a tile plain land, so the being on it is not in the sea. */
function putOnLand(sim: Sim, x: number, y: number): void {
  sim.realm.ground[y * sim.realm.side + x] = G.lowloam;
}

describe('being feed', () => {
  it('encodes every living being', () => {
    const sim = new Sim(1, 1);
    const spots: [number, number][] = [
      [5, 5],
      [9, 4],
      [12, 11],
    ];
    for (const [x, y] of spots) {
      putOnLand(sim, x, y);
      sim.beings.store.spawn(2, x, y, 0, 10, 100, 0);
    }
    const data = bufferFor(sim);
    const count = encodeBeings(sim, data);
    expect(count).toBe(3);
    const feed = feedOf(sim, count, data);
    spots.forEach(([x, y], i) => {
      const being = readBeing(feed, i);
      expect(being.x).toBe(x);
      expect(being.y).toBe(y);
      expect(being.species).toBe(2);
    });
  });

  it('slot reuse changes generation', () => {
    const sim = new Sim(1, 1);
    const store = sim.beings.store;
    putOnLand(sim, 5, 5);
    const slot = store.spawn(2, 5, 5, 0, 10, 100, 0);
    const data = bufferFor(sim);
    const before = readBeing(feedOf(sim, encodeBeings(sim, data), data), 0);
    store.kill(slot);
    expect(store.spawn(2, 5, 5, 0, 10, 100, 0)).toBe(slot);
    const after = readBeing(feedOf(sim, encodeBeings(sim, data), data), 0);
    expect(after.slot).toBe(before.slot);
    expect(after.gen).not.toBe(before.gen);
  });

  it('state flags: sleep, hit and swim', () => {
    const sim = new Sim(1, 1);
    const store = sim.beings.store;
    putOnLand(sim, 5, 5);
    const slot = store.spawn(2, 5, 5, 0, 10, 100, 0);
    const data = bufferFor(sim);
    const stateNow = (): number => readBeing(feedOf(sim, encodeBeings(sim, data), data), 0).state;

    store.sleepUntil[slot] = sim.tick + 10;
    expect(stateNow()).toBe(BeingState.Sleep);
    store.sleepUntil[slot] = 0;

    sim.combat.hitUntil[slot] = sim.tick + 10;
    expect(stateNow()).toBe(BeingState.Hit);
    sim.combat.hitUntil[slot] = 0;

    sim.realm.ground[5 * sim.realm.side + 5] = G.deepmere;
    expect(stateNow()).toBe(BeingState.Swim);
  });

  it('walk and run from movement', () => {
    const sim = new Sim(1, 1);
    const store = sim.beings.store;
    putOnLand(sim, 5, 5);
    putOnLand(sim, 6, 5);
    putOnLand(sim, 9, 5);
    const slot = store.spawn(2, 5, 5, 0, 10, 100, 0);
    const data = bufferFor(sim);
    const stateNow = (): number => readBeing(feedOf(sim, encodeBeings(sim, data), data), 0).state;

    expect(stateNow()).toBe(BeingState.Idle);
    store.x[slot] = 6;
    expect(stateNow()).toBe(BeingState.Walk);
    store.x[slot] = 9;
    expect(stateNow()).toBe(BeingState.Run);
  });

  it('a reused slot reads Idle on its first encode, not Walk or Run', () => {
    const sim = new Sim(1, 1);
    const store = sim.beings.store;
    putOnLand(sim, 5, 5);
    putOnLand(sim, 6, 5);
    putOnLand(sim, 9, 5);
    const slot = store.spawn(2, 5, 5, 0, 10, 100, 0);
    const data = bufferFor(sim);
    const stateNow = (): number => readBeing(feedOf(sim, encodeBeings(sim, data), data), 0).state;

    expect(stateNow()).toBe(BeingState.Idle);
    store.x[slot] = 6;
    expect(stateNow()).toBe(BeingState.Walk);
    store.kill(slot);
    // Respawned into the same slot, three tiles away from its last tile: without the generation check this is Run.
    expect(store.spawn(2, 9, 5, 0, 10, 100, 0)).toBe(slot);
    expect(stateNow()).toBe(BeingState.Idle);
  });

  it('a Being that did not move since the last call is Idle', () => {
    const sim = new Sim(1, 1);
    putOnLand(sim, 5, 5);
    sim.beings.store.spawn(2, 5, 5, 0, 10, 100, 0);
    const data = bufferFor(sim);
    encodeBeings(sim, data);
    expect(readBeing(feedOf(sim, encodeBeings(sim, data), data), 0).state).toBe(BeingState.Idle);
  });

  it('each Sim keeps its own movement history', () => {
    const simA = new Sim(1, 1);
    const simB = new Sim(2, 1);
    putOnLand(simA, 5, 5);
    putOnLand(simA, 6, 5);
    putOnLand(simB, 9, 9);
    const slotA = simA.beings.store.spawn(2, 5, 5, 0, 10, 100, 0);
    simB.beings.store.spawn(2, 9, 9, 0, 10, 100, 0);
    const encoder = new BeingFeedEncoder(simA.beings.store.capacity);
    const dataA = bufferFor(simA);
    const dataB = bufferFor(simB);
    encoder.encode(simA, dataA);
    simA.beings.store.x[slotA] = 6;
    expect(readBeing(feedOf(simA, encoder.encode(simA, dataA), dataA), 0).state).toBe(BeingState.Walk);
    // A second Sim with its own encoder has no history for its Being, so it is Idle on the first call.
    expect(readBeing(feedOf(simB, encodeBeings(simB, dataB), dataB), 0).state).toBe(BeingState.Idle);
  });

  it('encodeBeings keeps per-Sim history when two Sims share a slot number', () => {
    const simA = new Sim(1, 1);
    const simB = new Sim(2, 1);
    putOnLand(simA, 5, 5);
    putOnLand(simA, 6, 5);
    putOnLand(simB, 9, 9);
    const slotA = simA.beings.store.spawn(2, 5, 5, 0, 10, 100, 0);
    const slotB = simB.beings.store.spawn(2, 9, 9, 0, 10, 100, 0);
    expect(slotB).toBe(slotA);
    const dataA = bufferFor(simA);
    const dataB = bufferFor(simB);
    encodeBeings(simA, dataA);
    encodeBeings(simB, dataB);
    simA.beings.store.x[slotA] = 6;
    expect(readBeing(feedOf(simA, encodeBeings(simA, dataA), dataA), 0).state).toBe(BeingState.Walk);
    // A shared encoder would see B's Being 3 tiles from A's last tile (Run); per-Sim history keeps it Idle.
    expect(readBeing(feedOf(simB, encodeBeings(simB, dataB), dataB), 0).state).toBe(BeingState.Idle);
  });

  it('truncates to the buffer: writes only what fits and nothing past it', () => {
    const sim = new Sim(1, 1);
    const spots: [number, number][] = [
      [5, 5],
      [9, 4],
      [12, 11],
    ];
    for (const [x, y] of spots) {
      putOnLand(sim, x, y);
      sim.beings.store.spawn(2, x, y, 0, 10, 100, 0);
    }
    // Room for two Beings plus a stray partial word: count is 2 and the tail keeps its sentinel.
    const SENTINEL = 0xffff;
    const data = new Uint16Array(2 * FEED_STRIDE + 2).fill(SENTINEL);
    const count = encodeBeings(sim, data);
    expect(count).toBe(2);
    expect(data[2 * FEED_STRIDE]).toBe(SENTINEL);
    expect(data[2 * FEED_STRIDE + 1]).toBe(SENTINEL);
    const feed = feedOf(sim, count, data);
    expect(readBeing(feed, 1).x).toBe(9);
    expect(readBeing(feed, 1).y).toBe(4);

    // A buffer too small for even one Being writes nothing.
    const empty = new Uint16Array(FEED_STRIDE - 1).fill(SENTINEL);
    expect(encodeBeings(sim, empty)).toBe(0);
    expect(empty.every((w) => w === SENTINEL)).toBe(true);
  });

  it('does not touch the state hash', () => {
    const sim = new Sim(1, 1);
    putOnLand(sim, 5, 5);
    sim.beings.store.spawn(2, 5, 5, 0, 10, 100, 0);
    const before = sim.stateHash();
    encodeBeings(sim, bufferFor(sim));
    expect(sim.stateHash()).toBe(before);
  });
});
