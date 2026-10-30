import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Effects3D } from '../../src/render3d/effects3d.ts';
import { HeightField } from '../../src/render3d/heights.ts';
import type { Layer3DContext } from '../../src/render3d/layer.ts';
import { MAX_PARTICLES, STROKE_PUFF_MS } from '../../src/render/effects.ts';

/** A context with a scene and a height field; the layer needs no WebGL to build its buffers. */
function ctxOf(): Layer3DContext {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(50, 1, 0.1, 512),
    field: new HeightField(8),
    renderer: {} as THREE.WebGLRenderer,
    toScreen: () => null,
  };
}

function layer(over: { reduceMotion?: boolean; reduceFlash?: boolean } = {}): Effects3D {
  const fx = new Effects3D({ reduceMotion: () => over.reduceMotion === true, reduceFlash: () => over.reduceFlash === true });
  fx.init(ctxOf());
  return fx;
}

describe('Effects3D', () => {
  it('caps live particles at MAX_PARTICLES and reuses slots over the cap', () => {
    const fx = layer();
    for (let i = 0; i < 300; i++) fx.play('blast', 3, 3, 1);
    expect(fx.liveCount()).toBe(MAX_PARTICLES);
  });

  it('plays nothing for the rule recipe', () => {
    const fx = layer();
    fx.play('rule', 1, 1, 1);
    expect(fx.liveCount()).toBe(0);
  });

  it('does not add a second stroke puff within the throttle, and adds one after it', () => {
    const fx = layer();
    fx.playStroke('brush', 2, 2, 1);
    const first = fx.liveCount();
    expect(first).toBeGreaterThan(0);
    fx.playStroke('brush', 2, 2, 1);
    expect(fx.liveCount()).toBe(first);
    fx.update(STROKE_PUFF_MS);
    fx.playStroke('brush', 2, 2, 1);
    expect(fx.liveCount()).toBe(first * 2);
  });

  it('frees particles once their life has run out', () => {
    const fx = layer();
    fx.play('brush', 2, 2, 1);
    expect(fx.liveCount()).toBeGreaterThan(0);
    fx.update(1000);
    expect(fx.liveCount()).toBe(0);
  });

  it('plays one ring under reduce motion', () => {
    const fx = layer({ reduceMotion: true });
    fx.play('blast', 2, 2, 1);
    expect(fx.liveCount()).toBe(1);
  });

  it('plays nothing while disabled, and clears what is showing when turned off', () => {
    const fx = layer();
    fx.play('brush', 2, 2, 1);
    fx.setEnabled(false);
    expect(fx.liveCount()).toBe(0);
    fx.play('brush', 2, 2, 1);
    expect(fx.liveCount()).toBe(0);
  });
});
