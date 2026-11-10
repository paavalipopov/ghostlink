# Ghostlink Tauri prototype for Windows

This prototype uses Tauri 2, Rust and WebView2 on Windows. It shares Ghostlink’s control panel with the Electron app. The overlay shows guest pointers and the private test pointer.

Open `src-tauri/target/x86_64-pc-windows-msvc/release/ghostlink-tauri-prototype.exe` to try the local build without installing. From the migration worktree, run `npm ci` once and `npm run prototype:dev` to run from source. `npm run prototype:build` creates the local Windows x64 installer under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. The prototype has its own app name and identifier. The installer uses the existing WebView2 Evergreen Runtime if available, or downloads Microsoft's bootstrapper if the runtime is missing; the offline runtime is not bundled.

1. Ghostlink starts with the primary display or your last saved area. Click **Full Screen** to use the whole display, or **Drag frame** to draw a rectangle. Press Esc in the picker to keep the previous frame.
2. On Windows, click **Pick window** and point at another app before the countdown ends. An asterisk follows your pointer while the picker is active. For a window that spans displays, Ghostlink uses the portion on the display under the pointer. If you move or resize the target window, pick it again.
3. After connecting, your guest’s arrow disappears when they leave their shared area. Click through a guest arrow to interact with the app underneath.
4. Click the bug button to open the private trackpad. Move inside the pad to place the blue **Test user** pointer in the shared area. Click the trackpad to see it blink. **Relays** checks signaling reachability, and **Test peer** checks a separate WebRTC connection to the main panel using a fresh random secret. The pointer preview works locally while these checks run. Close the trackpad or press Esc to end the test.
5. On a two-display setup, give the displays different scales and repeat on both. Move the secondary display to the left of and above the primary to test negative X and Y. Restart the prototype after changing display settings so it refreshes the display list.

To connect to a friend, select your shared area first, then enter a username and the same secret in both apps. Click **Connect** in both. Movement maps between your two areas, and a left click inside your area on Windows makes your arrow blink for the other person. Opening the private trackpad pauses sending your desktop pointer until you close it. Signaling uses the same public relays as the Electron app.

Run `cargo test --locked --manifest-path src-tauri/Cargo.toml` for the coordinate tests. They cover negative origins and edge inclusion, but cannot prove how Windows and WebView2 behave on a physical multi-display layout.

The area logic, React panel, and drag picker share the same code on Windows and Linux. Linux X11 has a fallback through Tauri for window placement and cursor position that still needs desktop testing. The panel disables desktop areas under Wayland and offers Pick window on Windows only.

## Migration notes

Electron 0.7.0 polls the cursor every 33 ms, calibrating Electron's cursor coordinates against a Win32 helper. It stores the play area in physical pixels, normalizes and quantizes movement for the peer, and captures click pings with `uiohook-napi`. Full Screen uses the selected monitor bounds. Drag frame maps a drag on the display screenshot or interactive overlay to the display rectangle. Pick window uses the native window bounds under the pointer. The desktop-wide Electron overlay projects incoming coordinates into the local play area, calibrates its CSS space against the desktop bounds, and ignores clicks except during interactive selection.

The platform layer reads the pointer in physical pixels. On Windows it also captures left clicks during a sharing session, queries the window under the pointer, and shows the overlay without activating it. The overlay checks its client bounds before showing and maps normalized positions into its viewport. React reuses `CursorMark`, its blink animation, and Electron’s Trystero room and message code. The private trackpad sends movement and clicks through local Tauri commands. Sending desktop click pings is currently Windows-only.

## Signed updates

Builds configured for updates check automatically after launch. Use the update icon to check again or to restart and install once the download is ready. The app verifies the package signature and the version covered by that signature before enabling installation.

For a release build, generate and store a Tauri signing key outside the checkout. Pass the private key path and password to the build through `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The client receives only the public key. Keep the same signing key for later updates to that release channel.

Use `npm run prototype:build -- --config path/to/release.json` with a release configuration like this, replacing the example URL and public key with the values for your release channel.

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "REPLACE_WITH_TAURI_PUBLIC_KEY",
      "endpoints": ["https://updates.example.com/ghostlink/latest.json"],
      "requireSignedVersion": true
    }
  }
}
```

Host the generated NSIS installer and serve a manifest with the new version, installer URL, and contents of the matching `.sig` file. Keep `version` equal to the version used to build and sign the installer. For a Windows x64 feed, the manifest can use this shape.

```json
{
  "version": "0.6.1",
  "platforms": {
    "windows-x86_64": {
      "url": "https://updates.example.com/ghostlink/0.6.1/setup.exe",
      "signature": "REPLACE_WITH_CONTENTS_OF_SETUP_EXE_SIG"
    }
  }
}
```

The default prototype build has no release feed. The Tauri updater is separate from the Electron updater and its existing release workflow.
