import { describe, expect, it, vi } from 'vitest';
import { encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { SaveService, openSaveDatabase, type SlotInfo } from '../../src/app/saves.ts';
import { SaveController, type ChronicleSource } from '../../src/app/save-controller.ts';
import { settleOutcome } from '../../src/ui/windowContent.ts';

const bytes = encodeChronicle(generateRealm({ seed: 9, sizeStep: 2, template: 'continent' }).sim);
const info: SlotInfo = { realmName: 'Ash Vale', tick: 100, year: 3 };

/** A fake IDBFactory whose open request fires one scripted event. */
function fakeFactory(script: (req: Record<string, unknown>) => void): IDBFactory {
  return {
    open: () => {
      const req: Record<string, unknown> = {};
      setTimeout(() => script(req), 0);
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}
const blockedFactory = () => fakeFactory((req) => (req.onblocked as () => void)());
const hangingFactory = () => fakeFactory(() => undefined);
const throwingFactory = (name: string) =>
  fakeFactory((req) => {
    req.error = Object.assign(new Error('denied'), { name });
    (req.onerror as () => void)();
  });

function source(capture: ChronicleSource['capture']): ChronicleSource {
  return { canCapture: true, canRestore: true, capture, restore: () => Promise.resolve(true) };
}
const okCapture = () => Promise.resolve({ bytes, info });
function controller(factory: IDBFactory | undefined, src: ChronicleSource, opts: Record<string, number> = {}) {
  return new SaveController(() => SaveService.open(factory, { isPhone: false, ...(opts['openMs'] ? { openTimeoutMs: opts['openMs'] } : {}) }), src, opts);
}

describe('manual save outcomes are always visible', () => {
  it('names another open tab when the database open is blocked', async () => {
    const out = await controller(blockedFactory(), source(okCapture)).perform('save', 'new');
    expect(out.ok).toBe(false);
    expect(out.message).toBe("Couldn't save: storage is blocked by another open tab of the game — close it and try again.");
  });

  it('gives up on a database open that never answers', async () => {
    const out = await controller(hangingFactory(), source(okCapture), { openMs: 30 }).perform('save', 'new');
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/^Couldn't save: .*(another open tab|timed out)/);
  });

  it('explains private browsing when the open is refused', async () => {
    const out = await controller(throwingFactory('SecurityError'), source(okCapture)).perform('save', 'new');
    expect(out.ok).toBe(false);
    expect(out.message).toBe("Couldn't save: this browser blocks saving in private mode.");
  });

  it('times out a capture that never resolves', async () => {
    const out = await controller(undefined, source(() => new Promise(() => undefined)), { captureTimeoutMs: 30 }).perform('save', 'new');
    expect(out.ok).toBe(false);
    expect(out.message).toBe("Couldn't save: the world took too long to capture.");
  });

  it('reports a full disk when the write throws QuotaExceededError', async () => {
    const service = await SaveService.open(undefined, { isPhone: false });
    vi.spyOn(service, 'writeManual').mockRejectedValue(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    const out = await new SaveController(() => Promise.resolve(service), source(okCapture)).perform('save', 'new');
    expect(out.ok).toBe(false);
    expect(out.message).toBe("Couldn't save: storage is full — delete a save or free space on this device.");
  });

  it('times out a write that never completes', async () => {
    const service = await SaveService.open(undefined, { isPhone: false });
    vi.spyOn(service, 'writeManual').mockReturnValue(new Promise(() => undefined));
    const out = await new SaveController(() => Promise.resolve(service), source(okCapture), { writeTimeoutMs: 30 }).perform('save', 'new');
    expect(out.ok).toBe(false);
    expect(out.message).toBe('Saving is taking long — check the list in a moment.');
  });

  it('says so when the save only lasts this visit', async () => {
    const out = await controller(undefined, source(okCapture)).perform('save', 'new');
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/^Saved slot 1, but only until this tab closes/);
  });

  it('the open rejects with a blocked error rather than hanging', async () => {
    await expect(openSaveDatabase(blockedFactory())).rejects.toMatchObject({ code: 'blocked' });
  });
});

describe('the window never sticks on a pending action', () => {
  it('turns a rejection into a failure message', async () => {
    expect(await settleOutcome(Promise.reject(new Error('boom')), 'save')).toEqual({ ok: false, message: "Couldn't save: something went wrong." });
  });
  it('turns a hang into a failure message', async () => {
    const out = await settleOutcome(new Promise(() => undefined), 'save', 30);
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/^Couldn't save: .*too long/);
  });
  it('passes a real outcome through', async () => {
    expect(await settleOutcome(Promise.resolve({ ok: true, message: 'Saved slot 1.' }), 'save')).toEqual({ ok: true, message: 'Saved slot 1.' });
  });
});

describe('resume on boot', () => {
  it('restores the newest save of any kind and reports it', async () => {
    const restored: Uint8Array[] = [];
    const src: ChronicleSource = { ...source(okCapture), restore: (b) => (restored.push(b), Promise.resolve(true)) };
    let t = 1000;
    const c = controller(undefined, src, { now: () => t } as never);
    await c.perform('save', 'new');
    t = 2000;
    await c.perform('quick', 'quick');
    t = 3000;
    await c.perform('save', 'new');
    const out = await c.resumeNewest(false);
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/Ash Vale/);
    expect(restored).toHaveLength(1);
  });
  it('does nothing in Safe Mode or with no saves', async () => {
    const c = controller(undefined, source(okCapture));
    expect((await c.resumeNewest(false)).ok).toBe(false);
    await c.perform('save', 'new');
    expect((await c.resumeNewest(true)).ok).toBe(false);
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const memService = () => SaveService.open(undefined, { isPhone: false });

describe('resume cannot overwrite the save it is resuming', () => {
  it('blocks suspend, quick, manual and emergency saves until the resume lands', async () => {
    const service = await memService();
    let captures = 0;
    let release: (v: boolean) => void = () => undefined;
    const src: ChronicleSource = {
      canCapture: true,
      canRestore: true,
      capture: () => (captures++, Promise.resolve({ bytes, info })),
      restore: () => new Promise<boolean>((r) => (release = r)),
    };
    const c = new SaveController(() => Promise.resolve(service), src);
    await service.writeSuspend(bytes, { ...info, realmName: 'Old World' }, 5);
    c.beginResume();
    const resume = c.resumeNewest(false);
    await sleep(10);
    await c.suspend();
    expect(captures).toBe(0);
    expect((await c.perform('quick', 'quick')).message).toBe('Still resuming your world…');
    expect((await c.perform('save', 'new')).message).toBe('Still resuming your world…');
    expect(await c.emergencySave()).toBe('emergency_save_resuming');
    expect((await c.list()).map((m) => m.realmName)).toEqual(['Old World']);
    release(true);
    expect((await resume).ok).toBe(true);
    await c.suspend();
    expect(captures).toBe(1);
  });

  it('clears the resuming state even when there is nothing to resume', async () => {
    const c = controller(undefined, source(okCapture));
    c.beginResume();
    expect((await c.resumeNewest(false)).ok).toBe(false);
    expect((await c.perform('save', 'new')).ok).toBe(true);
  });

  it('keeps a copy of the resumed realm in a manual slot before a new world', async () => {
    const service = await memService();
    const c = new SaveController(() => Promise.resolve(service), source(okCapture));
    await service.writeSuspend(bytes, info, 5);
    await c.resumeNewest(false);
    const kept = await c.keepResumedBeforeNewWorld();
    expect(kept?.ok).toBe(true);
    await c.suspend();
    const names = (await c.list()).map((m) => `${m.kind}:${m.realmName}`).sort();
    expect(names).toContain('manual:Ash Vale (before new world)');
  });

  it('(a) a restore that takes 40 s holds every save until it settles, then saves resume', async () => {
    vi.useFakeTimers();
    try {
      const service = await memService();
      let captures = 0;
      let release: (v: boolean) => void = () => undefined;
      const src: ChronicleSource = {
        canCapture: true,
        canRestore: true,
        capture: () => (captures++, Promise.resolve({ bytes, info })),
        restore: () => new Promise<boolean>((r) => (release = r)),
      };
      const c = new SaveController(() => Promise.resolve(service), src);
      await service.writeSuspend(bytes, { ...info, realmName: 'Old World' }, 5);
      let slow = 0;
      c.beginResume();
      const resume = c.resumeNewest(false, () => slow++);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(slow).toBe(1);
      expect(c.isResuming).toBe(true);
      await c.suspend();
      expect(captures).toBe(0);
      expect((await c.perform('save', 'new')).message).toBe('Still resuming your world…');
      expect(await c.emergencySave()).toBe('emergency_save_resuming');
      await vi.advanceTimersByTimeAsync(9_000);
      release(true);
      expect((await resume).ok).toBe(true);
      expect(c.isResuming).toBe(false);
      expect(slow).toBe(1);
      await c.suspend();
      expect(captures).toBe(1);
      expect((await c.perform('save', 'new')).ok).toBe(true);
      expect((await c.list()).map((m) => m.realmName)).toEqual(['Ash Vale', 'Ash Vale']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(b) a restore that rejects clears the guard and saves work again', async () => {
    const service = await memService();
    let captures = 0;
    const src: ChronicleSource = {
      canCapture: true,
      canRestore: true,
      capture: () => (captures++, Promise.resolve({ bytes, info })),
      restore: () => Promise.reject(new Error('decode failed')),
    };
    const c = new SaveController(() => Promise.resolve(service), src);
    await service.writeSuspend(bytes, info, 5);
    c.beginResume();
    expect((await c.resumeNewest(false)).ok).toBe(false);
    expect(c.isResuming).toBe(false);
    await c.suspend();
    expect(captures).toBe(1);
    expect((await c.perform('save', 'new')).ok).toBe(true);
  });

  it('does not copy a resumed manual slot', async () => {
    const service = await memService();
    const c = new SaveController(() => Promise.resolve(service), source(okCapture));
    await service.writeManual(1, bytes, info, 5);
    await c.resumeNewest(false);
    expect(await c.keepResumedBeforeNewWorld()).toBeNull();
    expect(await c.list()).toHaveLength(1);
  });

  it('picks the same save as the restore rules, ties by slot id', async () => {
    const service = await memService();
    const restored: Uint8Array[] = [];
    const src: ChronicleSource = { ...source(okCapture), restore: (b) => (restored.push(b), Promise.resolve(true)) };
    const c = new SaveController(() => Promise.resolve(service), src);
    await service.writeManual(2, bytes, { ...info, realmName: 'Two' }, 7);
    await service.writeManual(1, bytes, { ...info, realmName: 'One' }, 7);
    expect((await c.resumeNewest(false)).message).toMatch(/One/);
  });
});

describe('a dropped connection is reopened', () => {
  it('reopens the store after a versionchange and then saves', async () => {
    let opens = 0;
    let stale = false;
    const open = async () => {
      opens++;
      const s = await memService();
      const mine = opens;
      Object.defineProperty(s, 'stale', { get: () => stale && mine === 1 });
      return s;
    };
    const c = new SaveController(open, source(okCapture));
    expect((await c.perform('save', 'new')).ok).toBe(true);
    stale = true;
    expect((await c.perform('save', 'new')).ok).toBe(true);
    expect(opens).toBe(2);
  });

  it('only a SecurityError means private mode; InvalidStateError is a retryable storage error', async () => {
    const service = await memService();
    vi.spyOn(service, 'writeManual').mockRejectedValue(Object.assign(new Error('closing'), { name: 'InvalidStateError' }));
    const out = await new SaveController(() => Promise.resolve(service), source(okCapture)).perform('save', 'new');
    expect(out.message).toBe("Couldn't save: storage error, try again.");
  });

  it('uses the right verb for other actions', async () => {
    const service = await memService();
    vi.spyOn(service, 'delete').mockRejectedValue(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    const out = await new SaveController(() => Promise.resolve(service), source(okCapture)).perform('delete', 'manual:1');
    expect(out.message).toMatch(/^Couldn't delete: /);
  });
});

describe('a write that outlives its timeout', () => {
  it('reports success when the slot is there after all', async () => {
    const service = await memService();
    const real = service.writeManual.bind(service);
    vi.spyOn(service, 'writeManual').mockImplementation(async (...a) => {
      const r = await real(...a);
      await sleep(200);
      return r;
    });
    const c = new SaveController(() => Promise.resolve(service), source(okCapture), { writeTimeoutMs: 30 });
    const out = await c.perform('save', 'new');
    expect(out).toEqual({ ok: true, message: 'Saved slot 1.' });
  });

  it('says it is slow, not failed, when the slot is not there yet, and the retry makes no duplicate', async () => {
    const service = await memService();
    const real = service.writeManual.bind(service);
    vi.spyOn(service, 'writeManual').mockImplementationOnce(async (...a) => {
      await sleep(80);
      return real(...a);
    });
    const c = new SaveController(() => Promise.resolve(service), source(okCapture), { writeTimeoutMs: 30 });
    const out = await c.perform('save', 'new');
    expect(out.message).toBe('Saving is taking long — check the list in a moment.');
    await sleep(120);
    expect((await c.perform('save', 'new')).ok).toBe(true);
    expect((await c.list()).map((m) => m.slotId).sort()).toEqual(['manual:1', 'manual:2']);
  });
});

describe('a late result still reaches the window', () => {
  it('calls onLate when the task finishes after the watchdog', async () => {
    const late = vi.fn();
    const out = await settleOutcome(sleep(80).then(() => ({ ok: true, message: 'Saved slot 1.' })), 'save', 20, late);
    expect(out.ok).toBe(false);
    await sleep(120);
    expect(late).toHaveBeenCalledWith({ ok: true, message: 'Saved slot 1.' });
  });
});
