"""Validate release provenance and assemble updater assets on a clean runner."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zipfile import ZipFile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def version_of(tag):
    require(re.fullmatch(r"v(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){2}", tag or ""),
            "Expected a stable vMAJOR.MINOR.PATCH tag")
    return tag[1:]


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def api(repo, path):
    req = Request(f"https://api.github.com/repos/{repo}/{path}",
                  headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                           "Accept": "application/vnd.github+json"})
    with urlopen(req, timeout=30) as response:
        return json.load(response)


def guard(event, repo, lookup=api):
    run = event["workflow_run"]
    require(run["path"] == ".github/workflows/release.yml" and
            run["head_repository"]["full_name"] == repo and run["conclusion"] == "success" and
            run["event"] in {"push", "workflow_dispatch"}, "Unexpected build origin")
    tag, sha = run["head_branch"], run["head_sha"]
    version = version_of(tag)
    require(re.fullmatch("[0-9a-f]{40}", sha), "Invalid commit")
    # Resolve the tag explicitly, including annotated tags, before testing ancestry.
    ref = lookup(repo, "git/ref/tags/" + tag)["object"]
    while ref["type"] == "tag":
        ref = lookup(repo, "git/tags/" + ref["sha"])["object"]
    require(ref["type"] == "commit" and ref["sha"] == sha, "Tag moved since the build")
    require(lookup(repo, f"compare/{sha}...main")["status"] in {"ahead", "identical"},
            "Release commit must be on main")
    conf = lookup(repo, f"contents/src-tauri/tauri.conf.json?ref={sha}")
    require(json.loads(base64.b64decode(conf["content"]))["version"] == version,
            "Tag and application version differ")
    try:
        lookup(repo, "releases/tags/" + tag)
    except HTTPError as err:
        if err.code != 404:
            raise
    else:
        raise ValueError("A release already exists for this tag")
    return version


def unpack(archive, expected_digest, destination, max_size):
    require(expected_digest == "sha256:" + digest(archive), "Artifact digest mismatch")
    with ZipFile(archive) as bundle:
        require(bundle.namelist() == [destination.name], "Unexpected files in build artifact")
        entry = bundle.getinfo(destination.name)
        require(0 < entry.file_size <= max_size, "Invalid asset size")
        with bundle.open(entry) as src, destination.open("xb") as dst:
            shutil.copyfileobj(src, dst)


def artifact_ref(repo, run_id, artifact_name, max_size, lookup=api):
    result = lookup(repo, f"actions/runs/{run_id}/artifacts?name={artifact_name}")
    require(result["total_count"] == 1, "Expected one immutable artifact for this run attempt")
    item, = result["artifacts"]
    require(item["name"] == artifact_name and not item["expired"] and
            item["workflow_run"]["id"] == run_id and 0 < item["size_in_bytes"] <= max_size + 65536 and
            re.fullmatch("sha256:[a-f0-9]{64}", item["digest"] or ""),
            "Invalid artifact origin, lifetime or size")
    return {"id": int(item["id"]), "digest": item["digest"]}


def fetch(repo, item, destination, max_size):
    with tempfile.TemporaryDirectory() as temp:
        archive = Path(temp, "artifact.zip")
        with archive.open("wb") as output:
            subprocess.run(["gh", "api", f"repos/{repo}/actions/artifacts/{int(item['id'])}/zip"],
                           stdout=output, check=True)
        unpack(archive, item["digest"], destination, max_size)


def finish(folder, version, sha, repo, public_key, minisign="minisign"):
    name = f"Ghostlink_{version}_x64-setup.exe"
    installer, sig = folder / name, folder / (name + ".sig")
    source = folder / f"Ghostlink_{version}_source.zip"
    base = f"https://github.com/{repo}/releases"
    with ZipFile(source) as bundle:
        def metadata(path):
            require(bundle.getinfo(path).file_size <= 4096, "Oversize source metadata")
            return json.loads(bundle.read(path))
        require(metadata("BUILD-METADATA.json") == {"version": version, "commit": sha},
                "Source archive and build commit differ")
        updater = metadata("RELEASE-CONFIG.json")["plugins"]["updater"]
        require(updater == {"pubkey": public_key, "endpoints": [base + "/latest/download/latest.json"]},
                "Source archive has unexpected updater settings")
    signature = sig.read_text(encoding="ascii").strip()
    with tempfile.TemporaryDirectory() as temp:
        key_file, sig_file = Path(temp, "public.key"), Path(temp, "installer.sig")
        key_file.write_bytes(base64.b64decode(public_key, validate=True))
        sig_file.write_bytes(base64.b64decode(signature, validate=True))
        # -Q prints only the cryptographically verified trusted comment to stdout.
        comment = subprocess.check_output([minisign, "-V", "-Q", "-p", str(key_file),
                                           "-x", str(sig_file), "-m", str(installer)], text=True)
        versions = [field for field in comment.strip().split("\t") if field.startswith("version:")]
        require(versions == [f"version:{version}"], "Installer signature has a different version")
    manifest = folder / "latest.json"
    manifest.write_text(json.dumps({"version": version, "platforms": {"windows-x86_64": {
        "url": f"{base}/download/v{version}/{name}", "signature": signature}}}, indent=2) + "\n",
        encoding="utf-8")
    (folder / "SHA256SUMS.txt").write_text("".join(f"{digest(p)}  {p.name}\n"
        for p in (installer, sig, manifest, source)), encoding="ascii")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["guard", "installer", "draft"])
    args = parser.parse_args()
    repo = os.environ["GITHUB_REPOSITORY"]
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    version = guard(event, repo)
    run = event["workflow_run"]
    name = f"Ghostlink_{version}_x64-setup.exe"
    if args.stage == "guard":
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as outputs:
            print(f"version={version}", file=outputs)
            for kind, limit in [("installer", 128 << 20), ("source", 1024 << 20)]:
                ref = artifact_ref(repo, run["id"], f"{kind}-{run['run_attempt']}", limit)
                print(f"{kind}={json.dumps(ref)}", file=outputs)
        return
    folder = Path(os.environ["RUNNER_TEMP"], "release-assets")
    folder.mkdir(exist_ok=True)
    fetch(repo, json.loads(os.environ["INSTALLER_ARTIFACT"]), folder / name, 128 << 20)
    if args.stage == "draft":
        fetch(repo, json.loads(os.environ["SOURCE_ARTIFACT"]), folder / f"Ghostlink_{version}_source.zip", 1024 << 20)
        signature = artifact_ref(repo, int(os.environ["GITHUB_RUN_ID"]), "signature-" + os.environ["SIGN_ATTEMPT"], 8192)
        fetch(repo, signature, folder / (name + ".sig"), 8192)
        finish(folder, version, run["head_sha"], repo, os.environ["TAURI_UPDATER_PUBLIC_KEY"].strip())
        notes = api(repo, f"contents/docs/releases/{version}.md?ref={run['head_sha']}")
        notes_path = folder.parent / "release-notes.md"
        notes_path.write_bytes(base64.b64decode(notes["content"]))
        subprocess.run(["gh", "release", "create", "v" + version, "--repo", repo, "--draft",
                        "--verify-tag", "--title", "Ghostlink " + version, "--notes-file", str(notes_path),
                        *map(str, sorted(folder.iterdir()))], check=True)


if __name__ == "__main__":
    main()
