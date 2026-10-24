import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANNOT_RESTORE, RESTORE_TIMEOUT_MS, SaveController, autosaveCandidates, type ChronicleSource } from '../../src/app/save-controller.ts';
import { decideRecovery, type RecoveryAttempt } from '../../src/app/recovery.ts';
import { SaveError, type SaveService, type SlotMeta } from '../../src/app/saves.ts';

/** Builds a slot row. The kind comes from the slot id; only autosaves get a seq number. */
function meta(slotId: string, savedAtMs: number, valid: SlotMeta['valid'] = 'unknown'): SlotMeta {
  const kind: SlotMeta['kind'] = slotId.startsWith('auto:') ? 'auto' : slotId.startsWith('manual:') ? 'manual' : 'quick';
  const seq = kind === 'auto' ? Number(slotId.split(':')[1]) : null;
  return { slotId, kind, seq, realmName: 'Realm', tick: 0, year: 1, byteSize: 1, checksum: 0, savedAtMs, valid };
}

/** A fake store that satisfies the part of SaveService the restore path uses. */
function fakeStore(rows: SlotMeta[], bytes: Record<string, Uint8Array | 'corrupt'>): SaveService {
  return {
    mode: 'memory',
    fallbackReason: null,
    list: () => Promise.resolve(rows.map((r) => ({ ...r }))),
    read: (slotId: string) => {
      const b = bytes[slotId];
      if (b === 'corrupt') return Promise.reject(new SaveError('corrupt', 'checksum mismatch'));
      return Promise.resolve(b ?? null);
    },
  } as unknown as SaveService;
}

function source(restore: (bytes: Uint8Array) => Promise<boolean>, canRestore = true): ChronicleSource & { calls: number[][] } {
  const calls: number[][] = [];
  return {
    canCapture: false,
    canRestore,
    calls,
    capture: () => Promise.resolve(null),
    restore: (bytes) => {
      calls.push([...bytes]);
      return restore(bytes);
    },
  };
}

const A = new Uint8Array([1]);
const B = new Uint8Array([2]);
const C = new Uint8Array([3]);

function controller(store: SaveService, src: ChronicleSource): SaveController {
  return new SaveController(() => Promise.resolve(store), src, { now: () => 100_000 });
}

describe('autosave restore candidates', () => {
  it('offers only autosaves, newest first, and marks everything but the newest as previous', () => {
    const list = [meta('manual:2', 500), meta('auto:1', 100), meta('auto:3', 300), meta('quick', 900)];
    const candidates = autosaveCandidates(list);
    expect(candidates.map((c) => c.slotId)).toEqual(['auto:3', 'auto:1']);
    expect(candidates.map((c) => c.generation)).toEqual(['current', 'previous']);
  });
});

describe('restoreAutosave', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the newest valid autosave into the live realm', async () => {
    const src = source(() => Promise.resolve(true));
    const store = fakeStore([meta('auto:1', 100), meta('auto:2', 200)], { 'auto:1': A, 'auto:2': B });
    const outcome = await controller(store, src).restoreAutosave();
    expect(outcome.ok).toBe(true);
    expect(src.calls).toEqual([[2]]);
  });

  it('skips an autosave marked invalid and restores the next one', async () => {
    const src = source(() => Promise.resolve(true));
    const store = fakeStore([meta('auto:1', 100), meta('auto:2', 200, false)], { 'auto:1': A, 'auto:2': B });
    expect((await controller(store, src).restoreAutosave()).ok).toBe(true);
    expect(src.calls).toEqual([[1]]);
  });

  it('moves past an autosave whose bytes are damaged', async () => {
    const src = source(() => Promise.resolve(true));
    const store = fakeStore([meta('auto:1', 100), meta('auto:2', 200)], { 'auto:1': A, 'auto:2': 'corrupt' });
    expect((await controller(store, src).restoreAutosave()).ok).toBe(true);
    expect(src.calls).toEqual([[1]]);
  });

  it('tries older saves when the simulation refuses one', async () => {
    const src = source((bytes) => Promise.resolve(bytes[0] === 1));
    const store = fakeStore([meta('auto:1', 100), meta('auto:2', 200)], { 'auto:1': A, 'auto:2': B });
    expect((await controller(store, src).restoreAutosave()).ok).toBe(true);
    expect(src.calls).toEqual([[2], [1]]);
  });

  it('reports failure and touches nothing when no autosave is valid', async () => {
    const src = source(() => Promise.resolve(true));
    const store = fakeStore([meta('auto:1', 100, false), meta('manual:1', 50)], { 'auto:1': A });
    const outcome = await controller(store, src).restoreAutosave();
    expect(outcome).toEqual({ ok: false, message: 'There is no valid autosave to restore.' });
    expect(src.calls).toEqual([]);
  });

  it('gives up with a plain message when the simulation never answers', async () => {
    vi.useFakeTimers();
    const src = source(() => new Promise<boolean>(() => undefined));
    const store = fakeStore([meta('auto:1', 100), meta('auto:2', 200)], { 'auto:1': A, 'auto:2': B });
    const pending = controller(store, src).restoreAutosave();
    await vi.advanceTimersByTimeAsync(RESTORE_TIMEOUT_MS + 1);
    expect((await pending).message).toBe('The simulation did not answer, so the autosave was not loaded.');
    expect(src.calls).toHaveLength(1);
  });

  it('says so when this build cannot load a realm', async () => {
    const src = source(() => Promise.resolve(true), false);
    const store = fakeStore([meta('auto:1', 100)], { 'auto:1': A });
    expect(await controller(store, src).restoreAutosave()).toEqual({ ok: false, message: CANNOT_RESTORE });
  });

  it('in Safe Mode only the previous generation is offered', async () => {
    const src = source(() => Promise.resolve(true));
    const store = fakeStore([meta('auto:1', 100), meta('auto:2', 200)], { 'auto:1': A, 'auto:2': B });
    const c = controller(store, src);
    expect((await c.restoreTarget(true))?.slotId).toBe('auto:1');
    expect((await c.restoreAutosave(true)).ok).toBe(true);
    expect(src.calls).toEqual([[1]]);
  });
});

describe('restoreTarget', () => {
  it('is null when no autosave is valid, so the button is disabled', async () => {
    const store = fakeStore([meta('auto:1', 100, false)], {});
    expect(await controller(store, source(() => Promise.resolve(true))).restoreTarget()).toBeNull();
  });

  it('returns the newest valid autosave row', async () => {
    const store = fakeStore([meta('auto:1', 100), meta('auto:2', 200)], {});
    expect((await controller(store, source(() => Promise.resolve(true))).restoreTarget())?.slotId).toBe('auto:2');
  });
});

describe('recovery ladder for the restore button', () => {
  const attempts: RecoveryAttempt[] = [];

  it('without a valid autosave the ladder does not offer a restart from it', () => {
    const d = decideRecovery({ kind: 'sim_fatal', nowMs: 1_000, attempts, hasValidAutosave: false });
    expect(d.level).not.toBe('restart_from_autosave');
  });
});
