import { describe, expect, it } from 'vitest';
import { AUTOSAVE_RING, SaveService, type SaveEnvironment } from '../../src/app/saves.ts';

/**
 * Exercises SaveService through its memory backend (the same fallback the UI uses when IndexedDB
 * is blocked). The IndexedDB path needs a browser and is covered by the Playwright platform tests.
 */

const MB = 1024 * 1024;
const info = { realmName: 'Ash Vale', tick: 100, year: 3 };

function bytesFor(tag: number, length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0x53, 0x52, 0x43, 0x48]);
  bytes[length - 1] = tag;
  return bytes;
}

function env(quota?: number, isPhone = false): SaveEnvironment {
  if (quota === undefined) return { isPhone };
  return { isPhone, storage: { estimate: async () => ({ usage: 0, quota }) } };
}

describe('SaveService (memory backend)', () => {
  it('falls back to memory with a reason when IndexedDB is missing', async () => {
    const service = await SaveService.open(undefined, env());
    expect(service.mode).toBe('memory');
    expect(service.fallbackReason).toBeTruthy();
  });

  it('writes a manual slot and reads the same bytes back', async () => {
    const service = await SaveService.open(undefined, env());
    const result = await service.writeManual(2, bytesFor(1), info, 1000);
    expect(result.ok).toBe(true);
    const back = await service.read('manual:2');
    expect(back && Array.from(back)).toEqual(Array.from(bytesFor(1)));
    const [meta] = await service.list();
    expect(meta).toMatchObject({ slotId: 'manual:2', kind: 'manual', realmName: 'Ash Vale', tick: 100, year: 3, byteSize: 64 });
  });

  it('keeps the previous generation when a manual slot is replaced', async () => {
    const service = await SaveService.open(undefined, env());
    await service.writeManual(1, bytesFor(1), info, 1000);
    await service.writeManual(1, bytesFor(2), info, 2000);
    expect((await service.read('manual:1'))?.[63]).toBe(2);
    expect((await service.readPrev('manual:1'))?.[63]).toBe(1);
    expect(await service.readPrev('manual:9')).toBeNull();
  });

  it('returns null for a slot that was never written', async () => {
    const service = await SaveService.open(undefined, env());
    expect(await service.read('quick')).toBeNull();
  });

  it('keeps exactly five autosaves, newest first, with strictly increasing ids', async () => {
    const service = await SaveService.open(undefined, env());
    let last: string | null = null;
    for (let i = 0; i < 12; i++) {
      const result = await service.writeAutosave(bytesFor(i), info, 1000 * (i + 1));
      expect(result.ok).toBe(true);
      if (result.ok) last = result.meta.slotId;
    }
    const autos = (await service.list()).filter((m) => m.kind === 'auto');
    expect(autos).toHaveLength(AUTOSAVE_RING);
    expect(autos.map((m) => m.seq)).toEqual([12, 11, 10, 9, 8]);
    expect(last).toBe('auto:12');
  });

  it('never prunes manual, quick or suspend slots with the autosave ring', async () => {
    const service = await SaveService.open(undefined, env());
    await service.writeManual(5, bytesFor(5), info, 1);
    await service.writeQuick(bytesFor(6), info, 2);
    await service.writeSuspend(bytesFor(7), info, 3);
    for (let i = 0; i < 8; i++) await service.writeAutosave(bytesFor(i), info, 10 + i);
    const kinds = (await service.list()).map((m) => m.slotId).sort();
    expect(kinds).toEqual(['auto:4', 'auto:5', 'auto:6', 'auto:7', 'auto:8', 'manual:5', 'quick', 'suspend']);
  });

  it('refuses a write over the soft cap and names the biggest slots', async () => {
    // Quota 40 MB on desktop gives a 10 MB soft cap. Each write below is 4 MB.
    const service = await SaveService.open(undefined, env(40 * MB));
    const big = new Uint8Array(4 * MB).fill(0x53);
    big.set([0x53, 0x52, 0x43, 0x48]);
    expect((await service.writeManual(1, big, info, 1)).ok).toBe(true);
    expect((await service.writeManual(2, big, info, 2)).ok).toBe(true);
    const refused = await service.writeManual(3, big, info, 3);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe('over_soft_cap');
      expect(refused.needBytes).toBeGreaterThan(0);
      expect(refused.biggest).toEqual(['manual:1', 'manual:2']);
    }
    expect(await service.read('manual:3')).toBeNull();
  });

  it('drops the oldest autosaves to make room for a manual save', async () => {
    const service = await SaveService.open(undefined, env(40 * MB));
    const big = new Uint8Array(3 * MB).fill(0x53);
    big.set([0x53, 0x52, 0x43, 0x48]);
    await service.writeAutosave(big, info, 1);
    await service.writeAutosave(big, info, 2);
    // 6 MB stored + 5 MB incoming is over the 10 MB cap, so auto:1 goes; 3 + 5 then fits.
    const result = await service.writeManual(1, new Uint8Array(5 * MB).fill(0x53), info, 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pruned).toEqual(['auto:1']);
    const ids = (await service.list()).map((m) => m.slotId);
    expect(ids).toContain('auto:2');
    expect(ids).not.toContain('auto:1');
  });

  it('rejects a Chronicle over the 12 MB cap before any write', async () => {
    const service = await SaveService.open(undefined, env());
    await expect(service.writeManual(1, new Uint8Array(12 * MB + 1), info, 1)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('deletes a slot and its previous generation', async () => {
    const service = await SaveService.open(undefined, env());
    await service.writeManual(4, bytesFor(1), info, 1);
    await service.writeManual(4, bytesFor(2), info, 2);
    await service.delete('manual:4');
    expect(await service.read('manual:4')).toBeNull();
    expect(await service.readPrev('manual:4')).toBeNull();
    expect(await service.list()).toEqual([]);
  });

  it('checks an import file before the worker validates it', async () => {
    const service = await SaveService.open(undefined, env());
    expect(service.checkImport(bytesFor(0))).toEqual({ ok: true, byteSize: 64 });
    expect(service.checkImport(new Uint8Array([1, 2, 3, 4, 5]))).toEqual({ ok: false, reason: 'not_a_chronicle' });
  });
});
