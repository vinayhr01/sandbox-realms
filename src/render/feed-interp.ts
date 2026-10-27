/**
 * Smooths the being feed (src/shared/being-feed.ts) between worker frames. Each Being is lerped from its
 * previous feed position to its current one, snapped when it is new, has jumped or the feeds are far apart,
 * and faded out for a moment after it disappears. Pure: time comes in as `nowMs`, so no clock is read here.
 */
import { BeingState, readBeing, type BeingFeed } from '../shared/being-feed.ts';

/** A Being that moves more tiles than this between two feeds is snapped, not lerped (teleport, slot reuse). */
export const SNAP_TILES = 3;
/** When two feeds are further apart than this, every Being snaps to its latest position. */
export const MAX_GAP_MS = 500;
/** A Being absent from the latest feed fades out over this long, then is dropped. */
export const FADE_MS = 400;
/** After a Being last walked or ran, an Idle feed still draws that moving state for this long (no 1x flicker). */
export const WALK_HOLD_MS = 300;

/** One Being as drawn this frame. `sample` reuses the objects it is given, so read them before the next sample. */
export interface DrawBeing {
  /** slot << 16 | generation: stable for one Being, new when its slot is reused. */
  key: number;
  x: number;
  y: number;
  species: number;
  state: BeingState;
  child: boolean;
  facing: -1 | 1;
  /** 1 while present, falling to 0 over FADE_MS after the Being leaves the feed. */
  alpha: number;
  /** Tiles travelled since the previous feed (Chebyshev distance). */
  moved: number;
}

interface Track {
  /** Position in the previous feed (equal to x, y when there is nothing to lerp). */
  px: number;
  py: number;
  /** Position in the latest feed where it was present; kept while it fades. */
  x: number;
  y: number;
  species: number;
  state: BeingState;
  child: boolean;
  facing: -1 | 1;
  moved: number;
  /** Time of the latest Walk or Run feed for this Being, or -1 when it has not moved yet. */
  lastMoveMs: number;
  lastMoveState: BeingState;
  /** Time the Being was first missing from a feed, or -1 while it is present. */
  goneAt: number;
  /** Set on each push when the Being is in that feed. */
  present: boolean;
}

export class FeedInterp {
  private readonly tracks = new Map<number, Track>();
  private hasFeed = false;
  private tPrev = 0;
  private tCurr = 0;

  /** Takes in a new feed, seen at `nowMs`. */
  push(feed: BeingFeed, nowMs: number): void {
    const snapAll = this.hasFeed && nowMs - this.tCurr > MAX_GAP_MS;
    this.tPrev = this.hasFeed ? this.tCurr : nowMs;
    this.tCurr = nowMs;
    this.hasFeed = true;

    for (const t of this.tracks.values()) t.present = false;

    for (let i = 0; i < feed.count; i++) {
      const b = readBeing(feed, i);
      const key = (b.slot << 16) | b.gen;
      const child = b.child !== 0;
      const moving = b.state === BeingState.Walk || b.state === BeingState.Run;
      let t = this.tracks.get(key);
      if (!t) {
        t = { px: b.x, py: b.y, x: b.x, y: b.y, species: b.species, state: b.state, child, facing: 1, moved: 0, lastMoveMs: -1, lastMoveState: BeingState.Idle, goneAt: -1, present: true };
        this.tracks.set(key, t);
      } else if (t.goneAt >= 0) {
        // Back after a gap: no motion to lerp from.
        t.px = b.x;
        t.py = b.y;
        t.moved = 0;
      } else {
        const dx = b.x - t.x;
        const dy = b.y - t.y;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const snap = snapAll || dist > SNAP_TILES;
        t.px = snap ? b.x : t.x;
        t.py = snap ? b.y : t.y;
        if (dx !== 0) t.facing = dx < 0 ? -1 : 1;
        // A snapped Being did not walk: it jumped, so it reports no movement.
        t.moved = snap ? 0 : dist;
      }
      t.x = b.x;
      t.y = b.y;
      t.species = b.species;
      t.state = b.state;
      t.child = child;
      t.goneAt = -1;
      t.present = true;
      if (moving) {
        t.lastMoveMs = nowMs;
        t.lastMoveState = b.state;
      }
    }

    for (const t of this.tracks.values()) {
      if (t.present || t.goneAt >= 0) continue;
      // Missing from this feed: hold the last position and start fading.
      t.goneAt = nowMs;
      t.px = t.x;
      t.py = t.y;
      t.moved = 0;
    }
  }

  /**
   * Writes the Beings to draw at `nowMs` into `out`, reusing its objects, and returns how many were written.
   * Entries past the returned count are stale and must be ignored.
   */
  sample(nowMs: number, out: DrawBeing[]): number {
    if (!this.hasFeed) return 0;
    const span = this.tCurr - this.tPrev;
    const f = span > 0 ? clamp01((nowMs - this.tCurr) / span) : 1;
    let n = 0;
    for (const [key, t] of this.tracks) {
      let alpha = 1;
      if (t.goneAt >= 0) {
        alpha = clamp01(1 - (nowMs - t.goneAt) / FADE_MS);
        if (alpha <= 0) {
          this.tracks.delete(key);
          continue;
        }
      }
      let state = t.state;
      if (state === BeingState.Idle && t.lastMoveMs >= 0 && nowMs - t.lastMoveMs < WALK_HOLD_MS) state = t.lastMoveState;

      let d = out[n];
      if (!d) {
        d = { key, x: 0, y: 0, species: 0, state, child: false, facing: 1, alpha: 1, moved: 0 };
        out[n] = d;
      }
      d.key = key;
      d.x = t.px + (t.x - t.px) * f;
      d.y = t.py + (t.y - t.py) * f;
      d.species = t.species;
      d.state = state;
      d.child = t.child;
      d.facing = t.facing;
      d.alpha = alpha;
      d.moved = t.moved;
      n++;
    }
    return n;
  }

  /** Forgets every Being, e.g. when a new world starts. */
  reset(): void {
    this.tracks.clear();
    this.hasFeed = false;
    this.tPrev = 0;
    this.tCurr = 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
