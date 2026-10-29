/**
 * Atlas Settings (UX redesign, spec C): the settings in collapsible groups with a search. Each row keeps the old
 * semantics: a bool is a checkbox, an int a range with its value shown, a choice a select. Settings whose feature is
 * not built yet say so. The developer windows are listed here only while "Show developer tools" is on.
 */
import { useState } from 'preact/hooks';
import { render } from 'preact';
import { GROUP_LABELS, SETTINGS, choiceLabel, resetGroup, type OptionGroup, type OptionValue, type Options, type SettingDef } from '../panels/options.ts';
import type { WindowDeps } from '../windowContent.ts';
import { devSections } from './atlasRoutes.ts';
import { keyRows } from './keymap.ts';

const GROUPS = Object.keys(GROUP_LABELS) as OptionGroup[];

function SettingRow({ def, value, onChange }: { def: SettingDef; value: OptionValue; onChange: (v: OptionValue) => void }) {
  const note = def.live ? '' : ' (saved; not active yet)';
  if (def.kind === 'bool') {
    return (
      <label class="option option-check">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.currentTarget.checked)} />
        <span>{def.label + note}</span>
      </label>
    );
  }
  if (def.kind === 'int') {
    return (
      <div class="option">
        <span>
          {def.label} <output>{String(value)}</output>
          {note !== '' && <span class="option-note">{note}</span>}
        </span>
        <input
          type="range"
          aria-label={def.label}
          min={def.min ?? 0}
          max={def.max ?? 100}
          step={((def.max ?? 100) - (def.min ?? 0)) >= 50 ? 5 : 1}
          value={Number(value)}
          onInput={(e) => onChange(Number(e.currentTarget.value))}
        />
      </div>
    );
  }
  const choices = def.choices ?? [];
  return (
    <label class="option">
      <span>
        {def.label}
        {note !== '' && <span class="option-note">{note}</span>}
      </span>
      <select
        value={String(value)}
        onChange={(e) => {
          const picked = choices.find((c) => String(c) === e.currentTarget.value);
          if (picked !== undefined) onChange(picked);
        }}
      >
        {choices.map((choice) => (
          <option key={String(choice)} value={String(choice)}>
            {choice === 0 && def.id === 'ui.fpsCap' ? 'display rate' : choiceLabel(def.id, choice)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SettingsPanel({ deps, onDone }: { deps: WindowDeps; onDone?: () => void }) {
  const [options, setOptions] = useState<Options>(() => deps.options());
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<ReadonlySet<OptionGroup>>(() => new Set());
  const q = query.trim().toLowerCase();
  const devTools = options['dev.enabled'] === true;

  /** Writes one setting and re-reads the options so the row shows the stored value. */
  const write = (id: string, value: OptionValue): void => {
    deps.setOption(id, value);
    setOptions(deps.options());
  };
  const toggleGroup = (group: OptionGroup): void => {
    const next = new Set(folded);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setFolded(next);
  };
  const resetOne = (group: OptionGroup): void => {
    const next = resetGroup(deps.options(), group);
    for (const s of SETTINGS) if (s.group === group) deps.setOption(s.id, next[s.id] ?? s.def);
    setOptions(deps.options());
  };
  const resetAll = (): void => {
    for (const s of SETTINGS) deps.setOption(s.id, s.def);
    setOptions(deps.options());
  };

  return (
    <div class="settings-panel">
      <input
        type="search"
        class="search"
        aria-label="Search settings"
        placeholder="Search settings"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <div class="settings-groups">
        {GROUPS.map((group) => {
          const rows = SETTINGS.filter((s) => s.group === group && (q === '' || s.label.toLowerCase().includes(q)));
          if (q !== '' && rows.length === 0) return null;
          const expanded = q !== '' || !folded.has(group);
          const bodyId = `settings-${group}`;
          return (
            <fieldset class="settings-group" key={group}>
              <legend>
                <button type="button" class="settings-toggle" aria-expanded={expanded ? 'true' : 'false'} aria-controls={bodyId} onClick={() => toggleGroup(group)}>
                  {GROUP_LABELS[group]}
                </button>
              </legend>
              <div id={bodyId} class="settings-rows" hidden={!expanded}>
                {rows.map((s) => (
                  <SettingRow key={s.id} def={s} value={options[s.id] ?? s.def} onChange={(v) => write(s.id, v)} />
                ))}
                <button type="button" class="btn" onClick={() => resetOne(group)}>
                  Reset {GROUP_LABELS[group]}
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>
      {devTools && (
        <div class="settings-dev">
          <h3 class="group-head">Developer windows</h3>
          {devSections().map((w) => (
            <button key={w.id} type="button" class="atlas-section" onClick={() => deps.open(w.id)}>
              {w.title}
            </button>
          ))}
        </div>
      )}
      <section class="settings-keys" aria-label="Keyboard shortcuts">
        <h3 class="keys-head">Keys</h3>
        <dl class="facts">
          {keyRows().map((row) => (
            <>
              <dt key={`k-${row.label}`}>{row.keys}</dt>
              <dd key={`l-${row.label}`}>{row.label}</dd>
            </>
          ))}
        </dl>
      </section>
      <div class="settings-actions">
        <button type="button" class="btn" onClick={resetAll}>
          Reset all settings
        </button>
        <button type="button" class="btn primary" onClick={() => (onDone ? onDone() : deps.close())}>
          Done
        </button>
      </div>
    </div>
  );
}

/** A fixed list of setting rows (the Privacy window shows two). Writes go through deps, as in the panel. */
function SettingList({ deps, ids }: { deps: WindowDeps; ids: readonly string[] }) {
  const [options, setOptions] = useState<Options>(() => deps.options());
  return (
    <>
      {SETTINGS.filter((s) => ids.includes(s.id)).map((s) => (
        <SettingRow
          key={s.id}
          def={s}
          value={options[s.id] ?? s.def}
          onChange={(v) => {
            deps.setOption(s.id, v);
            setOptions(deps.options());
          }}
        />
      ))}
    </>
  );
}

/** Mounts the rows of the listed settings into a window body. */
export function mountSettingRows(body: HTMLElement, deps: WindowDeps, ids: readonly string[]): void {
  render(<SettingList deps={deps} ids={ids} />, body);
}

/** Mounts the Settings panel into a window body (the `win_settings` window kind keeps a build for the catalogue). */
export function mountSettings(body: HTMLElement, deps: WindowDeps): void {
  render(<SettingsPanel deps={deps} />, body);
}
