import { describe, expect, it } from 'vitest';
import {
  BOOT_LOOP_WINDOW_MS,
  DEGRADE_MAX_LEVEL,
  DEGRADE_OFF,
  DEGRADE_RENDER_SCALE_LEVEL,
  DEGRADE_START,
  FAULT_SEVERITY,
  RECOVERY_WINDOW_MS,
  SAFE_MODE_PROFILE,
  chooseRestore,
  decideRecovery,
  isBootLoop,
  recordBoot,
  restoreOffers,
  stepDegrade,
  type DegradeTrack,
  type RecoveryAttempt,
  type RestoreCandidate,
} from '../../src/app/recovery.ts';
import { SETTING_BY_ID } from '../../src/ui/panels/options.ts';

describe('degradation ladder', () => {
  it('turns off the nine runtime map effects in order, one per level, deploy effects first', () => {
    expect(DEGRADE_OFF).toEqual([
      'map.effects',
      'map.crowdAnim',
      'map.dust',
      'map.terrainClose',
      'map.terrainMedium',
      'map.creatureAnim',
      'map.bloom',
      'map.particles',
      'map.shadows',
    ]);
    expect(DEGRADE_MAX_LEVEL).toBe(10);
    expect(DEGRADE_RENDER_SCALE_LEVEL).toBe(10);
  });

  it('keeps the new runtime flags out of the saved settings and the Options UI', () => {
    for (const id of ['map.effects', 'map.crowdAnim', 'map.dust', 'map.terrainClose', 'map.terrainMedium', 'map.creatureAnim']) {
      expect(SETTING_BY_ID.has(id)).toBe(false);
    }
  });

  it('reaches the top level under sustained load and stays there', () => {
    let track: DegradeTrack = DEGRADE_START;
    for (let s = 0; s < 100; s++) track = stepDegrade(track, 100, 16.7);
    expect(track.level).toBe(DEGRADE_MAX_LEVEL);
    track = stepDegrade(track, 100, 16.7);
    expect(track.level).toBe(DEGRADE_MAX_LEVEL);
  });
});

const NOW = 10_000_000;

function attempt(level: RecoveryAttempt['level'], minutesAgo: number, kind: RecoveryAttempt['kind'] = 'sim_fatal'): RecoveryAttempt {
  return { atMs: NOW - minutesAgo * 60_000, kind, level };
}

describe('fault severity table', () => {
  it('marks only sim_fatal, worker_dead and oom as fatal (19 section 2)', () => {
    const fatal = Object.entries(FAULT_SEVERITY)
      .filter(([, s]) => s === 'fatal')
      .map(([k]) => k)
      .sort();
    expect(fatal).toEqual(['oom', 'sim_fatal', 'worker_dead']);
  });
});

describe('decideRecovery', () => {
  it('restarts from the last valid autosave on the first fatal fault', () => {
    const d = decideRecovery({ kind: 'sim_fatal', nowMs: NOW, attempts: [], hasValidAutosave: true });
    expect(d.level).toBe('restart_from_autosave');
    expect(d.enterSafeMode).toBe(false);
  });

  it('resets the Realm when there is no valid autosave', () => {
    const d = decideRecovery({ kind: 'worker_dead', nowMs: NOW, attempts: [], hasValidAutosave: false });
    expect(d.level).toBe('reset_realm');
    expect(d.reason).toMatch(/no valid autosave/);
  });

  it('escalates from restart to reset when a restart already happened in the window', () => {
    const d = decideRecovery({ kind: 'sim_fatal', nowMs: NOW, attempts: [attempt('restart_from_autosave', 3)], hasValidAutosave: true });
    expect(d.level).toBe('reset_realm');
  });

  it('shows the fatal dialog once restart and reset were both tried in the window', () => {
    const d = decideRecovery({
      kind: 'sim_fatal',
      nowMs: NOW,
      attempts: [attempt('restart_from_autosave', 5), attempt('reset_realm', 2)],
      hasValidAutosave: true,
    });
    expect(d.level).toBe('fatal_dialog');
  });

  it('forgets attempts older than the 10 minute window', () => {
    const old = attempt('restart_from_autosave', RECOVERY_WINDOW_MS / 60_000 + 1);
    const d = decideRecovery({ kind: 'sim_fatal', nowMs: NOW, attempts: [old], hasValidAutosave: true });
    expect(d.level).toBe('restart_from_autosave');
  });

  it('enters Safe Mode on the second fatal fault inside the window', () => {
    const first = decideRecovery({ kind: 'oom', nowMs: NOW, attempts: [], hasValidAutosave: true });
    expect(first.enterSafeMode).toBe(false);
    const second = decideRecovery({
      kind: 'oom',
      nowMs: NOW,
      attempts: [{ atMs: NOW - 60_000, kind: 'oom', level: first.level ?? 'fatal_dialog' }],
      hasValidAutosave: true,
    });
    expect(second.enterSafeMode).toBe(true);
  });

  it('returns no ladder step for warn and error faults', () => {
    for (const kind of ['audio_fail', 'csp_violation', 'js_main', 'storage_fail', 'load_corrupt'] as const) {
      const d = decideRecovery({ kind, nowMs: NOW, attempts: [], hasValidAutosave: true });
      expect(d.level).toBeNull();
      expect(d.enterSafeMode).toBe(false);
    }
  });

  it('keeps a fault from the future out of the window', () => {
    const future: RecoveryAttempt = { atMs: NOW + 1000, kind: 'sim_fatal', level: 'restart_from_autosave' };
    const d = decideRecovery({ kind: 'sim_fatal', nowMs: NOW, attempts: [future], hasValidAutosave: true });
    expect(d.level).toBe('restart_from_autosave');
  });
});

describe('boot-loop guard', () => {
  it('does not trip on two boots or on boots older than the window', () => {
    expect(isBootLoop([NOW - 60_000, NOW - 120_000], NOW)).toBe(false);
    expect(isBootLoop([NOW - BOOT_LOOP_WINDOW_MS - 1, NOW - 120_000, NOW - 60_000], NOW)).toBe(false);
  });

  it('keeps only the newest five boot times', () => {
    let boots: number[] = [];
    for (let i = 0; i < 8; i++) boots = recordBoot(boots, i);
    expect(boots).toEqual([3, 4, 5, 6, 7]);
  });
});

describe('restore prompt', () => {
  const suspend: RestoreCandidate = { slotId: 'suspend', savedAtMs: 500, valid: 'unknown', generation: 'current' };
  const auto: RestoreCandidate = { slotId: 'auto:4', savedAtMs: 400, valid: true, generation: 'current' };
  const badNewest: RestoreCandidate = { slotId: 'auto:5', savedAtMs: 600, valid: false, generation: 'current' };
  const prevAuto: RestoreCandidate = { slotId: 'manual:2', savedAtMs: 100, valid: true, generation: 'previous' };

  it('offers the newer of suspend and the newest autosave when both are valid', () => {
    expect(chooseRestore([auto, suspend], false)?.slotId).toBe('suspend');
    expect(chooseRestore([auto, { ...suspend, savedAtMs: 300 }], false)?.slotId).toBe('auto:4');
  });

  it('skips a save that failed validation', () => {
    expect(chooseRestore([badNewest, auto], false)?.slotId).toBe('auto:4');
    expect(restoreOffers([badNewest], false)).toEqual([]);
  });

  it('offers only the previous generation in Safe Mode', () => {
    expect(restoreOffers([suspend, auto, prevAuto], true).map((c) => c.slotId)).toEqual(['manual:2']);
    expect(chooseRestore([suspend, auto], true)).toBeNull();
  });

  it('returns null when nothing can be restored', () => {
    expect(chooseRestore([], false)).toBeNull();
  });

  it('applies the Safe Mode profile from 19 section 7', () => {
    expect(SAFE_MODE_PROFILE).toMatchObject({ qualityTier: 'low', sharedMemory: false, workers: 1, audio: false, autosave: true, renderScale: 0.5 });
  });
});
