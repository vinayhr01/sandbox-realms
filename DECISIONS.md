# Decisions

Two parts. **Current state** is the latest verified state and wins over anything below it. **Decision log** keeps every choice in date order; where a later entry changed an earlier one, the entry says so ("superseded"). Coverage detail is in `docs/spec-coverage.md`.

## Current state (latest wins)

| Area | State |
|---|---|
| Stack | Vite 8, TypeScript 7 strict, PixiJS 8 (WebGL), Vitest 5, Playwright. Single package, `src/` split by area. |
| Realm sizes | Grid side is 64 x sizeStep. New Realm menu offers 3 to 5 (192, 256, 320). The 512 px realm is not offered. |
| Sim | Pure `Sim` class in a worker, 20 ticks/s, MessageChannel pump, 8 ms budget (warning only; tests use a 50 ms gate). Heartbeat is never posted. |
| Determinism | sfc32 seeded RNG, FNV-1a state hash. Golden replay `tests/unit/golden.test.ts`, `GOLDEN_HASH = 2562049680`. Lint `scripts/check-determinism.mjs` (its own CI job) bans `Math.random`, `Date.now`, `new Date(`, `performance.now` and `crypto.getRandomValues` in `src/sim`, `src/shared` and `src/content`; `src/sim/worker.ts` is the one allowlisted file. |
| Save format | `SCHEMA_VERSION = 3` (`src/sim/chronicle.ts`). Schema 2 and older are rejected. Sections 12 to 17 are optional where noted in the log. |
| Saves in play | Wired. The sim worker runs `encodeChronicle` and `decodeChronicle` on capture and restore commands (`src/sim/worker.ts`; `liveRealm` in `src/app/main.ts`). `SaveController` runs save, load, delete, export, import, autosave (timer and on pause) and the restore prompt over `SaveService` (IndexedDB, memory fallback). Not run in a real browser: the IndexedDB backend (type-checked and model-tested only). Checksum quarantine not built. |
| Beings | 90 SPECIES rows (84 beasts, 6 Folk). Folk never spawn in play (`spawnFolk` has no caller). Traits: 144 being, 154 strain. Ecosystem exit test not met (see below). |
| Combat and statuses | 24 status definitions (spec roster 56); 10 applied in play, 14 cut (see "Combat release"). `meleeSwing` is called by `predate` (eat_hunt). 6 projectile kinds launched from gear; 8 bomb profiles in play. Not tested (development instruction). |
| Settlements, dominions, culture | Hamlets run (6 buildings). Dominions and culture are inert in play: `addDominion`, `addCustom`, `startIntrigue`, `addFamily` have no caller outside tests. |
| Powers | 159 entries (138 before Powers round 4, plus 21). Favour: 21 entries (Bless and 20 round-4 entries); Insight: 2 (Lore and Compare). Favour and Insight rows the sim cannot express are cut (see Powers round 4). Enablement is by `powerStatus` (`src/ui/powerSupport.ts`). |
| Rules, ages, calamities | 49 rules (about 18 never read), 11 ages, 16 calamities rolled every 80 ticks. |
| UI | `WINDOW_CATALOG` has 74 entries: 62 of 62 spec window rows built (the nine `win_customize_*` ids are one row), plus 4 extras. Options: 75 settings (72 spec 13 rows and 3 spec 16 audio rows), saved to localStorage; 49 rows are flagged `live` after Map layers round 6 (the older "about 44" figure was not reproduced). Tutorial 4 steps. Edge pan, pinch and wheel zoom. Long-press, undo and minimap missing. |
| Audio | Wired. `AudioEngine` (WebAudio, `src/audio/engine.ts`) is built in `main.ts` and unlocks on the first pointer, key or touch (never in Safe Mode). A procedural music bed starts on unlock; its state follows pause and tab visibility. `AudioModel` holds voice caps, volumes and mutes. Not checked on a device. |
| Recovery | Wired. Sentinel, journal and fatal dialog (`main.ts`). `decideRecovery` picks the ladder step on a fault; the restore offer uses `restoreOffers` (Safe Mode offers only the previous autosave generation); the boot-loop guard shows its own dialog. No crash record, consent or chaos test. |
| Achievements | 63 defined and evaluated each sim-second (`stats-hooks.ts`). `src/sim/progression.ts` is used: `codexProgress` (`snapshot.ts`), `trophySummary` and `visibleText` (`snapshot-model.ts`). Its `countsCredited`, `grantAllowed` and `achievementProgress` are tested but have no caller outside tests. |
| Build and CI | `npm run typecheck`, `check:determinism`, `build` (includes `check:budgets`) and Playwright in `.github/workflows/ci.yml`. Vitest config includes `tests/unit` only. |
| Browsers | Chromium and WebKit ran in this project's runs (smoke and platform specs). Firefox cannot launch on the Windows dev machine; it is configured in Playwright and CI but has not run. Devices not tested. |
| Ecosystem (M3 exit) | Not met. The strict soak (`STRICT=1 npm run soak`) was run on the 90-species roster: year-10 totals were 1,103 to 1,573 on six seeds, and 32 to 41 of 90 species survived (the record gives year 10 only). All-species survival is not met. See Beings round 2. |

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
- Save format at the merge: SCHEMA_VERSION 2. Chronicle sections culture 12, calamity 13, lifetime 14, dominions 15, hamlets 16 (12 to 16 optional). Older saves still load (superseded: schema 3 rejects schema 2 and older, see Beings round 2). Saves from before the flora regrowth change (schema 1) were rejected.

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
- Settings 72 (the spec 14 count in older notes was about 65). Superseded: the table has 75 rows (72 spec 13 rows and 3 spec 16 audio rows).
- Windows 12 in `WINDOW_CATALOG` (spec 13 lists 62). Superseded: the catalog has 74 entries; 62 of 62 spec window rows are built, and 4 entries have no spec id.

### Open items

- ~~Re-measure the M3 exit with the 90-species roster (`npm run soak`) and record the result here.~~ Done: see Beings round 2 (strict soak, 90 species).
- Decide whether the 06 section 6.1 partner cap is required.
- Settle the milestone-to-spec mapping: `BUILD-PLAN.md` and `Spec/ROADMAP.md` disagree on some rows (e.g. M0 lists 13; M3 lists 18a and 18b). This project follows ROADMAP and adds 18a to 18e from BUILD-PLAN.
- ~~Save wiring, recovery wiring, audio engine wiring and the heartbeat are all unwired in the running game.~~ Superseded: save, recovery and audio are wired (see Current state). The heartbeat is still never posted.

## Powers round 3

Scope: `favour_bless` (Favour tab) and `insight_lore` (Insight tab), and the `rituals` Realm Rule effect they need.

- **Spec gap.** `12-powers-catalogue.md` has no Bless or Lore entry (8.7 and 8.8 list no `fav_bless` or `ins_lore`), and no spec section gives their effects. The effects below are defaults chosen here (OPEN, default recorded), not spec text.
- **Bless (`favour_bless`).** Ritual power, `requires: ['rituals']`. Gives status `warded` (60 s, taken x0.1; the nearest spec boon to "Ward", 12 section 8.7) to every living being within Chebyshev radius 3 of the target tile. Runs on empty ground too (counts as a use, no beings affected). Handler `bless` in `src/sim/powers/rites.ts`.
- **Lore (`insight_lore`).** Records the species of every living being within radius 4 as a codex discovery (`discoveries` set, `species:<id>`, 14 section 5). Repeats record nothing. Read-only accessor `loreKnown(sim)`. The snapshot codex count already reads this set, so no snapshot field was added. Does not need `rituals`. Handler `lore`.
- **Rituals rule effect.** `rituals` off refuses ritual powers: `executePower` now checks every rule in a power's `requires` before dispatch (12 section 8 soft gate; the rule still does not hide the power). Intrigue starts were already gated in `src/sim/culture/culture.ts`; culture code is unchanged. `RITUALS_RULE` constant in `src/sim/rules.ts`.
- **Superseded (done).** `bless` and `lore` are now in `SIM_HANDLERS` (`src/ui/powerSupport.ts`), so both powers are enabled. The earlier "must be added there" note and the `tests/e2e/panels.spec.ts` expectation that Bless reads "not available yet" no longer apply.
- **Still not built.** The UI toast `hint.rule_off` and the Lore window (`win_lore` is not in `WINDOW_CATALOG`).
- **Golden.** `GOLDEN_HASH` unchanged (2562049680); the golden replay uses no powers.

## Powers round 4

Scope: the Favour (12 section 8.7) and Insight (12 section 8.8) entries that the sim can express with state that exists. Code: `src/content/powers.ts`, `src/sim/powers/favour.ts` (new), `src/sim/powers/handlers.ts`, `src/ui/powerSupport.ts` (`SIM_HANDLERS`). Bless and Lore are unchanged.

**Count.** Built: 20 Favour entries (plus Bless) and 1 Insight entry (`ins_compare`, plus Lore). Cut: 13 Favour and 56 Insight rows. The spec's own counts do not match its rows (8.7 says 28, the rows total 33; 8.8 says about 40, the rows total 57). Counts here are the rows as written, with each `L01`..`X14` style id counted once.

**Drop model.** Favour magic drops are `brush` kind. The UI sends one application per tapped tile, so each application is one drop roll (fallChance 0.3, `fall` param) and the beings on that tile take the effect. Brush size does not widen a Favour drop. Purify uses fall 1. Grace and Hex roll per being (chance 0.15). Rolls use the named stream `favour`.

**Substitutions (Favour).**
- Vigour: `spirited` becomes `emboldened` (speed x1.3, damage x1.3). Regen is not built. Spark also uses `emboldened`, because `vigilant` has no status and the rest-need effect has no state.
- Ward: `warded` as spec. The structure hp +50% part is not built.
- Surge: `spirited` and `warded` each 20% per being (`emboldened`, `warded`); `vigilant` is dropped; `mana_surge` becomes `empowered` for every being on the tile.
- Muse: mood +20 via event `inspired` (25) with extra -5. The 90 s fade is not built (mood has no per-event decay). The cultural idea is not started.
- Kinship: opinion +30 becomes mood event `made_friend` (40) with extra -10, for the beings on the tile. There is no opinion or dominion state. The spec's pair-between-beings effect is one-sided here.
- Strife: opinion -30 becomes mood `talked_badly` (-15) with extra -15. The brawl is not started (no fight-start hook).
- Grudge: there is no grudge state. The beings on the tile gain status `frenzy` (damage x2, 300 s). Targeting the nearest non-kin is not built.
- Frenzy: trait `frenzied_mind` (permanent). "Ignores flee" is not in the sim (trait data only). Beings with `stalwartheart` are skipped.
- Grace and Hex: good or bad traits are chosen at random. 18b has no good or bad tags, so the classification is derived from the effect text: a trait is bad when its text has a negative figure or an `x0.` multiplier and no positive one, good in the reverse case, and unclassified when both appear. Four traits are named bad by hand (`frenzied_mind`, `hexmarked`, `cursed_line`, `vermin_bearer`). Whirlwind shrinking and growing is not built (no whirlwind state).
- Slumber: `dozing` becomes the sleep state (06 section 5, `beginSleep` with kind `nap`). Damage ends it, as the spec says. The length follows the nap rule (about 20 to 60 s), not 60 s exactly.
- Unweave: removes `warded`, `emboldened`, `empowered` and `hexed`. Magic clouds (`cloud_arcane`) are not built.
- Cleanse: removes `coughing`, `venomed`, `rotting` and `hexed`, and the traits `hexmarked` and `vermin_bearer`. Creep contact is not built.
- Purify: removes every bad trait (the classification above). Costs nothing.
- Foundling: a breeding-age being on the tile (not a child, not expecting, not in lull) gets a child at once through `spawnBeing` with that being as parent, so the strain and birth-mutation rules of 05 and 06 apply. A being that cannot breed makes the rite fail (returns false; the UI shows no toast). The mating lull is set to 1800 ticks. The sim's births have one bearer, so no second parent is mixed in.
- Waking Flora: default of OPEN-12-4. A tree on the tile becomes a `rootwarden` and the tree is removed. Other flora and structures are not converted.
- Item Rain: gives items from the item-rain list (`sim.items.rain`, set by the item rain editor) to the beings on the tile through the existing `itemRain`. With an empty list the rite does nothing (the items system would otherwise pick any kind).
- Loot Rain: each being on the tile gets a random non-unique item of tier 4 or lower (TUNE, `LOOT_MAX_TIER`), through `giveItem`.
- Edit Item Rain: `open_window` to `win_item_rain_edit`.

**Cut (Favour, 13 rows).**
- `fav_hush`: the sim has no casting or silence state, and no status with that effect exists.
- `fav_dust_white`, `fav_dust_black`, `fav_dust_red`, `fav_dust_blue`, `fav_dust_gold`, `fav_dust_purple` (6): they paint a dominion colour and flag, and dominions have no state in play. They have no combat effect, so nothing in the sim would change.
- `fav_rain_a`, `fav_rain_b`, `fav_rain_c` (3): they add or remove traits from user lists kept in settings. The sim cannot read settings, and no list state exists in the sim. Inventing default lists was rejected.
- `fav_rain_a_edit`, `fav_rain_b_edit`, `fav_rain_c_edit` (3): editors for the cut trait rains.

**Cut (Insight, 56 rows).**
- `ins_inspect`, `ins_follow`, `ins_possess`, `ins_select_hamlet` (4): selection, camera and control of a being. Selection lives in the UI, and no sim command for a controlled being exists (`src/sim/beings` is out of scope).
- `ins_layers` L01 to L10 (10), `ins_marks` M01 to M07 (7), `ins_overlays` O01 to O08 (8), `ins_arrows` A01 to A07 (7), `ins_tips_tiles` and `ins_tips_beings` (2): view state only. A `toggle` power can only flip a sim rule, and no UI status exists for these.
- `ins_lists` X01 to X14 (14) and `ins_knowledge` (the Codex, `list_codex`): these open windows that exist in `WINDOW_CATALOG`, but `open_window` opens `win_` plus the window param (`src/app/main.ts` line 550), so a `list_*` id cannot be reached. The fix is one line in `main.ts` and one in `powerSupport.ts` (`powerStatus` also builds `win_`), both outside this round's file list. Follow-up: allow full window ids in `open_window`; that would enable these 15 rows.
- `ins_ties`, `ins_forecast`, `ins_accord` (3): they need a selected dominion, a pact or a campaign, and dominions are inert in play.

**Persisted state.** No new fields and no change to the Chronicle schema. The named RNG stream `favour` is created on the first Favour roll. Stream state is saved in the Chronicle, so a save made after a Favour power is used carries it. Beings, mood, effects and item state change only through their existing fields.

**Other effects.** `POWERS` is hashed in `src/content/content-hash.ts`, so the content hash changes with this round. `GOLDEN_HASH` is unchanged (2562049680), and the golden replay uses no powers. Nothing was run: this round was checked by reading only (no tests, tsc, build or Playwright).

## Clans (kinbands)

- **Rule.** A clan is the living members of one strain (`src/sim/clans/clans.ts`). A strain with at least `CLAN_FOUND_MIN = 4` living members and no clan founds one, once per strain. Scans run once per Month (100 ticks, `CLAN_SCAN_TICKS`), inside `sim.step()` after the beings step (`clansStep`). Names come from the `clans` RNG stream, drawn only when a clan forms.
- **Chief.** The oldest living member (birth tick, then lowest slot), re-picked at each scan. Members and chief are read from the beings store; nothing is written to beings, strains or the realm.
- **Extinction.** A clan whose strain has no living member is marked extinct (`extinctTick`) and stays on record. Births need a living parent, so the strain cannot come back.
- **Deviation: families.** Spec 11 founds clans from families. Beings store one parent link, `culture.families` is written only by tests, and there are no family records. Clans therefore found from strains, which the task allowed. Families can feed clans later.
- **Deviation: species.** Spec 11 is about Folk. Folk enter the realm only through powers, so a run with no player input has only beast strains. Clans form from any strain (a kinband, which is what the Clans window calls it). A Folk-only rule is a one-line change if Folk spawning becomes automatic.
- **Limit.** `CLAN_DEFAULT_LIMIT = 50` is recorded on each clan and shown in the inspector. It is not enforced: births are not refused, and clans do not split or merge (spec 11 `limitMembers` and traits are not built).
- **Save.** Optional chronicle tag 18 (`clans`, JSON `{ next, list }`). Written after the strain registry, listed in `OPTIONAL_TAGS`. `SCHEMA_VERSION` stays 3: saves without tag 18 load with no clans, and older builds ignore the unknown tag. `restoreClans` rejects a malformed record and restores nothing.
- **Snapshot.** Optional `Snapshot.clans` (`ClanBlock`: `count`, `living`, `rows` capped at `SNAPSHOT_DETAIL_ROWS`, living first). Read-only. `clanRowsOf` in `src/ui/specWindows.ts` builds the Clans list; `win_clan` takes `{ id }` and links to the strain window.
- **Golden.** `GOLDEN_HASH` unchanged (2562049680). `stateHash` does not include clan records, and the clan step draws no shared RNG.
- **Not done.** The 14 counters `clansFounded` and the `clan.founded` bus event are not emitted. Clan renown, leadership and the spec 11 chief decisions are not built.

## Items round 1

Scope: an item registry, equipment on Beings, hamlet stock, item rain, the item windows and the gear and rain editors.

- **Registry.** `src/content/items.ts`: 95 kinds and 58 modifiers. The ten unique weapons and staffs of 08 6.2 keep their spec ids (`energy_blaster`, `flame_blade`, `frost_staff`, `plague_healer_staff`, ...). The spec gives no id list for tier items, so they are generated from the 6.2 material table: `<material>_<blade|cleaver|maul|pike|bow|staff>` for weapons (45), `<material>_<helm|body|boots>` for armour (24), `<material>_<ring|amulet>` for jewelry (16), plus the unique 10. Modifiers: `<family>_<rank>` (50) and the eight explicit-only ids (`blaze`, `rime_touch`, `concussive`, `sluggish`, `venomous`, `everlasting`, `accursed`, `hallowed`).
- **Values not in the spec.** `flame_maul` and `frost_maul` give no damage in 6.2; they are set to 11 (TUNE). Hide armour boots get pace +1. A material's `extra` (aether, endurance, tempo, crit multiplier, spells, projectiles) is kept as data and not read by the sim. Item value is the kind's equipment value plus `rank * 2` per family modifier (the spec formula is not explicit about modifier value).
- **Stat use.** Only keys assembly reads take effect: might, pace, plating, vitality, wit, rapport, valor, husbandry. `crit` is stored, combat does not read it. Gear enters `assemble()` as flat sums (`AssemblyInput.equipment`, `FlatKey` gains might, pace, vitality; with no gear every flat is 0, so stats are unchanged). Combat adds the worn might to melee (`sim.combatContext`) and the worn plating to `applyDamage`.
- **Ownership.** Beyond the listed files: `src/sim/beings/system.ts` (one line in `refreshStats` passes `equipment`), `src/ui/windowContent.ts` (`WindowDeps.sendCommand`) and `src/app/main.ts` (wires it to `client.send`). Without them the editors have no way to send a command.
- **Equip rule.** Gear is written by `setGear` (editor) and `giveItem` (rain). The rain accepts an item only into an empty slot or over a lower value, with neither accursed (08 7.4). A refused or replaced item goes to the hamlet stock list of its tile (15 per list; a full list keeps the higher-value items) or is destroyed when no hamlet holds the tile.
- **Death.** `itemsStep` runs once per tick after `stepBeings`. It releases the gear of any slot whose generation no longer matches, so no item stays on a dead Being. Its tile is the slot's last position, which can be a newborn's tile if the slot was reused in the same tick.
- **Commands.** Additive `Cmd.SetGear` (12), `SetItemRain` (13), `ItemRain` (14), `SetItemFavourite` (15). Worker queues them; `Sim.apply` runs them at the next tick. Item rain reaches up to 32 Beings within 12 tiles of the drop point; the window drops on the realm centre (no tile targeting exists in the UI yet).
- **Chronicle.** Optional tag 19 (`items`), written only when the realm holds items, so saves without items keep their bytes. Restore runs after the Beings and re-assembles the stats of worn Beings.
- **Snapshot.** `Snapshot.items`: exact `count`, `equipped`, `stored`; `rows` (24, favourites first) and `gear` (24) are capped. Read-only.
- **Windows.** `list_fav_items` lists favourites then the other items; `win_item` shows the facts and a favourite toggle; `win_gear_editor` picks a being from the oldest living and sets one select per slot; `win_item_rain_edit` edits the rain list (checkboxes), drops on the centre and clears the list.
- **Not built.** Wear and durability loss (08 7.4), repair, crafting (smithy), soldiers drawing gear from stock (`fetch_hamlet_gear`), spells and projectiles from items, weapon reach and targets in combat, crit chance, the unique-name roll at rank 5, the Favour reforge and curse buttons, the Gear tab of the being window.
- **Golden.** `GOLDEN_HASH` unchanged (2562049680). Items are not in `stateHash`, and no item command runs in the golden script.
>
## Dominions round 2

Scope: a production path that founds dominions, grows their borders, sets relations, declares wars and signs pacts. Code: `src/sim/dominions/founding.ts` (yearly pass), `adapter.ts` (`dominionsYearly`, truce save field), one hook line in `sim.ts`. Golden hash unchanged (2562049680): dominion state is not in `stateHash`, and nothing in beings or realm reads it.

- **Cadence.** Once per sim-year on `sim.due('dominions.year', YEAR_TICKS)`. No RNG draws.
- **Founding (OPEN).** A settlement (hamlet) with no dominion parcels and folk >= `FOUND_FOLK` = 30 founds a dominion on its parcels. Needs rule `realm_expansion`. A settlement's dominion is the owner of most of its parcels. Folk is the settlement census of beings in its parcels: Folk are never spawned in the running sim (`spawnFolk` has no caller), so the census counts beasts too.
- **Land (OPEN).** 09 section 3 gives a hamlet one claim per 1200 ticks. Dominions claim `CLAIMS_PER_YEAR` = 3 free land parcels a year next to their territory, nearest the centroid within 13 parcels (`CLAIM_RANGE_SQ`). One claim a year left founded dominions too far apart to meet on most seeds. Settlement parcels are never taken.
- **Army (OPEN).** Strength cap = folk / `ARMY_DIVISOR` (3). Strength regrows toward the cap and is never cut by the yearly pass.
- **Borders.** Parcel adjacency (8 neighbours), recomputed yearly. A new border starts at `tension` when one side has at least `TENSION_RATIO` (2) times the other's strength, else `peace`. New borders are not judged for war in their first pass.
- **War.** Peace goes to tension on a power gap of 2. Tension goes to war when the bigger side has more than `DECLARE_ARMY` (10) strength. The declaration sets a truce of 5 years (`TRUCE_TICKS`). A war seen at a pass keeps a truce 5 years out. Undeclared wars (tests, god tools) get the same truce but are never pacted.
- **Pacts.** A declared war ends in peace (`endWar`) once the bigger side has at least `PACT_RATIO` (3) times the other's strength at a pass. Not observed in the 10-year probes: wars end in defeat within about a year, before a pass sees them.
- **Save.** `DominionSnapshot.truce` is optional (`{a, b, until, declared}`); older saves restore with none. No version bump.
- **Limits.** Hamlets are fixed at three (`HAMLETS_WANTED`), and no creed regions exist, so there are at most three dominions per seed. Hamlet expansion ignores dominion owner bytes (settlements adapter is read-only here). Opinion, ruler and intrigue-driven pacts of spec 10 are not built.
- **Probe, seeds 1, 555, 31337, 2024, 7, 99, 10 years.** Soak size (sizeStep 4): 1-3 dominions per seed, 0 declared wars. sizeStep 2: 2-3 dominions per seed, 1 declared war (seed 555, year 8), 0 pacts.
- **Soak.** Strict soak passes (seeds 1, 555, 31337). Year-10 totals 1471, 1109, 1302, identical to HEAD.

## Hamlet founding round 3

- **MIN_BAND founding (09 section 2, path A; 12 spawn_folk).** Each sim-second, `foundHamlets` in `settlements/adapter.ts` scans adult Folk (`baby === 0`, species `folk`) in slot order. A founder whose band (adults of its lineage within `BAND_RANGE` = 20 tiles, itself included) reaches `MIN_BAND` = 2 founds on its parcel when `goodFoundingParcel` holds: at least 90% land tiles (`FOUNDING_LAND`, TUNE) and no hamlet on the parcel or its 8 neighbours. The hamlet claims the parcel and every unowned neighbour parcel. No RNG draws. No dominion is made here; the yearly pass does that at `FOUND_FOLK`. No rule gate (path A is ungated).
- **Not built from 09 section 2.** Island size (300 ground tiles), biome-by-strain check, annexing a neighbouring hamlet's parcel (rule 5; the neighbour check already refuses it), the 600-tick decision cooldown, the founder's clan, dialect and custom, and the name roll. Founding is one scan per second rather than a decision per Being.
- **Worldgen placement kept.** 09 places no hamlets at worldgen, but the spec does not ask for it to be removed, so `placeHamlets` (3 hamlets) is unchanged. Founding adds on top.
- **Census kept (all beings).** Probe: census of Folk only leaves every worldgen hamlet at 0 Folk for three sim-years (seed 7, 40 starting beasts, 3 years). Under 09 section 2 a hamlet with no Folk turns neutral, so folk-only census would kill the worldgen hamlets. Kept the all-beings census. Founded hamlets still count beasts in their parcels, as before.
- **Probe results (seed 7, sizeStep 2, no starting beasts).** Two adult Folk spawned on one good parcel found a hamlet at tick 20. Forty Folk in a hamlet produce a dominion at tick 130 (within year 1).
- **Golden.** `GOLDEN_HASH` unchanged at 2562049680: the golden run has no Folk, so founding does not fire and the census is unchanged.

## Items round 3

Scope: stock fetch, wear, repair and crafting (08 sections 7.2 to 7.4). Code: `src/sim/items/wear.ts` and `src/sim/items/hamlet-gear.ts` (new), `src/sim/items/store.ts` (broken scale), `src/sim/items/system.ts` (`stockPut`, `wear`, `unwear` exported), `src/sim/combat.ts` (optional `onWeaponHit` called after a melee hit is not blocked), `src/sim/sim.ts` (combat context entry and the per-tick `hamletGearStep`). Tests: `tests/unit/items-gear.test.ts`.

- **Golden.** `GOLDEN_HASH` unchanged (2562049680). The golden script has no hamlet gear work and no melee swing.
- **Persisted state.** No new fields. Durability, worn gear, stock lists and holders are already in the tag 19 `ItemSave` (`saveItems` copies whole instances). Nothing in `chronicle.ts` needs to change for this round.
- **Broken items.** Durability 0 keeps the item worn and halves its stats (05 section 3 step 10; `BROKEN_SCALE` = 0.5). Applied in `ItemStore.fxOf`, so might, plating and the other stat reads all see it.
- **Wear (7.4).** Melee Weapon hits only, through `meleeSwing`. Warded defenders and everlasting items take no wear. Each defender slot passes a 50% roll; wear is `floor(weapon rigidity / item rigidity) * 4`, with `num` summing the rigidity of items that passed the roll. The attacker's weapon then passes a 50% roll and loses `floor(floor(num / 5) / rigidity) * 4`. Not built: ranged wear (projectiles carry no shooter, so the shooter's weapon is unreadable at impact), and wear from bare attacks (no rigidity is defined for them). `meleeSwing` has no caller in play, so wear does not fire in a running game yet.
- **Fetch (7.3).** Hamlet pass every `FETCH_PERIOD` = 200 ticks (TUNE). Beings standing in a hamlet's parcels (the settlement census) take the highest-value stock item that is strictly better than the worn item in each slot; an empty slot takes any item. Accursed items never move. The worn item goes back to the same hamlet's stock list. No garrison is required (the spec gives none). Not built: soldiers drawing gear when made soldiers (no soldier system runs in play).
- **Repair (7.4).** Pass every `REPAIR_PERIOD` = 6000 ticks (the spec cooldown) over Beings in a hamlet that has a `garrison` building. Worn gear below its maximum durability is set back to the kind's durability. Common (quality 0) gear is free; other gear pays `floor(cost.coins * 0.5)` from the Being's purse and waits when it cannot. Repair spends no hamlet stock, because the spec names only coins; stock items are repaired only after they are equipped.
- **Crafting (7.2).** Pass every `CRAFT_PERIOD` = 300 ticks (TUNE; the spec's stay is 200 to 300). One random resident is the crafter for the pass. The pass has the spec's shape: one weapon attempt, then up to five armour or jewelry attempts, each of which also tries a weapon, stopping at the first attempt where both fail. A weapon attempt picks one of six groups uniformly. Candidates are the non-unique kinds of the slot, highest tier first; the first with `equipmentValue` above the worn item's value, which the hamlet stock and purse can pay, is built. Costs come from the registry (`cost.coins`, `cost.resources`). The old item goes to hamlet stock, and the crafted item is worn by the crafter (the spec's fetch-from-hamlet step after crafting is cut). Tries = 1 (`CRAFT_TRIES`, the default craftSkill). A worn accursed item blocks crafting.
- **Stock writes (cross-owner).** Crafting and repair change `Hamlet.wood` and `Hamlet.stone` directly, because the hamlet record is the only stock that exists. This is a write into settlements state from items code; the settlements owner should move it behind an adapter function.
- **Crafting is dormant in play, for three reasons.** (a) There is no purse: beings carry no coins and the hamlet has no gold field (09 section 10.5), so no coin cost is ever met. (b) The hamlet record holds food, wood and stone only, so only the timber (wood) and flint (stone) weapon recipes can be paid, and neither has armour. (c) No species carries `craftSkill`. The code is exercised by the unit tests with an injected purse (`Purse` in `hamlet-gear.ts`, default `NO_PURSE`).
- **Repair is dormant in play** because the building catalogue has no `garrison` (settlements owns it). The test adds a stand-in record.
- **Recipe table (OPEN).** The spec gives no full per-kind recipe table. The registry costs in `src/content/items.ts` are used as they stand: weapons 3 of the material, armour 4, jewelry 1, coins 2. Gaps and conflicts, not changed here (the registry is out of this round's scope):
  - Ring example (08 7.2): "1 iron + 1 gem + 4 coins". Registry iron ring: 1 iron, 2 coins, no gem.
  - Flame maul example: "3 wyrm-class scales + 10 gold + 2 coins". Registry: 3 `wyrm_scale`, 10 coins. Uniques are not craftable in this round, so this does not run.
  - The spec's rule "coins = moneyCost (2) per distinct resource id" gives the registry's coin figure for every generated kind (one resource each), so the registry value is used.
  - Armour and jewelry counts (4 and 1) are not stated by the spec.
  - 18d section 6.4 says copper and bronze come from iron with Dominion tech; the registry names `copper` and `bronze` resources, which no hamlet holds, so those kinds are unaffordable.
  - 18d says `starmetal` + `iron` makes tier 9; the registry's starsteel uses `starmetal` alone.
- **Cut.** The `item.forged` bus event and the `itemsForged` counter (no bus event or counter exists in `src/sim`, so none is emitted). Durability reset on load (OPEN in 08 section 15, not done). Repair on load (OPEN, not done). Ranged and bare-attack wear (above). Soldier gear draws (above).
- **Tests.** 18 new cases in `tests/unit/items-gear.test.ts`: wear table and per-hit behaviour, warded and everlasting cases, broken halving; fetch into empty and worse slots, swap-back to stock, accursed refusal, period gating; repair gate, coin path, free common repair; crafting without coins, timber build with coin and wood spend, a better worn weapon kept, accursed blocking, period gating.

## Settings round 3

Scope: the 75 rows of the table in `src/ui/panels/options.ts`. Before this round 25 were live; now 41 are. The 34 rows still non-live keep their "not active yet" label, with the reason here. No sim file changed; no protocol change.

Wired (16):
- `ui.layout`: `data-layout` on `<html>` and a max width on `.app` (compact 600, medium 960, expanded 1440 px; auto is full width). A width cap only; the spec's re-docking classes (13 section 2) are not built.
- `ui.colorBlindPalette`: daltonize correction (error spread over a Machado 2009 dichromacy simulation) as an SVG colour matrix, applied as a CSS filter to the map canvas only. UI text is not filtered.
- `map.layerOpacity`, `map.layerBrightness`: CSS opacity and brightness on the map canvas. The spec default 88 % makes the map slightly translucent by default.
- `map.vignette`: CSS radial overlay on the map.
- `ui.minimap`, `ui.minimapSize`: 1 px per tile, coloured by ground. It keeps its own copy of the ground ids from the sim frame rows, repaints 4 times a second, shows the view rectangle, and a tap or drag moves the camera.
- `ui.hideStatusBar`: requests full screen when turned on, on coarse pointers only.
- `input.stickyHold`: releasing a stroke keeps it running; hover paints; the next press ends it. A press that ends a latched stroke does nothing else.
- `input.stepDrag`: with an armed raise or lower tool, two taps set the start and end of one stroke. Dragging still paints.
- `game.autosave`, `game.autosaveMinutes`, `game.autosaveKeep`: `SaveController.configureAutosave`. Off also stops the pause autosave; the keep count is passed to `SaveService.writeAutosave`. The 5-minute and 5-ring defaults are unchanged.
- `game.pauseOnBlur`: window blur pauses the sim. Focus does not resume it.
- `game.disasters`: a mirror of Realm Rule `natural_calamities`, both ways, through the existing `setRule` command. Changing it changes a running Realm, as the Rules window does. A refused rule change keeps the old value.
- `dev.enabled`: already read by `systemWindows.ts` (developer windows gate); flagged live.

Non-live (34), with the reason for each:
- `ui.scaleNames`: no nameplates are drawn in this build.
- `map.names`, `map.favouritesOnlyNames`: no nameplates.
- `map.nightLights`, `map.shadows`, `map.bloom`, `map.particles`, `map.treeWind`, `map.cursorLights`: no such effects. `TerrainRenderer` draws terrain and the brush only, and `src/render` is outside this round's paths.
- `map.ageEffects`: no age overlay exists.
- `marks.*` (7 rows): no map mark layers exist.
- `ui.worldTooltips`, `ui.talkBubbles`, `ui.happinessIcons`, `ui.taskIcons`, `ui.moneyFlow`, `ui.cursorArrows`: these overlays (spec 13 section 11) are not built.
- `ui.tips`: no world tip messages exist. Toasts carry status and errors only.
- `ui.autoOpenContextTab`: no context tab exists. Inspecting a tile writes the status line.
- `ui.quickStrip`: no pinned strip exists; the power bar is always full.
- `input.touchOrder`: no being selection and no move-order command exist in the protocol.
- `perf.preloadWindows`: windows are built on open and there is no cache to preload into.
- `perf.renderScale`: needs a resolution path in `src/render`, which is outside this round's paths.
- `perf.simBudgetMs`: needs a sim change. `src/sim/worker.ts` has `FRAME_BUDGET_MS = 8` as a constant and no command sets it. Skipped under the sim rule.
- `perf.maxBeingsHint`: needs a sim change. The spawn guard reads no hint. Skipped.
- `privacy.telemetry`, `privacy.errorReports`: no telemetry or error-report sender exists in the build. Opt-in stays off.
- `lang`: only the English string table exists, so there is nothing to switch to. The value is stored.

Follow-ups (not this round): nameplates and map overlays, the render-side map effects, `perf.renderScale`, and a sim command for the budget and the being hint.

## Pacts and armies round 3

Scope: pact records and one army per dominion, built on the yearly pass. Code: `src/sim/dominions/pacts.ts` (new), `armies.ts` (new), `adapter.ts` (state, save, restore, yearly and per-second wiring), `step.ts` and `types.ts` (one `onDefeat` callback), `src/sim/chronicle.ts` (tag 20), `src/sim/snapshot.ts` (pact rows), `src/shared/protocol.ts` (`PactRow`), `src/sim/stats-hooks.ts`. No hook in `sim.ts`. Tests: `tests/unit/pacts-records.test.ts`, `tests/unit/armies-raise.test.ts`.

- **Records (10 section 12).** `Pact { id, name, memberIds, founders, renown, formedTick, kind }`, held on the dominion state. `name` is `Pact <id>` (cut: the 11 section 6 dictionary names). `kind` is always `normal`: `forced` belongs to the god tool, which is not built.
- **Chronicle tag 20 `pacts` (optional).** Tags 12 to 19 were already taken, so 20 is the next free tag. Written only when a pact exists or has formed, so a realm without pacts saves as before. Saves without it load with no pacts. `SCHEMA_VERSION` stays 3. Dominion section (tag 15) gains an optional `armies` list.
- **Formation.** In the yearly pass, after founding: the first peace border pair (border order) where neither dominion is in a pact, neither is supreme (most strength, ties to the lower id), and neither has a tension or war with any dominion. At most one formation per pass. Timeout: `PACT_TIMEOUT_TICKS` = 3 years between formations, counted for the whole realm (the spec's "timeout between pact formations"; read as global, not per dominion).
- **Joining.** A free dominion (not in a pact, not supreme, no enemy) that borders a member joins the first pact by id with no supreme member. The spec's "tiny and isolated" branch is cut.
- **Leaving and dissolving.** Two members at war: the stronger one (the declarer, as founding step 5 declares) leaves. A member that no longer exists leaves. A pact below `PACT_MIN_MEMBERS` = 2 dissolves. Wars with non-members do not make a member leave (see cuts).
- **Renown.** `PACT_RENOWN_PER_DEFEAT` = 1 (TUNE) per defeat a member inflicts on a dominion outside the pact (`onDefeat` in the strength exchange). The spec's renown table (campaign ends, peace bonus) is cut.
- **Power.** Pact power is the sum of member strength (the snapshot row shows it). The spec's `soldiers x 2 + hamlets x 5 + 1` is not used: dominions have no hamlet count in the dominion record.
- **Armies (10 section 8, cut to a record).** One army per dominion; army id = dominion id; `soldiers` mirrors `strength` after each yearly pass and each sim-second step. Raised in the yearly pass for any dominion with strength and no army. Renown `ARMY_RENOWN_PER_DEFEAT` = 1 (TUNE) per won strength exchange. The campaign strength exchange is the march. Name is `Army of Dominion <id>`.
- **Cut, pacts.** Opinion ("good" opinion of every member; the peace border stands in for it). The renown gates (formPact 60, joinPact 50), since dominions have no renown. The ruler and intrigue rules: `formPact`, `joinPact` and `dissolvePact` are not intrigues here (no rulers, no lv/diplomacy/cost). `dissolvePact` by intrigue, and its power and age tests. Campaign joining: pact members do not join wars (campaigns are pairwise strength exchanges). Leaving on a war with a non-member. Pact-to-pact merge. `forced` pacts.
- **Cut, armies.** Captains, hamlet placement, attack orders, readiness (70% of slots), soldier slots, boats, training, equipment, movement and numerals in names.
- **Snapshot.** `PactRow` changes shape (additive): `id` is now the pact id (was `a * 256 + b`); new `name`, `members`, `power`, `renown`, `formedTick`. `a` and `b` are the founders, with their name, strength and parcel fields. Pact rows stay capped at `SNAPSHOT_DETAIL_ROWS`.
- **Stats.** `pact.made` fires once per new pact record (not for pacts already present at first observation or after a load). `pactMembersMax` is the largest pact by member count.
- **Golden.** `GOLDEN_HASH` unchanged at 2562049680: dominion state is not in `stateHash`, and the golden run has no pacts or armies to change it.
- **Test files outside the listed pattern.** `tests/unit/windows-sim-data-snapshot.test.ts` and `tests/unit/windows-sim-data-rows.test.ts` asserted that a border at peace is a pact. Both now form a pact record first (`addPact`), and the expected ids change. They fall outside the `*pact*/*dominion*/*army*` pattern, but no other change keeps them passing under the new rule.
- **Save header placeholder (decision, kept).** The chronicle header's content-hash u32 is written as 0 and never read. Filling it changes the byte layout of every save, so it stays reserved; `FORMAT_VERSION` is not bumped. Revisit only with a format migration.
- **Follow-up, UI (done).** `src/ui/specWindows.ts` now describes the pact records (the old "not updated" note is resolved): its `PACT_LIMITS` note still says a pact is peace between two bordering dominions, and its rows show the two founders only, not the members. Rows still read `nameA`, `nameB` and the strengths, so they do not break.

## Settings round 4

Scope: the same 75 rows of `src/ui/panels/options.ts`. Checked the features that now exist (pacts, armies, items, hamlets, dominion borders) against `src/render` and `src/ui`, and the being state in the protocol. Result: no row could be wired this round, so the live count stays at 41 and the non-live count at 34. No code changed; the table, its `live` flags and the test expectations are unchanged.

What `src/render` has: `terrain.ts`, `terrain-shader.ts`, `camera.ts`. Terrain and the brush only. There is no being, mark, border, nameplate or effect layer. Pacts, armies, items, hamlets and dominion borders exist in the sim and the snapshot, but none of them is drawn on the map, so the mark and name rows have nothing to drive.

What the protocol carries: no being happiness, task, talk or tip data. No tip source in `src/sim` or `src/ui`.

Wired (0). Non-live (34), with the reason for each:
- `ui.scaleNames`, `map.names`, `map.favouritesOnlyNames`: no nameplate layer in `src/render`; beings are not drawn on the map. A nameplate layer needs a being-position draw path, which is not cheap, so it is not built here.
- `map.nightLights`, `map.shadows`, `map.bloom`, `map.particles`, `map.treeWind`, `map.cursorLights`: no such effects in `src/render`; terrain only.
- `map.ageEffects`: ages exist in `src/sim/ages.ts`, but no age data reaches the render rows and there is no overlay.
- `marks.favourites`, `marks.items`, `marks.intrigues`, `marks.armies`, `marks.battles`, `marks.boats`, `marks.campaigns`: no mark layer in `src/render`. Items and armies exist in the sim, but the map cannot show them yet.
- `ui.worldTooltips`: no world-space tooltip layer.
- `ui.talkBubbles`, `ui.happinessIcons`, `ui.taskIcons`: being talk, happiness and task are not in the snapshot or frame rows.
- `ui.tips`: no tip source in `src/sim` or `src/ui`; toasts carry status and errors only.
- `ui.moneyFlow`, `ui.cursorArrows`: no flow or arrow data and no layer.
- `ui.autoOpenContextTab`: no context tab exists.
- `ui.quickStrip`: no pinned strip exists.
- `input.touchOrder`: no being selection and no move-order command.
- `perf.preloadWindows`: windows are built on open; there is no cache to preload into.
- `perf.renderScale`: a runtime change needs a Pixi resolution and resize call in `TerrainRenderer` (`src/render/terrain.ts`, which sets `resolution` and `autoDensity` at init). The worktree had no installed dependencies, so the Pixi API could not be checked against its typings this round. Kept non-live until it is checked.
- `perf.simBudgetMs`, `perf.maxBeingsHint`: need sim changes; skipped under the sim rule.
- `privacy.telemetry`, `privacy.errorReports`: no telemetry or error-report sender exists in the build.
- `lang`: only the English string table exists.

Follow-ups: a map mark layer (items, armies, pacts, borders) would unlock the 7 `marks.*` rows; a being draw path would unlock the nameplate and being-icon rows; `perf.renderScale` needs a Pixi API check with dependencies installed.

## Pacts and armies round 4

Scope: opinion, pact gates mapped to dominion state, campaign joining and leaving, army captains and position. Code: `src/sim/dominions/opinion.ts` (new), `pacts.ts`, `armies.ts`, `step.ts`, `types.ts`, `adapter.ts`. Tests: `tests/unit/pacts-opinion.test.ts` (new), `tests/unit/pacts-records.test.ts` (one renamed case). Status: edits only, no checks run (coordinator instruction). GOLDEN_HASH in `tests/unit/golden.test.ts` is NOT updated: the sim changed (dominion step, pacts, armies), so the value 2562049680 is stale and must be recomputed before merge. The determinism script and the tsc and vitest runs were not run.

- **Opinion (10 section 10), pure function, no cache.** `opinion(ctx, a, b)` sums the terms that have dominion state behind them: a ruler-diplomacy stand-in (`OPINION_RULER_STAND_IN` = 25, TUNE: dominions have no rulers, so every pair gets this base), supreme b (-100, at least three dominions), border (close -25 when the pair shares a border, far +25 otherwise), war (-500), parcel count (`clamp((a.parcels - b.parcels) / 5, -20, 0)`), power gap (b stronger by d: +d/10 when positive), truce (+100 while the truce runs), peace time (after five years since the last declaration, +1 per year, capped 20, TUNE), same pact (+30). Recomputing is O(dominions) per term, so no cache is kept; the spec's per-pair cache is cut as unnecessary at this size.
- **Cut, opinion terms.** Ruler diplomacy stat and the ruler opinion stat, ruler traits, lineage, custom, creed, dialect, strain, clans, child rulers, age modifiers, customs, and the same-side +50 (a campaign has no side list beyond the pact). The campaign end stamp is read from the truce entry (`until - TRUCE_TICKS`), so no new state.
- **Pact joining gate.** A newcomer joins only when its opinion of every member is >= 0 (`goodOpinionOfAll`).
- **Formation (formPact).** Intrigue gates replaced by dominion state: a peace border pair, both free of pacts, neither supreme, neither with any enemy (any tension or war), with opinion >= 0 in both directions, and the existing 3-year timeout. Cut: ruler level 5, cost 20, renown >= 60, the cooldown per dominion (the realm-wide timeout is kept), and the target search over neighbours with no active intrigue.
- **Joining (joinPact).** The yearly pass as before, plus the opinion gate. Cut: ruler level 2, diplomacy 5, renown 50, cost 5, and the "tiny and isolated" branch.
- **Dissolve (dissolvePact).** A pact dissolves when (1) two members are at war (the whole pact, replacing round 3's "stronger one leaves"), or (2) some member holds a negative opinion of a fellow member for a full year (`Pact.unhappySince`, optional, carried by the chronicle through the spread). A pact below two members still dissolves. Cut: ruler level 5, cost 15, the age-10 and power-2x conditions, the "pact is supreme" condition, and the forced-pact immunity (no forced pacts).
- **Campaign joining and leaving (10 sections 11-12, simplified).** On each campaign tick, for every war border pair, the other members of the attacker's pact join against the defender and the other members of the defender's pact join against the attacker. A member at peace with the foe leaves its pact instead of joining. Because pacts are disjoint in this build, "a member joining the enemy side leaves its pact first" reduces to this leave rule. Joining sets the member's relation to the foe to war. Cut: campaign objects, the kinds, main attacker/defender, renown on joining and ending, treaty and peace outcomes, merging, the 5-year rule, and the AI declaration gates. Members that join a war but do not border the foe have no contact and do not fight.
- **Armies: captains (10 section 8, counts).** `Army.captains` is one per hamlet the dominion holds, counted by each hamlet's majority owner, at least 1 (a dominion with no hamlet data keeps one captain). Cut: named captains, deaths and replacement, `pastCaptains`, the readiness and attack-order logic, the soldier decision layers, the march speed and wait rules, and the training and equipment rules.
- **Armies: position.** `Army.parcel` is the army's position, starting at the dominion's centroid parcel (`centroidParcel`, ties to the lower index). Each sim-second (`marchArmies`, before the dominion step), an army steps one parcel with diagonal moves toward the nearest parcel of its enemy. The enemy is the dominion's campaign target when that is at war with it, otherwise the lowest-id dominion at war with it. It stops when adjacent (Chebyshev distance <= 1). Cut: pathing, terrain, islands and boats, walking through other dominions, and the 6-region path limit.
- **Strength exchange needs contact.** A war border pair exchanges strength only when the two armies are within Chebyshev distance 1 (`inContact` in step.ts). Without army positions the exchange is unchanged. Cut: the spec's wider campaign contact rules.
- **Save format.** Army rows gain optional `captains` and `parcel` (saves without them load with 1 captain and the centroid). Pact records gain optional `unhappySince`. `src/shared/protocol.ts` and `src/sim/snapshot.ts` are not changed (no new UI fields).
- **Not checked.** The round-4 numbers are unverified: the opinion stand-in makes a neighbouring pair with equal parcels and equal strength exactly 0 (the gate passes), which is the reason for the stand-in. Confirm in play that formation still happens and that pacts do not dissolve on every tick.

## Pacts and armies round 5

Scope: intrigue records for the three pact intrigues, attack orders for armies, and pact campaign joining and leaving. Code: `src/sim/dominions/intrigue.ts` (new), `pacts.ts` (formation, joining and dissolving split into functions; the yearly pass keeps only the clean-up), `armies.ts` (slots, orders, attack step), `step.ts` (campaign joining), `adapter.ts` (state, yearly and per-second wiring, save and restore), `src/sim/chronicle.ts` (dominion section shape check only). Snapshot, protocol, settlements, beings, items and powers are not changed. Status: edits only, no tests, tsc, build or Playwright run (development instruction); GOLDEN_HASH not edited.

- **Intrigue records (11 section 3, 10 section 12).** `Intrigue { id, kind: formPact|joinPact|dissolvePact, dominionId, targetId, startedTick }` held on the dominion state. `targetId` is the asked dominion (formPact) or the pact id (joinPact, dissolvePact). At most one intrigue per proposing dominion, and a dominion asked by a formPact has none of its own.
- **Proposal and resolution.** The yearly pass runs: founding, pact clean-up, resolve last year's intrigues, propose new ones, then armies. Dominions are visited in id order. A dominion in a pact may propose `dissolvePact` for its own pact. A free dominion proposes `joinPact` (first pact by id), else `formPact` (first free peace-border neighbour by id). Resolution re-checks the gate and, when it holds, calls the pact function (`formPact`, `joinPact`, `dissolvePact` in pacts.ts); every intrigue is removed after the pass. The spec's progress over ticks is replaced by "resolves at the next yearly pass" (one year, TUNE).
- **Substituted gates.** Renown is replaced by dominion strength: formPact needs strength >= 60 for both sides (`FORM_PACT_STRENGTH`, the spec's renown 60), joinPact needs >= 50 (`JOIN_PACT_STRENGTH`, the spec's renown 50). The ruler level, diplomacy, personal money and the ruler role are cut. Opinion (`goodOpinionOfAll`, and both ways for formPact) and the free test (no pact, no tension or war) stay. Cut: the "tiny and isolated" joinPact branch.
- **Cost (TUNE).** `INTRIGUE_COST` = formPact 20, joinPact 5, dissolvePact 15 (the spec's money costs). A dominion has no money, so the cost is paid in strength when the intrigue is proposed, and it is not refunded if the intrigue later fails. The gate's threshold (60) is above the formPact cost, so a proposal never drops strength below zero.
- **Cooldown (TUNE).** `FORM_PACT_COOLDOWN_TICKS` = 3 years, per proposing dominion, from the proposal (the spec's 3-year formPact cooldown). Expired entries are pruned in the pass. joinPact and dissolvePact have no cooldown (the spec gives none).
- **dissolvePact gate.** The proposer is a joined member (not a founder), free, in a pact at least `DISSOLVE_PACT_AGE_TICKS` (10 years, TUNE) old, in the top two by strength, and the pact holds the supreme dominion. The pact's power must be at least `DISSOLVE_POWER_RATIO` (2, TUNE) times the summed power of the dominions outside it, and there must be at least one dominion outside. The spec's "pact normal" is always true here (no forced pacts), so it is not tested.
- **Formation moves to intrigue.** Pact formation and joining no longer happen in the yearly pass: `pactYear` keeps only the clean-up (members gone, war, unhappy for a year, under two members). A pact therefore forms one year after its intrigue is proposed, not on the pass that finds the border. The realm-wide three-year formation timeout is kept as a gate (`lastFormedTick`).
- **Campaign joining and leaving (10 section 12, pair form).** Round 4 had this inverted: a joining member at peace with the foe was pushed out of its pact. Now, for each war border pair, every other member of the attacker's pact joins against the defender and the reverse. A member already at war with its own pact's leader is on the opposite side and leaves its pact. Joining sets the member's relation to the foe to war. Cut: pact-level campaign objects and kinds, main attacker and defender, renown and outcomes on joining, and the rule that all members leave when the main party leaves (joins are pair relations, so a main party's peace does not cascade). Pact membership cannot otherwise change mid-campaign.
- **Attack orders (10 section 8, parcel form).** Each sim-second, before the march, for each army in id order: an order is cleared when its parcel is no longer held by an enemy at war or the army has no soldiers. A ready army with no order takes the nearest enemy parcel (the enemy is a dominion at war with it, by distance, ties to the lower parcel). An ordered army in reach (Chebyshev distance <= 1) attacks: the parcel changes hands, the attacker loses `ATTACK_CASUALTY_RATE` (5%, TUNE) of its strength, the army gains `ARMY_RENOWN_PER_DEFEAT` renown, and the order clears. The spec's hamlet target, parcel-from-building, reachability by island and boats, and captains' orders are cut.
- **Readiness (10 section 8).** `isReady`: soldiers > 0 and `soldiers / slots >= READY_FRACTION` (0.7). `soldiers` is the army's mirror of strength. With 0 slots any army with soldiers is ready (the spec's rule).
- **Soldier slots.** `Army.slots` = floor(folk / `ARMY_DIVISOR`) summed over the dominion's hamlets, counted by each hamlet's majority owner at the yearly pass (the same counting as the captains). A dominion with no hamlet has 0 slots.
- **March.** An ordered army marches toward its order parcel. An army with no order marches as before (the nearest parcel of its enemy). The strength exchange still needs contact.
- **Cut, armies.** Named captains and their deaths, `pastCaptains`, the wait and speed rules, retreat, training and equipment, and the 6-region path limit.
- **Persistence.** Dominion section (chronicle tag 15, JSON from `snapshotDominions`): army rows gain optional `slots` (default 0) and `order` (default -1). A new optional `intrigues` object `{ items, nextId, cooldowns }` is written only when an intrigue is pending, a cooldown runs or an id has been used, so a realm that never proposed one saves the same section as before. `checkDominions` checks that `intrigues.items` and `intrigues.cooldowns` are arrays when present. `restoreDominions` checks the intrigue kinds, the dominion ids and the numbers. Pact records (tag 20) are unchanged: no new pact fields. `SCHEMA_VERSION` and `FORMAT_VERSION` are unchanged.
- **Snapshot and protocol.** Unchanged. `src/ui/spec-model.ts` and `src/ui/specWindows.ts` still say intrigue formation is not built; that text is outside this round's scope and should be updated later.
- **Determinism.** No new randomness: no `sim.rng` stream is drawn and no `Math.random` is used. The new code only reads and writes dominion state. Dominion state is not in `stateHash` (round 3), so `GOLDEN_HASH` (2562049680) should be unaffected, but this is not verified.
- **Tests likely to break (not edited, not run).** `tests/unit/pacts-records.test.ts`, `tests/unit/pacts-opinion.test.ts` and `tests/unit/armies-raise.test.ts` (the case after a sim year that expects the yearly pass to form the pact) assume natural formation. They need updating to the intrigue timing (propose, then resolve one year later).
- **Not checked.** Everything in this section is unverified: the strength thresholds, the cost, and the 5% attack casualty are TUNE values with no calibration. Confirm in play that intrigues are proposed, that formations happen one year after proposal, that pacts do not dissolve on every pass, and that attack orders reach their parcels.

## Map layers round 5

Scope: a mark layer (`src/render/marks.ts`) and a being dot path, drawn from the snapshot. The sim changed in one additive, read-only place: `buildSnapshot` adds `mapPoints` (living beings' id, tile x and y, folk flag), capped at `MAP_POINT_CAP` (96) and dropped first by `fitSnapshot` if the message is over budget. `PROTOCOL_VERSION` and `SNAPSHOT_VERSION` are unchanged (the field is optional). Nothing in `src/sim` state, `dominions`, `settlements` or `items` was touched.

Wired (2): `marks.items` and `marks.favourites` are now live. Items: a ring on each worn item whose holder is in `mapPoints`; stored items have no tile in the snapshot, so they are not drawn. Favourites: the item ring turns pink when the item is a favourite, and favourite items are shown even when `marks.items` is off. Only the item rows the snapshot carries (capped) are considered.

Non-live, reasons updated:
- `marks.armies`, `marks.battles`, `marks.boats`, `marks.campaigns`, `marks.intrigues`: the snapshot has no tile for these (armies, pacts, intrigues and dominion borders carry counts and ids only; boats and battles are not in the snapshot). Nothing to place a marker on yet.
- `map.names`, `map.favouritesOnlyNames`, `ui.scaleNames`: not wired. The snapshot's `mapPoints` carries no name field, and beings have no favourite flag in the sim, so a favourites-only name rule has no data. Needs a name field on the map feed.
- `perf.renderScale`: still not wired; the Pixi API was not checked in this round (no node_modules in the worktree).

Being dots (folk and wild) are drawn with no setting of their own. Unverified: nothing was run; the Pixi v8 `Graphics.circle().fill()` and `.stroke()` calls are written from the v8 documented API, not checked against typings.

Live count: 41 to 43.

## Garrison and coins round 4

Scope: a garrison building (09 build order, 18c section 4.1 cost), a hamlet gold purse with a coin source, and the purse wiring for crafting and repair (08 sections 7.2 to 7.4). Code: `src/sim/settlements/catalogue.ts`, `hamlet.ts`, `adapter.ts`, `src/sim/items/hamlet-gear.ts`. Not touched: `src/sim/dominions/`, `src/ui/`, `src/app/`, `sim.ts`, chronicle header, `FORMAT_VERSION`.

- **Golden is stale.** `GOLDEN_HASH` is unchanged at 2562049680 and is wrong for this code. Reason: this round changes the sim (new hamlet gold field, garrison in the build list, builder coins), so the golden run's hash will move once a run is possible. The run was not possible here because testing was paused for this round, so no new value is known. Update `GOLDEN_HASH` in `tests/unit/golden.test.ts` when testing resumes, and state the old and new values in the commit.
- **Probe not run.** The 10-year probe (garrison built, craft and repair counts) is deferred with the tests. Whether the garrison gates below are reached in a 10-year run is unknown until it runs.
- **Garrison (09 build order, 18c 4.1).** Catalogue entry `garrison`, 3x3 footprint, stone 6, gold 14. Spec cost iron 2 is cut: the hamlet record holds no iron (09 10.1 iron comes from deposits and mines, neither built). Build gates, all `TUNE` in `hamlet.ts`: no garrison yet, folk >= `GARRISON_FOLK` (50), buildings >= `GARRISON_BUILDINGS` (16), parcels >= `GARRISON_PARCELS` (20). The spec's "needs hall tier 2" gate is cut: no hall exists. The garrison comes after granary, well and quarry in the hamlet's order, and before the fallback houses.
- **Garrison effects cut.** Soldier timer halving (no soldier system in the sim; soldiers live in `dominions/`, which this round does not touch) and gear storage of 15 per list (the item stock cap is in `items/`, outside the paths for this round). The garrison's only effect here is to gate repair, as 08 7.4 says.
- **Coin source (09 section 10.5).** The spec's hamlet-level sources are not in the sim: tax (dominion, file 10 section 4), trade boats (file 10 section 12, needs docks), gold deposits (not built), and personal loot. The implemented source is the builder rule from 09 section 8: completing a building pays `BUILDER_COINS` = 6 (TUNE). The sim has no builder beings, so the coins are paid into the hamlet gold when `hamletStep` places a building. This routes a builder's personal coin into hamlet stock, which is a deviation.
- **Starting gold.** `createHamlet` starts gold at 0. The spec gives no starting gold for a hamlet (09 10.1 lists sources only), so none is invented. Gold is `Hamlet.gold`.
- **Purse wiring.** `hamletPurse(hamlet)` is the default purse for `craftPass` and `repairPass`. `hamletGearStep(sim)` in `sim.ts` needs no change: its purse argument is now optional and defaults to each hamlet's gold. Tests keep injecting purses; `NO_PURSE` still exists and still refuses every coin cost. Deviation: spec 08 charges the crafter's or repairer's personal coins; the sim has no personal coins, so the Being's purse is the hamlet gold for every Being in that hamlet.
- **Placement.** `placeBuilding` requires the gold in addition to wood and stone and deducts it. Any building with a gold cost is therefore affordable only from hamlet gold.
- **Persisted state (changed).** `Hamlet.gold` is a new field, saved in the settlements section (`adapter.ts`). `snapshotHamlets` writes `gold`. `restoreHamlets` checks that `gold` is a finite non-negative number. A save written before this field has no `gold`, and loads with 0 (the field is optional in the snapshot type). No new chronicle section, no `FORMAT_VERSION` change, no chronicle header change.
- **Cut.** Iron cost of the garrison; hall tier gate; soldier halving and gear cap of the garrison; personal coins for Beings; tax, trade boats and gold deposits as sources; any personal coin payout to a builder being.
- **Tests.** No new tests were added and no tests were run this round. The existing `tests/unit/items-gear.test.ts` helper still says the catalogue has no garrison, which is now stale. Persist and settlement tests that compare hamlet snapshot shapes may need the new `gold` key; check when testing resumes.

## Map layers round 6

Scope: the rows the mark and name layers can drive, the render scale, and additive read-only map fields in the snapshot. Code: `src/sim/snapshot.ts` (`mapMarksOf`; `fitSnapshot` drops `mapMarks` before `mapPoints`), `src/shared/protocol.ts` (`MapMarks`, `MAP_MARK_CAP` = 32, optional `Snapshot.mapMarks`), `src/render/marks.ts` (rewritten: toggles in, hamlet name labels), `src/render/terrain.ts` (`setRenderScale`), `src/app/main.ts` (toggles passed to the mark layer; render scale applied in `applyOptions`), `src/ui/panels/options.ts` (6 rows flipped to live). `PROTOCOL_VERSION` (3) and `SNAPSHOT_VERSION` (1) are unchanged; the new field is optional. Nothing in `src/sim/dominions/`, `src/sim/settlements/`, `src/sim/items/` or sim state is written: the new code only reads armies (`snapshotDominions`), pacts (`pactsOfSim`) and hamlets (`hamletsOf`). No randomness, so the golden hash should not move (expected, not measured).

Status: edits only. No tests, tsc, vitest, build or Playwright were run (instruction). Types were checked by reading.

- **Positions for the new marks.** The snapshot had no tile for armies. Each army's `parcel` (armies.ts) is mapped to a tile at the parcel centre, using the same parcel layout as the dominion ground sample (`dominions/adapter.ts`): column = parcel % perAxis, row = floor(parcel / perAxis), tile = row or column * PARCEL + PARCEL / 2, with perAxis = side / PARCEL.
- **Campaigns.** A dominion with `target >= 0` and an army is marked at the attacker's army. The target is not marked.
- **Battles.** A war border pair whose armies are in contact (Chebyshev distance <= 1, the test `inContact` uses in step.ts) is marked at the midpoint of the two armies. Pairs with no army record are not marked.
- **Pact links.** Consecutive members of a pact that have an army are joined by a line. Pacts have no toggle of their own, so the links are drawn under `marks.armies`.
- **Hamlet names.** `Hamlet N` (the same name as `hamlets[].name`) at the hamlet's centroid parcel. Beings have no name in the snapshot, so no being is named.
- **Caps and budget.** Each list is capped at 32. `fitSnapshot` drops `mapMarks` first, then `mapPoints`, before it cuts dominions or hamlets.

Wired (6 new live rows; live count 43 to 49 of 75):
- `marks.armies`: a square at each army; pact links under it.
- `marks.campaigns`: a ring at the attacker's army.
- `marks.battles`: a cross at each war pair in contact.
- `map.names`: `full` draws the hamlet dot and name, `banner` draws the dot only, `off` draws nothing for hamlets.
- `map.favouritesOnlyNames`: hides hamlet names. No hamlet or being carries a favourite flag, so the literal rule hides every name while it is on. It needs a favourite flag on hamlets (or beings) before it means more.
- `perf.renderScale`: `TerrainRenderer.setRenderScale(percent)` sets the Pixi resolution to min(devicePixelRatio, 2) times percent / 100 and resizes the renderer with it. Called from `applyOptions`. The terrain shader's device-pixel offsets read `renderer.resolution` each frame, so the camera stays in step.

Cut, still non-live, reasons updated:
- `marks.intrigues`: the snapshot's intrigue rows carry a group id that is a dominion or a hamlet id, with no field saying which. `startIntrigue` has no caller in play, so there is nothing to place. Needs a group-kind field and a caller first.
- `marks.boats`: the sim has no boat entity and no boat positions. Nothing to draw.
- `ui.scaleNames`: hamlet names draw at a fixed 11 px; the name-scale setting is not applied. No zoom threshold either, so labels can overlap when zoomed out.
- Other reasons are unchanged from Settings round 4 and Map layers round 5.

Unverified (not run, not checked against typings; node_modules is absent in the worktree):
- The Pixi v8 calls: `new Text({ text, style })` and its `text` setter, `Graphics.moveTo().lineTo().stroke({ alpha })`, `renderer.resolution` as a read, and `renderer.resize(width, height, resolution)` as the render-scale path.
- Whether Pixi's own `resizeTo` resize (on window or host resize) keeps the chosen resolution, or resets it to the devicePixelRatio value. If it resets, the render scale is lost until the next settings change.
- Whether battles and campaigns appear in play at all (the war and campaign paths were not run).
- Tests: any test that asserts the live count (43 before this round), the snapshot key set, or the mark layer's old `MarkToggles` shape may need an update. Not checked.

## Map layers round 7

Scope: nameplate text size and overlap hiding (`ui.scaleNames`), intrigue marks (`marks.intrigues`), and the `marks.boats` reason. Code: `src/shared/protocol.ts` (`MapIntrigue`, `MAP_INTRIGUE_CAP` = 16, optional `Snapshot.mapIntrigues`), `src/sim/snapshot.ts` (`mapIntriguesOf`; `fitSnapshot` drops `mapIntrigues` first), `src/render/marks.ts` (`drawIntrigues`, `nameFontPx`, overlap test on hamlet names), `src/app/main.ts` (two toggles passed to the mark layer), `src/ui/panels/options.ts` (`ui.scaleNames` and `marks.intrigues` flipped to live: 49 to 51 of 75). `PROTOCOL_VERSION` (3) and `SNAPSHOT_VERSION` (1) are unchanged; the new field is optional. Read-only: no sim state is written, no randomness is drawn, and nothing under `src/sim/dominions/`, `beings/`, `settlements/`, `items/`, `powers/` or `chronicle.ts` was touched. The intrigue feed is built from the culture records on main (`sim.culture.intrigues`), not from the pact agent's branch.

Status: edits only. No tests, tsc, vitest, build or Playwright were run (instruction). Types were checked by reading.

- **Name scale.** `ui.scaleNames` sets the nameplate font size: 100 percent is 16 px, so the spec default of 70 gives 11.2 px (about the old fixed 11 px). The value is clamped to 30 to 160. The size is set on the pooled `Text` style.
- **Zoom threshold.** Hamlet names are placed in list order. A name whose screen box would overlap a name already placed is hidden; its dot stays. The test runs on every camera change, so the threshold depends on zoom through the overlap itself, not on a fixed zoom number. Not built: the spec 13 section 11 priority order (selected, favourite, capital, population, id). Hamlets are the only names drawn, so list order is the priority for now.
- **Intrigue position (assumed).** An intrigue record carries `group`, `kind` and progress only, with no target kind and no position. `group` is resolved as a dominion id first (the dominion's centroid parcel, as the armies and hamlet names are placed), and otherwise as a hamlet index in `hamletsOf` order (hamlets have no id in the sim). No id matching either gives `x = y = -1`, and the marker is skipped. This mapping is a guess: `startIntrigue` has no caller in play, so no real intrigue has been checked against it. The culture adapter's comment says groups are land regions, which would not match either rule; confirm the group meaning when the pact or intrigue caller lands.
- **Intrigue marks.** Only running intrigues (`outcome` null) are drawn, at the target tile: a red square for a rebellion, a violet diamond for a scheme. Resolved intrigues are not drawn. The count badge for overlapping marks (spec 13 section 11, 24 px) is not built, so two intrigues on one target stack.
- **Feed.** The list is sorted running first, then by id, and capped at 16. It is dropped first in `fitSnapshot`, before the map buildings. Rows carry `id`, `kind`, `active`, `x` and `y`.

Cut, still non-live, reason updated:
- `marks.boats`: the sim has no boat entity (spec 10 section 13 is unbuilt: boat types, docks, transport and the boat decisions). No boat positions exist in the snapshot, so there is nothing to draw. Not added in this round.

Unverified (not run, not checked against typings; node_modules is absent in the worktree). All Pixi v8 calls below are from memory of the v8 API:
- `Text.width` and `Text.height` read after setting `text`, for the overlap box. These force a text measure on each camera change for every hamlet name.
- `label.style.fontSize = n` on a live `Text`, to resize a pooled label (assumed to re-layout).
- `Graphics.rect(...).stroke({ width, color })` for the rebellion square.
- `Graphics.moveTo().lineTo()...closePath().stroke({ width, color })` for the scheme diamond.
- Tests: anything that asserts the live count (49 before this round), the snapshot key set, or the `MarkToggles` shape may need an update (`marks.intrigues`, `nameScale`, `mapIntrigues`). Not checked.
- The golden hash should not move, since the new code only reads (expected, not measured).

## Art round 6

Scope: procedural sprites for beings and hamlet buildings in place of the being dots, and two additive read-only map feeds. Code: `src/render/sprites.ts` (new: `SpriteFactory`, silhouettes per group and per building group, cached textures), `src/render/marks.ts` (being dots replaced by pooled sprites, culled to the viewport; building sprites under them), `src/sim/snapshot.ts` (`mapKindsOf`, `mapBuildingsOf`, `fitSnapshot` drops both first), `src/shared/protocol.ts` (`MapKind`, `MapKindGroup`, `MapSizeClass`, `MapBuilding`, `MAP_BUILDING_CAP` = 96, optional `Snapshot.mapKinds` and `Snapshot.mapBuildings`), `src/app/main.ts` (viewport size passed to the mark layer; nothing else). `PROTOCOL_VERSION` (3) and `SNAPSHOT_VERSION` (1) are unchanged; both new fields are optional. No file under `src/sim/beings/`, `dominions/`, `settlements/`, `items/` or `src/ui/` was touched, and no sim state is written. No randomness.

Status: edits only. No tests, tsc, vitest, build or Playwright were run (instruction). Types were checked by reading.

- **Group mapping.** The spec gives the group of each species as a letter (18a section 2) and the spawn-power rule (18a section 0): A to C are beasts, D sea, E insects, F undead-like, G monsters, H divine (`spawn_divine_*`). Folk is its own group. `mapKindsOf` maps the letters to the seven groups.
- **Colours.** The spec gives no colour per species group. The palette file it names (`palette-master.gpl`) is not in the Spec folder. Colours used: Folk `#F2D18B` (the old dot colour), beast `#DE9650`, sea `#3B7DD4`, undead `#A3A3A3`, monster `#F2331A`, divine `#FFE04A` (these four are values the spec already uses in 01 section 2); insect `#7FBF3F` is a choice of this round. Outlines are a 45% darker tint of the group colour.
- **Sizes.** Fixed CSS px per size class (not scaled with zoom, as the spec's rule that a sprite never scales): T 4, S 5, M 7, L 10, H 13, C 16 px tall. Size classes L and up get a dark patch on the body. These numbers are a guess for legibility, not from the spec.
- **Buildings.** The hamlet rows carry a building count only, and `detail.notable.structures` is capped at 16 rows, so neither gives every hamlet's buildings. `mapBuildings` lists them with `id` (y * 1024 + x), `kind` and tile position, capped at 96 in hamlet order. Groups: `lean_to` and `dwelling_*` house, `granary`, `springwell` well, `quarry` and `quarry_lodge` quarry, `garrison` garrison, everything else a generic box.
- **Budget.** Both new lists are dropped first in `fitSnapshot`, before the marks and points, then the dominions and hamlets are cut as before. Their byte size was not measured. Up to 96 beings and 96 buildings at a few dozen bytes each is a few kB against the 32 kB budget, so a busy realm may now drop the feeds early. Measure before relying on them.
- **Cost.** Textures are rendered once per (group, size) and per building group, then cached in `SpriteFactory`. Sprites are rebuilt when the snapshot tick changes. A camera change only repositions the pooled sprites and hides the ones off screen (margin 16 px); no texture work runs. Pools are reused and extra sprites are hidden, not destroyed.
- **Layers.** Order from the bottom: buildings, beings, the mark graphics (items, armies, pact links, campaigns, battles, hamlet dots), labels.
- **Settings.** `marks.*` do not gate beings or buildings, as before the change (no marks toggle covers beings). `map.particles` is not wired: the layer has no particle effects, so the option has no effect yet. `map.names` and the hamlet labels are unchanged.
- **Beings without a kind.** A being in `mapPoints` with no `mapKinds` row (dropped with the feed) is drawn as a beast when wild and Folk when `folk`, at size S.

Unverified (not run, not checked against typings; node_modules is absent in the worktree):
- `renderer.textureGenerator.generateTexture({ target, resolution, antialias, frame, textureSourceOptions })`: the v8 path and option keys are from memory of the v8 API. The docs fetch did not confirm them. If the path is `renderer.generateTexture` (v7 style) or the option keys differ, the factory fails at the first sprite draw.
- `textureSourceOptions: { scaleMode: 'nearest' }` as a key of that options object.
- `Graphics` shape chaining: `.roundRect/.ellipse/.poly/.rect(...).rect(...)` each followed by `.fill(colour).stroke({ width, color })` on the same path, and `Graphics.destroy(true)`.
- `new Sprite()` with `texture`, `anchor.set`, `position.set` and `visible`: standard v8 members, not checked against typings.
- `Texture.destroy(true)` in `SpriteFactory.destroy`. The factory is not destroyed anywhere yet (the app lives for the page), so it is unused at runtime.
- Visual result of the silhouettes at real zoom levels: not seen.
- Tests: `tests/unit/snapshot-build.test.ts` references the snapshot map fields; an exact key-set or budget assertion may need the two new fields. Not checked.

## Engine runtime round 6

Scope: heartbeat and main-thread watchdog (17 section 10), content-hash handshake (17 sections 2.2, 10), render-side degradation ladder (17 section 3.4), frame-time clamp (02 section 2). Code: `src/shared/protocol.ts` (`Ev.Heartbeat` = 109, `Ev.Ready.contentHash`; additive, `PROTOCOL_VERSION` unchanged), `src/sim/scheduler.ts` (`FRAME_DT_CLAMP_MS`, `HEARTBEAT_TICKS`, `HEARTBEAT_PUMPS`, `heartbeatDue`, `planPump`), `src/sim/worker.ts` (heartbeat in the pump, `contentHash` on Ready), `src/content/content-hash.ts` (new, hash only), `src/app/sim-client.ts` (heartbeat clock, `watchdogArmed`, `restartWorker`), `src/app/recovery.ts` (`workerStalled`, `stepDegrade` and their constants), `src/app/main.ts` (watchdog dialog, hash check at boot, ladder applied in `applyOptions`, `window.__sr.degrade`). `src/sim/clock.ts` is unchanged (see below).

Status: edits only. No tests, tsc, vitest, build or Playwright were run (instruction). Types were checked by reading.

- **Heartbeat.** The worker posts `Ev.Heartbeat { tick, avgTickMs }` every `HEARTBEAT_TICKS` = 20 ticks (one sim-second, 02 section 1), or after `HEARTBEAT_PUMPS` = 60 pumps with no tick (paused or speed 0). Pumps are scheduling, not sim state, so the sim reads no clock. Deviations from the 17 section 2.2 shape: `wallMs` is omitted (a wall-clock value inside the sim is banned) and `degrade` is omitted (there is no sim-side ladder). Pump 60 is a TUNE.
- **Watchdog.** The page judges the worker only after a heartbeat has been seen and while no NewRealm or LoadRealm is pending, because worldgen can block the worker for a while. A stall is 6 s without a heartbeat (`HEARTBEAT_STALL_MS`, 17 section 10); the 2 s expectation (`HEARTBEAT_EXPECT_MS`) is documentation only. A hidden tab is not judged, and the clock restarts when the tab is shown again. The dialog "Simulation not responding" offers Restart simulation (the existing respawn path, which resumes from the newest autosave through `onRespawn`) and Wait (restarts the 6 s clock). Restart counts against `RESPAWN_MAX`. The dialog clears itself when heartbeats return.
- **Content hash.** `contentHash()` is FNV-1a (`fnv1a` in `src/shared/rng.ts`) over the UTF-8 JSON of `SPECIES`, `POWERS` and `BUILDINGS`, as 8 hex digits, cached per page. The worker returns it on Ready; the page compares it with its own and refuses to start a Realm on mismatch ("Build mismatch" dialog, journal `CONTENT_MISMATCH`). The buildings registry lives in `src/sim/settlements/catalogue.ts`; it is imported read-only and not edited. An empty hash means no worker answered and is not a mismatch.
- **Degradation ladder (render only).** Frame intervals are sampled per frame (gaps over 500 ms are skipped) and judged once per one-second window against the budget, 1000 / fpsCap (60 when uncapped, 30 in Safe Mode). Mean over 1.2 x budget for 2 consecutive windows steps down one level; mean under 0.8 x budget for 8 s steps up one level; at least 2 s between changes (17 section 3.4). Levels: 1 bloom off, 2 particles off, 3 shadows off, 4 render scale capped at 50%. The overrides are in memory: the saved options and the sim are never written. Each change is journalled as `DEGRADE`. All constants are TUNE.
- **Limit.** `map.bloom`, `map.particles` and `map.shadows` have no reader in `src/render/` (and that directory is out of scope), so levels 1 to 3 change nothing on screen yet. Only the render scale of level 4 takes effect. The effective state is readable from `window.__sr.degrade()`.
- **Clock.** `planPump` now clamps the wall delta to `FRAME_DT_CLAMP_MS` = 100 ms before the speed multiplier, which is the 02 section 2 "frameDt clamped to 100 ms" rule. `MAX_CATCHUP_MS` stays at 250 ms: 17 section 3.1 names that value for the world-time accumulator, and the brief's "set to 100 ms" would contradict it. Both clamps apply, so the existing test that expects 5 ticks after a stall at x10 still holds (the accumulator cap binds there). The 100 ms value is the decision to confirm; if 17 is meant to win, `FRAME_DT_CLAMP_MS` and the 250 ms cap are the two constants to change.
- **`ticksForFrame`.** The function is not in the repository (no definition, no caller), so there was nothing to wire or remove, and `src/sim/clock.ts` is unchanged. `docs/spec-coverage.md` row 02 still describes it and the 250 ms clamp as open; that row needs an update once the clamp decision is made.

Unverified (not run): heartbeat cadence in background tabs and under the browser's MessageChannel scheduling; that `Pixi` ticker `deltaMS` is the frame interval the ladder expects; that the registries JSON-encode in a few milliseconds on a low phone; that the restart path restores the autosave on the real build (`onRespawn`). Nothing in `tests/` constructs `Ev.Ready`, so the new `contentHash` field should not break a test by type.

### Beings round 6

Scope: spec 06 mood, sleep, bonds and corpses; spec 07 weighted decision system (beast subset); spec 05 section 6.3 `mutateFrom`. Code: `src/sim/beings/system.ts`, `social.ts` (new), `strains.ts`, `store.ts`, `tuning.ts` (`ROUND6`), `src/sim/chronicle.ts` (beings section, schema 4), `src/content/moods.ts` (new), `src/content/decisions.ts` (new).

Status: edits only. No tests, tsc, vitest, build or Playwright were run (instruction). Types were checked by reading.

**Golden is stale.** `GOLDEN_HASH` (2562049680, `tests/unit/golden.test.ts`) is not edited and is wrong for this code. Reasons: the fuel pass now starves one pass earlier (06 2.1 order), the decision layer draws the `beings` stream in a different order, births can found mutant strains (`lineage` stream), and sleep and mood change state the hash covers. The golden test will fail until it is re-baselined by a run.

**Persisted state changed.** Chronicle beings section, per Being: `mood` (i16), `endurance` (u16), `sleepUntil` (u32), `sleepVit` (i16), `bondWith` (i32), `bondGen` (u32), `closeWith` (i32), `closeGen` (u32), `closeSince` (u32), then one `cooldown` (u32) per decision. The header gains the decision count (u8). Shape checks: decision count equals the content table, mood in -100..100, endurance at most the species maximum, bond and close links name a Being in the save. Not saved: the running task (07 section 14, a loaded Being picks again). `BeingStats` gains `sleeps` and `bonds` (JSON stats, additive). `SCHEMA_VERSION` goes 3 to 4, so schema 3 saves are rejected. This bump is needed because the beings layout changed; it was not named in the brief. `chronicle.ts` is outside the listed touch set; it was edited only for the beings section, the schema constant and one import, because the brief requires persistence there. `PROTOCOL_VERSION`, `SNAPSHOT_VERSION`, `snapshot.ts` and `protocol.ts` are unchanged.

**Step 1: mood and sleep (06 sections 4, 5).**
- Mood is an `Int16` per Being, -100..100, changed only by events (`MOOD_VALUE` in `src/content/moods.ts`, the spec's TUNE table). No passive drift. Clamped.
- Feeling mood: 06 4.1 says only strains with the `emotions` tag feel mood, but no trait in the data grants it. OPEN default: awakened strains (all four brain organs). Change `feelsMood` in `social.ts` to widen it. Effect in play: beasts never feel mood, and Folk never spawn in play (`spawnFolk` has no caller), so mood changes nothing in play yet.
- Events wired, each on a trigger the spec states: `born` (child, 06 6.6), `child_born` (bearer, once per birth event, 06 6.4), `grew_up` (06 3.2), `starving` (each starvation hit; the table names the event, the trigger is our reading), `slept` (natural wake), `child_died` (living parent of the dead, 06 7.2), `kin_died` (living children of the dead; our reading of "children/others"), `friend_died` (bond partner), `bonded`, `talked_well` / `talked_badly` (chat).
- Sleep: `sleepUntil` and `sleepVit` per Being. Durations: monophasic uniform 800 to 1800; no sleep-cycle trait (SLP group) 400; otherwise uniform 400 to 1200. The era-linked 2000 is not built (no era-to-trait map in data). Sleeping Beings do not decide, move, mate or chat.
- Early wake: any vitality drop below the last-seen value, from any source (combat, starvation, bites). Gives no mood and no endurance (06 5).
- Natural wake: endurance +20% of max (rounded), mood `slept` +5. The dream roll (23-entry pot) is not built.
- Fuel pass (06 2.1): metabolism first; at 0 the hunger rule starves by 5% of max vitality (and gives `starving`); otherwise endurance +1. A sleeping `energy_saver` Being skips the pass. `famished` is not built.
- Not built, asked for in the brief: a sleep state that reduces speed, and rest triggered by low fuel. 06 states neither, so they were left out. Sleep is started only by the decisions below.
- Sleep decisions: `idle_nap` (tier 0, w 0.05, cd 1800, onlySafe, no gate), `polyphasic` (tier 1, w 0.8, cd 1800), `monophasic` (tier 1, w 0.75, cd 4000). The 06 text gives no trait gate for the two cycle decisions: our gates are `split_sleep` for polyphasic and `one_sleep` for monophasic. Our choice; change in `decide` if the roster means otherwise.

**Step 2: bonds and corpses (06 4.4 and 7.3).**
- Bonds (user brief; this is not the spec's lover or best-friend model). Two Beings of one strain within 3 tiles (`ROUND6.bondRadius`, TUNE) for 600 ticks (`bondTicks`, TUNE) bond: `bonded` +40 both. One partner each. The bond ends when a partner dies (survivor `friend_died` -25). Spec 06 4.4 has lovers (same species, `canFallInLoveWith`, `smitten`) and best friends (formed after chat, chance formula); neither is built. Bonds gate no decision: the spec's bond-dependent decisions are Folk-only.
- Corpses: not built. 06 7.3 says there is no persistent corpse object (OPEN default). Its only decay is a 600-tick `Remains` decal, render only, which lives in `src/render` (outside the touch list). The spec sets no gameplay decay time. No decomposition system exists: a search for corpse, decompos, carcass and remains finds nothing in `src/` except the trait text "Eats corpses". A corpse round needs a spec decision and a render slice first.

**Step 3: weighted decision system (07 sections 3 to 5).**
- `decide()` now runs: candidates from `DECISION_ROWS` (`src/content/decisions.ts`, 12 rows, weights and cooldowns from the spec), filtered by cooldown, flags (`onlyHungry`, `onlySafe`, `onlyAdult`) and a per-decision eligibility check. Tier rule: a critical candidate forces tiers, otherwise tiers apply 80% of the time (07 3.5). Softmax pick with `exp(w)` on the `beings` stream (07 3.4). The cooldown is set on pick. Empty set: pause 20 ticks.
- Layers: decision (catalogue) -> task (one function per decision in `TASKS`, run once per decision cadence and continuing while it returns true) -> job (collapsed; the default `idle_decide` is the decision pass). Not built: the step machine, verifiers, path requests, `speedMult`, `cancellableBy*` flags.
- A flight from a hunter (`flee`) interrupts any running task except flee itself (07 4.2 gives fights this override).
- Mate weight is 2 under the living-children cap and 0.1 at it (07 3.4 reproduction rule). `seek_partner` (07 tier 3) is merged into `mate`, which walks to the partner and mates.
- Weights are the spec's numbers. Their effect: at weight 3.1, flee beats an eligible mate (w 2) about 75% of the time, not always. Eat decisions with weight 1 against a mate at weight 2 give the mate about 73%. Idle decisions have weights 0.05 to 0.2, close to uniform under softmax, so idle napping is frequent (cooldown 1800 limits it).
- Tasks built (beast subset): `wander`, `pause5` (5 ticks, read as ticks), `idle_nap`, `polyphasic`, `monophasic`, `herd_follow` (follows a same-species Being beyond 3 tiles; needs species `herding`), `chat` (simplified: walks to a partner within 2 tiles, then one 70/30 outcome; the spec's 5 to 9 rounds are not built), `flee`, `eat_grass` (grass and omni), `eat_nectar`, `eat_hunt` (flesh; omni only with no food underfoot), `mate`.
- Cooldowns are persisted (schema 4). Tasks are not.
- Left out (the brief asked for a record):
  - `flee_predator`: same trigger as `flee`; not separate. `flee_suspicious`: Folk-only.
  - `wander_home`, `wander_to_structure`, `blink`, `blink_home`, `investigate`: need houses, structures, teleport or curiosity state, none on beings.
  - `playful_wander`, `child_flip`, `child_spot`, `child_jump`: cosmetic (render only).
  - `swim_about`, `eat_algae_fish`, `unstick_small_island`, `leave_blocked_tile`, `reach_land`, `retreat_to_shore`, `douse_self`: need water, island or fire state on beings.
  - `pollinate`, `swarm_find_nest`, `bee_make_hive`, `burrower_move`, `spider_move`, ant walkers, `skeleton_move`, `raise_boneshambler`, `heal_check`, `cure_check`, `fertilize_check`, `purge_growths`, `shellback_*`: species mechanics with no state here.
  - `relieve`: needs the `sated` effect. `reflect`, `laugh`, `sing`, `grumble`, `weep`, `outburst`, `mad_emotion`, `swear_check`, `read`, `steal_coins`: need mood history, emotion effects or Folk state.
  - `outburst_action`, `steered_follow`, `muddled`, `tagalong`, `follow_desire`: tier-4 triggers that need effects and possession, not built.
  - `herd_leave`, `herd_join_new`, `herd_alpha_move`, `herd_check`: need family state (families are not built).
  - `follow_parent`: Folk children only. `eat_kin`, `drain_blood`, `eat_insects`, `eat_ground`: no such diet, no cannibal rule, no insect or geophage food.
  - `rest_indoors`, `choose_sleep_place`, era-linked sleeps: need houses or eras on beings.
  - Settlement, dominion, army, intrigue, boat, taxi, wyrm, craft, tyrant, hand, and Folk work tasks (`find_job`, `build`, `chop`, `mine`, `store_stock`, `pay_tax`, `craft_gear`, and the rest of 07 section 5 H to K): dominion, settlement or special-creature state, out of scope for beasts.
  - `eat_hamlet_food`, `refill_at_well`, `repair_gear`, `loot_run`, `fetch_hamlet_gear`, `extinguish`: settlement or item state.
  - `herd` and `chat` mood outcomes apply only where `feelsMood` is true (see step 1).
- Ecology risk (not tested): the spec's cooldowns (`eat_hunt` 1100, `mate` 800, `idle_nap` 1800) and the fuel pass reorder change predator and grazer pacing. The soak was not run. Expect to re-tune `eat_*` cooldowns and the weights.

**Step 4: lineage (05 section 6.3).**
- `mutateFrom(strains, parent, speciesName, rng)` in `strains.ts`: `k = randInt(0, meta.mutation)` inclusive on the `lineage` stream; `k` add draws from `STRAIN_MUTATION_POT` (opposites swap out); then as many remove draws. The remove pot is new: `-` traits outside groups DIE, RMT, COG, GST and EGG (add-only groups in 6.3). Generation is parent + 1; the parent id is recorded.
- Called on birth when the bearer's strain has mutation capacity above zero (`wild_genes` +1, `stable_genes` -1). Deviation from 06 6.1 ("newborns join a parent's strain"): a birth whose trait set changes founds a new strain. An unchanged set returns null and the newborn joins the parent's strain, so no strain is created per birth. Risk: the strain registry has no cap and `wild_genes` lines can split often. Watch the strain count.
- Per-strain counters: `born`, `newAdults` and `reproduced` already exist (`strains.ts`, 05 section 2) and are maintained as before. No counter was added.
- Not built: the lineage code and segments (05 sections 5.1 to 5.5, including `mutateSlot` and `unstableShuffle`), so `k` applies to traits only. Uplift and evolve (05 6.4).

**Fixed decisions that were left alone:** `docs/spec-coverage.md` (not in the touch list; rows 05, 06 and 07 still read PARTIAL and need an update after a run). `PROTOCOL_VERSION` and `SNAPSHOT_VERSION` unchanged.

### Beings round 7

Scope: the four brief items: 06 2.1 low-fuel pace, 06 7.3 corpses, 05 section 5 genome, and the 06 4.1 `emotions` tag. Code: `src/sim/beings/genome.ts` (new), `strains.ts`, `system.ts` (founder code only), `social.ts` (`feelsMood`), `src/sim/chronicle.ts` (beings section and its reader). No content, snapshot or protocol change.

Status: edits only. No tests, tsc, vitest, build or Playwright were run (instruction). Types were checked by reading. `GOLDEN_HASH` is not edited and will not match: founders now draw from the `lineage` stream, and the mood grant below changes mood for `fear_organ` strains.

**Persisted state (no bump).** `SCHEMA_VERSION` stays 4. Schema 4 is unreleased, so nothing is bumped; a save written by the round 6 build (no code block) is rejected. The beings section gains, after the free list, a u32 count of lineage codes, then per code: u32 strain id, u32 seed salt, u8 strand count, and per strand a u8 type index and per slot a u8 kind code (0 empty, else library index + 1) and a u8 special (0 none, 1 booster, 2 blocked). Shape checks: the code count equals the strain count; each code names a registry strain once; strand type known; kind code in the library; special 0..2; a usable slot is filled and a blocked slot is empty; at least one usable slot per strand; seed salt below 55556. The `Strain` record and section 17 are unchanged: codes live in `Strains` outside the snapshot. No corpse data is saved (no corpses exist).

**Step 1: low-fuel pace (06 2.1, 07 7.1). Cut.** 06 names one fuel threshold: hungry at fuel/fuel_max <= 0.5, which unlocks the eating decisions and nothing else. No spec section gives a pace or speed effect for low fuel. 07 7.1 gives the pace formula with no fuel term, and 08 `famished` lists a mood event and an eating task, not a speed. The brief asked for the spec's thresholds, and there are none, so the movement path in `system.ts` is unchanged and no TUNE values were added. Needs a spec decision (for example a pace multiplier below 50% fuel, and its value) before it is built.

**Step 2: corpses (06 7.3). Cut, as the spec states.** 7.3's default is no persistent corpse object. The only decay it names is a 600-tick `Remains` decal, render only, in `src/render` (outside the touch set). It gives no gameplay decay time and no decomposition system. So nothing is built: no corpse record, no decay timer, no tile decomposition effect, and no population exclusion (dead beings are already removed from the store, so they never count). Persisting corpses needs a spec decision first: keep 7.3's default, or make corpses persistent, which brings in 06 2.2 (`edible` victims) and a decay time.

**Step 3: genome (05 section 5). Partly built.**
- Built, `genome.ts`:
  - Segment library from the 5.2 ladder (TUNE values as stated). Pairing (male and female), flaw and volatile kinds exist. Tempo and scale are gated: decomposition and mutation skip them, since no unlock exists. Kind ids are `stat:value`.
  - Strands: four types, tiny (12 slots), short (18), mid (24), long (30), six columns. Booster and blocked counts are the 5.3 ranges. The spec gives no capacity per type name, so the mapping by name is ours.
  - Budget decomposition (5.3): pseudo-stats first, then up to 300 rounds with the 80% descending pick, placement across strands, fillers from 5.2, and a final shuffle. Seed is hash(worldSeed, speciesIndex, salt), with the salt from the `lineage` stream.
  - `mutateFrom` (6.3): the code gets k + 1 slot mutations per strand, on a copy of the parent's code, with a new seed salt for the child. The trait path is unchanged.
  - Resonance totals (5.4): edge keys hash(worldSeed, kind, side) mod 4, flaw halving, full-resonance doubling, pairing blocks, volatile meta. `genomeTotals` computes them on demand. Not saved, and nothing in play calls it.
- Budget source (OPEN): the data holds no budget table. The budget is read from the species base (vitality, endurance, might, pace, span, plating, litter). A real budget table belongs in `src/content`.
- Cut or not built:
  - Totals are not applied to stats (05 6.2: `strain.base = species.base + total.base`). With the derived budget, applying them would double the species base, so the genome has no effect on any stat in play yet.
  - Phenotypes (05 section 8): not built. The spec says species list palettes per biome, and the data has no palette lists. The Being record gets no phenotype index or shade, and the strain gets no `phenotypes`, `biomeVariant` or `birthMarks`.
  - `unstableShuffle`, the `shifting_code` timer (6000 to 12000 ticks), and the `gene_chaos` rule: not built. No per-strain timer exists and the code affects no stat.
  - Species-forced strand type (Folk long or mid, swarm insects tiny): not built. There is no species field for it.
  - The volatile segments do not add to the strain's meta mutation, which still comes from the traits only.
  - `evolvedInto`, uplift and evolve (6.4): not built, as in round 6.
- Trait-set rule kept from round 6: when `mutateFrom` finds the trait set unchanged it returns null and the code mutation is discarded. The flood guard still applies, so code mutation lands only when a new strain is founded.

**Step 4: mood (06 4.1, `emotions` tag). A trait grant from the data.** The spec names the tag but grants it to no trait. Of the 18b rows, `fear_organ` ("Gains fear/flee responses") is the only one whose text is an emotional capacity. Every awakened strain holds it, so the round 6 default (awakened strains) is a subset of this one. `feelsMood` now checks `EMOTIONS_TRAIT` = `fear_organ` in `social.ts`. Effect: beasts with a fear organ feel mood now, and awakened Folk still do. Trait rows that mention mood (`dream_gland`, `cheerful`, `unravelled`, `placid`) modify mood or behaviour rather than grant the tag, so they are not used. If the spec means a dedicated tag, it needs a `strainTags` column in 18b.

**Superseded:** the round 6 OPEN default for `feelsMood` (awakened strains) is replaced by the `fear_organ` grant above.

## Testing pass after round 6 merges

- **Running decision task is saved.** A save-and-load run diverged on its first step because the beings' running task was not saved (07 section 14 leaves this OPEN). The task is now saved as an i16 per Being in the beings section; the schema stays 4 since no release has shipped schema 4.
- **Golden hash re-baselined.** `GOLDEN_HASH` 2562049680 -> 1492628085 after the round 4 to round 6 sim changes (pacts, armies, items, mood, sleep, bonds, decisions, lineage, engine heartbeat). Determinism check passes.
- **Test updates.** `pacts-records`: a war inside a three-member pact dissolves the whole pact (round 4 rule). `pacts-opinion`: the march test measures distance to the enemy parcel (column 9, row 0). `audio-respawn`: the zero Ready reply carries `contentHash: ''`.

## Crash record and release round 7

Scope: spec 19 crash record, consent and export (sections 5, 6, 8, 9), "not responding" copy (17 section 10, 19 section 2), LEGAL-CHECKLIST release files. Code: `src/app/crash-record.ts` (new), `src/app/recovery.ts`, `src/app/main.ts`, `src/ui/staticWindows.ts` (credits only), `ASSET-LICENSES.md` (new), `docs/QA-LOG.md` (new).

Status: edits only. No tests, tsc, vitest, build or Playwright were run (instruction). Types were checked by reading. No QA run has been done (`docs/QA-LOG.md`).

**Crash record (19 section 5, 6, 8).**
- Written on each fatal fault (`reportCrash`: uncaught errors, unhandled rejections, `sim_fatal`, `worker_dead`) and on a worker stall (`WORKER_STALL`, kind `worker_dead`). Local only. No network code in the module.
- Store: IndexedDB `sr-crash`, store `crashes`, ring of 20 (oldest deleted in the same transaction). Write budget 300 ms; on timeout or failure the summary goes to localStorage `sr-crash-lite` (last five: id, kind, fp, ts, version). Records from this page are also kept in memory, so export still works when IndexedDB is blocked.
- Fields: id (128-bit random), fp (two FNV-1a passes, 16 hex), kind, severity (from the taxonomy table), ctx, time, app (version from `package.json`, build = content hash, schema 1), env (UA family, touch, dpr, online, cores, memory), run (uptime, tick, speed, Age, Safe Mode), err (name, scrubbed message, up to 30 frames), crumbs (last 20 journal entries, scrubbed), recovery step. Record cap 64 KB: crumbs, then frames, are dropped first.
- Scrubbing (19 section 6): URLs, paths, e-mail addresses, long tokens, double-quoted text and digit runs over four digits are replaced. Frames keep the chunk name only; other origins become `<ext>`. Not built: fuzz redaction test (T-19-6).
- Repeats: the same fingerprint is not written twice within 2 s, so an error inside a frame loop cannot flood the ring.
- Deviations from spec 19: non-fatal worker faults (`warn`, `error`) are journal-only and get no record. No breadcrumb ring of 50, no log attachment, no perf block, no `sys` block, no emergency save. Build identity: no git hash is injected (`vite.config.ts` is out of scope), so `app.build` is the registry content hash.

**Consent and send (brief item 2, 19 section 9).**
- `privacy.errorReports` (boolean, default off) gates export. It is read at boot and on every change (`setCrashConsent`). With it off, export refuses and downloads nothing.
- This build has no crash endpoint (OPEN-19-1 unset). Decision: no network send exists in this build. `NETWORK_SEND_AVAILABLE = false` is written into each export. "Send" is replaced by a JSON file download; the message says "Nothing was sent."
- Deviation: spec 19 section 8 makes Export available regardless of consent. The brief's gate was followed. Revisit if the spec wins. Not built: ask, always and never modes, the preview, the first-fatal explanation, the rate limits and the unsent queue. DNT and GPC are not checked (the default is already off).

**Export (brief item 3, partly done).**
- Export is reachable now as "Export crash record" on the fatal dialog (src/app). It downloads the newest record.
- OPEN: the Help window button. Help is built in `src/ui/windowContent.ts` (`buildHelp`), and the brief limits `src/ui` to copy and credits. Adding the button needs a one-line change there. Needs approval.

**"Not responding" dialog (brief item 4).**
- Title "Simulation not responding" and the Wait button already match 17 section 10 and 19. Copy changed only: the primary button is "Reload" (was "Restart simulation"), and the text now says "Reload to resume from the newest autosave" (was "Restart it to resume").
- Open (behaviour, not copy): 19 section 2 says the overlay shows "when it wakes". The code shows it when the stall is detected (6 s with no heartbeat), not on wake.

**Release files (brief item 5).**
- `ASSET-LICENSES.md`: the six packages from `package.json`, with versions from the lockfile. Licences read from the installed packages in the main checkout's `node_modules` (`node_modules` is absent in this worktree). Licence text files were not checked. The project licence is undecided (`package.json` says ISC by default).
- Credits window (`win_credits`): versions and licence summary added. The spec has no credits text (13 lists the row only, "credits and licences"), so none was copied.

**QA log (brief item 6).** `docs/QA-LOG.md`: template and a first entry stating that no QA run has been done.

**Not done, and why.**
- Lawyer review of ASSET-LICENSES.md and LEGAL-CHECKLIST: needs a lawyer. Not written.
- Look-and-feel review, trademark search, name audit (LEGAL-CHECKLIST): need people outside the project.
- Unclean-exit sentinel and restore prompt changes: out of the brief.

## Settlements round 4

Scope: 09 buildings (catalogue), citizen jobs, supply trade, hamlet mood, roads. Code: `src/sim/settlements/catalogue.ts`, `hamlet.ts`, `jobs.ts` (new), `trade.ts` (new), `adapter.ts`; `src/sim/snapshot.ts` and `src/shared/protocol.ts` (additive `mood`); `src/content/content-hash.ts` is unchanged but its input (`BUILDINGS`) changed.

Status: edits only. No tests, tsc, vitest, build or Playwright were run (instruction). Types were checked by reading. `tests/unit/golden.test.ts` `GOLDEN_HASH` and the content hash are stale until a run re-baselines them.

**Buildings (09 section 7, 18c section 4.1, 18e section 3).** Added with 18c cost (iron removed, gold kept), footprint (`footprint` = width, `height` = depth) and effects: `hearth_fire`, `larder`, `granary` (updated to 18c cost and footprint), `quarry` (updated: gold 12, no wood; now worked by miners), `lumber_camp`, `lean_to`, `dwelling_1`..`dwelling_6` (slots, `housingMood`), `great_hall_1`..`great_hall_3` (slots), `monument` and `waystop` (`moodBonus`), `garrison` (cost, gate), `quarry_lodge` (18e, +25% outcrop yield, one extra miner). Legacy `house`, `well`, `storehouse` and `workshop` are not 18c ids; they stay in the registry so saves load, and the hamlet no longer places them. The catalogue now has 23 entries (19 spec ids).
- Cut, with reasons: `springwell` (water source, no sim effect; legacy `well` remains), `drill_post`, `watchspire`, `beacon_tower`, `palisade`, `gatehouse` (combat and walls not built), `shrine`, `archive`, `lecture_stone`, `pyre`, `apothecary` (faith, books, Lore, pyres, disease not built), `bazaar` (its effect is boat income, 10.5, and boats are not built; the supply trade needs only a larder), `fishers_pier`, `harbor` (water placement and boats not built), `mill_a`, `mill_b`, `farmstead` (tilled fields not built), `smithy` (gear crafting belongs to items), and the 18e set except `quarry_lodge`: `bastion`, `brazier_tower`, `slipway`, `arsenal`, `paddock`, `sea_lantern`, `stargazer`, `hide_works`, `brewhouse`, `bake_oven`, `bee_shed`, `grove_lodge`. 18c section 4.2 wild, hazard, resource and wonder objects are map fixtures, not hamlet buildings.
- Not built for every building: construction time (the sim places buildings instantly, so `progressNeeded` is unused), hp (data only), house-count limits (`maxHouses`), and the upgrade chain (each tier is placed on its own, gated by `needs`).
- `needs` (09 section 6 prerequisites): `lean_to` needs `hearth_fire`; `dwelling_1` needs `lean_to`; `dwelling_2` needs `great_hall_1` and `dwelling_1`; `dwelling_3` needs `great_hall_2` and `dwelling_2`; `dwelling_4` needs `great_hall_2` and `dwelling_3`; `dwelling_5` and `dwelling_6` need `great_hall_3` and the tier below; `great_hall_3` needs `monument`, `quarry` and `garrison`.
- **Spec conflict.** 09 says `great_hall_2` needs a `dwelling_3`, while `dwelling_3` needs `great_hall_2`. Here `great_hall_2` needs `dwelling_2` (TUNE).
- Iron: the hamlet holds no iron, so iron costs are cut (`garrison` already did this). Dwelling VI, Great Hall II and III lose their iron.
- Build order (`RULES` and `buildChoices` in `hamlet.ts`): one building per growth step. House tiers come first while folk outnumber housing or fewer than four houses stand, highest tier first. Then `hearth_fire`, `larder`, `granary`, `great_hall_1`, `quarry` (stone under 10), `lumber_camp` (wood under 30), `quarry_lodge`, `waystop`, `great_hall_2`, `garrison`, `monument`, `great_hall_3`. Each is limited to one per hamlet. Gates are the spec's where 09 gives them; `waystop`'s gates are TUNE. The first choice that places is built, so a tier the hamlet cannot afford does not block the rest.
- The sim places buildings first-fit in parcel order, not by the spec's custom tile patterns or `placeSingle` rules.
- Storage: `larder` is built and gates the supply network. Its `storage` field is recorded but the sim does not cap stock by it. Stock caps (10.2) are not built.

**Jobs (09 section 8, reduced; `jobs.ts`).** Workers are not saved. Each growth step, folk fill job slots in order: forager, miner, woodcutter. Slots come from buildings (`hearth_fire` 4 foragers, `quarry` 5 miners, `quarry_lodge` +1 miner, `lumber_camp` 3 woodcutters). Caps: foragers by food stock (spec `foodCap`), woodcutters one while wood is over 15, else three (spec quota). Output per worker per step, scaled by the mood multiplier: forager 2 food (to the store cap), miner 2 stone from the outcrops (`+25%` with a lodge), woodcutter 3 wood. A miner also pays one coin every 5 steps into the hamlet gold (`MINER_COIN_STEPS`). Simplifications: no tree or fruit-bush requirement (the forager and woodcutter yields do not look at flora), no herbalist or honey gatherer, no builder, cleaner, roadwright or hunter job, and the spec's job priorities and `okForRuler` rules are not built. The legacy `well` (food) and `workshop` (wood) still yield without workers.

**Trade (09 section 10.4; `trade.ts`).** Every `SUPPLY_PERIOD` = 600 ticks (`tick % 600`, so saves keep the same rounds), a hamlet with a larder sends one transfer: for food, wood, stone, then gold in that order, the first good above its bound (30; gold 600) goes to the first hamlet of the same dominion below 10 (gold 10). The amount is 10 (gold 100). Reading of the table: "(10; gold 100)" is the amount for resources and for gold. Simplifications: the custom requirement is not checked (customs are not built), and "more than one hamlet in the dominion" is implied by a taker existing. Dominion membership is the owner byte holding most of a hamlet's parcels (`majorityOwner` in `adapter.ts`, same rule as the captain count in `dominions/adapter.ts`). Reading owner bytes needs `dominionState`, which creates the dominion state on first use. The supply round therefore reads it only on a supply tick, and only once a hamlet has `FOUND_FOLK` folk. Known side effect: from that tick the save carries an (empty) dominion section earlier than the yearly pass would create it. Bazaar and boat income are not built.

**Mood (09 section 9, hamlet level; `hamletMood` in `hamlet.ts`).** Derived each call; nothing stored. Terms: housing (housed folk score the average `housingMood` of the slots times 3, homeless folk score -30 each, averaged per folk), food (stock per folk: 4 or more +20, 2 or more +10, 1 or more 0, under 1 -20), buildings (sum of `moodBonus`, capped at 30). Result clamped to -100..100. It feeds the work multiplier `0.9 + 0.2 x (mood+100)/200` for job output (09 section 9). It is shown in the hamlet snapshot as `HamletRow.mood` (optional, additive in `protocol.ts`; `snapshot.ts` fills it). Not built: loyalty and per-Folk mood use of hamlet mood.

**Roads (09 section 11.3): cut.** The rule runs only with the custom trait `roadworks`, and customs are not built. Roadwrights are not built.

**Persisted state: no change.** Jobs, mood and trade are derived or tick-keyed, and `Hamlet` gained no field. The hamlet save (`snapshotHamlets` and `restoreHamlets` in `adapter.ts`) is unchanged, and the shape checks are unchanged. Saves with the legacy building ids still load. `FORMAT_VERSION` unchanged.

**Other deviations and open items.**
- The census still counts every being on a hamlet's parcels, beasts included (existing round 1 choice). Jobs and mood use that same count, so beasts take jobs.
- `spec-model.ts` (UI, outside the touch set) prints `footprint` as a square. Rectangular buildings show the width twice. `systemWindows.ts` prints the registry length (now 23).
- `docs/spec-coverage.md` (outside the touch set) still shows 7 of 60 buildings and no jobs, trade, mood or roads.
- Tests that assume the old order or the old quarry stone (no workers needed) may need updates when testing resumes. Likely candidates: `tests/unit/settlements.test.ts` (build order), `tests/unit/items-gear.test.ts` (garrison gate and the catalogue helper), and the golden test.

## Golden and test pass after the round 4 to 7 merges

- **Golden hash confirmed.** `GOLDEN_HASH` stays 1492628085 (the value set in the testing pass). The golden replay is unchanged by the later rounds, and the determinism check passes.
- **Attack orders and marches obey parley.** The yearly pass now skips attack orders and marches when the `parley` rule is off (10 section 3). This fixed the parley-off wiring test.
- **Test expectations updated for the merged rules.** Pact formation is an intrigue, so pact tests call `formPact` and `joinPact` directly and the army test expects no pact at 15 strength. Snapshot hamlets carry `mood`, so the hamlet snapshot test matches a subset. Round 4 build rules and jobs changed the settlement tests (no-wood territory and the first building).
- **Open:** `dominions-wiring` "a campaign moves parcels" expects dominion 1 to gain a parcel; it has 128 where 129 is expected. Not yet investigated.

## Dominion campaign fix

Scope: the failing `dominions-wiring` test "a campaign moves parcels" (129 expected, 128 got). Code: `src/sim/dominions/armies.ts` (`attackOrders`), `src/sim/dominions/adapter.ts` (`stepDominions`). The test is unchanged: its expectation (a defeat moves one parcel from the loser to the winner) is the spec's rule (09 section 3: border-taking needs the explicit `border_creep` flag, and the strength exchange decides a fight), so the code was wrong.

- **Cause.** Round 5 attack orders took a parcel on contact with no flag check. In a 3-year campaign, dominion 2's army (weaker side) took a parcel from dominion 1 at about tick 200. The defeat at tick 580 then gave one parcel back, so dominion 1 ended with no net gain. A second bug made it worse: the two armies took the same parcel back and forth, so each army lost 5% strength on every swap, and the flip-flop repeated each pass.
- **Fix 1: flag.** `stepDominions` runs `attackOrders` only when `border_creep` is on. Attack orders are the only parcel grab in the army step, and 09 section 3 says border-taking needs the flag. With the flag off, armies still march and fight by exchange.
- **Fix 2: defended parcels.** An ordered army takes its target only when the target is undefended, meaning no army of the owning dominion is in reach of it. A defended target keeps its order, so the armies march to it and settle by exchange. After a grab, the attacker's army stands next to the parcel it took, which defends it, so the old owner cannot take it back. Target choice is unchanged (nearest enemy parcel). A first attempt that also excluded defended parcels from target choice made the armies chase open ground and drift apart, so the campaign never reached contact; that version is not kept.
- **Result.** The test passes unchanged. The count stays 128/128 until the defeat, then 129/127 (checked with armies on and off). `GOLDEN_HASH` stays 1492628085 (golden test passes).
- **Not changed, found on the way.** `dominionsYearly` raises armies even with `standing_armies` off, although the `dominionStep` comment says that rule raises none (10 section 8 and 09 section 8 require it). Not changed here, because the fix above does not depend on it.
- **Not checked.** The Playwright suite was not run (instruction). The attack-order numbers (5% casualties, renown) are unchanged TUNE values.

## Settlements and creeps release

Scope: 09 (jobs, trade, mood, town tier, garrison, roads), 18c (buildings), 18e (creep hubs, landmarks, beacon pillars, extended buildings). Code: `src/sim/settlements/` (`catalogue.ts`, `hamlet.ts`, `trade.ts`, `adapter.ts`, new `landmarks.ts`), `src/sim/terrain/creep.ts`, `src/sim/terrain/eruption.ts`, `src/content/creeps.ts`, `src/sim/snapshot.ts` and `src/shared/protocol.ts` (additive `tier`), `src/sim/chronicle.ts` (`checkHamlets`, the hamlet section only). Not touched: `src/sim/beings/`, `src/sim/powers/`, `src/sim/combat.ts`, `src/sim/dominions/`, `src/content/powers.ts`, `GOLDEN_HASH`, `SCHEMA_VERSION`, `FORMAT_VERSION`.

Status: edits only. No tests, tsc, vitest, build or Playwright were run (instruction). Types were checked by reading. `GOLDEN_HASH` (1492628085) is unchanged and not re-baselined; the content hash changes (new `bazaar` row), which is expected.

**Persisted state (hamlet section only, `TAG.hamlets`).** The section gains three optional arrays, all absent in older saves (which load as empty):
- `structures`: `{ id, tile, next }` per landmark or beacon pillar. `next` is the absolute tick of the next pulse.
- `hubs`: `{ tile, def, tiles, nextPulse, alive }` per creep hub. A dead hub stores `nextPulse` 0 (JSON cannot hold Infinity) and loads as Infinity. Before this round creep hubs and their tiles were not saved (see `terrain/state.ts`), so a reloaded realm lost its creep. This closes that gap for hubs only. Vents and quakes are still not saved.
- `creepGuard`: `[tile, untilTick]` pairs (18e 8 edge 4).
`checkHamlets` (chronicle.ts) checks the shapes before `restoreHamlets` checks the contents (ids against `LANDMARK_BY_ID` and `CREEP_HUB_BY_ID`, tile range, finite numbers). `Hamlet` gained no field; `Hamlet.gold` is unchanged.

**Settlements (09).**
- *Buildings.* Added `bazaar` (18c 4.1: 4x3, cost 8/5/0/90; iron 2 cut, as garrison did). Gate: pop 60, buildings 15, one per hamlet (09 section 6). Hamlets now have 20 build rows (19 spec ids, plus `quarry_lodge`).
- *Bazaar effect* (09 10.5, the default design, TUNE): every 600 ticks (30 s) a hamlet with a bazaar converts 10 of the first of food, wood or stone that holds more than 30 into 4 gold (`trade.ts` `bazaarStep`, run per second from `settlementsStep`).
- *Town tier* (09 section 2; the M6 exit test "a hamlet grows to a town"): `TOWN_POP` = 40, `tierOf(h)` returns `town` at 40 folk or more. Derived, not saved; shown as `HamletRow.tier` (protocol, additive). Naming templates and the dominion-capital tie-break are not built (names and dominions are outside this round). The build orders already gate on population directly, as 09 says. **The M6 exit test is not verified:** it needs a run, and in this sim folk come from the beings census (`census` in `adapter.ts`).
- *Jobs.* No new job. The sim runs forager, miner and woodcutter (the 09 jobs with a sim-side input). Cut, with reasons: builder (construction is instant, so a builder has no work), prospector and honey gatherer (deposits and hives are map fixtures, not built), herbalist (flora rules are in 18d), tiller (needs tilled fields and a mill), roadwright (needs customs), cleaner (no ruins are built), manure collector (no manure piles), hunter (per-being kill rule), soldier (armies are in dominions, outside this round).
- *Beacon desires.* A hamlet with a parcel centre within `BEACON_RANGE` (40 tiles) of a pillar adopts the nearest two pillars' build ids (`desiresOf`, 18e 2.3). In `buildChoices`, desired builds lead the civic choices. Deviation: the spec draws uniformly with each desire listed twice, but first-fit placement has no uniform draw, so a desire leads instead of weighting. The desire list is derived each second and not saved.
- *Mood.* No new mood term. The hamlet-level terms are complete (round 4). The per-folk events (09 section 9) need beings, which are outside this round. The 18e hub-proximity terms (gloom -3, gourd +2 within 6 tiles) need creep hub positions in `hamletMood`, which runs in both `snapshot.ts` and the hamlet step; cut for now, to be added with a shared mood context.
- *Garrison soldiers and gear.* Cut. Soldiers are armies in `dominions/`, which this round may not edit. Reading the dominion state is possible through `dominionState`, but producing soldiers writes armies, so the soldier gate and the timer halving wait for a dominions round. Gear storage (15 per list) is in `items/`, outside the touch set, as round 4 already recorded.
- *Roads (09 11.3).* Cut. The rule runs only with the custom trait `roadworks`, and customs are not built. The A* would run on the parcel grid, but there is no trigger.
- *Trade.* The supply round (10.4) and the bazaar conversion are the trade paths. Boat income (10.5) is not built (no boats).

**Buildings (18c).** Built now: 19 of the 60 18c rows, plus `quarry_lodge` from 18e (20 spec ids in the catalogue). Cut from 18c section 4.1 (the rest), with reasons:
- Need soldiers or combat: `drill_post`, `watchspire`, `palisade`, `gatehouse`, `beacon_tower`.
- Need culture not built: `shrine`, `archive`, `lecture_stone`, `pyre`, `apothecary`.
- Need fields or water: `farmstead`, `mill_a`, `mill_b`, `springwell` (its water effect has no sim target), `fishers_pier`, `harbor`.
- Need items: `smithy`.
- Need boats: `fishers_pier`, `harbor` (already listed).
- 18c section 4.2 wild, hazard, resource and wonder objects are map fixtures, not hamlet buildings. `wonder_obelisk` has no defined dominion bonus, so it is cut.
- **Statuses.** No building added here needs a status to run, so the status work is empty. The sim applies no status in play (`combat.ts` is outside this round), and the 18c statuses the buildings name (`scorched` from fire on buildings) need a building-fire rule the hamlet does not have.

**Creeps (18e 1).**
- *Built.* Hubs now avoid civic building tiles when spreading (18e 8 edge 3; `civilTiles`). A hub dies when its tile stops being land (flooded or molten: 18e 1.5 and 8 edge 2) or has burned for `CREEP_BURN_TICKS` = 120 (6 s, 18e 1.5). Hub state is saved (above).
- *Cut or deviated.* The seeded pulse offset (18e 1.3 rule 1) is not applied: 18e acceptance test 1 says "after 8 s exactly 6 tiles", and the two conflict. The first pulse stays at 160 ticks. The being-level rules (18e 1.4: `growth_fever`, `sluggish`, `unnerved`, `giggling` on steppers, with immunity tags) are cut: species carry no immunity tags, and beings are outside this round. Gourd props (18e 1.7) are cut: there is no decor-structure layer. Acid on hub hp is cut: the hub has no hp model.

**Landmarks (18e 2).** New module `src/sim/settlements/landmarks.ts`, with the table in `src/content/creeps.ts` (`LANDMARKS`).
- `rime_pylon`: every 600 ticks, `freeze` every tile in a radius-8 disc (18e 2.1, strength as the freeze op). Being temperature (`changeBeingTemperature`) is cut.
- `ember_pylon`: every 600 ticks, `startFire` on each flammable tile in a radius-5 disc with chance 0.35 (draws from the `landmark` stream). Being heat is cut.
- `acid_font`: every 400 ticks, one acid drop 2..15 tiles away (`fallAcid` in `eruption.ts`, the acid vent rule).
- `insight_seed` and `lantern_spire`: placed and saved, but dormant. Lore growth and the night-fear rule are not built.
- `volcano_cone_small`: already built as the small vent (`startVolcano(small)`, 3x3 `molten_3`, 1200 to 3600 ticks), so no change. `volcano_cone` and the geyser entries were already in place. Vents are still not saved (existing gap).
- Beacon pillars (`spore_pillar`, `reason_pillar`, `gilded_pillar`, `chime_pillar`): placed and saved. The monster spawners they unlock (12 section 8.5) and the customs focus traits (11) are cut (powers and customs are outside this round).
- Placement is `placeStructure(sim, list, id, tile)`: checks the realm cap, a walkable land anchor, no other structure or live hub there, and turns a creep anchor to lowloam (18e 8 edge 5). **No power is wired.** The power dispatch is in `src/sim/powers`, outside this round, so no landmark or pillar can be placed from the power panel yet. The `lm_fire_vent`, `lm_hotspring`, `lm_acidspring` and `creep_*` powers keep working as before.
- Structures on a tile that stops being land are removed (18e 2.2).
- Footprints are recorded but only the anchor tile is used (1x2 pillars and 2x2 pylons occupy one tile in the sim). Cap per id (18e 2.1, 2.3). The insight seed's "one per hamlet" rule is not checked, only its realm cap of 12.

**Extended buildings (18e 3).** Restored 7: `quarry_lodge` built. The other six restored (`bastion`, `brazier_tower`, `slipway`, `arsenal`, `paddock`, `sea_lantern`) are cut: they need soldiers, boats, gear or mounts. Optional `EXT` 6 (`stargazer`, `hide_works`, `brewhouse`, `bake_oven`, `bee_shed`, `grove_lodge`) are not built: they are off by default (18e 3.2), and each needs an input not in the sim (Lore, armour crafting, a cheer resource, a hive or fruit trees). The task named `src/content/creeps.ts` for extended buildings; the building registry is `src/sim/settlements/catalogue.ts`, and the extended set was not added to either file, for the reasons above.

**Tests to update when testing resumes (not run).**
- Hamlet row shape: tests that compare `snapshot.hamlets` rows exactly need the new optional `tier` key.
- Hamlet snapshot shape: tests comparing `snapshotHamlets` output exactly need the optional `structures`, `hubs` and `creepGuard` keys.
- `tests/unit/terrain-creep.test.ts`: spread now skips civic building tiles (no test should be affected unless it places a hamlet on creep). Burn and flood death of hubs are new behaviour, with no test yet.
- `tests/unit/golden.test.ts`: the golden replay should be unchanged unless a hamlet reaches pop 60 with 15 buildings (the bazaar gate). Re-baseline only if it moves, and say so in the commit.
- `docs/spec-coverage.md` (outside the touch set) still shows 7 of 60 buildings and no jobs, trade, mood or roads.

**Open items.** M6 exit test (a hamlet grows to a town) unverified. Power wiring for landmarks and pillars. Vents and quakes not saved. Being-level creep effects and immunity tags. Hub proximity in hamlet mood. Garrison soldiers and gear, after a dominions round.

## Dominions and culture release

Scope: 10 dominions (tax, boats, rulers, forced pacts), 11 culture (call sites, names, families, banners) and 11 clans (splits, merges, renown, chief decisions, the 50-member limit). Code: `src/sim/dominions/` (`tax.ts` new; `adapter.ts`, `pacts.ts`, `intrigue.ts`, `types.ts`), `src/sim/culture/` (`names.ts` new; `culture.ts`, `adapter.ts`), `src/sim/clans/clans.ts`, the dominion, culture and clan sections of `src/sim/chronicle.ts`, `src/sim/snapshot.ts`, `src/shared/protocol.ts` (additive). Not run: tests, typecheck, build, Playwright (development-only instruction). GOLDEN_HASH untouched: `stateHash` covers neither dominions, culture nor clans, and all new draws use named streams or the name seed.

**Dominions (10)**

- **Tax, done up to the dominion.** `tax.ts`: `taxSplit` runs the spec chain: leader gets `floor(loot x local)`, ruler gets `floor(leader x tribute)`, the rest splits with the hamlet taking the smaller half (loot 100 at 0.5/0.5 gives 50, 25, 12 and 13). Rates come from traits (`highLocal`/`lowLocal`, `highTribute`/`lowTribute`, 0.7 or 0.2). Yearly, in `dominionsYearly`, the loot of a hamlet is the gold it gained since the last pass (`taxSeen`, keyed by the hamlet's lowest parcel). The ruler's share is added to `Dominion.taxRaised`. Substitutions: no ruler or hamlet-leader entity, so the hamlet stands in for its leader; money does not move, because hamlet gold belongs to the settlements slice (not writable from dominions). The receipt is a ledger only.
- **Boats (13): cut.** Boats need docks, which are settlements buildings (harbor, fishers_pier) with ocean-access tests, and a boat entity with passengers. Passengers are Beings, and dominions may not write Beings. The map's ocean pools are not reachable from dominion state without those. Army contact stays parcel adjacency.
- **Rulers as entities: cut, stand-in kept.** A ruler needs a Being with stats and age. Folk are never spawned (`spawnFolk` has no caller), so no Being can rule. `supremeOf` by strength and the opinion ruler stand-in (25) stay.
- **Forced pact: done.** `pacts.ts` `forcePact` makes a `kind: 'forced'` pact between two dominions in no pact (no timeout, no opinion gate, no formation stamp). `intrigue.ts` `dissolvePactOk` returns false for forced pacts (immune to the dissolve intrigue, as the spec says). The yearly clean-up still removes a forced pact whose members fight. Entry point: `forcePact(sim, a, b)` in `adapter.ts`. Not wired to a command: `sim.ts` `apply` is outside this release's file list, so the god tool cannot reach it in play yet.
- **Dominion traits.** `setDominionTraits(sim, id, traits)` validates names and removes opposites on add (11 section 11). No lineage defaults exist to apply them automatically.

**Culture (11)**

- **Call sites in play.** `cultureYearly` (called from the dominion yearly pass) gives each dominion one custom (`addCustom`, group = dominion id) and one `scheme` intrigue (`startIntrigue`) while none runs, gated by the `rituals` rule. Finished intrigues leave the list each year. The `scheme` has no effect: the culture intrigue resolves to success or failure without changing anything (the spec's intrigue engine and its effects are not built). `rebellion` is not started: its effect is the uprising of file 10, which is not built.
- **Families: call site wired, dormant in play.** `familiesScan` (every 10 s) records a family for a living Folk child whose parent and the parent's mate (the beings `mate` link, not a second parent field) are alive. Only Folk qualify, and Folk never spawn, so no family forms in play today. Family records (`FamilyRecord`: founders, members capped at `FAMILY_MAX` = 8, origin hamlet, name, banner) live in `CultureState.familyRecords`, saved in the culture payload only when present. Members are pruned when dead; a family with one member dissolves. The genealogy links (`families`) keep their old shape.
- **Name generator: done, reduced.** `names.ts`: hash-derived private stream (no sim RNG), recipe steps (pick, chain, any, lit, gap, seam, hyphen, digit, echo, reverse, again, erase, upper, with chance and prev-ends gates), retry to 100 tries, blacklist, title case, 30-char cap, 'Nameless' fallback. Recipes for custom, family and clan names. Cut: the sex gate (no sapient individuals), splice, swap and double (sound-shift source is the divide intrigue, not built), dictionary templates for campaign, pact, army and book names (file 10 and books not built). Clan names now come from this generator (the old prefix list is kept as the clan recipe), so clan names differ from earlier saves; the clan naming draw no longer touches the `clans` RNG stream.
- **Banners: indices only.** `BannerRef` holds background, icon and frame indices from the name seed (`BANNER_PARTS` = 8, TUNE). No art sets exist in the repo to resolve them, and an out-of-range index reads as 0 by spec. Dominion banners and colours are not added: they need the 64-colour palette allocation and a lineage, neither in dominion state.
- **Customs: name field.** `Custom.name` is set by `addCustom` when the context has a world seed (the culture context always has one now).
- **Trait catalogue.** The 47-entry custom trait list is still the stand-in `CUSTOM_TRAITS` (not the 11 section 9 catalogue).

**Clans (11)**

- **Splits: cut, as the spec says.** 11 section 2: "a clan never splits".
- **Merges: god tool.** `mergeClans(state, intoId, fromId, tick)`: the merged-away clan is stamped extinct at the merge tick (so snapshots show it as not living) with `mergedInto`, and its strains are counted by the target through `absorbed`. A strain merged in cannot found a clan again. Renown stays with the target. Refused when a clan is missing, merged or extinct, or when the combined living members would exceed the target's limit. No command path (same reason as `forcePact`).
- **Renown: done.** One renown per year the clan has a living chief, counted at each monthly scan (`renownTick` holds the year mark).
- **50-member limit: enforced at merge only.** Births are not refused, because a birth is a Beings decision and Beings are outside this release. The `limit` field (50) and the merge check are the enforcement; a clan that grows past 50 by births is reported as over the limit by its members count, not refused.
- **Chief decisions: cut.** `banishUnruly` and `killUnruly` read the clan traits `bloodPact` and `deathbound`, which are not in play. The chief is still re-picked each scan (oldest living member), as before.

**Persisted changes**

- Dominion section (chronicle tag 15, optional fields, no schema bump): per dominion `traits` (written when non-empty), `taxRaised` (written when above 0); section-level `taxSeen` (written when non-empty). `checkDominions` checks the list shapes; `restoreDominions` checks the values (trait names, non-negative receipts, parcel keys and gold).
- Culture section (tag 12): optional `familyRecords`, written only when present; `checkCulture` checks each record's id, name, founders, members, origin and banner. Custom `name` rides on the customs list, which is not shape-checked beyond being a list (the existing behaviour).
- Clan section (tag 18): `renown`, `renownTick`, `mergedInto`, `absorbed` on each clan. `restoreClans` treats them as optional (0, the founding tick, -1, none) so older saves load.
- Snapshot and protocol (additive, optional): `DominionRow.taxRaised`, `ClanRow.renown`, `ClanRow.mergedInto`.

**Not verified.** Nothing was run. Known risks to check when the suite is run: the clan name change (tests that pin clan names, if any); the `familiesScan` cost (a beings scan every 10 s); the new `culture` draws in dominion years (the culture stream now advances in dominion years, which changes culture state but not `stateHash`); and the circular import between `dominions/adapter.ts`, `culture/adapter.ts` and `settlements/adapter.ts` (only function-level use, no top-level reads, so it should load).

## Combat release

Scope: 08 combat (sections 2, 3, 5), 08 section 4 creature blasts, 12 section 8.6 bombs. Branch `worktree-agent-a9b0a08e42e5315ed`. Development instruction: code only, no tests, tsc, vitest, build or Playwright were run. `GOLDEN_HASH` is not edited.

Code: `src/sim/combat.ts` (applyDamage `cause`, on-hit modifiers, `predate`, `tickAttackTimers`, projectile landing hook), `src/sim/effects.ts` (`fire` and `cannotKill` fields, `ON_HIT_MODIFIERS`), `src/sim/projectiles.ts` (new: 16 kinds, creature blasts, launch, shoot step, landing), `src/sim/powers/handlers.ts` (`detonateBomb`, bomb and bolt cases), `src/content/powers.ts` (`BOMB_PROFILES` and the havoc bomb entries), `src/sim/sim.ts` (step wiring and weapon modifiers), `src/sim/beings/system.ts` (one call site: `eat_hunt` calls `predate`, plus the import).

- **Melee and bites.** `eat_hunt` adjacency calls `predate`: the claw swing (`meleeSwing`, reach 1, species might plus gear) when the attack timer is ready, then the bite `floor(0.15 * max vit) + 1` through `applyDamage` as type `Eaten`. A bite that kills passes cause `eaten`; a kill makes the predator `sated`. Fuel still gains the damage dealt.
- **Attack timer.** `combat.attackTimer` was never counted down, so a basic attack could fire once per being. It now counts down each tick (`tickAttackTimers`).
- **Window.** A claw swing that lands inside the prey's hit window (08 section 1, set by every damaging hit including bites) deals 0 and is wasted, so claws land only on the ticks the window is open. Bites come every 3 ticks, so claws rarely land on bitten prey. This follows 08 section 1 and is a balance point to check.
- **Folk.** The beings system has no Folk fight decision (Folk fight only through `eat_hunt`, if omnivorous with no food). Brawls (08 2.5) and army fights are not wired. Cut.
- **Projectiles.** Launched in play from worn ranged weapons (08 2.1 ranged basic attack, reach from item data, nearest prey of the shooter's species): `flint_dart` (bow, scatter gun), `arc_sphere` (energy blaster), `wail_skull` (bone-caller staff), `ember_orb` (ember staff), `rime_orb` (frost staff), `sap_orb` (thicket staff). Volleys are capped at 12, live projectiles at 256. Direct hit uses the shooter's might at launch, then the blast of the kind (creature profiles 08 section 4: flaskburst, torchflare, arcburst, blazeburst, frenzyburst, siegeburst, scatterblast, acidburst) and the ignite (`ember_orb`). Projectile flight is 2D at tiles per second, with no arc and no in-flight collisions (a hit is the target tile on arrival).
- **Projectile kinds cut from launch (10).** `snow_pellet`, `powder_flask`, `pitch_torch`, `knuckle_bone`, `blaze_sphere`, `frenzy_sphere`, `hurled_stone`, `scatter_shot`, `siege_ball`, `acid_glob`. Their owners are not built: `lob_pot` and `lob_brand` skills, towers, vessels, caster spells, the magmaling rage, slings and throwing. `scatter_shot` also has no launcher because the scatter gun's data names `flint_dart` (`src/content/items.ts`, not changed here). The blockable, stay-on-ground, freeze, shake and look-at flags of 08 section 3 have no mechanic and are not modelled. Acid drops are not modelled.
- **Statuses applied (10 of 24).** New in this release, with the source:
  - `scorched`: blast or fire profile in radius; `blaze` modifier (always, on hit).
  - `dazed`: force bombs and `frenzyburst`, `siegeburst` in radius (4 s); `concussive` modifier (20%).
  - `frenzy`: `frenzyburst` in radius (the Favour Grudge drop already applied it).
  - `rimebound`: `rime_touch` modifier (20%).
  - `sluggish`: `sluggish` modifier (20%).
  - `venomed`: `venomous` modifier (30%); periodic damage cannot kill (08 5.3). The 50% roll and the skinned gate are not modelled.
  - `sated`: a predator's kill.
  Earlier in the sim: `warded` (bless, Ward drop), `emboldened` (Vigour, Spark), `empowered` (Surge).
- **Statuses cut (14 of 24).** `bleeding` (no source; the bleed modifier does not exist), `rotting` (havoc_rot not built), `ash_sickness` (ash drops not built), `coughing` (havoc_pestilence not built; Favour cleanse still lists it), `numbed` and `blinded` (aquatic glowbell and inkreaver not built), `itchy` (no source), `taking_root` and `sprouting` (plant Beings not built), `bewildered` (no caster source), `lull` (no source), `expecting` and `sheltered` (set by mating and birth in the beings system, which is outside this change), `hexed` (curse drop not built; Favour unweave lists it).
- **Status periodic damage.** `scorched` damages as Fire (no plating, as 08 section 1); the rest stay Poison.
- **Not in the sim (32 of 56).** The spec's 56 roster ids include 32 with no definition in `effects.ts`. They are not added here.
- **Bombs (12 section 8.6).** In play: `havoc_bomb` (profile `blast`, r10 dmg100, force, random fire), `havoc_handcharge` (`spark`, r5 dmg50), `havoc_pitchfire` (r8 dmg40, Fire, fire on every tile), `havoc_sunburst` (r30 dmg10000, cover stripped, cooldown 2 s), `havoc_voidburst` (r30 dmg500, Ground to deepmere in r6, cooldown 3 s), `havoc_worldbreaker` (r70 dmg10000, cooldown 4 s), `havoc_urchin` (r6 dmg30 plus 12 shrapnel bombs of r3 on random tiles), `havoc_tidal` (r12, land to shoal). `havoc_bolt` runs profile `bolt_medium` (r2 dmg47 Other, fire on every tile). The id `havoc_bomb` keeps the power's existing id (the spec id is `havoc_charge`; the UI test looks for `havoc_bomb`).
- **Bomb rules.** Beings take the profile damage once each at full strength (no falloff, the 04 8.2 rule). Terrain as `explode`: cover and scar, sink for radius 2 and up, fire by the profile (`random` uses 0.5 times the falloff). Water is skipped as in `explode`. The guard is taken once per bomb and once per shrapnel.
- **Bomb cuts (4 of 12).** `havoc_powder`, `havoc_timed`, `havoc_hidden` (device grounds need the explodeChain trigger, timers and step-on detection of 04 8.4, which are not built) and `havoc_sparkler` (festive glimmer has no sim effect). Not modelled: the 0.9 s drop, sunburst flash and high-flyer hits, wasteland as a ground (cover and scar only), the water soak of 0.5, and the bomb counter at launch.
- **Golden.** `GOLDEN_HASH` (`tests/unit/golden.test.ts`) is not edited and will not match: `eat_hunt` now draws the `combat` stream and counts attack timers down, and the content hash changes with the bomb entries. Re-baseline with a run.
- **Save format.** Projectiles gain optional fields (`kind`, `shooter`, `mods`, `blast`, `ignite`). Older saves load with them absent; the chronicle check is unchanged.
