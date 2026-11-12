# Magpie source snapshot

Upstream: https://github.com/Blinue/Magpie
Tag: v0.13.0 (annotated tag object 33070cee2b47c6a8880f72bf7d8c446b1208bf46).
Pinned source commit: 1a6f6c60cbd448b0e303e704f1225f0a4f3254ce.
Retrieved November 12, 2026. This directory is a vendored source snapshot,
not a submodule. LICENSE and upstream copyright/dependency notices are retained.

Ghostlink modifications (November 12, 2026):

- src/Magpie.Core/Magpie.Core.vcxproj defines MP_GHOSTLINK_HOST.
- src/Magpie.Core/Renderer.cpp skips upstream toolbar/font initialization and
  the screenshot keyboard hook under that macro; overlayOptions is maybe_unused.
  Guest pointers remain in Ghostlink's separate click-through WebView2 overlay.
- src/Magpie.Core/FrameSourceBase.cpp avoids changing source-window corner preferences
  under MP_GHOSTLINK_HOST, including on helper crashes.
- This provenance file. Other upstream sources are unchanged.

Build only Magpie.Core with native/fullscreen-host/fullscreen-host.vcxproj.
The upstream settings app, updater and touch helper are not compiled or bundled.
The snapshot retains the core, Shared, build properties/profiles, docs and required
Bilinear/Bicubic/StubDefs effects. The settings app (except its dependency manifest),
updater, touch helper, unused effects/tools/images and upstream signing material
are omitted. Generated obj/, packages/ and .git metadata are excluded from vendoring.

See docs/bundled-fullscreen-prototype.md and native/fullscreen-host/conan.lock
for build inputs, modifications, matching-source packaging and local trial notes.
