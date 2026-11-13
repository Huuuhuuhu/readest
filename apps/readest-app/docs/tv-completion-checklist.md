# TV fork completion record

Baseline: upstream 0.12.20 plus P1. The owner authorized completing all stages and publishing a signed armv7 APK, without a new design approval round.

- [x] Remove Readest authentication, purchases, entitlement/quota code, telemetry and executable dependencies; do not simulate membership.
- [x] Keep direct Microsoft/system/local/custom TTS and independent services without account gates or official fallback.
- [x] Keep explicit public samples/fonts/Word Lens, local resource persistence and bounded failures.
- [x] Preserve independent sync/integrations; remove official cloud channels and required relays.
- [x] Implement the TV LAN portal: book batches, shared TTS/WebDAV/OPDS configuration, preview, persistence, expiring authorization, actual private IPv4/port and network changes.
- [x] Complete remote entry points, navigation, confirm-to-edit, special reading modes, selection, modal ownership and focus restoration. Browser walkthroughs led to additional iframe/rename/reader-tool/TTS-entry/focus-steal regressions.
- [x] Run frontend regression/type checks and prior complete CI; Rust fmt/clippy/tests and Android build/native key tests passed at cff6bb2. The release workflow must also be green for the final code commit.
- [x] Record actual Microsoft synthesis and anonymous public-resource probes, distinguishing them from mock-backed regressions and physical-device tests.
- [x] Replace the obsolete phase-1 documents with final implementation, network manifest and device acceptance instructions.
- [ ] Final commit CI, matching signed APK verification and publication (recorded in the GitHub release and build identity).
- [ ] Physical TV/phone checks: Android IME, OEM remote keys, foreground/restart/network changes, complete phone upload/configuration and blocked-official-domain fresh APK boot. No hardware is connected; these cannot honestly be checked by this implementation session.

Documents: [implementation](android-tv.md), [network manifest](android-tv-network.md), [device acceptance](android-tv-acceptance.md).
