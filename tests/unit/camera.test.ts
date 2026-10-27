import { describe, expect, it } from 'vitest';
import { Camera, MAX_ZOOM_PX } from '../../src/render/camera.ts';

describe('camera max zoom', () => {
  it('is 96 CSS px per tile on a small realm', () => {
    const cam = new Camera(192, 1280, 720);
    expect(cam.maxZoom).toBe(96);
  });

  it('is 96 CSS px per tile on Titan (576)', () => {
    const cam = new Camera(576, 1280, 720);
    expect(cam.maxZoom).toBe(96);
  });

  it('is the same on every realm and every viewport', () => {
    expect(new Camera(256, 360, 640).maxZoom).toBe(MAX_ZOOM_PX);
    expect(new Camera(512, 1920, 1080).maxZoom).toBe(MAX_ZOOM_PX);
  });

  it('zoomAt stops at the maximum', () => {
    const cam = new Camera(256, 1280, 720);
    cam.zoomAt(1000, 640, 360);
    expect(cam.zoom).toBe(96);
  });
});
