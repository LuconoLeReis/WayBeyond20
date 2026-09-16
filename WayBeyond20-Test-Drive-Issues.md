# WayBeyond20 Test Drive Issues

Test build: WayBeyond20 v1.61 / 2.20.61

Started: 2026-09-07

Purpose: Persistent observations from first-hand testing in a dedicated Chrome profile. This file separates observed behavior from suspected causes and proposed changes.

## Test environment

- Browser: Chrome, dedicated test profile
- D&D Beyond character: dedicated test Bard
- Character URL: omitted from the public test record
- VTT: Roll20 test campaign
- Loaded extension source/build: to be verified in Chrome before testing

## Issue list

### WB20-TD-001 Bardic Inspiration row still uses the wrong visual model

- Status: Confirmed by first-hand UI inspection
- Severity: Moderate usability and rules-presentation defect
- Surface: D&D Beyond Actions tab, Bonus Actions section
- Observed in: WayBeyond20 v1.61 on a dedicated Bard test character
- Observed behavior:
  - Bardic Inspiration appears beneath the attack-style headers `ATTACK`, `RANGE`, `HIT / DC`, `DAMAGE`, and `NOTES`.
  - The row displays `-- Range --` even though the live Bardic Inspiration description on the same sheet says 60 ft.
  - The `Inspire` button is present and reports four uses remaining.
  - The row displays `1 Use (4/4)` but does not display the character's current Bardic Inspiration die, `d8`, as useful non-rollable information.
  - After two native uses were expended, the `Inspire` button correctly reported two remaining and two native boxes were checked, but the custom row still displayed `1 Use (4/4)`. Its visible count is stale.
- Expected behavior: A compact feature-oriented row showing Bardic Inspiration as a Bonus Action, its 60 ft. range, current d8 die, remaining uses, and a clear Inspire control without attack/melee semantics.
- Cause: Not yet determined in this test drive. Existing source inspection indicates the custom activation is still inserted into D&D Beyond's Bonus Actions attack-table structure.

### WB20-TD-002 Agile Strikes requires two unnecessary configuration dialogs

- Status: Confirmed by first-hand activation test
- Severity: High usability friction
- Reproduction:
  1. Click `Inspire`.
  2. Accept `Make Strike` in the Agile Strikes prompt.
  3. Observe the ability-selection dialog.
  4. Continue and observe the damage-mode dialog.
- Observed behavior:
  - The first dialog asks the player to choose Strength or Dexterity even though Dexterity is already selected as the better legal option.
  - The second dialog asks the player to choose Normal Unarmed Strike, Natural Weaponry with Strength, Natural Weaponry with Dexterity, or Bardic Damage.
  - Bardic Damage `1d8 + 3` is already selected as the strongest legal option for this level-8 test character.
- Expected behavior: After the player accepts the granted strike, WayBeyond20 should automatically use the strongest legal attack ability and damage mode, avoiding both dialogs.
- Cause: Not yet determined in this test drive; the existing generic Unarmed Strike resolver visibly exposes both intermediate choices.

### WB20-TD-003 Dance Virtuoso does not recognize D&D Beyond's existing Advantage state

- Status: Confirmed by first-hand test
- Severity: Moderate; creates an unnecessary prompt and risks confusing the roll flow
- Preconditions: The level-8 test character's Performance skill visibly shows D&D Beyond Advantage from Dazzling Footwork.
- Reproduction:
  1. Open the Performance skill sidebar.
  2. Click its WayBeyond20 roll control.
- Observed behavior: WayBeyond20 still asks whether the Performance check involves dancing even though the sheet already marks the skill with Advantage.
- Expected behavior: Skip the dancing question when the outgoing roll is already Advantage or Super Advantage.

### WB20-TD-004 Dance Virtuoso Yes response falls through to a redundant roll-mode dialog

- Status: Confirmed by first-hand test
- Severity: Moderate usability friction
- Reproduction:
  1. Trigger the Dazzling Footwork dancing question.
  2. Choose `YES - DANCE`.
- Observed behavior: WayBeyond20 opens a second dialog showing the Dazzling Footwork Advantage note and asks the player to select a roll mode, with Advantage preselected.
- Expected behavior: Apply Advantage and roll through the normal configured path without another roll-mode choice.

### WB20-TD-005 Non-natural Unarmed Strike paths still inherit Draining Attack automatically

- Status: Confirmed by first-hand Roll20 output
- Severity: High rules defect
- Reproduction: Roll Agile Strikes using Bardic Damage, roll direct Bardic Damage, or roll the native generic Unarmed Strike; inspect each Roll20 card.
- Observed behavior: All three paths included `Draining Attack: gain Temporary HP equal to damage dealt`. The generic Unarmed Strike example rolled 23 to hit; the direct Bardic Damage callback also changed Temporary HP from 0 to 10.
- Expected behavior: Automatic Draining Attack intent must be limited to the qualifying natural-attack names/rules path. Agile Strikes, Bardic Damage, and generic Unarmed Strike should not receive it merely because they are Unarmed Strikes; any legitimate combination should be an explicit modular choice rather than silent name inference.
- Note: This contradicts the v1.46 current-state claim that the name-inference path was narrowed successfully, so it requires fresh source/runtime diagnosis.

### WB20-TD-006 Tracked Stealth effect is not visibly identifiable and did not affect the next attack

- Status: Confirmed UI/roll observation; intended mechanical scope needs confirmation
- Severity: Moderate usability/rules gap
- Reproduction:
  1. Roll Stealth; the test result was 26.
  2. Observe the Defenses area and make the next attack.
- Observed behavior:
  - A `BUFFS` heading appeared beside `DEFENSES`, but no visible Stealth or Invisible item, value, removal control, or duration was shown.
  - The immediately following Fangs/Claws attack loaded only one d20 and rolled normally rather than with Advantage.
- Expected behavior: At minimum, the tracked effect should be visibly identifiable and manageable. If the tracked Invisible effect is intended to affect attack rolls, the next qualifying attack should receive Advantage and consume/end the effect as the rules require.

### WB20-TD-007 Inspire counts unrelated checkboxes while the Short Rest sidebar is open

- Status: Confirmed by first-hand UI state change
- Severity: High reliability defect
- Reproduction:
  1. Restore all four Bardic Inspiration uses; the custom button reports four remaining.
  2. Open D&D Beyond's Short Rest sidebar, which includes eight Hit Die checkboxes.
  3. Inspect the custom Inspire button's help text.
- Observed behavior: The Inspire button changed from four remaining to `12 Bardic Inspiration uses remaining`. Closing the Short Rest sidebar immediately returned it to four.
- Expected behavior: The custom control must count only the four native Bardic Inspiration use boxes belonging to that feature, never unrelated checkboxes elsewhere in the open sheet/sidebar.
- Suspected cause: The runtime count appears to use an overly broad visible-checkbox selector. This is an inference from the exact 4-to-12-to-4 change and requires source confirmation.

## Confirmed working observations

- The test character is a level-8 Dhampir Bard; identifying details are intentionally omitted.
- WayBeyond20 is injected into the character sheet.
- The persistent Hit Dice tracker displays `8d8`, matching the test character's Bard level.
- Bardic Inspiration exposes an `Inspire` button and detects four unused native uses before activation testing.
- Clicking `Inspire` consumed exactly one native Bardic Inspiration use: the first D&D Beyond use box changed from unused to used and the button updated from four to three remaining.
- Inspire did not roll the Bardic Inspiration die itself.
- Inspire offered the Agile Strikes continuation without asking for a meaningless target.
- The completed Agile Strikes test used Dexterity and Bardic Damage, rolled 18 to hit and 5 Bludgeoning damage, and appeared in Roll20 under `Agile Strikes - Unarmed Strike`.
- The Roll20 result included the Draining Attack rider. Temporary HP remained 14 because the resolved damage of 5 was lower than the existing Temporary HP; the rider's presence is recorded as WB20-TD-005 rather than counted as correct behavior.
- The persistent Hit Dice controls work in both directions. Spending one changed the display from `8d8` to `7d8`; the state remained visible after subsequent feature rolls.
- A direct Bardic Damage attack reached Roll20, and its deferred `Roll Damages` callback dealt 10 Bludgeoning damage. The callback successfully changed D&D Beyond Temporary HP from 0 to 10, but the automatic Draining Attack qualification is recorded as WB20-TD-005.
- A direct Fangs/Claws (Dexterity) attack reached Roll20, and its deferred `Roll Damages` callback dealt 9 Slashing damage. Draining Attack then changed D&D Beyond Temporary HP from 0 to 9.
- Clicking the direct Blood and Bone `d8` control sent a `Blood and Bone` healing result of 8 to Roll20 without spending the character's own Hit Die; the tracker remained `7d8`.
- Clicking Blood and Bone `Use` opened a target-facing selector labeled `Select your target's Hit Dice size`, defaulted to `d8`, with `ROLL` and `CANCEL` controls.
- Starting an Initiative roll opened the Combat Window automatically as `D&D Beyond Initiative - Turn 1`, with Movement 30 ft., Action 1, Bonus Action 1, Reaction 1, New Turn, and End Combat controls.
- The Initiative roll reached Roll20 as 18.16 with the configured Dexterity tiebreaker (`+3.16`). Roll20 also correctly warned that no valid token was selected for the turn tracker.
- Blood and Bone spent the available Action, changing the Combat Window from Action 1 to Action 0. A second attempt displayed `No Action Available` with Proceed and Cancel; Cancel produced no second roll.
- `New Turn` advanced the window to Turn 2 and restored Action from 0 to 1.
- In combat, Inspire spent the available Bonus Action, changing it from 1 to 0, while consuming exactly one additional native Bardic Inspiration use and presenting the optional Agile Strikes continuation.
- Blood and Bone with Triage Expert loaded two d8 dice into D&D Beyond's tray for a d8 target, confirming the extra healing die was added before the roll.
- Cure Wounds loaded three d8 dice (2024 base 2d8 plus the Bedside Manner die) and reached Roll20 as 17 healing with the `Triage Expert: Bedside Manner` effect label.
- Healing Word loaded three d4 dice (2024 base 2d4 plus the Bedside Manner die) and reached Roll20 as 11 healing with the same effect label.
- A standard Deception skill check reached Roll20 with the live +10 modifier and a result of 15.
- A Dexterity saving throw reached Roll20 with the live +6 modifier and a result of 7.
- A raw Strength ability check correctly applied Jack of All Trades, changing the sheet's +0 ability modifier to a +1 check; Roll20 labeled the effect and showed the full `1d20 + 1` breakdown.
- `End Combat` removed the Combat Window cleanly after the resource-reset tests.
- Test cleanup restored the Hit Dice tracker to its original `8d8` state.
- Test cleanup restored Temporary HP to its original 14 and all four Bardic Inspiration uses.
- A qualifying Stealth roll of 26 reached Roll20 and caused a `BUFFS` section heading to appear on D&D Beyond.

## Testing limitations encountered

- Opening the sheet-level `WAYBEYOND20` settings control displays a Chrome extension UI that temporarily blocks the connected automation interface from controlling the D&D Beyond tab. This is an automation limitation, not yet classified as a WayBeyond20 product defect.
- The connected browser-control API exposes click and keyboard actions but no hover action, so the hover-popup placement and exact `Combat Window` label could not be exercised directly. Automatic Combat Window behavior was tested instead.
- Savage Attacker and Use Magic Device could not be exercised on this level-8 test character because those features and their qualifying equipment/spellcasting paths are not present.

## Test notes

Each entry will record:

- What was tested
- What was directly observed
- Expected behavior
- Reproduction details
- Evidence such as visible UI state or debug-log output
- Whether the cause is known, suspected, or not yet determined
