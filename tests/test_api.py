import copy
import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "pipeline"))
from backend.main import app
from backend.catalog import Metadata
from enrich_metadata import enrich
from common import hierarchy, validate_glb
from backend.procedural_catalog import build_metadata


class APIContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_search_accents_case_aliases_and_ta2(self):
        for query, expected in [("FÉMUR", "demo_femur"), ("rotula", "demo_patella"),
                                ("LCA", "demo_acl"), ("ligamentum cruciatum posterius", "demo_pcl"),
                                ("   patella  ", "demo_patella"), ("recto FEMORAL", "demo_rectus_femoris")]:
            with self.subTest(query=query):
                response = self.client.get("/api/buscar", params={"q": query, "demo": True})
                self.assertEqual(response.status_code, 200)
                record = response.json()["results"][0]
                self.assertEqual(record["Mesh_ID"], expected)
                self.assertTrue(record["sources"])
                self.assertIn("inserciones_articulaciones", record)

    def test_empty_missing_and_validation(self):
        self.assertEqual(self.client.get("/api/buscar?q=xyzxyz").json()["results"], [])
        self.assertEqual(self.client.get("/api/buscar?q=%20").json()["total"], 0)
        self.assertEqual(self.client.get("/api/estructuras/unknown").status_code, 404)
        self.assertEqual(self.client.get("/api/buscar?limit=101").status_code, 422)
        self.assertEqual(self.client.get("/api/buscar", params={"q": "a" * 121}).status_code, 422)

    def test_scene_contract_and_assets(self):
        metadata = self.client.get("/api/metadata?demo=true").json()
        ids = {s["Mesh_ID"] for s in metadata["structures"]}
        expected = {"demo_femur", "demo_tibia", "demo_patella", "demo_acl", "demo_pcl",
                    "demo_patellar_ligament", "demo_rectus_femoris"}
        self.assertEqual(ids, expected)
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/static/viewer.js").status_code, 200)
        self.assertEqual(self.client.get("/static/styles.css").status_code, 200)


class PipelineContractTests(unittest.TestCase):
    def test_unknowns_remain_pending_and_laterality_is_preserved(self):
        dictionary = json.loads((ROOT / "pipeline/catalogo_medico.json").read_text(encoding="utf-8"))
        structures = [
            {"Mesh_ID": "left", "nombre": "Femur_L", "catalog_key": "femur", "display_name_override": "Fémur izquierdo",
             "sistema": "Sistema óseo", "region": "Miembro inferior izquierdo", "capa": "oseo"},
            {"Mesh_ID": "unknown", "nombre": "FMA_99999", "sistema": "Sin clasificar", "region": "Sin clasificar", "capa": "otro"},
        ]
        metadata = enrich({"model": {}, "structures": structures}, dictionary)
        validated = Metadata.model_validate(metadata)
        self.assertEqual(validated.structures[0].nombre, "Fémur izquierdo")
        self.assertEqual(validated.structures[0].region, "Miembro inferior izquierdo")
        self.assertEqual(validated.structures[1].nombre_oficial_ta2, None)
        self.assertEqual(validated.structures[1].revision, "sin_correspondencia_pendiente")

    def test_invalid_hierarchy_and_duplicate_ids_fail(self):
        original = json.loads((ROOT / "data/demo_metadata.json").read_text(encoding="utf-8"))
        broken = copy.deepcopy(original); broken["hierarchy"] = {}
        with self.assertRaises(ValueError):
            Metadata.model_validate(broken)
        broken = copy.deepcopy(original); broken["structures"].append(broken["structures"][0])
        broken["hierarchy"] = hierarchy(broken["structures"])
        with self.assertRaises(ValueError):
            Metadata.model_validate(broken)

    def test_glb_requires_draco_and_correct_identity(self):
        import struct
        document = {"asset": {"version": "2.0"}, "nodes": [{"mesh": 0, "extras": {"Mesh_ID": "bone"}}],
                    "meshes": [{"primitives": [{"extensions": {"KHR_draco_mesh_compression": {}}}]}]}
        def binary(doc):
            data = json.dumps(doc).encode(); data += b" " * (-len(data) % 4)
            return struct.pack("<4sIII", b"glTF", 2, 20 + len(data), len(data)) + struct.pack("<I", 0x4E4F534A) + data
        with TemporaryDirectory() as folder:
            path = Path(folder) / "test.glb"; path.write_bytes(binary(document))
            self.assertTrue(validate_glb(path, [{"Mesh_ID": "bone"}])["draco"])
            with self.assertRaises(ValueError):
                validate_glb(path, [{"Mesh_ID": "wrong"}])
            document["meshes"][0]["primitives"][0]["extensions"] = {}
            path.write_bytes(binary(document))
            with self.assertRaises(ValueError):
                validate_glb(path, [{"Mesh_ID": "bone"}])


class FullBodyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.metadata = build_metadata()
        cls.records = cls.metadata["structures"]
        cls.by_id = {r["Mesh_ID"]: r for r in cls.records}

    def test_complete_skeleton_and_spine(self):
        self.assertEqual(self.metadata["model"]["counts"]["hueso"], 212)
        for prefix, count in [("C", 7), ("T", 12), ("L", 5)]:
            self.assertTrue(all(f"bone_{prefix}{i}" in self.by_id for i in range(1, count + 1)))
        self.assertEqual(len([r for r in self.records if r["Mesh_ID"].startswith("cart_disc_")]), 23)
        self.assertNotIn("cart_disc_C1_C2", self.by_id)
        self.assertIn("cart_disc_L5_S1", self.by_id)

    def test_bilateral_counts_and_mirrors(self):
        for side in ("L", "R"):
            for stem, count in [("bone_rib_", 12), ("bone_carpal_", 8), ("bone_tarsal_", 7),
                                ("bone_metacarpal_", 5), ("bone_metatarsal_", 5),
                                ("bone_hand_phalanx_", 14), ("bone_foot_phalanx_", 14)]:
                self.assertEqual(len([r for r in self.records if r["Mesh_ID"].startswith(stem) and r["side"] == side]), count)
        for record in self.records:
            if record["side"] == "L":
                other = self.by_id[record["Mesh_ID"][:-1] + "R"]
                self.assertEqual(record["geometry"]["parts"], other["geometry"]["parts"])
                self.assertEqual(record["geometry"]["mirror"], -other["geometry"]["mirror"])
        self.assertNotIn("cart_costal_11_L", self.by_id)
        self.assertEqual(self.by_id["bone_rib_12_R"]["subtype"], "flotante")

    def test_medical_fields_and_cuff_classification(self):
        Metadata.model_validate(self.metadata)
        for record in self.records:
            self.assertTrue(all(record[field] for field in ("origen", "insercion", "inervacion", "funcion", "wikipedia_title")))
        for key in ("supraspinatus", "infraspinatus", "subscapularis", "teres_minor"):
            self.assertEqual(self.by_id[f"muscle_{key}_L"]["sistema"], "musculo")
            self.assertEqual(self.by_id[f"lig_cuff_{key}_L"]["subtype"], "tendon")
        self.assertEqual(self.by_id["lig_achilles_R"]["subtype"], "tendon")

    def test_search_whole_body(self):
        from backend.catalog import Catalog
        catalog = Catalog(self.metadata)
        for query, expected in [("C4", "bone_C4"), ("clavicula", "bone_clavicle_R"),
                                ("BÍCEPS", "muscle_biceps_R"), ("calcaneo", "bone_tarsal_calcaneus_R")]:
            self.assertEqual(catalog.search(query)[0][0].Mesh_ID, expected)


class WikipediaTests(unittest.IsolatedAsyncioTestCase):
    async def test_text_cache_and_concurrent_clicks(self):
        import asyncio
        import httpx
        from backend.wikipedia import WikipediaService
        calls = []
        async def response(request):
            calls.append(request.url)
            await asyncio.sleep(.01)
            return httpx.Response(200, json={"title": "Clavícula", "extract": "Resumen de prueba.", "revision": "123", "type": "standard"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            service = WikipediaService(client)
            results = await asyncio.gather(service.summary("Clavícula"), service.summary("Clavícula"))
            self.assertEqual(len(calls), 1)
            self.assertEqual(results[0]["extract"], "Resumen de prueba.")
            self.assertTrue((await service.summary("Clavícula"))["cached"])
            self.assertEqual(len(calls), 1)
            self.assertIn("/api/rest_v1/page/summary/", str(calls[0]))
            await service.close()

    async def test_failures_ambiguity_and_bounded_cache(self):
        import httpx
        from backend.wikipedia import WikipediaService
        def response(request):
            if "ambiguous" in str(request.url):
                return httpx.Response(200, json={"type": "disambiguation", "extract": "No atribuir este texto."})
            return httpx.Response(403, text="Denied")
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            service = WikipediaService(client, max_entries=2)
            result = await service.summary("denied")
            self.assertEqual(result["status"], "unavailable")
            self.assertEqual(result["http_status"], 403)
            result = await service.summary("ambiguous")
            self.assertEqual(result["status"], "disambiguation")
            self.assertEqual(result["extract"], "")
            await service.summary("third")
            self.assertEqual(len(service.cache), 2)
            await service.close()


if __name__ == "__main__":
    unittest.main()
