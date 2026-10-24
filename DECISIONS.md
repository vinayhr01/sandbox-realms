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
| Combat and statuses | 24 status definitions (spec roster 56). No status is applied in play. `meleeSwing` has no caller. |
| Settlements, dominions, culture | Hamlets run (6 buildings). Dominions and culture are inert in play: `addDominion`, `addCustom`, `startIntrigue`, `addFamily` have no caller outside tests. |
| Powers | 138 entries; all 138 enabled in the UI (`powerStatus`); 122 dispatch to real sim code (not recounted in this pass). Favour has one power (Bless, `favour_bless`) and Insight has one (Lore, `insight_lore`); the rest of those tabs is not built. |
| Rules, ages, calamities | 49 rules (about 18 never read), 11 ages, 16 calamities rolled every 80 ticks. |
| UI | `WINDOW_CATALOG` has 74 entries: 62 of 62 spec window rows built (the nine `win_customize_*` ids are one row), plus 4 extras. Options: 75 settings (72 spec 13 rows and 3 spec 16 audio rows), saved to localStorage; 25 rows are flagged `live` (the older "about 44" figure was not reproduced). Tutorial 4 steps. Edge pan, pinch and wheel zoom. Long-press, undo and minimap missing. |
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
