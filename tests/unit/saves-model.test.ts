import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_INTERVAL_MS,
  AutosaveClock,
  autosaveSlotId,
  autosavesToPrune,
  biggestSlots,
  checkImport,
  chooseExportRoute,
  decideAutosave,
  decideSuspend,
  exportFileName,
  firstFreeManualSlot,
  looksLikeChronicle,
  manualSlotId,
  nextAutosaveSeq,
  orderForList,
  parseSlotId,
  planQuota,
  SaveError,
  softCapBytes,
  type AutosaveContext,
  type SlotMeta,
} from '../../src/app/saves.ts';

const MB = 1024 * 1024;

function meta(slotId: string, over: Partial<SlotMeta> = {}): SlotMeta {
  const parsed = parseSlotId(slotId);
  if (!parsed) throw new Error(`bad test slot ${slotId}`);
  return {
    slotId,
    kind: parsed.kind,
    seq: parsed.seq,
    realmName: 'Test',
    tick: 0,
    year: 1,
    byteSize: MB,
    checksum: 0,
    savedAtMs: 0,
    valid: 'unknown',
    ...over,
  };
}

function chronicleBytes(length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0x53, 0x52, 0x43, 0x48]);
  return bytes;
}

describe('slot naming', () => {
  it('builds manual, autosave, quick and suspend ids', () => {
    expect(manualSlotId(1)).toBe('manual:1');
    expect(manualSlotId(12)).toBe('manual:12');
    expect(autosaveSlotId(7)).toBe('auto:7');
  });

  it('rejects manual slots outside 1..12 and non-positive autosave seqs', () => {
    expect(() => manualSlotId(0)).toThrow(SaveError);
    expect(() => manualSlotId(13)).toThrow(SaveError);
    expect(() => manualSlotId(1.5)).toThrow(SaveError);
    expect(() => autosaveSlotId(0)).toThrow(SaveError);
  });

  it('parses ids back and rejects unknown forms', () => {
    expect(parseSlotId('quick')).toEqual({ kind: 'quick', seq: null });
    expect(parseSlotId('suspend')).toEqual({ kind: 'suspend', seq: null });
    expect(parseSlotId('manual:12')).toEqual({ kind: 'manual', seq: null });
    expect(parseSlotId('auto:42')).toEqual({ kind: 'auto', seq: 42 });
    expect(parseSlotId('manual:13')).toBeNull();
    expect(parseSlotId('manual:0')).toBeNull();
    expect(parseSlotId('auto:0')).toBeNull();
    expect(parseSlotId('auto:x')).toBeNull();
    expect(parseSlotId('')).toBeNull();
  });

  it('numbers the next autosave above the highest existing one', () => {
    expect(nextAutosaveSeq([])).toBe(1);
    expect(nextAutosaveSeq([meta('auto:3'), meta('manual:1'), meta('auto:9')])).toBe(10);
  });

  it('finds the first free manual slot', () => {
    expect(firstFreeManualSlot([])).toBe(1);
    expect(firstFreeManualSlot([meta('manual:1'), meta('manual:2'), meta('quick')])).toBe(3);
    const all = Array.from({ length: 12 }, (_, i) => meta(`manual:${i + 1}`));
    expect(firstFreeManualSlot(all)).toBeNull();
  });
});

describe('autosave ring and list order', () => {
  it('prunes the oldest autosaves beyond the keep count and never touches other kinds', () => {
    const metas = [1, 2, 3, 4, 5, 6, 7].map((s) => meta(`auto:${s}`)).concat([meta('manual:1'), meta('quick')]);
    expect(autosavesToPrune(metas, 5)).toEqual(['auto:2', 'auto:1']);
    expect(autosavesToPrune(metas.slice(-2), 5)).toEqual([]);
  });

  it('keeps the newest five through twelve autosave cycles', () => {
    let metas: SlotMeta[] = [];
    for (let cycle = 0; cycle < 12; cycle++) {
      const seq = nextAutosaveSeq(metas);
      const prune = new Set(autosavesToPrune(metas, 4));
      metas = metas.filter((m) => !prune.has(m.slotId)).concat(meta(autosaveSlotId(seq)));
    }
    expect(metas.map((m) => m.seq).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([8, 9, 10, 11, 12]);
  });

  it('orders the list newest first with seq as the tie-break', () => {
    const ordered = orderForList([
      meta('auto:1', { savedAtMs: 100 }),
      meta('auto:2', { savedAtMs: 300 }),
      meta('auto:3', { savedAtMs: 300 }),
      meta('suspend', { savedAtMs: 200 }),
    ]).map((m) => m.slotId);
    expect(ordered).toEqual(['auto:3', 'auto:2', 'suspend', 'auto:1']);
  });

  it('names the biggest slots first', () => {
    const top = biggestSlots([meta('manual:1', { byteSize: 5 }), meta('auto:1', { byteSize: 9 }), meta('quick', { byteSize: 7 })], 2);
    expect(top).toEqual(['auto:1', 'quick']);
  });
});

describe('quota', () => {
  it('uses the smaller cap on phones and caps at 400 MB or 150 MB', () => {
    expect(softCapBytes(10_000 * MB, false)).toBe(400 * MB);
    expect(softCapBytes(10_000 * MB, true)).toBe(150 * MB);
    expect(softCapBytes(100 * MB, false)).toBe(25 * MB);
    expect(softCapBytes(100 * MB, true)).toBe(20 * MB);
    expect(softCapBytes(0, false)).toBe(Number.POSITIVE_INFINITY);
  });

  it('accepts a write that fits', () => {
    expect(planQuota({ metas: [meta('manual:1')], replacingId: null, incomingBytes: MB, softCap: 10 * MB })).toEqual({ ok: true, drop: [] });
  });

  it('drops the oldest autosaves first when a write would exceed the cap', () => {
    const metas = [meta('auto:1'), meta('auto:2'), meta('auto:3'), meta('manual:1')];
    const plan = planQuota({ metas, replacingId: null, incomingBytes: 2 * MB, softCap: 5 * MB });
    expect(plan).toEqual({ ok: true, drop: ['auto:1'] });
  });

  it('refuses when dropping autosaves is not enough and names the biggest slots', () => {
    const metas = [meta('manual:1', { byteSize: 6 * MB }), meta('manual:2', { byteSize: 3 * MB }), meta('auto:1')];
    const plan = planQuota({ metas, replacingId: null, incomingBytes: 4 * MB, softCap: 8 * MB });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.needBytes).toBe(5 * MB);
      expect(plan.biggest[0]).toBe('manual:1');
    }
  });

  it('does not count the slot being replaced', () => {
    const metas = [meta('manual:1', { byteSize: 6 * MB })];
    expect(planQuota({ metas, replacingId: 'manual:1', incomingBytes: 6 * MB, softCap: 7 * MB })).toEqual({ ok: true, drop: [] });
  });
});

describe('autosave clock', () => {
  it('counts only unpaused play time', () => {
    const clock = new AutosaveClock(1000);
    expect(clock.advance(600, false)).toBe(false);
    expect(clock.advance(5000, true)).toBe(false);
    expect(clock.pendingMs).toBe(600);
    expect(clock.advance(400, false)).toBe(true);
  });

  it('resets after a save and is off at interval 0', () => {
    const clock = new AutosaveClock(1000);
    clock.advance(1000, false);
    clock.markSaved();
    expect(clock.advance(999, false)).toBe(false);
    const off = new AutosaveClock(0);
    expect(off.enabled).toBe(false);
    expect(off.advance(10 * AUTOSAVE_INTERVAL_MS, false)).toBe(false);
  });

  it('ignores bad deltas', () => {
    const clock = new AutosaveClock(1000);
    expect(clock.advance(-50, false)).toBe(false);
    expect(clock.advance(Number.NaN, false)).toBe(false);
    expect(clock.pendingMs).toBe(0);
  });

  it('uses the five minute default', () => {
    expect(new AutosaveClock().advance(AUTOSAVE_INTERVAL_MS, false)).toBe(true);
  });
});

describe('autosave decision', () => {
  const base: AutosaveContext = {
    dirty: true,
    inFlight: false,
    modalOpen: false,
    gestureActive: false,
    msSinceLoad: 600_000,
    degradeLevel: 0,
    consecutiveFailures: 0,
    retries: 0,
  };

  it('saves when idle and changed', () => {
    expect(decideAutosave(base)).toEqual({ action: 'save' });
  });

  it('skips an unchanged realm', () => {
    expect(decideAutosave({ ...base, dirty: false })).toEqual({ action: 'skip', reason: 'unchanged' });
  });

  it('retries after 10 s while a modal, gesture, or in-flight save blocks it, then gives up after six retries', () => {
    expect(decideAutosave({ ...base, modalOpen: true })).toEqual({ action: 'retry', delayMs: 10_000 });
    expect(decideAutosave({ ...base, gestureActive: true, retries: 5 })).toEqual({ action: 'retry', delayMs: 10_000 });
    expect(decideAutosave({ ...base, inFlight: true, retries: 6 })).toEqual({ action: 'skip', reason: 'busy_too_long' });
  });

  it('retries within the 120 s grace after a load', () => {
    expect(decideAutosave({ ...base, msSinceLoad: 60_000 })).toEqual({ action: 'retry', delayMs: 10_000 });
  });

  it('skips at degradation level 3 and above, but not below', () => {
    expect(decideAutosave({ ...base, degradeLevel: 3 })).toEqual({ action: 'skip', reason: 'degraded' });
    expect(decideAutosave({ ...base, degradeLevel: 2 })).toEqual({ action: 'save' });
  });

  it('switches off for the session after three failures in a row', () => {
    expect(decideAutosave({ ...base, consecutiveFailures: 2 })).toEqual({ action: 'save' });
    expect(decideAutosave({ ...base, consecutiveFailures: 3 })).toEqual({ action: 'skip', reason: 'disabled_after_failures' });
  });
});

describe('suspend throttle', () => {
  it('writes when nothing was saved recently', () => {
    expect(decideSuspend({ nowMs: 100_000, lastSuspendMs: null, lastAutosaveMs: null })).toBe('write');
  });

  it('skips within 30 s of a suspend save or an autosave', () => {
    expect(decideSuspend({ nowMs: 100_000, lastSuspendMs: 90_000, lastAutosaveMs: null })).toBe('skip');
    expect(decideSuspend({ nowMs: 100_000, lastSuspendMs: null, lastAutosaveMs: 80_000 })).toBe('skip');
    expect(decideSuspend({ nowMs: 100_000, lastSuspendMs: 60_000, lastAutosaveMs: 60_000 })).toBe('write');
  });
});

describe('import and export', () => {
  it('sniffs the Chronicle magic', () => {
    expect(looksLikeChronicle(chronicleBytes())).toBe(true);
    expect(looksLikeChronicle(new Uint8Array([0x1f, 0x8b, 0, 0]))).toBe(false);
    expect(looksLikeChronicle(chronicleBytes(10))).toBe(false);
  });

  it('checks imports before the worker sees them', () => {
    expect(checkImport(new Uint8Array())).toEqual({ ok: false, reason: 'empty' });
    expect(checkImport(new TextEncoder().encode('{"not":"a realm file, but long enough"}'))).toEqual({ ok: false, reason: 'not_a_chronicle' });
    expect(checkImport(chronicleBytes(128))).toEqual({ ok: true, byteSize: 128 });
    expect(checkImport(new Uint8Array(12 * MB + 1).fill(0x53))).toEqual({ ok: false, reason: 'too_large' });
  });

  it('builds a slug file name with the year', () => {
    expect(exportFileName('Ash & Bone Vale!', 1204)).toBe('ash-bone-vale-1204.realm');
    expect(exportFileName('Ångström Ürn', 7)).toBe('angstrom-urn-7.realm');
    expect(exportFileName('!!!', 3)).toBe('realm-3.realm');
  });

  it('caps the slug at 40 characters and never ends it with a dash', () => {
    const name = exportFileName('a'.repeat(39) + ' b', 9);
    expect(name).toBe(`${'a'.repeat(39)}-9.realm`);
    expect(name.length).toBeLessThanOrEqual(40 + '-9.realm'.length);
  });

  it('never puts the architect name or other free text beyond the realm name', () => {
    expect(exportFileName('Realm', 1)).toMatch(/^[a-z0-9-]+\.realm$/);
  });

  it('picks the share, picker, then download route', () => {
    expect(chooseExportRoute({ touch: true, canShareFiles: true, hasSaveFilePicker: true })).toBe('share');
    expect(chooseExportRoute({ touch: false, canShareFiles: true, hasSaveFilePicker: true })).toBe('save_picker');
    expect(chooseExportRoute({ touch: true, canShareFiles: false, hasSaveFilePicker: false })).toBe('download');
  });
});
