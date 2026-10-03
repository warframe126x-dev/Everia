"""Recover authenticated, already-distributed portable bytes without executing them.
Only the application payload is extracted. No installer is opened or downloaded.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import stat
import zipfile
from inventory import relative, sha_file

EXPECTED = "d47a17e91d0e4ec608c513cc00ce4c56162f1a84999f74e165d072146ed7a49c"
SOURCE = "5426ad4aa28888c336cbb71e0024652dd4c958c7"


def entries(z):
    seen, total = set(), 0
    for i in z.infolist():
        path = i.filename.rstrip("/")
        relative(path)
        if path.upper() in seen or i.flag_bits & 1:
            raise ValueError("duplicate/encrypted entry")
        seen.add(path.upper())
        mode = i.external_attr >> 16
        if stat.S_ISLNK(mode) or i.external_attr & 0x400:
            raise ValueError("link/reparse archive entry")
        total += i.file_size
        if i.file_size > 2 * 1024**3 or total > 8 * 1024**3 or len(seen) > 15000:
            raise ValueError("bounded archive exceeded")
    return z.infolist()


def recover(wrapper, destination, evidence):
    if sha_file(wrapper) != EXPECTED:
        raise ValueError("authenticated artifact digest mismatch")
    with zipfile.ZipFile(wrapper) as outer:
        listing = entries(outer)
        if len(listing) != 1 or listing[0].filename != "Everia-v1.0-win-x64.zip":
            raise ValueError("unexpected artifact wrapper")
        inner = outer.read(listing[0])
    with zipfile.ZipFile(io.BytesIO(inner)) as z:
        listing = entries(z)
        readme = z.read("README-FIRST.txt").decode("utf-8-sig")
        if SOURCE not in readme:
            raise ValueError("distributed source provenance mismatch")
        manifest = z.read("verification/package-manifest-launch-tested.txt").decode("utf-8-sig")
        expected = {}
        for line in manifest.splitlines():
            if not line:
                continue
            match = re.fullmatch(r"([0-9a-fA-F]{64}) \*(.+)", line)
            if not match:
                raise ValueError("malformed original package manifest")
            path = match[2].replace("\\", "/")
            relative(path)
            if path.upper() in expected:
                raise ValueError("manifest collision")
            expected[path.upper()] = match[1].lower()
        destination.mkdir()
        actual = {}
        for i in listing:
            if not i.filename.startswith("Everia-win32-x64/"):
                continue
            name = i.filename[len("Everia-win32-x64/"):].rstrip("/")
            if not name:
                continue
            relative(name)
            target = destination.joinpath(*name.split("/"))
            if i.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            data = z.read(i)
            digest = hashlib.sha256(data).hexdigest()
            if expected.get(name.upper()) != digest:
                raise ValueError("original payload manifest mismatch")
            with target.open("xb") as f:
                f.write(data)
            actual[name.upper()] = digest
        if actual != expected:
            raise ValueError("missing or extra payload")
    report = dict(source=SOURCE, run=36705033196, artifact=11092205934,
                  artifact_sha256=EXPECTED, portable_sha256=hashlib.sha256(inner).hexdigest(),
                  payload_files=len(actual), executable_sha256=actual["EVERIA.EXE"],
                  app_asar_sha256=actual["RESOURCES/APP.ASAR"])
    evidence.write_text(json.dumps(report, indent=2) + "\n", encoding="ascii")
    print(json.dumps(report))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--artifact", type=Path, required=True)
    p.add_argument("--destination", type=Path, required=True)
    p.add_argument("--evidence", type=Path, required=True)
    a = p.parse_args()
    recover(a.artifact, a.destination, a.evidence)
