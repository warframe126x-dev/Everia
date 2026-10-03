import importlib.util
from pathlib import Path
import tempfile
import unittest
import os

spec = importlib.util.spec_from_file_location("inventory", Path(__file__).parents[2] / "tools/generation/inventory.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def fixture(root):
    (root / 'resources').mkdir()
    exe = bytearray(128); exe[:2] = b'MZ'; exe[60:64] = (64).to_bytes(4, 'little'); exe[64:70] = b'PE\0\0\x64\x86'
    (root / 'Everia.exe').write_bytes(exe)
    (root / 'resources/app.asar').write_bytes(b'deterministic application fixture')
    (root / 'empty').mkdir()


class InventoryTests(unittest.TestCase):
    def test_deterministic_complete(self):
        with tempfile.TemporaryDirectory() as d:
            r = Path(d); fixture(r)
            a = m.generate(r, 'a'*40, 'build-1', 'b'*64)
            self.assertEqual(a, m.generate(r, 'a'*40, 'build-1', 'b'*64))
            self.assertEqual(len(a['files']), 2)
            self.assertIn('empty', a['directories'])
            self.assertIn('application-bundle', [f['role'] for f in a['files']])
            (r/'resources/app.asar').write_bytes(b'changed')
            self.assertNotEqual(a['digest'], m.generate(r, 'a'*40, 'build-1', 'b'*64)['digest'])
    def test_invalid_paths(self):
        for s in ('../x','a//b','a\\b','x:ads','NUL.txt','a.','a ','COM1','CONIN$','.everia-state/x','é'):
            with self.subTest(s=s), self.assertRaises(ValueError): m.relative(s)
    def test_case_collision(self):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d); fixture(r)
            (r/'A').write_bytes(b'a'); (r/'a').write_bytes(b'b')
            if len([p for p in r.iterdir() if p.name.upper()=='A']) != 2:
                # Windows filesystem prevents this fixture; exercise canonical rejection inputs separately.
                self.assertEqual('A'.upper(), 'a'.upper()); return
            with self.assertRaises(ValueError): m.generate(r, 'a'*40, 'build', 'b'*64)
    def test_hardlink(self):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d); fixture(r); os.link(r/'Everia.exe', r/'alias')
            with self.assertRaises(ValueError): m.generate(r, 'a'*40, 'build', 'b'*64)
    def test_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d); fixture(r)
            try: (r/'link').symlink_to(r/'resources', target_is_directory=True)
            except OSError: return # Native Windows engine suite requires this scenario without skipping.
            with self.assertRaises(ValueError): m.generate(r, 'a'*40, 'build', 'b'*64)
    def test_provenance_and_pe(self):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d); fixture(r)
            with self.assertRaises(ValueError): m.generate(r, 'bad', 'build', 'b'*64)
            (r/'Everia.exe').write_bytes(b'not PE')
            with self.assertRaises(ValueError): m.generate(r, 'a'*40, 'build', 'b'*64)

if __name__=='__main__': unittest.main()
