import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { groundId } from '../../src/content/grounds.ts';
import { HeightField } from '../../src/render3d/heights.ts';
import { SEA_MIRROR_PX, buildSeaGeometry, buildWaterChunk, waterNormalPixels } from '../../src/render3d/water3d.ts';
import { Terrain3D } from '../../src/render3d/terrain3d.ts';

function fill(f: HeightField, ground: number, elev: number): void {
  const s = f.side;
  const data = new Uint8Array(s * s * 4);
  for (let p = 0; p < s * s; p++) {
    data[p * 4] = ground;
    data[p * 4 + 2] = elev;
  }
  f.applyRows({ y0: 0, y1: s - 1, data });
}

function sea(side: number, elev: number): HeightField {
  const f = new HeightField(side);
  fill(f, groundId('shoal'), elev);
  return f;
}

describe('buildWaterChunk', () => {
  it('gives four vertices and two triangles per water tile', () => {
    const w = buildWaterChunk(sea(8, 78), 0, 0);
    expect(w).not.toBeNull();
    expect(w!.positions.length / 3).toBe(8 * 8 * 4);
    expect(w!.indices.length).toBe(8 * 8 * 6);
  });

  it('is null when the sea is skipped, since the sea mirror draws it', () => {
    expect(buildWaterChunk(sea(8, 78), 0, 0, { skipSea: true })).toBeNull();
  });

  it('marks molten tiles as glowing and leaves the sea unmarked', () => {
    const f = new HeightField(8);
    fill(f, groundId('molten_2'), 60);
    const molten = buildWaterChunk(f, 0, 0);
    expect(molten).not.toBeNull();
    expect(molten!.glow.every((g) => g === 1)).toBe(true);
    const s = buildWaterChunk(sea(8, 78), 0, 0);
    expect(s!.glow.every((g) => g === 0)).toBe(true);
  });
});

describe('buildSeaGeometry', () => {
  it('is null on a field without sea grounds', () => {
    const f = new HeightField(8);
    fill(f, groundId('lowloam'), 100);
    expect(buildSeaGeometry(f)).toBeNull();
  });

  it('is null on a lake-like field that has no sea, only molten ground', () => {
    const f = new HeightField(8);
    fill(f, groundId('molten_1'), 60);
    expect(buildSeaGeometry(f)).toBeNull();
  });

  it('puts the mirror plane at the lowest sea surface and the quads above it', () => {
    const sg = buildSeaGeometry(sea(8, 78));
    expect(sg).not.toBeNull();
    expect(sg!.planeY).toBeCloseTo(78 * 0.04 + 0.02, 6);
    for (let i = 1; i < sg!.positions.length; i += 3) expect(sg!.positions[i]).toBeGreaterThanOrEqual(-1e-6);
  });
});

describe('water normal map', () => {
  it('is a non-blank pixel buffer of the chosen size, mostly pointing up', () => {
    const size = 64;
    const px = waterNormalPixels(size);
    expect(px.length).toBe(size * size * 4);
    let lo = 255;
    let hi = 0;
    let blue = 0;
    for (let p = 0; p < size * size; p++) {
      const r = px[p * 4]!;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
      blue += px[p * 4 + 2]!;
      expect(px[p * 4 + 3]).toBe(255);
    }
    expect(hi - lo).toBeGreaterThan(10);
    expect(blue / (size * size)).toBeGreaterThan(128);
  });

  it('uses a 512 px sea mirror', () => {
    expect(SEA_MIRROR_PX).toBe(512);
  });
});

describe('sea mirror', () => {
  function harness(f: HeightField) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const ctx = { scene, camera, field: f, renderer: {} as THREE.WebGLRenderer, toScreen: () => null, buildings: () => [], boats: () => [] };
    const layer = new Terrain3D();
    layer.init(ctx);
    return { scene, layer };
  }
  const mirrors = (scene: THREE.Scene) => scene.children.filter((c) => c instanceof Water);

  it('no sea, no mirror', () => {
    const f = new HeightField(64);
    fill(f, groundId('lowloam'), 100);
    const { scene, layer } = harness(f);
    layer.onSide(64);
    expect(mirrors(scene)).toHaveLength(0);
  });

  it('a sea area makes exactly one mirror', () => {
    const { scene, layer } = harness(sea(64, 78));
    layer.onSide(64);
    expect(mirrors(scene)).toHaveLength(1);
  });
});
