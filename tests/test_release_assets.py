"""Regression checks for the release gate, artifact digest and signed updater feed."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from urllib.error import HTTPError
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_assets", ROOT / "scripts/release-assets.py")
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)
REPO = "owner/ghostlink"
VERSION = "1.2.3"
SHA = "a" * 40
MINISIGN = os.environ.get("GHOSTLINK_MINISIGN") or shutil.which("minisign")
TAURI = ROOT / "node_modules/@tauri-apps/cli/tauri.js"


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.event = {"workflow_run": {"path": ".github/workflows/release.yml",
            "head_repository": {"full_name": REPO}, "conclusion": "success", "event": "push",
            "head_branch": "v" + VERSION, "head_sha": SHA}}
        self.ref = {"type": "tag", "sha": "b" * 40}
        self.commit = {"type": "commit", "sha": SHA}
        self.ancestry = "ahead"
        self.released = False

    def lookup(self, repo, path):
        self.assertEqual(repo, REPO)
        if path.startswith("git/ref/"):
            return {"object": self.ref}
        if path.startswith("git/tags/"):
            return {"object": self.commit}
        if path.startswith("compare/"):
            return {"status": self.ancestry}
        if path.startswith("contents/"):
            conf = json.dumps({"version": VERSION}).encode()
            return {"content": base64.b64encode(conf).decode()}
        if path.startswith("releases/tags/") and self.released:
            return {"draft": False}
        raise HTTPError(path, 404, "not found", {}, None)

    def guard(self):
        return assets.guard(self.event, REPO, self.lookup)

    def test_tag_binding_and_existing_release(self):
        self.assertEqual(self.guard(), VERSION)
        self.ref = self.commit
        self.assertEqual(self.guard(), VERSION)
        self.ancestry = "diverged"
        with self.assertRaisesRegex(ValueError, "on main"):
            self.guard()
        self.ancestry = "identical"
        self.commit["sha"] = "c" * 40
        with self.assertRaisesRegex(ValueError, "Tag moved"):
            self.guard()
        self.commit["sha"] = SHA
        self.released = True
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.guard()

    def test_declines_other_build_origins_and_versions(self):
        for field, value in [("head_branch", "main"), ("event", "pull_request"),
                             ("head_repository", {"full_name": "fork/ghostlink"}),
                             ("path", ".github/workflows/other.yml"), ("conclusion", "failure"),
                             ("head_branch", "v1.2.4"), ("head_branch", "v01.2.3")]:
            with self.subTest(field=field, value=value):
                run = self.event["workflow_run"]
                original, run[field] = run[field], value
                with self.assertRaises(ValueError):
                    self.guard()
                run[field] = original

    def test_digest_and_exact_archive_member(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            archive, dest = folder / "upload.zip", folder / "installer.exe"
            with ZipFile(archive, "w") as f:
                f.writestr(dest.name, b"test asset")
            real_digest = "sha256:" + assets.digest(archive)
            with self.assertRaisesRegex(ValueError, "digest"):
                assets.unpack(archive, "sha256:" + "0" * 64, dest, 1000)
            with self.assertRaisesRegex(ValueError, "size"):
                assets.unpack(archive, real_digest, dest, 1)
            assets.unpack(archive, real_digest, dest, 1000)
            self.assertEqual(dest.read_bytes(), b"test asset")
            with ZipFile(archive, "a") as f:
                f.writestr("extra", b"unrelated")
            with self.assertRaisesRegex(ValueError, "Unexpected files"):
                assets.unpack(archive, "sha256:" + assets.digest(archive), dest, 1000)

    def test_artifact_pinned_to_successful_attempt(self):
        item = {"id": 5, "name": "installer-2", "expired": False, "workflow_run": {"id": 12},
                "size_in_bytes": 222, "digest": "sha256:" + "b" * 64}
        def lookup(repo, path):
            self.assertEqual(path, "actions/runs/12/artifacts?name=installer-2")
            return {"total_count": 1, "artifacts": [item]}
        def select():
            return assets.artifact_ref(REPO, 12, "installer-2", 1024, lookup)
        self.assertEqual(select(), {"id": 5, "digest": item["digest"]})
        for key, value in [("expired", True), ("workflow_run", {"id": 11}), ("name", "installer-1"), ("digest", None)]:
            original, item[key] = item[key], value
            with self.assertRaises(ValueError):
                select()
            item[key] = original

    @unittest.skipUnless(MINISIGN and TAURI.exists(), "requires minisign and the installed Tauri CLI")
    def test_disposable_signature_feed_and_changed_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            key = folder / "disposable.key"
            env = {k: v for k, v in os.environ.items() if not k.startswith("TAURI_SIGNING_")}
            def signer(*args):
                subprocess.run(["node", str(TAURI), "signer", *args], cwd=folder, env=env,
                               check=True, stdout=subprocess.DEVNULL)
            signer("generate", "--ci", "-p", "fixture-only", "-w", str(key))
            pub = Path(str(key) + ".pub").read_text().strip()
            env.update(TAURI_SIGNING_PRIVATE_KEY_PATH=str(key), TAURI_SIGNING_PRIVATE_KEY_PASSWORD="fixture-only")
            name = f"Ghostlink_{VERSION}_x64-setup.exe"
            installer = folder / name
            if os.environ.get("GHOSTLINK_TEST_INSTALLER"):
                shutil.copyfile(os.environ["GHOSTLINK_TEST_INSTALLER"], installer)
            else:
                installer.write_bytes(b"unsigned test asset")
            def finish():
                assets.finish(folder, VERSION, SHA, REPO, pub, MINISIGN)
            with ZipFile(folder / f"Ghostlink_{VERSION}_source.zip", "w") as z:
                z.writestr("BUILD-METADATA.json", json.dumps({"version": VERSION, "commit": SHA}))
                z.writestr("RELEASE-CONFIG.json", json.dumps({"plugins": {"updater": {"pubkey": pub,
                    "endpoints": [f"https://github.com/{REPO}/releases/latest/download/latest.json"]}}}))
            signer("sign", "--app-version", "1.2.2", str(installer))
            with self.assertRaisesRegex(ValueError, "different version"):
                finish()
            signer("sign", "--app-version", VERSION, str(installer))
            finish()
            feed = json.loads((folder / "latest.json").read_text())
            self.assertEqual(feed["version"], VERSION)
            self.assertEqual(feed["platforms"]["windows-x86_64"], {
                "url": f"https://github.com/{REPO}/releases/download/v{VERSION}/{name}",
                "signature": (folder / (name + ".sig")).read_text().strip()})
            lines = (folder / "SHA256SUMS.txt").read_text().splitlines()
            self.assertEqual(len(lines), 4)
            for line in lines:
                digest, filename = line.split("  ")
                self.assertEqual(digest, assets.digest(folder / filename))
            with installer.open("ab") as f:
                f.write(b"changed")
            with self.assertRaises(subprocess.CalledProcessError):
                finish()


if __name__ == "__main__":
    unittest.main()
