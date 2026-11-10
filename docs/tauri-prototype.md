# Ghostlink for Windows

Ghostlink 0.8 uses Tauri 2, Rust and WebView2 on Windows. It shares its control panel with the Electron reference app. The overlay shows guest pointers and the private test pointer.

Open `src-tauri/target/x86_64-pc-windows-msvc/release/ghostlink-tauri-prototype.exe` to try the local build without installing. Run `npm ci` once and `npm run prototype:dev` to run from source. `npm run prototype:build` creates the local Windows x64 installer under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Tauri uses a separate app identifier from Electron. The installer uses the existing WebView2 Evergreen Runtime if available, or downloads Microsoft's bootstrapper if the runtime is missing.

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

Release builds check for availability after launch. Click the update icon once to check again, download, verify, install, and restart. The Windows installer runs quietly during an update. A local build without a feed keeps the update icon dimmed.

Generate a persistent updater key with `npm exec -- tauri signer generate -w <private-key-path>`. Keep a backup of the private key and password outside the checkout. Set these GitHub Actions values before running the Release workflow.

- Repository variable `TAURI_UPDATER_PUBLIC_KEY` holds the contents of the generated public key file.
- Repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` hold the private key file contents and password. Keep the same signing key for later updates to this release channel.
- To Authenticode-sign the Windows installer and executable, configure the signing provider on the runner and set the repository variable `TAURI_WINDOWS_SIGN_COMMAND` to its Tauri signing command. The command must include Tauri's `%1` file placeholder and timestamp the signature. The release script verifies both signatures and timestamps when the command is supplied.

The workflow uploads the NSIS installer, its Tauri `.sig`, and `latest.json` to a draft GitHub Release. `latest.json` contains the version, the versioned installer URL, and the updater signature. The app reads the stable `releases/latest/download/latest.json` URL from the same public repository. Publish the draft as the latest release after reviewing all three assets. Publish future releases the same way so installed copies can find them.

To build the same assets locally from the repo root, set the same environment variables and run `./scripts/build-tauri-release.ps1 -Repository paavalipopov/ghostlink -Tag v0.8.0` in PowerShell 7. The script writes the release assets under `dist/release`. Build-time Authenticode signing runs before Tauri generates the updater signature.
