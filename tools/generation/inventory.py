"""Build-only inventory for the native engine; never install or execute payloads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat

MAX_FILES = 10000
MAX_DIRS = 4096
MAX_FILE = 2 * 1024**3
MAX_TOTAL = 8 * 1024**3
RESERVED = {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"} | {f"{p}{n}" for p in ("COM", "LPT") for n in range(10)}


def component(value):
    if not value or len(value) > 120 or value in (".", "..") or value[-1] in ". ":
        raise ValueError("ambiguous component")
    if any(ord(c) < 32 or ord(c) >= 127 or c in '\\/:*?"<>|' for c in value):
        raise ValueError("unsupported component")
    if value.split(".")[0].upper() in RESERVED or value.lower() == ".everia-state":
        raise ValueError("reserved component")


def relative(value):
    if len(value) > 240:
        raise ValueError("relative path too long")
    for part in value.split("/"):
        component(part)


def regular(path):
    s = path.lstat()
    if stat.S_ISLNK(s.st_mode) or getattr(s, "st_file_attributes", 0) & 0x400:
        raise ValueError("reparse/symlink source refused")
    if not stat.S_ISDIR(s.st_mode) and (not stat.S_ISREG(s.st_mode) or s.st_nlink != 1):
        raise ValueError("nonregular/hard-linked source refused")
    return s


def sha_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def role(name):
    if name == "Everia.exe":
        return "application-entry"
    if name == "resources/app.asar":
        return "application-bundle"
    if name.lower().endswith((".dll", ".exe")):
        return "runtime-binary"
    return "runtime-data"


def canonical(manifest):
    s = f"EVERIA-PAYLOAD\t1\nsource\t{manifest['source']}\nbuild\t{manifest['build']}\narchive\t{manifest['archive']}\narch\tx64\n"
    s += "".join(f"D\t{p}\n" for p in manifest["directories"])
    s += "".join(f"F\t{f['path']}\t{f['size']}\t{f['sha256']}\t{f['role']}\n" for f in manifest["files"])
    return s.encode("ascii")


def generate(root, source, build, archive):
    if not re.fullmatch("[0-9a-f]{40}", source) or not re.fullmatch("[A-Za-z0-9-]{1,64}", build) or not re.fullmatch("[0-9a-f]{64}", archive):
        raise ValueError("invalid build provenance")
    regular(root)
    seen, dirs, files, total = set(), [], [], 0
    for parent, directory_names, filenames in os.walk(root, followlinks=False):
        for name in directory_names + filenames:
            p = Path(parent) / name
            r = p.relative_to(root).as_posix()
            relative(r)
            folded = r.upper()
            if folded in seen:
                raise ValueError("Windows case-equivalent collision")
            seen.add(folded)
            st = regular(p)
            if stat.S_ISDIR(st.st_mode):
                dirs.append(r)
            else:
                if st.st_size > MAX_FILE:
                    raise ValueError("file too large")
                total += st.st_size
                files.append(dict(path=r, size=st.st_size, sha256=sha_file(p), role=role(r)))
    if not files or len(files) > MAX_FILES or len(dirs) > MAX_DIRS or total > MAX_TOTAL:
        raise ValueError("bounded inventory exceeded")
    # This tool is for actual x64 Everia payloads, not arbitrary directory trees.
    exe = root / "Everia.exe"
    with exe.open("rb") as f:
        h = f.read(64)
        if len(h) != 64 or h[:2] != b"MZ":
            raise ValueError("missing PE Everia.exe")
        offset = int.from_bytes(h[60:64], "little")
        if offset > 1024 * 1024:
            raise ValueError("invalid PE offset")
        f.seek(offset)
        if f.read(6) != b"PE\x00\x00\x64\x86":
            raise ValueError("not Windows x64")
    if not (root / "resources/app.asar").is_file():
        raise ValueError("missing application bundle")
    m = dict(schema=1, source=source, build=build, archive=archive, architecture="x64", directories=sorted(dirs), files=sorted(files, key=lambda f: f["path"]))
    m["digest"] = hashlib.sha256(canonical(m)).hexdigest()
    return m


def header(m):
    q = lambda s: json.dumps(s, ensure_ascii=True)
    dirs = ",\n".join(q(p) for p in m["directories"])
    files = ",\n".join("{" + ",".join((q(f["path"]), str(f["size"]) + "ULL", q(f["sha256"]), q(f["role"]))) + "}" for f in m["files"])
    return f'''// GENERATED FROM ACTUAL PAYLOAD. Do not edit or load a mutable on-disk inventory.
#pragma once
inline const Inventory& embedded_inventory() {{
  static const Inventory value{{1,{q(m['source'])},{q(m['build'])},{q(m['archive'])},{q(m['digest'])},{{{dirs}}},{{{files}}}}};
  return value;
}}
'''


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--payload", required=True, type=Path)
    p.add_argument("--source", required=True)
    p.add_argument("--build", required=True)
    p.add_argument("--archive", required=True)
    p.add_argument("--output", required=True, type=Path)
    a = p.parse_args()
    m = generate(a.payload, a.source, a.build, a.archive)
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "payload_inventory.hpp").write_text(header(m), encoding="ascii")
    (a.output / "payload-inventory.json").write_text(json.dumps(m, indent=2) + "\n", encoding="ascii")
    print(json.dumps(dict(files=len(m["files"]), directories=len(m["directories"]), bytes=sum(f["size"] for f in m["files"]), digest=m["digest"])))


if __name__ == "__main__":
    main()
