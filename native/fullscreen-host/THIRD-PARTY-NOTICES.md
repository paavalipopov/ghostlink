# Ghostlink bundled fullscreen host

Ghostlink and this wrapper: Copyright 2026 Ghostlink contributors.
GPL-3.0-or-later. See the installed LICENSE and Magpie-GPL-3.0.txt.
Magpie v0.13.0: Copyright Blinue and Magpie contributors; GPL-3.0-or-later.
Source commit 1a6f6c60cbd448b0e303e704f1225f0a4f3254ce.
The source snapshot preserves upstream copyright notices and effect attribution.

Build dependencies are pinned in conan.lock and Magpie.Core/packages.config:
fmt 12.1.0 (MIT), spdlog 1.17.0 (MIT), parallel-hashmap 2.0.0 (Apache-2.0,
with upstream notices), RapidJSON cci.20230929 (MIT and upstream notices),
kuba-zip 0.3.2 (Unlicense and upstream notices), muparser 2.3.5 (BSD-2-Clause),
yas 7.1.0 (Boost Software License 1.0), imgui 1.91.8 (MIT and bundled stb
notices), rapidhash 1.0 (BSD-2-Clause).
Microsoft.Windows.CppWinRT 3.0.260818.1 and
Microsoft.Windows.ImplementationLibrary 1.0.260126.7: MIT.
Individual license files accompany this notice. Conan/CMake/NuGet and the
Windows SDK/MSVC toolchain are build tools; they are not redistributed as
runtime applications. The helper uses the Windows Universal CRT and DirectX.

Bilinear.hlsl, Bicubic.hlsl and StubDefs.hlsli come from the pinned source.
Bicubic attribution: ActualMandM/cemu_graphic_packs commit
468d165cf27dae13a06e8bdc3d588d0af775ad91, Filters/Bicubic/output.glsl,
as retained in its source header.

This installer is an unpublished local prototype. Before conveying binaries,
provide the exact complete corresponding source archive alongside the binary,
including modified Ghostlink/Magpie/wrapper sources, dependency sources and
build instructions. A link to upstream's latest branch is insufficient.
No separate Magpie installation is needed.
