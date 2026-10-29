import { describe, expect, it } from 'vitest';
import { TOAST_MS, createStore, pruneToasts, pushToast } from '../../src/ui/shell/store.ts';

describe('shell store', () => {
  it('starts collapsed with the Atlas closed and the three first chips discovered', () => {
    const store = createStore();
    expect(store.sheet.value).toBe('collapsed');
    expect(store.atlas.value.open).toBe(false);
    expect(store.discovered.value).toEqual(['land', 'nature', 'creatures']);
    expect(store.toasts.value).toEqual([]);
  });

  it('pushToast appends, and toasts expire once TOAST_MS has passed', () => {
    const store = createStore();
    expect(TOAST_MS).toBe(3000);
    pushToast(store, 'First town', 'new', 1000);
    pushToast(store, 'Rain falls');
    expect(store.toasts.value.map((t) => t.text)).toEqual(['First town', 'Rain falls']);
    expect(store.toasts.value[0]?.kind).toBe('new');
    expect(store.toasts.value[1]?.kind).toBe('info');

    expect(pruneToasts(store, 3999)).toBe(false);
    expect(store.toasts.value.length).toBe(2);

    expect(pruneToasts(store, 4000)).toBe(true);
    expect(store.toasts.value.map((t) => t.text)).toEqual(['Rain falls']);
  });
});
