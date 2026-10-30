/**
 * The 2D atlas of baked creature frames: the Pixi texture layer over the pixi-free baking core (atlas-core.ts). Each page
 * canvas gets a Pixi CanvasSource, uploaded on flush; each placed frame gets a Texture on that source. The bake, the page
 * layout and the flush schedule are in atlas-core.ts.
 */
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { AtlasCore, type FramePx, type Page } from './atlas-core.ts';
import type { FrameSource } from './creatures.ts';

export type { AtlasOptions, AtlasRect, FramePx } from './atlas-core.ts';

/** The 2D atlas: frames are Pixi textures. Public API as before the split (request, frame, building, stats, rebuild, dispose). */
export class Atlas extends AtlasCore<Texture> implements FrameSource {
  /** The Pixi source of each page canvas, made on the page's first placed frame and destroyed on rebuild. */
  private readonly sources = new WeakMap<Page, CanvasSource>();

  protected override makeTexture(page: Page, x: number, y: number, px: FramePx): Texture {
    return new Texture({ source: this.sourceOf(page), frame: new Rectangle(x, y, px, px) });
  }

  protected override destroyTexture(tex: Texture): void {
    tex.destroy();
  }

  protected override uploadPage(page: Page): void {
    this.sourceOf(page).update();
  }

  protected override destroyPage(page: Page): void {
    this.sources.get(page)?.destroy();
  }

  private sourceOf(page: Page): CanvasSource {
    let source = this.sources.get(page);
    if (!source) {
      source = new CanvasSource({ resource: page.canvas, autoGenerateMipmaps: true, transparent: true });
      this.sources.set(page, source);
    }
    return source;
  }
}
