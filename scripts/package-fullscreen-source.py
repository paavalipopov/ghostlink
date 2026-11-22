"""Package the exact local prototype sources, including native dependencies.
SPDX-License-Identifier: GPL-3.0-or-later
"""
import argparse
import hashlib
import json
import os
import subprocess
import tomllib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=ROOT / "dist/fullscreen-prototype/ghostlink-fullscreen-corresponding-source.zip")
parser.add_argument("--reuse-dependencies-from", type=Path, help="Reuse a verified source ZIP only when dependency inputs still match.")
parser.add_argument("--release-config", type=Path, default=ROOT / "dist/release/tauri.release.json",
                    help="Tauri configuration containing the public update key and endpoint.")
args = parser.parse_args()
ARCHIVE = args.output.resolve()
if args.reuse_dependencies_from and args.reuse_dependencies_from.resolve() == ARCHIVE:
    raise RuntimeError("The dependency archive and output must be different files.")
ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
version = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["version"]
SKIP = {".git", ".codex", ".aws", "__pycache__", ".cache", ".bin"}
BINARY = {".exe", ".dll", ".pdb", ".node", ".lib", ".obj", ".pch"}
seen = set()
manifest = {}

def dependency_input(name, data):
    if name == "package.json":
        package = json.loads(data)
        return {key: package.get(key) for key in ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides", "engines"]}
    if name == "package-lock.json":
        package = json.loads(data)
        package.pop("version", None)
        package.get("packages", {}).get("", {}).pop("version", None)
        return package
    if name == "src-tauri/Cargo.lock":
        package = tomllib.loads(data.decode())
        for crate in package["package"]:
            if crate["name"] == "ghostlink-tauri-prototype":
                crate.pop("version", None)
        return package
    return data


def reuse_dependencies(z, previous_path):
    if previous_path.resolve() == ARCHIVE:
        raise RuntimeError("The dependency archive and output must be different files.")
    with zipfile.ZipFile(previous_path) as previous:
        for name in ["package.json", "package-lock.json", "src-tauri/Cargo.lock", "native/fullscreen-host/conan.lock", "third_party/magpie/GHOSTLINK-PROVENANCE.md", "third_party/magpie/src/Magpie.Core/packages.config", "third_party/magpie/src/_ConanDeps/host-msvc.profile", "third_party/magpie/src/_ConanDeps/build.profile"]:
            if dependency_input(name, previous.read("ghostlink/" + name)) != dependency_input(name, (ROOT / name).read_bytes()):
                raise RuntimeError(f"Dependency input changed: {name}; package fresh sources instead.")
        previous_manifest = json.loads(previous.read("SOURCE-MANIFEST.json"))
        for info in previous.infolist():
            if not info.filename.startswith("dependencies/"):
                continue
            data = previous.read(info)
            digest = hashlib.sha256(data).hexdigest()
            if digest != previous_manifest[info.filename]:
                raise RuntimeError(f"Dependency source checksum mismatch: {info.filename}")
            z.writestr(info, data)
            seen.add(info.filename)
            manifest[info.filename] = digest
    return len({name.split("/")[2] for name in manifest if name.startswith("dependencies/cargo/")})


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
    for folder in ["src", "scripts", "tests", "docs", "native", "build", ".github/workflows"]:
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

    if args.reuse_dependencies_from:
        crates = reuse_dependencies(z, args.reuse_dependencies_from)
    else:
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
    release_config = args.release_config
    if release_config.is_file():
        updater = json.loads(release_config.read_text(encoding="utf-8-sig"))["plugins"]["updater"]
        z.writestr("RELEASE-CONFIG.json", json.dumps({
            "bundle": {"createUpdaterArtifacts": False},
            "plugins": {"updater": {key: updater[key] for key in ["pubkey", "endpoints"]}},
        }, indent=2))
    z.writestr("BUILDING.txt", f"Ghostlink {version} complete corresponding source.\n" + """
Read ghostlink/docs/bundled-fullscreen-prototype.md first.
All modified application/core/helper source files are included.
dependencies/conan contains native source trees and Conan recipes/patches;
dependencies/nuget contains pinned C++/WinRT/WIL build inputs;
dependencies/cargo contains cached Rust crate sources;
dependencies/npm contains the installed npm package source/build inputs.
Windows SDK, MSVC, WebView2 and OS components are system prerequisites.
To rebuild, extract ghostlink/, use the pinned lockfiles, then:
npm ci --ignore-scripts
npm run fullscreen:build
npm run prototype:build -- -- --locked
Release binaries are accompanied by this archive and third-party notices.
If RELEASE-CONFIG.json is present, pass --config ../RELEASE-CONFIG.json to
the Tauri build to reproduce its public updater configuration without signing.
Private signing keys are deliberately excluded; signing is not required to
build and run the corresponding software.
""")
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    z.writestr("BUILD-METADATA.json", json.dumps({"version": version, "commit": commit}, indent=2))
print(json.dumps({"archive": str(ARCHIVE), "bytes": ARCHIVE.stat().st_size,
                  "files": len(seen), "rust_crates": crates}, indent=2))
