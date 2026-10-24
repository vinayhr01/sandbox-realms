/**
 * Windows that read the sim snapshot (13 sections 6 to 8): population, beings, figures, lifetime
 * stats, codex, achievements, dominions, hamlets and culture. Each window builds once when opened
 * and returns a `live` callback; the window host calls it when a new snapshot arrives, so numbers
 * update without rebuilding the search box or losing the scroll position.
 */
import { ACHIEVEMENTS } from '../content/achievements.ts';
import type { DominionRow, HamletRow, Snapshot, SpeciesRow } from '../shared/protocol.ts';
import { buildList } from './listView.ts';
import {
  achievementHeadline,
  achievementViews,
  campaignTargetName,
  codexLines,
  cultureLines,
  dominionLine,
  figureRows,
  fraction,
  hamletLine,
  lifetimeRows,
  populationLines,
  topSpecies,
  type AchievementView,
  type CounterRow,
  type LabelledValue,
} from './snapshot-model.ts';
import type { WindowBuild, WindowDeps } from './windowContent.ts';
import { windowTitle } from './windowCatalog.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Thin bar for a 0..1 share. Decorative: the number beside it carries the meaning. */
function meter(share: number): HTMLElement {
  const bar = el('div', 'meter');
  bar.setAttribute('aria-hidden', 'true');
  const fill = el('span');
  fill.style.width = `${Math.round(share * 100)}%`;
  bar.append(fill);
  return bar;
}

const snapOf = (deps: WindowDeps): Snapshot | null => deps.snapshot?.() ?? null;

/** A status line that says the realm is still being read, or that a list was cut. Returns its updater. */
function statusLine(body: HTMLElement): (snap: Snapshot | null) => void {
  const line = el('p', 'option-note', 'Reading the realm...');
  line.setAttribute('role', 'status');
  body.append(line);
  return (snap) => {
    if (snap === null) {
      line.hidden = false;
      line.textContent = 'Reading the realm...';
    } else if (snap.truncated) {
      line.hidden = false;
      line.textContent = 'Some rows are cut to keep updates small.';
    } else {
      line.hidden = true;
    }
  };
}

/** Label/value rows, plus an optional section below them that is redrawn on every snapshot. */
function factsWindow(
  body: HTMLElement,
  deps: WindowDeps,
  rows: (snap: Snapshot) => readonly LabelledValue[],
  section?: (host: HTMLElement, snap: Snapshot) => void,
): () => void {
  const status = statusLine(body);
  const dl = el('dl', 'facts');
  const host = el('div', 'snapshot-section');
  body.append(dl, host);
  const live = (): void => {
    const snap = snapOf(deps);
    status(snap);
    const pairs = snap ? rows(snap) : [];
    dl.replaceChildren(...pairs.flatMap(([k, v]) => [el('dt', undefined, k), el('dd', undefined, v)]));
    host.replaceChildren();
    if (snap && section) section(host, snap);
  };
  live();
  return live;
}

function populationWindow(deps: WindowDeps, body: HTMLElement): () => void {
  return factsWindow(body, deps, populationLines, (host, snap) => {
    const total = snap.population.total;
    host.append(el('h3', undefined, 'Largest species'));
    const list = el('ul', 'snapshot-bars');
    for (const row of topSpecies(snap)) {
      const item = el('li');
      item.append(el('span', undefined, row.name), el('span', 'snapshot-count', String(row.count)), meter(fraction(row.count, total)));
      list.append(item);
    }
    host.append(list);
  });
}

function buildBeings(deps: WindowDeps, body: HTMLElement): () => void {
  const status = statusLine(body);
  const handle = buildList<SpeciesRow>(body, {
    name: 'Beings',
    items: () => snapOf(deps)?.population.species ?? [],
    rowHeight: 56,
    label: (r) => r.name,
    sorts: [
      { key: 'count', label: 'Count' },
      { key: 'name', label: 'Name' },
    ],
    startDesc: true,
    filters: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'folk', label: 'Folk', test: (r) => r.folk },
      { id: 'wild', label: 'Wild', test: (r) => !r.folk },
    ],
    empty: 'No beings alive.',
    render: (r) => {
      const total = snapOf(deps)?.population.total ?? 0;
      const row = el('div', 'rule-row');
      const text = el('div', 'rule-text');
      text.append(el('strong', undefined, r.name), el('span', 'option-note', r.folk ? 'Folk' : 'Wild'), meter(fraction(r.count, total)));
      row.append(text, el('span', 'snapshot-count', String(r.count)));
      return row;
    },
  });
  return () => {
    status(snapOf(deps));
    handle.refresh();
  };
}

function buildFigures(deps: WindowDeps, body: HTMLElement): () => void {
  return factsWindow(body, deps, figureRows);
}

function buildCodex(deps: WindowDeps, body: HTMLElement): () => void {
  return factsWindow(body, deps, codexLines, (host, snap) => {
    const c = snap.codex;
    host.append(meter(fraction(c.traits, c.traitTotal)), meter(fraction(c.species, c.rosterTotal)));
    host.append(el('p', 'option-note', 'Traits and species are counted when first seen in this save.'));
  });
}

function buildCulture(deps: WindowDeps, body: HTMLElement): () => void {
  return factsWindow(body, deps, cultureLines);
}

function buildLifetime(deps: WindowDeps, body: HTMLElement): () => void {
  const status = statusLine(body);
  const handle = buildList<CounterRow>(body, {
    name: 'Lifetime stats',
    items: () => {
      const snap = snapOf(deps);
      return snap ? lifetimeRows(snap) : [];
    },
    rowHeight: 44,
    label: (r) => r.label,
    sorts: [
      { key: 'value', label: 'Value' },
      { key: 'label', label: 'Name' },
    ],
    startDesc: true,
    empty: 'No counters yet.',
    render: (r) => {
      const row = el('div', 'rule-row');
      row.append(el('strong', undefined, r.label), el('span', 'snapshot-count', String(r.value)));
      return row;
    },
  });
  return () => {
    status(snapOf(deps));
    handle.refresh();
  };
}

function buildAchievements(deps: WindowDeps, body: HTMLElement): () => void {
  const status = statusLine(body);
  const headline = el('p', 'option-note', achievementHeadline(null));
  headline.setAttribute('role', 'status');
  body.append(headline);
  const handle = buildList<AchievementView>(body, {
    name: 'Achievements',
    items: () => achievementViews(snapOf(deps), ACHIEVEMENTS),
    rowHeight: 56,
    label: (v) => v.name,
    sorts: [
      { key: 'name', label: 'Name' },
      { key: 'fraction', label: 'Progress' },
    ],
    filters: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'unlocked', label: 'Unlocked', test: (v) => v.unlocked },
      { id: 'locked', label: 'Locked', test: (v) => !v.unlocked },
    ],
    empty: 'No achievements match.',
    render: (v) => {
      const row = el('div', 'rule-row');
      const text = el('div', 'rule-text');
      const state = v.unlocked ? 'Unlocked' : `${Math.min(v.value, v.target)} of ${v.target}`;
      text.append(el('strong', undefined, v.name), el('span', 'option-note', v.unlocked ? v.desc : `${v.group} · ${state}`));
      if (!v.unlocked) text.append(meter(v.fraction));
      row.append(text, el('span', 'snapshot-count', state));
      return row;
    },
  });
  return () => {
    status(snapOf(deps));
    headline.textContent = achievementHeadline(snapOf(deps), ACHIEVEMENTS);
    handle.refresh();
  };
}

function buildDominions(deps: WindowDeps, body: HTMLElement): () => void {
  const status = statusLine(body);
  const handle = buildList<DominionRow>(body, {
    name: 'Dominions',
    items: () => snapOf(deps)?.dominions ?? [],
    rowHeight: 64,
    label: (d) => d.name,
    sorts: [
      { key: 'parcels', label: 'Area' },
      { key: 'strength', label: 'Army' },
      { key: 'war', label: 'War' },
      { key: 'id', label: 'Id' },
    ],
    startDesc: true,
    filters: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'war', label: 'At war', test: (d) => d.atWar },
      { id: 'peace', label: 'Not at war', test: (d) => !d.atWar },
    ],
    empty: 'No dominions yet.',
    render: (d) => {
      const snap = snapOf(deps);
      const row = el('button', 'rule-row');
      row.type = 'button';
      const text = el('div', 'rule-text');
      text.append(el('strong', undefined, d.name), el('span', 'option-note', dominionLine(d)));
      const target = snap ? campaignTargetName(snap, d) : null;
      if (target) text.append(el('span', 'option-note', `Campaigning against ${target}`));
      row.append(text);
      if (d.atWar) row.append(el('span', 'snapshot-count', 'At war'));
      row.addEventListener('click', () => deps.open('win_dominion', { id: d.id }));
      return row;
    },
  });
  return () => {
    status(snapOf(deps));
    handle.refresh();
  };
}

function buildHamlets(deps: WindowDeps, body: HTMLElement): () => void {
  const status = statusLine(body);
  const handle = buildList<HamletRow>(body, {
    name: 'Hamlets',
    items: () => snapOf(deps)?.hamlets ?? [],
    rowHeight: 56,
    label: (h) => h.name,
    sorts: [
      { key: 'folk', label: 'Folk' },
      { key: 'buildings', label: 'Buildings' },
      { key: 'parcels', label: 'Area' },
    ],
    startDesc: true,
    empty: 'No hamlets yet.',
    render: (h) => {
      const row = el('button', 'rule-row');
      row.type = 'button';
      const text = el('div', 'rule-text');
      text.append(el('strong', undefined, h.name), el('span', 'option-note', hamletLine(h)));
      row.append(text);
      const index = snapOf(deps)?.hamlets.indexOf(h) ?? -1;
      row.addEventListener('click', () => deps.open('win_hamlet', { id: index }));
      return row;
    },
  });
  return () => {
    status(snapOf(deps));
    handle.refresh();
  };
}

/** The live window for `id`, or null when this module does not build it. */
export function snapshotWindowFor(id: string, deps: WindowDeps): WindowBuild | null {
  const make = (fn: (deps: WindowDeps, body: HTMLElement) => () => void): WindowBuild => {
    let live: (() => void) | undefined;
    return {
      title: windowTitle(id),
      build: (body) => {
        live = fn(deps, body);
      },
      live: () => live?.(),
    };
  };
  switch (id) {
    case 'win_population':
      return make(populationWindow);
    case 'win_beings':
      return make(buildBeings);
    case 'win_figures':
      return make(buildFigures);
    case 'win_stats_lifetime':
      return make(buildLifetime);
    case 'list_codex':
      return make(buildCodex);
    case 'win_trophies':
      return make(buildAchievements);
    case 'list_dominions':
      return make(buildDominions);
    case 'list_hamlets':
      return make(buildHamlets);
    case 'win_culture':
      return make(buildCulture);
    default:
      return null;
  }
}
