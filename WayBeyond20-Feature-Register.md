# Complete WayBeyond20 Changes from Beyond20

Last verified against source and build: September 11, 2026

Baseline: Beyond20 2.20.1 (`Beyond20-Master`)

Current WayBeyond20 source: 2.20.63 / v1.63 (`WayBeyond20-Master`)

This is the master list of meaningful features and behavior changes in WayBeyond20 compared with the base Beyond20 extension. It lists what the current source changes; it is not a history of internal builds, testing errors, or proposed future work.

## Identity and distribution

1. **WayBeyond20 identity and branding** — Renames the extension, settings, renderer labels, notices, diagnostics, and visible interface from Beyond20 to WayBeyond20 while retaining the inherited extension architecture.
2. **WayBeyond20-owned update page** — Opens a packaged local WayBeyond20 update page instead of sending users to Beyond20's website.
3. **Private Chrome installation package** — Provides a build that can be distributed as a ZIP and installed through Chrome's Developer mode using **Load unpacked**.
4. **Installation and update guide** — Includes instructions for first installation, replacement updates, avoiding conflicts with standard Beyond20, and basic troubleshooting.

## D&D Beyond character-sheet integration

5. **Quiet passive synchronization** — Character-sheet state can synchronize without displaying a missing-VTT error; actual attempted rolls still report when no destination is available.
6. **New-feature discovery notices** — Detects newly parsed class features, species traits, and feats and shows a deduplicated, debounced notice instead of repeating it on every scan.
7. **Safer roll interception** — Restricts roll hijacking to supported D&D Beyond roll targets so unrelated controls are not intercepted.
8. **Reinjection and observer safeguards** — Replaces WayBeyond20-owned listeners, observers, and pollers instead of stacking duplicates after page changes or extension reloads; Bardic Inspiration updates are idempotent so a character-sheet mutation cannot create a self-sustaining observer loop.
9. **Correct D&D Beyond Game Log labels** — Sends ability checks, saving throws, Initiative, attacks, healing, and other roll types with the appropriate human-readable labels.
10. **Local and Digital Dice result handling** — Adds message-broker support for WayBeyond20-triggered local rolls, custom rolls, resolved totals, and feature callbacks.
11. **Critical-damage Game Log aggregation** — Holds and combines separated normal and critical phases into one Game Log result while retaining the correct damage types.

## Generic rules foundation

12. **Live Talent parser** — Reads current D&D Beyond feature and spell text to derive activation cost, components, duration, concentration, targeting, and effect data rather than relying only on a separate hard-coded rules database.
13. **Detailed targeting vocabulary** — Records concepts such as self, another creature, willing creature, ally, enemy, visibility, hearing, understanding, object, and creature type for use by feature logic.
14. **Known-target discovery and selection** — Discovers eligible named targets from connected Roll20 turn-order data and can prompt for a target when a supported effect requires one.
15. **Remote effect delivery** — Sends supported effect records to the matching open D&D Beyond character sheet for the selected target.
16. **Ordered weapon action pool** — Separates base weapon damage from additional damage effects and records their source, category, tags, determinant, and execution order.
17. **Target-specific roll formulas** — Allows a feature to use different valid dice syntax for Roll20, Foundry/generic destinations, and local D&D Beyond rolls.

## Effects, buffs, concentration, and character statistics

18. **Persistent active-effect records** — Stores supported effects per character, including source, owner, level, duration, concentration, flags, and mechanical data.
19. **Concentration replacement** — Starting a new tracked concentration effect replaces the previous concentration effect.
20. **Buff and concentration badges** — Adds contextual **BUFFS** and **CONCENTRATION** displays to the D&D Beyond sheet only when relevant; a single buff displays its name and multiple buffs display a count.
21. **Effect details and manual ending** — Opens a compact effect panel with descriptions and allows a tracked effect to be ended manually.
22. **Quiet local effect management** — Maintains character-side effects without posting unnecessary effect-management messages into VTT chat.
23. **Armor Class adjustments** — Displays reversible effect-based AC additions in D&D Beyond's Armor Class details with the actual effect source named.
24. **Speed adjustments** — Applies and displays supported speed multipliers from active effects.
25. **Haste mechanics** — Supports Haste's AC bonus, doubled speed, Dexterity-save advantage, and an additional Haste Action in the combat controls.
26. **Hide and Stealth effect** — A qualifying Stealth check can create a visible Stealth/Invisible effect that grants Advantage to the next qualifying attack and is consumed only after that attack is actually dispatched.

## Combat and action economy

27. **Local Combat Window** — Adds a D&D Beyond combat panel showing Movement, Action, Bonus Action, Reaction, and an optional Haste Action.
28. **Combat controls** — Provides **New Turn** and **End Combat** controls and a manual **Combat Window** command in the character-sheet menu.
29. **Automatic combat start from Initiative** — A qualifying Initiative roll can start the local combat state.
30. **Activation-cost spending** — Uses parsed feature metadata to spend the appropriate Action, Bonus Action, Reaction, or Haste Action only after the associated roll is dispatched while combat is active.
31. **Unavailable-resource warning** — Warns when an action resource is already spent and permits an explicit override without creating a negative resource count.
32. **Movement tracking** — Shows and spends the character's current movement allowance, including supported speed changes.
33. **Roll20 token binding** — Associates the D&D Beyond character with a selected or name-matched Roll20 token.
34. **Roll20 turn-order synchronization** — Reads Roll20's full turn order, detects the character's turn, maintains a turn counter, and resets WayBeyond20 combat resources at the correct time; an off-turn roll from a different open sheet cannot spend that sheet's Action or Bonus Action without a clear override.
35. **Roll20 target discovery** — Makes creatures in the Roll20 turn order available to supported D&D Beyond target-selection flows.
36. **Roll20 resolved-damage callback** — Returns a resolved damage total from Roll20 to the matching D&D Beyond character sheet for features that act on the final result.

## Hit Dice and rest handling

37. **Persistent Hit Dice tracker** — Derives Hit Dice pools from the character's current class levels and stores the remaining count by die size.
38. **Hit Dice controls** — Adds manual minus, plus, and Reset controls for d6, d8, d10, and d12 pools.
39. **Automatic Hit Die spending** — Decrements the appropriate WayBeyond20 pool when a Hit Die is rolled through the character sheet.
40. **Long Rest reset handling** — Detects a completed Long Rest and resets the WayBeyond20 Hit Dice pool without attaching duplicate rest listeners.

## Feature-specific rules

41. **Triage Expert: Bedside Manner** — Rolls one additional healing die and discards the lowest die while retaining the healing modifier; uses the appropriate keep-highest or drop-lowest syntax for the destination.
42. **Triage Expert: Blood and Bone** — Adds d4, d6, d8, d10, d12, and **Use** controls to the native feature; can ask for the target's Hit Die, applies Bedside Manner, and spends the caster's Action without spending the caster's own Hit Dice.
43. **Draining Attack qualification** — Detects qualifying natural-weapon attacks and marks them for Draining Attack processing without applying the feature to a generic Unarmed Strike, Bardic damage, or Agile Strikes.
44. **Draining Attack Temporary HP** — Uses the resolved qualifying damage total as Temporary Hit Points, replacing the current value only when the new value is higher; supports D&D Beyond local/Digital Dice and Roll20 callback paths.
45. **Bardic Inspiration native use spending** — Finds and spends the correct native Bardic Inspiration Limited Use control while excluding unrelated controls such as Short Rest.
46. **Bardic Inspiration feature card** — Presents Bardic Inspiration as a compact Bonus Action feature with 60 ft range, current inspiration die, remaining uses, and an **Inspire** button.
47. **Dazzling Footwork** — Recognizes a dancing Performance check, offers Advantage, detects when Advantage already exists, and avoids a redundant roll-mode question.
48. **Agile Strikes continuation** — After Bardic Inspiration, offers the optional Unarmed Strike and automatically selects the strongest legal attack ability and damage profile without extra configuration dialogs.
49. **Savage Attacker** — On Roll20, rolls the complete eligible base weapon-damage formula twice and keeps the higher total; it does not incorrectly keep the highest individual dice from a doubled pool.
50. **Use Magic Device scroll casting** — Offers and remembers an Intelligence-plus-proficiency Scrolls casting path when D&D Beyond does not supply a normal class spellcasting path, and applies it to supported attack, damage, and healing formulas.

## Settings and diagnostics

51. **Display All Current Settings** — Shows global, hidden, character-specific, active-effect, Hit Dice, and combat-turn settings while omitting malformed undefined records.
52. **Persistent bounded Debug Log** — Optionally records diagnostic events for character parsing, rolls, effects, VTT routing, Game Log handling, and callbacks without growing indefinitely.
53. **Debug Log controls** — Provides Refresh, Copy, Clear, and Close controls on the full settings page.
54. **WayBeyond20 settings backup and restore labels** — Rebrands the inherited settings export/import interface and preserves WayBeyond20-specific settings.

## Paladin feature support

55. **Native limited-use dispatch** — Finds an exact D&D Beyond limited-use group, checks availability before a roll, and marks one use only after the roll is dispatched; shared pools such as Channel Divinity are handled by the pool name rather than the individual option name.
56. **Lay on Hands pool handling** — Reads the native numeric healing pool, asks for a healing amount when needed, sends healing or cleansing information to the VTT, and reduces the native pool after successful dispatch.
57. **Oath of the Watchers: Watcher's Will** — Sends only the Watcher's Will paragraph, spends the shared Channel Divinity pool, spends the Action in active combat, and tracks the one-minute Intelligence, Wisdom, and Charisma saving-throw Advantage effect on the paladin.
58. **Oath of the Watchers: Abjure the Extraplanar** — Sends only the Abjure paragraph with the paladin's live Wisdom save DC and spends the shared Channel Divinity pool and Action.
59. **Oath of the Noble Genies: Elemental Smite options** — Handles Dao's Crush as an after-Smite grapple with an escape DC rather than a false attack/save, tracks Djinni's Escape on the paladin, and sends Efreeti's Fury and Marid's Surge with their native damage/save data while sharing the Channel Divinity pool.
60. **Oath of the Noble Genies: Elemental Rebuke** — Prompts for its five eligible elemental damage types, includes the Charisma modifier in its 2d10 damage, sends the Dexterity save and half-damage rule, spends Reaction, and marks the native use.
61. **Oath of the Noble Genies: Noble Scion** — Sends the activation as a Bonus Action, marks the native use, and tracks the ten-minute self effect for its flight and Minor Wish reminder.
62. **Utility and defensive spell casting** — Gives spells without attacks, damage, healing, or saves a real **Cast on VTT** action in addition to **Display**, allowing activation costs and persistent effects such as Shield of Faith to be tracked.
63. **Prepared smite discovery and selection** — Caches the character's current prepared or Always Prepared D&D Beyond smite spell rows, invalidates that cache when preparation changes, presents every discovered eligible smite, and keeps Paladin's Smite fuel restricted to Divine Smite.

## Internal register fields

The companion `WayBeyond20-Feature-Register.csv` is the operational register. It records DateStarted, DateCompleted, Status, SourceVerified, BuildVerified, ChromeVerified, Roll20Verified, and Notes. Earlier work did not preserve reliable start dates, so those cells say **Not recorded** instead of inventing dates. Each feature stays out of **Release verified** status until the packaged build has passed the relevant live Chrome and Roll20 checks.

## Scope of this list

This list intentionally excludes unchanged Beyond20 behavior and unimplemented requests such as TaleSpire support, campaign calendars, sustenance tracking, a complete generic Talent executor, automatic duration countdowns, and Foundry combat callbacks. Those are future requests, not changes already made from the Beyond20 base.
