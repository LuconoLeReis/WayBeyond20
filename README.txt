WAYBEYOND20 v1.65.2
===================

WayBeyond20 is a customized version of Beyond20 for connecting D&D Beyond
character sheets with Roll20 and supported virtual tabletops.

INSTALL IN GOOGLE CHROME
------------------------

1. Extract the downloaded ZIP file into a permanent location.
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
2. Close or rename the old extracted WayBeyond20 folder.
3. Extract the new ZIP in its place.
4. Open chrome://extensions.
5. Click Reload on the WayBeyond20 extension card.
6. Refresh the D&D Beyond and Roll20 tabs.

If the new folder is stored in a different location, remove the old extension
entry and use Load unpacked again on the new WayBeyond20 folder.

RELEASE NOTES
-------------

Open Updates.html in this folder to see the complete list of changes from the
base Beyond20 extension, including what is new in v1.65.2 and the known
limitations of this test release.

KNOWN LIMITATIONS IN v1.65.2
----------------------------

Lay on Hands does not respond when clicked. Use D&D Beyond's own controls for
it until the replacement is released.

The Concentration check helper uses browser pop-ups, which Chrome hides when
the window is not in front, so it may appear to do nothing.

The Smite prompt also appears on Dragonborn Breath Weapon. Cancel it; Breath
Weapon is a saving throw, not a weapon attack.

A weapon attack rolled from an item does not count your Action in the Combat
window. Attacks listed as actions do.

Draining Attack cannot tell a hit from a miss when damage rolls automatically
with the attack, so it grants Temporary HP either way.

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
