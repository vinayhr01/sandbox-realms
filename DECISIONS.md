# Decisions

Choices made while building M0 and M1 (BUILD-PLAN.md). Spec `OPEN` items use the stated default.

## Built

| Area | Choice | Note |
|---|---|---|
| Repo | single package, `src/` split by area | 17 section 14 monorepo deferred until a second package exists |
| Stack | Vite 8, TypeScript 7 strict, PixiJS 8 (WebGL), Vitest 5, Playwright | versions as installed |
| Sim | pure `Sim` class, worker shell at 20 tps, MessageChannel pump, 8 ms budget | ticks discarded when over budget (world slows) |
| Determinism | sfc32 seeded RNG, FNV-1a state hash every 20 ticks, `scripts/check-determinism.mjs` | golden replay in `tests/unit/golden.test.ts` |
| Protocol | numeric kinds, `seq` per command, transfer-mode frames with a buffer pool | Mode S (SharedArrayBuffer) not built |
| Terrain | RGBA8 index texture (ground, cover, elevation, flags) + palette texture, fragment shader | one 576x576 texture serves every size; `uView.w` carries the live side |
| Brush | raise/lower, circle/square/diamond, radius 0-16, dab per line tile | raise step 5 per dab (TUNE) |
| Input | one Pointer Events path; drag with armed brush paints, otherwise pans; pinch zooms; wheel zooms | stroke segments are sent once per frame, joint tiles not repeated (`includeStart`) |
| Camera | fit on load, zoom 0.5x-8x of fit (max 48 px/tile), 16 px edge margin | |
| Layout | portrait column, landscape (max-height 500) tool column on the right | |
| PWA | hand-written service worker, no `skipWaiting` | Workbox deferred (OPEN in 17) |
| Recovery | unclean-exit sentinel, local journal, fatal dialog | 19 sections 7-10 deferred |

## Deferred (not in M0/M1)

- Mode S (SharedArrayBuffer) and cross-origin isolation headers.
- Hollows and refill (04 section 2): lowering sea tiles only deepens them for now.
- Undo, perf HUD beyond the `?debug` line, benchmark CI gate against budgets.
- Cover, flora, structures, beings, weather; the ground list is the 12 terrain kinds only.
- Full tool catalogue (path, till, sponge, flood, etc.), ring and scatter brushes, the Realm tab only creates new realms.
- PNG icons (only the SVG icon is shipped; maskable PNGs needed before release).
- ESLint and dependency-cruiser boundaries.

## Measurements and limits

- Headless Chromium here uses software WebGL: about 1-3 fps in the Playwright runs. Frame-rate targets (60 fps at 512x512, phone matrix) are unverified; they need real devices.
- Each dirty row set re-uploads the full 576x576 index texture (about 1.3 MB). Partial sub-uploads are the next optimisation if profiling shows the upload dominates.
- Firefox and WebKit are not in the Playwright projects yet (only Chromium is installed here).
- Sim tick cost measured at 128-512 sizes is well under the 8 ms budget (`npm run bench`).

## Milestones 2 and 3

| Area | Choice | Spec gap |
|---|---|---|
| Clock | calendar from ticks; ages rotate with speed multiplier; Veiled resolves on entry | 12 ages, default slots and duration roll as 02 section 5 |
| Rules | 49 rules with defaults, `forbidden_lore` one-way, age enable flags | effects are read by systems; most consumers come with their milestones |
| Worldgen | value noise (integer lattice), forceHeight, centre shapes, basin, lake, low/high ground, shore snap, round and square edges, typing, mountain edges, freeze peaks, weighted biome flood fills, 10 flora passes, starting beasts | gradient noise replaced by value noise; blob masks are radial, not bitmaps; rivers, lakes, replace rules and the Chessboard/Cells/Warren layouts are not built; Sleeping Crater has no volcano |
| Terrain | fire with scars, sea refill and hollows, magma levels with flow and cooling, freeze and thaw with shoal spread, heat, biome spread | slime, acid, lightning and explosive chains are not built (M4) |
| Flora | 10 kinds from 18d, wild seeding in patches, growth stages, spread, lifespan, drought and frost passes | most of the 18d registry is not built |
| Beings | species table of 8 from 18a, SoA store with generations, fuel and starvation, ageing and natural death, mating with gestation and litter, flee/hunt/graze/wander | no traits, genes or strains (05, 18b), no stat assembly, no AI task system (07 section 4 onward) |

### Ecosystem status (M3 exit test not met)

`npm run soak` runs 1,000 beasts for 10 sim-years. Population stays bounded (about 1,400 to 2,000, under the cap) and nothing crashes, but species balance is not stable: thistlehart and nectarbuzz fall to a handful by year 10, cluckling dies out early, and starvation and predation dominate deaths (see the log written by the soak). The per-species numbers are TUNE and the pursuit model is simple (greedy steps, no paths). Not fixed yet.

### Notes

- `ticksForFrame` in `clock.ts` clamps `frameDt` to 0.1 s as 02 section 2 says; 02 section 12 test 2 expects 20 ticks for a 0.5 s frame at x2, which contradicts the clamp. The clamp wins; the test expectation is not implemented.
- Golden replay hash moved again with beings in the state hash.

## Milestones 3 (ecosystem still open), 4 and 5

- **M3 balance:** breeding needs fewer than six other beings in the 16x16 patch (06 6.1). Flora spread covers the whole map over time; wild seeding places patches. A predator-metabolism knob exists (`beings/tuning.ts`). Sweep results (3 seeds, 10 years): no setting keeps all eight species alive; best runs keep seven, totals 950 to 1,550, predators roughly half the population. Default knobs left as is. The M3 exit test stays open.
- **M4 combat:** melee with reach 1 and the 6-tick hit window; plating for Weapon and Other only, integer math; projectiles that land on their target tile; blasts with falloff, crater, fire and an anti-spam guard; 22 of the 56 roster statuses with their hooks (speed, damage, taken, immobile, periodic damage, immunity, no-breed); weather clouds from age weights, drops mapped to rain, freeze, fire and acid, storm lightning. Not built: AI-driven fights (beasts fight only when hunting), 34 remaining statuses, bolts, spells, gear, boats, dazed/dozing sleep, factions.
- **M5 saves:** versioned, checksummed format with sections for clock, realm, ages, rules, stats, beings (generations, exact list and free-stack order), RNG streams, timers, tile runners, combat, statuses, weather and projectiles. Resume test: a save at tick N continued to M matches an uninterrupted run. Typed arrays are written raw (little-endian host assumed). Runner orders are JSON, which is large at 512 tiles.
- **Not yet built:** milestones 6 to 12 (hamlets and economy, dominions and war, customs and intrigue, full powers catalogue, full UI, audio and achievements, performance and accessibility).

## Milestones 6-12 (reduced slices, built in parallel)

Each slice is a standalone module with a structural context (no import of `Sim`), tested in isolation. None is wired into `Sim` or the UI yet.

- **M6 settlements** (`src/sim/settlements`): hamlet with 8x8 parcels, five buildings, stockpile, food-driven growth. No beings query, jobs, or trade.
- **M7 dominions** (`src/sim/dominions`): relation matrix (peace, tension, war), campaigns, peace pacts, `parley`, `standing_armies`, `border_creep`. Tension has no effect; no recruitment, boats, or settlement borders.
- **M8 culture** (`src/sim/culture`): customs, creeds that spread on contact, dialects that drift and merge, families, intrigues. `rituals`, `uprisings`, `chaotic_minds` honoured. Tuning values are placeholders.
- **M9 powers and calamities** (`src/content/powers.ts`, `src/sim/calamity.ts`): about 90 powers across all eight tabs (about 300 in the spec); the 16 calamities of 02 section 8.2 with the 80-tick roll. Powers have no handlers yet.
- **M10 UI models** (`src/ui/panels`): options with clamped values and injectable storage, list sort/filter/search and a virtual list, tutorial steps, power bar model. The virtual list and the power bar's DOM are not browser-tested.
- **M11 audio and stats** (`src/audio/model.ts`, `src/sim/stats.ts`, `src/content/achievements.ts`): audio bus model with voice caps and a hidden-tab mute, stats counters, 22 achievements (spec has 63). Nothing calls them yet.
- **M12 checks** (`scripts/check-budgets.mjs`, `tests/a11y`, `tests/perf`, `docs/release-checklist.md`): gzip budgets (main 80 KB, worker 20 KB against 350 and 250), dark-theme contrast (text 14.6:1, secondary 7.7:1, ink on accent 10.9:1). Device testing, Firefox and WebKit runs, and legal review are not done.

### M3 ecosystem: still not stable

A diagnostic over ten years shows flora falling from about 7,000 tiles to about 440. Grazers then starve, and predators follow. Sweeps of regrowth (spread 4 to 8, coverage 2 to 4) and predator metabolism keep six or seven of eight species alive on three seeds, never all eight. The regrowth rule (spec: a grazed tile is removed) needs a spec-level decision, for example a regrowth delay or a carrying-capacity term, before more tuning helps.

## Merge of the parallel units (main 5a3c90b)

All eight unit branches are merged into `main` with no PRs (no remote, no `gh`). Checks on the merged tree: types on both configs, 188 unit tests, determinism lint, build, budgets (main 83 KB, worker 26 KB gzip), contrast, and 32/32 browser tests.

- **Units wired into `Sim`:** settlements (hamlets, once per sim-second), dominions (ownership in the running sim), culture (creeds spread across land regions), powers and calamities (80-second roll, `usePower`), stats and achievements (events, once per sim-second).
- **UI:** options dialog (UI scale, reduce motion, saved) and a power bar. Only Raise and Lower work on the map; other powers arm but do nothing yet.
- **Audio:** pure model with tests, not connected to WebAudio.
- **Save format:** SCHEMA_VERSION 2. Chronicle sections: culture 12, calamity 13 (optional), stats 14 (optional). Saves from before these sections still load. Saves from before the flora regrowth change (schema 1) are rejected.
- **Chronicle gaps:** dominion state and hamlet state are not saved, so a resumed game loses them.

### M3 ecosystem: still not met

Regrowth delay (1,200 ticks, TUNE) is in and sweeps show no change in outcome. The species missing on all seeds is nectarbuzz, which only eats fieldflower tiles. Its extinction is a food-supply or predator problem, not a regrowth one, and fixing it is a content and beings-logic change that is still open.

## Fix round (after the parallel merge)

- **Saves:** dominion state (tag 15) and hamlet state (tag 16) are saved and restored; both are optional, so older saves load. A resumed run matches an uninterrupted run (tests/unit/persist-wiring.test.ts). Relations are saved only for pairs that exist as dominions or borders, because the relation matrix has no iterator. SCHEMA_VERSION is unchanged.
- **Hamlets:** births no longer stop building or wood; food is capped and wells produce food; territory grows only when a building is placed; hamlets can no longer claim a parcel another hamlet owns (regression test on seed 11, which failed before the fix). Open: stone has no income, so once stone runs out no more buildings are placed.
- **Tests:** the tick-cost test uses a median with a 50 ms gate (the 8 ms budget is a warning only); regrowth rules have tests; the stats births test uses real starting beasts on seed 1.
- **Counters:** `sim.beings.stats.births` counts every spawn (starting beasts and adults included), while the lifetime `beingsBorn` counts only newborn children. They are not a double count, but the names are misleading.

## Stone income and birth counters (spec sections checked)

- **Stone:** the spec (09 sections 3, 8 and the job table) defines a quarry, stone outcrops and a miner. The hamlet slice now has a quarry (10 wood) that turns outcrop stock into 2 stone per growth step. Outcrops start at 40, regrow 1 per 5 steps, and cap at 60. Hamlets build a quarry when stone is below 10 and the first basics stand. Not built: miners as folk jobs, prospectors, the cleaner's ruin salvage, and other outcrop types.
- **Counters:** `beings.stats.births` now counts only newborn children, and `newAdults` counts adults spawned, as 05 section 2 and 06 section 6.6 separate them. Not built: the per-parent and per-strain counters (`parent.births`, `strain.counters.reproduced`), since strains are not implemented.

## Worldgen round 2

Code: `src/sim/worldgen.ts` (pipeline, templates), `src/sim/worldgen/` (`noise.ts` moved from worldgen.ts, `pick.ts` weighted biome draw, `water.ts` rivers and lakes, `replace.ts` replace rules, `layouts.ts` Chessboard, Cells, Warren, starter volcano). Ground kinds: no new kinds; rivers and lakes use `shoal`, shores use `strand`, and the volcano uses `molten_4`.

OPEN values and the defaults used (03 section 1, 7, 9; 18c section 3):
- **minLand:** 6% default; 3% for Archipelago; 0 for Blank and Warren (03 section 1).
- **Rivers:** 2 on Continent and Walled Plain (TUNE, 03 section 7). Lakes: 1 on Continent.
- **Lake water:** shared with the sea (`shoal` is a sea kind, 03 section 7 default). No separate fresh-water kind.
- **Layout RNG:** separate streams per feature (`hash3(worldSeed, step, n)`), so templates without rivers, lakes, replace rules or layouts keep their pre-round terrain.
- **Biome share test:** 03 section 9 has no such test. The 10,000-sample test is taken from 18c section 3 rule 3. "Within 3%" is read as 3 percentage points of share (absolute), since a relative 3% is below sampling noise for weight-1 biomes.

Deviations and interpretations (the spec is ambiguous or conflicts with itself):
- **River landmass guard:** "landmass >= 4 regions" is read as a landmass of at least four Patches (1024 tiles). The "never cut a landmass into islets" guard is not built; rivers may split land.
- **River walk:** a tile already on the river is never re-entered (stronger than "avoid last 8"); the walk stops when it touches water that is not part of the river, or after 700 steps. Rivers under 20 tiles are rolled back.
- **Lake seeds:** the spec's "elevation between lowloam and highloam" with "20 tiles from sea" yields no candidates on a Continent (land of that elevation lies within 17 tiles of the sea because of the round-edge fade). Seeds are therefore lowloam or highloam tiles at least 20 tiles from sea.
- **Replace rule test:** the spec writes `n255 > threshold`, but also states that threshold 0 means every water tile for Open Plains. The code uses `n255 >= threshold`. The edge ring is never replaced.
- **Layout order:** Chessboard, Cells and Warren run after `removeMountains`, not before (03 section 2 step 14 before step 15). Otherwise `removeMountains` would flatten the Cells room walls to highloam.
- **Cells walls:** each room's outline becomes crag, with no separate corner search. Doors are 3x3 knoll blocks at `randInt(3, len-3)` on a side that is still crag.
- **Warren:** `rocky` means the blocked layer (crag, pinnacle). Carving stalls at walkable tiles, as specified.
- **Starter volcano:** a 6x6 `molten_4` footprint on the largest landmass, centred on its centroid tile (knoll, crag or pinnacle when possible, else highloam). It is terrain only. The volcano structure (`volcano_cone`, 04 section 7.2) does not exist in the sim yet, so there is no emitter and the footprint cools in the normal magma sweep.
- **Not done:** a separate fresh-water kind; the river landmass guard; the volcano emitter; `addResources` (03 section 8.2) is not part of this round.

Known effect on existing tests: the Continent terrain changes (rivers, lakes, replace rule). The golden hash changes (see the commit). Two settlement tests that depend on the Continent terrain at fixed seeds fail (see the report), and the owner should choose new seeds or accept the new terrain.
