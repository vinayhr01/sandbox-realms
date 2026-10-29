// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { dispatchKey, isTyping, KEYMAP, keyName, keyRows, panBlocked, shellKeysBlocked, type KeyContext } from '../../src/ui/shell/keymap.ts';

type Spies = { [K in keyof KeyContext]: ReturnType<typeof vi.fn> };

function context(recent: string[] = ['raise', 'lower']): Spies & KeyContext {
  return {
    recent: vi.fn(() => recent),
    arm: vi.fn(),
    toggleSheet: vi.fn(),
    focusSearch: vi.fn(),
    zoomBy: vi.fn(),
    togglePause: vi.fn(),
    toggleHud: vi.fn(),
    brushStep: vi.fn(),
  } as Spies & KeyContext;
}

function press(code: string, init: { target?: EventTarget | null; repeat?: boolean; ctrlKey?: boolean } = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { code, key: code, repeat: init.repeat ?? false, ctrlKey: init.ctrlKey ?? false });
  if (init.target !== undefined) Object.defineProperty(e, 'target', { value: init.target });
  return e;
}

describe('dispatchKey: each binding dispatches its action', () => {
  it('1 arms the first recent power, 3 the third', () => {
    const ctx = context(['raise', 'lower', 'rain']);
    expect(dispatchKey(press('Digit1'), ctx)).toBe(true);
    expect(ctx.arm).toHaveBeenLastCalledWith('raise');
    dispatchKey(press('Digit3'), ctx);
    expect(ctx.arm).toHaveBeenLastCalledWith('rain');
  });

  it('a digit with nothing in the recent row is not taken', () => {
    const ctx = context([]);
    expect(dispatchKey(press('Digit5'), ctx)).toBe(false);
    expect(ctx.arm).not.toHaveBeenCalled();
  });

  it('Q toggles the sheet, and does not toggle on auto-repeat', () => {
    const ctx = context();
    dispatchKey(press('KeyQ'), ctx);
    expect(ctx.toggleSheet).toHaveBeenCalledTimes(1);
    dispatchKey(press('KeyQ', { repeat: true }), ctx);
    expect(ctx.toggleSheet).toHaveBeenCalledTimes(1);
  });

  it('/ focuses the search', () => {
    const ctx = context();
    dispatchKey(press('Slash'), ctx);
    expect(ctx.focusSearch).toHaveBeenCalledTimes(1);
  });

  it('+ and - zoom in and out', () => {
    const ctx = context();
    dispatchKey(press('Equal'), ctx);
    dispatchKey(press('Minus'), ctx);
    expect(ctx.zoomBy).toHaveBeenNthCalledWith(1, 1.25);
    expect(ctx.zoomBy).toHaveBeenNthCalledWith(2, 0.8);
  });

  it('Space and P pause; H hides the interface; [ and ] step the brush', () => {
    const ctx = context();
    dispatchKey(press('Space'), ctx);
    dispatchKey(press('KeyP'), ctx);
    dispatchKey(press('KeyH'), ctx);
    dispatchKey(press('BracketLeft'), ctx);
    dispatchKey(press('BracketRight'), ctx);
    expect(ctx.togglePause).toHaveBeenCalledTimes(2);
    expect(ctx.toggleHud).toHaveBeenCalledTimes(1);
    expect(ctx.brushStep).toHaveBeenNthCalledWith(1, -1);
    expect(ctx.brushStep).toHaveBeenNthCalledWith(2, 1);
  });

  it('pan, Esc and the possession keys are left to main.ts', () => {
    const ctx = context();
    for (const code of ['ArrowLeft', 'KeyW', 'Escape', 'KeyJ', 'KeyK']) expect(dispatchKey(press(code), ctx)).toBe(false);
    expect(ctx.arm).not.toHaveBeenCalled();
    expect(ctx.zoomBy).not.toHaveBeenCalled();
    expect(ctx.togglePause).not.toHaveBeenCalled();
  });

  it('a modifier chord is not a shortcut', () => {
    const ctx = context();
    expect(dispatchKey(press('KeyQ', { ctrlKey: true }), ctx)).toBe(false);
    expect(ctx.toggleSheet).not.toHaveBeenCalled();
  });
});

describe('typing guard', () => {
  it('typing 1 in the sheet search does not arm a power', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctx = context();
    expect(isTyping(input)).toBe(true);
    expect(dispatchKey(press('Digit1', { target: input }), ctx)).toBe(false);
    expect(ctx.arm).not.toHaveBeenCalled();
    input.remove();
  });

  it('typing q does not toggle the sheet, and / does not focus the search', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    const ctx = context();
    dispatchKey(press('KeyQ', { target: area }), ctx);
    dispatchKey(press('Slash', { target: area }), ctx);
    expect(ctx.toggleSheet).not.toHaveBeenCalled();
    expect(ctx.focusSearch).not.toHaveBeenCalled();
    area.remove();
  });

  it('a map tap target is not typing', () => {
    expect(isTyping(document.body)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe('auto-repeat and the digits', () => {
  it('a held digit does not arm its power again on each repeat', () => {
    const ctx = context(['raise']);
    expect(dispatchKey(press('Digit1', { repeat: true }), ctx)).toBe(false);
    expect(ctx.arm).not.toHaveBeenCalled();
    expect(dispatchKey(press('Digit1'), ctx)).toBe(true);
    expect(ctx.arm).toHaveBeenCalledTimes(1);
  });
});

describe('shellKeysBlocked: the Atlas, dialogs and taken keys stand the shortcuts aside', () => {
  it('blocks every press while the Atlas is open', () => {
    expect(shellKeysBlocked(press('Digit1'), true)).toBe(true);
    expect(shellKeysBlocked(press('KeyQ'), true)).toBe(true);
    expect(shellKeysBlocked(press('KeyW'), true)).toBe(true);
  });

  it('blocks a press another control already took (preventDefault), and any open native dialog', () => {
    const taken = new KeyboardEvent('keydown', { code: 'ArrowLeft', cancelable: true });
    taken.preventDefault();
    expect(shellKeysBlocked(taken, false)).toBe(true);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    expect(shellKeysBlocked(press('KeyQ'), false)).toBe(true);
    dialog.remove();
  });

  it('lets the shell keys run with nothing open', () => {
    expect(shellKeysBlocked(press('Digit1'), false)).toBe(false);
  });
});

describe('panBlocked: arrows and WASD do not pan while focus is in a tab list, dialog or text field', () => {
  it('blocks a tab list, a dialog, a textbox and a text field', () => {
    const tablist = document.createElement('div');
    tablist.setAttribute('role', 'tablist');
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tablist.appendChild(tab);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.appendChild(button);
    const box = document.createElement('div');
    box.setAttribute('role', 'textbox');
    const input = document.createElement('input');
    for (const el of [tablist, dialog, box]) document.body.appendChild(el);
    expect(panBlocked(tab)).toBe(true);
    expect(panBlocked(button)).toBe(true);
    expect(panBlocked(box)).toBe(true);
    expect(panBlocked(input)).toBe(true);
    expect(panBlocked(document.body)).toBe(false);
    for (const el of [tablist, dialog, box]) el.remove();
  });
});

describe('the keys list', () => {
  it('contains every KEYMAP label, and the count equals KEYMAP.length', () => {
    const rows = keyRows();
    expect(rows).toHaveLength(KEYMAP.length);
    for (const binding of KEYMAP) expect(rows.map((r) => r.label)).toContain(binding.label);
  });

  it('zoom lists the main-row key and the numpad key by their real names', () => {
    expect(keyName('Equal')).toBe('=');
    expect(keyName('Minus')).toBe('-');
    expect(keyName('NumpadAdd')).toBe('numpad +');
    expect(keyName('NumpadSubtract')).toBe('numpad -');
    const rows = keyRows();
    expect(rows.find((r) => r.label.includes('zoom in'))?.keys).toBe('= numpad +');
    expect(rows.find((r) => r.label.includes('zoom out'))?.keys).toBe('- numpad -');
  });

  it('lists the F pin and the long-press pin', () => {
    const rows = keyRows();
    expect(rows.find((r) => r.keys === 'F')?.label).toContain('pin');
    expect(rows.find((r) => r.keys === 'Hold')?.label).toContain('pin');
  });
});
