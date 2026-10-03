"""Small synthetic x64 fixture for compiling production-engine adversarial tests."""
import argparse
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument("destination", type=Path)
a = p.parse_args()
a.destination.mkdir()
(a.destination / "resources").mkdir()
(a.destination / "empty").mkdir()
exe = bytearray(128)
exe[:2] = b"MZ"
exe[60:64] = (64).to_bytes(4, "little")
exe[64:70] = b"PE\x00\x00\x64\x86"
(a.destination / "Everia.exe").write_bytes(exe)
(a.destination / "resources/app.asar").write_bytes(b"test fixture - not an executable application\n")
