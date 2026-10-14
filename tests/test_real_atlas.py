import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.catalog import Catalog
from backend.main import app
from backend.real_catalog import build_real_metadata, identity, read_glb

ROOT = Path(__file__).resolve().parents[1]


class RealAtlasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.metadata = build_real_metadata(ROOT)
        cls.catalog = Catalog(cls.metadata)

    def test_every_non_marker_node_has_one_exact_binding(self):
        ids = set(self.catalog.by_id)
        refs = []
        for asset in self.metadata["model"]["assets"]:
            document = read_glb(ROOT / asset["url"].lstrip("/"))
            real_nodes = {str(i) for i, n in enumerate(document["nodes"]) if "mesh" in n}
            self.assertEqual(real_nodes, set(asset["node_bindings"]) | set(asset["excluded_nodes"]))
            self.assertFalse(set(asset["node_bindings"]) & set(asset["excluded_nodes"]))
            self.assertTrue(set(asset["node_bindings"].values()) <= ids)
            refs += list(asset["node_bindings"].values())
        self.assertEqual(set(refs), ids)
        self.assertEqual(len(ids), 1373)
        self.assertTrue(all(s.sources for s in self.catalog.by_id.values()))

    def test_copies_do_not_destroy_spinal_levels_or_laterality(self):
        self.assertEqual(identity("Vertebra T10.001"), ("Vertebra T10", "midline", "Vertebra T10"))
        self.assertEqual(identity("Clavicle.l.001"), ("Clavicle", "L", "Clavicle.l"))
        self.assertEqual(identity("Anterior cruciate ligament.r"), ("Anterior cruciate ligament", "R", "Anterior cruciate ligament.r"))
        for level in ("T1", "T10", "T11", "T12", "C4"):
            exact = [s for s in self.catalog.by_id.values() if s.nombre_original == "Vertebra " + level]
            self.assertEqual(len(exact), 1)
        left = next(s for s in self.catalog.by_id.values() if s.nombre_original == "Femur" and s.side == "L")
        right = next(s for s in self.catalog.by_id.values() if s.nombre_original == "Femur" and s.side == "R")
        self.assertNotEqual(left.Mesh_ID, right.Mesh_ID)

    def test_spanish_names_aliases_and_real_ligaments(self):
        for query, original in [("CLAVÍCULA", "Clavicle"), ("C4", "Vertebra C4"), ("LCA", "Anterior cruciate ligament"),
                                ("LCP", "Posterior cruciate ligament"), ("calcaneo", "Calcaneus"), ("Aquiles", "Calcaneal tendon")]:
            results, _ = self.catalog.search(query)
            self.assertEqual(results[0].nombre_original, original)
        results, _ = self.catalog.search("bíceps braquial")
        self.assertTrue(all(s.capa == "muscular" for s in results))
        self.assertGreater(sum(hasattr(s, "translation_source") for s in self.catalog.by_id.values()), 1300)
        self.assertTrue(any(s.nombre_original == "Articular capsule of knee joint" for s in self.catalog.by_id.values()))

    def test_api_real_assets_and_wikipedia_unknown_title(self):
        with TestClient(app) as client:
            data = client.get("/api/metadata").json()
            self.assertEqual(data["model"]["source"], "z-anatomy-real")
            for asset in data["model"]["assets"]:
                response = client.get(asset["url"])
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content[:4], b"glTF")
            self.assertEqual(client.get("/static/vendor/draco/draco_decoder.wasm").status_code, 200)
            unknown = next(s for s in self.catalog.by_id.values() if s.wikipedia_title is None)
            response = client.get(f"/api/estructuras/{unknown.Mesh_ID}/wikipedia")
            self.assertEqual(response.json()["status"], "not_mapped")
            self.assertEqual(client.get("/api/estructuras/missing/wikipedia").status_code, 404)

    def test_muscle_sections_use_source_nomenclature(self):
        sections = self.metadata["model"]["muscle_sections"]
        muscles = [s for s in self.metadata["structures"] if s["capa"] == "muscular"]
        self.assertEqual(len(sections), 13)
        self.assertEqual(sum(s["count"] for s in sections.values()), len(muscles))
        self.assertTrue(all(s["study_section"] in sections for s in muscles))
        # These were assigned an overly broad/incorrect view_region by the old atlas.
        for original, section, group in [("Sternohyoid muscle", "neck", "neck_other"),
                ("Serratus anterior muscle", "thorax", "thorax"),
                ("Rectus femoris muscle", "thigh", "thigh_anterior"),
                ("Subscapularis muscle", "shoulder", "rotator_cuff"),
                ("Coccygeus muscle", "pelvis", "pelvic_floor")]:
            records = [s for s in muscles if s["nombre_original"] == original]
            self.assertTrue(records)
            self.assertTrue(all((s["study_section"], s["study_group"]) == (section, group) for s in records))
        self.assertTrue(all(s["capa"] == "otro" for s in self.metadata["structures"]
                            if s["nombre_original"] in ("Iliopectineal arch", "Trochlea of superior oblique muscle")))

    def test_lean_scene_preserves_identities_and_cache_variants(self):
        with TestClient(app) as client:
            scene = client.get("/api/scene", headers={"Accept-Encoding": "identity"})
            full = client.get("/api/metadata", headers={"Accept-Encoding": "identity"})
            records = scene.json()["structures"]
            self.assertEqual({s["Mesh_ID"] for s in records}, set(self.catalog.by_id))
            self.assertTrue(all("aliases" in s and "nombre_original" in s for s in records))
            self.assertTrue(all("descripcion" not in s and "inervacion" not in s for s in records))
            self.assertLess(len(scene.content), len(full.content) // 2)
            self.assertEqual(client.get("/api/scene", headers={"Accept-Encoding": "identity", "If-None-Match": scene.headers["etag"]}).status_code, 304)
            compressed = client.get("/api/scene", headers={"Accept-Encoding": "gzip"})
            self.assertEqual(compressed.headers["content-encoding"], "gzip")
            self.assertEqual(compressed.json(), scene.json())
            self.assertNotEqual(scene.headers["etag"], compressed.headers["etag"])
            self.assertEqual(client.get("/api/scene", headers={"Accept-Encoding": "gzip;q=0.0000, identity"}).content, scene.content)
            self.assertEqual(client.get("/api/scene", headers={"Accept-Encoding": "gzip", "If-None-Match": 'W/' + compressed.headers["etag"]}).status_code, 304)
            clinical = client.get("/api/estructuras/" + records[0]["Mesh_ID"]).json()
            self.assertIn("descripcion", clinical)


if __name__ == "__main__":
    unittest.main()
