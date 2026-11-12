"""Package the exact local prototype sources, including native dependencies.
SPDX-License-Identifier: GPL-3.0-or-later
"""
import hashlib
import json
import os
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist/fullscreen-prototype"
OUT.mkdir(parents=True, exist_ok=True)
ARCHIVE = OUT / "ghostlink-fullscreen-corresponding-source.zip"
SKIP = {".git", ".codex", ".aws", "__pycache__", ".cache", ".bin"}
BINARY = {".exe", ".dll", ".pdb", ".node", ".lib", ".obj", ".pch"}
seen = set()
manifest = {}

with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    def add(path, name):
        if not path.is_file() or name in seen or any(part in SKIP for part in Path(name).parts):
            return
        if not name.startswith("dependencies/") and (path.suffix.lower() in {".pfx", ".key", ".pem"} or path.name == ".npmrc" or path.name.startswith(".env")):
            return
        data = path.read_bytes()
        z.writestr(name, data)
        seen.add(name)
        manifest[name] = hashlib.sha256(data).hexdigest()
        if len(seen) % 10000 == 0:
            print(f"Packaged {len(seen)} source files", flush=True)

    def tree(folder, name, binary=False):
        if not folder.is_dir():
            return
        for base, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d not in SKIP and not (Path(base).name == "electron" and d == "dist")]
            for filename in files:
                path = Path(base) / filename
                if binary and path.suffix.lower() in BINARY:
                    continue
                add(path, str(Path(name) / path.relative_to(folder)).replace("\\", "/"))

    # Explicit application allowlist: never include app preferences, local config,
    # signing credentials, ignored investigations, binaries or unrelated worktrees.
    for folder in ["src", "scripts", "tests", "docs", "native", "build"]:
        tree(ROOT / folder, "ghostlink/" + folder, binary=True)
    for path in (ROOT / "src-tauri").iterdir():
        if path.is_file():
            add(path, "ghostlink/src-tauri/" + path.name)
    tree(ROOT / "src-tauri/src", "ghostlink/src-tauri/src")
    tree(ROOT / "src-tauri/capabilities", "ghostlink/src-tauri/capabilities")
    for path in ROOT.iterdir():
        if path.is_file() and (path.suffix in {".json", ".ts", ".mts", ".mjs", ".md", ".yaml", ".yml"}
                               or path.name in {"LICENSE", ".gitignore", ".gitattributes", ".editorconfig"}):
            add(path, "ghostlink/" + path.name)
    vendor = ROOT / "third_party/magpie"
    for base, dirs, files in os.walk(vendor):
        dirs[:] = [d for d in dirs if d not in SKIP | {"obj", "packages", "certs"}]
        for filename in files:
            path = Path(base) / filename
            add(path, "ghostlink/third_party/magpie/" + path.relative_to(vendor).as_posix())

    # Preferred source + recipe/patches for every pinned native dependency.
    cache = ROOT / "out/conan/p"
    for package in cache.iterdir():
        if not package.is_dir() or package.name in {"b"} or package.name.startswith("cmake"):
            continue
        for part in ["e", "es", "s", "p/include", "p/licenses", "p/res"]:
            tree(package / part, "dependencies/conan/" + package.name + "/" + part, binary=True)
    for package in (vendor / "packages").iterdir():
        if package.is_dir():
            tree(package, "dependencies/nuget/" + package.name, binary=True)

    # Cargo's vendored sources can rebuild without consulting a moving registry.
    cargo_home = Path(os.environ.get("CARGO_HOME", str(Path.home() / ".cargo")))
    registry = cargo_home / "registry/src"
    if not registry.is_dir():
        raise RuntimeError("Set CARGO_HOME to the populated cache used for this build.")
    crates = 0
    for index in registry.iterdir():
        for crate in index.iterdir():
            if crate.is_dir():
                tree(crate, "dependencies/cargo/" + crate.name)
                crates += 1
    if not crates:
        raise RuntimeError("The matching Rust crate sources are missing.")
    # The checked-in lockfile identifies npm inputs. Include the local package
    # sources (including build tooling), but not Electron/native executables.
    tree(ROOT / "node_modules", "dependencies/npm", binary=True)
    z.writestr("SOURCE-MANIFEST.json", json.dumps(manifest, indent=2, sort_keys=True))
    z.writestr("BUILDING.txt", """This is an unpublished local Ghostlink prototype.
Read ghostlink/docs/bundled-fullscreen-prototype.md first.
All modified application/core/helper source files are included.
dependencies/conan contains native source trees and Conan recipes/patches;
dependencies/nuget contains pinned C++/WinRT/WIL build inputs;
dependencies/cargo contains cached Rust crate sources;
dependencies/npm contains the installed npm package source/build inputs.
Windows SDK, MSVC, WebView2 and OS components are system prerequisites.
To rebuild, extract ghostlink/, use the pinned lockfiles, then:
npm ci
npm run fullscreen:build
npm run prototype:build -- -- --locked
Do not publish without reviewing the archive's notices and final source match.
""")
print(json.dumps({"archive": str(ARCHIVE), "bytes": ARCHIVE.stat().st_size,
                  "files": len(seen), "rust_crates": crates}, indent=2))
