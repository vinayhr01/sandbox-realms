import { describe, expect, it } from 'vitest';
import { SNAPSHOT_DETAIL_ROWS, SNAPSHOT_MAX_BYTES, type DominionRow, type Snapshot, type SnapshotDetail } from '../../src/shared/protocol.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { buildSnapshot, snapshotBytes } from '../../src/sim/snapshot.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import {
  DETAIL_EMPTY,
  campaignRows,
  cutNote,
  dominionFacts,
  groupName,
  intrigueKindLabel,
  intrigueOutcomeLabel,
  sameDialectGroups,
} from '../../src/ui/detail-model.ts';

function dominion(over: Partial<DominionRow> & { id: number }): DominionRow {
  return {
    name: `Dominion ${over.id}`,
    parcels: 4,
    strength: 10,
    neighbours: 1,
    peace: 1,
    tension: 0,
    war: 0,
    atWar: false,
    campaignTarget: -1,
    ...over,
  };
}

/** A snapshot with the given dominions and detail; other fields are empty. */
function snap(dominions: DominionRow[], detail: SnapshotDetail | undefined = undefined): Snapshot {
  return {
    v: 1,
    tick: 0,
    truncated: false,
    population: { total: 0, folk: 0, wild: 0, species: [] },
    counters: {},
    sets: {},
    achievements: [],
    codex: { discoveries: 0, traits: 0, traitTotal: 1, species: 0, rosterTotal: 1 },
    dominions,
    dominionCount: dominions.length,
    hamlets: [],
    hamletCount: 0,
    culture: { customs: 0, creeds: 0, creedHolders: 0, dialects: 0, dialectGroups: 0, intriguesActive: 0, intriguesResolved: 0, families: 0 },
    ...(detail === undefined ? {} : { detail }),
  };
}

describe('detail view models', () => {
  it('names a culture group by its dominion, else as a plain group number', () => {
    const s = snap([dominion({ id: 3 })]);
    expect(groupName(s, 3)).toBe('Dominion 3');
    expect(groupName(s, 9)).toBe('Group 9');
  });

  it('lists campaigns from the dominions that have a target, with the target row when present', () => {
    const s = snap([dominion({ id: 1, campaignTarget: 2, strength: 30 }), dominion({ id: 2, strength: 12 }), dominion({ id: 4, campaignTarget: 77 })]);
    const rows = campaignRows(s);
    expect(rows.map((r) => r.attacker.id)).toEqual([1, 4]);
    expect(rows[0]?.target?.id).toBe(2);
    expect(rows[1]?.target).toBeNull();
    expect(rows[1]?.targetName).toBe('Dominion 77');
    expect(campaignRows(null)).toEqual([]);
  });

  it('says how many rows a capped list leaves out, and nothing when every row is shown', () => {
    expect(cutNote(16, 40)).toBe('Showing the first 16 of 40. The rest are not listed yet.');
    expect(cutNote(3, 3)).toBeNull();
  });

  it('finds the other groups that share a dialect word', () => {
    const detail: SnapshotDetail = {
      ...DETAIL_EMPTY,
      dialects: [
        { group: 1, word: 7 },
        { group: 2, word: 7 },
        { group: 3, word: 8 },
      ],
    };
    expect(sameDialectGroups(detail, 1)).toEqual([2]);
    expect(sameDialectGroups(detail, 3)).toEqual([]);
    expect(sameDialectGroups(detail, 9)).toEqual([]);
  });

  it('labels intrigue kinds and outcomes', () => {
    expect(intrigueKindLabel('rebellion')).toBe('Rebellion');
    expect(intrigueKindLabel('scheme')).toBe('Scheme');
    expect(intrigueOutcomeLabel(null)).toBe('Under way');
    expect(intrigueOutcomeLabel('success')).toBe('Succeeded');
    expect(intrigueOutcomeLabel('failure')).toBe('Failed');
  });

  it('shows the dominion facts, with the campaign target by name', () => {
    const s = snap([dominion({ id: 1, campaignTarget: 2 }), dominion({ id: 2 })]);
    const facts = Object.fromEntries(dominionFacts(s.dominions[0]!, s));
    expect(facts['Campaign target']).toBe('Dominion 2');
    expect(facts['Army']).toBe('10');
    const none = Object.fromEntries(dominionFacts(s.dominions[1]!, s));
    expect(none['Campaign target']).toBe('None');
  });
});

describe('snapshot detail rows', () => {
  it('fills the detail rows with exact totals and capped lists', () => {
    const sim = generateRealm({ seed: 20240601, sizeStep: 2, template: 'continent' }).sim;
    seedStartingBeasts(sim, 40);
    for (let t = 0; t < 200; t++) sim.step();
    const built = buildSnapshot(sim);
    const d = built.detail;
    expect(d).toBeDefined();
    if (!d) return;
    expect(d.counts.customs).toBe(sim.culture.customs.length);
    expect(d.counts.strains).toBe(sim.beings.strains.size);
    for (const list of [d.customs, d.creeds, d.dialects, d.families, d.intrigues, d.strains]) {
      expect(list.length).toBeLessThanOrEqual(SNAPSHOT_DETAIL_ROWS);
    }
    expect(snapshotBytes(built)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
  });
});
