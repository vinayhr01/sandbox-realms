import { TICK_MS, MONTH_TICKS, YEAR_TICKS } from '../shared/constants.ts';
import { Cmd, type Command, type Speed } from '../shared/protocol.ts';
import { groundKey } from '../content/grounds.ts';
import { applyStroke } from './brush.ts';
import { Realm } from './realm.ts';

export { TICK_MS };

/** Speed -> ticks allowed per pump (17 section 3.1). The tick length never changes. */
export const MAX_TICKS_PER_PUMP: Readonly<Record<Speed, number>> = { 0: 0, 0.5: 1, 1: 1, 2: 2, 5: 5, 10: 10 };

/**
 * Deterministic simulation core. Owns the Realm and the tick counter. Has no timers and no
 * DOM; the worker drives it through `step()`. Player commands are queued and applied at the
 * start of the next tick (17 section 2.2), or immediately via `applyQueued()` while paused.
 */
export class Sim {
  realm: Realm;
  tick = 0;
  private queue: Command[] = [];

  constructor(seed: number, sizeStep: number) {
    this.realm = new Realm(seed, sizeStep);
  }

  enqueue(command: Command): void {
    this.queue.push(command);
  }

  /** Applies queued commands without advancing the clock (paused edit mode, 17 section 3.1). */
  applyQueued(): void {
    if (this.queue.length === 0) return;
    const pending = this.queue;
    this.queue = [];
    for (const cmd of pending) this.apply(cmd);
  }

  /** Advances one tick: queued player actions first, then world systems in fixed order. */
  step(): void {
    this.applyQueued();
    this.tick++;
    // World systems (02 section 4) arrive with milestones 2+; M0/M1 has only the clock.
  }

  private apply(cmd: Command): void {
    switch (cmd.kind) {
      case Cmd.Stroke:
        applyStroke(this.realm, cmd.op, cmd.shape, cmd.size, cmd.x0, cmd.y0, cmd.x1, cmd.y1, cmd.includeStart);
        break;
      default:
        // Non-world commands are handled by the worker shell.
        break;
    }
  }

  /** Calendar read-out, derived from ticks only (02 owns the full calendar). */
  get calendar(): { year: number; month: number } {
    return {
      year: Math.floor(this.tick / YEAR_TICKS) + 1,
      month: (Math.floor(this.tick / MONTH_TICKS) % 12) + 1,
    };
  }

  /** Stable FNV-1a hash over the authoritative tile arrays plus the tick (replay checkpoint). */
  stateHash(): number {
    let h = 0x811c9dc5;
    h = fnv(h, this.tick);
    h = fnvBytes(h, this.realm.elevation);
    h = fnvBytes(h, this.realm.ground);
    h = fnvBytes(h, this.realm.cover);
    return h >>> 0;
  }

  tileInfo(x: number, y: number): { elevation: number; ground: string } | null {
    if (!this.realm.inBounds(x, y)) return null;
    const i = y * this.realm.side + x;
    return { elevation: this.realm.elevation[i] ?? 0, ground: groundKey(this.realm.ground[i] ?? 0) };
  }
}

function fnv(h: number, v: number): number {
  let x = h;
  for (let s = 0; s < 32; s += 8) {
    x ^= (v >>> s) & 0xff;
    x = Math.imul(x, 0x01000193);
  }
  return x >>> 0;
}

function fnvBytes(h: number, bytes: Uint8Array): number {
  let x = h;
  for (let i = 0; i < bytes.length; i++) {
    x ^= bytes[i] ?? 0;
    x = Math.imul(x, 0x01000193);
  }
  return x >>> 0;
}
