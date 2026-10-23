# Audio model

`model.ts` is the pure state for the audio mix: buses with volume and mute, per-category and
global voice caps, priority stealing, and a hidden-tab mute. It has no WebAudio calls and no
DOM, so it runs under Vitest and in the simulation-safe build.

## How it connects to WebAudio later

The engine (not yet written) owns one `AudioContext` and one `GainNode` per bus, with the
`master` gain feeding the destination. On every change it reads the model and applies:

- `effectiveGain(bus)` to the bus `GainNode.gain`. This already folds in master volume, bus
  mute, master mute and the hidden-tab mute, so the engine sets one number per bus.
- `play(category, priority, now)` before starting a buffer source. A `null` result means do not
  start. A non-null `stolen` id means stop that source first.
- `release(id)` from the source's `ended` event, so finished voices free their slot.
- `setHidden(hidden)` from `document.visibilitychange`.
- `serialize()` and `restore()` for the options panel, stored by the app as a string.

The model does not own the sources. The engine keeps a map from voice id to its source node.

## Rules

- Volumes are clamped to 0..1; NaN becomes 0. Mute keeps the saved volume.
- A voice cap per category (`CATEGORY_CAPS`, default 4 for unknown names) and a global cap
  (`GLOBAL_CAP`, 24).
- When a cap is full, the weakest voice (lowest priority, oldest among equals) is the victim. It
  is dropped only if the new voice is strictly more important. Otherwise the new voice is refused
  and nothing changes.
- When the category is full, its own weakest voice is the victim, and that also frees the global
  slot. Voices in other categories are never dropped for a full category.
- Hidden tabs refuse new voices and report zero gain. Existing voices stay in the list and the
  engine mutes them through the gain.
- `restore()` accepts a string or an object. Bad input never throws. Only finite numbers for known
  buses are applied; other buses keep their current values.

## Open items

- Category to bus mapping is not in the model. `play()` does not check the bus mute. The engine
  should skip starting voices for a muted bus, or the model needs a category-to-bus table.
- Existing voices are not stopped on hide. If the engine should stop them, it has to release
  them itself.
- Priority values for each sound are not assigned yet (16 section B3 table).
- The desktop cap of 24 is a constant. A mobile cap of 16 needs a constructor option or a
  separate constant.
