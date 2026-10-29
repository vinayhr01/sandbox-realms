# Illustrated power icons: design

## Intent
On the power sheet only the 90 creature powers have drawn art. Every other power shows a one-colour line glyph, and most share one shape per category (every Land paint is the same wave, most Disasters the same bolt), so the other tabs look plain and hard to scan. The owner wants every category chip and every power in every tab to have its own illustrated SVG, like the creatures.

## Goals (owner)
- An illustrated SVG for each of the 8 category chips and each non-creature power (about 160).
- Same style as the creature art: full colour, soft gradients, warm dark outlines, a little light and shade (sample approved 2026-10-29: Raise, Volcano, Rain, Lightning, Bless, Lore, Pause, hut).
- Larger download is acceptable.

## Non-goals
- No change to creature art, map rendering, the sim or saves.
- No animated icons.

## Anti-goals
- Icons that look alike within a category (the problem being fixed).
- Icons that are unreadable at the 38 px button size.
- A slower first paint of the sheet: the art must load lazily like the creature art.

## Constraints
- Determinism untouched (GOLDEN_HASH 1357125849); main bundle stays within 350 KiB gzip.
- Each SVG passes the existing art lint (size limit per file, LF endings).
- Ids stay as they are; the icon is keyed by power id.

## Approaches
1. **One hand-drawn SVG per power, lazy-loaded per category (picked).** Distinct, easy to replace one at a time; about 160 files.
2. Composed in code from shared parts: much smaller, but icons look alike. Rejected.
3. Reuse existing art where it fits (buildings for Peoples, map flora for Nature): folded into 1 as a cost saver.

## Design
- Files: `src/art/powers/<chip>/<power_id>.svg` plus `src/art/powers/chips/<chip>.svg`, viewBox 0 0 128 128, ids inside each file prefixed with the power id (as the creature files do) so inline gradients never clash.
- One lazy art chunk per category, loaded by the existing loader when that tab or a search result needs it; the line glyph stays as the fallback while it loads or if a file is missing. Chips' icons load with the sheet.
- Reused art (buildings, flora) is referenced, not copied.
- Budgets: the total art cap rises to fit the new chunks (owner accepts the size); each new chunk keeps a per-chunk cap.
- A unit test fails if any non-creature power or chip has no icon.

## Process (owner's rule)
Draw everything, show one gallery of all icons at button size, one round of changes from the owner's notes, then one full test pass and one fix pass, then ship.

## Left to the builder
Exact chunk names, the per-chunk cap values, and which existing art is reused for which power.
