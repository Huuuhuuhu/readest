# TV fork completion record

Baseline: upstream 0.12.20 plus P1. The owner authorized completing all stages and publishing a signed armv7 APK, without a new design approval round.

- [x] Remove Readest authentication, purchases, entitlement/quota code, telemetry and executable dependencies; do not simulate membership.
- [x] Keep direct Microsoft/system/local/custom TTS and independent services without account gates or official fallback.
- [x] Keep explicit public samples/fonts/Word Lens, local resource persistence and bounded failures.
- [x] Preserve independent sync/integrations; remove official cloud channels and required relays.
- [x] Implement the TV LAN portal: book batches, shared TTS/WebDAV/OPDS configuration, preview, persistence, expiring authorization, actual private IPv4/port and network changes.
- [x] Complete remote entry points, navigation, confirm-to-edit, special reading modes, selection, modal ownership and focus restoration. Browser walkthroughs led to additional iframe/rename/reader-tool/TTS-entry/focus-steal regressions.
- [x] Final code CI passed at `d3d21081e03284eac0c4d27fd6d2dfb1942b6653`: 14,320 frontend tests passed (10 skipped), 192 Rust tests passed, TypeScript/Biome/format, Rust fmt/clippy, ARMv7 compilation and Android native key JUnit. [Run 43497283868](https://github.com/Huuuhuuhu/readest/actions/runs/43497283868).
- [x] Exclude unused production browser source maps from the native binary, with explicit developer opt-in and release/debug regression checks.
- [x] Record actual Microsoft synthesis and anonymous public-resource probes, distinguishing them from mock-backed regressions and physical-device tests.
- [x] Replace the obsolete phase-1 documents with final implementation, network manifest and device acceptance instructions.
- [x] Matching signed ARMv7 APK published as [tv-0.12.20-v2](https://github.com/Huuuhuuhu/readest/releases/tag/tv-0.12.20-v2). APK SHA-256 `4288a2ff599470e23a08e864e50a47a6ac6d653f31c6a2aeda32bc08640a3957`; P1 signing certificate retained; package/version/ABI/Leanback/no-BILLING and alignment verified. GitHub asset digests read back and matched. [Build identity](verification/tv-release-build.json).
- [ ] Physical TV/phone checks: Android IME, OEM remote keys, foreground/restart/network changes, complete phone upload/configuration and blocked-official-domain fresh APK boot. No hardware is connected; these cannot honestly be checked by this implementation session.

Documents: [implementation](android-tv.md), [network manifest](android-tv-network.md), [device acceptance](android-tv-acceptance.md).

The release tag points to the exact CI-built code commit above. Later commits only complete documentation and verification records; they do not alter the APK implementation.
