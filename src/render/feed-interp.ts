/**
 * Smooths the being feed (src/shared/being-feed.ts) between worker frames. Each Being is lerped from its
 * previous feed position to its current one, snapped when it is new, has jumped or the feeds are far apart,
 * and faded out for a moment after it disappears. Pure: time comes in as `nowMs`, so no clock is read here.
 */
import { BeingState, FEED_STRIDE, type BeingFeed } from '../shared/being-feed.ts';

/**
 * A Being that moves more tiles than this between two feeds is snapped, not lerped (teleport, slot reuse). When several
 * feeds were coalesced into one applied feed, the limit grows with their number (a fast mover covers that many feeds' worth).
 */
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
  /** slot << 16 | generation, the key of this track in the map. */
  key: number;
  /** Index of this track in `list`. */
  at: number;
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
  /** Number of the latest push whose feed held this Being. */
  seenPush: number;
}

/** Options of a FeedInterp. */
export interface FeedInterpOptions {
  /**
   * True: a feed is held until the next `sample`, and a feed that arrives while another is held replaces it. The worker may
   * post several feeds between two frames (10x speed); only the latest matters for the frame, so the earlier ones cost
   * nothing. Beings then lerp from where the last sampled feed had them. False (the default): every push is applied at once.
   */
  coalesce?: boolean;
}

export class FeedInterp {
  private readonly tracks = new Map<number, Track>();
  /** The same tracks as a dense array, so a sample walks an array and not a map. Removal swaps the last track in. */
  private readonly list: Track[] = [];
  private pushNo = 0;
  private readonly coalesce: boolean;
  /** The held feed's words, copied: the caller may hand its buffer back to the worker as soon as push returns. */
  private pendingData = new Uint16Array(0);
  private pendingCount = 0;
  private hasPending = false;
  private pendingMs = 0;
  /** Feeds pushed since the held feed was last applied (at least 1 once one is held). */
  private pendingFeeds = 0;
  private hasFeed = false;
  private tPrev = 0;
  private tCurr = 0;

  constructor(opts: FeedInterpOptions = {}) {
    this.coalesce = opts.coalesce ?? false;
  }

  /** Takes in a new feed, seen at `nowMs`. */
  push(feed: BeingFeed, nowMs: number): void {
    if (this.coalesce) {
      const words = feed.count * FEED_STRIDE;
      if (this.pendingData.length < words) this.pendingData = new Uint16Array(words * 2);
      this.pendingData.set(feed.data.subarray(0, words));
      this.pendingCount = feed.count;
      this.pendingMs = nowMs;
      this.pendingFeeds++;
      this.hasPending = true;
      return;
    }
    this.apply(feed.data, feed.count, nowMs, 1);
  }

  /** Applies a feed; `feeds` is how many pushes it stands for (coalescing), which scales the snap distance. */
  private apply(d: Uint16Array, count: number, nowMs: number, feeds: number): void {
    const snapTiles = SNAP_TILES * Math.max(1, feeds);
    const snapAll = this.hasFeed && nowMs - this.tCurr > MAX_GAP_MS;
    this.tPrev = this.hasFeed ? this.tCurr : nowMs;
    this.tCurr = nowMs;
    this.hasFeed = true;

    const pushNo = ++this.pushNo;
    // The feed's words are read in place (layout: FEED_STRIDE words of slot, gen, x, y, species, state | child << 8), so a push allocates nothing for a known Being.
    for (let i = 0; i < count; i++) {
      const o = i * FEED_STRIDE;
      const slot = d[o] ?? 0;
      const gen = d[o + 1] ?? 0;
      const bx = d[o + 2] ?? 0;
      const by = d[o + 3] ?? 0;
      const species = d[o + 4] ?? 0;
      const packed = d[o + 5] ?? 0;
      const bstate = (packed & 0xff) as BeingState;
      const key = (slot << 16) | gen;
      const child = packed >> 8 !== 0;
      const moving = bstate === BeingState.Walk || bstate === BeingState.Run;
      let t = this.tracks.get(key);
      if (!t) {
        t = { key, at: this.list.length, px: bx, py: by, x: bx, y: by, species, state: bstate, child, facing: 1, moved: 0, lastMoveMs: -1, lastMoveState: BeingState.Idle, goneAt: -1, seenPush: pushNo };
        this.tracks.set(key, t);
        this.list.push(t);
      } else if (t.goneAt >= 0) {
        // Back after a gap: no motion to lerp from.
        t.px = bx;
        t.py = by;
        t.moved = 0;
      } else {
        const dx = bx - t.x;
        const dy = by - t.y;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const snap = snapAll || dist > snapTiles;
        t.px = snap ? bx : t.x;
        t.py = snap ? by : t.y;
        if (dx !== 0) t.facing = dx < 0 ? -1 : 1;
        // A snapped Being did not walk: it jumped, so it reports no movement.
        t.moved = snap ? 0 : dist;
      }
      t.x = bx;
      t.y = by;
      t.species = species;
      t.state = bstate;
      t.child = child;
      t.goneAt = -1;
      t.seenPush = pushNo;
      if (moving) {
        t.lastMoveMs = nowMs;
        t.lastMoveState = bstate;
      }
    }

    for (let i = 0; i < this.list.length; i++) {
      const t = this.list[i]!;
      if (t.seenPush === pushNo || t.goneAt >= 0) continue;
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
    if (this.hasPending) {
      this.hasPending = false;
      const feeds = this.pendingFeeds;
      this.pendingFeeds = 0;
      this.apply(this.pendingData, this.pendingCount, this.pendingMs, feeds);
    }
    if (!this.hasFeed) return 0;
    const span = this.tCurr - this.tPrev;
    const f = span > 0 ? clamp01((nowMs - this.tCurr) / span) : 1;
    let n = 0;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const t = list[i]!;
      let alpha = 1;
      if (t.goneAt >= 0) {
        alpha = clamp01(1 - (nowMs - t.goneAt) / FADE_MS);
        if (alpha <= 0) {
          // The last track now sits at i: look at i again.
          this.drop(t);
          i--;
          continue;
        }
      }
      let state = t.state;
      if (state === BeingState.Idle && t.lastMoveMs >= 0 && nowMs - t.lastMoveMs < WALK_HOLD_MS) state = t.lastMoveState;

      let d = out[n];
      if (!d) {
        d = { key: t.key, x: 0, y: 0, species: 0, state, child: false, facing: 1, alpha: 1, moved: 0 };
        out[n] = d;
      }
      d.key = t.key;
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

  /** Removes a track from the map and the list (swapping the last track into its place). */
  private drop(t: Track): void {
    this.tracks.delete(t.key);
    const last = this.list.pop()!;
    if (last !== t) {
      this.list[t.at] = last;
      last.at = t.at;
    }
  }

  /** Forgets every Being, e.g. when a new world starts. */
  reset(): void {
    this.hasPending = false;
    this.pendingFeeds = 0;
    this.tracks.clear();
    this.list.length = 0;
    this.hasFeed = false;
    this.tPrev = 0;
    this.tCurr = 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
