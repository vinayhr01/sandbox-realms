import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOOT_LOOP_WINDOW_MS, bootGuard, loadBoots, safeModeOn, setSafeMode, storeBoots } from '../../src/app/recovery.ts';

/** Minimal in-memory Storage, installed as window.localStorage and window.sessionStorage. */
class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const g = globalThis as unknown as { window?: unknown };

describe('boot guard and Safe Mode storage', () => {
  beforeEach(() => {
    g.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() };
  });
  afterEach(() => {
    delete g.window;
  });

  it('a clean boot is never a loop and records nothing', () => {
    expect(bootGuard(1_000_000, false)).toEqual({ loop: false });
    expect(loadBoots()).toEqual([]);
  });

  it('three unclean boots inside the window are a boot loop', () => {
    const now = 10_000_000;
    expect(bootGuard(now - 2 * 60_000, true).loop).toBe(false);
    expect(bootGuard(now - 60_000, true).loop).toBe(false);
    expect(bootGuard(now, true).loop).toBe(true);
    expect(loadBoots()).toHaveLength(3);
  });

  it('unclean boots older than the window do not count', () => {
    const now = 10_000_000;
    storeBoots([now - BOOT_LOOP_WINDOW_MS - 1, now - BOOT_LOOP_WINDOW_MS - 2]);
    expect(bootGuard(now, true).loop).toBe(false);
  });

  it('keeps only the newest five boot times', () => {
    const now = 50_000_000;
    for (let i = 0; i < 8; i++) bootGuard(now + i, true);
    expect(loadBoots()).toHaveLength(5);
  });

  it('ignores damaged stored history instead of failing', () => {
    (g.window as { localStorage: MemoryStorage }).localStorage.setItem('sr.boots', '{not json');
    expect(loadBoots()).toEqual([]);
    expect(bootGuard(1_000, true).loop).toBe(false);
  });

  it('Safe Mode is per tab: on until cleared', () => {
    expect(safeModeOn()).toBe(false);
    setSafeMode(true);
    expect(safeModeOn()).toBe(true);
    setSafeMode(false);
    expect(safeModeOn()).toBe(false);
  });
});

describe('boot guard without any storage', () => {
  it('treats the boot as ordinary when storage is missing', () => {
    expect(bootGuard(1_000, true)).toEqual({ loop: false });
    expect(safeModeOn()).toBe(false);
  });
});
