# WayBeyond20 for TaleSpire

This small official-API Symbiote receives WB20's already-resolved results.
It does not roll a second time or require BepInEx/DLL mods. Roll output needs
no helper. The optional board-return connection uses a separate WB20-owned
loopback helper, not an Internet server.
Supported die faces and modifiers are included in the native result breakdown,
not just the final total. WB20 remains the authority for all calculations.
This is result presentation, not a new physics roll in the TaleSpire tray.

1. In TaleSpire, enable Symbiotes and use **Open Symbiotes Directory**.
2. Copy this **WayBeyond20** folder into that directory, with manifest.json
   directly inside it. Open **WayBeyond20** in the Symbiotes panel.
3. Load a test board. Click **Copy connection** in the Symbiote.
4. In the browser extension's settings, paste into **TaleSpire connection**
   and select **TaleSpire** under the roll destination. Refresh the DDB tab.
5. Roll from the usual WB20 control. If Chrome asks, allow **TaleSpireUrlRelay**.
   The completed result appears in TaleSpire; DDB retains its result too.

Each player who sends rolls installs the Symbiote on their own TaleSpire client.
Ryan does not need a server or access to players' computers. The test button
posts a clearly labeled fixed diagnostic value, not a random dice roll.

Public results use TaleSpire's native result UI, which identifies them as
Symbiote-supplied. Private rolls use GM-only chat because the result API has
no privacy option. Names, formulas and totals are plain text, not executable
code. Do not enter secrets in custom formulas. The connection prefix identifies
the receiver; it is not an authentication token. Any third-party Symbiote
can send its own results, and TaleSpire marks those results accordingly.

Board return (companion 1.1.0) adds read-only mini linking, native initiative
order, picked targets and 3D positions. It currently requires Node.js and the
separate local-bridge.cjs / Start-WB20-Return.ps1 helper. Start it with your
Chrome extension ID; the helper binds only 127.0.0.1:48874 and generates a local
pairing key. Reopen this companion afterward. On DDB select TaleSpire, click
Link mini and explicitly choose your own mini. Select Follow this board's turn
order here only when you want WB20 to follow it. Picking and linking never
move minis or change initiative/HP. Distance is center-to-center straight-line
3D geometry, not pathfinding. Different sub-boards are not compared.

No native HP, movement, ownership or turn-order writes, and no physical
TaleSpire dice animation. The helper is an early local candidate, not yet a
standalone table-ready installer. Its generated local-config.js contains a
pairing key: do not share the installed folder; distribute the clean ZIP.
WB20 remains responsible for its existing follow-ups and resource accounting.
A browser URL handoff cannot confirm game receipt; the Symbiote's Recent
handoffs panel confirms what the game received. If a handoff fails, do not
repeat the original attack just to resend it. There is no automatic retry.

Official documentation: https://symbiote-docs.talespire.com/

Licensed under GPL-3.0-only; see the accompanying LICENSE file.
