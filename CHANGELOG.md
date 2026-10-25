# Changelog

All entries come from the section headings of `DECISIONS.md` (line numbers in brackets). The project did not record version numbers or dates while it was built, so the history is grouped by round, not by release. Nothing here is a claim that a section was tested: most were built by code reading, and the golden hash was not re-baselined after the Beings build 3 work. See `DECISIONS.md` for the scope and status of each section, and `QA-LOG.md` for what has been run.

## 0.1.0

First version number in `package.json` for this project (set in Release close 4; the file read 1.0.0 before). It marks the pre-release state recorded below. It is not a release sign-off: see `RELEASE-CHECKLIST.md`.

### Milestone builds (M0 to M12)

- Built on M0 and M1 [30]
- Milestones 2 and 3 [50]
- Ecosystem history (M3) [58]
- Milestones 4 and 5 [68]
- Milestones 6 to 12 (slices built in parallel) [74]
- Merge of the parallel units [84]

### Fix and content rounds (early)

- Fix rounds [91]
- Beast stats and nectarbuzz [102]
- Worldgen round 2 [107]
- Terrain round 2 [117]
- Beings round 2 [132]
- Powers [146]
- Ecosystem and content counts (current) [153]
- Open items [159]

### Rounds 3 to 7

- Powers round 3 [166]
- Powers round 4 [178]
- Clans (kinbands) [222]
- Items round 1 [235]
- Dominions round 2 [252]
- Hamlet founding round 3 [268]
- Items round 3 [277]
- Settings round 3 [301]
- Pacts and armies round 3 [339]
- Settings round 4 [360]
- Pacts and armies round 4 [388]
- Pacts and armies round 5 [405]
- Map layers round 5 [428]
- Garrison and coins round 4 [443]
- Map layers round 6 [459]
- Map layers round 7 [492]
- Art round 6 [515]
- Engine runtime round 6 [540]
- Beings round 6 [556]
- Beings round 7 [613]
- Testing pass after round 6 merges [646]
- Crash record and release round 7 [652]
- Settlements round 4 [690]
- Golden and test pass after the round 4 to 7 merges [722]
- Dominion campaign fix [729]

### Releases and close-outs (first set)

- Settlements and creeps release [740]
- Dominions and culture release [798]
- Combat release [836]
- Clock, worldgen and flora release [866]
  - Frame clamp (decision) [872]
  - Resumable worldgen jobs (03 section 10) [878]
  - Flora from 18d [889]
- World and input release [930]
- Beings release [979]
- Jobs release 2 [1027]
- Landmark powers and folk fights [1057]
- Window list and insight release [1073]
- Garrison release 2 [1103]
- Rulers release [1119]
- Boats release [1139]
- Customs and roads release [1163]
- Roads close-out [1207]
- Garrison close-out [1217]
- Jobs close-out [1230]
- Golden review [1256]
- Customs close-out [1304]

### Fix rounds and build rounds 3 (later)

- Batch fix round 5 [1346]
- Round 6 fixes and golden re-baseline [1380]
- Browser matrix: Firefox removed [1385] (Firefox stays configured in Playwright and CI, but it could not launch on the dev machine; see `RELEASE-CHECKLIST.md`)
- Garrison build 3 [1390]
- Rulers and worldgen hand-off [1403]
- Boats build 3 [1418]
- Customs build 3 [1436]
- Jobs build 3 [1461]
- Insight build 3 [1474]
- Combat build 3 [1502]
- Beings build 3 [1548] (golden hash not re-baselined; see the section)
- Batch fix round 8 [1611] (the golden hash was not edited)
- Road decay [1633]

### Release close 4

- Release close 4: CHANGELOG.md, RELEASE-CHECKLIST.md, QA-LOG.md entry, package.json version 0.1.0. No tests, typecheck, build or browser run. `GOLDEN_HASH` not edited. [see the "Release close 4" section at the end of `DECISIONS.md`]
