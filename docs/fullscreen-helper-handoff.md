# Bundled fullscreen helper: next task

## Scope

Build a local, unpublished Magpie-based fullscreen helper for Ghostlink. The current stack is Tauri 2, Rust, React/TypeScript, and WebView2 on Windows. Keep inexpensive Linux compatibility in shared code and isolate Windows-specific code. Electron no longer needs to remain runnable or receive reference testing; preserve shared UI and peer code when removing obsolete Electron-only pieces.

Implementation and local build/trial results are now recorded in
[bundled-fullscreen-prototype.md](bundled-fullscreen-prototype.md). The final
coordinated hotkey/click-through/game pass remains open.

## Starting point

Continue in `C:\Users\paava\.codex\worktrees\b4c0\ghostlink`, branch `codex/tauri-windows-prototype`. Inspect Git status first and preserve the substantial uncommitted application/test changes. The documentation is saved on `main`, but those application changes are not yet merged. Do not start from a fresh checkout, reset, or clean this worktree. Exclude local `.codex/` configuration, credentials, and build artifacts from commits.

Read [current behavior and testing notes](tauri-prototype.md) and the [deferred security review](security-review-0.8.1.md). The authentication and resource-budget findings remain unfixed; they are a separate task.

## Architecture

- Pin a verified source commit from [Magpie v0.13.0](https://github.com/Blinue/Magpie/tree/v0.13.0) under `third_party/magpie/`, including the core and required support files, licenses, and provenance.
- Add our C++ wrapper under `native/fullscreen-host/`. Compile it with the engine into a helper executable, launched and controlled by Rust and bundled with the installer. Users must not need a separate Magpie installation or settings app.
- Start with a working core, then trim unnecessary UI/effects/dependencies incrementally. Inspect the pinned `ScalingRuntime` start/stop API and build guide rather than assuming an existing external window-start command.
- Provide validated local start/stop/status control for the selected HWND and a reliable exit hotkey. Keep captured frames local. Do not add peer secrets, networking, or remote input injection to the helper.
- Clean up cursor/focus/clipping changes on stop, failure, target exit, and app exit. Handle minimize/restore and Alt-Tab without unnecessarily disconnecting peers.

The user chose GPL-3.0-or-later. Preserve upstream/dependency notices and document modifications, build inputs, and complete matching-source packaging.

## Preserve behavior and UI

External Magpie fullscreen already passed a user two-PC game trial. Preserve the separation between source/input bounds and destination/display bounds, guest-overlay ordering, click-through, pointer alignment, and selection tracking through resize and scaling changes. Minimized targets pause local pointer sharing while connections remain active.

Keep the frame toggle stable and show guests/test pointers only. The fullscreen UI redesign remains deferred: the existing Full Screen button selects an entire display. Do not silently repurpose it. A minimal developer control is sufficient for this first helper prototype.

This milestone presents a windowed source fullscreen; native exclusive-fullscreen rendering hooks are outside scope. Fullscreen-Overlay-Clock does not supply such a backend; do not introduce its Python/PyQt runtime.

## Build and verify

Own local prerequisite setup. Verify the pinned Magpie build requirements against installed Windows tooling; ask only for genuine approval/manual prerequisites. Use the Tauri CLI for runnable builds.

Inspect and run the relevant `test:all` and `test:tauri:desktop` scripts. Test real helper start/stop, crash/exit cleanup, minimize/restore, focus changes, guest visibility, click-through, and edge mapping where the desktop allows. Synthetic metadata fixtures do not prove game compatibility. Coordinate manual mouse use with the user. Mixed physical display scaling was explicitly skipped because the hardware is unavailable.

Build an unpublished local installer and report added size/runtime requirements and practical performance. Previous installer size was about 3.08 MiB. Stop with a working prototype, exact local trial instructions, and remaining game/two-PC checks. Do not publish, push application changes, bump versions, or alter signing keys for this milestone.
