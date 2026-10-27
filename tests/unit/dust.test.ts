import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { DUST_LIFE_MS, DustPool } from '../../src/render/dust.ts';

describe('DustPool live count', () => {
  it('counts puffs from emit to expiry and does nothing while none are alive', () => {
    const parent = new Container();
    const pool = new DustPool(parent, Texture.EMPTY);
    expect(pool.liveCount()).toBe(0);
    // Nothing alive: update and clear return at once and touch no sprite.
    pool.update(16);
    pool.clear();
    expect(parent.children.length).toBe(0);

    pool.emit(10, 10, 1);
    pool.emit(20, 10, -1);
    expect(pool.liveCount()).toBe(2);
    pool.update(DUST_LIFE_MS / 2);
    expect(pool.liveCount()).toBe(2);
    pool.update(DUST_LIFE_MS);
    expect(pool.liveCount()).toBe(0);
    expect(parent.children.every((c) => !c.visible)).toBe(true);
  });

  it('clear hides the live puffs and zeroes the count', () => {
    const parent = new Container();
    const pool = new DustPool(parent, Texture.EMPTY);
    pool.emit(1, 1, 1);
    expect(parent.children[0]?.visible).toBe(true);
    pool.clear();
    expect(pool.liveCount()).toBe(0);
    expect(parent.children[0]?.visible).toBe(false);
    // A cleared puff aged out: updating again does not drive the count below zero.
    pool.update(16);
    expect(pool.liveCount()).toBe(0);
  });

  it('recycling the oldest puff over the cap does not count it twice', async () => {
    const { DUST_MAX } = await import('../../src/render/dust.ts');
    const pool = new DustPool(new Container(), Texture.EMPTY);
    for (let i = 0; i < DUST_MAX + 10; i++) pool.emit(i, 0, 1);
    expect(pool.liveCount()).toBe(DUST_MAX);
  });
});
