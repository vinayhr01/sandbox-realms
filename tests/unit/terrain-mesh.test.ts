import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { groundId } from '../../src/content/grounds.ts';
import { HeightField } from '../../src/render3d/heights.ts';
import { CHUNK, buildChunk, chunkLod, waterSurface } from '../../src/render3d/terrain-mesh.ts';
import { Terrain3D } from '../../src/render3d/terrain3d.ts';

/** Fills every tile of the field with a ground and an elevation, or per-tile functions. */
function fill(f: HeightField, ground: number | ((x: number, y: number) => number), elev: number | ((x: number, y: number) => number)): void {
  const s = f.side;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const o = (y * s + x) * 4;
      data[o] = typeof ground === 'number' ? ground : ground(x, y);
      data[o + 2] = typeof elev === 'number' ? elev : elev(x, y);
    }
  }
  f.applyRows({ y0: 0, y1: s - 1, data });
}

function field(side: number, elev: number): HeightField {
  const f = new HeightField(side);
  fill(f, groundId('lowloam'), elev);
  return f;
}

function harness(side: number, elev = 100) {
  const f = field(side, elev);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const ctx = { scene, camera, field: f, renderer: {} as THREE.WebGLRenderer, toScreen: () => null, buildings: () => [], boats: () => [] };
  const layer = new Terrain3D();
  layer.init(ctx);
  return { f, scene, layer };
}

function terrainMeshes(scene: THREE.Scene): THREE.Mesh[] {
  return scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.userData['kind'] === 'terrain');
}

function geometryByChunk(scene: THREE.Scene): Map<string, string> {
  return new Map(terrainMeshes(scene).map((m) => [`${m.userData['cx']},${m.userData['cy']}`, m.geometry.uuid]));
}

describe('buildChunk', () => {
  it('puts every vertex of a flat elev-100 field at y = 4.0', () => {
    const { positions } = buildChunk(field(64, 100), 0, 0, 1);
    for (let i = 1; i < positions.length; i += 3) expect(positions[i]).toBeCloseTo(4.0, 6);
  });

  it.each([1, 2, 4] as const)('gives (CHUNK/%i+1)^2 vertices for a full chunk', (step) => {
    const { positions, indices } = buildChunk(field(64, 100), 0, 0, step);
    const n = CHUNK / step + 1;
    expect(positions.length / 3).toBe(n * n);
    expect(indices.length).toBe((n - 1) * (n - 1) * 6);
  });

  it('places vertices on the tile corners of its chunk', () => {
    const { positions } = buildChunk(field(64, 100), 1, 0, 1);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]!);
      maxX = Math.max(maxX, positions[i]!);
    }
    expect(minX).toBe(CHUNK);
    expect(maxX).toBe(2 * CHUNK);
  });
});

describe('chunkLod', () => {
  it('is 1 near, 2 mid range and 4 far', () => {
    expect(chunkLod(10)).toBe(1);
    expect(chunkLod(100)).toBe(2);
    expect(chunkLod(500)).toBe(4);
  });
});

describe('waterSurface', () => {
  it('is null on grass', () => {
    expect(waterSurface(field(8, 100), 2, 2)).toBeNull();
  });

  it('is the tile height plus 0.02 on a water tile', () => {
    // The realm has no river kind. Shoal is the water kind used here, at elev 78.
    const f = new HeightField(8);
    fill(f, groundId('shoal'), 78);
    expect(waterSurface(f, 2, 2)).toBeCloseTo(78 * 0.04 + 0.02, 6);
  });
});

describe('Terrain3D', () => {
  it('rebuilds every chunk on setSide, with no meshes from the old side', () => {
    const { f, scene, layer } = harness(64);
    layer.onSide(64);
    const old = new Set(terrainMeshes(scene).map((m) => m.uuid));
    expect(old.size).toBe(4);

    f.reset(40);
    fill(f, groundId('lowloam'), 100);
    layer.onSide(40);
    const meshes = terrainMeshes(scene);
    expect(meshes).toHaveLength(4);
    for (const m of meshes) {
      expect(old.has(m.uuid)).toBe(false);
      m.geometry.computeBoundingBox();
      expect(m.geometry.boundingBox!.max.x).toBeLessThanOrEqual(40);
      expect(m.geometry.boundingBox!.max.z).toBeLessThanOrEqual(40);
    }
  });

  it('onRows({5}) rebuilds only chunk row 0', () => {
    const { f, scene, layer } = harness(64);
    layer.onSide(64);
    const before = geometryByChunk(scene);

    fill(f, groundId('lowloam'), (_x, y) => (y === 5 ? 120 : 100));
    layer.onRows(new Set([5]));
    const after = geometryByChunk(scene);

    expect(after.get('0,0')).not.toBe(before.get('0,0'));
    expect(after.get('1,0')).not.toBe(before.get('1,0'));
    expect(after.get('0,1')).toBe(before.get('0,1'));
    expect(after.get('1,1')).toBe(before.get('1,1'));
  });

  it('also rebuilds the chunk row above when a tile on the boundary row changes', () => {
    const { f, scene, layer } = harness(64);
    layer.onSide(64);
    const before = geometryByChunk(scene);

    fill(f, groundId('lowloam'), (_x, y) => (y === 31 ? 120 : 100));
    layer.onRows(new Set([31]));
    const after = geometryByChunk(scene);

    expect(after.get('0,0')).not.toBe(before.get('0,0'));
    expect(after.get('0,1')).not.toBe(before.get('0,1'));
  });
});
