/**
 * Session history of the snapshots the UI has received (13 section 7.1, win_compare and win_annals).
 * The realm keeps no history, so this sampler keeps the last HISTORY_CAP snapshots in memory for
 * this page session only. It is not saved and not sent anywhere. A snapshot with an earlier tick
 * than the last one means a new realm, and the history starts again.
 */
import type { Snapshot } from '../shared/protocol.ts';

/** Snapshots kept: 240 snapshots at one per two sim-seconds is about eight sim-minutes. */
export const HISTORY_CAP = 240;

export interface DominionSample {
  name: string;
  strength: number;
  parcels: number;
}

export interface HistorySample {
  tick: number;
  population: number;
  dominions: ReadonlyMap<number, DominionSample>;
  counters: Readonly<Record<string, number>>;
}

export class RealmHistory {
  private samples: HistorySample[] = [];

  /** Adds a sample for a snapshot. A repeated tick is skipped; an earlier tick starts a new history. */
  record(snap: Snapshot): void {
    const last = this.samples[this.samples.length - 1];
    if (last && snap.tick === last.tick) return;
    if (last && snap.tick < last.tick) this.samples = [];
    const dominions = new Map<number, DominionSample>();
    for (const d of snap.dominions) dominions.set(d.id, { name: d.name, strength: d.strength, parcels: d.parcels });
    this.samples.push({ tick: snap.tick, population: snap.population.total, dominions, counters: { ...snap.counters } });
    if (this.samples.length > HISTORY_CAP) this.samples.splice(0, this.samples.length - HISTORY_CAP);
  }

  /** The samples, oldest first. */
  get all(): readonly HistorySample[] {
    return this.samples;
  }

  clear(): void {
    this.samples = [];
  }
}

/** The history the windows read. One per page; SimView feeds it every snapshot. */
export const realmHistory = new RealmHistory();
