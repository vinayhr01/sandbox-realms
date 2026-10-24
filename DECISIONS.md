# Decisions

Two parts. **Current state** is the latest verified state and wins over anything below it. **Decision log** keeps every choice in date order; where a later entry changed an earlier one, the entry says so ("superseded"). Coverage detail is in `docs/spec-coverage.md`.

## Current state (latest wins)

| Area | State |
|---|---|
| Stack | Vite 8, TypeScript 7 strict, PixiJS 8 (WebGL), Vitest 5, Playwright. Single package, `src/` split by area. |
| Realm sizes | Grid side is 64 x sizeStep. New Realm menu offers 3 to 5 (192, 256, 320). The 512 px realm is not offered. |
| Sim | Pure `Sim` class in a worker, 20 ticks/s, MessageChannel pump, 8 ms budget (warning only; tests use a 50 ms gate). Heartbeat is never posted. |
| Determinism | sfc32 seeded RNG, FNV-1a state hash. Golden replay `tests/unit/golden.test.ts`, `GOLDEN_HASH = 2562049680`. Lint `scripts/check-determinism.mjs` bans `Math.random`, `Date`, `performance.now` only. |
| Save format | `SCHEMA_VERSION = 3` (`src/sim/chronicle.ts`). Schema 2 and older are rejected. Sections 12 to 17 are optional where noted in the log. |
| Saves in play | `encodeChronicle` and `decodeChronicle` have no caller outside tests. The Chronicle window lists slots only. No autosave, load, import or export in play. IndexedDB store `SaveService` exists and is opened only for listing. |
| Beings | 90 SPECIES rows (84 beasts, 6 Folk). Folk never spawn in play (`spawnFolk` has no caller). Traits: 144 being, 154 strain. Ecosystem exit test not met (see below). |
| Combat and statuses | 24 status definitions (spec roster 56). No status is applied in play. `meleeSwing` has no caller. |
| Settlements, dominions, culture | Hamlets run (6 buildings). Dominions and culture are inert in play: `addDominion`, `addCustom`, `startIntrigue`, `addFamily` have no caller outside tests. |
| Powers | 138 entries; 136 enabled in the UI; 122 dispatch to real sim code. Favour and Insight tabs are empty (`favour_bless`, `insight_lore` disabled). |
| Rules, ages, calamities | 49 rules (about 18 never read), 11 ages, 16 calamities rolled every 80 ticks. |
| UI | 12 window ids (spec lists 62). Options: 72 settings, about 44 live, saved to localStorage. Tutorial 4 steps. Edge pan, pinch and wheel zoom. Long-press, undo and minimap missing. |
| Audio | `AudioModel` drives volumes only. `AudioEngine` (WebAudio) is not imported by the app. No music. |
| Recovery | Sentinel, journal and fatal dialog wired. `decideRecovery`, `restoreOffers` and Safe Mode are tested but unreachable. |
| Achievements | 63 defined and evaluated each sim-second (`stats-hooks.ts`). `src/sim/progression.ts` (taint, credit, codex) is tested but unused. |
| Build and CI | `npm run typecheck`, `check:determinism`, `build` (includes `check:budgets`) and Playwright in `.github/workflows/ci.yml`. Vitest config includes `tests/unit` only. |
| Browsers | Chromium and WebKit ran in this project's runs (smoke and platform specs). Firefox cannot launch on the Windows dev machine; it is configured in Playwright and CI but has not run. Devices not tested. |
| Ecosystem (M3 exit) | Not met. Old 7 or 8 of 8 species figures were measured before the 90-species roster and must be re-measured with `npm run soak`. |

## Decision log

### Built on M0 and M1

- **Repo.** Single package, `src/` split by area. Monorepo deferred until a second package exists (17 section 14).
- **Sim.** Pure `Sim` class; worker shell at 20 ticks/s; MessageChannel pump; 8 ms budget. Ticks are discarded when over budget (the world slows).
- **Determinism.** sfc32 seeded RNG; FNV-1a state hash every 20 ticks; golden replay test.
- **Protocol.** Numeric kinds, `seq` per command, transfer-mode frames with a buffer pool. Mode S (SharedArrayBuffer) not built.
- **Terrain rendering.** RGBA8 index texture (ground, cover, elevation, flags) plus palette texture, fragment shader. One 576x576 texture serves every size; `uView.w` carries the live side. Each dirty row set re-uploads the whole texture (about 1.3 MB); sub-uploads are the next step if profiling shows the upload dominates (not profiled here).
- **Brush.** Raise and lower, circle, square and diamond, radius 0 to 16, dab per line tile. Raise step 5 per dab (TUNE).
- **Input.** One Pointer Events path. Drag with an armed brush paints; otherwise drag pans. Pinch and wheel zoom. Stroke segments sent once per frame; joint tiles not repeated (`includeStart`).
- **Camera.** Fit on load; zoom 0.5x to 8x of fit (max 48 px per tile); 16 px edge margin.
- **Layout.** Portrait column; landscape (max-height 500) tool column on the right.
- **PWA.** Hand-written service worker, no `skipWaiting`. Workbox deferred. Maskable PNG icons at 192 and 512 are now shipped (`scripts/make-icons.mjs`); the earlier "only SVG" note is superseded.
- **Recovery.** Unclean-exit sentinel, local journal, fatal dialog.
- **Deferred at M1.** Undo, perf HUD beyond the `?debug` line, benchmark CI gate (the bundle gate is now in CI; the benchmark scene gate is not), ESLint and dependency-cruiser boundaries.

### Measurements and limits (M0 and M1)

- Headless Chromium uses software WebGL: about 1 to 3 fps in Playwright runs. The 60 fps target at 512x512 on phones is unverified; it needs real devices.
- Sim tick cost at 128 to 512 sizes is well under 8 ms (`npm run bench`).

### Milestones 2 and 3

- **Clock.** Calendar from ticks; ages rotate with the speed multiplier; Veiled resolves on entry.
- **Rules.** 49 rules with defaults; `forbidden_lore` one-way; age enable flags. Superseded note: the count of rules with a reader is lower than 49 (see Current state).
- **Worldgen.** Value noise on an integer lattice (gradient noise replaced); forceHeight; centre shapes; basin; lake; low and high ground; shore snap; round and square edges; typing; mountain edges; freeze peaks; weighted biome flood fills; 10 flora passes; starting beasts.
- **Terrain.** Fire with scars; sea refill and hollows; magma levels with flow and cooling; freeze and thaw with shoal spread; heat; biome spread.
- **Beings (first version).** Species table of 8 from 18a; SoA store with generations; fuel and starvation; ageing and natural death; mating with gestation and litter; flee, hunt, graze, wander. This table is superseded by the 90-species roster (see Beings round 2).

### Ecosystem history (M3)

- **Round 1 (superseded).** `npm run soak` ran 1,000 beasts for 10 sim-years. Population stayed bounded but species balance was not stable. Per-species numbers were TUNE.
- **Breeding rule.** Breeding needs fewer than six other beings in the 16x16 patch (06 6.1). Flora spread covers the map; wild seeding places patches. Predator metabolism knob in `beings/tuning.ts`.
- **Regrowth.** Regrowth delay 1,200 ticks (TUNE). Sweeps showed no change in outcome.
- **Exit criterion chosen.** The spec says "stable ecosystem for 10 sim-years". Because spec files are read-only here, this project defines it as: total beasts between 300 and 3,000 in every sim-year, on every seed (`STRICT=1 npm run soak`). Extinctions are logged, not failures. All-eight-species survival was a stated goal and is not met.
- **Latest measured result (8-species roster, before the 90-species change).** Survivors 7, 8, 7 of 8 on seeds 2024, 7, 99; 8, 7, 7 on unseen seeds 1, 555, 31337. Sweeps of predator metabolism, hunt radius, flora spread, grazing gain and regrowth did not reach 8 of 8. The 90-species result is in Beings round 2.
- **Spec-population test.** At spec density (about 100 starting beasts instead of 1,000) populations fell to 11 to 101 by year 10. The exit test needs the seeded population.
- **Not built.** The 06 section 6.1 living-children cap needed parent links; it is built in Beings round 2.

### Milestones 4 and 5

- **Combat.** Melee with reach 1 and a 6-tick hit window; plating for Weapon and Other only, integer math; projectiles land on their target tile; blasts with falloff, crater, fire and an anti-spam guard; 24 status definitions in `effects.ts` (spec 56) with hooks. Weather clouds from age weights; drops mapped to rain, freeze, fire and acid; storm lightning.
- **Not built (M4).** AI-driven fights (beasts fight only while hunting), 32 remaining statuses, bolts as projectiles, spells, gear, boats, dazed or dozing sleep, factions. Superseded note: `meleeSwing` has no caller in play, so melee is tested only.
- **Saves (M5).** Versioned, checksummed format with sections for clock, realm, ages, rules, stats, beings, RNG streams, timers, tile runners, combat, statuses, weather and projectiles. Resume test: save at tick N continued to M matches an uninterrupted run. Typed arrays written raw (little-endian host assumed). Runner orders are JSON, large at 512 tiles.

### Milestones 6 to 12 (slices built in parallel)

- **M6 settlements** (`src/sim/settlements`): hamlets with 8x8 parcels, six buildings, stockpile, food-driven growth.
- **M7 dominions** (`src/sim/dominions`): relation matrix (peace, tension, war), campaigns, peace pacts, `parley`, `standing_armies`, `border_creep`. Tension has no effect.
- **M8 culture** (`src/sim/culture`): customs, creeds, dialects, families, intrigues. Tuning values are placeholders.
- **M9 powers and calamities.** 16 calamities of 02 section 8.2 with the 80-tick roll. Powers: see Powers below.
- **M10 UI models** (`src/ui/panels`): options with clamped values and injectable storage; list sort, filter, search and a virtual list; tutorial steps; power bar model.
- **M11 audio and stats.** Audio bus model with voice caps and a hidden-tab mute; stats counters; achievements (63 defined).
- **M12 checks.** Gzip budgets (main about 83 KB, worker about 26 KB against 350 and 250 KB limits); dark-theme contrast (text 14.6:1, secondary 7.7:1, ink on accent 10.9:1); build budgets in CI.

### Merge of the parallel units

- Settlements, dominions, culture, powers and calamities, stats and achievements were wired into `Sim` and the UI. Options dialog and power bar added.
- Superseded: "Only Raise and Lower work on the map; other powers arm but do nothing." Now 136 of 138 powers are enabled in the UI, and 122 dispatch to sim code.
- Superseded: "dominions are in the running sim". Dominion creation has no caller in play; the code runs only when a dominion exists (tests).
- Save format at the merge: SCHEMA_VERSION 2. Chronicle sections culture 12, calamity 13, lifetime 14, dominions 15, hamlets 16 (12 to 16 optional). Older saves still load. Saves from before the flora regrowth change (schema 1) were rejected.

### Fix rounds

- **Saves.** Dominion state (tag 15) and hamlet state (tag 16) saved and restored. Relations saved only for existing pairs (the matrix has no iterator). A resumed run matches an uninterrupted run (`tests/unit/persist-wiring.test.ts`).
- **Hamlets.** Births no longer stop building or wood; food capped; wells produce food; territory grows only when a building is placed; no parcel owned by another hamlet can be claimed (regression test, seed 11).
- **Counters.** `sim.beings.stats.births` counts every spawn (starting beasts and adults included). Lifetime `beingsBorn` counts newborn children. Names are misleading but not a double count.
- **Stone.** Quarry (10 wood) turns outcrop stock into 2 stone per growth step. Outcrops start at 40, regrow 1 per 5 steps, cap 60. Not built: miners as folk jobs, prospectors, salvage, other outcrop types.
- **Calamity hamlet gate.** `rollAndRunCalamity` passes the live hamlet count; calamities with a hamlet minimum can fire (test `tests/unit/calamity-gate.test.ts`).
- **Litter.** Brood equals the species litter value; one roll per brood slot (06 section 6.4). The first baby is always born.
- **Speed.** Tiles per tick = pace x 0.2 / 20 (07 section 7.1). Superseded for terrain: `tileMult` is now applied (see Beings round 2 and Final round).
- **Tick-cost test.** Uses a median with a 50 ms gate; the 8 ms budget is a warning only.

### Beast stats and nectarbuzz

- Beast stats are the 18a roster values (`tests/unit/beast-roster.test.ts`). Hunters, prey, litter and gestation are not in the roster and stay as the sim's food-web simplification. Omni diets map to grass in the early version (superseded by Beings round 2 diet rules).
- Nectarbuzz adult age: with span 5, adults start at ceil(2.87) = 3 years and live about 2 more (06 section 3.1).

### Worldgen round 2

- Code: `src/sim/worldgen.ts` (pipeline, templates), `src/sim/worldgen/` (`noise.ts`, `pick.ts`, `water.ts` rivers and lakes, `replace.ts` replace rules, `layouts.ts` Chessboard, Cells, Warren, starter volcano).
- Defaults: minLand 6% (3% Archipelago, 0 Blank and Warren). Rivers 2 on Continent and Walled Plain. Lakes 1 on Continent. Lake water shares the sea kind `shoal`; no separate fresh-water kind.
- Layout RNG uses separate streams per feature so templates without those features keep pre-round terrain.
- Biome share test from 18c section 3 (10,000 samples, within 3 percentage points absolute).
- Deviations: river landmass guard not built (rivers may split land); river walk never re-enters its tiles and stops at foreign water or after 700 steps; rivers under 20 tiles rolled back; lake seeds are lowloam or highloam at least 20 tiles from sea; replace rule uses `n255 >= threshold`; layouts run after `removeMountains`; Cells walls become crag; Warren carving stalls at walkable tiles.
- Starter volcano: 6x6 `molten_4` footprint on the largest landmass. Terrain only; the volcano structure does not drive emission in this round (later added in Terrain round 2).
- Golden hash moved (890385179 to 213197484 at the time).

### Terrain round 2

- **Heat.** Decays 1 per 20-tick run (was 2). Threshold effects run at the new heat and on each heat run. Lightning adds 9 heat in radius 2 (TUNE). Heat effects skipped under `sanctuary_seal`. Heat 24 detonates a device with radius and damage 10 x radius.
- **Scars.** Stage is `15 - randInt(10)`, so 6 to 15 (the acceptance test wins over 04's table).
- **Volcano.** Cone 6x6 `molten_4`, one drop every 2 ticks, landing 2 to 8 tiles away. Small vent 3x3 `molten_3`, bursts every 1,200 to 3,600 ticks. Drops land instantly.
- **Geyser.** One drop every 50 ticks (TUNE). Water lands 2 to 17 tiles away and runs `rainDrop`; acid lands 2 to 15 away and runs `acidTerraform`.
- **Quakes.** 12 shapes (3 base x 4 rotations) grown at module load; `power` lowers or raises by one brush step. Fast variant is the default; slow variant OPEN.
- **Acid, slime, creep.** Per 04 section 4.1, 4.2 and 18e 1.3, with the stated deviations: creep pulse every 160 ticks with exact first pulse; cap 12 live hubs; decay every 26 ticks.
- **Minerals.** Nodes are flora codes of kind `mineral`; natural seeding on knoll, crag and highloam; 3 tries every 2 ss; cap 2 per parcel.
- **Flora spread.** One job per kind, periods 50, 40, 30 ss (10 ss under `fast_*`); tree cap 3 per parcel (4 under `dense_flora`).
- **Meteors.** `skyrock_small` (radius 20, damage 500) and `skyrock` (1,000) use `explode`. Flight not modelled.
- **Not saved.** Vents, quakes in progress, creep hubs and flora jobs sit in a WeakMap (`terrain/state.ts`), so a Chronicle load drops them. Fixing needs a schema change (not made).
- **Not wired at the time.** Power handlers for skyfall, tremor, fire vents, springs, creep and warmth. Now wired in `terrain-powers.ts` and `handlers.ts`; verify with the power tests.
- Golden hash moved to 890385179, then 213197484.

### Beings round 2

- **Roster.** 90 species (84 beasts from 18a section 2, 6 Folk from section 1). Folk and aquatic or Architect rows are `wild: false`: never seeded or spawned by `spawnBeing`. Folk use `spawnFolk`, which has no caller in play.
- **Diets.** 18a tags map to grass, nectar, flesh, omni, plus `none`.
- **Defaults for OPEN values.** Litter and gestation by size. Derived prey for flesh eaters. Sea and coast grounds kept in `grounds` and not seeded.
- **Stat assembly (05 section 3).** Species base, strain and being sources, aptitudes, add-then-multiply, clamps, baby halving (maxVit halved too). Level, equipment and temperament steps not built.
- **Traits.** All 144 being and 154 strain traits as data (`src/content/traits.ts`). Births inherit by `inh` percent. Birth mutation draw is rand(0, mutation) (05 section 7.4).
- **Strains.** An adult joins the nearest same-species member within 40 tiles, else founds a strain. No lineage code (05 section 5), splitting or uplift.
- **Parent links (06 section 6.1).** One bearer slot with a generation check; living-children count rebuilt on load; cap is ceil(litter) on the bearer. Partner cap not tracked.
- **Not built.** pop_cap enforcement, birthday aptitude growth, morph variants, bossScale, abilities, Folk dominion behaviour.
- **Save.** SCHEMA_VERSION 2 to 3 (parent slot and generation, strain id, aptitudes, marks in beings; new section 17 for strains). Schema 2 saves rejected.
- **Golden** moved to 812831521 at the time; the current golden in `tests/unit/golden.test.ts` is 2562049680 (not re-run in this review).
- **Soak (strict, 90 species).** Totals at year 10: seeds 1, 555, 31337: 1434, 1103, 1160. Seeds 2024, 7, 99: 1389, 1466, 1573. Survivors 32, 38, 41 and 39, 40, 33 of 90 species. The all-species criterion is not met.

### Powers

- Power definitions live in `src/content/powers.ts` (138 entries). `powerStatus` in `src/ui/powerSupport.ts` enables a power when its handler is in `SIM_HANDLERS` or `UI_HANDLERS`, or its window exists.
- Dispatch: `executePower` in `src/sim/powers/handlers.ts`. Terrain helpers in `src/sim/powers/terrain-powers.ts`.
- Not built: Favour (28 spec entries) and Insight (about 40), Shape tools beyond raise, lower and ground paints, most Grow powers, the 12 bomb profiles, the Folk and sea spawners.
- Superseded: the "64 powers, most without UI path" note and the "only raise and lower reachable" note.

### Ecosystem and content counts (current)

- Achievements 63 (spec 63); stat evaluation runs each sim-second.
- Settings 72 (the spec 14 count in older notes was about 65).
- Windows 12 in `WINDOW_CATALOG` (spec 13 lists 62).

### Open items

- Re-measure the M3 exit with the 90-species roster (`npm run soak`) and record the result here.
- Decide whether the 06 section 6.1 partner cap is required.
- Settle the milestone-to-spec mapping: `BUILD-PLAN.md` and `Spec/ROADMAP.md` disagree on some rows (e.g. M0 lists 13; M3 lists 18a and 18b). This project follows ROADMAP and adds 18a to 18e from BUILD-PLAN.
- Save wiring, recovery wiring, audio engine wiring and the heartbeat are all unwired in the running game (see Current state).
