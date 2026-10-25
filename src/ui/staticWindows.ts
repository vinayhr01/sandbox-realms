/**
 * Windows with no sim data (13 section 7.1): language, credits, install help, welcome and the brush
 * picker. The brush picker is a form that drives the same brush state as the Terrain panel.
 */
import type { BrushShape } from '../shared/protocol.ts';
import { windowTitle } from './windowCatalog.ts';
import type { WindowBuild, WindowDeps } from './windowContent.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label: string, onClick: () => void, primary = false): HTMLButtonElement => {
  const btn = el('button', primary ? 'btn primary' : 'btn', label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
};

const LANGUAGES: ReadonlyArray<{ code: string; name: string; complete: number }> = [{ code: 'en', name: 'English', complete: 100 }];

function languageWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_language'),
    build: (body) => {
      body.append(el('p', 'option-note', 'English is the only language so far. Other languages appear here once they are translated.'));
      const group = el('div');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', 'Language');
      for (const lang of LANGUAGES) {
        const row = el('button', 'btn list-chip');
        row.type = 'button';
        row.setAttribute('role', 'radio');
        row.setAttribute('aria-checked', 'true');
        row.textContent = `${lang.name} (${lang.code}), ${lang.complete}% complete`;
        group.append(row);
      }
      body.append(group, button('Done', () => deps.close(), true));
    },
  };
}

function creditsWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_credits'),
    build: (body) => {
      const list = el('dl', 'facts');
      const rows: Array<[string, string]> = [
        ['Game', 'Sandbox Realms, an original browser god-game'],
        ['Build and test tools (not shipped)', 'TypeScript 7.0.2, Vite 8.3.5, Vitest 5.0.5, Playwright 1.64.1, @types/node 26.6.5'],
      ];
      for (const [k, v] of rows) list.append(el('dt', undefined, k), el('dd', undefined, v));
      body.append(list, button('Done', () => deps.close(), true));
    },
  };
}

function installWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_install'),
    build: (body) => {
      const list = el('dl', 'facts');
      const rows: Array<[string, string]> = [
        ['Phone', 'Open the browser menu and choose Add to Home Screen.'],
        ['Desktop Chrome or Edge', 'Use the install icon at the right of the address bar.'],
        ['Offline', 'After the first load the game can start without a connection.'],
      ];
      for (const [k, v] of rows) list.append(el('dt', undefined, k), el('dd', undefined, v));
      body.append(list, button('Done', () => deps.close(), true));
    },
  };
}

function welcomeWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_welcome'),
    build: (body) => {
      body.append(el('p', 'option-note', 'Sandbox Realms. Shape a world with powers and watch what lives in it.'));
      const actions = el('div', 'power-actions');
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', 'Start');
      actions.append(
        button('Continue', () => deps.close(), true),
        button('New realm', () => deps.open('win_new_realm')),
        button('Chronicle', () => deps.open('win_chronicle')),
        button('Tutorial', () => deps.open('win_tutorial')),
        button('Settings', () => deps.open('win_settings')),
      );
      body.append(actions);
    },
  };
}

const SHAPES: ReadonlyArray<[BrushShape, string]> = [
  ['circle', 'Circle'],
  ['square', 'Square'],
  ['diamond', 'Diamond'],
];

function brushWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_brushes'),
    build: (body) => {
      const brush = deps.brush();
      const shapes = el('div', 'shapes');
      shapes.setAttribute('role', 'radiogroup');
      shapes.setAttribute('aria-label', 'Brush shape');
      const shapeButtons: HTMLButtonElement[] = [];
      for (const [value, label] of SHAPES) {
        const btn = el('button', 'shape', label);
        btn.type = 'button';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(brush.shape === value));
        btn.addEventListener('click', () => {
          deps.setBrush({ shape: value });
          for (const other of shapeButtons) other.setAttribute('aria-checked', String(other === btn));
        });
        shapeButtons.push(btn);
        shapes.append(btn);
      }
      const sizeLabel = el('label', 'option');
      const size = el('input');
      size.type = 'range';
      size.min = '0';
      size.max = String(brush.radii.length - 1);
      size.step = '1';
      size.value = String(brush.sizeIndex);
      const out = el('output', undefined, String(brush.radii[brush.sizeIndex] ?? 0));
      size.addEventListener('input', () => {
        const index = Number(size.value);
        deps.setBrush({ sizeIndex: index });
        out.textContent = String(brush.radii[index] ?? 0);
      });
      sizeLabel.append(el('span', undefined, 'Brush size (radius in tiles) '), out, size);
      body.append(shapes, sizeLabel, button('Done', () => deps.close(), true));
    },
  };
}

/** The static window for `id`, or null when it is not one of these. */
export function staticWindowFor(id: string, deps: WindowDeps): WindowBuild | null {
  switch (id) {
    case 'win_language':
      return languageWindow(deps);
    case 'win_credits':
      return creditsWindow(deps);
    case 'win_install':
      return installWindow(deps);
    case 'win_welcome':
      return welcomeWindow(deps);
    case 'win_brushes':
      return brushWindow(deps);
    default:
      return null;
  }
}
