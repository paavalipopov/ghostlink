Continue Ghostlink's bundled Magpie fullscreen prototype on Windows.

Workspace: C:\Users\paava\.codex\worktrees\b4c0\ghostlink
Branch: codex/tauri-windows-prototype
Remote: https://github.com/paavalipopov/ghostlink

Inspect current Git status and preserve any subsequent local changes. First read
docs/fullscreen-development-continuation.md, especially its latest user-requested
UI/shortcut tasks and resumed desktop verification. Then read
docs/bundled-fullscreen-prototype.md, docs/fullscreen-helper-handoff.md,
docs/tauri-prototype.md and docs/security-review-0.8.1.md.

Implement the newly requested controls:

- Rename Shared display to Shared area.
- One Fullscreen on/off toggle immediately left of that heading, styled like the
  existing Frame on/off button. Keep Frame on the right. Remove Dev fullscreen,
  Stop and the idle indicator.
- Alt+Shift+A must globally toggle BOTH entering and exiting, including when the
  helper is not running. Synchronize UI state with actual helper/session state,
  handle conflicts and lifecycle failures, and retain safe cleanup.
- Rename the existing Full Screen display-selection action to an unambiguous
  selection label such as Entire display, so it is not a second fullscreen toggle.

Current capture capability is WINDOW ONLY via Pick window. Dragged regions and
whole-display selections currently control pointer sharing, not fullscreen capture.
Full-monitor selection includes the taskbar area. Do not claim arbitrary green-frame
capture or automatic dock exclusion is implemented. Region/display capture is
additional scope to clarify before implementing.

The foreground -3 candidate fix passed the actual panel-button-to-source path on
a real animated Win32 fixture. Visible-guest click-through, Ctrl+Alt+F11 exit and
capture-active crash/owner-exit checks passed. A remaining watchdog race falsely
reports timeout after clean hotkey exit; fix it while synchronizing the new toggle.
Explorer, Telegram, game-specific behavior, edge alignment, Alt-Tab and two-PC
trials still need coverage. Do not pre-focus the source to validate panel activation.

Stack: Tauri 2/Rust/React/TypeScript/WebView2. Pinned Magpie core is under
third_party/magpie, C++ wrapper under native/fullscreen-host. Electron is retired.
Own builds and meaningful local tests. Refresh the unpublished installer, portable
files, checksums and GPL corresponding source after verified changes; current
dist artifacts are stale. Preserve source/display mapping, guest overlays,
click-through, frame-toggle stability and peer sessions. Keep inexpensive Linux
compatibility. Desktop tests are authorized; obtain per-app tool approval while
windowed before entering fullscreen. Mixed physical display scaling is skipped.

Security remediation stays separate. No version bump, signing-key changes,
release publication or merge to main. The specified UI/shortcut task is now
authorized despite the earlier general UI-redesign deferral. Stop at a working
local prototype and report verified results and remaining manual checks.
