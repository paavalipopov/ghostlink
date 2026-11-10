# Ghostlink

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

## Test your pointer

Click the bug button to open a private test trackpad. Move or click inside it to control a colored **Test user** pointer in your selected shared area. Close the window to end the test.

Indicators blink while connecting, turn green when connected, and turn red if the check fails. **Relays** checks the handshake servers; **Test peer** checks the connection to your main panel. This local test does not check another computer's network.

`npm run test:link` runs the Electron reference check with two local peers and real signaling servers. It verifies movement and clicks in a selected area and checks that closing the test preserves the area and normal connection state. It needs a Windows desktop and internet access.

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
