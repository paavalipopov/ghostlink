# Bundled fullscreen helper: local prototype

This is an unpublished Windows prototype on `codex/tauri-windows-prototype`.
The existing uncommitted Tauri/UI/protocol work is retained. Versions and signing
keys are unchanged. Security remediation remains the separate task described in
[security-review-0.8.1.md](security-review-0.8.1.md).

## Implementation

- Magpie v0.13.0 is pinned to source commit
  `1a6f6c60cbd448b0e303e704f1225f0a4f3254ce` under `third_party/magpie`.
  The annotated tag object is `33070cee2b47c6a8880f72bf7d8c446b1208bf46`.
  The snapshot retains the core, shared code, build properties, dependency
  profiles, documentation and three required effect/include files. Unused
  settings UI, updater, touch helper, other effects, upstream signing material,
  screenshots/tools and nested Git metadata are omitted.
- `native/fullscreen-host` links the C++ static core into an isolated helper.
  It uses Windows.Graphics.Capture and Direct3D 11, bilinear aspect-ratio fit on
  the source window's nearest monitor, and a 60 FPS ceiling. Frames stay local.
  The helper has no sockets, peer secrets or remote-input protocol.
- Rust starts the helper from the bundled resource directory, never a PATH
  lookup or user-supplied executable. Anonymous inherited pipes accept bounded
  start/stop/status requests; there is no named or network control endpoint.
  Only the panel can request start/stop/status. Start takes the already selected
  window from native state. Both processes verify HWND/PID/thread identity,
  visible ordinary top-level source bounds and dimensions.
- Ctrl+Alt+F11 is registered before capture is allowed. A conflict fails closed.
  Stop ends that helper process; a later start creates a new session.
- Native state changes, target exit and control-pipe EOF unwind the renderer.
  A parent-process handle and independent guardian cover Ghostlink exit, including
  a stuck render-thread shutdown. Rust monitors helper exit and bounds shutdown
  waits, then restores cursor visibility/confinement after crashes/timeouts.
  Magpie pointer-speed adjustment is disabled. The fork avoids changing the
  source's corner preference, so a hard helper failure cannot leave that change.
- The existing Magpie source/destination window properties remain unchanged.
  Rust continues sampling input in source bounds and drawing guests in display
  bounds. The ordinary frame toggle and click-through overlay are retained.
  Minimize pauses mapping and pointer sharing while retaining the peer session.
  Selecting another area stops an owned helper. Selection is checked again
  across asynchronous startup to avoid scaling a stale target.
- The existing **Full Screen** button still chooses a display. The separate
  **Dev fullscreen** / **Stop** controls are temporary. Linux skips the native
  build/resources and keeps the existing shared UI/protocol/platform fallback.

## Build inputs

Verified locally: VS 2026 Build Tools, MSVC 14.51.36231 (v145), Windows SDK
10.0.26100.0, MSBuild 18.10.1, Node 22.23.4, Rust 1.99.1. Conan 2.27.0 and
NuGet 6.14.0 are installed in the ignored `out/fullscreen-tools` directory.
Conan works with the installed Python 3.11 for this core-only build; upstream's
full-application publish guide asks for Python 3.14 and UWP workloads.
Ghostlink does not run that publish pipeline or compile the WinUI settings app.

The nine native dependencies and recipe revisions are in
`native/fullscreen-host/conan.lock`. C++/WinRT 3.0.260818.1 and WIL
1.0.260126.7 are pinned in the upstream core's `packages.config`.
The build script restores missing tools/dependencies in local caches. It does
not install or use a separate Magpie application.

```powershell
npm ci
npm run fullscreen:build
npm run test:all
npm run test:tauri:desktop
npm run prototype:build -- -- --locked
```

Tauri's frontend preparation builds/stages the helper automatically on Windows.
To force dependency restore, run
`./scripts/build-fullscreen-host.ps1 -Restore`.
If the usual release executable is running, set `CARGO_TARGET_DIR` to a separate
directory before the Tauri build. This local run used
`out/tauri-fullscreen-target` and left the user's original instance untouched.

Runtime requirements: Windows 10 1903+ or Windows 11, DirectX feature level 11,
and WebView2 Evergreen. The installer reuses WebView2 or downloads its bootstrapper.
The helper uses the OS Universal CRT; a separate Magpie/WinUI/Python installation
and separate VC++ redistributable are not required.

## Local trial

The installer is 3,796,715 bytes (3.62 MiB), compared with the prior local
3,224,606-byte installer (3.08 MiB): an increase of 572,109 bytes (0.55 MiB).
The helper is 1,460,224 bytes (1.39 MiB). Its imports were inspected: no WinUI,
Magpie installation or separate VC++ redistributable is needed.

The deliverables are under `dist/fullscreen-prototype`. The version remains
0.8.0. This installer has the ordinary Ghostlink identity and is not an update
release; do not run it over a live session. The portable trial folder includes
the app executable and its matching `fullscreen` resources.

1. Close other scaling tools. Start the executable from the portable trial folder.
2. Put a game or ordinary app in windowed mode. Use **Pick window** and point at
   it during the countdown.
3. Click **Dev fullscreen**. Use **Frame off** if you only want guest pointers.
4. Exit with **Ctrl+Alt+F11**, or Alt-Tab to the panel and click **Stop**.
   The original **Full Screen** button still selects a whole display.
5. Keep a two-PC peer connected while repeating minimize/restore and Alt-Tab.
   Verify all four image edges, clicks under guests, mouse capture/camera behavior
   and re-entering fullscreen. Protected capture/native exclusive fullscreen are
   outside this prototype.

The helper log is in the app's local-data directory:
`%LOCALAPPDATA%/app.ghostlink.tauri/fullscreen/logs/fullscreen-host.log`.

## Verification and performance

- `test:all`: 21 TypeScript and 12 Rust tests passed.
- `test:tauri:desktop`: real Tauri/WebView2 placement, stable frame toggle,
  guest rendering, stale-session rejection, invalid pointer rejection and saved
  frame preference passed using an isolated WebView profile.
- Real animated Win32 source through the compiled core: malformed requests,
  invalid HWNDs, stale PID identity and a conflicting exit hotkey were rejected.
  Real D3D/WGC fullscreen, minimize/restore, resize, stop, cursor clip/speed
  restoration and target-close cleanup passed.
- An idle-helper process-ownership check passed after abrupt owner death:
  the helper exited and released its exit-hotkey reservation. Capture-active
  crash/parent-death recovery remains part of the coordinated desktop pass.
- Through the real Tauri app: picking, local guest injection without relay
  traffic, helper start, live source/display mapping and Stop passed. The guest
  remained in the WebView DOM with Frame off; native output was 1622 x 1200 at
  x=149, matching the overlay's physical bounds within 0.5 pixel. After Stop,
  the same guest session remained and mapping returned to the source.
- Warm starts measured about 0.35–0.57 seconds. A short sample on an RTX 5060
  Laptop GPU, 1920 x 1200 at 125% display scaling, used about 60 MiB working set,
  82 MiB private memory, 32% of one CPU core (about 1.3% across 24 logical CPUs),
  and 4.3–6.4% of the GPU's 3D engine. Copy-engine samples were 0.01–0.02%.
  These are a small animated desktop-source workload, not game benchmarks.
  End-to-end latency and frame pacing have not been instrumented.
- Actual exit-chord, click-through under a visible fullscreen guest, detailed
  four-edge guest alignment, Alt-Tab/camera behavior, capture-active helper crash
  and abrupt parent-exit cleanup still need the final coordinated desktop pass.
  The desktop tool remained latched stopped after Escape was used to reach its
  app approval; the user explicitly requested resuming these checks.
- The installer was extracted without installing it. The helper, three effect
  inputs, GPL text and all native dependency notices are present; its helper
  SHA-256 matches the staged build. An installed-copy trial
  remains manual to avoid replacing the user's running Ghostlink installation.
  Two-PC game trials remain manual. Mixed physical display scaling is skipped.

The native check driver is `scripts/check-fullscreen-native.mjs`; its fixture
is `tests/native/fullscreen-fixture.vcxproj`. Focus the fixture before the start
request when Windows denies background foreground transfer.
`scripts/check-fullscreen-desktop.mjs` is a test-only loopback driver for an
isolated WebView and animated source; it is not bundled with the app.

## License and corresponding source

Ghostlink and the helper use GPL-3.0-or-later. Installed resources include the
GPL text, Magpie provenance and individual native dependency notices/licenses.
The modified core sources are present, not a pointer to upstream's current branch.
See `third_party/magpie/GHOSTLINK-PROVENANCE.md` for exact modifications.

`python scripts/package-fullscreen-source.py` packages the current application,
modified core, wrapper, build scripts, lockfiles, and cached native/Rust/npm
source inputs. Set `CARGO_HOME` to the populated cache used by the build.
The archive has a per-file SHA-256 manifest and excludes Git/local configuration,
credentials, signing keys and build executables. Package it again after any
further source changes, and provide the exact matching archive with binaries
before any distribution. No release assets were uploaded or published.
