/**
 * The one keymap (UX redesign, spec G). Every shortcut the player can use is listed here once. The Settings keys list and
 * the Keys window are generated from it, so they cannot drift from what the keys do.
 *
 * `dispatchKey` runs the bindings that the shell owns (recent powers, sheet, zoom, pause, interface, brush size). It
 * returns false for the rest, which main.ts keeps: pan (held keys), Esc (the Atlas layers come first), and the possession keys.
 * No binding fires while typing in a field, so a search can use any letter or digit.
 */

export type KeyAction =
  | 'arm-recent'
  | 'toggle-sheet'
  | 'focus-search'
  | 'pan'
  | 'zoom-in'
  | 'zoom-out'
  | 'pause'
  | 'hide-ui'
  | 'brush-smaller'
  | 'brush-larger'
  | 'escape'
  | 'possess';

export interface KeyBinding {
  /** `KeyboardEvent.code` values that trigger the binding. */
  keys: readonly string[];
  /** One line for the Settings keys list and the Keys window. */
  label: string;
  action: KeyAction;
  /** Never fires while typing. Every binding is false here; the field exists so the rule is visible in the data. */
  whenTyping?: false;
}

export const KEYMAP: readonly KeyBinding[] = [
  { keys: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'], label: '1 to 9: arm a recent power', action: 'arm-recent', whenTyping: false },
  { keys: ['KeyQ'], label: 'Q: open or close the power sheet', action: 'toggle-sheet', whenTyping: false },
  { keys: ['Slash'], label: '/: search the powers', action: 'focus-search', whenTyping: false },
  { keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'], label: 'Arrows or WASD: pan the map', action: 'pan' },
  { keys: ['Equal', 'NumpadAdd'], label: '+: zoom in', action: 'zoom-in', whenTyping: false },
  { keys: ['Minus', 'NumpadSubtract'], label: '-: zoom out', action: 'zoom-out', whenTyping: false },
  { keys: ['Space', 'KeyP'], label: 'Space or P: pause or resume', action: 'pause', whenTyping: false },
  { keys: ['KeyH'], label: 'H: hide or show the interface', action: 'hide-ui', whenTyping: false },
  { keys: ['BracketLeft'], label: '[: smaller brush', action: 'brush-smaller', whenTyping: false },
  { keys: ['BracketRight'], label: ']: larger brush', action: 'brush-larger', whenTyping: false },
  { keys: ['Escape'], label: 'Esc: close the top layer, or disarm the power', action: 'escape' },
  { keys: ['KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyT', 'KeyY', 'KeyN'], label: 'J K L U T Y N: possession controls', action: 'possess' },
];

/** The keys list as (keys, label) rows, for the Settings section and the Keys window. */
export function keyRows(): Array<{ keys: string; label: string }> {
  return KEYMAP.map((b) => ({ keys: b.keys.map(keyName).join(' '), label: b.label }));
}

/** A readable name for a `code`: Digit1 is 1, KeyQ is Q, BracketLeft is [. */
export function keyName(code: string): string {
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1] ?? code;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] ?? code;
  const named: Record<string, string> = { Slash: '/', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Space: 'Space', Escape: 'Esc' };
  return named[code] ?? code.replace(/^Arrow/, '');
}

/** True while focus is in a field that takes text, so a letter typed there is not a shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return true;
  return target.isContentEditable === true;
}

/**
 * True when the shell's shortcuts and the map pan stand aside for this press: the event was already taken (a tab list's
 * arrows, a control's own key), or the Atlas or a native dialog is open. Esc is not covered: the Atlas layers take it first.
 */
export function shellKeysBlocked(e: KeyboardEvent, atlasOpen: boolean): boolean {
  if (e.defaultPrevented || atlasOpen) return true;
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null;
}

/** Focus in a tab list, a dialog or a text field: its arrows and letters belong there, so the map does not pan. */
export function panBlocked(target: EventTarget | null): boolean {
  if (isTyping(target)) return true;
  return target instanceof Element && target.closest('[role="tablist"], [role="dialog"], dialog, [role="textbox"]') !== null;
}

/** The calls the shell keys make. main.ts supplies them; each one is the same call a click would make. */
export interface KeyContext {
  /** The recent row, in order: key 1 is the first entry. */
  recent(): readonly string[];
  arm(powerId: string): void;
  toggleSheet(): void;
  focusSearch(): void;
  zoomBy(factor: number): void;
  togglePause(): void;
  toggleHud(): void;
  brushStep(step: -1 | 1): void;
}

/** Zoom per key press (the same step as the zoom buttons). */
const KEY_ZOOM = 1.25;
/** Keys that repeat while held: zoom and brush size. */
const REPEATABLE: ReadonlySet<string> = new Set(['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'BracketLeft', 'BracketRight']);

/**
 * Runs the shell's shortcut for a key press. Returns true when it took the key (the caller then stops the event).
 * Modifier chords, repeats of toggles, and presses in a text field are left alone.
 */
export function dispatchKey(e: KeyboardEvent, ctx: KeyContext): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (isTyping(e.target)) return false;
  const code = e.code;
  // A focused button takes Space as its own click, so Space does not also pause.
  if (code === 'Space' && e.target instanceof HTMLElement && e.target.closest('button, [role="tab"], [role="button"]')) return false;
  // Toggles ignore auto-repeat, so a held key does not flip them back and forth. Zoom and brush steps repeat on purpose.
  // This check runs before the digits, so a held 1 does not arm and disarm its power over and over.
  if (e.repeat && !REPEATABLE.has(code)) return false;
  const digit = /^Digit([1-9])$/.exec(code);
  if (digit) {
    const id = ctx.recent()[Number(digit[1]) - 1];
    if (id === undefined) return false;
    ctx.arm(id);
    return true;
  }
  switch (code) {
    case 'KeyQ':
      ctx.toggleSheet();
      return true;
    case 'Slash':
      ctx.focusSearch();
      return true;
    case 'Equal':
    case 'NumpadAdd':
      ctx.zoomBy(KEY_ZOOM);
      return true;
    case 'Minus':
    case 'NumpadSubtract':
      ctx.zoomBy(1 / KEY_ZOOM);
      return true;
    case 'Space':
    case 'KeyP':
      ctx.togglePause();
      return true;
    case 'KeyH':
      ctx.toggleHud();
      return true;
    case 'BracketLeft':
      ctx.brushStep(-1);
      return true;
    case 'BracketRight':
      ctx.brushStep(1);
      return true;
    default:
      return false;
  }
}

/** Opens the sheet and moves focus to its search field once Preact has drawn it. */
export function focusSheetSearch(setExpanded: () => void): void {
  setExpanded();
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>('.power-sheet input[type="search"]')?.focus();
  });
}
