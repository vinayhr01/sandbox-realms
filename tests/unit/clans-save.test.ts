import { describe, expect, it } from 'vitest';
import { decodeChronicle, encodeChronicle, fnv1a } from '../../src/sim/chronicle.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

const HEADER_BYTES = 16;
const CLAN_TAG = 18;

function clanSim(): Sim {
  const sim = generateRealm({ seed: 20240601, sizeStep: 2, template: 'continent' }).sim;
  seedStartingBeasts(sim, 40);
  for (let t = 0; t < 1200; t++) sim.step();
  return sim;
}

/** Splits a chronicle body into its sections (u8 tag, u32 length, payload). */
function sectionsOf(bytes: Uint8Array): { tag: number; payload: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bodyLength = view.getUint32(12, true);
  const body = bytes.subarray(HEADER_BYTES, HEADER_BYTES + bodyLength);
  const out: { tag: number; payload: Uint8Array }[] = [];
  let p = 0;
  while (p < body.length) {
    const tag = body[p] ?? 0;
    const len = new DataView(body.buffer, body.byteOffset + p + 1, 4).getUint32(0, true);
    out.push({ tag, payload: body.subarray(p + 5, p + 5 + len) });
    p += 5 + len;
  }
  return out;
}

/** Rebuilds a chronicle from sections, with a fresh length and checksum. */
function rebuild(bytes: Uint8Array, sections: { tag: number; payload: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const s of sections) {
    const head = new Uint8Array(5);
    head[0] = s.tag;
    new DataView(head.buffer).setUint32(1, s.payload.length, true);
    parts.push(head, s.payload);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    body.set(p, at);
    at += p.length;
  }
  const out = new Uint8Array(HEADER_BYTES + total + 4);
  out.set(bytes.subarray(0, HEADER_BYTES), 0);
  const view = new DataView(out.buffer);
  view.setUint32(12, total, true);
  out.set(body, HEADER_BYTES);
  view.setUint32(HEADER_BYTES + total, fnv1a(body), true);
  return out;
}

const enc = new TextEncoder();

describe('clans in the chronicle', () => {
  it('a save round trip keeps the clan records and the continuation matches', () => {
    const sim = clanSim();
    expect(sim.clans.list.length).toBeGreaterThan(0);
    const back = decodeChronicle(encodeChronicle(sim));
    expect(JSON.parse(JSON.stringify(back.clans))).toEqual(JSON.parse(JSON.stringify(sim.clans)));
    for (let t = 0; t < 300; t++) {
      sim.step();
      back.step();
    }
    expect(back.stateHash()).toBe(sim.stateHash());
    expect(JSON.stringify(back.clans)).toBe(JSON.stringify(sim.clans));
  });

  it('a save without the clan section (written before it existed) still loads, with no clans', () => {
    const sim = clanSim();
    const bytes = encodeChronicle(sim);
    const stripped = rebuild(bytes, sectionsOf(bytes).filter((s) => s.tag !== CLAN_TAG));
    expect(sectionsOf(stripped).some((s) => s.tag === CLAN_TAG)).toBe(false);
    const back = decodeChronicle(stripped);
    expect(back.clans.list).toEqual([]);
    expect(back.clans.next).toBe(1);
    expect(back.stateHash()).toBe(sim.stateHash());
  });

  it('a malformed clan record is rejected and nothing is restored', () => {
    const sim = clanSim();
    const bytes = encodeChronicle(sim);
    const bad = rebuild(
      bytes,
      sectionsOf(bytes).map((s) => (s.tag === CLAN_TAG ? { tag: s.tag, payload: enc.encode(JSON.stringify({ next: 2, list: [{ id: 1 }] })) } : s)),
    );
    expect(() => decodeChronicle(bad)).toThrow(/clan record/);
  });

  it('a clan section that is not an object with a list is rejected', () => {
    const bytes = encodeChronicle(clanSim());
    const bad = rebuild(
      bytes,
      sectionsOf(bytes).map((s) => (s.tag === CLAN_TAG ? { tag: s.tag, payload: enc.encode('[1,2]') } : s)),
    );
    expect(() => decodeChronicle(bad)).toThrow(/clans section/);
  });
});
