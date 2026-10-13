# WayBeyond20 Changelog

## v1.65.14 — Concentration and native spell casting, 2026-10-13

Extension version 2.20.80. Full release collecting internal builds 1.65.11–1.65.13; those were not separate public releases.

- Damage entered while concentrating opens the editable Concentration Check window, including temporary-HP damage. Unmodified is the default; selecting a damage type opts into known unconditional defenses. Add source combines damage components for one check, without deducting HP again.
- The actual Constitution save result maintains or ends the tracked concentration effect. Cancellation, missing results and failed execution preserve it.
- Native spell-list Cast/Use buttons enter the existing spell flow and mark the selected native slot or daily use once after casting. No class or named-spell gate was added.
- Utility spell cards no longer ask for advantage. Targeted buffs support Other creature, retaining caster concentration without granting the caster the other creature's bonus.
- DEFENSES and BUFFS share a compact header; buff names appear beneath, right-aligned in the native sheet font.
- All 17 automated suites passed. Live Chrome/D&D Beyond/Roll20 testing covered attack spells, save/damage spells, healing, utility, self/other buffs, daily Use versus slot Cast, cancellation, double clicks, HP/temp-HP concentration triggers and resolved save outcomes.
- Limitations remain: conditional defenses are manual; sidebar slot/item-charge controls are not covered by the spell-list bridge; upcast/ritual/temp-HP spell branches have automated but not equivalent live acceptance. Existing Lay on Hands pool persistence and saving-throw damage-only accounting limitations remain. Foundry testing was excluded.

## v1.65.10 — Attack follow-ups and one-click attacks, 2026-10-12

Extension version 2.20.76. Stable release collecting internal builds 1.65.6–1.65.9; those internal versions were not separate public releases.

- The red-bordered attack icon runs the existing full attack; clicking the name still opens its description. Keyboard activation and hover/focus styling are supported.
- Qualifying attacks show their result before Hit / Miss confirmation and optional Smite spending. Miss skips on-hit damage/resources without refunding the attack.
- Divine Smite completes before the four-choice Elemental Strike prompt. Its existing Channel Divinity cost is preserved without an additional Bonus Action.
- Savage Attacker offers a post-damage reroll of the weapon package only, once per tracked turn including after declining. Critical dice and versatile alternatives stay in their own weapon packages; Smite and other riders are not rerolled.
- Automatic damage no longer leaves a misleading Roll20 damage link. Genuine deferred links resume the original attack once through its character sheet.
- Draining Attack's managed path waits for confirmed hit and final primary-target damage, after a Savage Attacker decision; second-target damage is excluded.
- All 16 automated suites passed. Live Chrome/D&D Beyond/Roll20 checks covered one-click and keyboard attacks, Hit/Miss, both Smite fuels, Elemental Strike, automatic/deferred damage, and Savage Attacker reroll/decline/turn reset and two-handed damage. Critical/Draining combinations have automated coverage, not full live acceptance. Foundry connection testing was excluded.
- Remaining limitations: Lay on Hands pool persistence, concentration browser prompts, saving-throw damage-only resource accounting, and deferred links requiring the original sheet to remain open without refresh.

The historical sections below retain their original build-specific status; the summary above supersedes their pending statements for the tested paths.

## v1.65.9 — local test candidate, 2026-10-12

Extension version 2.20.75. Both Roll20 rendered-card formats now suppress the extra damage link when automatic follow-ups already manage damage. Deferred and ordinary attack-only links are preserved. Not published.

## v1.65.8 — local test candidate, 2026-10-12

Extension version 2.20.74. Corrects attack-icon button spacing: centered icon, square border, rounded corners and a clear gap before the name. Styling-only correction; attack behavior unchanged. Not published.

## v1.65.7 — local test candidate, 2026-10-12

Extension version 2.20.73. Not published.

- Click the red-outlined attack icon to start the same full attack as the sidebar WayBeyond20 button. Hover/focus highlights it; Enter/Space are supported. Names still open descriptions.
- Reuses existing attack, damage, hit-confirmation and optional follow-up handling; no second attack engine or changed eligibility rules.
- All 16 automated suites and both builds passed. Live Chrome/Roll20 checks passed for the shortcut, Hit/No Smite damage, keyboard activation and Miss without damage. Broader follow-up acceptance is not implied.

## v1.65.6 — local test candidate, 2026-10-11

Extension version: 2.20.72. Not published or live-accepted.

- Applicable attack helpers wait for the attack result and a Hit answer before offering Smite. Miss/Skip does not refund the attack or spend on-hit resources.
- Divine Smite performs before the existing Elemental Strike chooser. The selected rider uses one Channel Divinity, with no additional Bonus Action or spell slot.
- Optional post-damage Savage Attacker uses the existing eligible weapon rows, retains the higher weapon package, and suppresses repeated offers within a recognized turn. Smite/elemental damage is not rerolled.
- Deferred damage continues through the originating character sheet without repeating the attack or its costs. Keep that sheet open. A Savage Attacker replacement result replaces weapon damage rather than adding another damage instance.
- All 16 automated suites and both platform builds pass; Chrome/DDB/VTT live acceptance remains pending.

Documentation reconciled 2026-10-10. Latest published release: v1.65.5 / 2.20.71. Version sections describe their own releases, not current outstanding bugs. v1.65.4 was an internal build; its roll-mode fix shipped publicly in v1.65.5. Known current limitations: Lay on Hands pool persistence, concentration browser prompts, saving-throw damage-only resource accounting, and Draining Attack hit confirmation. Final v1.65.5 live acceptance remains unrecorded; automated/build/package checks passed on 2026-10-04.

## v1.65.5 — Lay on Hands allocation correction

Prepared: October 4, 2026

Extension version: 2.20.71

Based on: Beyond20 2.20.1

Published October 4, 2026. This stable patch corrects the Lay on Hands chooser introduced in v1.65.3; it is not the first shared release of that interface.

### Fixes

- **Lay on Hands starts unallocated.** Opening the window no longer silently selects Healing, preallocates the entire pool in the preview, or disables Purify Poison before the player has chosen an option.
- **Healing defaults to one point when appropriate.** A full-health target is not presented with an automatic full-pool allocation; the player explicitly chooses the amount and can adjust it with the controls.
- **The public package and documentation now agree on the stable patch version.** The Chrome extension is 1.65.5 / 2.20.71; 1.65.4 was an internal emergency build and is not a public release.

## v1.65.3 — Rules corrections and the Lay on Hands window

Prepared: October 4, 2026
Extension version: 2.20.69
Based on: Beyond20 2.20.1

Corrections drawn from the 2024 rules, each checked against the published text before it was coded.

### Fixed

- A Versatile weapon's one-handed damage die rolled the two-handed die. The die you click is now the die you roll.
- Breath Weapon offered a smite. Smites are cast after hitting with a melee weapon or an unarmed strike; a breath weapon is a saving throw with no attack roll.
- A weapon attack rolled from an item spent no Action. Making the attack is what costs the Attack action, wherever it was clicked.
- Elemental Strike's second creature had its damage folded into the main target's totals. It is reported on its own.
- Finishing a long rest left expired effects standing. Effects shorter than the rest end, concentration ends, and longer effects are kept. Arming the rest button no longer resets anything before confirmation.
- Declining a smite was offered as "Cancel", which read as calling off the attack. The buttons now read Add Smite and No Smite, and declining never affects the attack.

### Added

- Action types. One Action buys the whole Attack action, so Extra Attack no longer asks for a second Action, and features that replace one of your attacks draw from the same pool.
- A Lay on Hands window. One touch and one bonus action: choose Healing, Purify Poison, or both, watch the pool total update as you allocate it, and confirm on yourself or another creature. The 5 points spent on Purify Poison restore no hit points. Nothing is spent unless the roll is sent.
- A per-character switch for the Lay on Hands helper, default on.

### Known limitations

- D&D Beyond does not record changes to the Lay on Hands pool, so the number returns on reload. Other behavior has recorded tests, but this statement does not certify every current live path.

## v1.65.2 — Resource accuracy and dispatch safety

Prepared: September 15, 2026

Extension version: 2.20.68

Based on: Beyond20 2.20.1

This release is for group testing. It collects the v1.65 work and two rounds of corrections found in live play.

### Fixes

- **Named uses are spent on the right counter.** A feature's use is matched to its own row on the sheet. Earlier builds could mark a neighbouring counter instead, for example spending a Breath Weapon use for a Channel Divinity option, or a Bardic Inspiration use for an ordinary attack. An ordinary attack with no limited use of its own now changes nothing. A counter whose row title includes the ancestry, such as "Breath Weapon (Fire)", is matched correctly.
- **Paladin's Smite is marked used.** After a Divine Smite paid for with the free Paladin's Smite cast, D&D Beyond shows the row as used instead of leaving it available.
- **Spell-slot smites spend the chosen slot** even when the Elemental Strike follow-up changed sheet tabs first.
- **A roll that cannot be sent spends nothing.** If the extension was reloaded or updated while a D&D Beyond tab was open, a roll from that stale tab used to consume Channel Divinity, spell slots or uses without reaching the VTT. Such a roll now reports failure, spends nothing and asks you to reload the tab.
- **Simultaneous updates no longer overwrite each other.** An attack made while hidden now both clears the Hidden effect and spends the Action; a concentration spell cast in combat both spends the Action and keeps its Concentration tracking.
- **The Smite check returns you to your tab.** Looking for prepared smites briefly opens the Spells tab; you are now returned to the tab you started on, including when you have no smite, no fuel, or you cancel.
- **The Combat window no longer draws on the Character Builder.**

### Changes

- **Elemental Strike** (Oath of the Noble Genies) offers Dao's Crush, Djinni's Escape, Efreeti's Fury and Marid's Surge as four single-click buttons with the cost shown, and Cancel keeps the Smite without spending Channel Divinity. Each option can also be used on its own from the Actions list, and the native feature text on the sheet is left intact.
- **Draining Attack** qualifies on the native Unarmed Strike and on the Agile Strikes follow-up, not only on natural weapons, and raises Temporary HP only when the new total is higher.
- **Helper switches are per character.** Turning a helper off on one character leaves your other characters alone.

### Known limitations in that historical release

- **Lay on Hands does not respond.** Its healing-amount box uses a browser prompt that Chrome suppresses when the window is not in front, and the action then stops with no message. A replacement interface is being built.
- **The Concentration check helper** uses browser pop-ups and can fail the same way. It also runs only when you click the CONCENTRATION badge.
- **Smite is offered on Breath Weapon.** D&D Beyond reports Breath Weapon's range as "Reach", so the Smite prompt appears on a saving-throw action. Cancel it; a rules-accurate trigger is coming.
- **A weapon attack rolled from an item does not count the Action** in the Combat window. Attacks listed as actions do.
- **Rolling only a damage die** on a saving-throw action such as Breath Weapon does not spend its use or Action; use the action's own roll button.
- **Draining Attack cannot tell a hit from a miss** when damage is rolled automatically with the attack, so it awards Temporary HP either way. A confirm-the-hit flow is being built.

## v1.64.1 — Prepared smite discovery correction

Prepared: September 12, 2026

Extension version: 2.20.65

Based on: Beyond20 2.20.1

### Correction from v1.64

- Replaces the fixed Divine Smite/Thunderous Smite list with discovery of the character's currently prepared or Always Prepared D&D Beyond spell rows whose names contain **Smite**.
- Caches that small prepared-smite list and invalidates it when a spell is prepared or unprepared, when the character changes, or when relevant spell resources change.
- Builds spell-slot fuel choices from the character's currently available slots and keeps Paladin's Smite legal only for Divine Smite.
- Uses each discovered row's own damage, damage type, save, and description data where D&D Beyond exposes it.

This is a corrected prerelease for group testing in D&D Beyond and Roll20. The v1.64 two-spell implementation should not be used as the generalized behavior.

## v1.63 — First Shared Release

Prepared: September 11, 2026  
Extension version: 2.20.63  
Based on: Beyond20 2.20.1

This is the first WayBeyond20 release intended for the gaming group. Earlier version numbers were internal development and packaging checkpoints, not supported public releases.

### Upgrades from Beyond20

- WayBeyond20 identity, branding, private ZIP distribution, installation guide, and a WayBeyond20-owned packaged update page.
- Quiet passive character synchronization, safer roll interception, and protection against duplicate listeners, pollers, and self-triggering observer updates.
- Correct D&D Beyond Game Log labels, local and Digital Dice result handling, and combined critical-damage Game Log results.
- Live parsing of D&D Beyond feature and spell text for activation, duration, concentration, targeting, and effect information.
- Ordered weapon-damage packages and destination-specific dice-formula handling.
- Persistent character-side effects, concentration replacement, Buffs and Concentration displays, manual effect ending, AC adjustments, speed adjustments, Haste mechanics, and dispatch-safe Stealth Advantage.
- A local Combat Window with Movement, Action, Bonus Action, Reaction, Haste Action, New Turn, End Combat, automatic activation-cost spending, and resource warnings.
- Roll20 token binding, turn-order synchronization, target discovery, combat-resource resets, resolved-damage callbacks, and protection against spending another open character sheet's off-turn Action or Bonus Action.
- Persistent class-derived Hit Dice pools, manual controls, automatic spending, and Long Rest reset handling.
- Triage Expert: Bedside Manner and Blood and Bone support.
- Natural-weapon-only Draining Attack qualification and higher-only Temporary HP application.
- Bardic Inspiration native-use spending and a compact feature card.
- Dazzling Footwork Advantage handling and automatic Agile Strikes attack selection.
- Correct Roll20 Savage Attacker handling that compares two complete base weapon-damage formulas.
- Use Magic Device scroll spellcasting support.
- Complete settings display and an optional bounded diagnostic log with copy and clear controls.

### Paladin support completed for v1.63

- Native limited-use checks and post-dispatch spending, including shared Channel Divinity pools and Breath Weapon uses.
- Lay on Hands healing-amount selection and native healing-pool spending after dispatch; the five-point cleansing actions use the same pool.
- Oath of the Watchers: Watcher's Will sends only its own feature text, spends Action and Channel Divinity, and tracks one minute of Advantage on Intelligence, Wisdom, and Charisma saving throws.
- Oath of the Watchers: Abjure the Extraplanar sends only its own feature text with the live Wisdom save DC and spends Action and Channel Divinity.
- Oath of the Noble Genies: Dao's Crush, Djinni's Escape, Efreeti's Fury, and Marid's Surge use the shared Channel Divinity pool and preserve their distinct after-Smite effects.
- Oath of the Noble Genies: Elemental Rebuke adds the Charisma modifier to its 2d10 damage, supports Acid, Cold, Fire, Lightning, or Thunder, includes its Dexterity save, spends Reaction, and marks its native use.
- Oath of the Noble Genies: Noble Scion spends a Bonus Action, marks its native use, and tracks its ten-minute flight/Minor Wish reminder.
- Defensive and utility spells now provide **Cast on VTT** as well as **Display**, so effects such as Shield of Faith can enter the normal activation and effect-tracking flow.

### Complete dated feature register

`WayBeyond20-Feature-Register.md` is the readable, authoritative comparison with Beyond20. `WayBeyond20-Feature-Register.csv` is the internal operational register with DateStarted, DateCompleted, Status, source/build/Chrome/Roll20 verification fields, and notes. Historical dates that were not recorded are explicitly marked **Not recorded** rather than reconstructed by guesswork.

### Installation

Extract `WayBeyond20-chrome-v1_63.zip`, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted `WayBeyond20` folder containing `manifest.json`.

Disable the standard Beyond20 extension while using WayBeyond20 so the two extensions do not create duplicate controls or rolls. Complete instructions are included in `README.txt` inside the release folder.
