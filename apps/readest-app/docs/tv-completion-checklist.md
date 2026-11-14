# TV fork completion record

## tv.4 — spatial focus and foreground speech lookahead

- [x] Prefer the same visible row/column over diagonal targets; retain book-grid columns and send the first row Up to the toolbar's leftmost control. First OK selects a book without opening it.
- [x] Keep upstream dialog layout/theme on short TV viewports; remove the added full-player stop button and make the original mini-player controls reachable.
- [x] Remove Edge's startup synthesis probe and the two-sentence first-play gate. Abort old native/browser sockets and late results on navigation.
- [x] Add bounded foreground-only compressed speech lookahead, beginning at import/current reading anchor. Reuse live synthesis keys and pending results, prune old chapters, and keep explicit offline downloads separate.
- [x] Avoid TV route snapshots and whole-document input rescans on narration text updates.
- [x] Browser remote walkthrough: initial library selection, toolbar Right, Speed → Voice → Back, and original mini-player Stop. Live direct Microsoft sample: 1,797 ms / 19,728 bytes / 7 boundaries on the development computer.
- [x] Import 16 generated TXT fixtures into the real library. Second-row third card Up selects the first-row third card, then Up selects the leftmost toolbar control. No diagonal jump when the final row lacks that column; inline detail buttons do not intercept card navigation. The import tile remains reachable.
- [ ] Final CI/build/signature/publication record follows the code build.
- [ ] Physical ARMv7 TV performance and remote/IME checks remain for the user's installed APK; no hardware is connected here.

## tv.3 — original reading UI and full-width layout

- [x] Remove the separate TV reading menu/tool dialog and reuse Readest's original header, Android footer panels, ViewMenu and settings. Theme colors and component styling remain original.
- [x] Default TV reflowable books to full-width single-column pagination; migrate old global/per-book layouts once while preserving fonts, reading positions and subsequent user choices. Fixed-layout books are excluded.
- [x] Keep directions inside the active toolbar/panel; correct real slider steps, prevent clipped book-cell scrolling and restore visible focus after seeking or disabling a control.
- [x] Verify original controls in Edge TV mode: contents, font size, maximum columns and persistence, light/dark appearance, progress preview/confirmation and search confirm-to-edit/Back-to-navigation.
- [x] Final source `2ae60204822588872afa4ec91b41d2eaa430f83a`: 14,328 frontend tests passed (10 existing skips), 192 Rust tests passed, TypeScript/Biome/format and Rust fmt/clippy passed. [CI run 43558972255](https://github.com/Huuuhuuhu/readest/actions/runs/43558972255).
- [x] ARMv7 compilation and Android native remote-key tests passed. The APK is signed with the existing TV certificate; package/version/ABI/Leanback/no-BILLING and 16 KB ZIP alignment verified. [tv-0.12.20-v3](https://github.com/Huuuhuuhu/readest/releases/tag/tv-0.12.20-v3) is published, with all ten asset digests read back and verified. APK SHA-256 `951f20b5ddcabcbf1f7ad349eff723fd2c4fad04688069585ef947a53b7dfa85`. [Build and publication record](verification/tv-v3-release-build.json).
- [ ] Physical TV/phone validation remains separate; desktop/browser and automated checks are not device testing.

## tv.2 baseline

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

Each release tag points to its exact CI-built code commit. Later documentation/verification-only commits do not alter that APK implementation.
