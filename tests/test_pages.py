"""Contract of the backend-free edition; models/fiches must keep the same IDs."""
import json
import re
import unittest
from pathlib import Path
from urllib.parse import urlsplit
from tools.export_pages import export
from backend.real_catalog import build_real_metadata

ROOT=Path(__file__).resolve().parents[1]


class StaticPagesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        export(ROOT)
        cls.scene=json.loads((ROOT/"site-data/scene.json").read_text(encoding="utf-8"))
        cls.records={s["Mesh_ID"]:s for s in build_real_metadata(ROOT)["structures"]}

    def test_entry_assets_and_all_fiches_without_python(self):
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        self.assertIn('data-runtime="static"',html)
        self.assertNotIn('src="/static/',html)
        self.assertNotIn('href="/static/',html)
        self.assertEqual({s["Mesh_ID"] for s in self.scene["structures"]},set(self.records))
        for asset in self.scene["model"]["assets"]:
            self.assertFalse(asset["url"].startswith("/"))
            self.assertTrue((ROOT/urlsplit(asset["url"]).path).exists())
        chapters={}
        for record in self.scene["structures"]:
            file=urlsplit(record["study_file"]).path
            if file not in chapters:chapters[file]=json.loads((ROOT/file).read_text(encoding="utf-8"))
            self.assertEqual(chapters[file][record["Mesh_ID"]],self.records[record["Mesh_ID"]])
        self.assertEqual(sum(len(c) for c in chapters.values()),1373)
        self.assertEqual(len(chapters),29)

    def test_export_is_deterministic_and_versions_dependencies(self):
        before=(ROOT/"index.html").read_bytes()
        result=export(ROOT)
        self.assertEqual(before,(ROOT/"index.html").read_bytes())
        self.assertIn(result["fingerprint"],before.decode())
        self.assertTrue(all('?v=' in s["study_file"] for s in self.scene["structures"]))
        html=before.decode()
        imports=json.loads(re.search(r'<script type="importmap">\s*(.*?)\s*</script>',html,re.S)[1])["imports"]
        local_modules=[value for key,value in imports.items() if key.startswith('./static/')]
        linked_assets=re.findall(r'(?:src|href)="(\./static/[^"?]+\.(?:css|js)\?[^\"]+)"',html)
        for asset in [*local_modules,*linked_assets]:
            self.assertEqual(urlsplit(asset).query,'v='+result["fingerprint"])
            self.assertTrue((ROOT/urlsplit(asset).path).is_file(),asset)
