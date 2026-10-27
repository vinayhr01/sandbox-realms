# Map Graphics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smooth, zoom-detailed terrain and illustrated, realistically walking creatures and buildings, with no performance hit a player would notice.

**Architecture:**
- **Creature feed:** a new per-frame typed-array feed (worker → main) replaces the 96-cap, 2-second snapshot as the source of map positions.
- **Creature layer:** a pooled sprite layer interpolates that feed and draws walk-cycle frames, baked from rigged SVGs into atlas pages.
- **Terrain:** the existing terrain shader gains bilinear blending and procedural detail that fades in with zoom.

**Tech Stack:** TypeScript 7.0.2 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), PixiJS 8.22.0 (WebGL2), Vite 8 (`?raw` imports, dynamic `import()`), Vitest 5.0.5 (jsdom for DOM tests), Playwright 1.64.1 (Chromium).

**Spec:** `docs/superpowers/specs/2026-10-27-map-graphics-design.md` (owner approved 2026-10-27). Read it before any task.

## Global Constraints

- **Determinism:** no sim rule, RNG stream or saved field changes. `GOLDEN_HASH` stays 1357125849, and `node scripts/check-determinism.mjs` passes. The feed reads sim state only.
- **No new dependencies:** no new runtime or dev dependencies, and no raster image assets. All art is SVG in `src/art/`.
- **Budgets:** main bundle at most 350 KB gzip, and it may grow by at most 20 KB over today's 188 KB. Worker bundle at most 250 KB gzip. Each art chunk at most 40 KB gzip, and all art together at most 250 KB gzip.
- **Performance gate:** with 3,000 creatures at 10× speed and medium zoom, P95 frame time must be at most 20 ms on desktop-chromium in CI.
- **Zoom:** `MAX_ZOOM_PX` = 96, with no 24 px floor. Far/near switch at about 4 px per tile. Medium terrain detail fades in over 8–16 px per tile and close detail over 32–64 px per tile. 128 px frames are used from about 48 px per tile, and 48 px frames below that.
- **SVG format:**
  - Canvas: `viewBox="0 0 128 128"`, feet on y = 120, facing left.
  - Animated parts: `<g id="…" data-pivot="x y">`, with part ids taken from the gait family's vocabulary in `src/art/gaits.ts`.
  - Style B: gradient fills, an outline of about 1.5 px in a darker tint (never pure black), eyes with a highlight, and visible nose, mouth and paws, hooves, claws or talons. No drop shadow inside the SVG.
- **Commits:** each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use `git add` on named paths only.
- **Execution:**
  - Code tasks run on Haiku 5.5 implementers (owner preference).
  - Art tasks (Tasks 8–9) run on the session model, because art quality is the review gate.
  - Owner review gates are marked **OWNER GATE**. Stop there and wait.

## Review Focus

1. **Slot reuse:** a being dies and its slot is reused within one feed. It must not glide from the dead being's spot. Key on slot plus generation. Test in Task 2.
2. **Hidden tab or long stall:** the tab is hidden, or the main thread stalls for seconds. On resume, creatures snap to place instead of sliding across the map. Test in Task 2.
3. **New world, load or worker restart:** after a new world, a load or a worker restart, no sprite from the old world survives, and interpolation restarts from the first feed. Test in Task 3.
4. **Follow and possess:** following or possessing a being outside the old 96 sample keeps working. The camera reads the feed. Test in Task 3.
5. **WebGL context loss:** after a lost and restored WebGL context, or an atlas page eviction, baked atlases rebuild, and creatures show their dot or static fallback until then. Test in Task 7.

---

### Task 1: Being feed: format, worker publish

**Files:**
- Create: `src/shared/being-feed.ts`
- Modify: `src/shared/protocol.ts` (add `Ev.Beings` and its event type), `src/sim/worker.ts` (post the feed in `publishFrame`), `src/sim/snapshot.ts` (export `allBuildingsOf`, the uncapped twin of `mapBuildingsOf`)
- Test: `tests/unit/being-feed.test.ts`

**Interfaces:**
- **Produces:**
  - Constants: `export const enum BeingState { Idle = 0, Walk = 1, Run = 2, Swim = 3, Sleep = 4, Hit = 5 }`, and `export const FEED_STRIDE = 6`, the number of Uint16 words per being: `slot`, `generation & 0xffff`, `x`, `y`, `species`, `state | child << 8`.
  - `export interface BeingFeed { tick: number; count: number; data: Uint16Array; buildings: MapBuilding[] | null; boats: MapBoat[] }`. `buildings` is null when unchanged since the last feed.
  - `export function encodeBeings(sim: Sim, out: Uint16Array): number`. Returns the count written. `state` is derived:
    - Sleep when `store.sleepUntil[slot] > tick`.
    - Hit when `combat.hitUntil[slot] > tick`.
    - Swim when `GROUNDS[realm.ground[i]].sea`.
    - Otherwise Walk when the position changed since the last call (keep a module-level `Uint16Array` of last x and y), else Idle.
    - Run when it moved at least 2 tiles since the last call.
    - `child` = `store.baby[slot] ? 1 : 0`.
  - `export function readBeing(feed: BeingFeed, i: number): { slot; gen; x; y; species; state; child }`.
  - `Ev.Beings` event: `{ kind: Ev.Beings; feed: BeingFeed }`. Its `data.buffer` is transferred.
- **Rate:** posted from `publishFrame` once per call, after the `Ev.Frame` post, so it follows the frame pump, not sim ticks. Buildings are included only when a hamlet version or count changed; reuse whatever version counter the settlements adapter exposes, else hash the building list length plus ids.

- [ ] **Step 1: Write the failing tests** in `tests/unit/being-feed.test.ts`:
  - `encodes every living being`: spawn 3 beings in a `new Sim(1, 1)`. `encodeBeings` returns 3, and `readBeing` gives back the spawn x, y and species.
  - `slot reuse changes generation`: kill a slot, respawn into it. The `gen` read differs.
  - `state flags`: set `sleepUntil` to tick + 10, and the state is `Sleep`. Set `combat.hitUntil`, and the state is `Hit`. Place a being on `G.deepmere`, and the state is `Swim`.
  - `walk and run from movement`: encode, move x by 1, encode again, and the state is `Walk`. Move by 3, and the state is `Run`.
  - `does not touch the state hash`: `sim.stateHash()` is the same before and after `encodeBeings`.
- [ ] **Step 2:** Run `npx --no-install vitest run tests/unit/being-feed.test.ts` and expect FAIL (module missing).
- [ ] **Step 3:** Implement `being-feed.ts`, the protocol additions and the worker post. Reuse one pooled `ArrayBuffer`, the same way the worker's `takeBuffer` pools rows. The main thread returns it via `client.returnBuffer`.
- [ ] **Step 4:** Run the test plus `tests/unit/golden.test.ts`. All PASS.
- [ ] **Step 5:** Commit: `feat(render): per-frame being feed from the worker`.

### Task 2: Feed interpolation

**Files:**
- Create: `src/render/feed-interp.ts`
- Test: `tests/unit/feed-interp.test.ts`

**Interfaces:**
- **Consumes:** `BeingFeed` and `readBeing` (Task 1).
- **Produces:**
  - `export interface DrawBeing { key: number; x: number; y: number; species: number; state: BeingState; child: boolean; facing: -1 | 1; alpha: number; moved: number }`. `key` = `slot << 16 | gen`, and `moved` = tiles travelled since the previous feed.
  - `export class FeedInterp { push(feed: BeingFeed, nowMs: number): void; sample(nowMs: number, out: DrawBeing[]): number; reset(): void }`.
  - Constants: `SNAP_TILES = 3`, `MAX_GAP_MS = 500`, `FADE_MS = 400`.
  - Behaviour:
    - Positions are lerped between the previous and current feeds by `(now - tCurr) / (tCurr - tPrev)`, clamped to the range 0 to 1.
    - A key that is new, or that moved more than `SNAP_TILES`, snaps.
    - If `tCurr - tPrev > MAX_GAP_MS`, everything snaps.
    - A key missing from the current feed is kept at its last position with alpha falling from 1 to 0 over `FADE_MS`, then dropped.
    - `facing` comes from the sign of the x delta, and is kept when the delta is 0.

- [ ] **Step 1: Write the failing tests:**
  - `lerps halfway`: feed A at t=0 with x=10, feed B at t=100 with x=11. Sampling at t=150 gives x=10.5.
  - `snaps on big jump`: x goes from 10 to 20, and the sample gives 20.
  - `slot reuse snaps` (Review Focus 1): same slot, new generation, and the position snaps with no lerp.
  - `long gap snaps` (Review Focus 2): feeds 2,000 ms apart give the latest position.
  - `missing being fades`: it is absent in feed C. Alpha is 0.5 at `FADE_MS / 2` and gone after `FADE_MS`.
  - `facing`: facing is -1 when x decreases, and is kept at -1 when idle.
  - `reset clears`: after `reset()`, sample returns 0.
- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement with a `Map<number, …>` keyed by `key`. Reuse the objects in `out`, so a frame does not allocate them.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit: `feat(render): interpolate the being feed`.

### Task 3: Creature layer v1 (current shapes, world scale, LOD)

**Files:**
- Create: `src/render/creatures.ts`
- Modify:
  - `src/render/camera.ts`: `MAX_ZOOM_PX` = 96; `maxZoom` becomes `Math.min(this.fitZoom * MAX_FACTOR, MAX_ZOOM_PX)` with the 24 floor removed.
  - `src/render/marks.ts`: stop drawing beings, buildings and boats. Keep items, armies, nameplates and the rest.
  - `src/app/main.ts`: handle `Ev.Beings` by calling `interp.push`, `creatures.setBuildings(feed.buildings)` when it is non-null and `creatures.setBoats(feed.boats)`, return the buffer, and call `creatures.draw` in `onFrame`. Follow and possess read the interp sample instead of `simView.current.mapPoints`. Call `interp.reset()` and `creatures.clear()` on new world, load and worker restart.
- Test: `tests/unit/creatures-lod.test.ts`, `tests/e2e/creatures.spec.ts`

**Interfaces:**
- **Consumes:** `FeedInterp`, `DrawBeing` (Task 2), `SpriteFactory.being(group, size)` from `src/render/sprites.ts`, and `SPECIES` for group and size by species index.
- **Produces:**
  - `export class CreatureLayer { constructor(app: Application); draw(beings: readonly DrawBeing[], count: number, view: MarkView, nowMs: number): void; setBuildings(list: MapBuilding[]): void; setBoats(list: MapBoat[]): void; clear(): void; setFrameSource(src: FrameSource | null): void }`.
  - `export interface FrameSource { frame(species: number, gait: string, frameIndex: number, px: 48 | 128): Texture | null }` (`gait` is a `GaitId` from Task 5, typed as string here so Task 3 does not depend on Task 5). Task 7 implements it. Until then it is null, and the layer uses the group shapes.
  - `export function lodOf(zoomPx: number): { dots: number; icons: number }`: weights in the range 0 to 1, crossing between 3 and 5 px per tile.
  - `export function worldHeightPx(size: SizeClass, zoomPx: number, child: boolean): number`: size-class tiles × zoom (T 0.5, S 0.7, M 1.0, L 1.4, H 2.0, C 3.0 tiles), × 0.6 when `child`.
- **Behaviour:**
  - Sprites are pooled. Only beings inside the view plus a 2-tile margin are placed.
  - Far mode is a single `Graphics` of group-coloured dots (`GROUP_COLOUR`).
  - `scale.x = facing`. Alpha follows `DrawBeing.alpha`.
  - The shadow is one shared ellipse texture, drawn in a child container below the sprites. It is hidden when the `map.shadows` setting is off.

- [ ] **Step 1: Write the failing unit tests:**
  - `lodOf(2)` gives dots 1 and icons 0. `lodOf(8)` gives dots 0 and icons 1. `lodOf(4)` gives both strictly between 0 and 1.
  - `worldHeightPx('M', 20, false) === 20` and `worldHeightPx('C', 20, true) === 36`.
- [ ] **Step 2: Write `tests/e2e/creatures.spec.ts`:**
  - `more than 96 beings are drawn`: spawn 200 via the power bar's Creatures tab (or a dev hook if the existing e2e helpers have one). Zoom to the max. Read `window.__sr?.creatureCount` (expose it in dev and test builds only, the way other e2e hooks are exposed; grep `__sr` or the existing test hook name), and expect more than 96.
  - `new world clears creatures` (Review Focus 3): after New World, the count is 0 until the first feed arrives.
  - `follow a being beyond the old sample` (Review Focus 4): follow the 150th spawned being. After 3 s, the status does not contain "Lost sight".
- [ ] **Step 3:** Run the tests and expect FAIL.
- [ ] **Step 4:** Implement `creatures.ts`, then the camera, marks and main.ts changes.
- [ ] **Step 5:** Run the unit tests, `npm run build`, and then `npx --no-install playwright test tests/e2e/creatures.spec.ts tests/e2e/smoke.spec.ts tests/e2e/panels.spec.ts --project=desktop-chromium --workers=1`. Expect PASS.
- [ ] **Step 6:** Commit: `feat(render): creature layer from the being feed, world-scale sizes, zoom LOD`.

### Task 4: Terrain shader: smooth blend and zoom detail

**Files:**
- Modify: `src/render/terrain-shader.ts` (`TERRAIN_FRAG`), `src/render/terrain.ts` (a `uTime` uniform in seconds, updated per frame; the detail weights below as a `uDetail` vec2)
- Create: `src/render/terrain-detail.ts`
- Test: `tests/unit/terrain-detail.test.ts`, extend `tests/e2e/smoke.spec.ts`

**Interfaces:**
- **Produces:** `export function detailWeights(zoomPx: number): { medium: number; close: number }`. It is a smoothstep from 0 to 1 over 8–16 px per tile for medium, and over 32–64 px per tile for close. The shader receives these values; the shader does no threshold maths itself.
- **Shader requirements** (spec D):
  - **Bilinear blend:** blend the colours of the 4 nearest tile centres, but only between tiles of the same layer. Water and land are told apart by the palette alpha bit or a second palette row (the builder picks). At a coast, add a foam band.
  - **Elevation:** interpolated elevation feeds the hillshade.
  - **Depth tint:** applies to the `sea` grounds.
  - **Medium detail:** grass speckle, rock noise, ripples animated by `uTime`, and contour lines.
  - **Close detail:** tufts, pebbles and wave crests.
  - **Noise:** hash value noise, at most 3 octaves.
  - **Unchanged:** the brush outline. Grid lines draw only when `uDetail.y < 0.5`.

- [ ] **Step 1: Write the failing tests:**
  - `detailWeights(4)` gives `{medium: 0, close: 0}`.
  - `detailWeights(12)` gives medium strictly between 0 and 1.
  - `detailWeights(96)` gives `{medium: 1, close: 1}`.
- [ ] **Step 2:** Run the tests and expect FAIL. Implement `terrain-detail.ts`, then run again and expect PASS.
- [ ] **Step 3: Extend smoke.spec.ts:**
  - `terrain shader compiles at all zoom levels`: zoom to the min, to 12 px and to the max with the wheel. There must be no console error containing `shader` or `WebGL`, and a canvas pixel read at the centre must not be the `BACKDROP` colour.
- [ ] **Step 4:** Implement the shader and uniform changes. Check by eye in the browser pane at 4, 12 and 64 px per tile against the mockup screens in `.superpowers/brainstorm/*/content/terrain-style.html`.
- [ ] **Step 5:** Run `npm run build`, smoke.spec on desktop-chromium and phone-portrait, and `npx --no-install vitest run`. Expect PASS.
- [ ] **Step 6:** Commit: `feat(render): smooth terrain blend with zoom-faded detail`.

### Task 5: Gait table and animation maths

**Files:**
- Create: `src/art/gaits.ts`, `src/render/anim.ts`
- Test: `tests/unit/gaits.test.ts`, `tests/unit/anim.test.ts`

**Interfaces:**
- **Produces:**
  - `export type GaitId = 'quad' | 'biped' | 'bird' | 'flyer' | 'fish' | 'insect' | 'snake' | 'hover' | 'crab' | 'tentacle' | 'pulse' | 'squish' | 'undulate' | 'waddle' | 'static'`.
  - `export interface GaitDef { parts: readonly string[]; frames: { idle: number; walk: number; run: number }; pose(part: string, phase: number, mode: 'idle' | 'walk' | 'run'): { rot: number; dx: number; dy: number } }`. `phase` is in the range 0 to 1, and `rot` is in degrees around the part's `data-pivot`.
  - `export const GAITS: Record<GaitId, GaitDef>`. The part vocabularies are the spec's C list plus `leg-ml`/`leg-mr` (insect middle legs), `claw-l`/`claw-r` (crab), `tent-1..8` (tentacle), `bell` (pulse) and `cap` (waddle).
  - `export interface SpeciesGait { land: GaitId; water: GaitId | null; air: GaitId | null; strideTiles: number }` and `export const SPECIES_GAIT: Record<string, SpeciesGait>`, keyed by species id, all 90 entries. Choose from each species' anatomy (its plain name is in `src/content/plain-names.ts`). Examples: thistlehart (Deer) is quad with stride 0.6; stormwyrm (Dragon) is quad on land with air flyer; a crocodile-type is quad with water undulate.
  - In `anim.ts`:
    - `export function gaitFor(sp: SpeciesGait, state: BeingState): { gait: GaitId; run: boolean }`. Swim uses `water ?? land`. Flyers use `air` while moving. Run when the state is Run.
    - `export function frameIndex(phase: number, frames: number): number`.
    - `export function advancePhase(phase: number, movedTiles: number, strideTiles: number, dtMs: number): number`. The phase advance is `movedTiles / strideTiles`, capped at `MAX_STRIDES_PER_S = 3` × dt.
    - `export const RUN_SCREEN_TILES_PER_S = 4`.

- [ ] **Step 1: Write the failing tests:**
  - **Coverage:** every `SPECIES` id has a `SPECIES_GAIT` entry. Every gait referenced exists in `GAITS`. `strideTiles` is greater than 0.
  - **Poses are smooth:** for each gait and part, the poses at phase 0 and phase 1 are equal within 1e-6, so the loop is seamless.
  - `advancePhase(0, 0.3, 0.6, 16)` returns 0.5.
  - **Cap:** `advancePhase(0, 100, 0.6, 16)` returns 3 × 16 / 1000 = 0.048. This is the high-speed strobe guard.
  - `gaitFor(dragon, Walk)` gives quad. `gaitFor(dragon, Run)` gives flyer with run true. `gaitFor(crocodile-type, Swim)` gives undulate. Idle and Sleep play the 2-frame idle (breathing) pose at a fixed 0.5 cycles per second.
- [ ] **Step 2:** Run the tests and expect FAIL. Implement both files, then run again and expect PASS.
- [ ] **Step 3:** Commit: `feat(art): gait families, species gait table, stride maths`.

### Task 6: Art loading, budgets

**Files:**
- Create: `src/art/load.ts`, `src/art/<chunk>/index.ts` for each chunk in `folk`, `beast`, `bird`, `sea`, `insect`, `undead`, `monster`, `divine`, `buildings`. Each starts as `export const ART: Record<string, string> = {};`.
- Modify: `scripts/check-budgets.mjs`, adding the art limits from Global Constraints. Art chunks are the files whose source path is under `src/art/`. Name them via Vite `manualChunks` or `chunkFileNames` so their file names start with `art-`.
- Test: `tests/unit/art-load.test.ts`

**Interfaces:**
- **Produces:**
  - `export type ArtChunk = 'folk' | 'beast' | 'bird' | 'sea' | 'insect' | 'undead' | 'monster' | 'divine' | 'buildings'`.
  - `export function chunkOf(speciesId: string): ArtChunk`. It is derived from `SPECIES` group and folk, with birds read from `SPECIES_GAIT[id].air === 'flyer' || land === 'bird'`.
  - `export function loadArt(chunk: ArtChunk): Promise<Record<string, string>>`: a cached dynamic `import()`.
  - `export function artFor(id: string): string | null`: synchronous, returning null until its chunk has loaded.
  - Each chunk's `index.ts` imports its SVGs as `import x from './<id>.svg?raw'`.

- [ ] **Step 1: Write the failing tests:**
  - `chunkOf` maps every species to one chunk, and there is no species whose result is undefined.
  - `loadArt('beast')` resolves to an object.
  - `artFor` returns null before the chunk loads.
- [ ] **Step 2:** Implement, then run the tests and expect PASS.
- [ ] **Step 3:** Run `npm run build && npm run check:budgets`. The output shows an `art` line, and everything passes.
- [ ] **Step 4:** Commit: `feat(art): lazy per-group art chunks with their own budget`.

### Task 7: SVG rig and atlas baker

**Files:**
- Create: `src/art/rig.ts`, `src/render/atlas.ts`
- Modify: `src/render/creatures.ts`: install the atlas as the `FrameSource`, use `gaitFor` and `advancePhase` per being, and keep the phase per key.
- Test: `tests/unit/rig.test.ts` (jsdom), `tests/unit/art-lint.test.ts`, `tests/e2e/creatures.spec.ts` (extend)

**Interfaces:**
- **Consumes:** `GAITS`, `SPECIES_GAIT`, `artFor`/`loadArt`, and `FrameSource` (Task 3).
- **Produces:**
  - `export interface Rig { root: SVGSVGElement; parts: Map<string, { el: SVGGElement; px: number; py: number }> }`.
  - `export function parseRig(svg: string): Rig`. Throws on a missing `viewBox` of `0 0 128 128`.
  - `export function poseRig(rig: Rig, gait: GaitDef, phase: number, run: boolean, facingLeft: true): string`. It sets `transform="rotate(r px py) translate(dx dy)"` on each part and returns the serialised SVG.
  - `export class Atlas implements FrameSource`:
    - `constructor(renderer: Renderer)`.
    - `request(species: number): void` queues a bake. Baking runs in `requestIdleCallback`, with a `setTimeout` fallback, and does at most 4 ms of work per callback.
    - `frame(...)` returns `Texture | null`.
    - Pages are 2048² and mipmapped.
    - `rebuild(): void` is called on `webglcontextrestored`. It clears all pages and re-queues every species requested so far.
  - Rasterisation: make a `Blob` of the posed SVG and decode it with `createImageBitmap`, then draw it into a canvas region at 48 and 128 px. The builder may switch to the Pixi SVG parser if it measures faster; record the choice in a code comment.
- **Static fallback:** a species whose art exists but whose gait is `static` bakes one frame.

- [ ] **Step 1: Write the failing tests:**
  - `rig.test.ts`:
    - `parseRig` finds the parts and pivots of a test SVG fixture with `leg-fl` (pivot 40 80) and `head`.
    - `poseRig` writes `rotate(` with the pose rotation on `leg-fl`.
    - `parseRig` throws on `viewBox="0 0 64 64"`.
  - `art-lint.test.ts`: for every SVG present in every chunk, the root `viewBox` is `0 0 128 128`; every part id required by its species' gaits exists with a numeric `data-pivot`; there is no `filter` element (no in-SVG shadow); and the file is at most 12 KB. With no art yet the test passes vacuously. It gains coverage as Tasks 8–9 add files.
  - `creatures.spec.ts`: `context loss rebuilds atlas` (Review Focus 5). Lose and restore the context via `WEBGL_lose_context`. After 3 s, `__sr.creatureCount` is still at least 1 and there are no console errors.
- [ ] **Step 2:** Run the tests and expect FAIL. Implement, then run again and expect PASS.
- [ ] **Step 3:** Commit: `feat(render): rigged SVG walk cycles baked into atlas pages`.

### Task 8: Vertical slice art (6 species), **OWNER GATE**

**Files:** `src/art/beast/thistlehart.svg` (Deer), `src/art/beast/gloamfang.svg` (Wolf), `src/art/bird/cluckling.svg` (Chicken), `src/art/monster/stormwyrm.svg` (Dragon), `src/art/folk/hearthborn.svg` (Lowlanders), plus one water-and-land species from the gait table. Register each in its chunk's `index.ts`.

- [ ] **Step 1:** Author the six SVGs to the Global Constraints format and style B, with real anatomy, as in spec "Goals".
- [ ] **Step 2:** Run `npx --no-install vitest run tests/unit/art-lint.test.ts tests/unit/rig.test.ts`. Expect PASS.
- [ ] **Step 3:** Build a review page at `.superpowers/brainstorm/<session>/content/slice.html`. Show each species still at 128 px, its walk and run cycles animated with CSS keyframes over the posed frames, and a 32 px row on grass. Also run the game in the browser pane, spawn each species and zoom in.
- [ ] **Step 4: OWNER GATE.** Show both to the owner and apply their feedback. Do not continue until they approve the slice.
- [ ] **Step 5:** Commit: `art: vertical slice of six species`.

### Task 9: Art batches, each one an **OWNER GATE**

The same steps repeat for each batch, in this order: beasts (mammals), birds, sea, insects, undead, monsters and divine, peoples (the remaining 5 Folk), buildings (31). Species per batch come from `chunkOf`, and buildings use the `static` gait.

- [ ] **Step 1:** Author every SVG in the batch to the slice's approved standard.
- [ ] **Step 2:** Run art-lint and rig tests, then `npm run build && npm run check:budgets`. Expect PASS, with the batch's chunk at most 40 KB gzip.
- [ ] **Step 3:** Show the batch on a review page as in Task 8 Step 3.
- [ ] **Step 4: OWNER GATE.** Get approval, then commit: `art: <batch> icons`.
- After the last batch, art-lint must cover all 90 species and all 31 buildings. Add a coverage assertion to `art-lint.test.ts`: every species id and every `BUILDINGS` id has art.

### Task 10: Speed realism and crowding

**Files:**
- Modify: `src/render/creatures.ts`
- Create: `src/render/dust.ts`
- Test: `tests/unit/crowding.test.ts`

**Interfaces:**
- **Produces:**
  - `export function animStep(rankFromCentre: number, onScreen: number): 1 | 2 | 0`, where 1 means every frame, 2 means half rate and 0 means a held frame. It returns 1 while `onScreen` is at most `CROWD_LIMIT = 1500`. Above that, the furthest third gets 2, then the furthest sixth gets 0 once `onScreen` passes 2 × the limit.
  - `class DustPool { emit(x, y, facing): void; update(dtMs): void }`, with at most 256 pooled sprites and a 300 ms life. It emits only for beings whose screen speed is at least `RUN_SCREEN_TILES_PER_S`, and only when the `map.particles` setting is on.
- **Run cycle:** the run gait applies when the screen speed is at least `RUN_SCREEN_TILES_PER_S` (Task 5) or the state is Run.

- [ ] **Step 1: Write the failing tests:**
  - `animStep(0, 100) === 1`.
  - `animStep(1400, 1500) === 1`.
  - `animStep(2900, 3000) === 2`.
  - `animStep(3500, 3600) === 0`.
  - The DustPool never exceeds 256 sprites under 1,000 emits.
- [ ] **Step 2:** Implement, then run the tests and expect PASS.
- [ ] **Step 3:** Commit: `feat(render): run gait at speed, dust, crowding animation LOD`.

### Task 11: Quality ladder

**Files:**
- Modify: `src/app/recovery.ts`, its existing tests (`grep -l DEGRADE tests/unit`), and `src/app/main.ts`, where the ladder is applied.
- Test: the existing recovery tests, updated.

**Interfaces:**
- **Produces:**
  - New settings ids: `map.crowdAnim`, `map.dust`, `map.terrainClose`, `map.terrainMedium` and `map.creatureAnim`. These are runtime-only flags; they are never saved.
  - `DEGRADE_OFF` becomes `['map.crowdAnim', 'map.dust', 'map.terrainClose', 'map.terrainMedium', 'map.creatureAnim', 'map.bloom', 'map.particles', 'map.shadows']`.
  - `DEGRADE_MAX_LEVEL` = 9. `DEGRADE_RENDER_SCALE_LEVEL` = 9.
- **Wiring:**
  - `creatures.ts` reads `map.crowdAnim` (off means distant beings get a held frame), `map.dust` and `map.creatureAnim` (off means static frame 0).
  - `terrain.ts` multiplies `uDetail` by the two terrain flags.

- [ ] **Step 1: Update the recovery tests:**
  - The level-to-flag mapping has 8 off-steps in the order above.
  - The render scale caps at level 9.
- [ ] **Step 2:** Implement, then run the tests and expect PASS.
- [ ] **Step 3:** Commit: `feat(app): extend the degradation ladder with the new map effects`.

### Task 12: Perf harness, docs, full check

**Files:**
- Create: `tests/e2e/perf-creatures.spec.ts` (desktop-chromium only: add `testIgnore` for it on the other projects in `playwright.config.ts`)
- Modify: `DECISIONS.md` (a "Map graphics" section that sums up the spec's calls), `docs/spec-coverage.md` (the Art row becomes DONE or PARTIAL with the facts), `docs/release-checklist.md` (add "check walking creatures on one real Android device")

- [ ] **Step 1: Write the perf test:**
  - `3000 creatures at 10x stay under 20 ms P95`: spawn 3,000 using the existing spawn power or a test hook, set speed 10×, and zoom to 16 px per tile.
  - Collect `requestAnimationFrame` deltas for 10 s via `page.evaluate`.
  - Expect the P95 to be at most 20.
- [ ] **Step 2:** Run it. If it fails, profile, and fix within Tasks 3, 7 and 10's code. Do not loosen the gate.
- [ ] **Step 3: Full check:**
  - `npx --no-install tsc -p tsconfig.sim.json --noEmit && npx --no-install tsc -p tsconfig.json --noEmit`
  - `npx --no-install vitest run`
  - `node scripts/check-determinism.mjs`
  - `npm run build && npm run check:budgets`
  - `npx --no-install playwright test --workers=1`
  - All must pass, and `GOLDEN_HASH` must be unchanged.
- [ ] **Step 4:** Commit: `test: creature perf gate; docs for map graphics`.
