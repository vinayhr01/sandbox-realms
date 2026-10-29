# Illustrated Power Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every category chip and every non-creature power on the power sheet shows its own illustrated SVG, in the creature art style.

**Architecture:** New SVG files under `src/art/powers/<group>/`, one lazy Vite chunk per group (`art-p<group>`), loaded by a small power-art loader beside the creature loader in `src/art/load.ts`. `PowerIcon` and the chip buttons show the art when loaded, the existing line glyph otherwise.

**Tech Stack:** TypeScript 7 strict, Vite 8 (rolldown `manualChunks`, `import.meta.glob` with `?raw`), Preact 11 + Signals, Vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-29-power-icons-design.md`

## Global Constraints

- Style: full colour, soft gradients, warm dark outlines, light and shade, as the approved sample (Raise, Volcano, Rain, Lightning, Bless, Lore, Pause).
- Every SVG passes `artProblems(svg, [])` (`src/art/rig.ts`): `viewBox="0 0 128 128"`, no `<filter>`, at most 12 KB, LF endings.
- Ids inside a file are prefixed with the power id (as creature files do), so inline gradients never clash.
- Readable at 38 px: one main subject, strong silhouette, no fine text.
- No sim change (GOLDEN_HASH 1357125849). Main bundle ≤ 350 KiB gzip. No new dependency.
- Owner's process: no per-task review or Playwright; one gallery review, one notes round, one full test pass, one fix pass.

## Review Focus

1. A tab opened before its chunk loads: the glyph shows, then the art replaces it without a reload. Covered by Task 1's unit test.
2. A failed chunk download (offline): the glyph stays, no console error loop; the next tab open retries. Task 1 unit test.
3. Search results mixing categories: every result's chunk loads. Task 1 unit test.
4. Gradient id clashes between icons on one screen (wrong colours). Task 2's lint: each file's `id="…"` values start with its power id.
5. A power added later with no art: the glyph shows and the coverage test names it. Task 3.

---

### Task 1: Power-art loader and wiring (Haiku)

**Files:**
- Modify: `src/art/load.ts`, `vite.config.ts` (manualChunks), `scripts/check-budgets.mjs` (`LIMITS.artTotal` to 600 KiB; per-chunk default stays 40 KiB), `src/ui/shell/PowerSheet.tsx` (`PowerIcon`, chip buttons, chunk loading effect), `src/ui/shell/PowerSheet.css` (chip icon 20 px beside the label)
- Create: `src/art/powers/<group>/index.ts` for each group in `POWER_ART_GROUPS` (empty record until Task 2), `src/art/powers/reuse.ts`
- Test: `tests/unit/power-art.test.ts`

**Interfaces:**
- Produces, in `src/art/load.ts`:
  - `export type PowerArtGroup = 'chips' | 'land' | 'nature' | 'weather' | 'disasters' | 'blessings' | 'peoples' | 'inspect' | 'world'`
  - `export const POWER_ART_GROUPS: readonly PowerArtGroup[]`
  - `export function powerArtGroup(power: PowerDef): PowerArtGroup` — `chipOf(power) ?? 'world'` (creature powers are not asked).
  - `export function loadPowerArt(group: PowerArtGroup): Promise<Record<string, string>>` — same once-only/retry-on-failure behaviour as `loadArt`.
  - `export function powerArtFor(power: PowerDef): string | null` — the SVG by `power.id` from its group, else the reused art from `REUSE` (`src/art/powers/reuse.ts`: `Record<string, { chunk: 'buildings'; id: string }>`, filled in Task 2), else null.
  - `export function chipArtFor(chip: ChipId): string | null` — from group `chips`, keyed by chip id.
- Each `src/art/powers/<group>/index.ts`: `export const ART: Record<string, string>` built with `import.meta.glob('./*.svg', { query: '?raw', import: 'default', eager: true })`, keyed by file name without `.svg`.
- `vite.config.ts`: `src/art/powers/<group>/` maps to chunk `art-p<group>` (e.g. `art-pland`), alongside the existing creature mapping.

- [ ] **Step 1: Write the failing tests** in `tests/unit/power-art.test.ts`:
  - `powerArtGroup` maps a Land paint to 'land', a Realm power to 'world', `ins_inspect` to 'land'.
  - `powerArtFor` is null before `loadPowerArt`, and returns the string after it (stub one group's `ART` with `vi.mock`).
  - A rejected group import leaves `powerArtFor` null and a second `loadPowerArt` call retries (Review Focus 2).
  - Rendering `PowerSheet` with a mixed search result requests every group in it (Review Focus 3), and swaps glyph for `<img class="power-art">` once loaded (Review Focus 1).
- [ ] **Step 2:** Run `npx vitest run tests/unit/power-art.test.ts --maxWorkers=1`; expect FAIL. Implement. Run again; expect PASS. Run both tsc configs.
- [ ] **Step 3: Commit** `feat(art): lazy power-art chunks and loader, wired into the power sheet`.

### Task 2: Draw the icons (session model; one art agent per group, in parallel — file writes only, no builds)

**Files:**
- Create: `src/art/powers/<group>/<power_id>.svg` for every power in that group except creature powers and those listed in `reuse.ts`; `src/art/powers/chips/<chip_id>.svg` for the 8 chips.
- Modify: `src/art/powers/reuse.ts` (Peoples powers that read best as an existing building, e.g. Hamlets → a dwelling).

List a group's powers with:
`node --experimental-strip-types -e "const {POWERS}=await import('./src/content/powers.ts');const {chipOf}=await import('./src/ui/shell/powerCatalog.ts');for(const p of POWERS)if((chipOf(p)??'world')==='<group>'&&p.tab!=='beings')console.log(p.id,'|',p.name,'|',p.desc??'')"`

- [ ] **Step 1:** Draw each icon to the Global Constraints. Within a group every icon must be distinct at 38 px (different subject or silhouette, not just colour).
- [ ] **Step 2:** Check each file with `artProblems` via `npx vitest run tests/unit/art-lint.test.ts --maxWorkers=1` (after Task 3 adds the power groups to it) or a one-off node check; fix any problem.
- [ ] **Step 3: Commit** per group `art(powers): <group> icons`.

### Task 3: Coverage, lint and gallery

**Files:**
- Modify: `tests/unit/art-lint.test.ts` (lint every power-art group; plus: every non-creature power has `powerArtFor` after its group loads, every chip has `chipArtFor`, every `id="…"` in a power file starts with that power id — Review Focus 4 and 5)
- Create: `.superpowers/brainstorm/<session>/content/power-icons-gallery.html` (not committed): every chip and power icon at 38 px and 96 px, grouped by category, with names.

- [ ] **Step 1:** Add the tests; run `npx vitest run tests/unit/art-lint.test.ts --maxWorkers=1`; expect PASS once Task 2 is complete.
- [ ] **Step 2:** Build the gallery and show it to the owner. Collect notes.
- [ ] **Step 3: Commit** `test(art): power icon coverage and lint`.

### Task 4: Owner notes round, then the one test pass

- [ ] **Step 1:** Redraw the icons the owner flags (session model), re-run the art lint test.
- [ ] **Step 2:** One full pass, one heavy job at a time: both tsc configs, `npx vitest run --maxWorkers=2`, `node scripts/check-determinism.mjs`, `npm run build`, `npm run check:budgets`, `SR_SKIP_PERF=1 npx playwright test --workers=1`, then the perf spec on desktop-chromium.
- [ ] **Step 3:** One fix pass for whatever fails, then merge to main and push; CI confirms and deploys.
