/**
 * Replay ring (17 section 7.3, 19 section 6): the newest player commands, each stamped with the worker tick it was queued
 * at. The ring lives in the worker beside the sim, not inside it. It is not saved to the Chronicle, not folded into
 * stateHash, and the sim never reads it, so keeping it cannot change a result. The diagnostics bundle reads it through
 * Cmd.Replay / Ev.Replay (protocol.ts).
 */

/** Newest commands kept (TUNE: about 34 s of brush dabs at 60 Hz). Older entries are dropped and counted. */
export const REPLAY_RING_MAX = 2048;

/** The most array items one entry keeps (a command's id list). */
const LIST_MAX = 64;

/** A string a command may keep: the shape of a content id. Anything else is free text and is renamed (19 section 6). */
const ID_SHAPE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** What a free-text string becomes. Names and text never leave the sim boundary (19 section 6). */
export const RENAMED = '<name>';

export type ReplayValue = number | boolean | string | null | string[];

/** One queued player command. `kind` is the Cmd name, for example "Stroke"; `fields` holds its other fields by name. */
export interface ReplayEntry {
  /** Worker tick the command was queued at. It applies at the start of the next tick (17 section 2.2). */
  tick: number;
  kind: string;
  fields: Record<string, ReplayValue>;
}

/**
 * The rename rule (19 section 6). A string is kept only when it has the shape of a content id; any other string (text
 * with spaces, quotes, paths or long runs) becomes RENAMED. Content ids are the only strings the command set carries.
 */
export function renameFreeText(value: string): string {
  return ID_SHAPE.test(value) ? value : RENAMED;
}

/** One field value in a replay entry: numbers must be finite, strings go through the rename rule, others are dropped to null. */
export function replayValue(value: unknown): ReplayValue {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'string') return renameFreeText(value);
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return (value as string[]).slice(0, LIST_MAX).map(renameFreeText);
  }
  return null;
}

/** A bounded, append-only ring of replay entries. Pushing past the bound drops the oldest entry and counts it. */
export class ReplayRing {
  private readonly entries: ReplayEntry[] = [];
  private readonly max: number;
  /** Entries pushed out of the ring since the last clear. */
  private dropped = 0;

  constructor(max: number = REPLAY_RING_MAX) {
    this.max = max;
  }

  push(entry: ReplayEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.max) {
      const excess = this.entries.length - this.max;
      this.entries.splice(0, excess);
      this.dropped += excess;
    }
  }

  /** Empties the ring; called when the realm the commands belong to is replaced. */
  clear(): void {
    this.entries.length = 0;
    this.dropped = 0;
  }

  /** A copy of the ring, oldest first, with the count of entries dropped since the last clear. */
  read(): { commands: ReplayEntry[]; dropped: number } {
    return { commands: this.entries.slice(), dropped: this.dropped };
  }
}
