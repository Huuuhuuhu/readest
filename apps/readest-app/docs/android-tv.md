# Readest TV implementation

Baseline: upstream v0.12.20 (`28aab23e039a23511bc478c23bf5278daa43cc68`).
This branch is an incremental implementation, not a finished TV release.

## First implementation slice

- A native Android TV bridge routes D-pad, OK, Menu and Back once. System volume,
  Home, Power and voice-assistant keys remain with Android.
- A shared input controller gives the top dialog/sidebar ownership of navigation.
  OK activates the focused control on release; a long OK on a book opens actions
  without also opening the book. A held OK cannot activate a newly opened dialog.
- Focusing a text field does not enter editing. One OK enables editing; one Back
  returns to navigation on the same field with its draft. Android IME dismissal
  notifies the same controller. Native IME behavior still needs device verification.
- Body OK and Menu open the same reading menu. It offers contents, font size,
  maximum columns, day/night theme, scrolling mode, bookmark, TTS, search,
  further settings and the library. Font size and columns adjust with Left/Right
  and save through the original settings implementation.
- Contents owns D-pad navigation, including virtualized rows. Chapter-number
  lookup includes collapsed volumes. Number lookup reveals a chapter; OK on that
  chapter performs the reading jump. PDFs without an outline use page numbers;
  texts without chapters use percentage progress.
- The existing `maxColumnCount = 1` setting provides single-column rendering.
  Turn Scrolled Mode off for paginated reading. No replacement renderer is used.
- A stale `keepLogin` flag no longer redirects library startup to the login page.
  Complete account and official-service removal is a separate, pending slice.
- The Android application ID is `com.bilingify.readest.tv`, allowing side-by-side
  installation with the original app. Local books/settings are separate.

## Verification

Run `pnpm test --run` and `pnpm lint` from this app directory. New regression tests
cover focused Cancel, editing/IME dismissal, removed forms, held OK across a modal,
long OK, input ownership, number adjustment, shelf boundaries and chapter/page jumps.
The TV Android workflow builds armv7 and runs native key-mapping tests. Build artifacts
are development artifacts; an unsigned APK is not an installable release.

Before accepting this slice on a television, verify using only D-pad/OK/Back:

1. Open a book, open contents, select a chapter, return to the body.
2. Adjust font size and columns to 1; close/reopen the app and check persistence.
3. Focus search without an IME; press OK once, type, then Back once and move to
   another control. Repeat in a note and a service configuration form.
4. Open book actions by long OK; focus Cancel in a deletion dialog and press OK.
5. Repeat with and without the Menu button; check system volume/Home still work.
6. Open a several-thousand-chapter book, reveal a chapter in a collapsed volume,
   and confirm that browsing never turns the body page before selecting a chapter.

Browser/unit checks cannot establish Android IME behavior, remote key codes,
readability at television viewing distance, or external file-picker navigation.

## Remaining phases

2. Remove account/payment/entitlement code and official runtime networking; detach
   local and self-configured functions from those dependencies. Preserve direct Edge
   TTS, Android/local TTS and independently configured TTS without official fallback.
3. Add the TV-hosted mobile browser portal for file upload and service configuration,
   shared persistent configuration, temporary device authorization, real LAN address
   selection and network/port changes. Implement independently; do not copy code from
   TVBookReader without an applicable license.
4. Finish advanced reading/playback/selection/form interactions and combined-state
   checks, complete the network manifest, then publish a signed armv7 release.

The complete account-free/offline/phone-portal acceptance criteria remain outstanding.
Do not label an intermediate build as satisfying them.
