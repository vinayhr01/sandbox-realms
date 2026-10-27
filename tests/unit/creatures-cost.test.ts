import { Application, Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { SPECIES } from '../../src/content/beasts.ts';
import { SPECIES_GAIT } from '../../src/art/gaits.ts';
import { BeingState } from '../../src/shared/being-feed.ts';
import { CreatureLayer, type FrameSource } from '../../src/render/creatures.ts';
import type { DrawBeing } from '../../src/render/feed-interp.ts';

function fakeApp(): Application {
  return { stage: new Container(), renderer: { canvas: new EventTarget(), textureGenerator: { generateTexture: () => Texture.EMPTY } } } as unknown as Application;
}

/** A frame source that has every frame, so the layer plays the gait rather than the silhouette. */
const everyFrame: FrameSource = { frame: () => Texture.EMPTY };

interface Internals {
  dust: { liveCount(): number };
  phases: { size(): number };
}

const VIEW = { offX: 0, offY: 0, zoom: 8, viewW: 800, viewH: 600 };

/** The first species index whose land gait satisfies `pick`. */
function speciesWhere(pick: (land: string) => boolean): number {
  const i = SPECIES.findIndex((s) => {
    const g = SPECIES_GAIT[s.id];
    return g !== undefined && pick(g.land);
  });
  if (i < 0) throw new Error('no such species');
  return i;
}

const WALKER = speciesWhere((land) => land === 'quad');
const FLYER = speciesWhere((land) => land === 'flyer');

function mover(species: number, state: BeingState, frame: number): DrawBeing {
  // 20 tiles per second at 100 ms a frame: well past the run speed, and a stride wraps every few frames.
  return { key: (1 << 16) | 1, x: 10 + frame * 2, y: 10, species, state, child: false, facing: 1, alpha: 1, moved: 2 };
}

/** Draws 12 frames of one being moving fast and returns the layer. */
function run(species: number, state: BeingState, configure?: (layer: CreatureLayer) => void): CreatureLayer {
  const layer = new CreatureLayer(fakeApp());
  layer.setFrameSource(everyFrame);
  configure?.(layer);
  for (let f = 0; f < 12; f++) layer.draw([mover(species, state, f)], 1, VIEW, f * 100);
  layer.dispose();
  return layer;
}

const live = (layer: CreatureLayer): number => (layer as unknown as Internals).dust.liveCount();

describe('footfall dust gating', () => {
  it('kicks up dust for a fast walker', () => {
    expect(live(run(WALKER, BeingState.Walk))).toBeGreaterThan(0);
  });

  it('kicks up none for a swimmer, a flyer or a being that is not walking', () => {
    expect(live(run(WALKER, BeingState.Swim))).toBe(0);
    expect(live(run(FLYER, BeingState.Walk))).toBe(0);
    expect(live(run(WALKER, BeingState.Idle))).toBe(0);
  });

  it('kicks up none while creature animation is off or particles are off', () => {
    const toggles = { shadows: true, boats: false, particles: true, crowdAnim: true, dust: true, creatureAnim: true };
    expect(live(run(WALKER, BeingState.Walk, (l) => l.setToggles({ ...toggles, creatureAnim: false })))).toBe(0);
    expect(live(run(WALKER, BeingState.Walk, (l) => l.setToggles({ ...toggles, dust: false })))).toBe(0);
  });
});

describe('beings out of view', () => {
  it('are not stepped or remembered', () => {
    const layer = new CreatureLayer(fakeApp());
    layer.setFrameSource(everyFrame);
    const beings: DrawBeing[] = [];
    for (let i = 0; i < 50; i++) beings.push({ ...mover(WALKER, BeingState.Walk, 0), key: (i + 1) << 16 | 1, x: i < 10 ? 10 + i : 5000 + i });
    layer.draw(beings, beings.length, VIEW, 0);
    layer.draw(beings, beings.length, VIEW, 100);
    expect(layer.drawnCount()).toBe(10);
    expect((layer as unknown as Internals).phases.size()).toBe(10);
    layer.dispose();
  });
});
