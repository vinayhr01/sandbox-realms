/**
 * Possession controls (07 section 13; keys and touch layout in DECISIONS.md "Possession controls close 14"). The key table, the
 * touch pad for the Being the Architect holds, and the names the sim flags use. The sim applies each order (beings/abilities.ts);
 * this module only names the actions. Attack is held (key or button down, sent as the order's attack flag). The six abilities
 * are one shot per press. A tap on the ground still moves the held Being.
 */

/** The six one-shot abilities of 07 section 13 (the Cmd.Possess flags, src/shared/protocol.ts). */
export type PossessAbility = 'kick' | 'jump' | 'dash' | 'talk' | 'steal' | 'swear';

/** Every possession control: attack (held) and the six abilities. Release is Esc on the keyboard and its own touch button. */
export type PossessAction = 'attack' | PossessAbility;

/** Controls in pad order. */
export const POSSESS_ACTION_ORDER: readonly PossessAction[] = ['attack', 'kick', 'jump', 'dash', 'talk', 'steal', 'swear'];

/** Default keys, by `KeyboardEvent.code` (layout independent). None is used by the spec table (13 section 10) or by the app. */
export const POSSESS_KEYS: Readonly<Record<PossessAction, string>> = {
  attack: 'KeyJ',
  kick: 'KeyK',
  jump: 'KeyL',
  dash: 'KeyU',
  talk: 'KeyT',
  steal: 'KeyY',
  swear: 'KeyN',
};

/** Labels on the touch pad and in the key hints. */
export const POSSESS_LABELS: Readonly<Record<PossessAction, string>> = {
  attack: 'Attack',
  kick: 'Kick',
  jump: 'Jump',
  dash: 'Dash',
  talk: 'Talk',
  steal: 'Steal',
  swear: 'Swear',
};

/** The control bound to a key code, or null when the code is not a possession key. */
export function possessActionOfCode(code: string): PossessAction | null {
  for (const action of POSSESS_ACTION_ORDER) {
    if (POSSESS_KEYS[action] === code) return action;
  }
  return null;
}

export interface PossessPadHandlers {
  /** An ability button was pressed (one shot). */
  onAbility(ability: PossessAbility): void;
  /** The attack button went down (true) or came up, or lost its pointer (false). */
  onAttack(held: boolean): void;
  /** The release button was pressed. */
  onRelease(): void;
}

export interface PossessPad {
  /** Shows the pad while a Being is held; hidden otherwise. */
  setVisible(on: boolean): void;
}

/**
 * Builds the touch pad inside `host` (the map), hidden until `setVisible(true)`. Buttons are at least one touch target
 * (`--tap`, 13 section 9). Pointer events are used so attack can be held and so touch and mouse behave alike.
 */
export function mountPossessPad(host: HTMLElement, handlers: PossessPadHandlers): PossessPad {
  const pad = document.createElement('div');
  pad.className = 'possess-pad';
  pad.hidden = true;
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Possession controls');

  for (const action of POSSESS_ACTION_ORDER) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn possess-btn';
    btn.dataset['action'] = action;
    btn.textContent = POSSESS_LABELS[action];
    btn.title = action === 'attack' ? 'Attack (hold J)' : `${POSSESS_LABELS[action]} (${POSSESS_KEYS[action].replace('Key', '')})`;
    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      if (action === 'attack') {
        btn.setPointerCapture(e.pointerId);
        handlers.onAttack(true);
      } else {
        handlers.onAbility(action);
      }
    });
    if (action === 'attack') {
      const up = (): void => handlers.onAttack(false);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    }
    pad.appendChild(btn);
  }

  const release = document.createElement('button');
  release.type = 'button';
  release.className = 'btn possess-btn';
  release.dataset['action'] = 'release';
  release.textContent = 'Release';
  release.title = 'Release the Being (Esc)';
  release.addEventListener('click', () => handlers.onRelease());
  pad.appendChild(release);

  host.appendChild(pad);
  return {
    setVisible(on: boolean): void {
      pad.hidden = !on;
    },
  };
}
