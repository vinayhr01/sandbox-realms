/**
 * Culture, campaign and strain windows (13 sections 6 and 7.1): a list per kind, and an inspector
 * that opens from a list row. Lists and inspectors read the latest snapshot through deps.snapshot,
 * so they update while the sim runs or is paused. Inspectors keep a Back button to their list.
 */
import type { Snapshot } from '../shared/protocol.ts';
import {
  campaignLine,
  DETAIL_EMPTY,
  campaignRows,
  cutNote,
  dominionFacts,
  groupName,
  hamletAt,
  intrigueKindLabel,
  intrigueOutcomeLabel,
  sameDialectGroups,
} from './detail-model.ts';
import { buildList } from './listView.ts';
import { armyFacts, armyLine } from './spec-model.ts';
import { windowTitle } from './windowCatalog.ts';
import type { WindowBuild, WindowDeps, WindowParams } from './windowContent.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** One list row: what it shows, and the inspector it opens. */
interface RowView {
  id: number;
  title: string;
  detail: string;
  inspector: string;
  params: WindowParams;
}

/** What an inspector shows: facts, optional name lists, and buttons that open other windows. */
export interface InspectorView {
  heading: string;
  facts: [string, string][];
  lists?: { title: string; items: string[]; empty: string }[];
  actions?: { label: string; window: string; params: WindowParams }[];
}

const snapOf = (deps: WindowDeps): Snapshot | null => deps.snapshot?.() ?? null;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Rows of one list window. `cut` says how many rows the snapshot omitted, if any. */
export interface ListSpecView {
  name: string;
  /** Window ids of the inspector this list opens (its row params say which row). */
  rows: (snap: Snapshot) => RowView[];
  cut?: (snap: Snapshot) => string | null;
  empty: string;
  /** Window to go back to from this list's own status (unused here; kept for clarity of ids). */
  self: string;
}

/** A list window: rows from the snapshot, each opening its inspector. Shared with the spec list windows. */
export function listWindow(deps: WindowDeps, spec: ListSpecView): WindowBuild {
  let live: (() => void) | undefined;
  return {
    title: windowTitle(spec.self),
    build: (body) => {
      const status = el('p', 'option-note');
      status.setAttribute('role', 'status');
      body.append(status);
      const showStatus = (snap: Snapshot | null): void => {
        const note = snap === null ? 'Reading the realm...' : (spec.cut?.(snap) ?? null);
        status.hidden = note === null;
        status.textContent = note ?? '';
      };
      const handle = buildList<RowView>(body, {
        name: spec.name,
        items: () => {
          const snap = snapOf(deps);
          return snap ? spec.rows(snap) : [];
        },
        rowHeight: 56,
        label: (r) => r.title,
        sorts: [
          { key: 'id', label: 'Order' },
          { key: 'title', label: 'Name' },
        ],
        empty: spec.empty,
        render: (r) => {
          const row = el('button', 'rule-row');
          row.type = 'button';
          const text = el('div', 'rule-text');
          text.append(el('strong', undefined, r.title), el('span', 'option-note', r.detail));
          row.append(text);
          row.addEventListener('click', () => deps.open(r.inspector, r.params));
          return row;
        },
      });
      showStatus(snapOf(deps));
      // The list is re-rendered on each snapshot, so the status line and the rows stay in step.
      live = () => {
        showStatus(snapOf(deps));
        handle.refresh();
      };
    },
    live: () => live?.(),
  };
}

/** A list of the given kind, built from the detail rows of the snapshot. */
function cultureList(deps: WindowDeps, id: string): WindowBuild | null {
  switch (id) {
    case 'list_campaigns':
      return listWindow(deps, {
        self: id,
        name: 'Campaigns',
        rows: (snap) =>
          campaignRows(snap).map((c) => ({
            id: c.attacker.id,
            title: `${c.attacker.name} against ${c.targetName}`,
            detail: campaignLine(c),
            inspector: 'win_campaign',
            params: { id: c.attacker.id },
          })),
        empty: 'No campaigns under way.',
      });
    case 'list_creeds':
      return listWindow(deps, {
        self: id,
        name: 'Creeds',
        rows: (snap) =>
          (snap.detail?.creeds ?? []).map((c) => ({
            id: c.id,
            title: `Creed ${c.id}`,
            detail: `Held by ${plural(c.holders.length, 'group', 'groups')}`,
            inspector: 'win_creed',
            params: { id: c.id },
          })),
        cut: (snap) => cutNote(snap.detail?.creeds.length ?? 0, snap.detail?.counts.creeds ?? 0),
        empty: 'No creeds yet.',
      });
    case 'list_customs':
      return listWindow(deps, {
        self: id,
        name: 'Customs',
        rows: (snap) =>
          (snap.detail?.customs ?? []).map((c, i) => ({
            id: i,
            title: `Custom ${i + 1}`,
            detail: `${groupName(snap, c.group)} · ${c.traits.length ? c.traits.join(', ') : 'no traits'}`,
            inspector: 'win_custom',
            params: { id: i },
          })),
        cut: (snap) => cutNote(snap.detail?.customs.length ?? 0, snap.detail?.counts.customs ?? 0),
        empty: 'No customs yet.',
      });
    case 'list_dialects':
      return listWindow(deps, {
        self: id,
        name: 'Dialects',
        rows: (snap) =>
          (snap.detail?.dialects ?? []).map((d) => ({
            id: d.group,
            title: groupName(snap, d.group),
            detail: `Dialect word ${d.word} · shared with ${plural(sameDialectGroups(snap.detail ?? DETAIL_EMPTY, d.group).length, 'group', 'groups')}`,
            inspector: 'win_dialect',
            params: { id: d.group },
          })),
        cut: (snap) => cutNote(snap.detail?.dialects.length ?? 0, snap.detail?.counts.dialects ?? 0),
        empty: 'No dialects yet.',
      });
    case 'list_households':
      return listWindow(deps, {
        self: id,
        name: 'Families',
        rows: (snap) =>
          (snap.detail?.families ?? []).map((f, i) => ({
            id: i,
            title: `Family ${i + 1}`,
            detail: `${groupName(snap, f.child)}, child of ${groupName(snap, f.parentA)} and ${groupName(snap, f.parentB)}`,
            inspector: 'win_family',
            params: { id: i },
          })),
        cut: (snap) => cutNote(snap.detail?.families.length ?? 0, snap.detail?.counts.families ?? 0),
        empty: 'No families yet.',
      });
    case 'list_intrigues':
      return listWindow(deps, {
        self: id,
        name: 'Intrigues',
        rows: (snap) =>
          (snap.detail?.intrigues ?? []).map((x) => ({
            id: x.id,
            title: `${intrigueKindLabel(x.kind)} ${x.id}`,
            detail: `${groupName(snap, x.group)} · ${x.progress} of ${x.goal} · ${intrigueOutcomeLabel(x.outcome)}`,
            inspector: 'win_intrigue',
            params: { id: x.id },
          })),
        cut: (snap) => cutNote(snap.detail?.intrigues.length ?? 0, snap.detail?.counts.intrigues ?? 0),
        empty: 'No intrigues yet.',
      });
    case 'list_strains':
      return listWindow(deps, {
        self: id,
        name: 'Strains',
        rows: (snap) =>
          (snap.detail?.strains ?? []).map((s) => ({
            id: s.id,
            title: s.name,
            detail: `${s.species} · generation ${s.generation}`,
            inspector: 'win_strain',
            params: { id: s.id },
          })),
        cut: (snap) => cutNote(snap.detail?.strains.length ?? 0, snap.detail?.counts.strains ?? 0),
        empty: 'No strains yet.',
      });
    case 'list_hosts':
      return listWindow(deps, {
        self: id,
        name: 'Armies',
        rows: (snap) =>
          snap.dominions.map((d) => {
            const target = campaignRows(snap).find((c) => c.attacker.id === d.id)?.targetName ?? null;
            return {
              id: d.id,
              title: `Army of ${d.name}`,
              detail: armyLine(d, target),
              inspector: 'win_army',
              params: { id: d.id },
            };
          }),
        cut: (snap) => cutNote(snap.dominions.length, snap.dominionCount),
        empty: 'No armies yet. Each army belongs to a dominion, and the realm has no dominions.',
      });
    default:
      return null;
  }
}

/** The inspector view for `id` with `params`, or null when the row is gone. */
function inspectorView(snap: Snapshot, id: string, params: WindowParams): InspectorView | null {
  const key = params.id ?? -1;
  const detail = snap.detail;
  switch (id) {
    case 'win_dominion': {
      const d = snap.dominions.find((x) => x.id === key);
      if (!d) return null;
      const actions: InspectorView['actions'] = [{ label: 'Open army', window: 'win_army', params: { id: d.id } }];
      if (d.campaignTarget >= 0) actions.push({ label: 'Open campaign', window: 'win_campaign', params: { id: d.id } });
      actions.push({ label: 'Customize banner', window: 'win_customize_dominion', params: { id: d.id } });
      return { heading: d.name, facts: dominionFacts(d, snap), actions };
    }
    case 'win_army': {
      const d = snap.dominions.find((x) => x.id === key);
      if (!d) return null;
      const target = campaignRows(snap).find((c) => c.attacker.id === d.id)?.targetName ?? null;
      return {
        heading: `Army of ${d.name}`,
        facts: armyFacts(d, target, snap),
        lists: [{ title: 'Not in the sim yet', items: ['Captain', 'Kills', 'Deaths', 'Soldiers by hamlet'], empty: '' }],
        actions: [{ label: 'Open dominion', window: 'win_dominion', params: { id: d.id } }],
      };
    }
    case 'win_hamlet': {
      const h = hamletAt(snap, key);
      if (!h) return null;
      const structures = (detail?.notable?.structures ?? []).filter((s) => s.hamlet === key);
      const actions: NonNullable<InspectorView['actions']> = structures.map((s) => ({
        label: `${s.name} at ${s.x}, ${s.y}`,
        window: 'win_structure',
        params: { id: s.id },
      }));
      actions.push({ label: 'Customize banner', window: 'win_customize_hamlet', params: { id: key } });
      return {
        heading: h.name,
        facts: [
          ['Folk', String(h.folk)],
          ['Buildings', String(h.buildings)],
          ['Parcels', String(h.parcels)],
        ],
        lists: [
          {
            title: 'Structures',
            items: structures.map((s) => `${s.name} at ${s.x}, ${s.y}`),
            empty: h.buildings > 0 ? 'Structures are listed up to the snapshot cap.' : 'No structures yet.',
          },
        ],
        actions,
      };
    }
    case 'win_campaign': {
      const c = campaignRows(snap).find((x) => x.attacker.id === key);
      if (!c) return null;
      const actions: NonNullable<InspectorView['actions']> = [{ label: 'Open attacker', window: 'win_dominion', params: { id: c.attacker.id } }];
      if (c.target) actions.push({ label: 'Open target', window: 'win_dominion', params: { id: c.target.id } });
      return {
        heading: `${c.attacker.name} against ${c.targetName}`,
        facts: [
          ['Attacker army', String(c.attacker.strength)],
          ['Attacker parcels', String(c.attacker.parcels)],
          ['Target army', c.target ? String(c.target.strength) : 'Unknown'],
          ['Target parcels', c.target ? String(c.target.parcels) : 'Unknown'],
        ],
        actions,
      };
    }
    case 'win_creed': {
      const c = detail?.creeds.find((x) => x.id === key);
      if (!c) return null;
      return {
        heading: `Creed ${c.id}`,
        facts: [['Holder groups', String(c.holders.length)]],
        lists: [{ title: 'Held by', items: c.holders.map((g) => groupName(snap, g)), empty: 'No group holds this creed.' }],
        actions: [{ label: 'Customize banner', window: 'win_customize_creed', params: { id: c.id } }],
      };
    }
    case 'win_custom': {
      const c = detail?.customs[key];
      if (!c) return null;
      return {
        heading: `Custom ${key + 1}`,
        facts: [
          ['Group', groupName(snap, c.group)],
          ['Traits', String(c.traits.length)],
        ],
        lists: [{ title: 'Traits', items: c.traits, empty: 'No traits.' }],
        actions: [{ label: 'Customize banner', window: 'win_customize_custom', params: { id: key } }],
      };
    }
    case 'win_dialect': {
      const d = detail?.dialects.find((x) => x.group === key);
      if (!d || !detail) return null;
      const same = sameDialectGroups(detail, key).map((g) => groupName(snap, g));
      return {
        heading: groupName(snap, key),
        facts: [
          ['Group', groupName(snap, key)],
          ['Dialect word', String(d.word)],
        ],
        lists: [{ title: 'Groups that speak the same dialect', items: same, empty: 'No other group speaks it.' }],
        actions: [{ label: 'Customize banner', window: 'win_customize_dialect', params: { id: key } }],
      };
    }
    case 'win_family': {
      const f = detail?.families[key];
      if (!f) return null;
      return {
        heading: `Family ${key + 1}`,
        facts: [
          ['Child group', groupName(snap, f.child)],
          ['Parent group', groupName(snap, f.parentA)],
          ['Other parent group', groupName(snap, f.parentB)],
        ],
        actions: [{ label: 'Customize banner', window: 'win_customize_family', params: { id: key } }],
      };
    }
    case 'win_intrigue': {
      const x = detail?.intrigues.find((i) => i.id === key);
      if (!x) return null;
      return {
        heading: `${intrigueKindLabel(x.kind)} ${x.id}`,
        facts: [
          ['Kind', intrigueKindLabel(x.kind)],
          ['Group', groupName(snap, x.group)],
          ['Progress', `${x.progress} of ${x.goal}`],
          ['Outcome', intrigueOutcomeLabel(x.outcome)],
        ],
      };
    }
    case 'win_strain': {
      const s = detail?.strains.find((x) => x.id === key);
      if (!s) return null;
      const parent = s.parent === 0 ? 'None (founding strain)' : (detail?.strains.find((p) => p.id === s.parent)?.name ?? `Strain ${s.parent}`);
      return {
        heading: s.name,
        facts: [
          ['Species', s.species],
          ['Generation', String(s.generation)],
          ['Parent strain', parent],
          ['Born', String(s.born)],
          ['New adults', String(s.newAdults)],
          ['Reproduced', String(s.reproduced)],
        ],
        lists: [{ title: 'Traits', items: s.traits, empty: 'No strain traits.' }],
        actions: [
          { label: 'Edit traits', window: 'win_trait_editor', params: { id: s.id, kind: 'strain' } },
          { label: 'Customize banner', window: 'win_customize_strain', params: { id: s.id } },
        ],
      };
    }
    default:
      return null;
  }
}

/** Where each inspector's Back button goes. */
const BACK: Readonly<Record<string, { window: string; label: string; missing: string }>> = {
  win_dominion: { window: 'list_dominions', label: 'Back to dominions', missing: 'This dominion is no longer in the realm.' },
  win_hamlet: { window: 'list_hamlets', label: 'Back to hamlets', missing: 'This hamlet is no longer in the realm.' },
  win_campaign: { window: 'list_campaigns', label: 'Back to campaigns', missing: 'This campaign has ended.' },
  win_creed: { window: 'list_creeds', label: 'Back to creeds', missing: 'This creed is no longer held.' },
  win_custom: { window: 'list_customs', label: 'Back to customs', missing: 'This custom is no longer in the realm.' },
  win_dialect: { window: 'list_dialects', label: 'Back to dialects', missing: 'This dialect group is no longer in the realm.' },
  win_family: { window: 'list_households', label: 'Back to families', missing: 'This family is no longer in the realm.' },
  win_intrigue: { window: 'list_intrigues', label: 'Back to intrigues', missing: 'This intrigue is no longer in the realm.' },
  win_strain: { window: 'list_strains', label: 'Back to strains', missing: 'This strain is no longer in the realm.' },
  win_army: { window: 'list_hosts', label: 'Back to armies', missing: 'This dominion is no longer in the realm, so its army is gone.' },
};

/** An inspector window: Back to its list, the facts and lists of the row, and its action buttons. */
function inspector(deps: WindowDeps, id: string, params: WindowParams): WindowBuild {
  const back = BACK[id];
  if (!back) throw new Error(`no inspector ${id}`);
  // The content node is created in build(), so this module can be loaded without a DOM.
  let content: HTMLElement | null = null;
  let lastKey = '';
  const draw = (): void => {
    if (content === null) return;
    const snap = snapOf(deps);
    const view = snap ? inspectorView(snap, id, params) : null;
    const key = snap === null ? 'loading' : view === null ? 'missing' : JSON.stringify(view);
    if (key === lastKey) return;
    lastKey = key;
    content.replaceChildren();
    if (snap === null) {
      content.append(el('p', 'option-note', 'Reading the realm...'));
      return;
    }
    if (view === null) {
      content.append(el('p', 'option-note', back.missing));
      return;
    }
    const dl = el('dl', 'facts');
    for (const [k, v] of view.facts) dl.append(el('dt', undefined, k), el('dd', undefined, v));
    content.append(dl);
    for (const list of view.lists ?? []) {
      content.append(el('h3', undefined, list.title));
      if (list.items.length === 0) {
        content.append(el('p', 'option-note', list.empty));
        continue;
      }
      const ul = el('ul', 'snapshot-bars');
      for (const item of list.items) ul.append(el('li', undefined, item));
      content.append(ul);
    }
    for (const action of view.actions ?? []) {
      const btn = el('button', 'btn', action.label);
      btn.type = 'button';
      btn.addEventListener('click', () => deps.open(action.window, action.params));
      content.append(btn);
    }
  };
  const title = snapOf(deps) ? (inspectorView(snapOf(deps) as Snapshot, id, params)?.heading ?? windowTitle(id)) : windowTitle(id);
  return {
    title,
    build: (body) => {
      const backBtn = el('button', 'btn', back.label);
      backBtn.type = 'button';
      backBtn.addEventListener('click', () => deps.open(back.window));
      content = el('div', 'snapshot-section');
      body.append(backBtn, content);
      draw();
    },
    live: draw,
  };
}

/** The culture, campaign, strain and inspector windows, or null for another id. */
export function detailWindowFor(id: string, deps: WindowDeps, params: WindowParams): WindowBuild | null {
  if (id in BACK) return inspector(deps, id, params);
  return cultureList(deps, id);
}

/** Ids this module builds. */
export const DETAIL_WINDOW_IDS: readonly string[] = [
  'list_hosts',
  'list_campaigns',
  'list_creeds',
  'list_customs',
  'list_dialects',
  'list_households',
  'list_intrigues',
  'list_strains',
  ...Object.keys(BACK),
];
