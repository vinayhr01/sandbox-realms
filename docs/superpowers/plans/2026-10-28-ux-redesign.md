# UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stacked bottom-bar UI with a modern, discoverable shell, built from these parts:
- top pills
- a bottom power sheet on every screen
- a floating info card
- a full-screen Atlas
- progressive discovery
- deploy effects
- one keymap

**Architecture:** A Preact + Signals shell mounts over the unchanged Pixi map. A small store module holds the UI state, which `main.ts` feeds. Game actions stay in `main.ts` (`activatePower`, `openWindow`), and the components only call them. The existing window bodies are hosted inside the Atlas through an `openWindow` compatibility shim. Effects are a pooled Pixi layer.

**Tech Stack:** TypeScript 7.0.2 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Preact + `@preact/signals` (new, exact-pinned), PixiJS 8.22.0, Vite 8, Vitest 5.0.5 with jsdom 30.1.2, Playwright 1.64.1 on Chromium.

**Spec:** `docs/superpowers/specs/2026-10-28-ux-redesign-design.md` (owner-approved 2026-10-28). Read it, including "Calls made after the builder check", before any task.

## Global Constraints

- **Determinism:** no sim rule, save-format or content-id change. `GOLDEN_HASH` stays 1357125849, and `node scripts/check-determinism.mjs` passes.
- **Dependencies:** only `preact` and `@preact/signals` are added. Install them exact-pinned to the current stable versions (`.npmrc` has `save-exact=true`), and record the versions in DECISIONS.md. Node stays at 24.22.1.
- **JSX setup:** `tsconfig.json` uses `"jsx": "react-jsx"` and `"jsxImportSource": "preact"`. Components live in `src/ui/shell/*.tsx`. The sim config (`tsconfig.sim.json`) must not include them.
- **Budgets:** main ≤ 350 KiB gzip per the budget script. Report growth against 199.8 KiB.
- **CI green at every task:**
  - Every e2e spec passes, or is migrated in the same task.
  - The perf job (creature gate ≤ 4 ms P95) still passes.
  - No horizontal overflow at 360×640 and 1920×1080.
- **Accessibility:**
  - Every control is reachable and operable by keyboard. Tab keeps native focus order.
  - Touch targets are at least 44 px.
  - Use correct ARIA patterns: a tablist with arrow keys, dialogs with focus trap and return, and aria-live for toasts and "New!" cards.
  - Respect `data-reduce-motion` and `data-reduce-flash`.
- **Kept hooks:** `#map`, `#map canvas`, `#fatal*`, `window.__sr` (extend it, don't break it), `data-power-id` on every power button, and a polite live region that replaces `#status` (keep the `#status` id on it).
- **Contrast test:** it still reads `--text`, `--surface`, `--text-dim`, `--accent` and `--accent-ink` as literal `#rrggbb` values from the first `:root` block of `src/ui/styles.css`.
- **Commits:** end each commit with a `Co-Authored-By` line naming the model that wrote it, and `git add` named paths only.
- **Execution:** Haiku 5.5 implementers write the code (owner preference), and Sonnet 5.5 reviewers check each task.

## Review Focus

1. **Escape order.** With several layers open (info card + expanded sheet + Atlas page), Esc closes the topmost first, and focus returns to the control that opened it. Test in Task 3.
2. **Phone landscape and very short screens** (844×390, 360×640). The sheet expanded leaves the map usable, never covers the top pills, and nothing overflows horizontally. Test in Task 2.
3. **Typing in search must not trigger shortcuts.** In the sheet search and the Atlas Settings search, typing 1–9, Q, P or H must not fire them. Test in Task 7.
4. **Old saves with several discoveries already met** show one summary card, not a burst, and the chips are already in the main row. Test in Task 5.
5. **Effects during high speed and crowds.** Many deploys in a row at 10× speed must not exceed the particle cap or degrade the creature perf gate, and reduce-motion turns effects into simple fades. Test in Task 6.

---

### Task 1: Foundation: Preact, store, tokens, top pills, live region

**Files:**
- Modify: `package.json` / `package-lock.json` (exact `preact`, `@preact/signals`), `tsconfig.json` (jsx), `index.html` (add `<div id="ui-root">` over `#map`; keep `#map` and `#fatal`), `src/ui/styles.css` (token block), `src/app/main.ts` (create the store, mount the shell, feed the store from snapshot, speed, armed and status)
- Create: `src/ui/shell/store.ts`, `src/ui/shell/mount.tsx`, `src/ui/shell/TopPills.tsx`, `src/ui/shell/Toasts.tsx`, `src/ui/shell/tokens.css`
- Test: `tests/unit/shell-store.test.ts`, `tests/unit/shell-toppills.test.tsx`; update `tests/e2e/smoke.spec.ts`

**Interfaces:**
- **Produces:**
  - `createStore(): UiStore`, where `UiStore` has these Signals:
    - `realm: Signal<{ name: string; year: number; month: number; creatures: number; towns: number }>`
    - `speed: Signal<Speed>`
    - `paused: Signal<boolean>`
    - `armed: Signal<{ powerId: string; brush: { size: number; shape: BrushShape } } | null>`
    - `status: Signal<string>`
    - `toasts: Signal<Toast[]>`
    - `recent: Signal<string[]>`
    - `favourites: Signal<string[]>`
    - `discovered: Signal<string[]>`
    - `sheet: Signal<'collapsed' | 'expanded'>`
    - `atlas: Signal<{ open: boolean; tab: AtlasTab; stack: string[] }>`
    - `info: Signal<InfoTarget | null>`
    - `cooldowns: Signal<Record<string, number>>`
  - `pushToast(store, text, kind?: 'info' | 'new')`.
  - `mountShell(root: HTMLElement, store: UiStore, actions: ShellActions)`.
  - `ShellActions = { setSpeed(s: Speed): void; togglePause(): void; activatePower(id: string): void; openWindow(kind: string, params?: WindowParams): void; disarm(): void }`. These are wired to the existing `main.ts` functions.
- **Top pills:**
  - The realm pill shows the name, "Year N", the creature count and the town count. Clicking it opens the Atlas World tab, using `atlas.open` for now (Task 3 builds the Atlas).
  - The speed pill holds pause plus ½ 1 2 5 10, as `aria-pressed` buttons. Keep the button names "Pause" and "x1" etc. that e2e uses.
  - The old `header.topbar` is removed. `#realm-name` stays as the id of the realm-name text, starting "Realm" as today.
- **Look:** dark glass tokens per spec H, with `--glass-bg`, `--glass-blur`, `--glass-border`, `--radius-l` and the motion tokens. Add a `@supports not (backdrop-filter: blur(1px))` solid fallback.

- [ ] **Step 1: Add the dependencies.** Run `npm install --save-exact preact @preact/signals`. Set up the tsconfig jsx options. Check that `npx --no-install tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.sim.json` both pass.
- [ ] **Step 2: Write the failing tests.**
  - `shell-store.test.ts`: `createStore()` defaults (sheet 'collapsed', atlas closed, discovered `['land','nature','creatures']`). `pushToast` appends, and toasts expire after `TOAST_MS = 3000` (inject the clock).
  - `shell-toppills.test.tsx` (jsdom): rendering TopPills with a store shows "Year 3" and "142 creatures". Clicking "x5" calls `setSpeed(5)`. "Pause" toggles.
- [ ] **Step 3:** Run `npx --no-install vitest run tests/unit/shell-store.test.ts tests/unit/shell-toppills.test.tsx`. Expect FAIL.
- [ ] **Step 4: Implement** the store, mount, TopPills, Toasts and tokens. Wire them in `main.ts`. Move the `#status` live region into the shell, keeping the id `#status`.
- [ ] **Step 5: Verify.**
  - Both tsc configs pass.
  - The full vitest run exits 0.
  - Run `npm run build && npm run check:budgets` and report growth.
  - Playwright `smoke` + `platform-smoke` + `finish-restore` + `windows` pass on desktop-chromium and phone-portrait. Update selectors that pointed at `.topbar` only. Speed and pause names are kept.
- [ ] **Step 6: Commit** `feat(ui): Preact shell foundation, store, tokens, top pills`.

### Task 2: Power sheet

**Files:**
- Create: `src/ui/shell/PowerSheet.tsx`, `src/ui/shell/powerCatalog.ts`, `src/ui/shell/glyphs.tsx`
- Modify: `index.html` (remove `nav.bottombar` and its panels), `src/app/main.ts` (delete `renderPowers`, the bottom tabs and `.tool` wiring; keep `activatePower`, `setArmed` and brush state, now feeding the store), `src/ui/panels/powerBar.ts` (reuse `favourite` / `unfavourite`)
- Test: `tests/unit/power-catalog.test.ts`, `tests/unit/shell-sheet.test.tsx`; migrate `tests/e2e/panels.spec.ts` and `tests/e2e/smoke.spec.ts`; add `tests/e2e/sheet.spec.ts`

**Interfaces:**
- **Consumes:** `UiStore` and `ShellActions` (Task 1), `POWERS` and `TABS` (`src/content/powers.ts`), `chunkOf` and `artFor` (`src/art/load.ts`) for creature and building icons, and `plainName`.
- **Produces:**
  - `type ChipId = 'land' | 'nature' | 'creatures' | 'weather' | 'disasters' | 'blessings' | 'peoples' | 'inspect' | 'windows'`. `'windows'` is temporary and is removed in Task 3 (spec, call 8).
  - `chipOf(power: PowerDef): ChipId | null`. It returns null for the old World-tab powers: speed, pause, rules, ages, chronicle and hide-UI, which per call 2 go to the pills or the Atlas.
  - `groupsOf(chip: ChipId): { id: string; label: string; powers: PowerDef[] }[]`. Creatures are grouped by art chunk: Animals, Birds, Sea, Insects, Undead, Monsters, Peoples.
  - `recentRow(store): string[]`. Favourites come first, then the most recent unpinned powers, deduplicated, at most 9.
  - `searchPowers(q: string): PowerDef[]`, matching on plain name and chip label, case-insensitive.
- **Mapping (call 2):**
  - Land = the old `shape` tab plus the Inspect, Raise and Lower tools.
  - Nature = `grow`. Creatures = `beings`. Weather = `sky`. Disasters = `havoc`. Blessings = `favour`.
  - Peoples = the realm and people powers taken from `insight` and `favour`. The implementer lists them in the report.
  - Inspect = the rest of `insight`.
  - Every one of the 250 powers maps to exactly one chip, or to null with a pill or Atlas home.
- **Sheet:**
  - Collapsed, it shows the chips in the main row (`store.discovered` order; the others sit under "More ▾") and the first 3 of the recent row, as small icons. An armed badge appears if a power is armed.
  - Expanded, it shows the handle, chips, search box (role `searchbox`, name "Search powers"), grouped grid of icon buttons and the recent row.
  - Each power button is a `button` with `data-power-id`, an `aria-label` set to the plain name, `aria-pressed` when armed, and a cooldown ring from `store.cooldowns`.
  - The chips are a tablist (role `tab`, name = the chip label, arrow-key navigation).
  - When a brush power is armed, the sheet shows a brush control with a size slider ("Brush size") and shape radios (Circle, Square, Diamond).
  - Opening and closing: drag the handle or click it. `Q` is wired in Task 7; the store toggle is exposed now.
  - Long-press or right-click on a power pins or unpins a favourite.
  - Desktop width is capped at 720 px and centred.
  - A temporary chip "Windows" lists the 46 old window launchers as buttons with the same accessible names, so e2e keeps working.
- **Cooldowns:** `main.ts` writes its existing `cooldownUntil` map into `store.cooldowns`.

- [ ] **Step 1: Write the failing tests.**
  - `power-catalog.test.ts`:
    - Every POWER maps to a chip or to null with a documented home (assert by table). The total is 250.
    - `chipOf` of the spawn power for thistlehart is 'creatures'.
    - `recentRow` puts favourites first and caps at 9.
    - `searchPowers('deer')` includes `spawn_beast_thistlehart`.
  - `shell-sheet.test.tsx`:
    - The collapsed sheet shows only the chips in `discovered` plus "More".
    - Expanding shows the search box.
    - Typing "wolf" filters to the Wolf power.
    - Clicking a power calls `activatePower(id)`.
    - The brush control appears only when a brush power is armed.
- [ ] **Step 2:** Run them and expect FAIL. Implement. Run them and expect PASS.
- [ ] **Step 3: E2E migration.**
  - `panels.spec.ts` and `smoke.spec.ts` now find powers through the sheet: the chip tab "Land" replaces "Powers: Terrain", "Disasters" replaces "Powers: Destruction", and so on. Keep the button names "Raise" and "Charge".
  - Window launches use the temporary "Windows" chip instead of `getByRole('tab', { name: 'Powers', exact: true })`. Add a helper `openWindowButton(page, name)` in `tests/e2e/helpers.ts` (create it if missing), so Task 3 changes only the helper.
  - New `sheet.spec.ts`:
    - First launch shows exactly 3 main chips: Land, Nature, Creatures.
    - Search arms a power.
    - Review Focus 2: at 844×390 and 360×640 the expanded sheet doesn't cover the top pills, `scrollWidth - clientWidth ≤ 1`, and a map tap still inspects.
- [ ] **Step 4: Verify.** Run the full vitest suite, the build and budgets, then Playwright on all projects with `SR_SKIP_PERF=1`, then the perf spec. All must pass.
- [ ] **Step 5: Commit** `feat(ui): bottom power sheet with chips, search, recent row, cooldown rings`.

### Task 3: Atlas

**Files:**
- Create: `src/ui/shell/Atlas.tsx`, `src/ui/shell/atlasRoutes.ts`, `src/ui/shell/SettingsPanel.tsx`
- Modify: `src/ui/windowHost.ts` (becomes the shim: `open()` routes into the Atlas, while confirmations and `#fatal` keep the `<dialog>`), `src/app/main.ts` (`openWindow` uses the route table), `src/ui/windowContent.ts` (settings render moves to SettingsPanel; keep the setting rows' semantics), `index.html` (drop the temporary Windows chip launchers)
- Test: `tests/unit/atlas-routes.test.ts`, `tests/unit/shell-atlas.test.tsx`; migrate `tests/e2e/windows*.spec.ts`, `finish-*.spec.ts` and `helpers.ts`; add Escape-order checks

**Interfaces:**
- **Consumes:** `WINDOW_CATALOG` (`src/ui/windowCatalog.ts`), `windowFor(kind, deps, params)` (`src/ui/windowContent.ts`), and `UiStore`.
- **Produces:**
  - `type AtlasTab = 'world' | 'peoples' | 'history' | 'discoveries' | 'settings'`.
  - `routeOf(kind: string): { tab: AtlasTab; card?: true } | { modal: true } | { dev: true }`. Every one of the 74 catalog kinds is routed.
  - Confirmation dialogs route to `{ modal: true }`.
  - Developer console, developer tools, error details and update route to `{ dev: true }`. These appear in Settings only when the setting "Show developer tools" (`ui.devTools`, runtime-persisted like other options; add it to the SETTINGS table in the `dev` group) is on.
- **Atlas behaviour:**
  - A full-screen overlay with role `dialog`, name "Atlas", and a tablist of the 5 tabs.
  - Each tab lists its sections as buttons. Opening one pushes onto `atlas.stack` and renders the existing `windowFor` body, mounted into a container through a ref.
  - Live updates keep refreshing through the existing live callback.
  - A Back button pops the stack. Esc pops, then closes, and focus returns to the opener.
  - Settings shows grouped, collapsible fieldsets with a searchbox "Search settings". The keys list is generated in Task 7. The 11 groups stay (`role=group` count kept, or update the spec's expectation if a group is added).
- **Other:** remove the "Saved on this device." footer from the windows that aren't saves.

- [ ] **Step 1: Write the failing tests.**
  - `atlas-routes.test.ts`:
    - Every `WINDOW_CATALOG` kind has a route.
    - The dev kinds route to `{ dev: true }`.
    - `win_population` routes to 'world'. Dominions, hamlets and creeds route to 'peoples'. Chronicle routes to 'history'. Achievements route to 'discoveries'. Settings routes to 'settings'.
  - `shell-atlas.test.tsx`:
    - Opening a kind selects its tab and pushes the stack.
    - Back pops.
    - Esc order (Review Focus 1): with the info card set and the Atlas page open, the first Esc pops the page, the second closes the Atlas, and the third clears the info card. After each step, focus is on the opener (`document.activeElement`).
- [ ] **Step 2:** Run them and expect FAIL. Implement. Run them and expect PASS.
- [ ] **Step 3: E2E migration.**
  - `helpers.ts` `openWindowButton` now opens the Atlas from the realm pill and then the tab and section by name.
  - The window specs keep their dialog-name assertions, with the Atlas section title equal to the old window title.
  - Remove the temporary Windows chip.
  - `finish-recovery` keeps `#fatal`.
- [ ] **Step 4: Verify.** Run the full vitest suite, the build and budgets, Playwright on all projects with `SR_SKIP_PERF=1`, and the perf spec.
- [ ] **Step 5: Commit** `feat(ui): Atlas with tabbed sections, back stack and developer-tools switch`.

### Task 4: Info card and touch input

**Files:**
- Create: `src/ui/shell/InfoCard.tsx`
- Modify: `src/app/main.ts` (tap on a being, town or building sets `store.info` instead of opening `win_being`; the hover tooltip stays on hover devices), `src/ui/input.ts` (remove the double-tap zoom and its 300 ms delay; a tap inspects immediately), and the map zoom-in/out buttons in the shell (top-right under the speed pill, names "Zoom in" and "Zoom out")
- Test: `tests/unit/shell-infocard.test.tsx`, `tests/unit/input.test.ts` (or the existing input tests); `tests/e2e/creatures.spec.ts`

**Interfaces:**
- **Consumes:** `UiStore.info`, the feed sample and `pickBeing` (already in `main.ts`), and `mapKinds` for snapshot details.
- **Produces:**
  - `type InfoTarget = { kind: 'being'; key: number } | { kind: 'hamlet'; id: number } | { kind: 'building'; id: number }`.
  - The card follows its being each frame, positioned from `tileToScreen`. On phones it shows as a bottom sheet above the power sheet. It shows "Gone" when the being leaves the feed.
  - The card's actions are Follow, Possess and More. More calls `openWindow` with the inspector kind, which routes into the Atlas.
  - It closes on Esc, the Close button, a tap on empty map, or opening another card. It does not close on pan (call 7).
- **Long-press:** keeps the held tile inspect.
- **Placement fixes** (spec "Constraints": collisions). Restyle the possession pad (`src/ui/panels/possessControls.ts`) and the minimap frame with glass tokens.
  - The possession pad sits bottom-left above the sheet. The minimap stays bottom-right above the sheet. They never share a corner.
  - Toasts and the coach stack in one top-centre column under the pills.
  - The history ticker sits below that column, so none of them overlap.
  - E2E: with a being possessed and the minimap on, the pad and minimap bounding boxes don't intersect at 390×844 or at 1280×720.

- [ ] **Step 1: Write the failing tests.**
  - The card shows the plain species name and the actions.
  - The "Gone" state appears when the target is absent.
  - Close clears `store.info`.
  - Input: a single tap fires inspect with no 300 ms wait (fake timers: the callback runs at 0 ms).
- [ ] **Step 2:** Implement, then run the tests and expect PASS.
- [ ] **Step 3: E2E** (`creatures.spec.ts`): tapping a spawned being shows its card with its name. Panning keeps the card. Esc closes it.
- [ ] **Step 4: Verify** as in Task 3. **Commit** `feat(ui): floating info card; instant taps and zoom buttons`.

### Task 5: Progressive discovery and first-launch hint

**Files:**
- Create: `src/ui/shell/discovery.ts`, `src/ui/shell/Coach.tsx`, `src/content/discoveries.ts`
- Modify: `src/app/main.ts` (evaluate triggers on each snapshot; replace the old tutorial strip), `src/ui/panels/tutorial.ts` (retire it, or keep only its persistence helpers), Atlas Discoveries tab (list entries plus the achievements section)
- Test: `tests/unit/discovery.test.ts`; `tests/e2e/discovery.spec.ts`; migrate `tests/e2e/windows.spec.ts` tutorial checks

**Interfaces:**
- **Produces:**
  - `DISCOVERIES: readonly { id: string; chip?: ChipId; title: string; text: string; met(s: Snapshot, stats: StatsRecord): boolean }[]`. The texts are one plain line on what the simulation did.
  - Required entries:
    - first-weather (chip weather): any rain or storm counter above 0
    - first-town (chip peoples): hamlets > 0
    - first-calamity (chip disasters): a calamity counter above 0, or year ≥ 2
    - first-creed (chip blessings): creeds > 0
    - first-war (chip inspect): a campaign or dominion war counter above 0
    - first-strain: strains > number of species
    - first-extinction: a species count went from above 0 to 0 in the lifetime stats
  - Find the real counter names in `src/sim/stats.ts` and the snapshot types. If a trigger has no data source, mark it in the report and drop it. Do NOT change the sim.
  - `evaluate(state: DiscoveryState, snap, stats): { state: DiscoveryState; newly: string[] }`. It is pure and idempotent.
  - `DiscoveryState = { found: string[]; seen: string[] }`, persisted via the same safe storage as tutorial and options, under key `sr.discovery.v1`.
- **Cards:**
  - A single newly met entry shows a "New!" toast: chip label plus title, kind 'new', aria-live.
  - More than one newly met entry in one evaluation (old save, Review Focus 4) shows ONE toast: "Discovered: A, B, C".
  - `store.discovered` = the starter chips (`['land','nature','creatures']`) + the chips of found entries. With the setting `ui.allChips` ("Show all categories") on, it is every chip.
- **Coach:** a 3-step first-launch hint. The steps are "Shape the land" (done on the first brush stroke), "Add life" (the first spawn) and "Change the speed" (the first speed change). It has a Skip button "Skip tutorial" (keep that name for e2e) and is stored as today.

- [ ] **Step 1: Write the failing tests.**
  - `evaluate` with a hamlet adds first-town and returns `newly = ['first-town']`.
  - Evaluating again returns `newly = []`.
  - Three met triggers at once give 3 found entries.
  - The toast helper produces one "Discovered: …" text when there are more than 1.
  - `ui.allChips` exposes all 8 chips.
- [ ] **Step 2:** Implement, then run the tests and expect PASS.
- [ ] **Step 3: E2E `discovery.spec.ts`:**
  - First launch shows 3 chips and the coach.
  - Run until the first hamlet (use `__sr.speed(10)` and the existing realm with seed fallbacks, the same way the settlements e2e or units find a hamlet seed; or add a `__sr.forceDiscovery(id)` test hook that calls `evaluate` with a synthetic stat). The Peoples chip appears and the toast mentions "Peoples".
  - Reload: the chip persists.
- [ ] **Step 4: Verify** as in Task 3. **Commit** `feat(ui): progressive discovery, New cards, Discoveries tab, first-launch coach`.

### Task 6: Deploy effects

**Files:**
- Create: `src/render/effects.ts`, `src/render/effectRecipes.ts`
- Modify: `src/app/main.ts` (call `effects.play(recipeFor(power), x, y)` only where the command is actually sent, per call 6), `src/app/recovery.ts` (add `map.effects` as the FIRST step of `DEGRADE_OFF`; `DEGRADE_MAX_LEVEL` and `DEGRADE_RENDER_SCALE_LEVEL` become 10; update the recovery tests)
- Test: `tests/unit/effects.test.ts`, `tests/unit/recovery*.test.ts`; perf spec unchanged but must pass

**Interfaces:**
- **Produces:**
  - `type RecipeId = 'spawn' | 'brush' | 'weather' | 'blast' | 'meteor' | 'bless' | 'curse' | 'rule'`.
  - `recipeFor(power: PowerDef): RecipeId`. Mapping by handler and kind: `spawn_being` → spawn; brush terrain → brush; `sky_*` → weather; `explode` and bombs → blast; calamity skyfall → meteor; other calamities → blast; favour boons → bless; favour curses (strife, grudge, frenzy, hex, slumber, unweave) → curse; toggles → rule (a pill pulse, no map effect).
  - `class EffectsLayer { constructor(app: Application); play(id: RecipeId, tileX: number, tileY: number, sizeTiles: number): void; update(dtMs: number, view: MarkView): void; clear(): void }`.
  - Pooled sprites with `MAX_PARTICLES = 256`. Each recipe is a short timeline of up to 600 ms (meteor 900 ms) built from a few shared textures generated once (dot, ring, streak, cloud puff, sparkle). Regenerate them on `webglcontextrestored`, the same way creatures.ts does.
  - **Reduce motion:** with `data-reduce-motion`, each recipe becomes a 250 ms fade ring. With `data-reduce-flash`, blast and meteor skip the white flash.
  - **Degrade:** `map.effects` off makes `play` a no-op.

- [ ] **Step 1: Write the failing tests.**
  - `recipeFor` covers every POWER (total 250, no throw) with the spot checks above.
  - 1000 rapid `play` calls never exceed 256 live particles (Review Focus 5).
  - Reduce-motion picks the fade recipe.
  - The degrade flag makes `play` a no-op.
  - The recovery ladder is 9 off-steps with `map.effects` first, and max level 10.
- [ ] **Step 2:** Implement, then run the tests and expect PASS.
- [ ] **Step 3: Verify.** Run the full suite and the build. Run the perf spec alone: both creature phases must still pass. Also check by eye in the browser pane that each recipe plays at the click point: spawn a creature, Raise, rain, a bomb, Omen: Meteor Shower and Bless. Say what you saw in the report.
- [ ] **Step 4: Commit** `feat(render): deploy effects for every power, with reduce-motion and degrade step`.

### Task 7: Keymap and shortcuts

**Files:**
- Create: `src/ui/shell/keymap.ts`
- Modify: `src/app/main.ts` (replace the keydown handler body with a keymap dispatch; keep the possession keys), SettingsPanel keys section (generated from the keymap)
- Test: `tests/unit/keymap.test.ts`; `tests/e2e/keys.spec.ts`

**Interfaces:**
- **Produces:** `KEYMAP: readonly { keys: string[]; label: string; action: KeyAction; whenTyping?: false }[]` and `dispatchKey(e: KeyboardEvent, ctx): boolean`.
- **Bindings (spec, call 1):**
  - `1`–`9`: arm `recentRow(store)[n-1]`
  - `Q`: toggle the sheet
  - `/`: focus search, expanding the sheet
  - Arrows / WASD: pan (existing)
  - `+` / `=` and `-`: zoom
  - `Space` and `P`: pause
  - `H`: hide UI (now hides pills, sheet and minimap; keeps the map)
  - `[` and `]`: brush size
  - `Esc`: close the topmost layer, or disarm
  - The possession keys J K L U T Y N are unchanged
  - `Ctrl+Z`: undo the last stroke, ONLY if call 5's feasibility holds
- **Ctrl+Z feasibility:** check whether the client can record the tiles a stroke changes and re-apply their previous ground and elevation through an existing worker command without any sim or save change. If not, omit Ctrl+Z and add a DECISIONS.md line.
- **Typing guard:** no binding fires while focus is in an input, textarea, select or contenteditable, except Esc (Review Focus 3).

- [ ] **Step 1: Write the failing tests.**
  - Each binding dispatches its action.
  - Typing "1" in the sheet search does not arm a power.
  - Typing "q" does not toggle the sheet.
  - The settings keys list contains every KEYMAP label, and the count equals `KEYMAP.length`.
- [ ] **Step 2:** Implement, then run the tests and expect PASS.
- [ ] **Step 3: E2E `keys.spec.ts`.** Pressing 1 after arming two powers arms the most recent. Q toggles the sheet. / focuses search. Esc closes the Atlas.
- [ ] **Step 4: Verify** as in Task 3. **Commit** `feat(ui): single keymap with generated key list`.

### Task 8: Accessibility pass, cleanup, docs, full check

**Files:**
- Modify: `src/ui/styles.css` (delete the dead rules for removed DOM: `.topbar`, `.bottombar`, `.panel`, `.power-actions`, the old `.window` card where unused), `tests/a11y/contrast.test.ts` (extend to the light and high-contrast token blocks), `src/ui/panels/options.ts` (delete the inert `ui.quickStrip` and `ui.autoOpenContextTab`, and any setting the redesign made inert; check the saved-settings loader ignores unknown keys), `DECISIONS.md` (UX redesign section: Preact versions, calls 1–8, Ctrl+Z outcome), `docs/spec-coverage.md`, `README.md` (controls section)
- Test: `tests/a11y/*`; full suites

- [ ] **Step 1:** Extend the contrast test to all three themes, with 4.5:1 for text and 3:1 for UI glyphs on glass. Run it, then fix the tokens until it passes.
- [ ] **Step 2: Keyboard-only walkthrough e2e** (`tests/e2e/a11y-keys.spec.ts`), with Tab focus visible at each step:
  - From load, using only the keyboard, open the sheet.
  - Arm a power via the chip tablist and arrows, then Enter.
  - Open the Atlas.
  - Switch tabs with the arrow keys.
  - Open Settings and search a setting.
  - Close with Esc.
- [ ] **Step 3: Full check.**
  - Both tsc configs.
  - Full vitest (exit 0).
  - The determinism check, with `GOLDEN_HASH` unchanged.
  - Build and budgets, reporting final growth.
  - Playwright on all projects with `SR_SKIP_PERF=1`.
  - The perf spec.
  - Everything green.
- [ ] **Step 4: Commit** `chore(ui): accessibility pass, remove dead UI code and settings, docs`.
