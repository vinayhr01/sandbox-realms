import { Container, Texture, type Application } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { POWERS, POWER_BY_ID } from '../../src/content/powers.ts';
import { recipeFor } from '../../src/render/effectRecipes.ts';
import { EffectsLayer, MAX_PARTICLES, type EffectTextures } from '../../src/render/effects.ts';

/** A stage and canvas stand-in: the layer needs no WebGL when its textures are given. */
function stubApp(): Application {
  const canvas = { addEventListener: () => undefined };
  return { stage: new Container(), renderer: { canvas, textureGenerator: null } } as unknown as Application;
}

const WHITE_TEXTURES: EffectTextures = {
  dot: Texture.WHITE,
  ring: Texture.WHITE,
  streak: Texture.WHITE,
  puff: Texture.WHITE,
  sparkle: Texture.WHITE,
};

function layer(over: { reduceMotion?: boolean; reduceFlash?: boolean } = {}): EffectsLayer {
  return new EffectsLayer(stubApp(), {
    textures: WHITE_TEXTURES,
    reduceMotion: () => over.reduceMotion === true,
    reduceFlash: () => over.reduceFlash === true,
  });
}

describe('recipeFor', () => {
  it('covers every power without throwing', () => {
    expect(POWERS).toHaveLength(250);
    for (const power of POWERS) expect(() => recipeFor(power)).not.toThrow();
  });

  it('maps the spot checks: spawn, brush, weather, blast, meteor, bless, curse and rule', () => {
    expect(recipeFor(POWER_BY_ID.get('spawn_burrfleece') ?? POWERS.find((p) => p.handler === 'spawn_being')!)).toBe('spawn');
    expect(recipeFor(POWER_BY_ID.get('shape_raise') ?? POWERS.find((p) => p.handler === 'terraform_raise')!)).toBe('brush');
    expect(recipeFor(POWER_BY_ID.get('sky_rain')!)).toBe('weather');
    expect(recipeFor(POWER_BY_ID.get('havoc_bomb')!)).toBe('blast');
    expect(recipeFor(POWER_BY_ID.get('omen_skyfall')!)).toBe('meteor');
    expect(recipeFor(POWER_BY_ID.get('omen_tremor')!)).toBe('blast');
    expect(recipeFor(POWER_BY_ID.get('fav_vigor')!)).toBe('bless');
    expect(recipeFor(POWER_BY_ID.get('fav_strife')!)).toBe('curse');
    expect(recipeFor(POWER_BY_ID.get('realm_pause') ?? POWERS.find((p) => p.kind === 'toggle')!)).toBe('rule');
  });
});

describe('EffectsLayer', () => {
  it('caps live particles at MAX_PARTICLES over a thousand rapid plays', () => {
    const fx = layer();
    let peak = 0;
    for (let i = 0; i < 1000; i++) {
      fx.play('blast', i % 50, i % 40, 1);
      peak = Math.max(peak, fx.liveCount());
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  it('reduce motion plays one fading ring for any recipe', () => {
    const fx = layer({ reduceMotion: true });
    fx.play('blast', 3, 3, 1);
    expect(fx.liveCount()).toBe(1);
  });

  it('reduce flash drops the white flash of a blast and keeps the rest', () => {
    const full = layer();
    full.play('blast', 3, 3, 1);
    const quiet = layer({ reduceFlash: true });
    quiet.play('blast', 3, 3, 1);
    expect(full.liveCount() - quiet.liveCount()).toBe(1);
  });

  it('the degrade step makes play a no-op, and turning it off clears the effects', () => {
    const fx = layer();
    fx.setEnabled(false);
    fx.play('spawn', 1, 1, 1);
    expect(fx.liveCount()).toBe(0);
    fx.setEnabled(true);
    fx.play('spawn', 1, 1, 1);
    expect(fx.liveCount()).toBeGreaterThan(0);
    fx.setEnabled(false);
    expect(fx.liveCount()).toBe(0);
  });

  it('a rule has no map effect', () => {
    const fx = layer();
    fx.play('rule', 1, 1, 1);
    expect(fx.liveCount()).toBe(0);
  });
});
