/**
 * The bottom power sheet (UX redesign, spec B). Collapsed it shows the category chips and the first three recent powers.
 * Expanded it adds search, the grouped grid of icons and the recent row. The sheet only shows state and calls the shell
 * actions: `activatePower` and the brush setters stay in main.ts.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { BrushShape } from '../../shared/protocol.ts';
import { POWER_BY_ID, type PowerDef } from '../../content/powers.ts';
import { artFor, chipArtFor, chunkOf, loadArt, loadPowerArt, loadPowerArtFor, powerArtFor, type ArtChunk } from '../../art/load.ts';
import { favourite, unfavourite } from '../panels/powerBar.ts';
import { CHIP_IDS, CHIP_LABELS, groupsOf, recentRow, searchPowers, type ChipId } from './powerCatalog.ts';
import { newPowerIds } from './discovery.ts';
import { PowerGlyph } from './glyphs.tsx';
import type { ShellActions, UiStore } from './store.ts';
import './PowerSheet.css';

/** Bumped when a creature art chunk finishes loading, so the icons that depend on it render again. */
const artVersion = signal(0);
/** Called when an art group finishes loading, so the icons and chips that depend on it render again. */
function onArtLoaded(): void {
  artVersion.value += 1;
}

/** Holding a power this long pins or unpins it as a favourite (ms). */
const LONG_PRESS_MS = 500;
/** Chips in the order the More list shows them. */
const ALL_CHIPS: readonly ChipId[] = CHIP_IDS;
const SHAPES: ReadonlyArray<{ id: BrushShape; label: string }> = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'diamond', label: 'Diamond' },
];

type PressRef = { current: { timer: number | null; fired: boolean } };

const uriCache = new Map<string, string>();
/** A data URI for an art SVG, cached per source string. */
function artUri(svg: string): string {
  let uri = uriCache.get(svg);
  if (uri === undefined) {
    uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    uriCache.set(svg, uri);
  }
  return uri;
}

/** The species a creature power spawns, or null for any other power. */
function speciesOf(power: PowerDef): string | null {
  return power.tab === 'beings' ? String(power.params['species'] ?? '') : null;
}

function PowerIcon({ power }: { power: PowerDef }) {
  void artVersion.value;
  const species = speciesOf(power);
  const svg = species !== null ? artFor(species) : powerArtFor(power);
  if (svg) return <img class="power-art" alt="" src={artUri(svg)} />;
  return <PowerGlyph power={power} />;
}

interface ButtonProps {
  power: PowerDef;
  armedId: string | null;
  pressedIds: readonly string[];
  unavailable: Readonly<Record<string, string>>;
  cooldowns: Readonly<Record<string, number>>;
  press: PressRef;
  isNew: boolean;
  onActivate: (id: string) => void;
  onFavourite: (id: string) => void;
}

/** One power as an icon button: armed and pressed state, unavailable note, cooldown ring, "New" marker, long-press and right-click pin. */
function PowerButton({ power, armedId, pressedIds, unavailable, cooldowns, press, isNew, onActivate, onFavourite }: ButtonProps) {
  const id = power.id;
  const pressed = armedId === id || pressedIds.includes(id);
  const note = unavailable[id] ?? null;
  const readyIn = power.cooldownMs > 0 ? (cooldowns[id] ?? 0) - performance.now() : 0;
  const cancelPress = (): void => {
    if (press.current.timer !== null) window.clearTimeout(press.current.timer);
    press.current.timer = null;
  };
  return (
    <button
      type="button"
      class={note !== null ? 'power-btn is-unavailable' : 'power-btn'}
      data-power-id={id}
      aria-label={power.name}
      aria-pressed={pressed ? 'true' : 'false'}
      aria-disabled={note !== null ? 'true' : undefined}
      title={note ?? `${power.name}. Press F to pin or unpin a favourite.`}
      onClick={() => {
        if (press.current.fired) {
          press.current.fired = false;
          return;
        }
        onActivate(id);
      }}
      onKeyDown={(e) => {
        // A key press is never a long press: clear the flag, so the Enter that follows activates the power.
        press.current.fired = false;
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
          e.preventDefault();
          onFavourite(id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // A long press has already toggled the favourite; the contextmenu that follows it does not toggle again.
        if (press.current.fired) return;
        cancelPress();
        onFavourite(id);
      }}
      onPointerDown={() => {
        cancelPress();
        press.current = {
          timer: window.setTimeout(() => {
            press.current.timer = null;
            press.current.fired = true;
            onFavourite(id);
          }, LONG_PRESS_MS),
          fired: false,
        };
      }}
      onPointerUp={() => {
        // The click for this release comes in the same task; clear the flag after it, so a long press swallows only its own click.
        const ref = press.current;
        window.setTimeout(() => {
          ref.fired = false;
        }, 0);
        cancelPress();
      }}
      onPointerLeave={() => {
        cancelPress();
        press.current.fired = false;
      }}
      onPointerCancel={() => {
        cancelPress();
        press.current.fired = false;
      }}
    >
      <span class="power-icon">
        <PowerIcon power={power} />
        {isNew && (
          <span class="power-new" aria-hidden="true">
            New
          </span>
        )}
        {readyIn > 0 && (
          <svg class="ring" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
            <circle cx="20" cy="20" r="17" pathLength={100} style={{ animationDuration: `${Math.ceil(readyIn)}ms` }} />
          </svg>
        )}
      </span>
      <span class="power-label">{power.name}</span>
    </button>
  );
}

export function PowerSheet({ store, actions }: { store: UiStore; actions: ShellActions }) {
  const sheet = store.sheet.value;
  const expanded = sheet === 'expanded';
  const discovered = store.discovered.value.filter((c): c is ChipId => (ALL_CHIPS as readonly string[]).includes(c));
  const [chipState, setChip] = useState<ChipId>('land');
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState('');
  const press = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const drag = useRef({ startY: 0, moved: false });
  const [clock, setClock] = useState(0);
  const cooldowns = store.cooldowns.value;
  const fresh = newPowerIds(store.found.value, store.seenPowers.value);
  // A "New" grid is seen when the player leaves it (a chip switch or a collapse): the markers show while it is open.
  // The ids wait here until then; the shell saves them as seen (markPowersSeen).
  const pendingSeen = useRef<string[]>([]);
  const commitSeen = (): void => {
    if (pendingSeen.current.length === 0) return;
    actions.markPowersSeen(pendingSeen.current);
    pendingSeen.current = [];
  };
  useEffect(() => () => commitSeen(), []);
  // A cooldown ring leaves when its cooldown ends: one timer re-renders the sheet at the next expiry, so the ring goes
  // even when reduced motion stops its animation.
  useEffect(() => {
    const now = performance.now();
    const ends = Object.values(cooldowns).filter((t) => t > now);
    if (ends.length === 0) return;
    const timer = window.setTimeout(() => setClock((c) => c + 1), Math.min(...ends) - now + 1);
    return () => window.clearTimeout(timer);
  }, [cooldowns, clock]);

  void artVersion.value;
  const chips: ChipId[] = moreOpen && expanded ? [...discovered, ...ALL_CHIPS.filter((c) => !discovered.includes(c))] : discovered;
  const activeChip = chips.includes(chipState) ? chipState : (chips[0] ?? 'land');
  const armed = store.armed.value;
  const armedPower = armed ? POWER_BY_ID.get(armed.powerId) : undefined;
  const recent = recentRow(store).map((id) => POWER_BY_ID.get(id)).filter((p): p is PowerDef => p !== undefined);

  const searching = query.trim() !== '';
  const groups = expanded && !searching ? groupsOf(activeChip) : [];
  const results = expanded && searching ? searchPowers(query) : [];
  const shown = searching ? results : groups.flatMap((g) => g.powers);
  if (expanded) {
    for (const power of shown) if (fresh.has(power.id) && !pendingSeen.current.includes(power.id)) pendingSeen.current.push(power.id);
  }
  useLayoutEffect(() => {
    if (!expanded) commitSeen();
  }, [expanded]);
  // Creature art loads per chunk, for the powers on screen (the grid or the search results) and the recent icons.
  const chunkKey = [...new Set([...shown, ...recent].flatMap((p) => (speciesOf(p) !== null ? [chunkOf(speciesOf(p) ?? '')] : [])))].sort().join(',');

  useEffect(() => {
    if (chunkKey === '') return;
    for (const chunk of chunkKey.split(',') as ArtChunk[]) {
      loadArt(chunk).then(onArtLoaded, () => undefined);
    }
  }, [chunkKey]);

  // Power art: the chips load with the sheet; every other power's group (and reused art) loads for the powers on screen,
  // the recent icons and the armed badge. A group that fails to load keeps its line glyph and is retried on the next open.
  const artPowers = [...shown, ...recent, ...(armedPower !== undefined ? [armedPower] : [])].filter((p) => speciesOf(p) === null);
  const powerArtKey = [...new Set(artPowers.map((p) => p.id))].sort().join(',');
  useEffect(() => {
    loadPowerArt('chips').then(onArtLoaded, () => undefined);
  }, []);
  useEffect(() => {
    if (powerArtKey === '') return;
    for (const id of powerArtKey.split(',')) {
      const power = POWER_BY_ID.get(id);
      if (power !== undefined) loadPowerArtFor(power).then(onArtLoaded, () => undefined);
    }
  }, [powerArtKey]);

  const setSheet = (next: 'collapsed' | 'expanded'): void => {
    store.sheet.value = next;
    if (next === 'collapsed') setMoreOpen(false);
  };
  const selectChip = (chip: ChipId): void => {
    commitSeen();
    setChip(chip);
    store.sheet.value = 'expanded';
  };
  const toggleFavourite = (id: string): void => {
    const list = store.favourites.value;
    store.favourites.value = list.includes(id) ? unfavourite(list, id) : favourite(list, id);
  };
  const onMore = (): void => {
    if (!expanded) {
      store.sheet.value = 'expanded';
      setMoreOpen(true);
      return;
    }
    setMoreOpen(!moreOpen);
  };
  const onChipKey = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const index = chips.indexOf(activeChip);
    const next = (index + (e.key === 'ArrowRight' ? 1 : chips.length - 1)) % chips.length;
    const chip = chips[next];
    if (chip === undefined) return;
    selectChip(chip);
    const tabs = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs?.[next]?.focus();
  };

  const button = (power: PowerDef) => (
    <PowerButton
      key={power.id}
      power={power}
      armedId={armed?.powerId ?? null}
      pressedIds={store.pressed.value}
      unavailable={store.unavailable.value}
      cooldowns={store.cooldowns.value}
      press={press}
      isNew={fresh.has(power.id)}
      onActivate={actions.activatePower}
      onFavourite={toggleFavourite}
    />
  );

  return (
    <nav class="power-sheet" data-sheet={sheet} aria-label="Powers">
      <div class="sheet-handle-row">
        <button
          type="button"
          class="sheet-handle"
          aria-expanded={expanded ? 'true' : 'false'}
          aria-label={expanded ? 'Collapse powers' : 'Expand powers'}
          onPointerDown={(e) => {
            drag.current = { startY: e.clientY, moved: false };
          }}
          onPointerUp={(e) => {
            const dy = e.clientY - drag.current.startY;
            if (Math.abs(dy) > 24) {
              drag.current.moved = true;
              setSheet(dy < 0 ? 'expanded' : 'collapsed');
            }
          }}
          onClick={() => {
            if (drag.current.moved) {
              drag.current.moved = false;
              return;
            }
            setSheet(expanded ? 'collapsed' : 'expanded');
          }}
        >
          <span class="handle-bar" aria-hidden="true" />
        </button>
        {!expanded && armedPower !== undefined && (
          <button type="button" class="armed-badge" aria-label={`Disarm ${armedPower.name}`} onClick={() => actions.disarm()}>
            <span class="armed-icon">
              <PowerIcon power={armedPower} />
            </span>
            <span class="armed-name">{armedPower.name}</span>
          </button>
        )}
      </div>

      <div class="sheet-bar">
        <div class="chips" role="tablist" aria-label="Power categories" aria-controls={expanded ? 'sheet-panel' : undefined}>
          {chips.map((chip) => {
            const selected = chip === activeChip;
            const art = chipArtFor(chip);
            return (
              <button
                key={chip}
                id={`chip-${chip}`}
                type="button"
                role="tab"
                class="chip"
                aria-selected={selected ? 'true' : 'false'}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectChip(chip)}
                onKeyDown={onChipKey}
              >
                {art !== null && <img class="chip-art" alt="" src={artUri(art)} />}
                {CHIP_LABELS[chip]}
              </button>
            );
          })}
        </div>
        <button type="button" class="chip more" aria-expanded={moreOpen && expanded ? 'true' : 'false'} onClick={onMore}>
          More ▾
        </button>
        {!expanded && (
          <div class="recent-mini" role="group" aria-label="Recent powers">
            {recent.slice(0, 3).map(button)}
          </div>
        )}
      </div>

      {armed !== null && armedPower?.kind === 'brush' && (
        <div class="brush-control" role="group" aria-label="Brush">
          <label class="brush-size">
            <span>Size</span>
            <input
              type="range"
              min="0"
              max="10"
              step="1"
              value={armed.brush.index}
              aria-label="Brush size"
              onInput={(e) => actions.setBrushSize(Number(e.currentTarget.value))}
            />
            <output>{armed.brush.radius}</output>
          </label>
          <div class="shapes" role="radiogroup" aria-label="Brush shape">
            {SHAPES.map((shape) => (
              <button
                key={shape.id}
                type="button"
                role="radio"
                class="shape"
                data-shape={shape.id}
                aria-checked={armed.brush.shape === shape.id ? 'true' : 'false'}
                onClick={() => actions.setBrushShape(shape.id)}
              >
                {shape.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {expanded && (
        <div id="sheet-panel" class="sheet-body" role="tabpanel" aria-labelledby={`chip-${activeChip}`}>
          <input
            type="search"
            class="search"
            aria-label="Search powers"
            placeholder="Search powers"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          {searching ? (
            <section class="power-group">
              <h3 class="group-head">
                Results <span class="count">{results.length}</span>
              </h3>
              <div class="power-grid" role="group" aria-label="Search results">
                {results.map(button)}
              </div>
            </section>
          ) : (
            groups.map((group) => (
              <section class="power-group" key={group.id}>
                <h3 class="group-head">
                  {group.label} <span class="count">{group.powers.length}</span>
                </h3>
                <div class="power-grid" role="group" aria-label={group.label}>
                  {group.powers.map(button)}
                </div>
              </section>
            ))
          )}
          {recent.length > 0 && (
            <section class="recent-row">
              <h3 class="group-head">Recent</h3>
              <div class="recent-items" role="group" aria-label="Recent">
                {recent.map(button)}
              </div>
            </section>
          )}
        </div>
      )}
    </nav>
  );
}
