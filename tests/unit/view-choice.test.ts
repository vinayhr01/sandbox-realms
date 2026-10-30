import { describe, expect, it } from 'vitest';
import { chooseView, readSavedView, writeSavedView, VIEW_KEY } from '../../src/app/view-choice.ts';

const base = { query: null, saved: null, webgl2: true, deviceMemory: undefined, safeMode: false } as const;

describe('chooseView precedence', () => {
  it('Safe Mode is 2D whatever else is set', () => {
    expect(chooseView({ ...base, safeMode: true, query: '3d', saved: '3d' })).toBe('2d');
  });

  it('?view=3d beats a saved 2d choice', () => {
    expect(chooseView({ ...base, query: '3d', saved: '2d' })).toBe('3d');
  });

  it('?view=2d beats a saved 3d choice', () => {
    expect(chooseView({ ...base, query: '2d', saved: '3d' })).toBe('2d');
  });

  it('the saved choice beats the default', () => {
    expect(chooseView({ ...base, saved: '2d' })).toBe('2d');
    expect(chooseView({ ...base, webgl2: false, saved: '3d' })).toBe('3d');
  });

  it('defaults to 3D when WebGL2 works and device memory is unknown or at least 4', () => {
    expect(chooseView({ ...base })).toBe('3d');
    expect(chooseView({ ...base, deviceMemory: 4 })).toBe('3d');
    expect(chooseView({ ...base, deviceMemory: 8 })).toBe('3d');
  });

  it('defaults to 2D on low memory or without WebGL2', () => {
    expect(chooseView({ ...base, deviceMemory: 2 })).toBe('2d');
    expect(chooseView({ ...base, webgl2: false })).toBe('2d');
  });

  it('ignores an unknown query value and an unknown saved value', () => {
    expect(chooseView({ ...base, query: 'vr', saved: '2d' })).toBe('2d');
    expect(chooseView({ ...base, query: 'vr', saved: 'bogus', deviceMemory: 2 })).toBe('2d');
    expect(chooseView({ ...base, query: '', saved: 'nope' })).toBe('3d');
  });
});

describe('saved view storage', () => {
  it('reads and writes sr.view through the storage object', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(writeSavedView(storage, '2d')).toBe(true);
    expect(data.get(VIEW_KEY)).toBe('2d');
    expect(readSavedView(storage)).toBe('2d');
  });

  it('a throwing or missing storage reads as no choice and a failed write reports false', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readSavedView(broken)).toBeNull();
    expect(writeSavedView(broken, '3d')).toBe(false);
    expect(readSavedView(null)).toBeNull();
    expect(writeSavedView(null, '3d')).toBe(false);
  });
});
