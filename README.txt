WAYBEYOND20 v1.73.23
===================

Release preparation: October 25, 2026. Chrome numeric version: 2.20.155.
This candidate is prepared for review. It has not been published.

WayBeyond20 connects D&D Beyond character sheets to Roll20, Foundry VTT,
Discord and supported local/TaleSpire pathways. It is a modified distribution
of Beyond20. Required GPL and MIT attribution and licenses are included.

WHAT CHANGED SINCE 1.73.2
------------------------

- Compact sheet-themed Manage/WB20/Share, Rest and Correction controls.
- Settings and Manage controls recover after native sheet layout changes.
- Shared feature resource bookkeeping, native Focus discovery, current-turn
  grants and a Correction window. Features depend on possession, not merely
  on having a particular class label. Supported rules still need live text.
- Combat target selection, AC observations, manual gross damage history and
  straight-line token distances. Repeated old TaleSpire target observations
  no longer overwrite a newer explicit sheet selection.
- Combat refresh no longer rewrites unchanged tooltip text in an observer
  loop. Target controls preserve unfinished inputs during ordinary updates.
- Foundry routing tolerates renamed worlds and service-worker sleep, while
  checking live tabs and their permitted or trusted origins.
- An optional secondary attack lifecycle reuses existing builders and rule
  modules. It handles explicit hit outcomes, damage continuation and queued
  resource costs. Existing routes remain available.
- Full attack icons and numeric shortcuts wait for native attack data.
  Invalidated extension instances leave input to the active instance.
- Managed damage has one owner for the Draining Attack temporary HP award.

VERIFICATION
------------

On October 25 the candidate passed the standard npm suite, supplemental
resource/turn/distance tests, all 22 isolated browser test files, both builds
and compiled JavaScript syntax checks. These isolated tests use fixtures;
they are not substitutes for every supported live tabletop environment.

The live Roll20 character check covered a full natural attack, explicit hit,
AC observation, damage delivery, Draining Attack, hit-only/deferred damage,
repeated continuation protection, turn reset and state restoration.
A second character verified two Flurry strikes, one activation charge, a shared
native Focus pool, Hand of Harm and native resource restoration.
Known character values were restored after testing; native chat retains test
rolls. The local turn counter advances when a real test turn is observed.

Experimental: Test secondary character attacks remains OFF by default.
An existing user's explicit saved setting is preserved. Creature feature,
resource and target parity, and attribution of anonymous native dice, are
not complete. Do not treat this candidate as a finished universal executor.

INSTALLING IN CHROME
-------------------

1. Extract the Chrome ZIP into the permanent parent directory you want to use.
   Windows Extract All may suggest an additional ZIP-name folder. Choose the
   intended parent to avoid adding an unnecessary outer folder.
2. The archive creates one WayBeyond20 folder with manifest.json inside it.
3. Open chrome://extensions and enable Developer mode.
4. Choose Load unpacked and select that WayBeyond20 folder, not the ZIP.
5. Keep the folder at that permanent path.
6. Refresh open D&D Beyond and VTT pages.

Disable the original Beyond20 extension while using WayBeyond20. Two enabled
copies can add duplicate controls or send duplicate rolls.

UPDATING WITHOUT LOSING SETTINGS
-------------------------------

1. Back up the contents of the existing loaded WayBeyond20 directory.
2. Replace those contents with the verified new extracted contents, keeping
   the SAME loaded directory path. Do not remove the extension as an update.
3. On chrome://extensions, choose Reload for the existing WayBeyond20 entry.
4. Refresh open D&D Beyond and VTT tabs to replace their injected scripts.

Older orphaned script instances cannot acquire a new guard retroactively.
Refreshing the sheet after an extension update is required. Keep the DDB
sheet open and do not refresh it while an attack awaits deferred damage.

COMBAT BOOKKEEPING
------------------

Attacks means standard attacks remaining inside an Attack action already
started. A fresh turn therefore has Action 1 and Attacks 0. A one-attack
character has Attacks 0 after that attack too. Special granted attacks and
Haste use separate currencies. New Turn resets WB20 counters; it does not
advance the native VTT turn. End Combat does not end the native VTT battle.

The tracker is advisory. Unavailable resources can be overridden. Correction
edits remaining values independently, so the user must reconcile related
Action and attack allowances. A performed roll and a later native counter
write are not one atomic transaction; use Correction after a write warning
rather than repeating an already performed action just to charge it again.

AC is inferred from confirmed hit and miss totals; natural 1/20 automatic
observations are excluded. Manual totals have no natural-die information.
Changing defenses can invalidate an estimate. Target notes survive End Combat.
Damage history is manually recorded gross damage, not enemy HP synchronization.
Distance is a straight line between token centers, not path cost, reach or
cover. Token movement does not automatically deduct the Movement allowance.

VALIDATION LIMITS
-----------------

This preparation has no new full live Foundry/Forge or TaleSpire acceptance
run. Those adapters have automated coverage and earlier bounded evidence.
The full legacy/secondary caller matrix and every rules combination have not
been accepted live. English rules parsing and external DDB markup remain
dependencies. Missing or ambiguous data must be reviewed rather than invented.

Source, version history and known limitations are described in Updates.html
and the corresponding release source. GitHub's automatic source ZIP is not
the installable Chrome package; use the separately named Chrome ZIP.

TROUBLESHOOTING
---------------

Missing or unresponsive controls: refresh the sheet after extension Reload.
Duplicate rolls: check that only one Beyond20/WayBeyond20 copy is enabled.
Missing manifest: select the extracted WayBeyond20 directory itself.
Failed counter update: inspect Correction and the native resource display.

LICENSES
--------

LICENSE and LICENSE.MIT accompany this modified distribution. Preserve both.
