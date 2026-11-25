# 0.9.2

- Test Trackpad, Frame Picker and the window-pick marker now release their WebViews when closed.
- Disconnect closes the old room. New connections verify the current secret, and private test runs use a separate room.
- Connection and message limits bound incoming pointer traffic.
- Update signing runs separately from the build and uses the existing verification key.
- Both peers must update to 0.9.2 to connect.
- The fullscreen helper builds from a checked-in copy of the verified kuba-zip source.

# 0.9.0

- Bundled Magpie-based Windows fullscreen with Alt+Shift+A, safe exit and lifecycle cleanup.
- Translucent fullscreen exit reminder with brief transparency pulses and reduced-motion support.
- Compact shared-area panel with matching toggles and clearer display selection.
- Sharper arrow/ghost pointers, restored-window eligibility and fullscreen transition fixes.
- Matching GPL source package accompanies the installer.
- Existing authentication and resource-budget findings remain unresolved; see the security review.

# 0.8.0

- Windows app rebuilt with Tauri, Rust, and WebView2.
- One-click signed updates for Tauri installations.
- First Tauri release requires a manual install for Electron users.

# 0.7.0

- Windows installer with folder selection, GitHub information links, and in-app updates.
- Private test trackpad with relay and peer connection indicators.
- Smaller Windows package.
- Six-character minimum for custom secrets.
- Fixed cursor calibration on monitors left of or above the primary display.
