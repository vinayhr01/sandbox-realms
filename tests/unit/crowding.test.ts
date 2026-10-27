import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { CROWD_LIMIT, animStep, framePxFor } from '../../src/render/creatures.ts';
import { DUST_LIFE_MS, DUST_MAX, DustPool } from '../../src/render/dust.ts';

describe('framePxFor (frame size by drawn height)', () => {
  it('uses the 48 px frame up to 56 CSS px drawn', () => {
    expect(framePxFor(10)).toBe(48);
    expect(framePxFor(56)).toBe(48);
  });

  it('uses the 128 px frame above 56 CSS px drawn', () => {
    expect(framePxFor(56.5)).toBe(128);
    expect(framePxFor(100)).toBe(128);
  });
});

describe('animStep (crowding LOD)', () => {
  it('animates every being while the screen is not crowded', () => {
    expect(CROWD_LIMIT).toBe(1500);
    expect(animStep(0, 100)).toBe(1);
    expect(animStep(1400, 1500)).toBe(1);
  });

  it('halves the rate of the furthest third once crowded', () => {
    expect(animStep(2900, 3000)).toBe(2);
    expect(animStep(2000, 3000)).toBe(2);
    expect(animStep(1999, 3000)).toBe(1);
  });

  it('holds the furthest sixth once the screen passes twice the limit', () => {
    expect(animStep(3500, 3600)).toBe(0);
    expect(animStep(3000, 3600)).toBe(0);
    expect(animStep(2999, 3600)).toBe(2);
  });

  it('holds the furthest third below the limit when the crowd LOD is degraded off', () => {
    expect(animStep(0, 100, false)).toBe(1);
    expect(animStep(66, 100, false)).toBe(1);
    expect(animStep(67, 100, false)).toBe(0);
    expect(animStep(99, 100, false)).toBe(0);
    expect(animStep(2999, 3600, false)).toBe(0);
  });
});

describe('DustPool', () => {
  it('never holds more than 256 sprites under 1,000 emits', () => {
    const parent = new Container();
    const dust = new DustPool(parent, Texture.WHITE);
    for (let i = 0; i < 1000; i++) dust.emit(i, i, 1);
    expect(parent.children.length).toBeLessThanOrEqual(DUST_MAX);
    expect(parent.children.length).toBe(DUST_MAX);
  });

  it('shows a puff for its life and hides it after', () => {
    const parent = new Container();
    const dust = new DustPool(parent, Texture.WHITE);
    dust.emit(10, 20, -1);
    const sprite = parent.children[0] as Container;
    expect(sprite.visible).toBe(true);
    dust.update(DUST_LIFE_MS - 1);
    expect(sprite.visible).toBe(true);
    dust.update(1);
    expect(sprite.visible).toBe(false);
  });

  it('hides every puff on clear', () => {
    const parent = new Container();
    const dust = new DustPool(parent, Texture.WHITE);
    for (let i = 0; i < 5; i++) dust.emit(i, i, 1);
    dust.clear();
    expect(parent.children.every((c) => !c.visible)).toBe(true);
  });
});
