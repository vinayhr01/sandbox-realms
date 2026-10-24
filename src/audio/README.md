# Audio

Four pure modules and one adapter. Only `engine.ts` touches WebAudio, and the simulation never imports anything in this folder.

| file | role |
|---|---|
| `model.ts` | Buses with volume and mute, per-category and global voice caps, priority stealing, hidden-tab mute, category-to-bus table (`CATEGORY_BUS`). No WebAudio. |
| `sounds.ts` | Sound definitions (recipes, not files): class defaults from 16 B3, 56 sounds (UI, stingers, calamities, explosions, combat, voices, work, 10 ambience beds), `canStart` (cooldown and instance cap), Age loudness table. |
| `synth.ts` | Pure PCM renderer for a recipe (tone and noise layers, RBJ biquads, LFO). Deterministic per sound id. Beds render whole cycles and run the filter around the loop so the seam is continuous. |
| `mix.ts` | dB to gain, stereo pan, distance gain (d0 8 zoomed in, 40 zoomed out), one-pole smoothing (attack and release constants), music ducking envelope. |
| `options.ts` | B9 options: defaults, perceptual slider law, category-to-option routing, tolerant parsing of saved options, spatial scale. |
| `engine.ts` | `AudioEngine`: creates the graph on `unlock()` (first gesture), applies options, plays sounds through the model, stops stolen voices, ducks music. Takes a context factory, so tests use a fake. |

## Wiring for the UI

1. Call `engine.unlock()` from the first `pointerup`, `touchend` or `keydown`.
2. `engine.play(id, nowMs, pan, distance)` for each event. `pan` and `distance` come from `panFor` and `distanceGain` for spatial sounds, or `0` and `1` for flat ones. A `false` return means the sound was not started.
3. `engine.setHidden(hidden)` from `visibilitychange`.
4. `engine.applyOptions(options)` when the options change. Options are stored by the app in `settings`, never in a Chronicle. Parse them with `parseAudioOptions`.
5. `engine.stopSound(id)` to stop a bed, for example when its Age ends.

## Not built yet (16 section B)

- Music stems are synthesised stand-ins, not recorded stems. Built: the stem table, the scheduler, Bed A/B alternation, breathing and frequency rests (`breathing.ts`), the Age, biome and mood feed from the snapshot (`feed.ts`), the overview and pause low-pass.
- The feed is realm-wide, not view-limited: the worker does not know the camera, so "biome share in view" and "mood in view" are realm approximations. Night and the calamity flag are not fed yet (they stay at 0 and false).
- The biome-to-family map (`feed.ts`) and the mood scales are content guesses marked TUNE.
- Most of the B2 file list (about 56 of about 660 files are represented). Voices are synthesised stand-ins, not recordings.
- Per-category bus gains for ambience and voices are handled by sub-buses in the engine; the model still has four buses.
- Mono downmix (B9 `mono`) and visual sound cues are stored as options but not applied.
- Haptics and the `reduceLoudSounds` limiter level are applied only to the compressor and master trim.
- Rendering happens on the main thread on first play of each sound (about 0.1 to 0.2 s for an 8 s bed at 8 kHz; more at 32 kHz). Pre-render at unlock if it causes a hitch.
- Phone profile sample rate (32 kHz) is a context factory option, not set by default.
- Category caps for summons, gadgets and statuses fall back to the default cap of 4.
