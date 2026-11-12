Continue Ghostlink's bundled Magpie fullscreen prototype on Windows.

Use C:\Users\paava\.codex\worktrees\b4c0\ghostlink, branch
codex/tauri-windows-prototype. Fetch the latest branch and inspect status before
editing; preserve any subsequent local changes. First read:

- docs/fullscreen-development-continuation.md (current state and exact next steps)
- docs/bundled-fullscreen-prototype.md
- docs/fullscreen-helper-handoff.md
- docs/tauri-prototype.md
- docs/security-review-0.8.1.md

The bundled helper and earlier Tauri/UI changes are in the checkpoint. Do not
restart from main or reimplement the prototype.

The user's blocker: Explorer, Telegram and game windows all returned code -3.
This comes from our foreground activation check before Magpie capture. A candidate
fix moves activation to the Ghostlink parent after helper readiness and waits
up to one second for Windows to complete it. It builds, but the actual panel-
button regression test is NOT finished. Previous successful tests had already
focused the source and did not cover the failure.

First test selecting a source, returning focus to Ghostlink's panel and clicking
the actual Dev fullscreen button. Confirm this works without pre-focusing the
source. If it fails, diagnose foreground permission/activation timing; do not
disable Windows focus protections or inject fake input as a workaround.

Then verify Ctrl+Alt+F11, visible guest click-through, edge mapping, Alt-Tab,
minimize/restore and capture-active helper crash/parent-exit cleanup. Preserve
source/display mapping and peer sessions. The user authorized desktop input
tests; obtain any per-app tool approval while windowed, before entering fullscreen.

Own builds and meaningful local tests. Refresh the unpublished installer,
portable files, checksums and GPL corresponding source after verified changes.
Old dist/fullscreen-prototype artifacts predate the candidate focus fix.

Stack: Tauri 2/Rust/React/TypeScript/WebView2. Magpie source is pinned under
third_party/magpie, wrapper under native/fullscreen-host. Electron is retired.
Keep inexpensive Linux compatibility. Mixed physical display scaling is skipped.
Security remediation and fullscreen UI redesign remain separate. No version bump,
signing-key changes, release publication or merge to main. Stop at a working local
prototype and report verified results and remaining two-PC/game checks.
