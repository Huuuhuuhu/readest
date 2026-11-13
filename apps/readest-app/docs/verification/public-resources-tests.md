# Public-resource correction: verification record

Baseline: `2227c5166b5f034c8cfe198c8969a176a745215e` (P1).
Date: 2026-11-13. This is a Phase 2 source change, not a replacement signed APK.

## Passed locally

- Five targeted test files, 63 tests: Word Lens pack persistence/failures,
  WordLensPanel refresh/navigation, LangPanel focus restoration, reader gloss
  integration and the TV input controller.
- The added regressions failed before the corresponding fixes: network requests
  despite downloads disabled, waiting on in-flight network work, retry on each
  chapter, missing Refresh, wrong Back owner and lost parent-entry focus.
- Anonymous HTTP resource probes are recorded separately in
  [public-resource-probes.json](public-resource-probes.json). They are not APK tests.
- Edge browser, local dev build with TV mode: imported the repository's Alice EPUB;
  OK → reading menu → More Settings → Language → Word Lens; directions reach Refresh;
  OK refresh leaves focus there; Back returns to the Word Lens entry in Language.
  The browser's CDN request returned `TypeError: Failed to fetch` (cause unconfirmed);
  the page displayed a local download error, not a login/entitlement dialog. This
  verifies the failure/navigation path, not successful native downloading. Direct
  anonymous HTTP probes used a separate network proxy and did succeed.

## Open check: Windows full-suite TTS failures

Running `pnpm test --run` on Windows produced two failures in the unchanged
`src/__tests__/services/tts-paragraph-boundary.test.ts`:

1. `no gap longer than the scheduled pauses after a run of short paragraphs`
   exceeded its 60,000 ms timeout.
2. `a first sentence delivered as its paragraph starts leaves later ones prepared`
   failed after that timeout.

The full run was stopped after recording these failures while the dev server was
also running. It is **not** a full-suite pass, and resource contention is only a
possible cause, not an established explanation. Do not dismiss it merely if the
file passes alone. The isolated GitHub CI full suite must run on the final commit;
keep this local failure distinct from its result. Revisit deterministic TTS timing
and cleanup in the existing Phase 2 TTS work, without weakening assertions or
inflating timeouts to claim success.

## Still required before final acceptance

Android TV key/IME testing, actual native public downloads, cold install with all
official services blocked, cached-resource use after restart, complete account/
telemetry/official-proxy removal, independent-service integration, sample-book and
public-font TV entry points, and the phone portal remain in their planned phases.
