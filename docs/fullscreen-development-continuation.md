# Fullscreen development continuation

## Release 0.9.0 — November 15, 2026

The user explicitly requested a public feature release after the earlier
readiness review. Version 0.9.0 includes the bundled helper and subsequent UI,
reminder and pointer refinements. The earlier local-only/no-version-bump notes
below describe historical checkpoints. Security remediation remains separate
and its unresolved findings are included in the release notes.

Package/Tauri/Cargo versions are aligned at 0.9.0. The existing updater public
key matches the previous release and verifies its signed 0.8.0 installer. Private
signing keys remain in GitHub Actions. The release workflow uses the VS 2026
runner and creates a draft with the installer, updater signature, latest.json,
complete matching source ZIP and SHA-256 checksums. Publication follows asset
and signature verification. See [0.9.0 notes](releases/0.9.0.md) and the
[release page](https://github.com/paavalipopov/ghostlink/releases/tag/v0.9.0).

## Sharper pointers and Linux VM assessment — November 15, 2026

Removed the blurred SVG drop-shadow filter from both arrow and ghost pointer
faces. The dark outlines, geometry, labels, movement mapping and click-blink
effect remain. WebView2 checks confirmed normal and click-blink SVG copies have
no filter in both styles, and the existing frame/overlay/session checks passed.
The refreshed local Windows installer is 3,805,719 bytes (3.63 MiB), with matching
portable files, source archive and checksums.

[Linux VM testing status](linux-vm-testing.md) records the partial X11 fallback,
intended native-host build commands, Windows-only features and test gates. No
Linux build is claimed. A key additional blocker for peer tests is browser RTC:
upstream WebKitGTK 2.54 disables WebRTC during its backend transition. Check the
actual VM runtime/data-channel support before promising peer interoperability.

## Fullscreen exit reminder — November 15, 2026

The existing click-through overlay now shows a translucent reminder in the
upper-right of the fullscreen image, including with Frame off:

```text
To exit full screen
press Alt+Shift+A
```

For the first four seconds it pulses six times (about 1.5 Hz), with short fades
and held bright/dim phases. The text stays white while the entire label,
including its shadows, alternates between 100% and 40% opacity. It then remains
at the normal 65% opacity. Reduced-motion settings
disable the introduction animation and leave the steady hint. Repeated status
updates do not restart it; a new fullscreen entry mounts a new hint.

The initial animation changed text-color alpha while leaving its black shadows
at full strength, which made it look like gray text. The corrected animation
uses whole-element opacity. Transparent PNG captures confirmed the dim/steady
phases contain 39.96%/65.08% of the bright phase's total alpha, including shadows;
the earlier dim phase retained 79.84%. The six-pulse timing is unchanged.

Native status updates show the hint only while the owned helper reports scaling.
It hides on pause, stop, failure and exit; its initial state is restored after an
overlay reload. If the app-wide Alt+Shift+A registration is unavailable, it names
the helper's guaranteed Ctrl+Alt+F11 exit instead. The bootstrap command is
read-only and restricted to the overlay. Existing source/display bounds, guest
rendering, native click-through and focus behavior are unchanged.

Validation: 30 TypeScript and 21 Rust tests passed, with the Rust subprocess
fixture exercised separately by its parent test. Prototype typechecking, scoped
ESLint, the Windows/NSIS build and standard WebView2 desktop checks passed. A real
animated-window capture confirmed the native reminder appeared with Frame off
and a guest present, and disappeared after timed stop. The final two-line layout,
666.667ms x 6 timing, 100%/40%/65% group opacity and reduced-motion behavior were
verified in an isolated WebView2 CSS check without further desktop input. The
final animation has not had another live-capture/manual-input trial.

The refreshed local installer is 3,806,414 bytes (3.63 MiB). Portable files,
matching sources and checksums are refreshed in the existing local output folder.
No version bump, signing change or public release is included. The release
blockers below remain open.

## Matching shared-area pills — November 14, 2026

The two pills beside Shared area now both measure 80px wide, with centered
content and equal spacing from the centered title. Frame retains on/off text in
a fixed status slot so its content stays still. Fullscreen displays only its
name; its existing accessible pressed state also selects a highlighted appearance.
The 266px panel width is retained. A local WebView2 geometry check measured pill
centers at 52px and 214px around the title center at 132.994px.

All 30 TypeScript tests, prototype typechecking and scoped ESLint passed; the
Windows installer was rebuilt. The local installer is now 3,801,449 bytes
(3.63 MiB), with portable files, matching sources and checksums refreshed alongside
it. Release blockers below remain unchanged; this is a development-branch update.

## Compact panel and release readiness — November 14, 2026

The Windows panel now targets **266 logical pixels**, down from 332 (80.1%).
The shared panel without the Windows fullscreen toggle uses 240 instead of 300.
Narrower toggle widths, button padding and gaps keep all labels visible; the
Shared area heading remains centered. Ordinary button/input text sizes and
button heights are retained. The section heading is 12px. Windows startup width
and the content-driven fitted width agree, avoiding an initially wide window.

Validation: all 30 TypeScript tests, prototype typechecking and scoped ESLint
passed. The Windows release/NSIS build and real WebView2 checks passed, including
panel width (with one pixel of native DPI rounding tolerance), control/label
overflow, centered heading, stable frame states, physical overlay placement,
guest rendering, session filtering and saved preferences. Before/after captures
at the local 125% scale were visually reviewed. The development test script can
save a panel image with `GHOSTLINK_PANEL_SCREENSHOT=<output.png>`.

The refreshed unpublished installer at the local path below is **3,800,367 bytes**
(3.62 MiB). Portable files, matching sources and checksums are refreshed alongside
it. The matching source package reuses the previous verified dependency sources
after checking unchanged dependency lockfiles; all application sources are fresh.
No dependency, helper implementation, version or signing key changed.

**Release decision: not ready for a public GitHub release.** The conditional
release request was evaluated against the current installed Trystero core
0.26.0 and application integration, not just the older security report. Local
in-memory reproductions still confirmed:

- After leaving an old room, a retained peer entered a new room and delivered a
  movement message without its new secret. The opposite-role control rejected
  the same attempt.
- Twenty unauthenticated announcements caused twenty offer-allocation requests
  and peer-state entries with RTC allocation stubbed.
- A 64 MiB movement transfer was admitted before application validation; the
  transfer was canceled before allocation. Five hundred small valid movements
  reached the handler without a receive-rate cap.
- Short secrets remain susceptible to offline guessing from the public topic.

No real peers or relays were contacted. Authentication and resource-limit
remediation remains the separate task in [security-review-0.8.1.md](security-review-0.8.1.md).
Do that work and its regressions before a public release. The previously listed
game/two-PC/real-hotkey trials also remain open. This UI checkpoint is pushed to
the development branch; no version tag, draft or public release is created.

## Review fixes — November 14, 2026

Reviewed remote `codex/tauri-windows-prototype` at `f76bcf2`. That checkpoint
implemented the requested Shared area heading, Fullscreen pill and Alt+Shift+A.
The four review findings are now fixed in `codex/fullscreen-review-fixes`:

- Reserve the transition before reading controller state. Button and shortcut
  requests during a transition are rejected immediately; the shortcut message
  loop remains responsive while start/stop runs on a worker.
- Recognize closed control pipes on writes as well as reads. Wait briefly for
  the process exit code so a clean helper exit becomes idle; a nonzero exit or
  an unresponsive running helper remains a failure.
- Restore frontend window eligibility when native tracking reports a restored
  window after a rejected attempt while minimized.
- Restore the display selector when multiple displays are available, including
  Linux X11, and rename the monitor-selection action to **Entire display**.

Validation: 30 TypeScript tests and 19 Rust tests passed. The Rust suite also
runs its otherwise-ignored subprocess fixture twice to cover closed pipes before
clean and nonzero process exits. Regression coverage includes lock contention,
minimize/reject/restore, and secondary-monitor selection with negative origins
without Windows window picking. Prototype typechecking, scoped ESLint and the
release build passed. Real Tauri/WebView2 checks passed for the heading/toggles,
native physical placement, frame stability, guest rendering, session filtering
and preference restoration. The latter use synthetic native IPC and do not prove
real hotkey input, game capture, click-through or physical multi-monitor behavior.

An unpublished installer was rebuilt with the unchanged bundled native helper:
`dist/fullscreen-prototype/Ghostlink_0.8.0_x64-setup.exe`, 3,799,841 bytes
(3.62 MiB). A portable copy is under `dist/fullscreen-prototype/portable`.
These paths are in the review-fix worktree
`C:\Users\paava\.codex\worktrees\9230\ghostlink`; older paths below are historical.
The matching source archive and SHA-256 manifest are regenerated alongside it.
No new performance measurements were taken; earlier fixture measurements below
remain the available evidence. No version, signing key or security remediation
changed, and no release was published.

To try this candidate, exit the previous Ghostlink copy and launch the portable
executable or install the new local installer. Pick a normal window, toggle
Fullscreen with the pill and Alt+Shift+A, then minimize/restore and retry after a
rejected minimized attempt. Rapid shortcut presses during a transition should
not cause a delayed second toggle. On multiple displays, choose a display and
use Entire display or Drag frame. Arbitrary-region capture is still unsupported.

Remaining manual checks: Explorer, Telegram and a windowed game; real shortcut
and emergency-exit input; guest click-through, edge alignment, Alt-Tab/camera
behavior and two-PC sessions. Linux X11 and physical multi-monitor selection
remain unverified. Mixed physical display scaling is skipped as requested.

## Next UI and shortcut work requested by the user — November 12, 2026

These are implementation tasks for the next agent; they have not been implemented.
This request supersedes the earlier UI-redesign deferral for the following controls:

1. Rename the heading **Shared display** to **Shared area**.
2. Put one **Fullscreen** on/off toggle immediately LEFT of that heading.
   Match the existing Frame on/off button's styling and stable dimensions.
   Keep the Frame toggle on the right. Remove the separate Dev fullscreen and
   Stop buttons, and remove the idle/status indicator from this row.
3. Use the same toggle for entering and exiting fullscreen. Derive its state
   from the native helper/session, including hotkey exit, startup failure,
   helper crash and target exit. A clean exit must clear the toggle without
   the currently known false-timeout error. Keep useful errors accessible
   without adding a persistent idle indicator.
4. Register **Alt+Shift+A** as an application-wide toggle for BOTH entering and
   exiting fullscreen. It must work while the helper is stopped; the current
   helper-only exit registration cannot provide that. Route the button and
   shortcut through the same validated transition logic, prevent overlapping
   start/stop requests, handle shortcut conflicts, and update old Ctrl+Alt+F11
   text/registration and tests. Preserve a reliable escape/cleanup path.
5. Avoid two controls called Fullscreen: the existing **Full Screen** button
   currently selects an entire monitor. Keep that selection capability under
   an unambiguous name such as **Entire display**, distinct from the new toggle.
6. Verify the requested layout remains stable, the actual panel-button and
   global-hotkey activation paths both work, and peer sessions, frame visibility,
   input/display mapping and click-through remain intact.

### Selection capability clarification

The current bundled helper only scales a native window selected with **Pick
window**. fullscreen_start requires Selection.tracked_window; manually dragged
rectangles and whole-display selections do not have one and cannot start it.
The green frame is a pointer-sharing/mapping indicator, not a universal region
capture source. With a selected window, Magpie supplies the actual captured
source/client and displayed-image bounds; these need not equal the initial
outer-window frame, and the title bar is normally excluded.

The existing whole-display selection uses full monitor bounds, not the work
area. It does not automatically subtract the Windows taskbar or another dock.
A manually drawn rectangle can avoid a dock for pointer sharing, but it is not
currently a fullscreen capture source.

The user asked whether arbitrary green-frame areas already scale. They do NOT.
Treat arbitrary rectangle/display capture, cropping out taskbars/docks, input
mapping and capture-feedback avoidance as additional scope to clarify/design;
do not claim that functionality exists or silently implement it as part of this
small UI/shortcut task. Until support is added, explain/disable entering fullscreen
for unsupported selections while still permitting exit from an active session.

## Resumed desktop verification — November 12, 2026

Tested the rebuilt candidate through real Windows mouse/keyboard input:

- Before start: native foreground HWND was the Ghostlink panel (19928378),
  while the selected animated source was HWND 10685314. Clicking the actual
  Dev fullscreen button started real capture and changed foreground to the
  source. No -3 occurred. This covers the previously missed activation path.
- A fullscreen guest was visibly present with Frame off. Clicking its arrow
  reached the underlying source: the fixture's click count changed from 1 to 2.
- Actual Ctrl+Alt+F11 removed the scaling window and helper, restored clipping
  from source bounds to [0,0,1920,1200], and kept cursor visibility/speed intact.
- Forced termination of a capture-active helper removed the scaling window,
  restored clipping/visibility/speed, and retained the local guest session.
- Abruptly terminating the test Ghostlink app during capture also ended its
  helper; no fullscreen-host process remained.
- The isolated test processes were cleaned up. The user's installed app was
  not replaced or terminated.

**New remaining defect:** a clean hotkey exit can race the Rust watchdog's
pending status request. The helper exits correctly, but the panel can show
"Fullscreen helper did not respond within two seconds." Treat clean process
exit/EOF as idle in this race; retain failed status for actual nonzero crashes.
This reporting defect has NOT been fixed yet.

Explorer, Telegram, game-specific capture/focus behavior, detailed edge mapping,
Alt-Tab/camera behavior and two-PC testing remain pending. The user must run the
rebuilt candidate, not the old installed/dist copy, to retest the -3 report.
The candidate focus fix is validated on the ordinary panel-to-fixture path,
not yet confirmed individually on all three reported applications.

## Prior checkpoint state on November 12, 2026

Workspace: C:\Users\paava\.codex\worktrees\b4c0\ghostlink
Development branch: codex/tauri-windows-prototype
Remote: https://github.com/paavalipopov/ghostlink

This checkpoint preserves the earlier uncommitted Tauri migration, window
tracking, frame/overlay and test changes, plus the bundled fullscreen helper.
Do not revert to main or recreate the implementation from the earlier handoff.
The user's latest priority was to save a summary before further testing.

## Current blocker and candidate fix

The user reports that Explorer, Telegram and game windows all fail with:
"Fullscreen start rejected (code -3). Use an ordinary windowed app."

-3 is emitted by our wrapper before Magpie starts, when the selected source
does not immediately become the foreground window. It is not Magpie's
unsupported-window error. Earlier successful tests had explicitly focused the
source before invoking fullscreen; that missed the ordinary panel-button path.

A candidate fix has been implemented and compiled:

- src-tauri/src/fullscreen_windows.rs: after the helper replies ready, the
  Ghostlink parent grants foreground permission and requests source activation.
  The previous spawn-time-only permission grant was removed.
- native/fullscreen-host/host.cpp: allow up to 1000 ms, pumping messages, for
  cross-input-queue foreground activation to complete. Do not relax HWND/PID/
  thread checks, inject fake input, attach input queues, or disable Windows'
  foreground-lock policy.
- Rust now explains activation failure rather than recommending an ordinary
  window for every -3 rejection.

The candidate installer build succeeded. The real button-click regression test
was being prepared when the user requested this summary; it is NOT complete.
Do not claim the reported failure is fixed until that path passes.

## Implementation already present

Tauri 2, Rust, React/TypeScript and WebView2; Electron is retired.
Magpie v0.13.0 core source commit:
1a6f6c60cbd448b0e303e704f1225f0a4f3254ce
Annotated tag object: 33070cee2b47c6a8880f72bf7d8c446b1208bf46.

third_party/magpie contains the core and required support files, not a submodule.
native/fullscreen-host builds the helper. Rust uses inherited anonymous control
pipes, validates the selected native window, supervises helper lifetime and
recovers cursor state. The helper registers Ctrl+Alt+F11 before allowing
capture. It uses WGC/D3D11, bilinear fit, a 60 FPS ceiling and disabled direct
flip/pointer-speed adjustment. Captured frames remain local.

Keep source/input and destination/display mapping distinct. Preserve guest
overlay ordering, click-through and peer sessions. Minimize pauses sharing
without leaving the peer room. The existing Full Screen button still selects
a display; Dev fullscreen and Stop are temporary developer controls.

## Existing evidence and limits

Earlier: 21 TypeScript + 12 Rust tests passed. Real animated Win32 source
capture, minimize/restore, resize, stop, clipping/speed restoration, target
exit, malformed-request rejection and hotkey-conflict rejection passed.
An idle helper exited after abrupt parent death and released the hotkey.
Tauri/WebView2 tests passed for placement, frame stability, guest rendering,
session validation and saved frame preference. Installer payload extraction
and portable/extracted-app smoke tests passed for the previous build.

Earlier warm starts: approximately 0.35-0.57 seconds. RTX 5060 Laptop GPU,
1920x1200 at 125%: roughly 60 MiB working set, 82 MiB private memory, 32% of one
CPU core (~1.3% across 24 logical CPUs), 4-6% GPU 3D activity. These are short
desktop-fixture samples, not game latency/frame-pacing benchmarks.

The user authorized desktop input tests and explicitly asked to resume them.
Escape had been used to reach an app approval, not to cancel testing. The prior
turn's Computer Use stop state required a fresh turn. In the latest turn,
sky.list_windows/get_window_state worked again. Approve/control the test panel
while windowed, BEFORE starting fullscreen, so an approval prompt is not hidden.

## Immediate next work

1. Reproduce the ordinary path: pick source, then make Ghostlink's panel the
   foreground window and click its actual Dev fullscreen button. Do not pre-focus
   the source immediately before start. Confirm native foreground transitions,
   real presentation and source/display metadata.
2. If -3 persists, log/inspect parent foreground PID, SetForegroundWindow result,
   AllowSetForegroundWindow result, selected HWND/PID/thread and activation
   timing. Never treat a pre-focused-source test as coverage of the button path.
3. Test Explorer, Telegram and a windowed game; retain higher-integrity/protected
   capture limitations. Clearly distinguish activation failure from capture failure.
4. Verify the real exit chord, visible-guest click-through, four edges, Alt-Tab,
   minimize/restore and capture-active helper crash/parent death. Preserve peer
   membership. Two-PC/game behavior still needs the user's trial.
5. Refresh the installer, portable folder, checksums and corresponding-source
   archive after the final code changes. Update the results honestly.

## Build/test routes

Read docs/fullscreen-helper-handoff.md, docs/tauri-prototype.md,
docs/bundled-fullscreen-prototype.md and docs/security-review-0.8.1.md.

VS 2026 Build Tools v145 (MSVC 14.51.36231), SDK 10.0.26100.0, Node 22.23.4
and Rust 1.99.1 are installed. Conan 2.27.0 and NuGet 6.14.0 are in ignored
out/fullscreen-tools. Native dependency revisions are in
native/fullscreen-host/conan.lock; WIL/C++WinRT versions are pinned upstream.
Build helper: npm run fullscreen:build
Regressions: npm run test:all
Desktop suite: npm run test:tauri:desktop
Installer: npm run prototype:build -- -- --locked

Local builds use:
$env:CARGO_HOME = Join-Path (Get-Location) '.cargo-prototype'
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) 'out/tauri-fullscreen-target'
Do not overwrite/terminate the user's running installed copy to build.

Candidate installer:
out/tauri-fullscreen-target/x86_64-pc-windows-msvc/release/bundle/nsis/Ghostlink_0.8.0_x64-setup.exe

dist/fullscreen-prototype currently holds PREVIOUS-build artifacts, including
the old 3,796,715-byte installer and 97,341,660-byte source archive. These have
NOT yet been refreshed for the foreground fix. Do not distribute them as fixed.

Tests/native/fullscreen-fixture.vcxproj builds an animated real Win32 source.
scripts/check-fullscreen-desktop.mjs launches an isolated app/profile and fixture,
then writes out/fullscreen-tools/desktop-session.json with its loopback test port.
The POST routes /pick, /guests, /start, /state, /stop, /minimized, /restored,
/resized, /crash, /parentExit and /quit are test-only, not bundled.
For the regression use actual UI activation/click of the panel rather than /start
while the source is already focused. /state reports native foreground/helper
identity, rectangles and guest DOM placement. Never contact relays for fixture tests.

Logs: out/fullscreen-tools/focus-fix-build.log and focus-fix-tests.log.
Helper log: %LOCALAPPDATA%/app.ghostlink.tauri/fullscreen/logs/fullscreen-host.log.

## Scope and distribution

GPL-3.0-or-later; retain upstream/dependency notices and complete corresponding
source. scripts/package-fullscreen-source.py creates the matching source archive;
it includes application/core/helper and cached dependency source inputs, excluding
local configuration and user credentials. Regenerate it after changes.

Keep inexpensive Linux compatibility. No mixed-display-scaling test is required.
Security remediation remains a separate documented task. No release publishing,
version bumps, signing-key changes or fullscreen UI redesign. The user authorized
pushing a development checkpoint to this branch, not a release or merge to main.
