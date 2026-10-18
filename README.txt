WAYBEYOND20 v1.66.0
===================

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
