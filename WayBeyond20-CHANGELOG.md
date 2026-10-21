# WayBeyond20 Changelog

## v1.73.2 - Proficiency and saving-throw sync, 2026-10-21 (local candidate)

Extension version 2.20.129. PATCH. Recognizes DDB's accessible proficiency
labels as well as tooltip wording; writes native 2014 skill proficiency and
expertise fields using the sheet's checkbox expressions. Copies displayed
saving-throw totals and proficiency into native and wb20_* macro attributes.
Unknown/missing data is not treated as zero. No combat or resource changes.
Regression tests pass; live macro retest pending extension reload. Not published.

## v1.73.1 - 2014 Roll20 sheet fields, 2026-10-20 (local candidate)

Extension version 2.20.128. PATCH. Writes the 2014 sheet's displayed ability
scores and modifiers, proficiency bonus, AC, speed, passive Perception, skill
bonuses, and vision attributes in addition to the `wb20_*` macro fields. A
2014 sheet may not run its sheet workers when attributes are created from the
VTT page, so base scores alone are insufficient. Live DDB-to-Roll20 delivery
worked after confirming and saving the opt-in switch; native 2014 fields await
the next extension reload and live acceptance. Not published.

## v1.73.0 - Optional DDB to Roll20 core-data sync, 2026-10-20 (local candidate)

Extension version 2.20.127. MINOR. Adds an opt-in Roll20-only transfer of DDB
ability scores, skill bonuses, passive scores, senses, proficiency bonus, AC
and speed. The values are exposed as `wb20_*` Roll20 attributes for macros.
Supported 2014 sheets also receive base ability scores; a loaded 2024 sheet
receives ability-score, AC and sense entries in its native store. Name matching
must be unique; uncertain senses are not cleared. No spells, inventory,
features, HP or combat state are imported by this new path. Automated checks
pass; live Roll20 2024 sheet and Wren-macro acceptance remain unverified. The
new setting is off by default. This candidate is not published.

## v1.72.4 - Preserve combat during Roll20 loading, 2026-10-20 (not published)

Extension version 2.20.126. PATCH. Live Roll20 refresh zeroed the WB20 turn
number and refilled a spent Reaction without changing initiative. The producer
now waits while the editor loading overlay/document is loading or campaign/page
data is unavailable. Unknown/malformed order data is not an ended battle. A
loaded empty order still ends combat. New real-producer/real-receiver regression
reproduced the premature end before the fix and passes afterward, covering
spent resources, own-turn resets, duplicates, refresh, target retention and
genuine end/restart. Live full rotation passed on 1.72.3; original order and
counters restored. Live acceptance of the loading correction awaits reload.

## v1.72.3 - Immediate target edit feedback, 2026-10-20 (not published)

Extension version 2.20.125. PATCH. Live 1.72.2 still missed the second Undo in
both orders. Target edits now reconcile from synchronous in-memory state before
the next gesture is aimed, rather than waiting for the storage callback. The
existing save queue and pressed-pointer guard remain unchanged. Expanded browser
regression covers delayed paint before pointerdown as well as during a press;
both orders, keyboard and cancellation pass. Live acceptance awaits reload.

## v1.72.2 - Rapid target Undo, 2026-10-20 (not published)

Extension version 2.20.124. PATCH. Defer target-panel DOM updates while a pointer
is pressed; release, cancellation or window blur resumes the existing refresh.
Prevents a shortened history/page from moving the second button between press
and release. No save-queue changes: real writer tests already preserve both
Undo orders with delayed storage and reversed broadcasts. Browser regression
reproduces the lost click before the fix and passes after, including keyboard,
cancelled gestures and unchanged economy. Live acceptance awaits reload.

## v1.72.1 - Attack handoff and target drafts, 2026-10-20 (not published)

Extension version 2.20.123. PATCH: do not debounce a pending roll indefinitely
under frequent DDB mutations; use canonical pane classes and bind ordinary
icon handoffs to the selected name/owner too. Keep target input nodes across
record, initiative and resource updates. Patch saved summaries/history in place;
retain focus, draft values, damage type and disclosure. Clear submitted fields
immediately, not during the later refresh. Different targets receive clean fields.
Both new regressions fail before and pass after. Live acceptance awaits reload.

## v1.72.0 - Manual Roll20 token linking, 2026-10-20 (not published)

Extension version 2.20.122. MINOR for the new compatible Link My Token menu
control, PATCH reset. Choose one existing turn-order token without rerolling
initiative. Replaces both stored binding fields, not combat state or any Roll20
data. Current ID or unique matching name is preselected but requires explicit
confirmation. Duplicate names display IDs; stale choices and character changes
are rejected, Cancel is inert. Rendered regression and existing distance/economy
checks pass. Live binding/distance acceptance awaits reload.

## v1.71.2 - Keep Combat below the sheet, 2026-10-20 (not published)

Extension version 2.20.121. PATCH: reconcile wrapper placement on the existing
debounced DDB update path, before the unchanged-state early return. Move the
existing tracker rather than recreating it, including when the preferred host
changes. Preserve focused controls and scroll position. Stable updates do not
reorder the wrapper. Regression recreates native content appended after Combat,
verifies unchanged state/input/compass identity, and checks observer settling.
Local verification is separate from live acceptance after extension reload.

## v1.71.1 - Compass text clearance and distance diagnostics, 2026-10-20 (not published)

Extension version 2.20.120. PATCH: lower/wider rim clears the side names without
changing header height or their tilt. Regression samples the rendered SVG curve
against the text bounds for Swarm of Quippers names. Missing distance now gives
the concrete input failure, including map scale, coordinates, layer or token
identity. This does not claim the live numeric distance failure is fixed.
Live 1.71.0 Select Target, Viewing/return and unchanged173.78px height passed.
Calan and every enemy in this test initiative order were GM-layer tokens.
Approved temporary Calan Tokens-layer self test still showed unavailable;
there is an additional unresolved cause. No numeric distance acceptance yet.

## v1.71.0 - Compass targeting and distance, 2026-10-20 (not published)

Extension version 2.20.119. Compatible new target preview/distance capability;
MINOR increment resets PATCH. Select Target chooses the centered token by ID.
Browsing heading is Viewing; a small return arrow restores the current turn.
Floating hover/focus/tap details show initiative, recorded AC, gross damage
and type subtotals, plus straight-line center-to-center map distance. No new
permanent row or height. No automatic collection of other players' damage.
Roll20 exports only token-layer position/map scale fields for turn-order
tokens. Position changes send an update without changing turnKey, resetting
economy or reopening manually ended combat. Ambiguous/missing own-token or
different-page positions show unavailable. Position-only updates preserve
preview, target selection and unfinished inputs. Refresh both tabs after reload.
Browser fixture and geometry/receiver tests pass. Live gate pending reload.

## v1.70.2 - Shared compass front curve, 2026-10-20 (not published)

Extension version 2.20.118. Bill's annotated visual replaces the individual
ovals with one wide front curve. Current name 18px, receding side names,
filled curved arrows. Removed center ellipse/ticks. No extra header height.
Responsive layout, browsing/reset and scroll-preservation fixture passed.

## v1.70.1 - Reverse compass tilt, 2026-10-20 (not published)

Extension version 2.20.117. Reversed side-name rotateY and rotateZ directions
at Bill's request. No center, layout-height, behavior or resource changes.
Live 1.70.0 shows correct neighbors and one-row toolbar; browsing verification
was interrupted by this visual correction. Do not claim live browse acceptance.

## v1.70.0 - Interactive turn compass, 2026-10-20 (not published)

Extension version 2.20.116. MINOR for the compatible turn-order browser; PATCH
reset. Centered compass shows previous/current/next by Roll20 token identity
and order, with perspective side names, curved arrows and sheet accent color.
Side buttons browse without changing any combat/target state; Back to current
returns to the active combatant. Real turn changes reset preview. Repeated
refreshes do not trigger continuous animation; reduced-motion disables reveal.
Source and turn number remain at far right. Responsive and functional fixture
checks pass; live compass acceptance awaits reload. Compact 1.69.2 verified live.
Target information is centered. Back to current replaces the small caption,
not a new row. Local long-page tests verify stable header height and scroll
position while browsing, returning, and receiving an active-token change.

## v1.69.2 - Compact Combat layout, 2026-10-20 (not published)

Extension version 2.20.115. Resources and My Target/New Turn/End Combat now
share one wrapping toolbar. Target information is a horizontal row underneath
inside the same themed frame, with on-demand Damage & history. Removed forced
240px height and side-by-side target panel. Target state is preserved across
Combat rerenders; theme-only refresh retains unfinished input. Local regression
checks desktop single-row controls, target placement, 320-1200px widths, Haste,
long target names, AC/damage persistence and End Combat cleanup. Live compact
layout awaits reload. Previous 1.69.1 native theme verified live on Calan.

## v1.69.1 - My Target sheet theme, 2026-10-20 (not published)

Extension version 2.20.114. My Target reuses Combat's native sheet theme and
frame instead of following OS dark mode independently. Select-menu surfaces
match the sheet. Decorative edges have a safe inset; theme-only updates retain
focused inputs. Local light/dark theme and responsive layout regression passed.
Live theme acceptance awaits reload. Fresh battle names and initiatives passed
live on 1.69.0: Zombie 1 = 18, Calan = 10.17. No counters or turns changed.

## v1.69.0 - Typed formula parts and My Target, 2026-10-20 (not published)

Extension version 2.20.113. MINOR for compatible new features, PATCH reset.
Custom typed brace groups preserve each type's complete formula and the global
fallback; shared renderer shows type subtotals and one total without rerolling.
My Target uses the existing Roll20 token list plus initiative, with persistent
per-target AC observations (attack total, Hit/Miss, Undo), and manual gross
damage entries by type. AC follows Bill's narrowing sequence without a qualifier.
No native HP writes or economy spending from target controls. Responsive panel.
All core/regression and representative browser-fixture tests pass; Chrome and
Firefox builds syntax checked. Live acceptance pending reload, not published.

## v1.68.0 - Automatic descriptions and advanced custom dice, 2026-10-20 (not published)

Extension version 2.20.112. MINOR for expanded compatible custom-roll features;
PATCH resets to zero. Missing descriptions for remembered visible selections
load in a bounded batch without casting. Native identity and interruption
guards remain; cached text is reused, failed attempts do not loop endlessly.
Manage's Automatic label is now Use detected category with the detected result.
Custom grammar adds kh/kl/dh/dl, once-only ro<=N rerolls, minN group totals,
decimal constants and standard damage-type labels. Limits: 100 base dice and
240 characters; no scripts, variables, exploding dice or general arithmetic.
Formula note uses Bill's final wording: Your dice formula will be shown with
the result. No special disclosure or forced public roll; privacy is unchanged.
Roll20 custom requests bypass prose substitution to preserve full notation.
Roll20 handles each reroll term; Foundry translates combined group minimums.
Deterministic local totals and transport translation tests pass, not live VTT
acceptance. Custom damage type is a result label, not automatic HP application.

## v1.67.4 - Empty native sidebar guard, 2026-10-20 (not published)

Extension version 2.20.111. Inspection of Calan's closed sidebar showed a
full-width, zero-height portal retained in the DOM. jQuery :visible treats its
width as visible, so the broad portal guard blocked description loading.
Guard the visible native sidebar header instead. Native-shaped zero-height
portal regression failed before this fix and passes afterward. Existing
open-sidebar protection still passes. Includes all 1.67.3 presentation changes.

## v1.67.3 - Quiet spell defaults and clean selectors, 2026-10-20 (not published)

Extension version 2.20.110. PATCH for quick-list presentation and defaults.
Only Attack/Damage and Healing categories default visible; Manage explicitly
enables other groups while preserving hidden choices and character isolation.
Closed selectors display only the name. Expanded choices retain source/level
so multiclass and upcast variants remain distinguishable. Transparent idle
borders reveal on hover or keyboard focus without changing geometry.
Hover text uses cached, exact-identity native descriptions, not inferred text.
Selecting an uncached spell reads its native details without casting and returns
to Actions; existing sidebars/dialogs are not disturbed. Hover never navigates.
Missing descriptions are honestly labeled. Local tests are not live acceptance.
Live 1.67.2 Starry Wisp now produced attack 11 and radiant damage 1, then returned
to Actions. No VTT was connected, so delivery is not verified.

## v1.67.2 - Cantrip pane label ordering, 2026-10-20 (not published)

Extension version 2.20.109. PATCH: native cantrip pane identity checks all
level/school items for the exact Cantrip label, rather than assuming it is first.
Observed school-first markup failed a new regression before correction and
passes afterward; source and level mismatch cases still reject. No resource
or casting rules changed. Corrected cantrip activation awaits live reload.

## v1.67.1 - Wait for native spell-tab transition, 2026-10-20 (not published)

Extension version 2.20.108. PATCH for the asynchronous tab handoff correction.
Live discovery left the sheet on Spells. The shared visit helper checked active
tab state before React committed the switch, exited early, and skipped restoring
Actions. Wait for that transition within the existing bounded loop; still stop
when the user navigates elsewhere. Delayed-render regression failed before the
fix and passes afterward. Live casting and corrected restoration await reload.

## v1.67.0 - Universal spell quick list and Manage, 2026-10-20 (not published)

Extension version 2.20.107. MINOR for compatible new capabilities; PATCH resets.
Categories use live native timing/effect metadata, not class-specific spell lists.
Each category/timing group remembers its spell/source/casting-level selection.
Other is the classification fallback; Manage can correct categories. Longer
casting has explicit time and purple border, not the gray free-action meaning.
Initial discovery briefly visits Spells and restores Actions; native filters
limit discovery. Casting re-resolves the exact native entry and uses existing
spell execution/resource ownership, restoring the prior tab.
Manage hides/restores entries without editing native features or equipment.
Custom lines support validated simple dice plus optional A/BA/Reaction cost;
no arbitrary code, dynamic variables, slot/feature spending, riders or HP writes.
Identical native entries share visibility. Preferences are per character.

## v1.66.17 - Clearer Opportunity Attack dialog and legend help, 2026-10-20 (not published)

Extension version 2.20.106. Presentation only: stacked labeled attack, roll mode,
and turn fields; concise Reaction cost; longer rules behind a closed disclosure.
Color legend titles explain each cost, including gray's trigger/resource limits.
Keyboard focus and accessible descriptions added. No change to turn prompts,
eligibility, attack dispatch, or resource spending.

## v1.66.16 - Natural melee Properties guard, 2026-10-20 (not published)

Extension version 2.20.105. Live1.66.15 reached rollAction after the handoff
fix, then failed in applyGWFIfRequired on undefined Properties. Normalize that
optional field to empty text, never infer Versatile/Two-Handed. Browser fixture
now uses the real helper and an action pane without Properties; failed before
the guard, passes afterward. No live roll or resource spend occurred.

## v1.66.15 - Default Opportunity Attack and brighter green, 2026-10-20 (not published)

Extension version 2.20.104. Finish the prompt event before opening the native
attack pane, preventing a closing/outside click from dismissing it. Adds a
per-character default after a successful explicit melee choice. Row reads live
name/range/hit/damage; icon uses default, Choose different Attack reopens chooser.
Right-click uses the standard attack-mode menu. Unknown turn still prompts.
Missing/ambiguous matches fail back to choosing, not an arbitrary substitute.
Action borders and legend now use vivid #00a83b; Free/Special stays gray.

## v1.66.14 - Opportunity Attack native rerender handoff, 2026-10-20 (not published)

Extension version 2.20.103. A live chooser attempt stopped without rolling or
spending. Reproduced a silent cancellation when native detail opening replaces
the selected list row. After opening, validate the character/turn and matching
pane instead of requiring the original row to survive. Added a failing-then-
passing browser regression. Live acceptance must still be checked.

## v1.66.13 - Gray Free/Special borders, 2026-10-20 (not published)

Extension version 2.20.102. Bill requested gray instead of black to improve
distinction from green Actions. Shared Free/Special color is now #808080 for
icons, hover/focus treatments and legend. No gameplay changes.
Blood and Bone's chooser uses Target / Hit Die on two deliberate lines.
Notes die shortcuts use identical text-sized widths with four-pixel side
padding and no fixed minimum; retain wrapping and the phone HP Die label.
Live Opportunity Attack acceptance remains pending: browser control requires
an update to the ChatGPT Chrome extension. No character counters changed.

## v1.66.12 - Opportunity Attack and paid grants, 2026-10-20 (not published)

Extension version2.20.101. Add Reaction-row melee/Unarmed Strike chooser
with reach and roll mode, using native attack builders. Reaction buys one
attack, not an Action or Extra Attack. Bounded grants isolate character/turn,
guard duplicate dispatch, and pay only on success. Agile uses an already-paid
grant. Deferred off-turn hits cannot later offer Bonus Action Smite.
Live rule-granted reactive spell replacement checks casting time and retains
native spell-resource accounting, including non-damage/save spells. Player
confirms trigger/single target/slot timing; ambiguous rider rules require
review. General multi-attack producers and complete rules enforcement remain
open. Fangs/Claws reuses the native Unarmed Strike icon without replacing its
clickable wrapper. Offline checks pass; live acceptance follows reload.

## v1.66.11 - Consistent talent row presentation, 2026-10-20 (not published)

Extension version 2.20.100. Correct the missing separators and inconsistent
spacing on added talents. View beside Sort offers Standard (default, dotted
separators) or Compact (no lines, less spacing). Persist per character,
preserve columns/font/button sizes and gameplay, and restore native layout
when the combined list is disabled. Keyboard/outside-click dismissal and
stale-character guard included. Live acceptance follows reload.

## v1.66.10 - Blood and Bone columns, 2026-10-20 (not published)

Extension version 2.20.99. Restore Range 5 ft Touch, Hit/DC --; Damage has a
Target Hit Die button (HP Die on phone-width screens) opening the existing
Use chooser. Notes holds d4/d6/d8/d10/d12 shortcuts to existing controls.
Wrap buttons within Notes. Sort by actual range, not a Hit Die label.
Includes tested off-turn Attack-action pool and Bonus Action availability
corrections plus internal bounded attack-grant foundation. Opportunity
Attack UI, spell substitution and complete rider integration remain unfinished.
No new Opportunity Attack capability is claimed in this patch.

## v1.66.9 - Talent category subtitles, 2026-10-20 (not published)

Extension version 2.20.98. Help Ally for Bardic Inspiration, Heal Ally for
Blood and Bone; remove redundant cost subtitles from added rows. Native
attack descriptions remain untouched. Category typography copies native
attack meta-item styling (live sample: Roboto Condensed 10px/400, 10px line
height, normal capitalization). No new targeting or gameplay constraints.

## v1.66.8 - Blood and Bone shared-row choices, 2026-10-20 (not published)

Extension version 2.20.97. Replace the empty shared-row cells and generic
Use note with d6 / d8 / d10 / d12 buttons in Range / Hit-DC / Damage / Notes.
Forward to existing die controls; preserve the left Use chooser, native
details, disabled state and character ownership. No new rules/resource path.
Hit Die choices do not become sortable attack damage or numeric range.

## v1.66.7 - Native action-label typography, 2026-10-19 (not published)

Extension version2.20.96. Calan's live computed styles confirm native labels
use Roboto Condensed14px/400 with14px line height; Blood and Bone inherited
Roboto13px/400 and added Inspiration usedRoboto13px/700. Match the native
label's computed family/size/weight/line-height/letter-spacing, without copying
spell-specific italics or changing handlers/resource accounting. Guard writes
so repeated mutation refreshes remain inert; fixture checks equality and churn.
More Options code is unchanged. Original transition passes the isolated fixture
and Bill confirms it loads in an unconnected duplicate tab. The blank connected
tab is not a demonstrated defect in that transition; speculative change removed.

## v1.66.6 - Classify before on-hit routing, 2026-10-19 (not published)

Extension version2.20.95. A regression reproduced late unarmed classification
skipping the hit-confirmed continuation when no other follow-up flag existed.
Normalize shared attack semantics before the continuation decision; enforce
Draining Attack's explicit Natural Attack prerequisite. No Agile-specific
trigger or attack-name condition added. Differently named unarmed attacks
award once after hit/damage, never on a miss. Existing VTT award suppression
remains. This defect is verified, but the player's earlier symptom is not
claimed fully explained or live-fixed. Includes1.66.5 shared-row merge.

## v1.66.5 - Merge Agile Strikes with its attack, 2026-10-19 (not published)

Extension version2.20.94. Bill confirmed Bardic Damage is the Agile Strikes
attack. When both native entries exist, link the original rules from that
attack's Notes and omit the empty feature shortcut. Preserve native label,
range, to-hit, damage, black border, handlers and sort values. Keep the feature
shortcut if its attack is absent. No changes to attack execution or accounting.
1.66.4 columns and compact Sort verified live on Calan; this merge is a new
correction with separate reload acceptance.

## v1.66.4 - Shared feature rows and compact Sort, 2026-10-19 (not published)

Extension version 2.20.93. Completes the combined-list correction: Bardic
Inspiration uses native columns; die and uses belong in Notes. Adds shortcuts
for non-attack features rendered in the native action sections, deduplicated
against existing attack rows. Supported existing Use controls are reused;
otherwise shortcuts open native details, without invented execution/spending.
Compact Sort opens Action order, Name, Damage and Range. Sort choice persists
per character and is shown only in the open menu. Damage compares displayed
primary formula averages, Range normal range; missing values sort last.
No automatic spell-list import. Manage visibility/selected spells/custom
formula entries are recorded follow-up scope, not implemented in this build.
Automated acceptance precedes reload; live acceptance remains pending.

## v1.66.3 - Responsive Actions header, 2026-10-19 (not published)

Extension version2.20.92. Consolidates the native attacks-per-action count,
colored action-cost legend and right-aligned sort control into a wrapping
toolbar. Adapts to panel width, not screen size or manual spacer characters.
Native count updates are reflected; missing values are not invented.
No roll, resource or sort behavior changes. Live acceptance pending.

## v1.66.2 - Combined action rows, 2026-10-19 (not published)

Plain version label per Bill's naming clarification. Previously labeled
1.66.1-dev.4 locally; label/documentation-only change, no executable change.

Extension version 2.20.91. One visually combined list, default Action / Bonus
Action / Reaction order, with per-character alphabetical sorting. Native nodes
are not moved or duplicated. Border colors indicate cost separately from sort
affinity; Bardic Damage stays with Actions with a black free/special border.
Left-side Bardic Inspiration icon reuses the existing Inspire button, including
disabled state. Default-on per-character layout switch. Offline tests pass;
live acceptance pending. No resource/attack accounting changes in this layer.

## v1.66.1-dev.3 - Immediate full-attack menu, 2026-10-19 (not published)

Extension version 2.20.90. Corrects the dev.2 interaction requirement mismatch.
- The row icon and red attack button share an anchored Advantage / Flat (One Die) / Disadvantage menu. Only Roll Full Attack starts the existing attack sequence and preflight warnings.
- Opening, selecting, dismissing, or cancelling options spends nothing. Stale character/sidebar targets cannot roll. Explicit mode is request-local, including when a hotkey is held.
- Native numeric dice menus and saved recipient settings are unchanged. Dev.2's later Ask each time dialog was not equivalent to this behavior. New live acceptance remains required.

## v1.66.1-dev.2 - Attack icon and native pool confirmation, 2026-10-19 (not published)

Extension version 2.20.89. Compatible bug-fix candidate; live validation pending.
- Attack icon right-click or keyboard context menu opens the existing roll-mode chooser. Its request does not change saved roll preferences or affect the next ordinary click.
- Smite discovery no longer navigates before attack/hit resolution. After weapon damage, it returns to the original tab before showing choices. Native resource accounting may still briefly mount its controls.
- Lay on Hands commits the native pool's staged adjustment with its own Confirm control, verifies acknowledgement, and refuses to commit pre-existing manual edits.
- Free Smite replay repair from dev.1 passed one live DDB-only attack/damage/Smite/Efreeti sequence. Reporter-specific and live VTT confirmation remain open.

## v1.66.1-dev.1 - Smite resource replay, 2026-10-19 (not published)

Extension version 2.20.88. Compatible bug fix; patch candidate.
- Free Paladin's Smite accounting no longer re-enters the native Cast/Use listener as a second spell cast. The content fallback and cross-context direct-cast replay use the same button-scoped marker.
- A fresh player Cast/Use click is still handled normally. Replay markers are removed in finally, including when the native click throws.
- New offline Chromium integration reproduces the failure on prior source and passes on the fix. Live confirmation of the reported sequence is still required. Lay on Hands persistence remains unresolved; no pool ownership change.

## v1.66.0 - Portent Dice and sheet improvements, 2026-10-18

Extension version 2.20.87. Compatible new capability; minor-version increment.

- Character-local Portent pool, completed Long Rest replacement, selection, confirmation and reversible opt-out.
- Optional category thresholds use known modified totals; bonus dice are not predicted.
- Numeric d20 replacement preserves modifiers and natural critical behavior; cancelled/failed dispatch does not spend a die.
- Compact WB20 button, native-themed Portent/Combat panels and decorative-frame spacing.
- Persistent Musician reminder; shared-page guards prevent repeated rest handling and duplicate windows.
- 18 regression suites and two isolated Chromium fixtures pass. Live sheet/settings layout, rest refresh, tracker spacing and Musician dismissal pass. Live Portent VTT output and Foundry are not claimed.
- Known double-Smite report remains unresolved and deferred, not fixed. Other creatures' Portent rolls are table-managed; turn enforcement requires known tracker state. Divination Savant spell selection is not automated. Existing Lay on Hands persistence remains open.

## v1.65.16 — Prompt reliability and attack order, 2026-10-14

Extension version 2.20.82. Includes the internal-only 1.65.15 ordering repair.

- Overlapping questions share a queue, preserving each popup's title, form and answer.
- Confirmed attacks show weapon damage before optional Smite and Elemental Strike; deferred damage uses the same continuation.
- Existing cancellation, exactly-once resource use, Savage Attacker and Draining handling remain covered by regressions.
- All 17 automated suites pass. D&D Beyond-only Ask-each-time live testing covers full hit/weapon/Divine Smite/Efreeti sequence, four choices, separate elemental totals, resource changes and cancellation.
- The recorded late d8 corresponds to weapon damage, not a replacement Efreeti formula. Exact original overlap trigger remains unknown; the title/body defect is independently reproduced with the actual dialog library.
- Existing Lay on Hands pool persistence and saving-throw damage-only accounting limitations remain. Foundry and broad critical/Draining live coverage are not claimed.
- Public version classification and separate numeric build identity are now documented under Semantic Versioning and Chrome's manifest rules.

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
