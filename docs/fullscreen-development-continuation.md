# Fullscreen development continuation

## State on November 12, 2026

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
