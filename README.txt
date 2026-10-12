WAYBEYOND20 v1.65.10
===================

STABLE RELEASE - 2026-10-12. Extension version 2.20.76.
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
base Beyond20 extension, including what is new in v1.65.10 and the known
limitations of this release.

KNOWN LIMITATIONS IN v1.65.10
----------------------------

The Lay on Hands pool does not stay reduced. D&D Beyond does not record changes
to that counter, so the number returns when you reload the page. Keep track of
the pool yourself for now; healing, conditions and the bonus action are all
applied correctly.

The Concentration check helper uses browser pop-ups, which Chrome hides when
the window is not in front, so it may appear to do nothing.

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
