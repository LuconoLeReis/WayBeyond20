# WayBeyond20 Changelog

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

### Known limitations in this release

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
