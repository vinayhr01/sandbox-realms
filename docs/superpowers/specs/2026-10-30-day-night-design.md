# Day and night, and a richer 3D look: design

Date: 2026-10-30. Status: draft, builder check done, waiting for owner approval. Items marked "builder call" are Claude's decisions for the owner to check.

## Intent

The owner finds the live 3D map dull and wants:

- a visible day and night cycle, with a sun and a moon;
- a higher-quality 3D look;
- day and night that change how the world behaves, not only how it looks.

Today a cosmetic sun moves in `src/render3d/lighting3d.ts`, on a 2400-tick cycle, but nothing in the sky shows it. The background is a flat dark blue (0x17202b). Terrain colour comes only from the ground id, with no cover tint. Shading is flat Lambert. The simulation has no time of day.

## Decided with the owner

- Night changes behaviour. This is a game-logic change.
- **Day length:** one day every 200 ticks, which is 2 game months, or 10 s at speed 1.
- **Sky and water:** use the three.js add-ons (owner's pick over custom lightweight shaders):
  - `three/examples/jsm/objects/Sky.js`, a physical sky;
  - `three/examples/jsm/objects/Water.js`, reflective water.
- Phones must keep working (part 1 phone fixes). The existing degrade ladder lowers quality on weak devices.

## Goals

- **Time of day in the simulation**, derived from the tick, so it is deterministic and adds nothing to the save format.
- **Behaviour:**
  - Diurnal beings sleep at night, and nocturnal beings sleep by day.
  - Predators hunt better at night.
  - Folk go home at dusk and work by day.
- **3D sky:** the sky follows the sim's time of day. A sun and a moon cross it, and stars show at night. Fog matches the sky colour.
- **3D lighting:** night lighting (lights and window glow) follows the sim's time of day too.
- **2D:** the map darkens at night as well, so both views agree.
- **Higher-quality 3D:**
  - brighter, richer colour;
  - sky and ground light;
  - cover tint (forest and grass);
  - smooth shading;
  - finer terrain near the camera;
  - anti-aliasing;
  - shadows on by default;
  - reflective water with waves and sun glints.

## Non-goals

- Seasons and weather tied to the time of day.
- Real 3D models.
- A day length the player can change.

## Anti-goals

- Stuttering or overheating phones.
- Old saves that won't load.
- A light/dark strobe at 10× speed.
- Breaking the 3D budget: the `render3d` chunk stays ≤ 220 KB gzip. It is 150.6 KB today.

## Approaches considered (sky and water)

1. **Custom lightweight shaders:** a gradient dome and analytic water. About +10–15 KB, easy on phones, stylised.
2. **three.js Sky and Water add-ons** (picked by the owner). A physical sky and real planar reflections.
   - Water renders the scene a second time for its reflection.
   - Water needs a normal map image.
   - The realistic look may clash with the illustrated billboards.

## The sim: time of day

**Phase.** A new pure module `src/sim/daytime.ts` holds:

- `DAY_TICKS = 200`;
- `dayPhase(tick): number` in [0, 1);
- `isNight(tick)`;
- `light01(tick)`.

The day's segments (builder call), with 0 at midnight:

| Segment | Phase |
|---|---|
| night | 0.85 → 1 and 0 → 0.20 (35%) |
| dawn | 0.20 → 0.30 |
| day | 0.30 → 0.75 |
| dusk | 0.75 → 0.85 |

Tick 0 is set at 0.30, the start of day, so a new world opens in daylight. The offset is a constant.

**Nocturnal content.** Species get a `nocturnal` flag in `src/content/beasts.ts`. The builder drafts the list of species ids (owls, bats, moths, foxes, wolves and the like, by the plain names table). The owner reviews it before wiring. Every other species is diurnal.

**Sleep.**

- At dusk, for diurnal beings, and at dawn, for nocturnal ones, the `monophasic` task gets a large utility bonus. Its sleep lasts until that being's wake time: dawn for diurnal, dusk for nocturnal.
- The existing `sleepTicks` for `mono` is replaced by "ticks until wake", clamped to the old minimum.
- Naps and polyphasic sleep keep their rules, but get a small bonus at night (diurnal) or by day (nocturnal).

**Predators.** At night, `eat_hunt` for beings whose diet is flesh gets ×1.5 hunt range. Nocturnal predators also get ×1.25 success (builder call).

**Folk.**

- At dusk, folk with a home hamlet pick "go home" (move toward the hamlet centre) over wander or work.
- At night they rest: monophasic sleep near home.
- Work tasks get a utility malus at night.

**Determinism.** `GOLDEN_HASH` changes on purpose. The new value and the reason are recorded in DECISIONS.md. The determinism script keeps passing against the new hash.

**Saves.** There are no new saved fields. The phase comes from the tick, so an old save loads at whatever time of day its tick gives.

**Snapshot.** It carries `dayPhase`, a number, so both renderers read the sim's time and never compute their own. `Lighting3D`'s `DAY_TICKS = 2400` cosmetic cycle is removed.

## The views

**Fast speeds.** Above 2× speed, the drawn phase follows the sim's phase through a smoothing filter (builder call: a time constant of 1.5 s of real time). At 5× and 10× the sky drifts instead of strobing. Behaviour always uses the true phase.

**3D sky (`src/render3d/sky3d.ts`):**

- The three.js `Sky` holds the sun position from the phase: east to west, peaking at noon, below the horizon at night.
- A moon is a lit sphere opposite the sun. Its glow is a sprite.
- Stars are a `Points` dome. Their opacity is the night amount.
- Scene fog takes its colour from the sky at the horizon.
- The overview camera (looking straight down) sees the sky only at the edges, so the sky must not wash out the map.

**3D lighting (`Lighting3D`):**

- Sun intensity and colour change: warm at dawn and dusk, white at noon.
- A cool moonlight lights the night.
- A `HemisphereLight` (sky and ground) replaces the flat ambient light.
- Night window glow and night lights use the sim's phase.

**Tone and colour:**

- `ACESFilmicToneMapping` with sRGB output.
- Terrain vertex colour is ground colour × cover tint, with forest, grass and crops tints from the cover id.
- Each vertex gets a ±4% hash-based brightness jitter, so big areas aren't flat.
- Saturation rises slightly.

**Terrain quality:**

- `MeshStandardMaterial`, roughness about 0.9, with smooth vertex normals.
- Near chunks (LOD 1) get 2 vertices per tile edge (builder call), so hills look round near the camera.
- Chunk edges get skirts to hide LOD cracks, a known gap from part 1.

**Water (`water3d.ts`):**

- The three.js `Water` add-on on water and sea tiles.
- Its normal map is generated at run time on a canvas from tiling noise (builder call), so there is no image download and the size budget holds.
- Mirror resolution is 512 px. Its sun direction and colour follow the sky.
- Molten and slime grounds keep the simple per-tile surface with an emissive tint.

**Anti-aliasing and pixel ratio:**

- `antialias: true`.
- Pixel ratio is `min(devicePixelRatio, 2)`, scaled by the existing render scale.

**Shadows:** on by default (`map.shadows` is already true). They use `PCFSoftShadowMap`.

**2D night (`src/render/terrain-shader.ts`):** a night uniform darkens and cools the palette by up to 55% at full night. Lit building windows reuse the existing night lights.

## Degrade ladder (phones)

New 3D steps, inserted before the existing `map3d.*` steps (builder call):

| Step | Effect |
|---|---|
| `map3d.waterReflect` | Water drops the reflection pass and uses a cheap fresnel tint. |
| `map3d.terrainFine` | Near chunks stop doubling vertices. |
| `map3d.stars` | Stars and moon glow off. |

The existing "3D is struggling" toast stays the last resort.

## Budget

- `render3d` stays ≤ 220 KB gzip. Sky.js and Water.js are small (a few KB each).
- If the build goes over, the builder stops and reports. The cap is not raised without the owner.

## Tests

**Unit:**

- `daytime.test.ts`:
  - the phase segments and boundaries;
  - tick 0 is day;
  - phase wraps at 200.
- Sleep: a diurnal being in a hand-built sim falls asleep in its first dusk and wakes at dawn. A nocturnal one does the reverse.
- Hunt range: ×1.5 at night for flesh eaters, unchanged by day.
- Folk: a folk being with a home heads toward it at dusk.
- An old-format save (an existing fixture) loads, and its `dayPhase` comes from its tick.
- Lighting:
  - sun and moon positions from the phase (noon high, midnight below the horizon);
  - star opacity is 0 by day and 1 at night;
  - the smoothing filter doesn't jump at 10×.
- Terrain mesh: the near-chunk vertex count doubles, and the skirt vertices exist.
- The runtime water normal map is a non-blank canvas of the right size.

**Determinism:** the new `GOLDEN_HASH` is recorded, and `node scripts/check-determinism.mjs` passes.

**e2e (3D job):**

- At `?view=3d`, a hook sets the tick to night. The sky's sampled pixels are darker than by day, and stars are visible.
- At `?view=2d` at night, the map's mean brightness drops.
- No console errors.
- `perf-3d` stays under its 1 s stall limit.

## Left to the builder

Exact colours, intensities, fog density, star count, the wave speed, and the noise for the normal map. All of these must stay within the budget and the phone limits above.

## Calls after the builder check

The builder check found that several claims above don't match the sim. These calls replace the matching parts above (builder calls unless marked owner).

1. **Sleep fits a 200-tick day.**
   - Today `monophasic` sleeps 800–1800 ticks, with a 4000-tick cooldown, so sleep spans several days.
   - **Night sleep** lasts from sleep start to that being's wake time (dawn for diurnal, dusk for nocturnal). It is capped at the night length (70 ticks). The old minimum clamp is dropped.
   - **Cooldown:** `monophasic` drops to 150 ticks, so a being can sleep every night.
   - **Naps and polyphasic sleep** are scaled to at most a quarter day (≤ 50 ticks), with their cooldowns scaled the same way.
   - **Rewards:** endurance restore per wake and the `slept` mood and dream rolls are scaled by sleep length relative to the old mean. Nightly sleep then doesn't give several times the old reward.
2. **Folk home is worked out, not saved.** A folk being's home is the hamlet whose parcel it stands on. Away from any parcel, it is the nearest hamlet of its dominion.
   - "Go home at dusk" is an override in `decide()`, not a new decision row. New rows or saved fields would change the save schema, and old saves would stop loading.
   - No save-format change.
   - The old-save test first builds a fixture from current main (schema 7).
3. **Water reflections (three.js `Water`) are on sea tiles only,** as one mirror plane at sea level per visible sea area.
   - The mirror is capped at one per frame, at 512 px.
   - Lakes, rivers and pits keep per-tile surfaces with a cheap fresnel and wave shader, since a planar mirror can't reflect water at mixed heights.
   - `map3d.waterReflect` turns the mirror off on weak devices.
4. **Determinism gate:**
   - The gate is `GOLDEN_HASH` in `tests/unit/golden.test.ts`. It is updated, and DECISIONS.md records the old value 1357125849, the new value and the reason.
   - `scripts/check-determinism.mjs` stays a banned-calls lint.
   - Before any sim change, the builder first confirms 1357125849 passes on main.
5. **Night hunting:**
   - The ×1.5 hunt range applies to every being that hunts (flesh or omni diet, or the `flesh_gut` trait).
   - The nocturnal "×1.25 success" becomes ×1.25 bite damage, since there is no hit roll.
6. **Anti-aliasing** comes from multisampled render targets when bloom or vignette render through the composer. Pixel ratio is already `min(dpr, 2) × renderScale`.
7. **Night sleep strength: most sleep** (owner decision). During its sleep window, a diurnal being at night (or a nocturnal one by day) is told to sleep by an override in `decide()`. The override sits below the existing danger overrides, so a being still flees danger, eats when starving, and fights when attacked. A weight bonus inside tier 1 would almost never fire, because 80% of picks use only the top eligible tier.
8. **Village work slows at night** (owner decision). Hamlet job output (`runJobs` in `settlements/hamlet.ts`) is multiplied by 0.3 at night (builder call), with no daytime boost. Per-day output falls by about 25%, and the owner accepts that economy shift. Unit tests that pin economy numbers are updated to the new values, and each change is listed in DECISIONS.md.
