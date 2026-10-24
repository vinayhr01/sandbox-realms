/**
 * Content of each window the UI opens (13 section 7.1). Each builder fills a body element; the
 * window host shows it. All state comes in through WindowDeps, so the windows hold no game state.
 */
import { POWERS, type PowerDef } from '../content/powers.ts';
import { AGES } from '../sim/ages.ts';
import { RULES, RuleSet, ageRuleId, type RuleDef } from '../sim/rules.ts';
import type { BrushShape, Command, Snapshot } from '../shared/protocol.ts';
import { buildList } from './listView.ts';
import { detailWindowFor } from './detailWindows.ts';
import { staticWindowFor } from './staticWindows.ts';
import { GROUP_LABELS, SETTINGS, boolOption, resetGroup, type OptionGroup, type OptionValue, type Options, type SettingDef } from './panels/options.ts';
import { TUTORIAL_TEXT, TUTORIAL_STEPS, type TutorialState } from './panels/tutorial.ts';
import { powerStatus } from './powerSupport.ts';
import { snapshotWindowFor } from './snapshotWindows.ts';
import { specWindowFor } from './specWindows.ts';
import { systemWindowFor } from './systemWindows.ts';
import { windowTitle } from './windowCatalog.ts';

/** One saved realm as the Chronicle window shows it (a read-only view of the save store). */
export interface SaveSlotView {
  slotId: string;
  kind: 'manual' | 'quick' | 'auto' | 'suspend';
  realmName: string;
  year: number;
  byteSize: number;
  savedAtMs: number;
  valid: boolean | 'unknown';
}

/** Result of a Chronicle action, shown in the window. */
export interface ChronicleOutcome {
  ok: boolean;
  message: string;
}

/** Save, load, export and import for the Chronicle window (src/app/save-controller.ts). */
export interface ChronicleActions {
  /** Why saving the live realm is unavailable, or null when it works. */
  readonly saveBlocked: string | null;
  /** Why loading a realm is unavailable, or null when it works. */
  readonly loadBlocked: string | null;
  storage(): Promise<{ mode: 'indexeddb' | 'memory'; fallbackReason: string | null }>;
  /** 'new' saves into the first free manual slot; 'quick' ignores the slot id. */
  run(action: 'save' | 'quick' | 'load' | 'delete', slotId: string): Promise<ChronicleOutcome>;
  exportSave(slotId: string): Promise<ChronicleOutcome>;
  importFile(file: File): Promise<ChronicleOutcome>;
}

/** A command without its sequence number (the sim client adds it). */
export type CommandDraft = Command extends infer C ? (C extends { seq: number } ? Omit<C, 'seq'> : never) : never;

export interface WindowDeps {
  /** Sends a player command to the sim (item and gear editors). Absent in tests: the controls then do nothing. */
  sendCommand?: (command: CommandDraft) => void;
  options(): Options;
  setOption(id: string, value: OptionValue): void;
  rules: RuleSet;
  /** Sets a rule on the mirror and in the sim. Returns false when the rule cannot change. */
  setRule(id: string, on: boolean): boolean;
  realm(): { seed: number; side: number; calendar: string };
  newRealm(seed: number, sizeStep: number): void;
  activate(power: PowerDef): void;
  tutorial(): { state: TutorialState; restart(): void; skip(): void };
  /** Saved realms on this device, newest first. Rejects when the store cannot be read. */
  saves(): Promise<SaveSlotView[]>;
  /** Save actions for the Chronicle window. Absent in tests: the window then only lists saves. */
  chronicle?: ChronicleActions;
  /** Latest sim snapshot, or null before the first one. Optional: windows that need it show "Reading the realm". */
  snapshot?: () => Snapshot | null;
  close(): void;
  /** Opens another window (list rows, inspector actions, Back buttons). */
  open(id: string, params?: WindowParams): void;
  /** Brush shape, size index and the radius each index means (the Terrain panel's controls). */
  brush(): BrushState;
  setBrush(patch: { shape?: BrushShape; sizeIndex?: number }): void;
}

/** Row or object an inspector window is about: a dominion, creed, strain... id, or a list index. */
export interface WindowParams {
  id?: number;
  /** Which kind of object an editor is about (for example 'strain' for the trait editor). */
  kind?: string;
  /** Chronicle confirmation: 'save', 'load' or 'delete'. */
  action?: string;
  /** Chronicle confirmation: a label for the save the action is about (its name and kind). */
  slot?: string;
  /** Error window: the reason to show. */
  message?: string;
  /** Chronicle confirmation and window: the save the action is about (a slot id). */
  slotId?: string;
  /** Chronicle window: the outcome of the last action, shown once. */
  notice?: string;
}

export interface BrushState {
  shape: BrushShape;
  sizeIndex: number;
  radii: readonly number[];
}

export interface WindowBuild {
  title: string;
  build: (body: HTMLElement) => void;
  /** Re-renders from the latest snapshot. Set only on windows that read the sim (13 section 7). */
  live?: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const humanize = (id: string): string => {
  const words = id.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Experimental rules (13 section 15, game.experimentalRules). */
const EXPERIMENTAL_RULES: ReadonlySet<string> = new Set(['uplift_beasts', 'chaotic_minds', 'open_knowledge']);

/** One settings control. Bool is a checkbox, int a range with its value shown, choice a select. */
function settingControl(def: SettingDef, value: OptionValue, onChange: (v: OptionValue) => void): HTMLElement {
  const note = def.live ? '' : ' (saved; not active yet)';
  if (def.kind === 'bool') {
    const row = el('label', 'option option-check');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = value === true;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(input, el('span', undefined, def.label + note));
    return row;
  }
  if (def.kind === 'int') {
    const wrap = el('div', 'option');
    const head = el('span', undefined, def.label);
    const out = el('output', undefined, String(value));
    const input = el('input');
    input.type = 'range';
    input.min = String(def.min ?? 0);
    input.max = String(def.max ?? 100);
    input.step = String(((def.max ?? 100) - (def.min ?? 0)) >= 50 ? 5 : 1);
    input.value = String(value);
    input.setAttribute('aria-label', def.label);
    input.addEventListener('input', () => {
      out.textContent = input.value;
      onChange(Number(input.value));
    });
    head.append(' ', out);
    if (note) head.append(el('span', 'option-note', note));
    wrap.append(head, input);
    return wrap;
  }
  const wrap = el('label', 'option');
  const label = el('span', undefined, def.label);
  if (note) label.append(el('span', 'option-note', note));
  const select = el('select');
  for (const choice of def.choices ?? []) {
    const opt = el('option', undefined, String(choice === 0 && def.id === 'ui.fpsCap' ? 'display rate' : choice));
    opt.value = String(choice);
    opt.selected = choice === value;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    const picked = (def.choices ?? []).find((c) => String(c) === select.value);
    if (picked !== undefined) onChange(picked);
  });
  wrap.append(label, select);
  return wrap;
}

/** Settings controls. `ids` limits the list to some settings; otherwise every group is shown with a reset. */
function settingsBody(body: HTMLElement, deps: WindowDeps, ids?: readonly string[], redraw?: () => void): void {
  const apply = (id: string, value: OptionValue): void => deps.setOption(id, value);
  if (ids) {
    for (const s of SETTINGS.filter((x) => ids.includes(x.id))) {
      body.append(settingControl(s, deps.options()[s.id] ?? s.def, (v) => apply(s.id, v)));
    }
    return;
  }
  for (const group of Object.keys(GROUP_LABELS) as OptionGroup[]) {
    const fieldset = el('fieldset', 'settings-group');
    fieldset.append(el('legend', undefined, GROUP_LABELS[group]));
    for (const s of SETTINGS.filter((x) => x.group === group)) {
      fieldset.append(settingControl(s, deps.options()[s.id] ?? s.def, (v) => apply(s.id, v)));
    }
    const reset = el('button', 'btn', `Reset ${GROUP_LABELS[group]}`);
    reset.type = 'button';
    reset.addEventListener('click', () => {
      const next = resetGroup(deps.options(), group);
      for (const s of SETTINGS) if (s.group === group) deps.setOption(s.id, next[s.id] ?? s.def);
      redraw?.();
    });
    fieldset.append(reset);
    body.append(fieldset);
  }
}

function buildSettings(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_settings'),
    build: (body) => {
      const groups = el('div', 'settings-groups');
      const redraw = (): void => {
        groups.replaceChildren();
        settingsBody(groups, deps, undefined, redraw);
      };
      redraw();
      body.append(groups);
      const resetAll = el('button', 'btn', 'Reset all settings');
      resetAll.type = 'button';
      resetAll.addEventListener('click', () => {
        for (const s of SETTINGS) deps.setOption(s.id, s.def);
        redraw();
      });
      body.append(resetAll);
      const done = el('button', 'btn primary', 'Done');
      done.type = 'button';
      done.addEventListener('click', () => deps.close());
      body.append(done);
    },
  };
}

function buildRules(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_rules'),
    build: (body) => {
      const showExperimental = boolOption(deps.options(), 'game.experimentalRules');
      const items = RULES.filter((r) => showExperimental || !EXPERIMENTAL_RULES.has(r.id));
      const note = el('p', 'option-note', 'Rules change the running realm. Some rules cannot be switched off once on.');
      body.append(note);
      let handle: { refresh(): void } | null = null;
      handle = buildList<RuleDef>(body, {
        name: 'Realm rules',
        items,
        rowHeight: 64,
        label: (r) => humanize(r.id),
        sorts: [
          { key: 'group', label: 'Group' },
          { key: 'id', label: 'Name' },
        ],
        filters: [
          { id: 'all', label: 'All', test: () => true },
          { id: 'on', label: 'On', test: (r) => deps.rules.isOn(r.id) },
          { id: 'off', label: 'Off', test: (r) => !deps.rules.isOn(r.id) },
        ],
        empty: 'No rules match.',
        render: (rule) => {
          const row = el('div', 'rule-row');
          const text = el('div', 'rule-text');
          const name = el('strong', undefined, humanize(rule.id) + (EXPERIMENTAL_RULES.has(rule.id) ? ' (experimental)' : ''));
          text.append(name, el('span', 'option-note', rule.effect));
          const sw = el('button', 'switch');
          sw.type = 'button';
          sw.setAttribute('role', 'switch');
          sw.setAttribute('aria-label', humanize(rule.id));
          const on = deps.rules.isOn(rule.id);
          sw.setAttribute('aria-checked', String(on));
          sw.textContent = on ? 'On' : 'Off';
          sw.disabled = !rule.canDisable && on;
          sw.addEventListener('click', () => {
            deps.setRule(rule.id, !deps.rules.isOn(rule.id));
            handle?.refresh();
          });
          row.append(text, sw);
          return row;
        },
      });
    },
  };
}

function buildAges(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_ages'),
    build: (body) => {
      body.append(el('p', 'option-note', 'Turn an age off to keep it out of the rotation.'));
      buildList(body, {
        name: 'Ages',
        items: AGES,
        rowHeight: 56,
        label: (a) => a.name,
        sorts: [{ key: 'yearsMin', label: 'Years' }],
        empty: 'No ages.',
        render: (age) => {
          const row = el('div', 'rule-row');
          const text = el('div', 'rule-text');
          text.append(el('strong', undefined, age.name), el('span', 'option-note', `${age.yearsMin} to ${age.yearsMax} years`));
          const rule = ageRuleId(age.id);
          const sw = el('button', 'switch');
          sw.type = 'button';
          sw.setAttribute('role', 'switch');
          sw.setAttribute('aria-label', age.name);
          const on = deps.rules.isOn(rule);
          sw.setAttribute('aria-checked', String(on));
          sw.textContent = on ? 'On' : 'Off';
          sw.addEventListener('click', () => {
            deps.setRule(rule, !deps.rules.isOn(rule));
            sw.setAttribute('aria-checked', String(deps.rules.isOn(rule)));
            sw.textContent = deps.rules.isOn(rule) ? 'On' : 'Off';
          });
          row.append(text, sw);
          return row;
        },
      });
    },
  };
}

function buildRealm(deps: WindowDeps): WindowBuild {
  let section: HTMLElement | null = null;
  let lastKey = '';
  const draw = (): void => {
    if (section === null) return;
    const snap = deps.snapshot?.() ?? null;
    const notable = snap?.detail?.notable;
    // Redraw only when the list changes, so its buttons keep keyboard focus between snapshots.
    const key = snap === null ? 'loading' : `${notable?.beingCount ?? 0}:${(notable?.beings ?? []).map((b) => b.id).join(',')}`;
    if (key === lastKey) return;
    lastKey = key;
    section.replaceChildren();
    section.append(el('h3', undefined, 'Interesting people'));
    if (snap === null) {
      section.append(el('p', 'option-note', 'Reading the realm...'));
      return;
    }
    if (!notable || notable.beings.length === 0) {
      section.append(el('p', 'option-note', 'No beings are alive.'));
      return;
    }
    const cut = notable.beingCount > notable.beings.length;
    section.append(el('p', 'option-note', cut ? `The oldest ${notable.beings.length} of ${notable.beingCount} beings.` : `${notable.beingCount} beings, oldest first.`));
    const list = el('div', 'list-chips');
    for (const b of notable.beings) {
      const btn = el('button', 'btn list-chip', `${b.species} ${b.id}`);
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.addEventListener('click', () => deps.open('win_being', { id: b.id }));
      list.append(btn);
    }
    section.append(list);
  };
  return {
    title: windowTitle('win_realm'),
    build: (body) => {
      const r = deps.realm();
      const on = RULES.filter((x) => deps.rules.isOn(x.id)).length;
      const list = el('dl', 'facts');
      const rows: Array<[string, string]> = [
        ['Name', `Realm ${r.seed.toString(36).toUpperCase().slice(-6)}`],
        ['Seed', String(r.seed)],
        ['Size', `${r.side} x ${r.side} tiles`],
        ['Calendar', r.calendar],
        ['Rules on', `${on} of ${RULES.length}`],
      ];
      for (const [k, v] of rows) list.append(el('dt', undefined, k), el('dd', undefined, v));
      body.append(list);
      section = el('div', 'snapshot-section');
      body.append(section);
      draw();
    },
    live: draw,
  };
}

function buildKeys(): WindowBuild {
  return {
    title: windowTitle('win_keys'),
    build: (body) => {
      const list = el('dl', 'facts');
      const rows: Array<[string, string]> = [
        ['Tap the map', 'Inspect a tile, or apply the armed power'],
        ['Drag the map', 'Paint with Raise, Lower or a brush power; otherwise pan'],
        ['Wheel or pinch', 'Zoom'],
        ['Arrow keys or WASD', 'Pan'],
        ['P', 'Pause or resume'],
        ['[ and ]', 'Smaller or larger brush'],
        ['Esc', 'Disarm the power, or close a window'],
        ['H', 'Hide or show the interface'],
      ];
      for (const [k, v] of rows) list.append(el('dt', undefined, k), el('dd', undefined, v));
      body.append(list);
    },
  };
}

function buildPrivacy(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_privacy'),
    build: (body) => {
      body.append(el('p', 'option-note', 'Both are off. This build sends no data; the switches only record your choice.'));
      settingsBody(body, deps, ['privacy.telemetry', 'privacy.errorReports']);
    },
  };
}

function buildNewRealm(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_new_realm'),
    build: (body) => {
      const seedLabel = el('label', 'option');
      const seed = el('input');
      seed.type = 'number';
      seed.min = '0';
      seed.max = '2147483647';
      seed.step = '1';
      seed.value = String(deps.realm().seed);
      seedLabel.append(el('span', undefined, 'Seed'), seed);
      const sizeLabel = el('label', 'option');
      const size = el('select');
      for (const [value, text] of [
        ['3', 'Small (192)'],
        ['4', 'Standard (256)'],
        ['5', 'Large (320)'],
      ] as const) {
        const opt = el('option', undefined, text);
        opt.value = value;
        opt.selected = value === '4';
        size.append(opt);
      }
      sizeLabel.append(el('span', undefined, 'Size'), size);
      const create = el('button', 'btn primary', 'Create realm');
      create.type = 'button';
      // With game.confirmQuit on, the first tap asks; the second tap leaves the current realm.
      let armed = false;
      create.addEventListener('click', () => {
        if (boolOption(deps.options(), 'game.confirmQuit') && !armed) {
          armed = true;
          create.textContent = 'Confirm: leave this realm';
          return;
        }
        const n = Math.floor(Number(seed.value));
        deps.newRealm(Number.isFinite(n) && n >= 0 ? n : Math.floor(Math.random() * 0x7fffffff), Number(size.value));
        deps.close();
      });
      if (boolOption(deps.options(), 'game.confirmQuit')) {
        body.append(el('p', 'option-note', 'Creating a realm ends the current one. Tap again to confirm.'));
      }
      body.append(seedLabel, sizeLabel, create);
    },
  };
}

function buildTutorial(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_tutorial'),
    build: (body) => {
      const { state } = deps.tutorial();
      const status = state.done ? 'Finished' : state.skipped ? 'Skipped' : 'In progress';
      body.append(el('p', 'option-note', `Status: ${status}`));
      const list = el('ol', 'tutorial-steps');
      TUTORIAL_STEPS.forEach((step, i) => {
        const item = el('li', undefined, TUTORIAL_TEXT[step.id] ?? step.id);
        if (i < state.index) item.dataset['state'] = 'done';
        else if (i === state.index && !state.done && !state.skipped) item.dataset['state'] = 'current';
        list.append(item);
      });
      body.append(list);
      const restart = el('button', 'btn', 'Restart tutorial');
      restart.type = 'button';
      restart.addEventListener('click', () => deps.tutorial().restart());
      const skip = el('button', 'btn', 'Skip tutorial');
      skip.type = 'button';
      skip.disabled = state.done || state.skipped;
      skip.addEventListener('click', () => deps.tutorial().skip());
      body.append(restart, skip);
    },
  };
}

function buildPowerCatalogue(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_power_catalogue'),
    build: (body) => {
      body.append(el('p', 'option-note', 'Powers marked not available have no working effect yet. Tap an available one to use it.'));
      buildList<PowerDef>(body, {
        name: 'Powers',
        items: POWERS,
        rowHeight: 56,
        label: (p) => p.name,
        sorts: [
          { key: 'tab', label: 'Tab' },
          { key: 'name', label: 'Name' },
        ],
        filters: [
          { id: 'all', label: 'All', test: () => true },
          { id: 'available', label: 'Available', test: (p) => powerStatus(p).enabled },
        ],
        empty: 'No powers match.',
        render: (power) => {
          const status = powerStatus(power);
          const row = el('button', 'rule-row power-row');
          row.type = 'button';
          row.disabled = !status.enabled;
          const text = el('div', 'rule-text');
          text.append(el('strong', undefined, power.name), el('span', 'option-note', `${power.tab} tab${status.enabled ? '' : ' · not available yet'}`));
          row.append(text);
          row.addEventListener('click', () => {
            deps.close();
            deps.activate(power);
          });
          return row;
        },
      });
    },
  };
}

const HELP_TOPICS: ReadonlyArray<[string, string]> = [
  ['Map', 'Tap a tile to inspect it. Drag to pan, or paint when a brush power is armed. Wheel or pinch to zoom.'],
  ['Powers', 'Pick a tab in the bottom bar and tap a power to arm it, then tap the map. Powers marked not available have no effect yet.'],
  ['Speed', 'Pause with the button or P. The x0.5 to x10 buttons set the simulation speed.'],
  ['Rules and ages', 'Realm Rules change the running realm. Turning an age off keeps it out of the rotation.'],
  ['Settings', 'Changes apply at once. Settings marked saved; not active yet are kept but have no effect yet.'],
  ['New realm', 'Creates a world from a seed and a size. This ends the current realm.'],
  ['Chronicle', 'Lists the realms saved on this device.'],
  ['Privacy', 'This build sends no data. The privacy switches only record your choice.'],
];

function buildHelp(): WindowBuild {
  return {
    title: windowTitle('win_help'),
    build: (body) => {
      const list = el('dl', 'facts');
      for (const [k, v] of HELP_TOPICS) list.append(el('dt', undefined, k), el('dd', undefined, v));
      body.append(list);
    },
  };
}

const SAVE_KIND: Readonly<Record<SaveSlotView['kind'], string>> = {
  manual: 'Slot',
  quick: 'Quick save',
  auto: 'Autosave',
  suspend: 'Suspended',
};

function buttonEl(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const btn = el('button', className, label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

function buildChronicle(deps: WindowDeps, params: WindowParams): WindowBuild {
  const actions = deps.chronicle;
  return {
    title: windowTitle('win_chronicle'),
    build: (body) => {
      body.append(el('p', 'option-note', 'Realms saved on this device.'));
      const status = el('p', 'option-note', params.notice ?? '');
      status.setAttribute('role', 'status');
      body.append(status);

      // Reports an action's outcome in this window, then rebuilds the window so the list is current.
      const report = (task: Promise<ChronicleOutcome>): void => {
        status.textContent = 'Working...';
        void task.then((out) => {
          if (!status.isConnected) return;
          deps.open('win_chronicle', { notice: out.message });
        });
      };

      if (actions) {
        if (actions.saveBlocked !== null) body.append(el('p', 'option-note', actions.saveBlocked));
        if (actions.loadBlocked !== null) body.append(el('p', 'option-note', actions.loadBlocked));
        const storageNote = el('p', 'option-note');
        void actions.storage().then((s) => {
          if (storageNote.isConnected && s.mode === 'memory') {
            storageNote.textContent = `Saving to this device is unavailable (${s.fallbackReason ?? 'unknown reason'}). Saves last only this visit.`;
          }
        });
        body.append(storageNote);

        const toolbar = el('div', 'row-actions chronicle-tools');
        toolbar.setAttribute('role', 'group');
        toolbar.setAttribute('aria-label', 'Save actions');
        const saveNew = buttonEl('Save to a new slot', () => report(actions.run('save', 'new')));
        saveNew.disabled = actions.saveBlocked !== null;
        const quick = buttonEl('Quick save', () => report(actions.run('quick', 'quick')));
        quick.disabled = actions.saveBlocked !== null;
        const importInput = el('input', 'chronicle-import');
        importInput.type = 'file';
        importInput.accept = '.realm,application/octet-stream';
        importInput.setAttribute('aria-label', 'Import a realm file (.realm)');
        importInput.addEventListener('change', () => {
          const file = importInput.files?.[0];
          importInput.value = '';
          if (file) report(actions.importFile(file));
        });
        toolbar.append(saveNew, quick, importInput);
        body.append(toolbar);
      } else {
        body.append(el('p', 'option-note', 'Saving from this window is not available here.'));
      }

      const listStatus = el('p', 'option-note', 'Loading saved realms...');
      listStatus.setAttribute('role', 'status');
      body.append(listStatus);
      deps.saves().then(
        (slots) => {
          // The window may have closed or changed while the store answered.
          if (!listStatus.isConnected) return;
          listStatus.remove();
          buildList<SaveSlotView>(body, {
            name: 'Saved realms',
            items: slots,
            rowHeight: 112,
            label: (s) => `${s.realmName} ${SAVE_KIND[s.kind]}`,
            sorts: [
              { key: 'savedAtMs', label: 'Saved' },
              { key: 'year', label: 'Year' },
            ],
            empty: 'No saved realms on this device yet.',
            render: (s) => {
              const row = el('div', 'rule-row chronicle-row');
              const text = el('div', 'rule-text');
              const when = new Date(s.savedAtMs).toLocaleString();
              const size = `${Math.max(1, Math.round(s.byteSize / 1024))} KB`;
              text.append(el('strong', undefined, s.realmName), el('span', 'option-note', `${SAVE_KIND[s.kind]} · year ${s.year} · ${size} · ${when}`));
              const label = `${s.realmName}, ${SAVE_KIND[s.kind].toLowerCase()}`;
              const actionsEl = el('div', 'row-actions');
              for (const action of ['load', 'delete'] as const) {
                const verb = action === 'load' ? 'Load' : 'Delete';
                const btn = el('button', 'btn', verb);
                btn.type = 'button';
                btn.setAttribute('aria-label', `${verb} ${label}`);
                btn.addEventListener('click', () => deps.open('win_chronicle_confirm', { action, slot: label, slotId: s.slotId }));
                actionsEl.append(btn);
              }
              if (actions) {
                const exp = buttonEl('Export', () => report(actions.exportSave(s.slotId)));
                exp.setAttribute('aria-label', `Export ${label}`);
                actionsEl.append(exp);
              }
              row.append(text, actionsEl);
              return row;
            },
          });
        },
        () => {
          if (listStatus.isConnected) listStatus.textContent = 'Saved realms could not be read on this device.';
        },
      );
    },
  };
}

/** The window for `id`, or null when the UI does not build it yet. */
export function windowFor(id: string, deps: WindowDeps, params: WindowParams = {}): WindowBuild | null {
  switch (id) {
    case 'win_settings':
      return buildSettings(deps);
    case 'win_rules':
      return buildRules(deps);
    case 'win_ages':
      return buildAges(deps);
    case 'win_realm':
      return buildRealm(deps);
    case 'win_keys':
      return buildKeys();
    case 'win_privacy':
      return buildPrivacy(deps);
    case 'win_new_realm':
      return buildNewRealm(deps);
    case 'win_tutorial':
      return buildTutorial(deps);
    case 'win_power_catalogue':
      return buildPowerCatalogue(deps);
    case 'win_help':
      return buildHelp();
    case 'win_chronicle':
      return buildChronicle(deps, params);
    default:
      return (
        snapshotWindowFor(id, deps) ??
        detailWindowFor(id, deps, params) ??
        staticWindowFor(id, deps) ??
        specWindowFor(id, deps, params) ??
        systemWindowFor(id, deps, params)
      );
  }
}

