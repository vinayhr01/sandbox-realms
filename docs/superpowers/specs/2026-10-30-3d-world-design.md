# 3D world: design

Date: 2026-10-30. Status: draft, waiting for owner approval. Builder check done; gaps closed. Items marked "builder call" are decisions made by Claude for the owner to check.

## Intent

The owner wants to stand inside the world they rule. Today Sandbox Realms is a flat 2D map seen from above (PixiJS). The goal is a 3D world:

- a **top view** for the overview (what the 2D map gives today), and
- a **ground view** where the owner walks around inside the world as its god, does everything a person on the ground can do, and casts powers as part of the world rather than from above.

The god can be a visible **body** (creatures see and react to it) or an invisible **spirit** (passes through anything). The god can never be hurt.

## Three parts, in order

Each part ships on its own and builds on the one before. Each part is built on its own branch, tagged as a checkpoint (`checkpoint-3d-part1`, `-part2`, `-part3`) when its full test pass is green, then merged to main. Parts run one after another; the parallel agents work on independent tasks **inside** a part.

1. **3D world and camera.** Draws the existing world in 3D: hills, water, creatures, buildings and effects. One camera zooms from the overview down to ground level. Existing powers are aimed in 3D. No game logic changes.
2. **God body and spirit.** Moving around at ground level as a body or a spirit. Creatures notice the body. Game logic changes start here.
3. **Person actions.** Carry and throw, give, talk, and build or shape the land by hand, each with new game rules.

Parts 2 and 3 get their own short design pass with the owner before their plans. Their sections below record what is already decided.

## Goals

- The whole current game is playable in 3D. Every power, window and panel still works.
- Top view and ground view are the same camera. Zoom moves smoothly between them, with no mode switch.
- Phones stay usable.
- The 2D renderer stays as a fallback.

## Non-goals

- No real 3D models in part 1. Creatures, buildings and boats are the existing SVG art drawn as flat cut-outs that face the camera (billboards). Models may come later as their own project.
- No multiplayer, no VR.
- No rewrite of the simulation.
- No physics engine library unless part 2's design shows it is needed.

## Anti-goals

These would make it a failure even if it technically works:

- A phone that stutters or overheats in the default view.
- Losing the 2D view, or old saves no longer loading.
- Part 1 changing the game's results. The determinism hash `GOLDEN_HASH 1357125849` must not move in part 1.
- The page opening slower. The 3D code loads after the first screen.

## Constraints from the code today

- **Simulation and drawing are separate.** The simulation runs in a worker and sends snapshots. Drawing lives in `src/render/*` (about 3,500 lines) plus the wiring in `src/app/main.ts` (2,247 lines). Part 1 replaces only drawing and input.
- **Height exists.** Every tile has a height in `realm.elevation` (`Uint8Array`), and Raise and Lower change it. The terrain texture rows already carry it: R is ground id, G is cover id, B is elevation, A is flags (`src/render/terrain.ts`).
- **Size budgets** (`scripts/check-budgets.mjs`):
  - main chunk ≤ 350 KiB gzip (about 224 KiB now);
  - worker chunk ≤ 250 KiB;
  - each art chunk ≤ 40 KiB (buildings ≤ 48 KiB);
  - all art ≤ 600 KiB.
- **Map size.** The grid is 64 × `sizeStep` tiles per side. The default is 256 × 256. `MAX_SIDE` is 576.
- **Crowds.** `CROWD_LIMIT` is 1,500 drawn beings. The degrade ladder (`stepDegrade`) lowers detail under load.
- **Tests.** e2e tests tap screen points to hit tiles and beings through `cam.screenToTile`.

## Approaches considered

1. **three.js with a 2D fallback.** Picked by the owner.
   - The most widely used web 3D library, about 170 KiB gzip, loaded as its own chunk.
   - Reuses the SVG art as billboards.
   - Keeps PixiJS 2D as a fallback and for most existing tests.
   - Trade-off: walking and collisions in parts 2 and 3 need our own code, or a small add-on.
2. **Babylon.js.** A full engine with physics and a character controller built in. Rejected: about 500 KiB or more, too heavy for phones.
3. **Fake 3D (tilted isometric) in PixiJS.** Rejected: it cannot do ground-level walking or looking around.

## Part 1: 3D world and camera (decided)

### Renderer choice

- Settings gets a **View** option, 3D or 2D. The URL takes `?view=2d` or `?view=3d`. The choice is saved per device.
- **Default** (builder call): 3D when WebGL2 works and `navigator.deviceMemory` is either unknown or ≥ 4. Otherwise 2D.
- If 3D fails to start, the game falls back to 2D and shows a toast.
- **Loading** (builder call): the `render3d` chunk loads alongside worldgen, behind the existing progress bar. 2D is never drawn first and then swapped. The Settings View switch reloads the page and keeps the world through the normal autosave. It isn't a live swap. "The page opening slower" means time to the first map frame, measured before and after.
- **Safe Mode** (builder call): Safe Mode forces 2D.
- The rest of the app talks to both renderers through one interface. This replaces direct `cam.screenToTile` use in `main.ts`:
  - `screenToTile(x, y)`: tile or null;
  - `tileToScreen(x, y)`: point or null;
  - `applyRows`, `setView`, the creature, building, boat and effect feeds, and the insight layers;
  - `resize`, `destroy`.
- three.js and all 3D code build as a lazy chunk `render3d`. The budget script adds a `render3d` cap of 220 KiB gzip. Main stays ≤ 350 KiB.

### Camera

One continuous camera, from a top-down overview of the whole map down to eye height on the ground. As height drops, the camera tilts from looking straight down to looking at the horizon.

| Action | Desktop | Phone |
|---|---|---|
| Zoom between top and ground | wheel | pinch |
| Pan, from above | drag | one-finger drag |
| Rotate | right-drag, or Q/E | two-finger twist |
| Move, at ground level | WASD or arrow keys | on-screen joystick (bottom left) |
| Look, at ground level | drag to look; pointer lock on double-click; Esc releases it | drag |

- In part 1, ground level is a free spirit camera. It follows the terrain height and has no body.
- Scale (builder call): 1 tile is 2 m, and eye height is 0.85 tile.
- The existing keyboard map keeps working. Space still pauses. Esc keeps its order: release pointer lock, then collapse the sheet, then disarm.

### Terrain

- A height-mapped mesh built from elevation, split into chunks (builder call: 32 × 32 tiles per chunk).
- Each chunk is rebuilt only when its rows change in `applyRows`.
- Colours come from the same palette and ground and cover ids as 2D, so both views match.
- Water (builder call) is drawn per tile, from the ground id, as its own surface just above that tile's terrain. The sim treats water as a ground kind, not a level: carved rivers, lakes and dry hollows each keep their own height. This also covers molten and slime ground.
- The vertical scale (builder call) is 0.04 tile per elevation unit, so the full 0–255 range is about 10 tiles, or 20 m.
- Distant chunks use a coarser mesh (level of detail).
- Insight layers (the map overlays) are drawn as a texture laid over the terrain.

### Beings, buildings and boats

- Billboards from the existing frame atlas and SVG art. Same walking frames and level-of-detail rules as 2D.
- Instanced drawing, with `CROWD_LIMIT` respected.
- Beings far away become dots, as in 2D.
- Building and boat feeds are unchanged.

### Every map layer in 3D (owner decision)

The owner chose to have every 2D map layer exist natively in 3D in part 1, accepting that it roughly doubles the part. Nothing is screen-space-only and nothing is turned off.

- **Marks** (`marks.ts`): nameplates, armies and army lines, battles, campaigns, pact links, intrigues, item marks. They are drawn as 3D objects anchored at tile height, with lines following the terrain, and labels as camera-facing text sprites.
- **Insight overlays on beings** (O03, O04): tints and icons on the 3D billboards.
- **Cursor**: arrows and the world tooltip, anchored to the 3D hit point.
- **Footfall dust**: 3D particles at the beings' feet.
- **Settings visuals**, each with its 3D equivalent:
  - night lights: point or emissive lights on buildings;
  - bloom and vignette: post-processing passes;
  - shadows: real shadows, sun-driven;
  - age overlay: a terrain tint;
  - tree sway: vertex sway on tree billboards;
  - cursor lights.
- Each of these keeps its Settings toggle and its place in the degrade ladder.

### Effects

- The existing recipes (`effectRecipes.ts`) are played as 3D particles at the target tile's height.
- `MAX_PARTICLES` and the stroke throttle stay as they are.

### Powers in 3D

- The brush ring is drawn on the terrain surface.
- **Aim:** with a mouse, a ray from the pointer to the terrain. With touch, the tapped point, or the screen centre (a crosshair) while moving at ground level.
- A ray that hits nothing, such as the sky, does nothing.
- **Gestures while a power is armed** (builder call):
  - **From above:** drag paints the stroke, as in 2D. Hold-to-raise and long-press to inspect also work as in 2D.
  - **At ground level:**
    - a tap or click casts at the hit point;
    - holding paints at the crosshair while you move;
    - a drag looks around.
  - **Second finger:** it always cancels a stroke in progress, then pinches or twists. This keeps the 2D rule.
  - **Keys:** WASD and the arrow keys pan from above and walk at ground level.
- The tile a ray hits feeds the existing power commands unchanged. Big area powers work from any height.

### Performance targets

- 60 fps on desktop and 30 fps on a mid-range phone, with the 256 map and the default crowd.
- The degrade ladder gains 3D steps (builder call): terrain level of detail, view distance, render scale, billboard count.
- **When the ladder runs out** (builder call), a toast offers "Switch to 2D view". It is offered, never forced.
- **Checking:**
  - CI runs a 3D smoke perf test on software WebGL. It checks there are no long frames over a loose limit; it doesn't gate on fps.
  - The 60/30 fps targets are checked by hand by the owner on a real phone.

### Tests

- Existing e2e tests pin 2D (builder call). There's no shared `openRealm`, and about 30 tests call `page.goto` directly, so the pin is a Playwright fixture or `addInitScript` that saves View = 2D before any page loads. A test opts into 3D with `?view=3d`.
- One phone-portrait smoke and one desktop smoke also run in 3D, so phone layout over the 3D view is covered.
- New unit tests:
  - the heightmap mesh builder (vertex heights match elevation, and changed rows rebuild only their chunks);
  - ray-to-tile picking (centre and corners, slopes, and a sky hit returning null);
  - the renderer choice rule.
- New e2e tests in `?view=3d`, on Chromium with WebGL through SwiftShader:
  - the realm loads with no console errors and the canvas isn't blank;
  - zoom to ground level and back;
  - arming a power and clicking the terrain casts on the hit tile (checked through the `__sr` test hook);
  - the View switch moves between 3D and 2D.
- `GOLDEN_HASH` is unchanged. The determinism, budget and build checks all pass.

## Part 2: god body and spirit (outline; own design pass later)

- **Body/spirit toggle.**
  - Spirit: invisible, passes through everything.
  - Body: visible to creatures, walks, runs, jumps, swims and climbs, and can fly.
  - The god is never hurt. Cliffs and water slow the body down; they never trap it.
- Creatures notice the body. This needs a new simulation command carrying the god's position. Reactions follow each species' temperament. It changes game logic, so it gets a hash and save plan of its own.
- Open for its design pass: first or third person, and what the body looks like.

## Part 3: person actions (outline; own design pass later)

- Carry and throw beings, items and rocks.
- Talk to a person: see their name, mood, family and thoughts.
- Give items or food.
- Dig, raise, plant and place buildings by hand where the god stands.
- Each action is a new simulation command, with a save format bump and a migration.

## Left to the builder

- Shader details, chunk and level-of-detail numbers, joystick look, and how fog and lighting are tuned. All of these must stay within the performance targets and budgets above.
