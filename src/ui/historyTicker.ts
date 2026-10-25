/**
 * History ticker (Insight O07, 13 section 15): a runtime feed of what changed between two snapshots. It lives in memory
 * for the session and is not saved, and it is rebuilt from snapshot diffs. The sim keeps no event log (the chronicle is a
 * save encoding only), so each entry names a change the snapshot shows; the cause is not known to the feed.
 *
 * Lists are compared only when neither snapshot was cut (a list shorter than its exact count was halved by fitSnapshot).
 */
import type { Snapshot } from '../shared/protocol.ts';

/** Most entries kept in the feed. */
export const TICKER_CAP = 40;
/** Population totals the feed reports when they are first reached. */
const POPULATION_MARKS: readonly number[] = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export interface TickerEntry {
  tick: number;
  text: string;
}

/** The changes from `prev` to `next`, as short sentences in a fixed order. Pure. */
export function tickerChanges(prev: Snapshot, next: Snapshot): string[] {
  const out: string[] = [];
  if (next.age !== undefined && next.age !== prev.age) out.push(`Age: ${next.age}.`);
  if (next.hamletCount !== prev.hamletCount) out.push(`Hamlets: ${prev.hamletCount} to ${next.hamletCount}.`);
  if (next.dominionCount !== prev.dominionCount) out.push(`Dominions: ${prev.dominionCount} to ${next.dominionCount}.`);
  for (const m of POPULATION_MARKS) {
    if (prev.population.total < m && next.population.total >= m) out.push(`Population reaches ${m}.`);
  }

  const dominionsWhole = prev.dominions.length === prev.dominionCount && next.dominions.length === next.dominionCount;
  if (dominionsWhole) {
    const before = new Map(prev.dominions.map((d) => [d.id, d]));
    const after = new Map(next.dominions.map((d) => [d.id, d]));
    for (const [id, d] of after) {
      const b = before.get(id);
      if (!b) out.push(`${d.name} rises.`);
      else if (b.atWar !== d.atWar) out.push(d.atWar ? `${d.name} goes to war.` : `${d.name} is at peace.`);
    }
    for (const [id, d] of before) if (!after.has(id)) out.push(`${d.name} falls.`);
  }

  const pactsWhole = prev.pacts !== undefined && next.pacts !== undefined && prev.pacts.rows.length === prev.pacts.count && next.pacts.rows.length === next.pacts.count;
  if (pactsWhole) {
    const before = new Set(prev.pacts?.rows.map((r) => r.id) ?? []);
    const after = new Set(next.pacts?.rows.map((r) => r.id) ?? []);
    for (const r of next.pacts?.rows ?? []) if (!before.has(r.id)) out.push(`Pact ${r.name} is sworn.`);
    for (const r of prev.pacts?.rows ?? []) if (!after.has(r.id)) out.push(`Pact ${r.name} ends.`);
  }
  return out;
}

/** Keeps the feed of changes. `push` takes each snapshot as it arrives; a snapshot with an earlier tick starts a new feed. */
export class HistoryTicker {
  private prev: Snapshot | null = null;
  private entries: TickerEntry[] = [];

  push(snap: Snapshot): void {
    const prev = this.prev;
    if (prev && snap.tick < prev.tick) this.entries = [];
    if (prev && snap.tick > prev.tick) {
      for (const text of tickerChanges(prev, snap)) this.entries.push({ tick: snap.tick, text });
      if (this.entries.length > TICKER_CAP) this.entries.splice(0, this.entries.length - TICKER_CAP);
    }
    this.prev = snap;
  }

  /** Newest first, at most `n` entries. */
  recent(n: number): TickerEntry[] {
    return this.entries.slice(-n).reverse();
  }

  clear(): void {
    this.entries = [];
    this.prev = null;
  }
}

/** The ticker strip on the map. Hidden unless the O07 view flag is on; the text is rebuilt only when it changes. */
export class TickerView {
  private readonly el: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'insight-ticker';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  /** `entries` null hides the strip. */
  show(entries: readonly TickerEntry[] | null): void {
    if (entries === null) {
      this.el.hidden = true;
      return;
    }
    const text = entries.length === 0 ? 'No changes yet.' : entries.slice(0, 3).map((e) => e.text).join('   ');
    if (text !== this.last) {
      this.last = text;
      this.el.textContent = text;
    }
    this.el.hidden = false;
  }
}
