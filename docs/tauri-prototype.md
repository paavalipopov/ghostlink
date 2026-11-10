# Ghostlink Tauri prototype for Windows

This prototype traces your own pointer inside the shared area and includes a private test trackpad. It uses Tauri 2, Rust and WebView2 on Windows. The panel uses Ghostlink’s theme, buttons, and icons.

Open `src-tauri/target/x86_64-pc-windows-msvc/release/ghostlink-tauri-prototype.exe` to try the local build without installing. From the migration worktree, run `npm ci` once and `npm run prototype:dev` to run from source. `npm run prototype:build` creates the local Windows x64 installer under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. The prototype has its own app name and identifier. The installer uses the existing WebView2 Evergreen Runtime if available, or downloads Microsoft's bootstrapper if the runtime is missing; the offline runtime is not bundled.

1. Choose a display and click **Full Screen** to use the entire display, or **Drag frame** to draw a rectangle. Press Esc in the picker to keep the previous frame.
2. On Windows, click **Pick window** and point at another app before the three-second countdown ends. For a window that spans displays, Ghostlink uses the portion on the display under the pointer. If you move or resize the target window, pick it again.
3. Check that the arrow tip follows the pointer inside the frame and disappears outside. Move a separate app under the frame and click through the arrow. The app should receive the click. The panel reports the area in physical pixels. Click **Hide frame** to turn off the local preview.
4. Click **Test pointer** and move inside the trackpad to place the blue **Test user** pointer in the shared area. Click the trackpad to see it blink. Move the trackpad beside the area if it covers the marker. Close it or press Esc to return to tracing your real pointer in the same area.
5. On a two-display setup, give the displays different scales and repeat on both. Move the secondary display to the left of and above the primary to test negative X and Y. Restart the prototype after changing display settings so it refreshes the display list.

Run `cargo test --locked --manifest-path src-tauri/Cargo.toml` for the coordinate tests. They cover negative origins and edge inclusion, but cannot prove how Windows and WebView2 behave on a physical multi-display layout.

The area logic, React panel, and drag picker share the same code on Windows and Linux. Linux X11 has a fallback through Tauri for window placement and cursor position that still needs desktop testing. The panel disables desktop areas under Wayland and offers Pick window on Windows only.

## Migration notes

Electron 0.7.0 polls the cursor every 33 ms, calibrating Electron's cursor coordinates against a Win32 helper. It stores the play area in physical pixels, normalizes and quantizes movement for the peer, and captures click pings with `uiohook-napi`. Full Screen uses the selected monitor bounds. Drag frame maps a drag on the display screenshot or interactive overlay to the display rectangle. Pick window uses the native window bounds under the pointer. The desktop-wide Electron overlay projects incoming coordinates into the local play area, calibrates its CSS space against the desktop bounds, and ignores clicks except during interactive selection.

The platform layer reads the pointer in physical pixels. On Windows it also queries the window under the pointer and shows the overlay without activating it. The Rust sampler sends changed normalized positions to the overlay webview. The overlay checks its client bounds before showing and CSS percentages map each sample into its viewport. React reuses `CursorMark`, its blink animation, and the shared `Sample` shape. The trackpad sends movement and clicks through local Tauri commands. Peer connections, desktop click capture, and updates are later migration steps.
