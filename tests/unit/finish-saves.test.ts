import { describe, expect, it } from 'vitest';
import { encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { AUTOSAVE_INTERVAL_MS, AUTOSAVE_LOAD_GRACE_MS, SaveService, type SlotInfo } from '../../src/app/saves.ts';
import { CANNOT_CAPTURE, CANNOT_RESTORE, NO_SIM_SOURCE, SaveController, type ChronicleSource } from '../../src/app/save-controller.ts';

/** A real Chronicle from the codec, so the import check sees genuine bytes. */
function realChronicle(): Uint8Array {
  return encodeChronicle(generateRealm({ seed: 9, sizeStep: 2, template: 'continent' }).sim);
}

const info: SlotInfo = { realmName: 'Ash Vale', tick: 100, year: 3 };

/** A source that captures fixed bytes and records what it restored. */
function fakeSource(bytes: Uint8Array): ChronicleSource & { restored: Uint8Array[] } {
  const restored: Uint8Array[] = [];
  return {
    canCapture: true,
    canRestore: true,
    restored,
    capture: () => Promise.resolve({ bytes, info }),
    restore: (b) => {
      restored.push(b);
      return Promise.resolve(true);
    },
  };
}

async function controllerWith(source: ChronicleSource, now: () => number = () => 0, onAutosaved?: () => void) {
  const service = await SaveService.open(undefined, { isPhone: false });
  return new SaveController(() => Promise.resolve(service), source, { now, ...(onAutosaved ? { onAutosaved } : {}) });
}

describe('save controller without a sim source (this build)', () => {
  it('reports that saving and loading are unavailable instead of writing anything', async () => {
    const controller = await controllerWith(NO_SIM_SOURCE);
    expect(controller.canSave).toBe(false);
    expect(controller.canLoad).toBe(false);
    expect(await controller.perform('quick', 'quick')).toEqual({ ok: false, message: CANNOT_CAPTURE });
    expect(await controller.perform('save', 'new')).toEqual({ ok: false, message: CANNOT_CAPTURE });
    expect(await controller.perform('load', 'quick')).toEqual({ ok: false, message: CANNOT_RESTORE });
    expect(await controller.list()).toEqual([]);
  });

  it('imports a real Chronicle, exports it back byte for byte, and deletes it', async () => {
    const controller = await controllerWith(NO_SIM_SOURCE);
    const bytes = realChronicle();
    const imported = await controller.importFile('Ash Vale.realm', bytes);
    expect(imported.ok).toBe(true);

    const [slot] = await controller.list();
    expect(slot?.slotId).toBe('manual:1');
    expect(slot?.realmName).toBe('Ash Vale');

    const file = await controller.exportSave('manual:1');
    expect(file?.name).toBe('ash-vale-0.realm');
    expect(Buffer.from(file?.bytes ?? new Uint8Array()).equals(Buffer.from(bytes))).toBe(true);

    expect((await controller.perform('delete', 'manual:1')).ok).toBe(true);
    expect(await controller.list()).toEqual([]);
  });

  it('refuses files that are not Chronicles, empty files and files that are too large', async () => {
    const controller = await controllerWith(NO_SIM_SOURCE);
    expect((await controller.importFile('a.realm', new Uint8Array(0))).message).toBe('The file is empty.');
    expect((await controller.importFile('a.realm', new Uint8Array(64))).message).toBe('That file is not a Sandbox Realms save.');
    expect((await controller.importFile('a.realm', new Uint8Array(13 * 1024 * 1024))).message).toBe('The file is too large to be a realm.');
    expect(await controller.list()).toEqual([]);
  });

  it('does not export a slot that is not there', async () => {
    const controller = await controllerWith(NO_SIM_SOURCE);
    expect(await controller.exportSave('manual:4')).toBeNull();
  });
});

describe('save controller with a sim source', () => {
  it('saves a quick save and a new manual slot, then loads the same bytes back', async () => {
    const bytes = realChronicle();
    const source = fakeSource(bytes);
    const controller = await controllerWith(source);
    expect((await controller.perform('quick', 'quick')).ok).toBe(true);
    expect((await controller.perform('save', 'new')).ok).toBe(true);
    const ids = (await controller.list()).map((m) => m.slotId).sort();
    expect(ids).toEqual(['manual:1', 'quick']);

    expect((await controller.perform('load', 'manual:1')).ok).toBe(true);
    expect(source.restored).toHaveLength(1);
    expect(Buffer.from(source.restored[0] ?? new Uint8Array()).equals(Buffer.from(bytes))).toBe(true);
  });

  it('autosaves when the unpaused timer runs out and not while paused', async () => {
    let clock = 0;
    let saved = 0;
    const controller = await controllerWith(fakeSource(realChronicle()), () => clock, () => saved++);
    // The load grace period (2 min) must pass before an autosave is allowed.
    clock = AUTOSAVE_LOAD_GRACE_MS + 1;
    const state = { dirty: true, modalOpen: false, gestureActive: false, degradeLevel: 0 };

    controller.frame(AUTOSAVE_INTERVAL_MS, true, state);
    await flush();
    expect(saved).toBe(0);

    controller.frame(AUTOSAVE_INTERVAL_MS, false, state);
    await flush();
    expect(saved).toBe(1);
    const autos = (await controller.list()).filter((m) => m.kind === 'auto');
    expect(autos).toHaveLength(1);

    clock += 1;
    controller.onPause({ ...state, dirty: false });
    await flush();
    expect(saved).toBe(1);
  });

  it('keeps the autosave timer off when the source cannot capture', async () => {
    const controller = await controllerWith(NO_SIM_SOURCE, () => AUTOSAVE_LOAD_GRACE_MS + 1);
    controller.frame(AUTOSAVE_INTERVAL_MS * 3, false, { dirty: true, modalOpen: false, gestureActive: false, degradeLevel: 0 });
    await flush();
    expect(await controller.list()).toEqual([]);
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
