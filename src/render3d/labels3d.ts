/**
 * Camera-facing text sprites for the 3D marks (nameplates). A label is a canvas texture drawn once per (text, font size,
 * colour) and shared by every sprite that shows it. Textures are kept in an LRU of at most 512 entries. Sprites are pooled:
 * releaseAll() detaches them and the next acquire() reuses them. Imports three only (lives in the render3d chunk).
 */
import * as THREE from 'three';

/** Most cached label textures. The least recently used is disposed past this. */
const CACHE_CAP = 512;
/** Canvas padding in px, on each side. */
const PAD_PX = 4;
/** Tiles per CSS px of font size: a label of fontPx is fontPx / 32 tiles tall. */
const TILE_PER_FONT_PX = 1 / 32;
const OUTLINE_PX = 3;

interface Entry {
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
  /** Canvas aspect (width / height), so the sprite keeps the text's shape. */
  aspect: number;
}

type CanvasFactory = () => HTMLCanvasElement;

export class LabelPool {
  private readonly cache = new Map<string, Entry>();
  private readonly active: THREE.Sprite[] = [];
  private readonly free: THREE.Sprite[] = [];

  constructor(private readonly makeCanvas: CanvasFactory = () => document.createElement('canvas')) {}

  /** Number of label textures currently cached. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** A sprite showing `text` at `fontPx` in `colour`. The caller adds it to a parent; releaseAll() detaches it. */
  acquire(text: string, fontPx: number, colour: number): THREE.Sprite {
    const key = JSON.stringify([fontPx, colour, text]);
    let entry = this.cache.get(key);
    if (entry) {
      // Touch: move to the end of the map, so the first key is always the least recently used.
      this.cache.delete(key);
      this.cache.set(key, entry);
    } else {
      entry = this.makeEntry(text, fontPx, colour);
      this.cache.set(key, entry);
      this.evict();
    }
    const sprite = this.free.pop() ?? new THREE.Sprite();
    sprite.material = entry.material;
    const h = fontPx * TILE_PER_FONT_PX;
    sprite.scale.set(h * entry.aspect, h, 1);
    sprite.visible = true;
    this.active.push(sprite);
    return sprite;
  }

  /** Detaches every sprite handed out since the last call, so they can be reused. */
  releaseAll(): void {
    for (const s of this.active) {
      s.removeFromParent();
      this.free.push(s);
    }
    this.active.length = 0;
  }

  /** Frees every texture and material. The pool is not usable afterwards. */
  dispose(): void {
    this.releaseAll();
    for (const entry of this.cache.values()) {
      entry.texture.dispose();
      entry.material.dispose();
    }
    this.cache.clear();
    this.free.length = 0;
  }

  private evict(): void {
    while (this.cache.size > CACHE_CAP) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.cache.get(oldest);
      entry?.texture.dispose();
      entry?.material.dispose();
      this.cache.delete(oldest);
    }
  }

  private makeEntry(text: string, fontPx: number, colour: number): Entry {
    const canvas = this.makeCanvas();
    const font = `${fontPx}px system-ui, sans-serif`;
    const measure = canvas.getContext('2d');
    let textW = text.length * fontPx * 0.6;
    if (measure) {
      measure.font = font;
      textW = measure.measureText(text).width;
    }
    const w = Math.max(1, Math.ceil(textW + PAD_PX * 2));
    const h = Math.max(1, Math.ceil(fontPx + PAD_PX * 2));
    canvas.width = w;
    canvas.height = h;
    // Setting the size resets the context, so draw after it.
    const g = canvas.getContext('2d');
    if (g) {
      g.font = font;
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = OUTLINE_PX;
      g.strokeStyle = '#000000';
      g.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
      g.strokeText(text, PAD_PX, h / 2);
      g.fillText(text, PAD_PX, h / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    return { texture, material, aspect: w / h };
  }
}
