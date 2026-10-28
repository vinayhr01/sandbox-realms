# Part 3 of 3: UX redesign

Status: draft for owner review, 2026-10-28. Parts 1 (plain names) and 2 (map graphics, merged in 21b83d1, tagged `checkpoint-2026-10-28`) have shipped. This part reuses part 2's icons.

## Intent

The game should feel simple at first, then reveal its depth as the player goes. Players should keep discovering what the simulation can do: physics, ecology, evolution, peoples, towns, beliefs, wars. They should be stunned that something this deep runs in a browser behind a UI this clean.

The UI should look like a modern game, not the plain text-button panels of today: dark glass panels, large art icons, smooth motion, and a fitting animation every time the player uses a power. It must work well on phones (touch), tablets and desktop (mouse and keyboard).

## Goals (owner decisions)

- **Layout B, with the bottom sheet everywhere.** There is one pull-up bottom sheet for powers on every screen size; desktop does not get a side rail.
  - Collapsed, the sheet shows category chips plus the player's 3 most recent powers.
  - Expanded, it shows search plus a grouped grid of art icons, with "new" markers.
  - Mockup: `.superpowers/brainstorm/1383-1793167581/content/layout-b-bottom.html`.
- **Progressive discovery, no locking.** Nothing is ever locked: "More ▾" and search always reach every power. The game brings categories forward as the world earns them.
- **A deploy effect for every power.** Each power plays a fitting animation when used. Examples: a creature pops in with a shimmer, rain clouds roll in, a meteor streaks down and hits, land rises with dust, a blessing sparkles.
- **Information, in two places:**
  - **The floating info card.** Tapping something on the map opens it near the thing. "More" opens the thing's full page.
  - **The Atlas.** Everything else lives in one full-screen view opened from the top bar, with tabs: World, Peoples, History, Discoveries, Settings. The Atlas is searchable and closes in one tap.
- **Library.** Use Preact with Signals for the new UI shell, pinned to exact versions. The owner prefers less code with a library doing the heavy lifting.

## Goals (lead's proposals, accepted by the owner)

- **Top of the screen.** Two floating pills sit at the top.
  - Realm pill: realm name, year, creature count and town count. It opens the Atlas.
  - Speed pill: pause, ½, 1, 2, 5 and 10×.
- **First launch.**
  - A new world opens with a 3-step hint: shape the land, add life, change the speed.
  - The sheet starts with only the Land, Nature and Creatures chips. Every other chip lives under "More ▾".
- **Bringing chips forward.** Chips move from "More ▾" to the main row the first time their trigger happens, each with a short "New!" card.
  - Weather: the first storm or rain.
  - Peoples: the first town.
  - Disasters: the first calamity, or Year 2.
  - Blessings: the first creed.
  - Inspect: the first war or dominion.
  - The exact trigger list is in "Left to the builder".
- **Discoveries tab.** Every first event gets an entry with a one-line plain explanation of what the simulation did. Examples: first town, first mutation or new strain, first war, first extinction.
- **Look.**
  - Dark glass panels: translucent with a backdrop blur, rounded corners.
  - A warm gold highlight for the armed and active state.
  - Smooth slide and fade transitions.
  - The light and high-contrast themes stay.
- **Keyboard.**
  - 1–9: the recent and favourite powers.
  - Q: open or close the sheet (see calls made, 1).
  - / : search.
  - Arrow keys and WASD: pan. + and −: zoom.
  - Space: pause.
  - Ctrl+Z: undo the last stroke.
  - Esc: disarm, or close the top layer.
  - Every binding is listed in Settings.
- **Touch.** Pinch to zoom, two-finger drag to pan, long-press for info. Remove the 300 ms double-tap delay on inspect taps.
- **Accessibility.** Full keyboard and screen-reader operation, touch targets of at least 44 px, reduced-motion support.

## Non-goals

- No change to the simulation rules, the save format, `GOLDEN_HASH` (1357125849) or the content ids.
- No new art set; reuse part 2's SVGs. Category glyphs may be simple SVG icons drawn in the same style.
- No 3D or isometric view.
- Converting every one of the 74 existing window bodies to Preact is not required. Convert only where it saves code or the new layout needs it.

## Anti-goals (a failure even if it works)

- A crowded first screen: more than one row of controls visible on a phone at first launch.
- Locked or hidden-forever features.
- Effects or panels that drop frame rate noticeably, or effects that ignore reduce-motion.
- Losing keyboard or screen-reader access compared with today.
- Breaking saves or determinism.

## Constraints and findings (today's UI)

- **Structure.** The UI is plain DOM and CSS:
  - `index.html` holds the static shell.
  - `src/ui/styles.css` is 1099 lines with about 10 tokens.
  - `src/app/main.ts` holds most of the wiring: `renderPowers`, `activatePower`, `setArmed`, the keydown handler and `openWindow`.
  - `src/ui/**` holds the window bodies and models.
- **The bottom bar stacks 4 rows.**
  - 3 top tabs: Terrain, Realm, Powers.
  - 8 power tabs that scroll sideways.
  - A flat power list of up to 90 buttons.
  - 46 window buttons in one scrolling row.
  - The power tabs hold 250 powers: World 14, Terrain 13, Nature 19, Weather 6, Creatures 90, Destruction 31, Blessings 21, Inspect 56.
  - The bottom Terrain tab is a different thing from the Terrain power tab.
  - The power-kind dispatch is in `activatePower` (`main.ts` ~850–975).
- **Windows.**
  - One native `<dialog>`, replace-only, with no back stack and no focus return. Defined in `windowHost.ts`.
  - `windowCatalog.ts` has 74 kinds. 46 have buttons.
  - Content builders: `detailWindows.ts`, `snapshotWindows.ts`, `specWindows.ts`, `systemWindows.ts`, `staticWindows.ts`, `windowContent.ts`.
  - Dev and error windows are visible to everyone.
- **Missing feedback.** No cooldown display, no persistent armed indicator, no population HUD.
- **Unwired code.** `powerBar.ts` has favourites and `stepBrush` that nothing uses.
- **Settings.** 78 settings in 11 groups (`src/ui/panels/options.ts`), shown as one long modal. `ui.quickStrip` and `ui.autoOpenContextTab` do nothing today.
- **Input.** `src/ui/input.ts` covers pinch, pan, long-press 500 ms, double-tap 300 ms and the touch pick radius. The keydown handler is at `main.ts` ~1686. The Keys window lists 8 of about 25 bindings.
- **Tutorial.** 4 steps in `src/ui/panels/tutorial.ts`. Its text references old tab names.
- **Media queries.** Only short-landscape and ≥ 900 px. No portrait phone or tablet rules.
- **Layout collisions.** The minimap and the possession pad share the bottom-right corner. The coach, toasts and ticker overlap at the top.
- **Discovery data.** The game already records discoveries and achievements: `stats.ts`, `progression.ts`, `content/achievements.ts`, `discoveries` entries such as `species:<id>`. Persisted with the lifetime stats.
- **Budgets.** The main bundle is about 200 KiB of 350 KiB gzip, so Preact plus Signals at about 6 KB fits.
- **Tests pinned to the current layout.** About 8 e2e specs open windows via `getByRole('tab', { name: 'Powers', exact: true })` and then the window button by its exact name.
  - Other pinned selectors and names: `#realm-name` ("Realm 16" exact), `#status`, `#pause`, `#map canvas`, `#coach`, `#fatal*`, `#power-tabs .power-tab`, `[data-power-id]`, Settings with exactly 11 groups.
  - `platform-smoke` asserts no horizontal overflow on 360×640 and 1920×1080.
  - The a11y contrast test reads `--text`, `--surface`, `--text-dim`, `--accent` and `--accent-ink` from the first `:root` block of `styles.css`.
  - The redesign updates these tests to the new structure and keeps their intent. Coverage must not be lost.

## Approaches considered (owner picked 2)

1. **Rebuild the UI in plain DOM and CSS.** No dependency, but more hand-written UI code to maintain.
2. **Preact with Signals for the new shell (picked).** Components plus reactive state cut the most code: the sheet, chips, search, info card, Atlas, toasts and "New!" cards. Existing window bodies are mounted inside the Atlas instead of being rewritten. About 6 KB.
3. **UI drawn in the canvas.** Rejected: it loses accessibility, makes text and inputs hard, and is the biggest rewrite.

Rejected as not worth a dependency: animation libraries (CSS transitions are enough, and map effects use Pixi) and gesture libraries (sheet drag is about 60 lines, and input handling already exists).

## Design

### A. Shell (Preact)

- **Mount.** The shell mounts into a root in `index.html`. The map canvas stays where it is.
- **State.** App state lives in Signals, owned by a small store module and fed from `main.ts`:
  - armed power, brush size and shape
  - speed
  - the latest snapshot summary (counts, year)
  - the discovered chips
  - recent powers
  - the open info target
  - Atlas open state and tab
- **Components:**
  - `TopPills`
  - `PowerSheet` (collapsed and expanded, drag handle, chips, search, grid, recent row)
  - `InfoCard`
  - `Atlas` (tabs)
  - `Toasts`, which take over today's toasts, status line and "New!" cards
  - `Coach`, for the first-launch hint
  - `PossessPad`, restyled and moved so it never shares a corner with the minimap
  - `Minimap` frame, restyled
- **Power dispatch.** `activatePower` and the power-kind dispatch stay in `main.ts`, or move to a plain module. The sheet calls them; no game logic moves into components.

### B. Power sheet

- **Categories.** Chips map onto today's 8 tabs, renamed for clarity: Land, Nature, Creatures, Weather, Disasters, Blessings, Peoples/Realm, Inspect.
  - The Terrain tools Inspect, Raise and Lower move into Land.
  - Brush size and shape show as a small control on the sheet whenever a brush power is armed.
- **Grouping.** Within a category, sub-groups such as Creatures → Animals, Birds, Sea, Insects, Undead, Monsters, Peoples come from the part 2 art chunks and the power kinds.
- **Icons.**
  - Creature and building powers use their SVG art.
  - Other powers use small SVG glyphs in the same style, which the builder draws.
  - Labels show the plain names.
- **Recent and favourites.** The recent row holds the last 3 powers collapsed and 9 expanded, and drives the 1–9 keys. Long-press or right-click pins a favourite, reusing `powerBar.ts`.
- **Cooldowns.** A cooldown shows as a ring sweep on the icon. The armed power has a gold glow and also appears as a badge on the collapsed sheet.
- **Search.** Search covers every power by plain name and category.
- **Desktop size.** On desktop the sheet is centred and its width is capped at about 720 px.

### C. Atlas

- **Layout.** A full-screen overlay with tabs: World, Peoples, History, Discoveries, Settings. On phones it is a full-screen sheet with tabs at the top.
- **Content.** Each tab hosts the relevant existing window bodies as sections or sub-pages, with a back stack inside the Atlas:
  - World: realm, rules, ages, stats, map layers.
  - Peoples: dominions, towns, creeds, customs, dialects, clans, armies, pacts.
  - History: chronicle and saves, annals, ticker log.
  - Discoveries: discoveries and achievements.
  - Settings: grouped, searchable, with collapsible groups. Keys are listed here, and Developer tools and error windows sit behind a "Show developer tools" switch.
  - The builder maps each of the 74 window kinds to a tab, or to the info card.
- **Single entry point.** The Atlas replaces the single `<dialog>` for everything except confirmations and the fatal crash dialog. Those stay as modal dialogs, with focus return added.

### D. Info card

- Tapping a being, town or building opens the card near it, or as a bottom sheet on phones. It shows the plain name, the key facts and 2–3 actions (Follow, Possess, More).
- "More" opens the Atlas page for that thing.
- The card closes on map pan or Esc. It replaces today's tap-to-open `win_being` and the hover tooltip's role on touch. Desktop hover tooltips stay.

### E. Progressive discovery

- **Discovery state.** A small discovery state extends the persisted UI state, in the same safe storage as the tutorial. It holds the chips discovered and the "new" markers that have been seen.
- **Triggers.** Triggers read existing sim events and stats (first storm, first hamlet, first calamity, first creed, first war, first mutation or strain, first extinction). This needs no sim changes.
- **What a trigger does.** It moves the chip into the main row, shows a "New!" card, and adds a Discoveries entry with its explanation text. The explanation texts are new content strings.
- **Reset.** The starter state is Land, Nature and Creatures. A "Show all categories" setting reveals everything at once. A new world does not reset discoveries: they are lifetime, like achievements.

### F. Deploy effects

- **Layer.** An effects layer drawn with Pixi over the map, with pooled sprites and particles. It follows the part 2 dust pool pattern.
- **Mapping.** Each power kind or handler maps to one effect recipe:
  - spawn: shimmer and pop
  - brush: dust puffs along the stroke
  - weather: cloud roll-in
  - explosions and calamities: flash, shock ring and debris, with a meteor streak for skyfall
  - blessings: sparkles
  - curses: dark wisps
  - rule toggles: a top-pill pulse
- **Firing.** Effects play on the main thread when the command is sent (optimistic). They don't wait for the sim.
- **Budget and settings.** A cap of 256 particles. Effects respect `reduce-motion` and `reduce-flash` (flash effects become fades), and they join the quality ladder as an early step.

### G. Input and shortcuts

- **One keymap.** A single keymap module defines every binding. The Settings keys list is generated from it, so it can't go stale. Bindings are as listed in the goals.
- **Ctrl+Z.** Undo of the last stroke needs a stroke-undo path: re-applying the stroke's previous tiles. The builder checks the feasibility against the sim command model. If true undo isn't possible without sim changes, drop Ctrl+Z and say so.
- **Touch.** Inspect taps fire at once. Double-tap zoom is removed in favour of pinch, and a zoom-in button sits on the map.

### H. Visual system

- **Tokens.** A token set in CSS custom properties:
  - colours, keeping the names the a11y test reads
  - glass surface with blur, borders and radii
  - spacing scale, type scale, shadows
  - motion durations and easings
- **Themes.** Dark default, light, high-contrast.
- **Fallback.** A `backdrop-filter` fallback for devices without it: solid surfaces.
- **Styles.** `styles.css` is reorganised or replaced by component-scoped CSS, using plain CSS files imported per component.

## Verification

- **Unit tests:** the store and Signals, sheet logic (recent, favourites, search), discovery triggers, the keymap, and the effect recipe mapping. Preact component tests can use jsdom, already a dev dependency.
- **E2E updated to the new structure:**
  - Open windows via the Atlas or sheet with stable roles and names.
  - Keep the `#map`, `#status` (or its successor live region), `#fatal*` and `window.__sr` hooks.
  - Keep no horizontal overflow at 360×640 and 1920×1080.
  - New e2e checks:
    - First launch shows only 3 chips.
    - A trigger brings a chip forward with a "New!" card.
    - Keys 1–9 arm recent powers.
    - Search finds a power.
    - Esc closes layers in order.
    - The info card opens on a tap.
- **Accessibility:** the contrast test is kept or extended to all themes. Roles: tablist with arrow-key navigation, dialog focus trap and return, aria-live for "New!" cards.
- **Existing checks:** typecheck, the full unit suite, determinism with `GOLDEN_HASH` unchanged, budgets (main ≤ 350 KiB, growth reported), Playwright on all projects, and the perf job (the creature gate must still pass with effects on).
- **Manual check:** in the browser pane at phone and desktop sizes, a first-launch walkthrough, and the effects for each category.

## Calls made after the builder check (lead's calls; owner to check)

1. **Keys 1–9 and opening the sheet.**
   - The recent row is one list: pinned favourites first, then the most recent unpinned powers, up to 9.
   - Keys 1–9 work whether the sheet is collapsed or expanded. The collapsed sheet just shows the first 3.
   - The sheet opens and closes with **Q**, not Tab. Tab keeps normal focus navigation.
   - Today's bindings stay unchanged where they don't clash: P, H, [ ], Esc, the possession keys J K L U T Y N, WASD and the arrows.
2. **Where the 250 powers go.**
   - Chips: Land, Nature, Creatures, Weather, Disasters, Blessings, Peoples, Inspect.
   - Land holds the old Terrain power tab plus the bottom-bar tools Inspect, Raise and Lower.
   - Peoples holds the powers that act on peoples and realms. Today these are spread across Inspect and Blessings; the builder sorts them.
   - The old **World** tab is not a chip:
     - Pause and the speeds go to the speed pill.
     - Rules, Ages and Chronicle go to the Atlas World and History tabs.
     - Hide interface stays a key (H) and becomes an Atlas World toggle.
   - "More ▾" lists every chip not yet in the main row.
   - `data-power-id` stays on every power button.
3. **Discovery state.**
   - It is lifetime, kept in safe storage.
   - Triggers are derived from snapshot stats and counters. They are idempotent, with no new worker events.
   - When an old save or a long-running world already meets several triggers, the chips come forward silently and one summary card appears: "Discovered: Weather, Peoples…". Discoveries entries are added without a burst of cards.
4. **Atlas versus today's window API.**
   - `openWindow(kind)` stays as a compatibility shim that routes into the Atlas tab or page for that kind.
   - Live-updating windows keep refreshing from each snapshot while they are shown.
   - Confirmations and the `#fatal` crash dialog keep their current modal behaviour and hooks, plus focus return.
   - The Settings e2e that expects exactly 11 groups is updated if the grouping changes.
5. **Ctrl+Z.** Implement it only if it needs no sim or save change, for example by replaying the stroke's recorded previous tiles through an existing command. Otherwise drop it, leave it out of the keymap, and record that in DECISIONS.md. Dropping it does not block delivery.
6. **Cooldowns and effects.**
   - Cooldowns come from the client-side `cooldownUntil` map that `main.ts` already keeps, so there is no sim change. That map drives the ring sweeps.
   - An effect plays only when the client actually sends the command. It does not play on cooldown or for an unavailable power.
   - A rare sim-side rejection still shows the effect. That is accepted.
7. **Info card.**
   - Tap opens the card.
   - It follows its being while the being lives and is in view. It shows "gone" if the being dies.
   - It closes on Esc, the close button, a tap on empty map, or opening another card. Panning does not close it.
   - Long-press keeps today's held-inspect behaviour (tile info while held) and doesn't open a card.
8. **CI stays green at every delivery step.** Step 2 keeps a temporary "Windows" chip that holds the old window launchers, so window e2e keeps working until step 3 moves them into the Atlas and migrates the specs. No step lands with skipped or broken specs.

## Left to the builder

- The exact mapping of the 74 window kinds to Atlas tabs or the info card.
- Glyph icons for non-creature powers.
- The final trigger list and the explanation text for discoveries.
- The effect recipes and their tuning.
- How `main.ts` is split while wiring the store.
- Whether Ctrl+Z is feasible.
- CSS organisation.

## Delivery order

1. **Foundation:** add Preact and Signals (pinned), the token system and themes, the store wired from `main.ts`, the top pills, and `Toasts` and the live region.
2. **Power sheet:** chips, grid, search, recent row and favourites, the brush control, cooldown rings and the armed badge, with the old bottom bar removed. Includes e2e migration for powers.
3. **Atlas:** tabs and back stack hosting the existing window bodies, Settings regrouped and searchable, the dev-tools switch, and the e2e migration for windows.
4. **Info card and touch input changes.**
5. **Progressive discovery:** chips, "New!" cards, Discoveries tab, first-launch hint (replacing the old tutorial).
6. **Deploy effects layer** and its quality-ladder step.
7. **Keymap module and shortcuts.**
8. **Accessibility pass, full check, docs and DECISIONS entry.**
