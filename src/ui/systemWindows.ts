/**
 * System windows (13 section 7.1): the Chronicle confirmation, patch notes, error, update and quit
 * confirmation windows, and the developer console and tools (14 sections 8 and 9). Patch notes and
 * update text are static. The error window shows the reason it was opened with. The developer windows
 * need the Developer tools setting (`dev.enabled`), which is off by default; without it they only say so.
 */
import { ACHIEVEMENTS } from '../content/achievements.ts';
import { BEING_TRAITS, STRAIN_TRAITS } from '../content/traits.ts';
import { POWERS } from '../content/powers.ts';
import { SPECIES } from '../content/beasts.ts';
import { AGES } from '../sim/ages.ts';
import { RULES } from '../sim/rules.ts';
import { BUILDINGS } from '../sim/settlements/catalogue.ts';
import type { Snapshot } from '../shared/protocol.ts';
import { buildList } from './listView.ts';
import { realmHistory } from './realm-history.ts';
import { SETTINGS, boolOption } from './panels/options.ts';
import { capLog, runConsoleCommand, type ConsoleContext } from './spec-model.ts';
import { windowTitle } from './windowCatalog.ts';
import type { WindowBuild, WindowDeps, WindowParams } from './windowContent.ts';

/** Build version shown in the error, patch notes and console windows (package.json version). */
export const APP_VERSION = '1.0.0';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const note = (text: string): HTMLElement => el('p', 'option-note', text);

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const btn = el('button', primary ? 'btn primary' : 'btn', label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

/** A control the build cannot run yet. The window says why in its text, so the button stays plain. */
function disabledButton(label: string): HTMLButtonElement {
  const btn = button(label, () => undefined);
  btn.disabled = true;
  return btn;
}

function factsList(rows: readonly [string, string][]): HTMLElement {
  const dl = el('dl', 'facts');
  for (const [k, v] of rows) dl.append(el('dt', undefined, k), el('dd', undefined, v));
  return dl;
}

// Chronicle confirmation -------------------------------------------------------------------------

const CONFIRM_VERB: Readonly<Record<string, string>> = { save: 'Save over', load: 'Load', delete: 'Delete' };

function chronicleConfirmWindow(deps: WindowDeps, params: WindowParams): WindowBuild {
  const action = params.action ?? '';
  const verb = CONFIRM_VERB[action];
  const slot = params.slot ?? 'this save';
  return {
    title: windowTitle('win_chronicle_confirm'),
    build: (body) => {
      if (verb === undefined) {
        body.append(note('Nothing to confirm.'));
      } else {
        body.append(el('p', undefined, `${verb} ${slot}?`));
        body.append(note('Saving, loading and deleting saves are not available yet, so this cannot be confirmed.'));
        body.append(disabledButton(verb));
      }
      body.append(button('Back to Chronicle', () => deps.open('win_chronicle')));
    },
  };
}

// Patch notes ------------------------------------------------------------------------------------

const PATCH_NOTES: ReadonlyArray<{ version: string; items: readonly string[] }> = [
  {
    version: `${APP_VERSION} (this build)`,
    items: [
      'The realm runs in a sim worker; the screen shows what the worker sends.',
      'Windows for the realm overview, lists and inspectors of dominions, hamlets, campaigns, creeds, customs, dialects, families, intrigues and strains.',
      'Windows for beings, structures, armies, banner editors, compare, annals, trait rain and trait editors, and this window set.',
      'Developer console and developer tools, behind the Developer tools setting (off by default).',
      'Not in this build yet: items, pacts, clans, an event log, and saving or loading from the Chronicle window.',
    ],
  },
];

function patchNotesWindow(): WindowBuild {
  return {
    title: windowTitle('win_patch_notes'),
    build: (body) => {
      for (const release of PATCH_NOTES) {
        body.append(el('h3', undefined, release.version));
        const ul = el('ul', 'snapshot-bars');
        for (const item of release.items) ul.append(el('li', undefined, item));
        body.append(ul);
      }
    },
  };
}

// Error ------------------------------------------------------------------------------------------

function errorWindow(deps: WindowDeps, params: WindowParams): WindowBuild {
  const reason = params.message && params.message.length > 0 ? params.message : 'No reason was given with this window.';
  return {
    title: windowTitle('win_error'),
    build: (body) => {
      body.append(el('h3', undefined, 'Something went wrong'));
      body.append(note(reason));
      const status = note('');
      status.setAttribute('role', 'status');
      const copy = button('Copy details', () => {
        const snap = deps.snapshot?.() ?? null;
        const text = [`Sandbox Realms ${APP_VERSION}`, `Tick ${snap?.tick ?? 'unknown'}`, `Reason: ${reason}`].join('\n');
        const clip = navigator.clipboard;
        if (!clip) {
          status.textContent = 'Copying is not available in this browser.';
          return;
        }
        clip.writeText(text).then(
          () => {
            status.textContent = 'Details copied.';
          },
          () => {
            status.textContent = 'Could not copy the details.';
          },
        );
      });
      body.append(copy, status);
      body.append(disabledButton('Send report'));
      body.append(note('Reports are off. Error reports are opt-in under Settings, Privacy, and no report service exists yet.'));
      body.append(button('Close', () => deps.close(), true));
    },
  };
}

// Update -----------------------------------------------------------------------------------------

function updateWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_update'),
    build: (body) => {
      body.append(note('This build does not check for new versions, so no update is known.'));
      body.append(note('Reloading starts the game again. The realm is not saved yet, so unsaved progress is lost.'));
      body.append(button('Reload the game', () => window.location.reload(), true));
      body.append(button('Not now', () => deps.close()));
    },
  };
}

// Quit confirmation ------------------------------------------------------------------------------

function confirmQuitWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_confirm_quit'),
    build: (body) => {
      body.append(el('p', undefined, 'Leave this realm?'));
      body.append(note('The realm is not saved yet. Saving is not available, and leaving to the title is not wired yet.'));
      body.append(button('Keep playing', () => deps.close(), true));
      body.append(disabledButton('Save and leave'));
      body.append(disabledButton('Leave without saving'));
    },
  };
}

// Developer windows (gated) ----------------------------------------------------------------------

const DEV_OFF = 'Developer tools are off. Turn on Developer tools in Settings, under Developer, to use this window.';

function devGate(deps: WindowDeps, body: HTMLElement): boolean {
  if (boolOption(deps.options(), 'dev.enabled')) return true;
  body.append(note(DEV_OFF));
  body.append(button('Open Settings', () => deps.open('win_settings')));
  return false;
}

function devConsoleWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_dev_console'),
    build: (body) => {
      if (!devGate(deps, body)) return;
      const log = el('div', 'console-log');
      log.setAttribute('role', 'log');
      log.setAttribute('aria-live', 'polite');
      log.setAttribute('aria-label', 'Console output');
      const print = (lines: readonly string[]): void => {
        for (const line of capLog(lines)) log.append(el('div', undefined, line));
        while (log.childElementCount > 2500) log.firstElementChild?.remove();
        log.scrollTop = log.scrollHeight;
      };
      print(['Developer console. Type help. This console reads the realm; it does not change it yet.']);
      const form = el('form', 'console-form');
      const label = el('label', 'option');
      const input = el('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', 'Command');
      label.append(el('span', undefined, 'Command'), input);
      const run = el('button', 'btn primary', 'Run');
      run.type = 'submit';
      form.append(label, run);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value;
        input.value = '';
        if (text.trim() === '') return;
        if (text.trim().toLowerCase() === 'clear') {
          log.replaceChildren();
          return;
        }
        const snap: Snapshot | null = deps.snapshot?.() ?? null;
        const ctx: ConsoleContext = { tick: snap?.tick ?? 0, version: APP_VERSION, snap };
        print([`> ${text.trim()}`, ...runConsoleCommand(text, ctx)]);
      });
      body.append(log, form);
    },
  };
}

type DevTab = 'perf' | 'content' | 'rules' | 'flags' | 'storage' | 'events' | 'commands';
const DEV_TABS: ReadonlyArray<[DevTab, string]> = [
  ['perf', 'Perf'],
  ['content', 'Content'],
  ['rules', 'Rules'],
  ['flags', 'Flags'],
  ['storage', 'Storage'],
  ['events', 'Events'],
  ['commands', 'Commands'],
];

function devTabBody(tab: DevTab, deps: WindowDeps, panel: HTMLElement): void {
  const snap = deps.snapshot?.() ?? null;
  switch (tab) {
    case 'perf':
      panel.append(
        factsList([
          ['Tick', String(snap?.tick ?? 'unknown')],
          ['Beings', String(snap?.population.total ?? 0)],
          ['Snapshot size', snap ? `${JSON.stringify(snap).length} characters` : 'Unknown'],
          ['History samples', String(realmHistory.all.length)],
        ]),
        note('Frame times, the worker queue and memory are not measured in this build.'),
      );
      return;
    case 'content':
      panel.append(
        factsList([
          ['Powers', String(POWERS.length)],
          ['Species', String(SPECIES.length)],
          ['Being traits', String(BEING_TRAITS.length)],
          ['Strain traits', String(STRAIN_TRAITS.length)],
          ['Achievements', String(ACHIEVEMENTS.length)],
          ['Ages', String(AGES.length)],
          ['Realm rules', String(RULES.length)],
          ['Hamlet buildings', String(BUILDINGS.length)],
        ]),
      );
      return;
    case 'rules': {
      const host = el('div');
      panel.append(host);
      buildList(host, {
        name: 'Realm rules (read only)',
        items: RULES,
        rowHeight: 44,
        label: (r) => r.id,
        sorts: [{ key: 'id', label: 'Name' }],
        empty: 'No rules.',
        render: (r) => {
          const row = el('div', 'rule-row');
          row.append(el('strong', undefined, r.id), el('span', 'option-note', deps.rules.isOn(r.id) ? 'On' : 'Off'));
          return row;
        },
      });
      return;
    }
    case 'flags': {
      const devSettings = SETTINGS.filter((s) => s.group === 'dev');
      panel.append(factsList(devSettings.map((s) => [s.label, String(deps.options()[s.id] ?? s.def)])));
      panel.append(note('Only the Developer tools setting is built. The debug flags of the spec are not.'));
      return;
    }
    case 'storage':
      panel.append(note('Storage sizes are not read by this build.'));
      return;
    case 'events':
      panel.append(note('The event bus has no monitor in this build.'));
      return;
    case 'commands':
      panel.append(note('The sim keeps no command log yet.'));
      return;
  }
}

function devToolsWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_dev_tools'),
    build: (body) => {
      if (!devGate(deps, body)) return;
      const tabs = el('div', 'tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Developer panels');
      const panel = el('div', 'dev-panel');
      panel.setAttribute('role', 'tabpanel');
      const buttons: HTMLButtonElement[] = [];
      const show = (tab: DevTab): void => {
        for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset['tab'] === tab));
        panel.replaceChildren();
        devTabBody(tab, deps, panel);
      };
      for (const [tab, label] of DEV_TABS) {
        const btn = el('button', 'btn', label);
        btn.type = 'button';
        btn.setAttribute('role', 'tab');
        btn.dataset['tab'] = tab;
        btn.addEventListener('click', () => show(tab));
        buttons.push(btn);
        tabs.append(btn);
      }
      body.append(tabs, panel);
      show('perf');
    },
  };
}

/** The system window for `id`, or null when it is not one of these. */
export function systemWindowFor(id: string, deps: WindowDeps, params: WindowParams = {}): WindowBuild | null {
  switch (id) {
    case 'win_chronicle_confirm':
      return chronicleConfirmWindow(deps, params);
    case 'win_patch_notes':
      return patchNotesWindow();
    case 'win_error':
      return errorWindow(deps, params);
    case 'win_update':
      return updateWindow(deps);
    case 'win_confirm_quit':
      return confirmQuitWindow(deps);
    case 'win_dev_console':
      return devConsoleWindow(deps);
    case 'win_dev_tools':
      return devToolsWindow(deps);
    default:
      return null;
  }
}

/** Ids this module builds (for the catalogue test). */
export const SYSTEM_WINDOW_IDS: readonly string[] = [
  'win_chronicle_confirm',
  'win_patch_notes',
  'win_error',
  'win_update',
  'win_confirm_quit',
  'win_dev_console',
  'win_dev_tools',
];
