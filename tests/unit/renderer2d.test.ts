import { describe, expect, it } from 'vitest';
import { Camera2D } from '../../src/render/renderer2d.ts';

/** A 2D camera over a 1280 x 720 viewport, with a 256-tile realm. */
function camera(): Camera2D {
  const cam = new Camera2D(() => ({ w: 1280, h: 720 }));
  cam.reset(256);
  return cam;
}

describe('Renderer2D camera seam', () => {
  it('screenToTile(tileToScreen(10,20)) round-trips to the tile centre (10.5, 20.5)', () => {
    const cam = camera();
    const p = cam.toScreen(10, 20);
    expect(p).not.toBeNull();
    const t = cam.toTile(p!.sx, p!.sy);
    expect(t).not.toBeNull();
    expect(t!.x).toBeCloseTo(10.5, 6);
    expect(t!.y).toBeCloseTo(20.5, 6);
  });

  it('rotateBy leaves screenToTile unchanged (2D has no yaw)', () => {
    const cam = camera();
    const before = cam.toTile(300, 200);
    cam.rotateBy(1);
    expect(cam.toTile(300, 200)).toEqual(before);
  });

  it('zoom01 is 0 at minZoom and 1 at maxZoom', () => {
    const cam = camera();
    cam.zoomAt(1e-9, 640, 360);
    expect(cam.zoom01()).toBe(0);
    cam.zoomAt(1e9, 640, 360);
    expect(cam.zoom01()).toBe(1);
  });

  it('has no tile before the first realm sets its side', () => {
    const cam = new Camera2D(() => ({ w: 1280, h: 720 }));
    expect(cam.toTile(10, 10)).toBeNull();
    expect(cam.toScreen(1, 1)).toBeNull();
    expect(cam.visibleTiles()).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });
});
