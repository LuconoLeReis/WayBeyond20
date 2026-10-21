WAYBEYOND20 v1.73.2
===================

LOCAL DEVELOPMENT CANDIDATE - 2026-10-21. Extension version 2.20.129.
Corrects DDB proficiency-label parsing, native 2014 skill proficiency/expertise
flags, and saving-throw bonuses/proficiency. Local candidate; live retest pending.
The 2014 Roll20 sheet now receives its visible ability, proficiency, AC, speed,
passive Perception, skill-bonus, and sense fields, even if Roll20's sheet worker
does not run for an attribute created from the VTT page.
Optional DDB-to-Roll20 core-data sync is off by default. It creates wb20_* macro
attributes and, where supported, native ability/AC/sense data. Offline tests
pass; a live 2024 sheet and Wren's macros have not yet been verified.
Roll20's loading state is no longer published as an ended battle. A live full turn cycle passed, but reloading Roll20 incorrectly refilled spent resources and zeroed the turn count. The loading guard passes regression tests; live acceptance of this correction awaits reload.
Target edits now refresh immediately instead of waiting for the storage callback, closing the gap before the next mouse press. The existing pressed-pointer guard remains. Expanded rapid Undo regression checks pass; live acceptance awaits reload.
Fixes observer-starved attack-icon handoffs and preserves unfinished target inputs during updates. Live acceptance awaits reload.
Link My Token in the WB20 header menu lets you choose this character's token
from Roll20's turn order without rerolling initiative. It replaces a stale link
without moving tokens or changing counters, turn order or the selected enemy.
Duplicate names show token IDs. Cancel changes nothing. Live verification awaits reload.
Combat stays below the character sheet when DDB rebuilds its content. The
existing tracker is repositioned without recreating controls or changing the
battle, selected target, unfinished input or compass preview. Local regression
checks pass; live acceptance of this placement fix awaits extension reload.
The compass rim is wider and lower around side names, with unchanged height.
Unavailable distance now explains the missing input: token layer, coordinates,
map scale or character-token identity. This is diagnostic, not a claim that
the live distance failure is repaired. Select Target and Viewing passed live;
numeric distance remains unverified, including the temporary self-token test.
Select Target chooses the token currently centered in the compass. Browsing
shows Viewing with a small Back to current arrow. Hover or focus the centered
name for initiative, recorded AC/gross damage with types, and straight-line
center-to-center distance from your character's Roll20 token. This floating
card adds no tracker height. Escape dismisses it; tap the name also opens it.
Distance uses Roll20 map coordinates and scale, not pathfinding or reach.
Missing/ambiguous character tokens or unavailable map geometry show unavailable.
Roll20 movement refreshes distance without changing the turn, resources,
target selection, unfinished inputs or compass preview. Refresh the Roll20
tab after reloading the extension to start the new position feed.
One shared compass front curve replaces the separate ovals. The current name
is larger; side names recede and filled curved arrows follow the rim. No added height.
Combat's centered turn compass shows the active combatant and angled previous
and upcoming names. Click either side to browse, then Back to current to return.
Browsing does not advance combat, change targets, or spend resources. The far
right shows only combat source and turn number. Reduced-motion is respected.
The Target row is centered. Viewing and the return arrow share the caption line
while browsing, with no extra row or page refresh. Local scroll-position tests pass.
Combat and My Target share one sheet-themed frame. Resources and Select Target,
New Turn and End Combat share a toolbar; the target is a horizontal row below.
Controls wrap only as needed. No forced 240px height or separate target box.
Custom formulas support typed groups: {Fire:3d6}+{Piercing:1d6+6}.
Unmarked parts use the global damage type. Each type has a subtotal, with a
combined total and the original formula shown. F/P/D shortcuts are supported
as Fire/Piercing/Divine; use Radiant or R for standard radiant damage.
Combat now has My Target, populated from named Roll20 turn-order tokens and
their initiative values. Enter an attack total and click Hit or Miss to narrow
AC, with Undo. Target notes persist per character/token. Gross damage can be
recorded by type under Damage & history; it does not change token HP or infer
resistances. This candidate does not automatically collect other players' damage.
Damage & history expands on demand. Narrow screens wrap the compact controls.
Typed-roll delivery, AC tracking and fresh battle initiative passed live on
1.69.0; native theme passed live on 1.69.1 and compact layout on 1.69.2.
The 1.70.2 compass passed live. New targeting/distance awaits live reload. Not published.

Only Attack/Damage and Healing spell categories are visible by default. Manage
can enable the others. Closed spell selectors show only the spell name; their
border and arrow appear on hover or keyboard focus without moving the layout.
Hover descriptions come from identity-checked native D&D Beyond spell details.
Remembered visible selections automatically load missing descriptions in one
bounded batch and return to Actions without casting. Cached descriptions are
reused. Existing sidebars/dialogs defer loading; failures do not retry forever.
Hover itself never navigates or casts. Manage says Use detected category and
shows the detected category, replacing the vague Automatic label.
Cantrip pane matching accepts the Cantrip label after the school label while
still requiring the exact spell name and source.
Spell-list handoffs wait for the native tab transition before reading its rows,
so asynchronous sheet rendering does not abandon casting or tab restoration.
Universal spell-category rows use the live available Spells list, with separate
casting times and remembered source/level choices. Initial discovery briefly
visits Spells and restores Actions. Clear native spell filters for full coverage.
Manage hides/restores quick-list entries, overrides display categories, and
adds/edits/removes custom dice rows. These settings belong to the character.
Custom dice support Nd4/6/8/10/12/20/100, +/- constants, kh/kl/dh/dl, one-time
ro<=N rerolls and minN dice-group minimum totals. Maximum 100 dice, 240 chars.
Damage type labels appear on the row and result. Formula is shown with results;
normal audience/whisper settings remain unchanged. No special disclosure.
Parentheses, multiplication, division, exploding dice and variables are not
supported by this bounded grammar. Unsupported syntax is rejected, not ignored.
Custom rows do not automate attack riders, slots, limited uses or HP changes.
Unknown spell effects stay in Other; longer casting is purple, not free.
No publication or live casting acceptance is implied by automated fixtures.
Opportunity Attack choices have separate full-width fields and collapsible rules.
Turn questions and gameplay behavior are unchanged. Color legend labels explain
their action costs on hover, with the same descriptions available to screen readers.
Natural/unarmed melee attacks without a weapon Properties field no longer fail
inside the Great Weapon Fighting helper. Missing properties do not grant it.
Action borders are brighter green. Opportunity Attack remembers this character's
last successfully chosen melee attack. Its subtitle and numbers come from that
live attack; the icon uses it and Choose different Attack opens the chooser.
Right-click the icon for roll mode. Missing or ambiguous defaults require a new
choice. With no known turn, the shortcut asks whose turn rather than guessing.
The chooser's click finishes before opening native details so DDB's outside-click
handler cannot immediately dismiss the pane.
Opportunity Attack tolerates a native list-row replacement while opening
its detail pane. Character, turn and matching pane validation remain intact.
Free/Special icon borders and the matching legend now use medium gray.
Action green, Bonus Action blue and Reaction red are unchanged.
Blood and Bone's chooser reads Target / Hit Die on two deliberate lines.
Its five Notes shortcuts share the width of d12 plus four-pixel side padding.
Opportunity Attack has a red Reaction icon and an attack/reach/mode chooser.
It uses one Reaction for one melee weapon attack or damaging Unarmed Strike,
not an Action or an Extra Attack. Cancel and failed delivery spend nothing.
Off-turn attacks cannot offer a new Bonus Action Smite, including delayed damage.
Draining Attack remains based on Unarmed Strike and actual feature possession.
Agile Strikes uses a bounded already-paid attack grant, without another Action.
Live rules granting a reactive spell replacement unlock the spell choice.
That path checks one-Action casting time and retains native casting resources;
the player confirms the exact trigger, single provoking target and slot timing.
Timing checks omit unambiguous inapplicable modifiers and show unresolved
or multi-benefit rules for confirmation. This is not a complete rules engine,
automatic VTT reach detector, or general Monk/multi-attack feature executor.
Fangs/Claws uses the sheet's existing Unarmed Strike icon.
Offline verification is separate from live acceptance after reload. Not published.

View beside Sort offers Standard and Compact for the combined talent list.
Standard gives native and added rows consistent dotted separators and spacing.
Compact removes the lines and reduces spacing, without shrinking text/buttons
or changing column alignment, sorting, activation or resources.
The selected view persists per character. Bill accepted these views in 1.66.11.
Blood and Bone now shows Range: 5 ft Touch, Hit/DC: --, and a Target Hit Die
button in Damage (HP Die on phones), with d4/d6/d8/d10/d12 buttons in Notes.
The Damage button opens the existing Use chooser. Choices wrap
within Notes and invoke the existing controls. Range sorting uses 5 feet;
the target's Hit Die is not treated as fixed attack damage.
Off-turn attacks no longer consume an existing Attack-action pool, and
known off-turn Bonus Actions are unavailable to the Smite helper.
Opportunity Attack UI and complete follow-up eligibility remain unfinished.
Talent subtitles describe purpose, not economy: Help Ally for Bardic
Inspiration and Heal Ally for Blood and Bone. Match native attack subtitle
typography. Cost colors, native attack descriptions and execution unchanged.
The left Use icon retains the full die chooser. No new Hit Die resource path.
Added action labels now match the native sheet label's font family, size,
weight, line height and letter spacing. Calan's original mismatch was measured
live: Roboto 13px versus native Roboto Condensed 14px; added Inspiration was bold.
More Options code is unchanged: it loads in an unconnected duplicate tab.
The reported blank window in the connected tab remains a separate investigation.
Unarmed attack classification now precedes the on-hit continuation decision.
Draining Attack checks the required Natural Attack trait and unarmed semantics,
not an Agile Strikes name or Smite flag. Hit confirmation still precedes damage
and Temporary HP; live gameplay confirmation remains pending.
Agile Strikes rules now link from Bardic Damage's Notes instead of a second
empty shortcut row when both are present. Native attack range, bonus, damage,
identity and controls remain intact. Missing attack leaves the rules shortcut.
Shared attack and non-attack feature rows, including the features shown in
DDB's Actions, Bonus Actions and Reactions sections. Bardic Inspiration uses
the native columns; its inspiration die appears in Notes, not Damage.
Compact Sort button opens Action order, Name, Damage and Range choices.
Damage sorts displayed primary formula averages, unknown/non-damage last.
Range sorts normal range, longest first. Choices persist per character.
Feature shortcuts use supported existing controls or open native details;
they do not invent execution or spend resources just by opening details.
Manage visibility, chosen spells and custom formulas are future work.
Responsive Actions header: native Attacks per Action count and colored legend
on the left, Sort aligned right. Uses one line when it fits and wraps when
the actual panel width is smaller. No spacer text or fixed screen assumptions.
Combined action rows default to Actions, Bonus Actions, Reactions, with an
alphabetical/damage/range sort options. Green/blue/red borders show economy; black denotes
free/special, with Bardic Damage among Actions. Native controls stay in place.
Bardic Inspiration has a left-side musical-note button using the Inspire path.
The character-specific Combined Action List switch restores the native layout.
Live validation of this layout revision is pending. Not published.
Full-attack icons and red attack buttons share an immediate right-click menu:
Advantage, Flat (One Die), Disadvantage, then Roll Full Attack. No attack or
turn warning begins until Roll. Dismissal does nothing. Recipient settings
are unchanged. Native numeric attack/damage buttons retain their own menus.
Smite discovery waits for hit/damage and restores the tab before its chooser.
Lay on Hands confirms the native pool adjustment instead of leaving a preview.
The revised menu awaits live validation. LOH persisted in a live dev.2 test.
Free Smite replay repair passed one
live DDB-only attack/Smite/Elemental sequence in dev.1, not reporter/VTT closure.
Not published. Previous stable release notes follow.

RELEASE 1.66.0 - 2026-10-18. Extension version 2.20.87.
Portent Dice now appear beside the character name for characters with Portent.
A completed Long Rest replaces the pool with two dice (three for Greater
Portent). Installation or page refresh does not grant a new roll; use Set
today's dice to enter existing results, including any already spent.
Click a die to select it, or click again to deselect. The next supported d20
test offers confirmation before replacing the raw d20 while keeping modifiers.
No rolls normally; Cancel stops the roll without spending the die. The warning
can be disabled and restored in Portent Settings. Optional Portent Prompts
offer dice meeting per-category modified-total thresholds. Blank categories
stay quiet; random bonus dice are not predicted.
The WB20 header button is smaller, and Portent and Combat follow sheet styling.
Combat reserves space so decorative borders do not overlap its contents.
Musician rest reminders now remain in a window until dismissed. Duplicate
rest handling/reminders across extension contexts are guarded.

KNOWN ISSUES AND TEST SCOPE
Double-Smite is still reported and is NOT fixed in this release. The exact
duplication path remains under investigation. Check Smite prompts, damage and
resource use with your group; do not count unintended duplicate damage/spends.
Portent replacement currently handles supported rolls initiated from your own
sheet. Other creatures' rolls remain table-managed. Once-per-turn tracking
requires a known combat tracker turn. Divination Savant spell selection is not
automated. Existing Lay on Hands pool-persistence limitations remain.
Automated regression/browser tests cover Portent selection, confirmation,
cancellation, spending, thresholds and renderer behavior. Live D&D Beyond
checks cover panel/settings layout, Long Rest replacement, Combat spacing and
one Musician reminder with clean dismissal. Live Portent VTT output and broad
Foundry coverage have not been verified for this release.

PREVIOUS RELEASE
RELEASE 1.65.16 - 2026-10-14. Extension version 2.20.82.
Shared prompts now wait their turn instead of replacing an already open
window's title and answer handler while leaving the previous contents visible.
The overlap defect is reproduced and covered by automated regression tests.
Attack follow-ups now send weapon damage before Smite and Elemental Strike.
Deferred damage waits for its button before offering those riders. The full
D&D Beyond-only sequence passed live testing in 1.65.16 with Ask each time,
including separately labeled elemental damage and cancellation checks.
No Lay on Hands pool persistence correction is included.
Roll20 rendering has automated regression coverage in this patch. The final
live Roll20 smoke test was inconclusive because the test tabletop also failed
to display its own native dice rolls. This is not a claim of live Roll20 acceptance.

VERSION POLICY
--------------
Public versions use Semantic Versioning 2.0.0 (https://semver.org/spec/v2.0.0.html):
compatible fixes increment PATCH; compatible new capabilities increment MINOR;
breaking changes increment MAJOR. The documented compatibility contract covers
roll-message fields/events, saved-settings migrations, supported controls and
installation/update behavior. Internal helpers are not a public API.
Chrome's numeric version is a separate increasing build identity. The public
version is shown in version_name. Published releases are never overwritten.
See VERSIONING.txt in the corresponding GitHub source for the full contract.

Previously released in 1.65.14:
Includes the concentration, spell-casting and buff-display improvements tested
in internal builds 1.65.11 through 1.65.13.
Native spell-row Cast/Use buttons now run the existing WayBeyond20 spell
handling, including target/effect choices, and mark the native resource once
after a successful cast. Cancelling before casting spends nothing.
Active buffs appear below BUFFS beside DEFENSES, right-aligned in the native
sheet text style. Click a buff name for its details and End control.
Click the red-outlined attack icon for a full attack. Hover highlights it;
the weapon name still opens its description. Existing attack options apply.
Attack helpers now wait for the attack result and a Hit answer. Divine Smite
then offers the existing Elemental Strike choices. Savage Attacker can ask
after weapon damage, once per tracked turn; outside tracked combat it remains
available for each attack. Disable its new per-character prompt setting to use
the existing next-roll/locked behavior. Follow-up damage cards supplement the
original attack; a Savage Attacker replacement card REPLACES weapon damage.
For deferred damage, keep the originating character tab open.
Roll20 only shows the damage link when damage is actually deferred, not when
the character sheet is already managing the automatic damage follow-up.

WayBeyond20 is a customized version of Beyond20 for connecting D&D Beyond
character sheets with Roll20 and supported virtual tabletops.

INSTALL IN GOOGLE CHROME
------------------------

1. Extract the downloaded ZIP into the permanent parent folder you want to use.
   In Windows Extract All, remove any automatically added ZIP-name subfolder
   from the destination if you do not want an extra outer folder.
2. The ZIP creates one folder named WayBeyond20.
3. Open chrome://extensions in Chrome.
4. Turn on Developer mode in the upper-right corner.
5. Click Load unpacked.
6. Select the WayBeyond20 folder itself. That folder contains manifest.json.
7. Confirm that WayBeyond20 appears and is enabled.
8. Refresh any open D&D Beyond and Roll20 tabs.

IMPORTANT
---------

Do not select the ZIP file in Chrome. Extract it first, then select the
WayBeyond20 folder created by the extraction.

Keep the extracted WayBeyond20 folder in a permanent location. Chrome loads
the extension from that folder, so moving or deleting it will break the
installation.

If the standard Beyond20 extension is installed, disable it while using
WayBeyond20. Running both at the same time can cause duplicate controls,
duplicate rolls, or conflicting behavior.

USING D&D BEYOND WITH ROLL20
----------------------------

1. Open the desired D&D Beyond character sheet.
2. Open the Roll20 campaign in another tab in the same Chrome profile.
3. Keep both tabs open while playing.

UPDATING WAYBEYOND20
--------------------

1. Download the new WayBeyond20 ZIP.
2. Back up or rename the old extracted WayBeyond20 folder.
3. Extract the new ZIP so WayBeyond20 occupies the SAME full path as before.
4. Open chrome://extensions.
5. Click Reload on the WayBeyond20 extension card.
6. Refresh the D&D Beyond and Roll20 tabs.

If the new folder is stored in a different location, remove the old extension
entry and use Load unpacked again on the new WayBeyond20 folder.

RELEASE NOTES
-------------

Open Updates.html in this folder to see the complete list of changes from the
base Beyond20 extension, including what is new in v1.65.14 and the known
limitations of this release.

KNOWN LIMITATIONS IN v1.65.14
----------------------------

The Lay on Hands pool does not stay reduced. D&D Beyond does not record changes
to that counter, so the number returns when you reload the page. Keep track of
the pool yourself for now; healing, conditions and the bonus action are all
applied correctly.

The Concentration Check window opens after sheet damage while concentrating,
or from the Concentration badge. Already-adjusted damage stays Unmodified.
Conditional resistances need manual adjustment; unavailable roll results
leave concentration unchanged. The window does not deduct HP again.
Add source combines damage components for one check; use separate checks for
separate hits. The native casting bridge covers the spell-list Cast and Use
buttons, not the separate spell-sidebar slot buttons or item-charge controls.
Use the spell-list buttons for the integrated casting/resource flow.

Rolling only a damage die on a saving-throw action does not spend its use or
your Action.

Draining Attack now waits for hit confirmation in the managed attack flow.
Its new damage ordering and critical/versatile combinations have automated
coverage; those combinations have not all been tested live in this release.
Foundry connection testing was outside this release's live test scope.
Deferred damage requires the originating D&D Beyond sheet to stay open and
not be refreshed before clicking Roll Damages.

TROUBLESHOOTING
---------------

Controls do not appear:
Verify that WayBeyond20 is enabled, then refresh the D&D Beyond page.

Rolls appear twice:
Disable the standard Beyond20 extension, then refresh D&D Beyond and Roll20.

Chrome says manifest.json is missing:
Select the WayBeyond20 folder, not the folder containing it and not the ZIP.

LICENSES
--------

The distribution includes LICENSE and LICENSE.MIT as required licensing files.
