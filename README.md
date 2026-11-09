# Ghostlink

<img src="docs/logo.png" alt="Ghostlink" width="96">

Ghostlink shows the other person's pointer on your screen when you both use the same secret. When they click, that pointer blinks, then returns to its color. Your own pointer stays where you put it.

![Ghostlink control panel](docs/panel.png)

## Connect

1. Choose a username and a secret (or pick random with dice), share the secret with the other person.
2. Click **Connect** and app will try to etablish connection with the other person for a minute.
3. When the other person is there, the indicator turns green and the button says Connected.

Secrets need at least 6 characters, not counting spaces or hyphens. The dice still generates a 20-character secret in five groups of four. Both people must enter the same secret, including its internal spaces and hyphens.

## Setting the shared area

Other people pointer's appears only inside the rectangle on your screen. This rectangle is also the only place that shares your pointer; if you move your mouse outside that frame, the other person can't see it.

- Click **Full Screen** to use the whole display.
- Click **Drag frame**, then drag a rectangle.
- Click **Pick window**, move the pointer over a window, and wait through the countdown. The rectangle becomes that window.

## Test your pointer

The bug button opens a compact private test trackpad automatically; no username, secret, or Connect click is needed. Move or click in its test surface to control a colored **Test user** pointer in your selected shared area. The trackpad does not draw additional pointers inside its window. Closing the test window ends the test without changing your selected area or normal connection.

The test window uses the same indicators as the main panel: blinking while connecting, green when connected, and red if the check fails. **Relays** reports reachable signaling-server sockets; **Test peer** reports the actual WebRTC connection to the main panel. This local test does not prove a connection through another computer's firewall.

`npm run test:link` builds and checks the two local peers through real signaling servers, verifies movement/clicks in a selected area, and checks that closing the test preserves the area and normal connection state. It needs a Windows desktop and internet access.

## Build

On Windows, from this folder:

```
npm install
npm run build:win
```

That writes `dist/Ghostlink-x.x.x-windows-setup.exe`. Run the installer, then open Ghostlink. Installed builds check GitHub Releases for updates after launch; when an update is ready, use **Restart and update** in the control panel.

The installer lets you choose the installation folder. New installations default to all users under Program Files (administrator permission required); you can also choose a current-user installation. Upgrades remember the existing installation and folder. App information is linked on the welcome and finish pages. `Uninstall Ghostlink.exe` is included in the chosen installation folder, and Ghostlink also appears in Windows Installed apps. Uninstalling preserves your saved settings.

`npm run dev` runs Ghostlink from source.

## Release

Set the version in `package.json`, commit the change, and push a matching tag such as `v0.7.0`. The Windows release workflow runs the tests and production build, creates the NSIS installer and update metadata, uploads them to a draft GitHub Release, then publishes the release after every artifact is present.

The installer remains unsigned until the `CSC_LINK` and `CSC_KEY_PASSWORD` GitHub Actions secrets are configured, so Windows may show a SmartScreen warning. Code-signing credentials must never be included in the application or repository.
