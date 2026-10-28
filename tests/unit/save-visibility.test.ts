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
    expect(out.message).toMatch(/^Couldn't save: .*timed out/);
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
