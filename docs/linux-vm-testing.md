# Linux VM testing status

Assessed November 15, 2026 on `codex/tauri-windows-prototype`.

Ghostlink has a partial Linux/X11 implementation. The shared panel, geometry,
overlay and peer-protocol code are present, but a native Linux build and VM
desktop trial have not been completed. Full peer sharing also depends on
WebRTC support in the Linux webview, which is a significant unresolved gate.

## Current feature coverage

| Feature                                                | Linux status in the current source                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Panel, preferences, pointer shapes and click animation | Shared React implementation; Linux rendering unverified                                       |
| Entire display / Drag frame                            | Shared implementation, enabled for X11; desktop behavior unverified                           |
| Global pointer position                                | Portable Tauri cursor API used on X11; mapping needs a VM trial                               |
| Transparent, click-through guest overlay               | Shared window configuration and Tauri cursor-ignore API; compositor/focus behavior unverified |
| Local test trackpad                                    | Shared implementation; can exercise overlay movement without another peer                     |
| Remote peer movement / click messages                  | Shared Trystero/WebRTC code; requires working Linux RTC data channels                         |
| Sending desktop click pings                            | Windows-only native hook; Linux reports a warning while movement sharing can continue         |
| Pick window / window tracking                          | Windows-only; Linux UI disables picking                                                       |
| Bundled fullscreen / Alt+Shift+A / exit reminder       | Windows-only Magpie helper; not a Linux capture backend                                       |
| Wayland desktop areas                                  | Deliberately disabled; global cursor/placement support is incomplete                          |
| Linux package / CI / desktop automation                | No verified Linux artifact or Linux-specific desktop suite                                    |

The Windows-specific Rust and native dependencies are isolated behind platform
conditions. `prepare-fullscreen.mjs` skips the C++ helper on Linux, and the
Windows-only Tauri configuration contains the helper resources. A Linux build
does not need Magpie, MSVC or WebView2; Tauri uses WebKitGTK there.

## WebRTC must be checked first

The panel currently calls Trystero's browser-based room API, which needs
`RTCPeerConnection` and RTC data channels. Sharing the TypeScript protocol does
not establish that the Linux runtime can transport its messages.

Upstream [WebKitGTK 2.54 disables WebRTC](https://www.webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html#multimedia-improvements)
while replacing its backend; earlier versions required experimental build
features. Check the actual distribution package and the running Ghostlink
webview. Require both a usable `RTCPeerConnection` constructor and a successful
local data-channel exchange before scheduling two-VM peer trials. If unavailable,
a supported runtime or native RTC transport/bridge is additional implementation
work. An older insecure runtime is not an appropriate workaround.

## First VM target and build route

Use a full Ubuntu 24.04 VM with an **X11/Xorg desktop** and a working compositor
for the initial local UI/overlay tests. Check `XDG_SESSION_TYPE=x11`; the app also
rejects desktop areas when `WAYLAND_DISPLAY` is present. WSLg's rootless Wayland
environment is not proof of ordinary X11 desktop/overlay behavior.

Install native Linux Node 22 and Rust, then the
[Tauri Linux development dependencies](https://v2.tauri.app/start/prerequisites/#linux):

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Build in a fresh Linux checkout; do not reuse Windows `node_modules` or Cargo
build outputs:

```sh
git clone --branch codex/tauri-windows-prototype https://github.com/paavalipopov/ghostlink.git
cd ghostlink
npm ci --ignore-scripts
npm run prototype:dev
```

`--ignore-scripts` avoids the retired Electron postinstall/native-dependency
setup. The Tauri frontend preparation still runs through the explicit prototype
command and skips the Windows helper on Linux.

For an unbundled native executable or a candidate Debian package:

```sh
npm exec -- tauri build --no-bundle -- --locked
npm exec -- tauri build --bundles deb -- --locked
```

These are the intended native-host routes, not validated build results. The
existing `prototype:build` script explicitly selects Windows x64 and NSIS, so use
the commands above on Linux. The existing `test:tauri:desktop` script is also
Windows/WebView2-specific. See [Tauri's Debian packaging guidance](https://v2.tauri.app/distribute/debian/)
for runtime packages and minimum distribution compatibility.

## VM checks and remaining work

1. Build and run the panel; check layout with the VM's fonts and scaling.
2. Select a display and drag a frame. Check overlay transparency, placement,
   click-through and focus with Frame on and off.
3. Use the local test trackpad to check both pointer styles, click animation and
   corner alignment. Keep pointer selection/display bounds separate.
4. Check RTC support and a local data-channel exchange, then peer movement and
   click messages between two VMs or Linux/Windows. Record firewall/NAT behavior.
5. Verify reconnect, saved preferences, app shutdown and overlay cleanup.
6. Add Linux build/packaging CI and a WebKitGTK desktop test route after bring-up.
   Native window picking, desktop click hooks, Wayland integration and fullscreen
   capture each need separate Linux implementation work if required.

The inspected Ubuntu-24.04 WSL instance was running x86_64 with Wayland exposed.
The inspected login shell had no native Rust, Node or pkg-config executable on
its PATH, and GTK/WebKit versions could not be checked. It found only Windows
npm. No Linux build, install or VM desktop trial was performed during this
assessment.

The existing [security remediation](security-review-0.8.1.md) remains a separate
release prerequisite on both operating systems.
