/**
 * Footfall dust (map-graphics, Task 10): a small puff kicked up behind a being that runs. Puffs live in a fixed ring of
 * sprites, so the pool never grows past DUST_MAX and an emit over the cap recycles the oldest puff. Positions are CSS px
 * in the creature layer's space. The caller decides when to emit (creatures.ts: a footfall of a fast being, with the
 * `map.particles` setting on).
 */
import { Container, Sprite, type Texture } from 'pixi.js';

/** Most puff sprites the pool ever creates. */
export const DUST_MAX = 256;
/** A puff lives this long, fading out as it drifts back and rises. */
export const DUST_LIFE_MS = 300;
const DUST_PX = 2;
const DUST_COLOUR = 0xd8c8a0;
const DUST_DRIFT_PX = 4;
const DUST_RISE_PX = 2;

interface Puff {
  sprite: Sprite;
  x: number;
  y: number;
  dir: -1 | 1;
  /** Milliseconds since the emit; at or above DUST_LIFE_MS the puff is hidden. */
  age: number;
}

export class DustPool {
  private readonly puffs: Puff[] = [];
  private next = 0;

  /** `parent` holds the puff sprites; `texture` is stretched to a DUST_PX square and tinted. */
  constructor(
    private readonly parent: Container,
    private readonly texture: Texture,
  ) {}

  /** Starts a puff at (x, y) that drifts away from the way the being faces. */
  emit(x: number, y: number, facing: -1 | 1): void {
    let p = this.puffs[this.next];
    if (!p) {
      const sprite = new Sprite(this.texture);
      sprite.tint = DUST_COLOUR;
      sprite.scale.set(DUST_PX);
      sprite.visible = false;
      this.parent.addChild(sprite);
      p = { sprite, x: 0, y: 0, dir: 1, age: DUST_LIFE_MS };
      this.puffs.push(p);
    }
    this.next = (this.next + 1) % DUST_MAX;
    p.x = x;
    p.y = y;
    p.dir = facing;
    p.age = 0;
    p.sprite.position.set(x, y);
    p.sprite.alpha = 1;
    p.sprite.visible = true;
  }

  /** Ages the live puffs by dtMs, moving and fading them, and hides those past their life. */
  update(dtMs: number): void {
    for (const p of this.puffs) {
      if (p.age >= DUST_LIFE_MS) continue;
      p.age += dtMs;
      if (p.age >= DUST_LIFE_MS) {
        p.sprite.visible = false;
        continue;
      }
      const k = p.age / DUST_LIFE_MS;
      p.sprite.position.set(p.x - p.dir * DUST_DRIFT_PX * k, p.y - DUST_RISE_PX * k);
      p.sprite.alpha = 1 - k;
    }
  }

  /** Hides every puff at once, e.g. when the setting turns off. */
  clear(): void {
    for (const p of this.puffs) {
      p.age = DUST_LIFE_MS;
      p.sprite.visible = false;
    }
  }
}
