/**
 * Windows added for the spec table (13 section 7.1) that read the sim snapshot, the session history
 * or the session memory: being, structure, pact, clan and item windows, the favourite and pact/clan/
 * item lists, the banner editors, the trait rain and trait editors, compare and annals. Where the sim
 * stores no such data, the window says which data is missing (MISSING in spec-model.ts); nothing is
 * invented. System windows (error, update, patch notes, dev tools) live in systemWindows.ts.
 */
import { BEING_TRAITS, STRAIN_TRAITS, type BeingTraitDef } from '../content/traits.ts';
import { ITEM_KINDS, ITEM_KIND_BY_ID, ITEM_SLOTS, type ItemKindDef } from '../content/items.ts';
import { YEAR_TICKS } from '../shared/constants.ts';
import { Cmd, type BeingRow, type ItemRow, type Snapshot, type StructureRow } from '../shared/protocol.ts';
import { listWindow } from './detailWindows.ts';
import { buildList, type FilterChoice, type ListHandle } from './listView.ts';
import { realmHistory } from './realm-history.ts';
import {
  BANNER_COLOURS,
  BANNER_ICONS,
  DEFAULT_BANNER,
  MISSING,
  ANNAL_GROUPS,
  annalRows,
  beingFacts,
  beingTitle,
  compareSeries,
  seriesMax,
  stageLabel,
  structureFacts,
  type AnnalRow,
  type CompareSeries,
  type Facts,
} from './spec-model.ts';
import {
  bannerOf,
  favouriteBeing,
  favouriteBeingList,
  setBanner,
  setFavouriteBeing,
  setTraitRain,
  syncFavouriteBeings,
  traitRainOf,
  type BannerKind,
  type RainSlot,
} from './session-memory.ts';
import { windowTitle } from './windowCatalog.ts';
import type { WindowBuild, WindowDeps, WindowParams } from './windowContent.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const snapOf = (deps: WindowDeps): Snapshot | null => deps.snapshot?.() ?? null;

const note = (text: string): HTMLElement => el('p', 'option-note', text);

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const btn = el('button', primary ? 'btn primary' : 'btn', label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

function factsList(facts: Facts): HTMLElement {
  const dl = el('dl', 'facts');
  for (const [k, v] of facts) dl.append(el('dt', undefined, k), el('dd', undefined, v));
  return dl;
}

/**
 * A section redrawn from the snapshot. The new content is built off-screen and swapped in only when
 * its markup changed, so buttons and fields keep focus while the sim runs (13 section 6: 5 Hz refresh).
 * The DOM is created by `mount()`, called from a window's build, so the builders load without a DOM.
 */
function liveSection(deps: WindowDeps, render: (snap: Snapshot | null, root: HTMLElement) => void): { mount: () => HTMLElement; refresh: () => void } {
  let node: HTMLElement | null = null;
  let last = '';
  const refresh = (): void => {
    if (node === null) return;
    const next = el('div');
    render(snapOf(deps), next);
    if (next.innerHTML === last) return;
    last = next.innerHTML;
    node.replaceChildren(...Array.from(next.childNodes));
  };
  const mount = (): HTMLElement => {
    node = el('div', 'snapshot-section');
    refresh();
    return node;
  };
  return { mount, refresh };
}

/** A window with a fixed message and optional buttons (made in build, not up front). */
function staticWindow(title: string, lines: readonly string[], actions: () => HTMLElement[] = () => []): WindowBuild {
  return {
    title,
    build: (body) => {
      for (const line of lines) body.append(note(line));
      body.append(...actions());
    },
  };
}

// Beings -----------------------------------------------------------------------------------------

function beingWindow(deps: WindowDeps, params: WindowParams): WindowBuild {
  const key = params.id;
  const section = liveSection(deps, (snap, root) => {
    if (key === undefined) {
      root.append(note('Choose a being from Interesting people in the Realm overview.'));
      return;
    }
    if (snap) syncFavouriteBeings(snap);
    const kept = favouriteBeing(key);
    if (snap === null && kept === undefined) {
      root.append(note('Reading the realm...'));
      return;
    }
    const live = snap?.detail?.notable?.beings.find((b) => b.id === key);
    const row: BeingRow | undefined = live ?? kept?.row;
    if (row === undefined) {
      root.append(note('This being is no longer in the realm.'));
      return;
    }
    if (live === undefined && kept) root.append(note(`Last seen at tick ${kept.seenTick}. It is not in the latest snapshot.`));
    root.append(factsList(beingFacts(row)));
    const starred = favouriteBeing(key) !== undefined;
    const star = button(starred ? 'Remove from favourites' : 'Add to favourites', () => {
      setFavouriteBeing(row, snap?.tick ?? kept?.seenTick ?? 0, !starred);
      section.refresh();
    });
    root.append(star);
    root.append(note('Gear, bonds, mind and intrigues are not stored for beings yet.'));
  });
  return {
    title: windowTitle('win_being'),
    build: (body) => {
      body.append(button('Back to realm overview', () => deps.open('win_realm')), section.mount());
    },
    live: () => section.refresh(),
  };
}

/**
 * Favourites first, then the oldest living beings the snapshot sends that are not starred yet, so the
 * list has rows before anything is starred. Pure apart from keeping the favourites' rows current.
 */
export function favouriteRowsOf(snap: Snapshot): { id: number; title: string; detail: string; inspector: string; params: WindowParams }[] {
  syncFavouriteBeings(snap);
  const notable = snap.detail?.notable?.beings ?? [];
  const alive = new Set(notable.map((b) => b.id));
  const favs = favouriteBeingList();
  const starred = new Set(favs.map((f) => f.id));
  const favRows = favs.map((f) => ({
    id: f.id,
    title: beingTitle(f.row),
    detail: alive.has(f.id) ? `Favourite · alive · ${stageLabel(f.row).toLowerCase()} · age ${f.row.ageYears}` : `Favourite · not seen since tick ${f.seenTick}`,
    inspector: 'win_being',
    params: { id: f.id },
  }));
  const oldest = notable
    .filter((b) => !starred.has(b.id))
    .map((b) => ({
      id: b.id,
      title: beingTitle(b),
      detail: `Oldest living, not a favourite · ${stageLabel(b).toLowerCase()} · age ${b.ageYears}`,
      inspector: 'win_being',
      params: { id: b.id },
    }));
  return [...favRows, ...oldest];
}

function favouriteBeingsList(deps: WindowDeps): WindowBuild {
  return listWindow(deps, {
    self: 'list_fav_beings',
    name: 'Favourite beings',
    rows: (snap) => favouriteRowsOf(snap),
    cut: (snap) => {
      const total = snap.detail?.notable?.beingCount ?? 0;
      const shown = snap.detail?.notable?.beings.length ?? 0;
      return total > shown ? `Showing the ${shown} oldest of ${total} living beings.` : null;
    },
    empty: 'No beings in the realm yet. Starred beings are kept here after they die.',
  });
}

// Structures -------------------------------------------------------------------------------------

function structureWindow(deps: WindowDeps, params: WindowParams): WindowBuild {
  const key = params.id;
  const section = liveSection(deps, (snap, root) => {
    if (key === undefined) {
      root.append(note("Choose a structure from a hamlet's inspector."));
      return;
    }
    if (snap === null) {
      root.append(note('Reading the realm...'));
      return;
    }
    const row: StructureRow | undefined = snap.detail?.notable?.structures.find((s) => s.id === key);
    if (row === undefined) {
      root.append(note('This structure is no longer in the realm, or is not in the latest snapshot.'));
      return;
    }
    root.append(factsList(structureFacts(row, snap)), note(MISSING.structures));
  });
  return {
    title: windowTitle('win_structure'),
    build: (body) => {
      body.append(button('Back to hamlets', () => deps.open('list_hamlets')), section.mount());
    },
    live: () => section.refresh(),
  };
}

// Pacts, clans and items -------------------------------------------------------------------------

/** Note under a pact: what the sim does not store about pacts yet (members, campaigns, renown). */
const PACT_LIMITS = 'Pact terms are not stored yet: members, campaigns and renown. A pact here is peace between two bordering dominions.';

/** One row per peace pact in the snapshot (pure: the tests read it without a DOM). */
export function pactRowsOf(snap: Snapshot): { id: number; title: string; detail: string; inspector: string; params: WindowParams }[] {
  return (snap.pacts?.rows ?? []).map((p) => ({
    id: p.id,
    title: `${p.nameA} and ${p.nameB}`,
    detail: `Peace · strength ${p.strengthA} and ${p.strengthB}`,
    inspector: 'win_pact',
    params: { id: p.id },
  }));
}

function pactWindow(deps: WindowDeps, params: WindowParams): WindowBuild {
  const key = params.id;
  const section = liveSection(deps, (snap, root) => {
    if (key === undefined) {
      root.append(note('Choose a pact from the Pacts list.'));
      return;
    }
    if (snap === null) {
      root.append(note('Reading the realm...'));
      return;
    }
    const row = snap.pacts?.rows.find((p) => p.id === key);
    if (row === undefined) {
      root.append(note('This pact is no longer in the realm, or is not in the latest snapshot.'));
      return;
    }
    const facts: Facts = [
      ['Between', `${row.nameA} and ${row.nameB}`],
      ['Relation', 'Peace'],
      ['Border', 'Shared'],
      [`${row.nameA} strength`, String(row.strengthA)],
      [`${row.nameB} strength`, String(row.strengthB)],
      [`${row.nameA} parcels`, String(row.parcelsA)],
      [`${row.nameB} parcels`, String(row.parcelsB)],
    ];
    root.append(factsList(facts), note(PACT_LIMITS));
  });
  return {
    title: windowTitle('win_pact'),
    build: (body) => {
      body.append(button('Back to pacts', () => deps.open('list_pacts')), section.mount());
    },
    live: () => section.refresh(),
  };
}

function pactsList(deps: WindowDeps): WindowBuild {
  return listWindow(deps, {
    self: 'list_pacts',
    name: 'Pacts',
    rows: (snap) => pactRowsOf(snap),
    cut: (snap) => {
      const block = snap.pacts;
      return block && block.count > block.rows.length ? `Showing ${block.rows.length} of ${block.count} pacts.` : null;
    },
    empty: 'No peace pacts yet. A pact is peace between two dominions that share a border.',
  });
}

// Clans (kinbands) -------------------------------------------------------------------------------

/** Note under a clan: what the sim does not do with clans yet. */
const CLAN_LIMITS =
  'A clan is the living members of one strain, founded once the strain has four members. The chief is the oldest living member. Clans do not split, merge or refuse births yet: the member limit is recorded, not enforced.';

/** Calendar year of a tick (02 section 1: a Year is 1200 ticks, years count from 1). */
const yearOf = (tick: number): number => Math.floor(tick / YEAR_TICKS) + 1;

/** One row per clan in the snapshot, living clans first (pure: the tests read it without a DOM). */
export function clanRowsOf(snap: Snapshot): { id: number; title: string; detail: string; inspector: string; params: WindowParams }[] {
  return (snap.clans?.rows ?? []).map((c) => ({
    id: c.id,
    title: c.name,
    detail: c.extinct
      ? `Extinct · ${c.species} · founded in year ${yearOf(c.foundedTick)}`
      : `${c.members} ${c.members === 1 ? 'member' : 'members'} · ${c.species} · chief ${c.chiefAgeYears} years old`,
    inspector: 'win_clan',
    params: { id: c.id },
  }));
}

/** Clan inspector: the record's facts from the snapshot, and a link to the strain it grew from. */
function clanWindow(deps: WindowDeps, params: WindowParams): WindowBuild {
  const key = params.id;
  const section = liveSection(deps, (snap, root) => {
    if (key === undefined) {
      root.append(note('Choose a clan from the Clans list.'));
      return;
    }
    if (snap === null) {
      root.append(note('Reading the realm...'));
      return;
    }
    const row = snap.clans?.rows.find((c) => c.id === key);
    if (row === undefined) {
      root.append(note('This clan is no longer in the realm, or is not in the latest snapshot.'));
      return;
    }
    const facts: Facts = [
      ['Name', row.name],
      ['Status', row.extinct ? 'Extinct' : 'Living'],
      ['Founded', `Year ${yearOf(row.foundedTick)}`],
      ['Species', row.species],
      ['Strain', row.strainName || `Strain ${row.strain}`],
      ['Members', `${row.members} of ${row.limit} allowed`],
      ['Chief', row.chief >= 0 ? `Oldest living member, ${row.chiefAgeYears} years old` : 'None: no living member'],
    ];
    root.append(factsList(facts), button('Open strain', () => deps.open('win_strain', { id: row.strain })), note(CLAN_LIMITS));
  });
  return {
    title: windowTitle('win_clan'),
    build: (body) => {
      body.append(button('Back to clans', () => deps.open('list_kinbands')), section.mount());
    },
    live: () => section.refresh(),
  };
}

function clanList(deps: WindowDeps): WindowBuild {
  return listWindow(deps, {
    self: 'list_kinbands',
    name: 'Clans',
    rows: (snap) => clanRowsOf(snap),
    cut: (snap) => {
      const block = snap.clans;
      return block && block.count > block.rows.length ? `Showing ${block.rows.length} of ${block.count} clans.` : null;
    },
    empty: 'No clans yet. A clan forms when a strain has four living members.',
  });
}

// Items (08 section 6) -----------------------------------------------------------------------------

const QUALITY_LABELS: readonly string[] = ['Common', 'Uncommon', 'Rare', 'Legendary'];
const SLOT_LABELS: Readonly<Record<string, string>> = {
  weapon: 'Weapon',
  helm: 'Helm',
  body: 'Body armour',
  boots: 'Boots',
  ring: 'Ring',
  amulet: 'Amulet',
};

/** Where an item is kept, in words (the snapshot gives the holder and its place). */
function holderText(row: ItemRow): string {
  if (row.holder === 'worn') return 'Worn by a being';
  if (row.holder === 'stock') return `In the stock of hamlet ${row.at + 1}`;
  return 'Not held';
}

/** Facts of one item row (inspector and the list detail line share the words). */
export function itemFacts(row: ItemRow): Facts {
  const kind = ITEM_KIND_BY_ID.get(row.kind);
  const stats = Object.entries(kind?.stats ?? {}).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`);
  return [
    ['Kind', row.name],
    ['Slot', SLOT_LABELS[row.slot] ?? row.slot],
    ['Quality', QUALITY_LABELS[row.quality] ?? String(row.quality)],
    ['Value', String(row.value)],
    ['Durability', String(row.durability)],
    ['Modifiers', row.mods.length > 0 ? row.mods.join(', ') : 'None'],
    ['Stats', stats.length > 0 ? stats.join(', ') : 'None'],
    ['Held', holderText(row)],
    ['Favourite', row.favourite ? 'Yes' : 'No'],
  ];
}

/** Favourite items first, then the other items the snapshot sends (the list is never empty once an item exists). */
export function itemRowsOf(snap: Snapshot): { id: number; title: string; detail: string; inspector: string; params: WindowParams }[] {
  const rows = snap.items?.rows ?? [];
  const ordered = [...rows.filter((r) => r.favourite), ...rows.filter((r) => !r.favourite)];
  return ordered.map((r) => ({
    id: r.id,
    title: r.name,
    detail: `${r.favourite ? 'Favourite' : 'Item'} · ${SLOT_LABELS[r.slot] ?? r.slot} · ${QUALITY_LABELS[r.quality] ?? ''} · ${holderText(r).toLowerCase()}`,
    inspector: 'win_item',
    params: { id: r.id },
  }));
}

function favouriteItemsList(deps: WindowDeps): WindowBuild {
  return listWindow(deps, {
    self: 'list_fav_items',
    name: 'Favourite items',
    rows: (snap) => itemRowsOf(snap),
    cut: (snap) => {
      const block = snap.items;
      return block && block.count > block.rows.length ? `Showing ${block.rows.length} of ${block.count} items.` : null;
    },
    empty: 'No items in the realm yet. Use Item rain from the powers to drop some on beings.',
  });
}

function itemWindow(deps: WindowDeps, params: WindowParams): WindowBuild {
  const key = params.id;
  const section = liveSection(deps, (snap, root) => {
    if (key === undefined) {
      root.append(note('Choose an item from the Favourite items list.'));
      return;
    }
    if (snap === null) {
      root.append(note('Reading the realm...'));
      return;
    }
    const row = snap.items?.rows.find((r) => r.id === key);
    if (row === undefined) {
      root.append(note('This item is no longer in the realm, or is not in the latest snapshot.'));
      return;
    }
    root.append(factsList(itemFacts(row)));
    root.append(
      button(row.favourite ? 'Remove from favourites' : 'Add to favourites', () => {
        deps.sendCommand?.({ kind: Cmd.SetItemFavourite, itemId: row.id, on: !row.favourite });
      }),
    );
  });
  return {
    title: windowTitle('win_item'),
    build: (body) => {
      body.append(button('Back to favourite items', () => deps.open('list_fav_items')), section.mount());
    },
    live: () => section.refresh(),
  };
}

/** Gear editor: one select per equipment slot of the chosen being. Each change is a SetGear command. */
function gearEditorWindow(deps: WindowDeps, params: WindowParams): WindowBuild {
  const key = params.id;
  const section = liveSection(deps, (snap, root) => {
    if (snap === null) {
      root.append(note('Reading the realm...'));
      return;
    }
    const beings = snap.detail?.notable?.beings ?? [];
    if (key === undefined) {
      root.append(note('Choose a being to equip. The oldest living beings are listed here.'));
      for (const b of beings) {
        root.append(button(beingTitle(b), () => deps.open('win_gear_editor', { id: b.id })));
      }
      return;
    }
    const being = beings.find((b) => b.id === key);
    if (being === undefined) {
      root.append(note('This being is no longer in the realm, or is not in the latest snapshot. Choose another being.'));
      return;
    }
    const worn = snap.items?.gear.find((g) => g.being === key)?.kinds ?? ITEM_SLOTS.map(() => '');
    root.append(note(`Equipping ${beingTitle(being)}. Changes apply on the next tick and recalculate its stats.`));
    ITEM_SLOTS.forEach((slotName, k) => {
      const row = el('div', 'gear-row');
      const label = el('label', undefined, SLOT_LABELS[slotName] ?? slotName);
      const select = el('select', 'gear-select');
      select.style.minHeight = '44px';
      const id = `gear-${key}-${slotName}`;
      select.id = id;
      label.htmlFor = id;
      const empty = el('option', undefined, 'Empty');
      empty.value = '';
      select.append(empty);
      for (const kind of ITEM_KINDS) {
        if (kind.slot !== slotName) continue;
        const opt = el('option', undefined, kind.name);
        opt.value = kind.id;
        select.append(opt);
      }
      select.value = worn[k] ?? '';
      select.addEventListener('change', () => {
        deps.sendCommand?.({ kind: Cmd.SetGear, beingId: key, slot: slotName, item: select.value === '' ? null : select.value });
      });
      row.append(label, select);
      root.append(row);
    });
  });
  return {
    title: windowTitle('win_gear_editor'),
    build: (body) => {
      body.append(button('Choose another being', () => deps.open('win_gear_editor')), section.mount());
    },
    live: () => section.refresh(),
  };
}

/** Item rain editor: the kinds the rain draws from, a Rain button that drops items near the realm centre, and Clear. */
function itemRainWindow(deps: WindowDeps): WindowBuild {
  return {
    title: windowTitle('win_item_rain_edit'),
    build: (body) => {
      const current = (): string[] => snapOf(deps)?.items?.rain ?? [];
      body.append(note('Item rain gives one item from this list to each being near the drop point. An empty list rains any kind.'));
      const actions = el('div', 'tabs');
      actions.append(
        button('Rain on the realm centre', () => {
          const side = deps.realm().side;
          deps.sendCommand?.({ kind: Cmd.ItemRain, x: Math.floor(side / 2), y: Math.floor(side / 2), radius: 12 });
        }),
        button('Clear the list', () => deps.sendCommand?.({ kind: Cmd.SetItemRain, ids: [] })),
      );
      body.append(actions);
      const listHost = el('div');
      buildList<ItemKindDef>(listHost, {
        name: 'Item rain kinds',
        items: ITEM_KINDS,
        rowHeight: 56,
        label: (k) => k.name,
        sorts: [{ key: 'name', label: 'Name' }],
        filters: [
          { id: 'all', label: 'All', test: () => true },
          { id: 'in', label: 'In rain', test: (k) => current().includes(k.id) },
        ],
        empty: 'No item kinds.',
        render: (k) => {
          const row = el('label', 'option option-check');
          const input = el('input');
          input.type = 'checkbox';
          input.checked = current().includes(k.id);
          input.setAttribute('aria-label', `${k.name} in item rain`);
          input.addEventListener('change', () => {
            const rest = current().filter((x) => x !== k.id);
            deps.sendCommand?.({ kind: Cmd.SetItemRain, ids: input.checked ? [...rest, k.id] : rest });
          });
          row.append(input, el('span', undefined, `${k.name} (${SLOT_LABELS[k.slot] ?? k.slot})`));
          return row;
        },
      });
      body.append(listHost);
    },
  };
}

function emptyList(deps: WindowDeps, self: string, name: string, empty: string): WindowBuild {
  return listWindow(deps, { self, name, rows: () => [], empty });
}

// Banner editors ---------------------------------------------------------------------------------

/** The window each banner editor returns to (the inspector it opens from). */
const CUSTOMIZE_BACK: Readonly<Record<BannerKind, { window: string; label: string }>> = {
  dominion: { window: 'win_dominion', label: 'Back to dominion' },
  hamlet: { window: 'win_hamlet', label: 'Back to hamlet' },
  pact: { window: 'list_pacts', label: 'Back to pacts' },
  clan: { window: 'list_kinbands', label: 'Back to clans' },
  family: { window: 'win_family', label: 'Back to family' },
  creed: { window: 'win_creed', label: 'Back to creed' },
  custom: { window: 'win_custom', label: 'Back to custom' },
  dialect: { window: 'win_dialect', label: 'Back to dialect' },
  strain: { window: 'win_strain', label: 'Back to strain' },
};


/** Swatch grid and icon grid for one object's banner. Choices apply at once to the preview (13 section 6). */
function customizeWindow(deps: WindowDeps, kind: BannerKind, params: WindowParams): WindowBuild {
  const id: number | string = params.id ?? 0;
  const title = windowTitle(`win_customize_${kind}`);
  const back = CUSTOMIZE_BACK[kind];
  return {
    title,
    build: (body) => {
      body.append(button(back.label, () => deps.open(back.window, params)));
      body.append(note(MISSING.banners));
      const current = (): { colour: string; icon: string } => bannerOf(kind, id) ?? DEFAULT_BANNER;
      const preview = el('div', 'banner-preview');
      preview.setAttribute('role', 'img');
      const paint = (): void => {
        const b = current();
        preview.style.background = b.colour;
        const colourName = BANNER_COLOURS.find((c) => c.hex === b.colour)?.name ?? b.colour;
        preview.setAttribute('aria-label', `Banner preview for ${kind}: ${colourName} with the ${b.icon} icon`);
        preview.textContent = b.icon;
      };
      const colourGroup = el('div', 'swatch-grid');
      colourGroup.setAttribute('role', 'radiogroup');
      colourGroup.setAttribute('aria-label', 'Banner colour');
      const iconGroup = el('div', 'icon-grid');
      iconGroup.setAttribute('role', 'radiogroup');
      iconGroup.setAttribute('aria-label', 'Banner icon');
      const colourButtons: HTMLButtonElement[] = [];
      const iconButtons: HTMLButtonElement[] = [];
      const markChecked = (list: readonly HTMLButtonElement[], value: string): void => {
        for (const b of list) b.setAttribute('aria-checked', String(b.dataset['value'] === value));
      };
      for (const c of BANNER_COLOURS) {
        const btn = el('button', 'swatch');
        btn.type = 'button';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-label', c.name);
        btn.dataset['value'] = c.hex;
        btn.style.background = c.hex;
        btn.addEventListener('click', () => {
          setBanner(kind, id, { colour: c.hex, icon: current().icon });
          markChecked(colourButtons, c.hex);
          paint();
        });
        colourButtons.push(btn);
        colourGroup.append(btn);
      }
      for (const name of BANNER_ICONS) {
        const btn = el('button', 'icon-choice', name);
        btn.type = 'button';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-label', `${name} icon`);
        btn.dataset['value'] = name;
        btn.addEventListener('click', () => {
          setBanner(kind, id, { colour: current().colour, icon: name });
          markChecked(iconButtons, name);
          paint();
        });
        iconButtons.push(btn);
        iconGroup.append(btn);
      }
      const b0 = current();
      markChecked(colourButtons, b0.colour);
      markChecked(iconButtons, b0.icon);
      paint();
      const reset = button('Reset banner', () => {
        setBanner(kind, id, DEFAULT_BANNER);
        markChecked(colourButtons, DEFAULT_BANNER.colour);
        markChecked(iconButtons, DEFAULT_BANNER.icon);
        paint();
      });
      body.append(preview, colourGroup, iconGroup, reset);
    },
  };
}

// Compare and annals -----------------------------------------------------------------------------

const SERIES_COLOURS: readonly string[] = ['#2c7a7b', '#b7791f', '#6b46c1', '#9b2c2c'];
const COMPARE_MAX = 4;

function chartSvg(series: readonly CompareSeries[], ticks: readonly number[]): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 320;
  const H = 160;
  const pad = 28;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'compare-chart');
  svg.setAttribute('role', 'img');
  const names = series.map((s) => s.name).join(', ');
  svg.setAttribute('aria-label', `Strength of ${names} over ${ticks.length} snapshots`);
  const minTick = ticks[0] ?? 0;
  const maxTick = ticks[ticks.length - 1] ?? minTick;
  const max = seriesMax(series);
  const x = (t: number): number => (maxTick === minTick ? pad : pad + ((t - minTick) / (maxTick - minTick)) * (W - pad - 6));
  const y = (v: number): number => H - pad - (v / max) * (H - pad - 6);
  const axis = document.createElementNS(NS, 'path');
  axis.setAttribute('d', `M${pad} 6 V${H - pad} H${W - 6}`);
  axis.setAttribute('class', 'chart-axis');
  svg.append(axis);
  const scale = document.createElementNS(NS, 'text');
  scale.setAttribute('x', '2');
  scale.setAttribute('y', '12');
  scale.textContent = String(max);
  svg.append(scale);
  series.forEach((s, i) => {
    if (s.points.length === 0) return;
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', s.points.map((p) => `${x(p.tick).toFixed(1)},${y(p.value).toFixed(1)}`).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', SERIES_COLOURS[i % SERIES_COLOURS.length] ?? '#2c7a7b');
    line.setAttribute('stroke-width', '2');
    svg.append(line);
  });
  return svg;
}

function compareWindow(deps: WindowDeps): WindowBuild {
  let picked: number[] = [];
  let pickedKey = '';
  let outKey = '';
  // The two regions are made in build(), so this builder loads without a DOM.
  let picks: HTMLElement | null = null;
  let output: HTMLElement | null = null;

  const drawPicks = (snap: Snapshot | null): void => {
    if (picks === null) return;
    const dominions = snap?.dominions ?? [];
    const key = dominions.map((d) => `${d.id}:${d.name}`).join('|');
    if (key === pickedKey) return;
    pickedKey = key;
    picks.replaceChildren();
    if (picked.length === 0 && dominions.length > 0) picked = dominions.slice(0, 2).map((d) => d.id);
    for (const d of dominions) {
      const on = picked.includes(d.id);
      const btn = el('button', 'btn list-chip', d.name);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(on));
      btn.addEventListener('click', () => {
        if (picked.includes(d.id)) picked = picked.filter((x) => x !== d.id);
        else if (picked.length < COMPARE_MAX) picked = [...picked, d.id];
        btn.setAttribute('aria-pressed', String(picked.includes(d.id)));
        drawOutput(snapOf(deps));
      });
      picks.append(btn);
    }
    if (dominions.length === 0) picks.append(note('No dominions in the realm yet.'));
  };

  const drawOutput = (snap: Snapshot | null): void => {
    if (output === null) return;
    const samples = realmHistory.all;
    const series = compareSeries(samples, picked);
    const next = el('div');
    if (snap === null) next.append(note('Reading the realm...'));
    else if (picked.length === 0) next.append(note(`Choose up to ${COMPARE_MAX} dominions.`));
    else if (samples.length < 2) next.append(note('Not enough snapshots yet. The chart fills in as the realm runs.'));
    else {
      next.append(chartSvg(series, samples.map((s) => s.tick)));
      const legend = el('ul', 'compare-legend');
      series.forEach((s, i) => {
        const li = el('li', undefined, `${s.name}`);
        li.style.borderLeftColor = SERIES_COLOURS[i % SERIES_COLOURS.length] ?? '#2c7a7b';
        legend.append(li);
      });
      next.append(legend);
      const table = el('table', 'compare-table');
      const thead = el('thead');
      const headRow = el('tr');
      for (const h of ['Dominion', 'Strength now', 'Parcels now']) headRow.append(el('th', undefined, h));
      thead.append(headRow);
      const tbody = el('tbody');
      for (const id of picked) {
        const d = snap.dominions.find((x) => x.id === id);
        const tr = el('tr');
        tr.append(el('th', undefined, d?.name ?? `Dominion ${id}`), el('td', undefined, d ? String(d.strength) : 'Gone'), el('td', undefined, d ? String(d.parcels) : 'Gone'));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      next.append(table);
    }
    next.append(note(MISSING.compare));
    const key = next.innerHTML;
    if (key === outKey) return;
    outKey = key;
    output.replaceChildren(...Array.from(next.childNodes));
  };

  const refresh = (): void => {
    const snap = snapOf(deps);
    drawPicks(snap);
    drawOutput(snap);
  };
  return {
    title: windowTitle('win_compare'),
    build: (body) => {
      picks = el('div', 'compare-picks');
      picks.setAttribute('role', 'group');
      picks.setAttribute('aria-label', 'Dominions to compare');
      output = el('div', 'snapshot-section');
      output.setAttribute('aria-live', 'polite');
      body.append(picks, output);
      refresh();
    },
    live: refresh,
  };
}

function annalsWindow(): WindowBuild {
  let handle: ListHandle | null = null;
  return {
    title: windowTitle('win_annals'),
    build: (body) => {
      body.append(note(MISSING.annals));
      handle = buildList<AnnalRow>(body, {
        name: 'Annals',
        items: () => annalRows(realmHistory.all),
        rowHeight: 56,
        label: (r) => r.label,
        sorts: [
          { key: 'tick', label: 'Time' },
          { key: 'delta', label: 'Change' },
        ],
        filters: [
          { id: 'all', label: 'All', test: () => true },
          ...ANNAL_GROUPS.map((g): FilterChoice<AnnalRow> => ({ id: g.toLowerCase(), label: g, test: (r) => r.group === g })),
        ],
        empty: 'No changes yet. Changes appear as the realm runs and the snapshots arrive.',
        render: (r) => {
          const row = el('div', 'rule-row');
          const text = el('div', 'rule-text');
          text.append(el('strong', undefined, r.label), el('span', 'option-note', `+${r.delta} at tick ${r.tick} · ${r.group}`));
          row.append(text);
          return row;
        },
      });
    },
    // The list reads the session history, so each snapshot can add rows.
    live: () => handle?.refresh(),
  };
}

// Trait editing ----------------------------------------------------------------------------------

function traitEditorWindow(deps: WindowDeps, params: WindowParams): WindowBuild {
  const key = params.id;
  const isStrain = params.kind === 'strain';
  const section = liveSection(deps, (snap, root) => {
    if (!isStrain || key === undefined) {
      root.append(note('Choose a strain from the Strains list, then use Edit traits.'));
      return;
    }
    if (snap === null) {
      root.append(note('Reading the realm...'));
      return;
    }
    const strain = snap.detail?.strains.find((s) => s.id === key);
    if (!strain) {
      root.append(note('This strain is no longer in the realm.'));
      return;
    }
    root.append(el('h3', undefined, `Traits of ${strain.name}`));
    if (strain.traits.length === 0) root.append(note('No strain traits.'));
    else {
      const ul = el('ul', 'snapshot-bars');
      for (const t of strain.traits) {
        const li = el('li');
        const remove = button(`Remove ${t}`, () => undefined);
        remove.disabled = true;
        remove.setAttribute('aria-label', `Remove ${t}`);
        li.append(el('span', undefined, t), remove);
        ul.append(li);
      }
      root.append(ul);
    }
    const select = el('select');
    select.setAttribute('aria-label', 'Trait to add');
    for (const t of STRAIN_TRAITS) {
      if (strain.traits.includes(t.name)) continue;
      const opt = el('option', undefined, t.name);
      opt.value = t.id;
      select.append(opt);
    }
    const add = button('Add trait', () => undefined);
    add.disabled = true;
    root.append(select, add, note(MISSING.traitEdits));
  });
  return {
    title: windowTitle('win_trait_editor'),
    build: (body) => {
      body.append(button('Back to strain', () => deps.open('win_strain', key === undefined ? {} : { id: key })), section.mount());
    },
    live: () => section.refresh(),
  };
}

function traitRainWindow(): WindowBuild {
  return {
    title: windowTitle('win_trait_rain_edit'),
    build: (body) => {
      body.append(note(MISSING.traitRain));
      const tabs = el('div', 'tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Trait rain');
      const listHost = el('div');
      let slot: RainSlot = 'A';
      const slotTabs: HTMLButtonElement[] = [];
      const showSlot = (): void => {
        for (const t of slotTabs) t.setAttribute('aria-selected', String(t.dataset['slot'] === slot));
        listHost.replaceChildren();
        buildList<BeingTraitDef>(listHost, {
          name: `Trait rain ${slot}`,
          items: BEING_TRAITS,
          rowHeight: 56,
          label: (t) => t.name,
          sorts: [{ key: 'name', label: 'Name' }],
          filters: [
            { id: 'all', label: 'All', test: () => true },
            { id: 'in', label: 'In rain', test: (t) => traitRainOf(slot).includes(t.id) },
          ],
          empty: 'No traits.',
          render: (t) => {
            const row = el('label', 'option option-check');
            const input = el('input');
            input.type = 'checkbox';
            input.checked = traitRainOf(slot).includes(t.id);
            input.setAttribute('aria-label', `${t.name} in trait rain ${slot}`);
            input.addEventListener('change', () => {
              const current = traitRainOf(slot).filter((x) => x !== t.id);
              setTraitRain(slot, input.checked ? [...current, t.id] : current);
            });
            row.append(input, el('span', undefined, t.name));
            return row;
          },
        });
      };
      for (const s of ['A', 'B', 'C'] as const) {
        const btn = el('button', 'btn', `Rain ${s}`);
        btn.type = 'button';
        btn.setAttribute('role', 'tab');
        btn.dataset['slot'] = s;
        btn.addEventListener('click', () => {
          slot = s;
          showSlot();
        });
        slotTabs.push(btn);
        tabs.append(btn);
      }
      body.append(tabs, listHost);
      showSlot();
    },
  };
}

// Dispatch ---------------------------------------------------------------------------------------

const BANNER_IDS: ReadonlyArray<BannerKind> = ['dominion', 'hamlet', 'pact', 'clan', 'family', 'creed', 'custom', 'dialect', 'strain'];

/** The spec window for `id`, or null when it is not one of these. */
export function specWindowFor(id: string, deps: WindowDeps, params: WindowParams = {}): WindowBuild | null {
  const banner = BANNER_IDS.find((k) => id === `win_customize_${k}`);
  if (banner) return customizeWindow(deps, banner, params);
  switch (id) {
    case 'win_being':
      return beingWindow(deps, params);
    case 'list_fav_beings':
      return favouriteBeingsList(deps);
    case 'win_item':
      return itemWindow(deps, params);
    case 'list_fav_items':
      return favouriteItemsList(deps);
    case 'win_structure':
      return structureWindow(deps, params);
    case 'win_pact':
      return pactWindow(deps, params);
    case 'list_pacts':
      return pactsList(deps);
    case 'win_clan':
      return clanWindow(deps, params);
    case 'list_kinbands':
      return clanList(deps);
    case 'win_compare':
      return compareWindow(deps);
    case 'win_annals':
      return annalsWindow();
    case 'win_trait_editor':
      return traitEditorWindow(deps, params);
    case 'win_trait_rain_edit':
      return traitRainWindow();
    case 'win_item_rain_edit':
      return itemRainWindow(deps);
    case 'win_gear_editor':
      return gearEditorWindow(deps, params);
    default:
      return null;
  }
}

/** Ids this module builds (for the catalogue test). */
export const SPEC_WINDOW_IDS: readonly string[] = [
  ...BANNER_IDS.map((k) => `win_customize_${k}`),
  'win_being',
  'list_fav_beings',
  'win_item',
  'list_fav_items',
  'win_structure',
  'win_pact',
  'list_pacts',
  'win_clan',
  'list_kinbands',
  'win_compare',
  'win_annals',
  'win_trait_editor',
  'win_trait_rain_edit',
  'win_item_rain_edit',
  'win_gear_editor',
];
