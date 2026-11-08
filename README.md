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

## Build

On Windows, from this folder:

```
npm install
npm run build:win
```

That writes `dist/Ghostlink-x.x.x-windows-setup.exe`. Run the installer, then open Ghostlink. Installed builds check GitHub Releases for updates after launch; when an update is ready, use **Restart and update** in the control panel.

`npm run dev` runs Ghostlink from source.

## Release

Set the version in `package.json`, commit the change, and push a matching tag such as `v0.7.0`. The Windows release workflow runs the tests and production build, creates the NSIS installer and update metadata, uploads them to a draft GitHub Release, then publishes the release after every artifact is present.

The installer remains unsigned until the `CSC_LINK` and `CSC_KEY_PASSWORD` GitHub Actions secrets are configured, so Windows may show a SmartScreen warning. Code-signing credentials must never be included in the application or repository.
