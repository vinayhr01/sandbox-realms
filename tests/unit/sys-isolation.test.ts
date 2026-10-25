import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRecord, type CrashInput } from '../../src/app/crash-record.ts';
import { SYS_DISABLE_CYCLES, SYS_DISABLE_TICKS, SYS_FAULTS_TO_DISABLE, SYS_FAULT_WINDOW_MS, SysIsolation } from '../../src/sim/scheduler.ts';

// 17 section 9: system isolation thresholds (worker side), and the sys.disabled flag of the crash record (19 section 5).

describe('system isolation thresholds (17 section 9)', () => {
  it('uses the spec values: 3 faults in 10 s, 600 ticks off, 3 switch-offs', () => {
    expect(SYS_FAULTS_TO_DISABLE).toBe(3);
    expect(SYS_FAULT_WINDOW_MS).toBe(10_000);
    expect(SYS_DISABLE_TICKS).toBe(600);
    expect(SYS_DISABLE_CYCLES).toBe(3);
  });

  it('two faults inside the window keep the part on', () => {
    const iso = new SysIsolation();
    expect(iso.fault('command', 0, 0)).toEqual({ verdict: 'ok', errorCount: 1 });
    expect(iso.fault('command', 1_000, 0)).toEqual({ verdict: 'ok', errorCount: 2 });
    expect(iso.isOff('command', 0)).toBe(false);
  });

  it('the third fault inside 10 s switches the part off for 600 sim ticks', () => {
    const iso = new SysIsolation();
    iso.fault('command', 0, 100);
    iso.fault('command', 4_000, 100);
    expect(iso.fault('command', 9_000, 100)).toEqual({ verdict: 'disable', errorCount: 3 });
    expect(iso.isOff('command', 100)).toBe(true);
    expect(iso.isOff('command', 100 + SYS_DISABLE_TICKS - 1)).toBe(true);
    expect(iso.isOff('command', 100 + SYS_DISABLE_TICKS)).toBe(false);
  });

  it('a fault exactly 10 s old is outside the window and does not count', () => {
    const iso = new SysIsolation();
    iso.fault('command', 0, 0);
    iso.fault('command', 1_000, 0);
    expect(iso.fault('command', SYS_FAULT_WINDOW_MS, 0)).toEqual({ verdict: 'ok', errorCount: 2 });
    expect(iso.isOff('command', 0)).toBe(false);
  });

  it('parts are counted apart', () => {
    const iso = new SysIsolation();
    iso.fault('pump', 0, 0);
    iso.fault('pump', 1, 0);
    expect(iso.fault('command', 2, 0).errorCount).toBe(1);
    expect(iso.isOff('command', 0)).toBe(false);
  });

  it('the third switch-off stops the sim, the first two only switch the part off', () => {
    const iso = new SysIsolation();
    const burst = (t0: number, tick: number): string[] => [
      iso.fault('command', t0, tick).verdict,
      iso.fault('command', t0 + 1, tick).verdict,
      iso.fault('command', t0 + 2, tick).verdict,
    ];
    expect(burst(0, 0)).toEqual(['ok', 'ok', 'disable']);
    expect(burst(20_000, 1_000)).toEqual(['ok', 'ok', 'disable']);
    expect(burst(40_000, 2_000)).toEqual(['ok', 'ok', 'stop']);
  });
});

describe('crash record sys.disabled (17 section 9, 19 section 5)', () => {
  beforeEach(() => {
    // buildRecord reads the page globals; the node test environment has none of them.
    vi.stubGlobal('location', { origin: 'https://game.example' });
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('navigator', { userAgent: 'vitest', maxTouchPoints: 0, onLine: true, hardwareConcurrency: 4 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function input(over: Partial<CrashInput>): CrashInput {
    return { kind: 'js_worker', ctx: 'worker', message: 'Error: pump failed', recovery: [], sys: 'command', ...over };
  }

  // Each record is built more than 10 s after the last, so the main-thread count is 1 in every test.
  it('a fault whose part is switched off records sys.disabled true', () => {
    expect(buildRecord(input({ sysOff: true }), 1_000_000).sys).toEqual({ id: 'command', errorCount: 1, disabled: true });
  });

  it('a fault whose part is still on records sys.disabled false', () => {
    expect(buildRecord(input({ sysOff: false }), 2_000_000).sys?.disabled).toBe(false);
  });

  it('a fault with no sysOff flag records sys.disabled false', () => {
    expect(buildRecord(input({}), 3_000_000).sys?.disabled).toBe(false);
  });

  it('a fault that names no part has no sys block', () => {
    expect(buildRecord(input({ sys: undefined, sysOff: true }), 4_000_000).sys).toBeUndefined();
  });
});
