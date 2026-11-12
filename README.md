# Ghostlink

> Development snapshot, November 12, 2026: the notes below include unmerged local Tauri changes on `codex/tauri-windows-prototype`. Saving these documents on `main` does not merge the application changes or change the published 0.8.0 release. Some commands and features described below require that local worktree. See the [fullscreen helper handoff](docs/fullscreen-helper-handoff.md) and [pending security work](docs/security-review-0.8.1.md).

<img src="docs/logo.png" alt="Ghostlink" width="96">

Ghostlink shows the other person's pointer on your screen when you both use the same secret. When they click, that pointer blinks, then returns to its color. Your own pointer stays where you put it.

![Ghostlink control panel](docs/panel.png)

## Connect

1. Choose a username and a secret (or generate them with the dice), then share the secret with the other person.
2. Both people click **Connect**. Ghostlink looks for the other person for one minute.
3. When connected, the indicator turns green and the button says Connected.

Secrets need at least 6 characters, not counting spaces or hyphens. The dice generates a 20-character secret in five groups of four. Both people must enter the same secret, including its internal spaces and hyphens.

## Setting the shared area

Your friend's pointer appears inside the selected rectangle on your screen. Your pointer is shared only while it is inside your own rectangle.

- Click **Full Screen** to use the whole display.
- Click **Drag frame**, then drag a rectangle.
- Click **Pick window**, move the pointer over a window, and wait through the countdown. The rectangle becomes that window.

Pick window follows the selected window as it moves or resizes. The **Frame on/off** pill beside **Shared display** hides the green border while keeping guest pointers and sharing active. Ghostlink remembers this setting.

On Windows, an experimental Magpie integration follows the original game for mouse input and Magpie's displayed image for guest pointers. Select the game before or after starting Magpie scaling. Changing between Magpie's windowed and fullscreen scaling should update the mapping automatically; see [testing notes](docs/tauri-prototype.md#magpie-scaling).

## Test your pointer

Click the bug button to open a private test trackpad. Move or click inside it to control a colored **Test user** pointer in your selected shared area. Close the window to end the test.

Indicators blink while connecting, turn green when connected, and turn red if the check fails. **Relays** checks the handshake servers; **Test peer** checks the connection to your main panel. This local test does not check another computer's network.

`npm run test:electron:link` runs the Electron reference check with two local peers and real signaling servers. It verifies movement and clicks in a selected area and checks that closing the test preserves the area and normal connection state. It needs a Windows desktop and internet access. `test:link` remains an alias for this reference check.

## Automated checks

- `npm test` typechecks the tests and runs the shared TypeScript helpers plus Tauri panel-bridge tests with mocked IPC. Electron helper-parser checks are labeled as reference coverage.
- `npm run test:rust` checks Rust coordinates, source/display selection state, test-pad validation, and Windows native window metadata. The Magpie metadata fixtures are synthetic; these are not real-game or mixed-display-scaling tests.
- `npm run test:all` runs both of those suites.
- `npm run test:tauri:desktop` builds the current Tauri executable and tests real WebView2 placement, fixed frame-button layout, frame visibility, native guest IPC filtering, and saved frame preference. It opens isolated test windows, uses synthetic guest data, and closes only its own process tree. It does not move the desktop mouse or contact signaling servers. It requires a Windows desktop and WebView2.

Real Magpie fullscreen rendering, click-through to a game, two-PC networking, camera-lock behavior, and physical mixed-DPI layouts require desktop trials. One-off scripts under ignored `dist/` are historical diagnostics, not part of the repeatable test suite. See [the current Magpie findings](docs/tauri-prototype.md#magpie-scaling).

## Build

On Windows, from this folder:

```
npm ci
npm run prototype:build
```

The Windows x64 installer is in `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Run the installer, then open Ghostlink. Release builds check GitHub Releases after launch. Click the update icon to check, download, install, and restart in one step. Local builds made with the command above have updates disabled.

If you used Ghostlink 0.7 or earlier, remove the Electron version through Windows Installed apps, then install 0.8 manually and enter your preferences again. The Tauri installer uses a separate app identity.

`npm run prototype:dev` runs Tauri from source. `npm run dev` opens the Electron reference app.

## Release

Set the Tauri version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and refresh `src-tauri/Cargo.lock`. The release workflow builds a draft from a matching tag such as `v0.8.0`. Review the installer and publish the draft as the latest release when it is ready. See the [Windows and updater setup](docs/tauri-prototype.md#signed-updates) for signing keys and release assets.

## License

Copyright (C) 2026 Ghostlink contributors.

Ghostlink is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed without any warranty, including the implied warranties of merchantability or fitness for a particular purpose. See [LICENSE](LICENSE) for the complete terms.

Third-party components retain their own copyright notices and licenses. Magpie source has not yet been included in this repository; the current integration cooperates with a separately running Magpie installation.
