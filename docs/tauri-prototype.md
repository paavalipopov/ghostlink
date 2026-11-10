# Ghostlink Tauri prototype for Windows

This prototype traces your own pointer inside a rectangle covering the center 60% of the selected display. It uses Tauri 2, Rust and the system WebView2 runtime. It does not connect to peers or change the installed Ghostlink 0.7.0 app.

Open `src-tauri/target/x86_64-pc-windows-msvc/release/ghostlink-tauri-prototype.exe` to try the local build without installing. From the migration worktree, run `npm ci` once and `npm run prototype:dev` to run from source. `npm run prototype:build` creates the local Windows x64 installer under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. The prototype has its own app name and identifier. The installer uses the existing WebView2 Evergreen Runtime if available, or downloads Microsoft's bootstrapper if the runtime is missing; the offline runtime is not bundled.

1. Choose a display and click **Show center rectangle**. The panel reports the physical origin and dimensions of the selected rectangle. The crosshair marks the sampled position; the arrow and label are offset so you can see the real pointer.
2. Move the pointer inside the orange frame, then leave it through each edge. The crosshair should follow the pointer inside and disappear outside. Move a separate app under the frame and click a button or text field where the crosshair is visible. The app should receive the click and the overlay should stay above it.
3. On a two-display setup, give the displays different scale settings (for example 100% and 150%). Arrange the secondary display to the left of the primary so its X origin is negative. Run step 2 on both displays, selecting each one in turn. Repeat with the secondary display above the primary (negative Y). Restart the prototype after changing Windows display settings, then compare the crosshair and the real pointer near each corner and near the center of each selected rectangle.

Run `cargo test --locked --manifest-path src-tauri/Cargo.toml` for the coordinate tests. They cover negative origins and edge inclusion, but cannot prove how Windows and WebView2 behave on a physical multi-display layout.

## Local results

The release executable passed a Windows desktop smoke test on one 1920 × 1200 display at 125% scaling. The selected area was `(384, 240) · 1152 × 720 px`. A separate test window remained visible through the overlay and received a real mouse click through the crosshair. The overlay stayed on top without taking focus, the marker reached two physical points and disappeared on exit, and hiding and showing the overlay again worked. The Electron reference built and opened its control panel, and its 15 coordinate tests passed.

The unsigned Tauri x64 NSIS installer was 1,973,622 bytes (1.88 MiB). The shipped Electron 0.7.0 installer was 112,040,359 bytes (106.85 MiB). This compares the prototype to the full Electron app. WebView2 was already installed on the test machine. The runtime download path and a physical mixed-scale layout with negative display origins remain untested.

## Migration notes

Electron 0.7.0 polls the cursor every 33 ms, calibrating Electron's cursor coordinates against a Win32 helper. It stores the play area in physical pixels, normalizes and quantizes movement for the peer, and captures click pings with `uiohook-napi`. Full Screen uses the selected monitor bounds. Drag frame maps a drag on the display screenshot or interactive overlay to the display rectangle. Pick window uses the native window bounds under the pointer. The desktop-wide Electron overlay projects incoming coordinates into the local play area, calibrates its CSS space against the desktop bounds, and ignores clicks except during interactive selection.

The prototype reads `GetPhysicalCursorPos` through `src-tauri/src/platform/`. It samples only while an area is selected, and sends changed normalized positions to the overlay webview. The native overlay window covers only the selected rectangle and checks its client bounds before showing it. CSS percentages map the sample into that viewport, so the renderer never needs a desktop-wide scaling factor or a conversion from signed desktop origins. React reuses `CursorMark`, its styling, and the shared `Sample` shape. The existing peer protocol, Trystero `move` and `ping` actions, Electron area pickers, private trackpad, and updates stay in the reference app for this prototype.
