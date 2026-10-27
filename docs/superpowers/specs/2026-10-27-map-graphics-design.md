# Part 2 of 3: Map graphics (smooth terrain, illustrated walking creatures)

Status: draft for owner review, 2026-10-27. Part 1 (plain names) has shipped. Part 3 (UX redesign: power bar, windows, HUD, onboarding, mobile, touch, keys) comes after this one and will reuse this part's icons.

## Intent

The map should look modern and real instead of pixelated. That has two pieces:

1. Smooth terrain whose detail grows as you zoom in.
2. Illustrated creatures and buildings. You can tell every species apart, creatures walk realistically, and they scale with the world.

There must be no performance hit a normal player would notice. That includes much larger populations and future game speeds of 40× and 100×.

## Goals

- **Terrain by zoom level** (owner picked it from mockups):
  - Zoomed out: "B" (smooth blend, soft hill shading, water darkening with depth, shoreline foam).
  - Medium zoom: "C" (B plus grass speckle, rocky noise, water ripples, soft contour lines).
  - Close zoom: finer detail still (grass tufts, pebbles, wave crests).
  - Levels cross-fade with zoom, with no popping.
- **Icon style "B"** (owner pick): shaded illustration with gradient fills, a thin dark outline and a soft drop shadow.
- **Real anatomy:** eyes, nose and mouth, proper paws, hooves, claws, wings, tails and textures. Each creature and building reads as that real thing.
- **One SVG file in the repo per creature and per building type:** 90 species (84 creatures and 6 peoples) and 31 building types.
- **Sizes scale with the world:** specks when zoomed out, large and recognisable when zoomed in.
- **Realistic walking (owner):**
  - Gait families: four-legged walk and run, two-legged walk and run, bird hop and flap, flyer wing-beat, fish swim, six-legged insect scuttle, snake slither, and a hover or float for ghosts.
  - Stride speed follows actual movement, so feet don't slide.
  - Creatures face the way they move, and each has a soft contact shadow.
- **It still looks real at 40× and 100× speed and with more creatures:**
  - Positions glide between sim updates.
  - Stride rate is capped at a believable maximum, so legs never strobe.
  - Past a speed threshold, creatures switch to a run cycle with a light dust or motion streak.
  - When the screen is crowded, distant creatures drop animation frames first.

## Non-goals

- No 3D or isometric camera; the view stays top-down 2D (owner).
- No change to the power bar, windows, HUD or menus. That is part 3.
- No item icons (weapons, armour). Those wait for part 3, where the UI shows them.
- No sim speed above today's 10×. The 40× and 100× options are later sim work. This part only makes sure the renderer holds up when they arrive.
- No change to sim rules, determinism or saves.

## Anti-goals (a failure even if it "works")

- A frame-rate drop a player would notice on a mid-range laptop or phone, compared with today.
- Creatures that teleport, slide or strobe at high speed.
- Icons that still read as generic blobs (a deer and a wolf must be distinguishable at medium zoom).
- Raster image assets or new runtime dependencies for art.

## Constraints and findings

- **Renderer:** PixiJS 8.22.0 on WebGL2. Terrain is one full-screen shader quad (`src/render/terrain-shader.ts`) reading an RGBA8 index texture per tile (ground, cover, elevation, flags) and a 32-wide palette texture. All terrain changes stay in that shader. There is no per-tile geometry.
- **Today's sprites** (`src/render/sprites.ts`): seven group silhouettes drawn with Pixi Graphics, at a fixed 4–16 CSS px regardless of zoom. Six building shapes cover 31 building types.
- **Big gap: the map does not see most creatures.**
  - Creature positions reach the map only through the periodic snapshot (`mapPoints`, `src/sim/snapshot.ts`). That snapshot arrives every 2 sim-seconds (`SNAPSHOT_TICKS`) and is capped at 96 beings (`MAP_POINT_CAP`).
  - The sim holds up to 4,096 beings (`MAX_BEINGS`).
  - Realistic walking needs a new per-frame being feed. It is the core new piece of this part.
- **Sim positions are whole tiles** (`BeingStore.x/y: Uint16Array`). Movement accumulates in `moveAcc`, and a being steps one tile at a time. Smooth motion is interpolated on the render side between successive feed positions.
- **The worker already posts a frame event** (`Ev.Frame` with terrain rows and stats, `src/sim/worker.ts` `publishFrame`). The being feed rides alongside it.
- **Budgets** (`scripts/check-budgets.mjs`): main bundle 350 KB gzip (188 KB used), worker 250 KB gzip (145 KB used).
- **Determinism:** the feed and renderer only read sim state. `GOLDEN_HASH` and the determinism lint must not change.
- **Tests:** Vitest for logic. Playwright on Chromium covers the layout and smoke specs.

## Approaches considered (owner picked 1)

1. **Walk cycles baked into a texture atlas (picked).**
   - Each SVG has named parts (legs, head, tail, wings). On a species' first appearance, the main thread renders N frames per gait (8 walk, 8 run) into a shared atlas texture.
   - At runtime each creature is one sprite swapping atlas frames, which costs about the same as today's static sprites.
   - Trade-off: stepped rather than continuous motion, which players will not notice at normal speed.
2. **Live part animation, 5–7 sprites per creature.** The smoothest motion, but 5–7 times the sprite count. Rejected for scale.
3. **GPU skeletal mesh animation.** The fastest at scale, but a major new engine piece and a far harder authoring format. Rejected as overkill for 2D.

## Design

### A. Being feed (worker → main, per frame)

- **What it carries:** a compact typed-array message per published frame. It covers every living being, or only those inside the camera's view plus a margin; the builder decides.
  - Per being: `id` (slot plus generation, so a reused slot is not interpolated across), `x`, `y` (tiles), `species` (index), `state` (idle, walk, run, swim, fly, attack, sleep, dead or dying) and `facing` (left or right).
  - About 10 bytes per being, about 40 KB at the 4,096 cap. Transferred, not copied.
- **Rate:** tied to the render frame pump, not to sim ticks, so 100× speed does not multiply messages. The feed carries the sim tick, so the main thread knows how much sim time passed between feeds.
- **On the main thread:** keep the previous and current feeds and interpolate each being's position by wall-clock time between them.
  - A being that moved more than K tiles between feeds (teleport, spawn or possession jump) snaps instead of gliding.
  - The snapshot `mapPoints` and `mapKinds` stay for the Insight layers. The creature layer switches to the feed.

### B. Creature and building layer

- **Each creature is one Pixi `Sprite`,** plus a shared shadow sprite drawn in a separate container underneath, or the shadow baked into the frame. The builder decides.
- **Sprites are pooled.** Only beings inside the view get a sprite.
- **Level of detail by zoom (CSS px per tile):**
  - **Far:** below about 4 px per tile, a small coloured dot per group, batched as one Graphics or particle container. No animation.
  - **Near:** at about 4 px per tile and above, the species icon at world scale, which means size class × zoom. The far-to-near switch fades over a short zoom range.
- **Animation:**
  - Frame index = phase + distance moved / stride length. Stride length is per species, scaled by size class.
  - A cap on stride rate stops strobing at high speed.
  - The run gait applies when screen speed passes a threshold.
  - At very high speed, add a dust or streak particle behind runners, also from a pooled sprite set.
  - Idle creatures get a slow breathing frame pair.
- **Crowding:** if more than N sprites are on screen (about 1,500, to tune), creatures furthest from the screen centre step their animation at half rate, then hold one frame. A small FPS meter in the existing stats feeds this.
- **Buildings:** one icon per building type at world scale. No animation. Optional idle smoke on the hearth and the forge can come later.

### C. SVG icon format and atlas baking

- **Files:**
  - `src/art/creatures/<species-id>.svg` and `src/art/buildings/<building-id>.svg`, imported as raw strings via Vite `?raw`, so there is no runtime fetch.
  - All files share one `viewBox` convention: 128×128, feet on the baseline at y = 120, facing left.
- **Part naming:**
  - Animated parts are `<g>` elements with ids from a fixed vocabulary: `leg-fl`, `leg-fr`, `leg-bl`, `leg-br` (four-legged), `leg-l`, `leg-r` (two-legged), `wing-l`, `wing-r`, `tail`, `head`, `body`, `fin`, and `seg-1..n` (snake and fish).
  - Each part has a `data-pivot="x y"` attribute in viewBox units.
- **Gait data:** a gait family per species, in a small table `src/art/gaits.ts`. It maps the species id to the gait and stride length, and each gait gives per-frame rotations and offsets for each part.
- **Baking:**
  - On first sight of a species, its SVG string is parsed once, and the part transforms for each gait frame are applied.
  - Each frame is rasterised with `OffscreenCanvas` and `drawImage` of an SVG blob, or with Pixi's SVG Graphics parser, at 2 resolutions: about 48 px for medium zoom and about 128 px for close zoom. The builder picks the method after measuring.
  - Frames are packed into atlas pages of 2048² and mipmapped.
  - Baking runs in idle callbacks, never blocking a frame. Until a species is baked, it shows its group dot or static icon.
- **Style B in SVG:**
  - Linear or radial gradient fills.
  - A thin outline of about 1.5 px in a darker tint, never pure black.
  - Eyes with a highlight dot, a visible mouth and nose, and toes or paws, hooves, claws or talons by species.
  - The drop shadow is drawn by the renderer, not inside each SVG.

### D. Terrain shader

All changes are in `TERRAIN_FRAG`, plus any uniforms `terrain.ts` must pass (for example time, for water ripples).

- **Smooth blend:**
  - Sample the four nearest tile centres. Blend colours bilinearly, but only across tiles of compatible layers (land with land, water with water). Coast edges get their own soft transition with a foam band.
  - Elevation is also interpolated, for the hillshade.
- **Depth tint** for the water grounds, based on elevation or ground id.
- **Detail is computed procedurally,** with hash-based value noise, no textures:
  - Medium-zoom detail fades in over roughly 8 to 16 px per tile. Medium detail covers speckle per ground family, rock noise on hills and mountains, animated ripples on water, and soft contour lines.
  - Close detail fades in over roughly 24 to 48 px per tile. Close detail covers tufts, pebbles and wave crests, also from noise.
  - Thresholds are tuned against the mockups.
- **Grid lines** stay available but default off at close zoom when detail is on. The builder decides, consistent with the existing option, if any.
- **Brush outline** is unchanged.
- **Performance target:** with detail on at close zoom, the fragment cost must stay inside today's frame budget on integrated GPUs. Noise lookups are bounded, at most about 3 octaves.

### E. Quality ladder

The game already has a degradation ladder (DECISIONS.md: "heartbeat, watchdog, contentHash handshake and degradation ladder exist"). Hook into it in this order, so a weak device loses the least visible things first:

1. Distant creatures animate at a lower rate.
2. Dust and streak particles turn off.
3. Close-zoom terrain detail turns off.
4. Medium-zoom terrain detail turns off.
5. Creatures render as static icons.

## Verification

- **Unit tests (Vitest):**
  - Feed encode and decode round-trip.
  - Interpolation, including the snap-on-teleport and slot-reuse cases.
  - Stride and frame-index maths, including the cap at high speed.
  - Gait table covers every species.
  - Every species id and building id has an SVG with the required parts for its gait.
- **Existing checks stay green:** typecheck, the full unit suite, `GOLDEN_HASH` unchanged, the determinism lint, budgets and the Playwright Chromium specs.
- **A perf harness (Playwright, desktop-chromium):**
  - Spawn about 3,000 creatures, run at 10× speed, zoom to medium.
  - Record frame times for 10 s. P95 frame time must stay under 20 ms on CI's software WebGL, or under today's baseline plus 10%. The builder records today's baseline first.
- **Manual check in the browser pane at three zoom levels:**
  - Creatures walk, face their direction and don't slide.
  - The far-to-near switch doesn't pop.
  - Terrain detail fades smoothly.

## Art authorship (owner decision)

- **Who draws the art.** Claude hand-writes the SVGs. The target is clean, shaded illustration with real anatomy, about the quality of good mobile-game icons. Painted realism is not the target.
- **Review.** The owner approves a 6-species sample first. After that, each group batch needs owner approval before it merges. The batches are beasts, birds, sea, insects, undead, monsters, peoples and buildings.
- **Replacing art later.** Any file can be swapped for an artist's version later with no code change, as long as it keeps the format in C.

## Calls made after the builder check (lead's calls, owner to check)

- **Art loading.** Creature and building art loads in lazy chunks, one per group, through dynamic `import()`. Pages serves them and the service worker caches them. This replaces "no runtime fetch". `check-budgets.mjs` gets a separate art budget: each art chunk at most 40 KB gzip, all art together at most 250 KB gzip. Main bundle growth stays at most 20 KB.
- **Max zoom.** `MAX_ZOOM_PX` rises from 48 to 96 px per tile, and the 24 px floor on phones and Titan maps goes. With the old cap, close detail and recognisable creatures could never be reached on those devices. Close terrain detail fades in over 32 to 64 px per tile. The 128 px atlas frames are used from about 48 px per tile.
- **Degradation ladder.** The new steps come before the existing ones (bloom, particles, shadows, render scale): distant animation rate, dust, close terrain detail, medium terrain detail, static creatures. `DEGRADE_MAX_LEVEL` and its tests are updated. Contact shadows follow the existing `map.shadows` setting, and dust follows `map.particles`. Terrain detail gets no separate user setting in this part; part 3 owns the UI.
- **State and facing.**
  - The feed's `state` is derived in the worker from existing fields only: `sleepUntil` gives sleep, `hitUntil` gives hit, the ground under the being gives swim, a flyer flag gives fly, and the distance moved gives walk or run.
  - Facing is derived on the main thread from the position delta, and is kept when the being is idle.
  - Death needs no sim change. A being missing from the feed fades out over about 0.4 s where it was last seen. `GOLDEN_HASH` stays untouched.
- **Buildings and boats.** Buildings and boats also move to the feed. Buildings are sent only when the set changes, keyed by hamlet version; boats are sent every frame like beings. This removes the 96 caps for the map. The snapshot copies stay for the Insight windows.
- **Performance gate.** The gate is absolute. With 3,000 creatures at 10× speed and medium zoom, P95 frame time must be at most 20 ms in CI (desktop-chromium, software WebGL). The run fails if it is over. Phones are checked by hand on one real Android device before release, as a checklist item, not a CI gate.
- **Gaits.**
  - A species may have one gait per medium: land, water and air (crocodile, beaver: walk plus swim; dragon: walk plus fly). The feed's state picks which one plays.
  - Extra gait families: crab sidle, tentacle (octopus, squid), pulse (jellyfish), squish (slime), undulate (whale, sea serpent), and hop-waddle (mushroom).
  - The part vocabulary is per gait family, defined in `gaits.ts`. The "required parts" test checks each SVG against its gaits' vocabularies.
- **Variants.** Children draw at 0.6× scale, a flag in the feed. Strain palettes, castes and biome morphs are not shown in this part. Tinting fights gradient art, and per-palette atlas variants would multiply memory. They are noted for later.

## Left to the builder

- Whether the feed sends every being or only those in view (measure both).
- How SVGs are rasterised (OffscreenCanvas from an SVG blob or the Pixi SVG parser), and the atlas packing method.
- Exact frame counts per gait and the zoom thresholds, tuned by eye.
- Whether the shadow is baked into the frames or drawn as a separate sprite.

## Delivery order

1. Being feed and an interpolated creature layer that still uses the current shapes. This proves the motion and performance path.
2. Terrain shader: smooth blend and zoom-faded detail.
3. SVG format, gait table and atlas baker, with about 6 species as a vertical slice. Owner checks the look.
4. The remaining creature and building SVGs, authored in batches by group.
5. Speed realism (run gait, stride cap, dust), crowding LOD and the quality-ladder hooks.
6. Perf harness, docs, DECISIONS.md entry.
