# WayBeyond20 Current State

## v1.65.10 / 2.20.76 — 2026-10-12

Stable release source for the attack-follow-up improvements. Based on the previous public v1.65.5 release. Intermediate versions 1.65.6 through 1.65.9 were internal development builds, not separate public releases.

### Included changes

- Compact red-bordered attack icons invoke the existing full attack route. Names retain description behavior; keyboard activation is supported.
- Eligible attacks resolve the attack roll before asking Hit or Miss / Skip. Optional Smite fuel is spent only after hit confirmation and the player's selection.
- Divine Smite completes before the existing four Elemental Strike choices; the rider spends Channel Divinity without an additional Bonus Action.
- Savage Attacker can offer a weapon-only reroll after damage, once per tracked turn. Declining suppresses repeated offers that turn. Its replacement card replaces original weapon damage, not rider damage.
- Automatic damage does not leave a duplicate Roll20 damage link. Deferred links resume their original character's attack once, without another attack or resource spend.
- Draining Attack's managed path waits for confirmed hit and final primary-target damage, including the kept Savage result and excluding the secondary target.

### Validation scope

All 16 automated suites pass, including 20 focused follow-up cases. Live checks on the dedicated Chrome/D&D Beyond/Roll20 test environment verified icon and keyboard attacks, Hit/Miss, both Smite fuels, representative Elemental Strike results, automatic and deferred damage, repeat-click protection, Savage reroll/decline/turn reset, and two-handed d10 damage. Test resources and temporary feat changes were restored.

The release's executable JavaScript and CSS match the live-tested 1.65.9 build. Version identifiers and packaged documentation are finalized in 1.65.10. Critical/Draining combined paths have automated coverage but not full new live acceptance; Foundry connection testing is outside this release's scope. This record does not certify every inherited feature.

### Remaining limitations

- Lay on Hands pool persistence across reload remains unresolved; track the pool separately.
- The concentration check helper still uses browser prompts.
- Damage-only clicks on saving-throw actions do not account for the activation/use.
- Deferred links require the originating sheet to remain open without refreshing; old links are not durable across reloads.
- General effect expiry, broader turn ownership, complete Talent execution, and Foundry callback parity remain separate work.

### Distribution

The Chrome ZIP contains one top-level WayBeyond20 folder, with manifest.json directly inside. Only runtime files, README.txt, Updates.html/Updates.css, assets and required licenses are included. Source and tests remain in Git, not the player package.

[Latest release and download](https://github.com/LuconoLeReis/WayBeyond20/releases/latest)

Historical release details remain in the changelog and version tags. Internal coordination and private test identifiers are not part of this public release record.
