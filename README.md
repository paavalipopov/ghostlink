# Ghostlink

Ghostlink 0.9 runs on Windows x64 with Tauri, Rust and WebView2. Its fullscreen helper is bundled; a separate Magpie installation is not needed. Download the installer from [GitHub Releases](https://github.com/paavalipopov/ghostlink/releases/latest).

Known authentication and resource-limit findings remain unresolved. Read the [security review](docs/security-review-0.8.1.md); fully exit and reopen the app before generating a replacement secret to revoke an earlier participant.

<img src="docs/logo.png" alt="Ghostlink" width="96">

Ghostlink shows the other person's pointer on your screen when you both use the same secret. When they click, that pointer blinks, then returns to its color. Your own pointer stays where you put it.

## Connect

1. Choose a username and a secret (or generate them with the dice), then share the secret with the other person.
2. Both people click **Connect**. Ghostlink looks for the other person for one minute.
3. When connected, the indicator turns green and the button says Connected.

Secrets need at least 6 characters, not counting spaces or hyphens. The dice generates a 20-character secret in five groups of four. Both people must enter the same secret, including its internal spaces and hyphens.

## Setting the shared area

Your friend's pointer appears inside the selected rectangle on your screen. Your pointer is shared only while it is inside your own rectangle.

- Click **Entire display** to use the whole display.
- Click **Drag frame**, then drag a rectangle.
- Click **Pick window**, move the pointer over a window, and wait through the countdown. The rectangle becomes that window.

Pick window follows the selected window as it moves or resizes. The **Frame on/off** pill beside **Shared area** hides the green border while keeping guest pointers and sharing active. Ghostlink remembers this setting.

On Windows, pick an ordinary windowed app, then click **Fullscreen** or press **Alt+Shift+A** to enter and exit fullscreen. **Ctrl+Alt+F11** also exits while capture is running. A translucent reminder appears in the upper-right. Source mouse coordinates and displayed guest pointers follow the scaled image. Dragged frames and entire-display selections are pointer-sharing areas, not fullscreen capture sources. Native exclusive-fullscreen hooks are outside this feature.

## Test your pointer

Click the bug button to open a private test trackpad. Move or click inside it to control a colored **Test user** pointer in your selected shared area. Close the window to end the test.

Indicators blink while connecting, turn green when connected, and turn red if the check fails. **Relays** checks the handshake servers; **Test peer** checks the connection to your main panel. This local test does not check another computer's network.

## Automated checks

- `npm test` typechecks the tests and runs the shared TypeScript helpers plus Tauri panel-bridge tests with mocked IPC. Some historical parser tests remain as reference coverage.
- `npm run test:rust` checks Rust coordinates, source/display selection state, test-pad validation, and Windows native window metadata. The Magpie metadata fixtures are synthetic; these are not real-game or mixed-display-scaling tests.
- `npm run test:all` runs both of those suites.
- `npm run test:tauri:desktop` builds the current Tauri executable and tests real WebView2 placement, fixed frame-button layout, frame visibility, native guest IPC filtering, and saved frame preference. It opens isolated test windows, uses synthetic guest data, and closes only its own process tree. It does not move the desktop mouse or contact signaling servers. It requires a Windows desktop and WebView2.

Real Magpie fullscreen rendering, click-through to a game, two-PC networking, camera-lock behavior, and physical mixed-DPI layouts require desktop trials. One-off scripts under ignored `dist/` are historical diagnostics, not part of the repeatable test suite. See [the current Magpie findings](docs/tauri-prototype.md#magpie-scaling).

## Build

For the current Linux/X11 coverage, WebRTC limitation and intended VM build
commands, see [Linux VM testing status](docs/linux-vm-testing.md).

On Windows, from this folder:

```
npm ci --ignore-scripts
npm run prototype:build
```

The Windows x64 installer is in `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Run the installer, then open Ghostlink. Release builds check GitHub Releases after launch. Click the update icon to check, download, install, and restart in one step. Local builds made with the command above have updates disabled.

If you used Ghostlink 0.7 or earlier, remove the Electron version through Windows Installed apps, then install 0.9 manually and enter your preferences again. The Tauri installer uses a separate app identity.

`npm run prototype:dev` runs Tauri from source. Electron is retired.

## Release

Keep package metadata, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and their lockfiles at the same version. Add version-specific notes under `docs/releases/`. The release workflow builds a draft from a matching tag such as `v0.9.0`, including the installer, updater signature/feed, matching source archive and checksums. Verify those assets before publishing the draft as the latest release. See the [Windows and updater setup](docs/tauri-prototype.md#signed-updates) for signing keys and release assets.

## License

Copyright (C) 2026 Ghostlink contributors.

Ghostlink is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed without any warranty, including the implied warranties of merchantability or fitness for a particular purpose. See [LICENSE](LICENSE) for the complete terms.

Third-party components retain their own copyright notices and licenses. The pinned Magpie core is under `third_party/magpie`; the C++ helper is under `native/fullscreen-host`. Each binary release includes notices and a matching complete corresponding source archive.
