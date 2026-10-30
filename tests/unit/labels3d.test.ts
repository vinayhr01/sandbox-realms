import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LabelPool } from '../../src/render3d/labels3d.ts';
import { HeightField } from '../../src/render3d/heights.ts';
import { Marks3D, drapeLine } from '../../src/render3d/marks3d.ts';
import type { FrameInput } from '../../src/render/world-renderer.ts';
import type { MarkToggles } from '../../src/render/marks.ts';
import type { InsightToggles } from '../../src/render/insight-layers.ts';
import type { Snapshot } from '../../src/shared/protocol.ts';
import type { Layer3DContext } from '../../src/render3d/layer.ts';

/** A canvas stand-in: the pool needs only getContext, width and height. Node has no DOM. */
function fakeCanvas(): HTMLCanvasElement {
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    textBaseline: '',
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillText: () => {},
    strokeText: () => {},
  };
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

describe('LabelPool', () => {
  it('reuses the texture for equal keys', () => {
    const pool = new LabelPool(fakeCanvas);
    const a = pool.acquire('Ash', 16, 0xffffff);
    const b = pool.acquire('Ash', 16, 0xffffff);
    const c = pool.acquire('Ash', 18, 0xffffff);
    expect(a.material.map).toBe(b.material.map);
    expect(a.material.map).not.toBe(c.material.map);
    expect(pool.cacheSize).toBe(2);
  });

  it('sets the world height to fontPx / 32 tiles', () => {
    const pool = new LabelPool(fakeCanvas);
    const s = pool.acquire('Ash', 32, 0xffffff);
    expect(s.scale.y).toBeCloseTo(1, 6);
  });

  it('evicts beyond 512 textures, least recently used first', () => {
    const pool = new LabelPool(fakeCanvas);
    const first = pool.acquire('n0', 16, 0xffffff).material.map;
    for (let i = 1; i < 512; i++) pool.acquire(`n${i}`, 16, 0xffffff);
    expect(pool.cacheSize).toBe(512);
    // Touch n0 so n1 is now the oldest, then add one more key: n1 is evicted, n0 is kept.
    pool.acquire('n0', 16, 0xffffff);
    pool.acquire('extra', 16, 0xffffff);
    expect(pool.cacheSize).toBe(512);
    expect(pool.acquire('n0', 16, 0xffffff).material.map).toBe(first);
  });

  it('returns sprites to the pool on releaseAll', () => {
    const pool = new LabelPool(fakeCanvas);
    const s = pool.acquire('Ash', 16, 0xffffff);
    new THREE.Group().add(s);
    pool.releaseAll();
    expect(s.parent).toBeNull();
    expect(pool.acquire('Oak', 16, 0xffffff)).toBe(s);
  });
});

describe('drapeLine', () => {
  it('a line from (0,0) to (10,0) has 11 points, each at heightAt + 0.1', () => {
    const field = new HeightField(16);
    for (let i = 0; i < field.elev.length; i++) field.elev[i] = (i % 16) * 3;
    const pts = drapeLine(field, 0, 0, 10, 0);
    expect(pts.length).toBe(11);
    for (const [x, y, z] of pts) {
      expect(y).toBeCloseTo(field.heightAt(x, z) + 0.1, 6);
    }
    expect(pts[0]?.[0]).toBe(0);
    expect(pts[10]?.[0]).toBe(10);
  });
});

const ALL_MARKS: MarkToggles = {
  items: true,
  favourites: true,
  armies: true,
  campaigns: true,
  battles: true,
  intrigues: true,
  names: 'full',
  favouritesOnlyNames: false,
  nameScale: 70,
};
const ALL_INSIGHT: InsightToggles = {
  layer: 'off',
  mode: 'borders',
  happiness: true,
  tasks: true,
  armyLines: true,
  selectedHamlet: -1,
  talkBubbles: true,
  arrows: new Set(['arrow.destination', 'arrow.home', 'arrow.partner', 'arrow.family', 'arrow.parents', 'arrow.children', 'arrow.attack']),
  hoverId: 1,
  moneyFlow: true,
  selectedDominion: 0,
  accordDominion: 0,
};

/** A snapshot with one of everything the marks draw. */
function richSnapshot(tick: number): Snapshot {
  return {
    tick,
    mapPoints: [
      { id: 1, x: 4, y: 4, folk: true },
      { id: 2, x: 8, y: 8, folk: true },
    ],
    mapKinds: [
      { id: 1, group: 'folk', size: 'M', mood: 80, task: 'chat' },
      { id: 2, group: 'folk', size: 'M', mood: 0, task: '' },
    ],
    items: { rows: [{ id: 1, holder: 'worn', at: 1, favourite: true }] },
    mapIntrigues: [{ id: 1, kind: 'rebellion', active: true, x: 6, y: 6 }],
    mapMarks: {
      armies: [{ dominionId: 0, x: 3, y: 3 }],
      campaigns: [{ dominionId: 0, x: 5, y: 5 }],
      battles: [{ x: 7, y: 7 }],
      pactLinks: [[3, 3, 9, 9]],
      hamlets: [{ name: 'Ash', x: 2, y: 2 }],
      armyLines: [[3, 3, 9, 4]],
    },
    mapLinks: [{ id: 1, partner: 2 }],
    mapTaxFlows: [{ x: 2, y: 2, dominion: 0, to: [5, 5], loot: 40, toRuler: 10 }],
  } as unknown as Snapshot;
}

function frame(over: Partial<FrameInput>, tick: number): FrameInput {
  return {
    dtMs: 16,
    nowMs: 0,
    beings: [],
    beingCount: 0,
    snapshot: richSnapshot(tick),
    marks: ALL_MARKS,
    insight: ALL_INSIGHT,
    map: {} as FrameInput['map'],
    cursor: {} as FrameInput['cursor'],
    hoverId: 1,
    degradedOff: new Set(),
    ...over,
  } as FrameInput;
}

function ctxFor(field: HeightField): { ctx: Layer3DContext; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const ctx = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    field,
    renderer: {} as THREE.WebGLRenderer,
    toScreen: () => null,
  } as Layer3DContext;
  return { ctx, scene };
}

/** Visible meshes, lines and sprites in the scene. */
function drawableCount(scene: THREE.Scene): number {
  let n = 0;
  scene.traverseVisible((o) => {
    if (o === scene) return;
    if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) n++;
  });
  return n;
}

describe('Marks3D toggles', () => {
  it('draws objects with everything on, and none with every key off', () => {
    // Node has no DOM: the label pool asks for a canvas through document.createElement.
    vi.stubGlobal('document', { createElement: () => fakeCanvas() });
    const field = new HeightField(16);
    const { ctx, scene } = ctxFor(field);
    const layer = new Marks3D();
    layer.init(ctx);
    layer.frame(frame({}, 1), ctx);
    expect(drawableCount(scene)).toBeGreaterThan(0);

    const off = frame(
      {
        marks: { items: false, favourites: false, armies: false, campaigns: false, battles: false, intrigues: false, names: 'off', favouritesOnlyNames: false, nameScale: 70 },
        insight: { ...ALL_INSIGHT, armyLines: false, talkBubbles: false, arrows: new Set(), hoverId: -1, moneyFlow: false, selectedDominion: -1, accordDominion: -1 },
      },
      2,
    );
    layer.frame(off, ctx);
    expect(drawableCount(scene)).toBe(0);
    layer.dispose();
    vi.unstubAllGlobals();
  });
});
