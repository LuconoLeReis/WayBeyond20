# WayBeyond20 Changelog

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
