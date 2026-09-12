# WayBeyond20 Current State

Last reconciled: 2026-09-11 — v1.64 development build

This file is the continuity authority for current source, verified build state, known limitations, and the remaining release gate. It must not be used as a substitute for inspecting the actual source or package.

## Source of truth

Use this evidence order:

1. The checked-out Git source in `WayBeyond20-Master`, including the current branch and working tree.
2. A clean build from that exact source and the synchronized unpacked folder `WayBeyond20-Dev`.
3. First-hand behavior in the loaded Chrome extension and connected Roll20 campaign.
4. A release ZIP produced from the verified build and its recorded SHA-256.
5. Historical source/Chrome ZIPs and development conversations only as provenance; their names do not prove that they are current.

Never choose a folder merely because its name contains `src`, `Master`, or `Dev`. Verify manifest version, Git state, hashes, and actual runtime behavior.

Project location:

`C:\Users\Bill Light\Solheim Enterprises Dropbox\Bill Light\Projects\Mods`

## Current release candidate

| Item | Current value |
| --- | --- |
| WayBeyond20 candidate | v1.64 development build; not released |
| Internal package/manifest version | 2.20.64 |
| Extension platform | Chrome Manifest V3 |
| Upstream baseline | Beyond20 2.20.1 |
| Authoritative source | `WayBeyond20-Master`, `main` at tag `v1.63` |
| Loadable Chrome build | `WayBeyond20-Dev` |
| First shared release ZIP | `WayBeyond20-chrome-v1_63.zip` — SHA-256 `377086881D6EB90D2EEF9E20D36E1606B4868A6AC1A58E77D3D023FA12E6C503` |
| GitHub release | [v1.63 — First Shared Release](https://github.com/LuconoLeReis/WayBeyond20/releases/tag/v1.63) |

## Recovery provenance

- `WayBeyond20-chrome-v1_61.zip` and `WayBeyond20-source-v1_61.zip`, built September 7, 2026, are the last verified working pair before the faulty v1.62 packaging work.
- v1.61 was inspected directly; it was not copied wholesale because the September 7 Chrome tests also identified rules defects that later source changes correctly addressed.
- The v1.63 candidate retains the corrected natural-weapon-only Draining Attack behavior, exact Bardic limited-use matching, automatic Agile Strikes choices, and Dazzling Footwork improvements.
- The character-sheet freeze was traced to unconditional Bardic card DOM writes inside a document-wide MutationObserver. v1.63 makes those writes idempotent.

## Build and verification record

- `package.json`, `package-lock.json`, `manifest.json`, and `manifest_ff.json` report 2.20.64; both manifests display WayBeyond20 1.64.
- `npm test` passes the v1.63 regression checks and the v1.64 smite checks.
- `npm run build` completed successfully for Firefox and Chrome on September 11, 2026.
- Changed authored JavaScript passed `node --check`.
- `build\chrome` was mirrored to `WayBeyond20-Dev`; the built and loadable `dist\dndbeyond_character.js` hashes match.
- `build\chrome` was mirrored to `WayBeyond20-Dev`; the built and loadable `dist\dndbeyond_character.js` hashes match.
- v1.64 live browser verification is pending a manual Reload of the unpacked WayBeyond20 entry in Chrome's Extensions page; tests run before that reload are not treated as v1.64 runtime evidence.

## v1.63 changes verified for release

### Dispatch-safe state changes

- Action, Bonus Action, Reaction, Haste Action, D&D Beyond limited-use counters, Lay on Hands points, and a one-use Stealth effect change only after a roll is actually dispatched.
- A cancelled whisper/advantage query does not spend those resources.
- When Roll20 explicitly shows a different current combatant, an Action or Bonus Action from another open sheet requires a clear override and does not spend that sheet's turn resource. Reactions remain legal off-turn.

### Oath of the Watchers

- Watcher's Will sends only its own paragraph rather than the combined Channel Divinity description.
- It spends Action and the shared Channel Divinity pool and tracks one minute of Advantage on Intelligence, Wisdom, and Charisma saving throws for the paladin.
- Abjure the Extraplanar sends only its own paragraph, includes the live Paladin spell-save DC, and spends Action plus the shared Channel Divinity pool.
- Ally selection and Roll20 distance/creature-type enforcement are intentionally not fabricated. The feature card communicates those rules for the table.

### Lay on Hands

- The healing action asks for a whole-number amount, sends that healing to the VTT, and then reduces the native D&D Beyond healing pool.
- Purify Poison and Restoring Touch spend five pool points per dispatched use.
- The automation must be live-tested against D&D Beyond's current React controls before release.

### Oath of the Noble Genies

The official subclass name is **Oath of the Noble Genies**.

- Dao's Crush is represented as an effect applied after Divine Smite with an escape DC, not as a false initial attack roll or Strength save.
- Djinni's Escape sends its teleport/defense text and tracks its self buff until the end of the next turn.
- Efreeti's Fury and Marid's Surge retain D&D Beyond's native damage/save data and use the shared Channel Divinity pool.
- Elemental Rebuke prompts for Acid, Cold, Fire, Lightning, or Thunder; rolls `2d10 + Charisma modifier`; includes the Dexterity save/half-damage rule; spends Reaction; and marks its native use.
- Noble Scion spends a Bonus Action, marks its native use, and tracks the ten-minute flight/Minor Wish reminder.
- Genie’s Splendor and Aura of Elemental Shielding remain passive/displayed rules. WayBeyond20 does not invent token-distance, ally-aura, armor-choice, or automatic-resistance automation that the current bridge cannot verify.

### Other corrected behavior

- Non-damaging spells such as Shield of Faith now have both **Cast on VTT** and **Display** so their activation and persistent effect can be tracked.
- Savage Attacker on Roll20 compares two complete base weapon-damage formulas, for example `{2d6 + 4, 2d6 + 4}kh1`, rather than rolling 4d6 and keeping two individual dice.
- Bardic Inspiration card refreshes do not continuously mutate the same DOM text and attributes.

## Known limitations

1. Foundry and generic destinations preserve the original Savage Attacker formula until their grouped-roll grammar is verified; the corrected grouped comparison is currently Roll20-specific.
2. Automatic effect duration countdown/expiry and remote concentration-dependency cleanup remain unfinished.
3. `BASE_ARMOR` is recorded but does not replace D&D Beyond's native armor calculation.
4. Most parsed target eligibility flags are recorded but not universally enforced.
5. Remote target effects require the matching D&D Beyond character sheet to be open.
6. Foundry does not yet have the inspected combat callbacks used for Roll20 turn/resource synchronization.
7. Oath aura positioning, creature-type qualification, and damage-ending conditions are table-facing rules unless the connected VTT exposes reliable data.

## v1.63 live release record

- `main` contains commit `ae6f331` and tag `v1.63`.
- GitHub release asset: `WayBeyond20-chrome-v1_63.zip` at `https://github.com/LuconoLeReis/WayBeyond20/releases/download/v1.63/WayBeyond20-chrome-v1_63.zip`.
- The downloaded GitHub asset was re-hashed on September 11, 2026: SHA-256 `377086881D6EB90D2EEF9E20D36E1606B4868A6AC1A58E77D3D023FA12E6C503`; size 1,239,019 bytes.

1. Reload `WayBeyond20-Dev` from `chrome://extensions` and refresh D&D Beyond/Roll20 tabs.
2. Load Calan and confirm the sheet remains responsive with the Bardic feature card present.
3. Load every available character sheet and confirm WayBeyond20 injection without freezes or cross-character leakage.
4. On Calan, recheck Bardic native counts, Short Rest isolation, Agile Strikes, Dazzling Footwork, natural-attack Draining qualification, generic-Unarmed exclusion, Stealth consumption, and one representative Savage Attacker path if available.
5. On Balasar, check Watcher's Will, Abjure the Extraplanar, Lay on Hands, Breath Weapon, Shield of Faith, Action/Bonus Action handling, and native counter restoration after testing.
6. On the official Noble Genies sample, check all four Elemental Smite cards, Elemental Rebuke, Noble Scion, Genie’s Splendor, and Aura of Elemental Shielding without leaving resource mutations behind.
7. Inspect representative results in Roll20.
8. Rebuild after any correction, rerun syntax/regression checks, resynchronize `WayBeyond20-Dev`, and repeat the affected live checks.
9. Create a clean ZIP containing one top-level `WayBeyond20` folder and only loadable extension files, `README.txt`, `Updates.html`, `Updates.css`, and required licenses/resources.
10. Validate the extracted ZIP, record SHA-256, commit/merge/tag v1.63, publish the GitHub release, and verify the downloadable asset.

## Release workflow

1. Inspect Git status, manifest versions, current Dev path, and historical evidence before editing.
2. Edit authored files in `src`, not compiled `dist` files.
3. Run `npm test`, `node --check` on changed JavaScript, and `npm run build`.
4. Mirror the exact Chrome build into `WayBeyond20-Dev` and verify representative hashes.
5. Reload the unpacked extension and run targeted D&D Beyond/Roll20 tests.
6. Package only the verified build under one top-level `WayBeyond20` folder.
7. Extract the ZIP to a fresh validation directory; validate manifest resources, file list, syntax, version, top-level layout, and behavior where practical.
8. Update the feature register, changelog, release notes, current state, and test record.
9. Commit, merge to `main`, tag, push, publish the GitHub release, and verify the asset download/hash.
