# Part 1 of 3: Plain names for everything a player reads

## Context
Players see words made up in the spec, such as "Call Thistlehart", "Lowloam" and "Gloamfang", and cannot tell what they mean. The goal is to give everything a player reads a real-world name, such as Deer, Wolf or Farmland. Internal ids, saves, the determinism hashes and the spec traceability all stay unchanged. This is part 1 of 3. Part 2 is the map graphics: smooth 2D terrain and SVG icons in the repo. Part 3 is a full responsive UX redesign with touch and keyboard support. Parts 2 and 3 each get their own design and plan after this one ships.

## Decisions (user)
- Style: real-world names (Thistlehart → Deer, Gloamfang → Wolf, Cluckling → Chicken).
- Scope: everything a player reads. Ids stay the same.
- Method: one plain-name table, which content files read when they build `name`.

## Approaches considered
- **One table (picked):** `src/content/plain-names.ts` maps each id to a plain name. All names can be reviewed in one place, and every screen that reads `.name` updates for free.
- **Inline edits in about 15 content files:** this needs no extra file, but the names end up scattered and are harder to review. Rejected.
- **Renaming the ids:** this breaks saves and needs new hash baselines. Rejected.

## Findings that shape the work
- Species names come from `titleCase(id)` in `src/content/beasts.ts:131/174/207` (90 species). Ground, biome, creep and landmark tables have `name` fields that nothing reads. Spells, rites, tenets, customs, moods, decisions and flora have no name field, and the UI shows their raw ids.
- Power names are built in `src/content/powers.ts`:
  - `Call/Found ${sp.name}` at :303. This branches on `sp.wild`, so sea species and Phantom Hand wrongly read "Found …".
  - Omens at :333 use the raw ids, as in "Omen: heat_spell".
  - Tab labels are capitalised ids at `src/app/main.ts:768`.
- The UI shows raw ids in these places:
  - `main.ts:1233` (ground key)
  - `worldTip.ts:36` (task)
  - `detailWindows.ts:135/151/312/327` (creed, customs)
  - `historyTicker.ts:23` (age id)
  - `specWindows.ts:377` (stat keys)
  - `windowContent.ts:118-121` (`humanize` rule ids, so "Aging toll" disagrees with "Ageing")
  - `windowContent.ts:507`, `snapshot-model.ts:33-48` (tab ids)
  - `systemWindows.ts:305/309` (dev tools; leave as ids)
- Saved strain names: `strains.ts:166` stores `${speciesName} ${id}` in saves (`chronicle.ts:411`), so old saves would keep the old names. Fix this by building the strain label at snapshot time (`snapshot.ts:554/580/606`, clan `strainName` :417) from the species' plain name plus the strain id. Leave the saved field alone.
- Safe to change: `contentHash` (worker handshake, crash and diagnostics only; not stored in saves), `GOLDEN_HASH` (typed arrays only) and lifetime stats (stored by id).

## Implementation
1. **Table:** add `src/content/plain-names.ts` with `PLAIN_NAMES: Record<Kind, Record<string, string>>`.
   - Kinds: species, ground, biome, creep, landmark, flora, item material and unique, mod family and literal, being trait, strain trait, morph, spell, rite, tenet, custom, mood, decision, age, power tab, omen.
   - Also add `plainName(kind, id)`. It returns the table entry, or falls back to `humanize(id)`, so a missing entry never shows `snake_case`.
   - Move `humanize` from `windowContent.ts:118` to this file and reuse it there.
   - Names that are already plain stay as they are. Examples: building names (House, Granary), most trait names (Quickwit, Brawny), power verbs (Raise, Rain, Bless). Only coined or unclear words get entries.
2. **Draft the names in parallel**, one agent per domain. Each agent returns a `kind → {id: name}` block for me to merge into the table, writes no other code, and keeps the names unique within its kind.
   - **Creatures and peoples:** 90 species and 6 Folk. Folk peoples become plain descriptive peoples, for example hearthborn → Lowlanders and fenmarr → Marsh Folk.
   - **World:** grounds, biomes, creeps, landmarks, flora, ages, omens, morphs.
   - **Culture:** spells, rites, tenets, customs, moods, decisions.
   - **Traits and items:** being traits, strain traits, materials, uniques, mod families, achievement names and descriptions that contain coined words.
3. **You review the draft table** before anything is wired up. I'll send it as a readable file.
4. **Wiring:**
   - Content name builders call `plainName`: `beasts.ts`, `grounds.ts`, `biomes.ts`, `creeps.ts`, `items.ts`, `traits.ts` parse, `variants.ts`, `src/sim/ages.ts`, `achievements.ts` text.
   - Powers: build `Call ${name}` / `Found ${name}` from `sp.folk`. Omens read `plainName('omen', id)`. Tab labels come from a `TAB_LABEL` entry used at `main.ts:768` and `windowContent.ts:507`.
   - UI raw-id spots: all of the ones listed above except the dev tools.
   - Strain labels are built at snapshot time.
   - Power ids stay the same, including `spawn_folk_*` for sea species.
5. **Tests:**
   - New unit test `tests/unit/plain-names.test.ts`. Every species, ground, biome, spell, rite, custom, mood and decision name is non-empty and has no `_`. No player-visible name contains a known coined root from a deny-list (thistlehart, gloamfang, lowloam, deepmere, rimeplate, …). Strain labels in an old-format save use the new species name.
   - Update the e2e strings only where a label changes. For example, if a tab label changes, update 'Powers: Shape' in `panels.spec.ts`/`windows.spec.ts`. Tab labels stay as they are unless the draft renames them.
6. **Docs:** add a DECISIONS.md entry "Plain names", which keeps the spec ids as the source of truth. Add the design doc `docs/superpowers/specs/2026-10-27-plain-names-design.md`, which is this file.

## Verification
- `npx tsc -p tsconfig.sim.json --noEmit && npx tsc -p tsconfig.json --noEmit`
- `npx vitest run` (full suite). `GOLDEN_HASH` must not change.
- `node scripts/check-determinism.mjs`, `npm run check:budgets`, `npm run build`
- `npx playwright test --workers=1` on Chromium
- Manual check in the browser pane: the Beings tab shows "Call Deer"-style names, sea species show "Call", the tile inspector shows a plain ground name, the being tooltip task reads plainly, and the Ages ticker shows the age name.
- Load an existing save: it still loads, and strains show the new species names.

## Out of scope (parts 2 and 3)
- Terrain look, the SVG icon set, the power bar layout, the window, HUD and onboarding flows, the mobile and touch layout, keyboard shortcuts.
- Generated clan, family and custom proper names, like "Ashfell". They are already readable names.
