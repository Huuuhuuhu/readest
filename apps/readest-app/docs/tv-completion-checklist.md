# TV fork completion checklist

Baseline for this implementation: `9dd95e7` (upstream 0.12.20 plus P1).
The owner authorized completing all phases and publishing a signed armv7 APK.
No new design approval round is required. Device-only checks remain explicitly unverified.

- [ ] Remove Readest authentication, purchases, entitlement code and telemetry from the application and its dependencies.
- [ ] Keep direct Microsoft/system/local TTS; open self-configured TTS and independent services without account gates or official fallback.
- [ ] Keep optional public samples/fonts/Word Lens; explicit remote-accessible downloads, persistent local resources and bounded failure behavior.
- [ ] Preserve independent sync/integrations, removing official cloud channels and replacing required official relays.
- [ ] Add the TV LAN portal: TXT/book upload and shared service configuration, testing/preview, persistence, short-lived authorization, actual interface addresses and network changes.
- [ ] Complete remote navigation, input, special reading modes, selection, modal ownership and focus restoration against the agreed state table.
- [ ] Verify local boot with official services unavailable, independent networking, cache/restart, portal failure/security states and browser remote workflows.
- [ ] Run full unit/type/lint/format checks, Rust checks, Android build and native key tests; address failures without suppressing them.
- [ ] Audit the final network manifest and remove credentials from logs/artifacts.
- [ ] Push as Huuuhuuhu, sign with the existing TV release key, verify APK identity/signature and publish the final release with clear remaining hardware checks.

Scope reference: [network manifest](android-tv-network.md), [TV implementation](android-tv.md),
and the existing local `Readest-TV-完整设计-v2.html` v2.2 state tables.
