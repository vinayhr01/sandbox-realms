import { Application, Container, Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { BeingState } from '../../src/shared/being-feed.ts';
import { CreatureLayer } from '../../src/render/creatures.ts';
import type { DrawBeing } from '../../src/render/feed-interp.ts';

/** A Pixi-free stand-in for the application: a stage and a texture generator that returns the empty texture. */
function fakeApp(): { app: Application; stage: Container } {
  const stage = new Container();
  const app = { stage, renderer: { textureGenerator: { generateTexture: () => Texture.EMPTY } } } as unknown as Application;
  return { app, stage };
}

/** Sprites under `c` that are visible. */
function visibleSprites(c: Container): number {
  let n = 0;
  for (const child of c.children) {
    if (child instanceof Sprite && child.visible) n++;
    if (child instanceof Container) n += visibleSprites(child);
  }
  return n;
}

function being(key: number, x: number, y: number): DrawBeing {
  return { key, x, y, species: 0, state: BeingState.Idle, child: false, facing: 1, alpha: 1, moved: 0 };
}

describe('CreatureLayer.clear', () => {
  it('hides every creature sprite and zeroes the drawn count', () => {
    const { app, stage } = fakeApp();
    const layer = new CreatureLayer(app);
    const view = { offX: 0, offY: 0, zoom: 8, viewW: 800, viewH: 600 };
    const beings = [being(1 << 16 | 1, 10, 10), being(2 << 16 | 1, 20, 12), being(3 << 16 | 1, 30, 14)];
    layer.setBuildings([{ id: 1, kind: 'granary', x: 5, y: 5 }]);
    layer.draw(beings, beings.length, view, 0);
    expect(layer.drawnCount()).toBe(3);
    expect(visibleSprites(stage)).toBeGreaterThan(0);

    layer.clear();
    expect(layer.drawnCount()).toBe(0);
    expect(visibleSprites(stage)).toBe(0);
  });
});
