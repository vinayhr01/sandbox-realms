/**
 * Pure view models for the culture, campaign and strain windows (13 section 6 and 7.1). No DOM:
 * each function reads a Snapshot and returns the rows or lines a window shows, so the rules can be
 * tested in node.
 */
import type { DominionRow, HamletRow, Snapshot, SnapshotDetail } from '../shared/protocol.ts';

/** Display name of a culture group (a dominion id). Hamlets have no id in the snapshot, so they read as "Group n". */
export function groupName(snap: Snapshot, group: number): string {
  const dominion = snap.dominions.find((d) => d.id === group);
  return dominion ? dominion.name : `Group ${group}`;
}

/** Name of a dominion by id, or a fallback when the row is gone. */
export function dominionName(snap: Snapshot, id: number): string {
  return snap.dominions.find((d) => d.id === id)?.name ?? `Dominion ${id}`;
}

/** One campaign: a dominion that is marching on another (the target is its campaignTarget). */
export interface CampaignView {
  attacker: DominionRow;
  targetId: number;
  targetName: string;
  /** The target's row, or null when the target is no longer in the realm. */
  target: DominionRow | null;
}

export function campaignRows(snap: Snapshot | null): CampaignView[] {
  if (!snap) return [];
  return snap.dominions
    .filter((d) => d.campaignTarget >= 0)
    .map((d) => {
      const target = snap.dominions.find((x) => x.id === d.campaignTarget) ?? null;
      return { attacker: d, targetId: d.campaignTarget, targetName: target?.name ?? dominionName(snap, d.campaignTarget), target };
    });
}

export function campaignLine(c: CampaignView): string {
  return `${c.attacker.name} against ${c.targetName} · army ${c.attacker.strength} against ${c.target ? c.target.strength : 'unknown'}`;
}

/** Stand-in detail rows for a snapshot that has none yet. */
export const DETAIL_EMPTY: SnapshotDetail = {
  counts: { customs: 0, creeds: 0, dialects: 0, families: 0, intrigues: 0, strains: 0 },
  customs: [],
  creeds: [],
  dialects: [],
  families: [],
  intrigues: [],
  strains: [],
};

/** "Showing the first 16 of 40." when a detail list was cut, or null when every row is shown. */
export function cutNote(shown: number, total: number): string | null {
  return total > shown ? `Showing the first ${shown} of ${total}. The rest are not listed yet.` : null;
}

export function intrigueKindLabel(kind: 'rebellion' | 'scheme'): string {
  return kind === 'rebellion' ? 'Rebellion' : 'Scheme';
}

export function intrigueOutcomeLabel(outcome: 'success' | 'failure' | null): string {
  if (outcome === null) return 'Under way';
  return outcome === 'success' ? 'Succeeded' : 'Failed';
}

/** Groups that share a dialect word with `group` (other than `group` itself). */
export function sameDialectGroups(detail: SnapshotDetail, group: number): number[] {
  const mine = detail.dialects.find((d) => d.group === group);
  if (!mine) return [];
  return detail.dialects.filter((d) => d.word === mine.word && d.group !== group).map((d) => d.group);
}

/** Hamlet row by its list index (hamlets have no stored id; the index is the window id). */
export function hamletAt(snap: Snapshot | null, index: number): HamletRow | null {
  return snap?.hamlets[index] ?? null;
}

/** The fields a dominion inspector shows, as label/value pairs. */
export function dominionFacts(d: DominionRow, snap: Snapshot): [string, string][] {
  const target = d.campaignTarget >= 0 ? dominionName(snap, d.campaignTarget) : 'None';
  return [
    ['Parcels', String(d.parcels)],
    ['Army', String(d.strength)],
    ['Neighbours', String(d.neighbours)],
    ['Peace with', String(d.peace)],
    ['Tension with', String(d.tension)],
    ['War with', String(d.war)],
    ['Campaign target', target],
  ];
}
