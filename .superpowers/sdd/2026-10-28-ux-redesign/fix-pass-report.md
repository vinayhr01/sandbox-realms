# Fix pass: end of UX redesign (part 3)

Branch `feat/ux-redesign`, starting at d873008. Commits: 5c2ffed (A and B), plus the C commit listed at the end.
Not merged, not pushed. No sim code changed (GOLDEN_HASH untouched).

## A. Important findings from final-review.md

1. **Info card "More" for beings outside the sample.** Fixed.
   - `locateBeing` (main.ts) now returns `facts` (stage and state from the feed, e.g. "Adult, Walking") and `detailed`
     (the being is in the latest snapshot's `detail.notable.beings`, or is a favourite).
   - InfoCard shows the facts line; More is `disabled` (with a title) when not `detailed`.
   - Tests: shell-infocard.test.tsx (facts shown, More disabled and does not open, feedFacts).
2. **False "First extinction".** Fixed.
   - Only `found` is saved (`saveDiscovery`). `parseDiscovery` returns `seen: []`, so an old save's lifetime species are dropped.
   - `seen` is per realm and in memory: `setRealmSide` clears it.
   - `noteDiscoveries` skips evaluation while `resumingWorld` is true.
   - Test: discovery.test.ts (parse drops `seen`).
3. **Shortcuts and pan behind the Atlas or inside tab lists.** Fixed.
   - New helpers in keymap.ts: `shellKeysBlocked(e, atlasOpen)` (defaultPrevented, Atlas open, or an open native dialog) and
     `panBlocked(target)` (typing, tablist, dialog, textbox).
   - The window keydown handler returns early for shellKeysBlocked, and does not add pan keys when panBlocked.
   - Tests: keymap.test.ts (both helpers). The arrows in the Atlas tablist are covered by a11y-keys.spec.ts.
4. **Esc does not collapse the expanded sheet.** Fixed.
   - `installAtlasKeys` (Atlas.tsx) gets a fourth layer after the info card: an expanded sheet collapses, focus returns to
     `.sheet-handle`, and the event stops. It also runs from the sheet search field.
   - Tests: shell-atlas.test.tsx (info card first, then sheet; from the search field).
5. **Held digits re-arm.** Fixed. The `e.repeat` check runs before the digit branch in `dispatchKey`.
   - Test: keymap.test.ts "a held digit does not arm its power again".

Not changed (judgement): 1-9 still toggles a power that is already armed on a single press. The review said "consider", and
the click path toggles the same way, so the two match.

## B. Minor items

Done (each under 10 lines):
- Info card cleared on a new, loaded or respawned realm, and effects cleared (setRealmSide).
- Favourites cap = 9 (`MAX_FAVOURITES`, which also caps the loaded prefs). Tests updated from 12 to 9.
- Cooldowns published only for powers with `cooldownMs > 0`.

Skipped (not in the cheap set; listed for later):
- Info card rAF loop: cache the host rect and stop the loop after "Gone".
- Info card clamp before translate (InfoCard.css) and off-screen hide.
- Brush dust effect along the stroke (flushStroke plays nothing).
- "New" markers on the expanded grid and seen markers in discovery state.
- No Atlas World toggle for "Hide interface" (touch users cannot restore the UI).
- Dead code: stepBrush, selectTab, TabState, powersInTab.
- KEYMAP lists "=" and "-" as NumpadAdd/NumpadSubtract; F pin and long-press are not in KEYMAP.
- SettingsPanel Keys rows use keyless fragments.
- Towns pill counts tier 'town' while "First town" fires on any hamlet.
- "first-strain" can fire on an extinction.
- Toasts sit under the Atlas (z-index 10 vs 40).
- autosave stops while the Atlas is open (`modalOpen`).
- Ladder step 1 (`map.effects`) frees nothing when no effect plays.
- aria-controls on the tablist rather than each tab.
- Focus return for confirmations relies on native `<dialog>`.
- Unmeasured: 360x640 overflow with info card, pad and minimap.

## C. Playwright failures

Run one at a time: `--workers=1`, `SR_SKIP_PERF=1 SR_E2E_PORT=4249`, foreground.

1. **windows-spec.spec.ts:75 "the developer windows say they are off by default"** (desktop-chromium). Test bug, not a
   window bug.
   - Root cause: `openRealm` in that spec sets `dev.enabled: true`. The test then opened a live Developer console and
     never saw the gate.
   - Second cause, found on re-run: with the switch off, the developer windows are not Atlas sections at all
     (`atlasRoutes.ts`, DEV list, listed only while the switch is on). The test's Atlas lookup could never find them.
   - Fix (test only): `openRealm(page, { 'dev.enabled': false })`, assert no section in the Atlas, then reach the gate through
     the `showWindow` hook (`openConfirmation`), as the confirmations do.
   - Result: passes.
2. **smoke.spec.ts:54 "inspect: tapping a tile reports its elevation and ground"** and
   3. **smoke.spec.ts:87 "paused edits still apply and the clock stays put"** (phone-landscape). Product bug.
   - Root cause (diagnosed by elementFromPoint at the tile's screen point, 844x390): the first-launch coach card
     (`.coach`, styles.css) had `pointer-events: auto` over its whole 360px box. The coach is a non-modal hint, and at landscape
     phone size it sits over the map's top middle. The tap landed on `.coach-text`, so the map never got the click.
   - Fix: `.coach { pointer-events: none }`, and `.coach-skip { pointer-events: auto }`, so only Skip takes taps.
   - Result: both pass on phone-landscape. All smoke passes on desktop-chromium, phone-portrait, tablet and phone-landscape (24/24).
     platform-smoke passes at 360x640 and 1920x1080 (4/4).
4. **keys.spec.ts:12 "pressing 1 after arming two powers arms the most recent"** (desktop-chromium). This was one of the two
   unnamed failures. Found by running the Task 4-8 specs after the fixes above.
   - Root cause: the test encoded the old Esc (one Esc disarms). Fix A4 makes the first Esc collapse the expanded sheet, so the
     grid it read was gone.
   - Fix (test only): two Escapes (collapse, then disarm), and assert on the collapsed "Disarm Lower" badge.
   - Result: 5/5 pass.
5. **a11y-keys.spec.ts:15 "keyboard only: sheet, chip tablist, arm, Atlas tabs, settings search, Esc"** (desktop-chromium).
   The other unnamed failure.
   - Root cause: test locator. The sheet's own "Peoples" chip stays in the DOM under the modal Atlas, so
     `getByRole('tab', { name: 'Peoples' })` matched two elements.
   - Fix (test only): Atlas tabs are read inside `.atlas`.
   - Result: passes.

## Specs run and results

- `npx tsc -p tsconfig.json --noEmit`: exit 0 (after A/B, and again after the CSS change).
- `npx tsc -p tsconfig.sim.json --noEmit`: exit 0 (both times).
- Unit, `--maxWorkers=1`:
  - First run, 9 files (discovery, keymap, power-catalog, shell-power-prefs, ui-panels, shell-atlas.tsx, shell-infocard.tsx,
    atlas, atlas-failure): 83/84, one test-side fault (`preventDefault` on a non-cancelable event), fixed.
  - Re-runs: keymap 17/17; shell-infocard + shell-atlas + keymap 39/39.
- E2E, desktop-chromium, `--workers=1`:
  - windows-spec: 24 pass, 1 fail (fixed); re-run of the fixed test passes.
  - windows + keys: 10 pass, 1 fail (keys, fixed); keys re-run 5/5.
  - a11y-keys: 1 fail (fixed); re-run passes.
  - discovery + creatures: 10/10.
- E2E, phone-landscape, targeted: 2 fail, then 2/2 pass after the coach fix.
- E2E, smoke across desktop, phone-portrait, tablet, phone-landscape: 24/24.
- E2E, platform-smoke at 360x640 and 1920x1080: 4/4.
- Not re-run: finish-saves, windows-catalog, panels and the other specs of the full pass (they passed then, and the Esc change
  only affects them when Esc is pressed with the sheet open; the ones that press Esc inside the Atlas or with the card open
  were read and are unaffected). No perf, no full suite, no determinism check (no sim change).

## Files changed

- src/app/main.ts: window key gate, locateBeing facts/detailed, setRealmSide clears (info, effects, seen), noteDiscoveries
  resume guard, save only `found`, cooldown publish gate.
- src/ui/shell/keymap.ts: repeat check before digits; `shellKeysBlocked`, `panBlocked`.
- src/ui/shell/Atlas.tsx: Esc layer four (expanded sheet).
- src/ui/shell/InfoCard.tsx, InfoCard.css: facts line, More disabled, `feedFacts`.
- src/ui/shell/store.ts: locateBeing type.
- src/ui/shell/discovery.ts: parseDiscovery drops `seen`.
- src/ui/panels/powerBar.ts: MAX_FAVOURITES = 9.
- src/ui/styles.css: coach pass-through.
- tests/unit: keymap, shell-infocard, shell-atlas, discovery, ui-panels, shell-power-prefs.
- tests/e2e: windows-spec, keys, a11y-keys.
