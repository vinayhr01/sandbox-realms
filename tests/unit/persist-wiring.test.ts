import { describe, expect, it } from 'vitest';
import { decodeChronicle, encodeChronicle, fnv1a } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { addBorder, addDominion, parcelsPerAxis, snapshotDominions } from '../../src/sim/dominions/adapter.ts';
import { hamletsOf, snapshotHamlets } from '../../src/sim/settlements/adapter.ts';

function fresh(): Sim {
  return generateRealm({ seed: 4242, sizeStep: 2, template: 'continent' }).sim;
}

/** Two dominions at war across a border, holding parcels in the first two rows. */
function withDominions(sim: Sim): void {
  const n = parcelsPerAxis(sim);
  addDominion(sim, 1, 40, [0, 1, n, n + 1]);
  addDominion(sim, 2, 30, [2, 3, n + 2]);
  addBorder(sim, 1, 2, 'war');
}

/** Dominion and hamlet state as plain data, for comparing runs. */
function persisted(sim: Sim): { dominions: unknown; hamlets: unknown } {
  return { dominions: snapshotDominions(sim), hamlets: snapshotHamlets(sim) };
}

/**
 * Rebuilds a Chronicle with some sections changed: a string replaces that section's payload, null
 * drops the section. The body length and checksum are fixed up, so only the section content is wrong.
 */
function rewriteSections(bytes: Uint8Array, edits: Record<number, string | null>): Uint8Array {
  const headerView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bodyLength = headerView.getUint32(12, true);
  const body = bytes.subarray(16, 16 + bodyLength);
  const chunks: Uint8Array[] = [];
  let pos = 0;
  while (pos < body.length) {
    const tag = body[pos] ?? 0;
    const len = new DataView(body.buffer, body.byteOffset + pos + 1, 4).getUint32(0, true);
    const end = pos + 5 + len;
    const edit = edits[tag];
    if (edit === undefined) {
      chunks.push(body.subarray(pos, end));
    } else if (edit !== null) {
      const payload = new TextEncoder().encode(edit);
      const section = new Uint8Array(5 + payload.length);
      section[0] = tag;
      new DataView(section.buffer).setUint32(1, payload.length, true);
      section.set(payload, 5);
      chunks.push(section);
    }
    pos = end;
  }
  const newBody = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    newBody.set(c, off);
    off += c.length;
  }
  const out = new Uint8Array(16 + newBody.length + 4);
  out.set(bytes.subarray(0, 16), 0);
  out.set(newBody, 16);
  const outView = new DataView(out.buffer);
  outView.setUint32(12, newBody.length, true);
  outView.setUint32(16 + newBody.length, fnv1a(newBody), true);
  return out;
}

describe('dominion and hamlet persistence', () => {
  it('a save with two dominions and a hamlet, continued to tick M, matches the uninterrupted run', () => {
    const straight = fresh();
    withDominions(straight);
    for (let t = 0; t < 200; t++) straight.step();
    expect(hamletsOf(straight).length).toBeGreaterThan(0);
    const atSave = persisted(straight);
    const saved = encodeChronicle(straight);

    for (let t = 0; t < 400; t++) straight.step();
    // The dominions must actually change over the run, so the comparison below is not vacuous.
    expect(persisted(straight)).not.toEqual(atSave);

    const resumed = decodeChronicle(saved);
    expect(resumed.tick).toBe(200);
    expect(persisted(resumed)).toEqual(atSave);
    for (let t = 0; t < 400; t++) resumed.step();

    expect(resumed.tick).toBe(straight.tick);
    expect(resumed.stateHash()).toBe(straight.stateHash());
    expect(persisted(resumed)).toEqual(persisted(straight));
  });

  it('a save taken before any step (no hamlets placed yet) also continues to match', () => {
    const straight = fresh();
    withDominions(straight);
    const saved = encodeChronicle(straight);
    for (let t = 0; t < 300; t++) straight.step();

    const resumed = decodeChronicle(saved);
    for (let t = 0; t < 300; t++) resumed.step();
    expect(resumed.stateHash()).toBe(straight.stateHash());
    expect(persisted(resumed)).toEqual(persisted(straight));
  });

  it('an old save without the dominion and hamlet sections still decodes, with none', () => {
    const sim = fresh();
    withDominions(sim);
    for (let t = 0; t < 100; t++) sim.step();
    const old = rewriteSections(encodeChronicle(sim), { 15: null, 16: null });

    const back = decodeChronicle(old);
    expect(back.tick).toBe(sim.tick);
    expect(snapshotDominions(back)).toBeNull();
    expect(hamletsOf(back)).toHaveLength(0);
    expect(() => {
      for (let t = 0; t < 50; t++) back.step();
    }).not.toThrow();
  });

  it('a dominion section whose owner map does not match the parcels is rejected', () => {
    const sim = fresh();
    withDominions(sim);
    for (let t = 0; t < 10; t++) sim.step();
    const snap = snapshotDominions(sim);
    expect(snap).not.toBeNull();
    const owner = [...(snap?.owner ?? [])];
    owner[0] = 9; // parcel 0 is held by dominion 1 in the save; naming dominion 9 must fail
    const bad = rewriteSections(encodeChronicle(sim), { 15: JSON.stringify({ ...snap, owner }) });
    expect(() => decodeChronicle(bad)).toThrow(/dominion state/);
  });

  it('a hamlet section with overlapping parcels is rejected', () => {
    const sim = fresh();
    withDominions(sim);
    for (let t = 0; t < 10; t++) sim.step();
    const snap = snapshotHamlets(sim);
    const hamlets = snap?.hamlets ?? [];
    expect(hamlets.length).toBeGreaterThan(0);
    const first = hamlets[0];
    if (!first) throw new Error('no hamlet to corrupt');
    const twin = { ...first, buildings: [] };
    const bad = rewriteSections(encodeChronicle(sim), { 16: JSON.stringify({ hamlets: [first, twin] }) });
    expect(() => decodeChronicle(bad)).toThrow(/hamlet state/);
  });
});
