"""Build exact GLB-node bindings without rewriting the licensed geometry.

Original node indices, not sanitized Three.js names, identify meshes. Repeated
parts of one named structure are grouped; overlaps between exports are kept once.
Only supplied nomenclature and explicit local correspondences are used.
"""
import copy
import json
import re
import struct
import uuid
from collections import Counter

from .muscle_sections import study_metadata
from pathlib import Path

from .catalog import normalize
from .procedural_catalog import build_metadata as procedural_metadata, REGIONS, SYSTEMS

ASSETS = [("articular", "articular.glb"), ("skeletal", "skeleton.glb"), ("muscular", "muscular.glb")]
ASSET_ORDER = {"skeletal": 0, "muscular": 1, "articular": 2}
SIDES = {"L": "izquierdo", "R": "derecho", "midline": ""}
NUMBERS = {word: i for i, word in enumerate("first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth".split(), 1)}

# English names are matched exactly after removing ONLY Blender copy/laterality suffixes.
# The right column points to the existing study notes, not to procedural geometry.
REFERENCE_KEYS = {
    "Parietal bone": "bone_parietal", "Frontal bone": "bone_frontal", "Occipital bone": "bone_occipital",
    "Sphenoid bone": "bone_sphenoid", "Temporal bone": "bone_temporal", "Ethmoid bone": "bone_ethmoid",
    "Inferior nasal concha bone": "bone_inferior_concha", "Lacrimal bone": "bone_lacrimal", "Nasal bone": "bone_nasal",
    "Maxilla": "bone_maxilla", "Palatine bone": "bone_palatine", "Zygomatic bone": "bone_zygomatic",
    "Mandible": "bone_mandible", "Hyoid bone": "bone_hyoid", "Vomer": "bone_vomer", "Malleus": "bone_malleus",
    "Incus": "bone_incus", "Stapes": "bone_stapes", "Sacrum": "bone_sacrum", "Coccyx": "bone_coccyx",
    "Clavicle": "bone_clavicle", "Scapula": "bone_scapula", "Humerus": "bone_humerus", "Radius": "bone_radius",
    "Ulna": "bone_ulna", "Femur": "bone_femur", "Patella": "bone_patella", "Tibia": "bone_tibia", "Fibula": "bone_fibula",
    "Talus": "bone_tarsal_talus", "Calcaneus": "bone_tarsal_calcaneus", "Navicular bone": "bone_tarsal_navicular",
    "Cuboid bone": "bone_tarsal_cuboid", "Intermediate cuneiform bone": "bone_tarsal_intermediate_cuneiform",
    "Medial cuneiform bone": "bone_tarsal_medial_cuneiform", "Lateral cuneiform bone": "bone_tarsal_lateral_cuneiform",
    "Capitate bone": "bone_carpal_capitate", "Hamate bone": "bone_carpal_hamate", "Lunate bone": "bone_carpal_lunate",
    "Pisiform bone": "bone_carpal_pisiform", "Scaphoid bone": "bone_carpal_scaphoid", "Trapezium bone": "bone_carpal_trapezium",
    "Trapezoid bone": "bone_carpal_trapezoid", "Triquetrum bone": "bone_carpal_triquetrum",
    "Manubrium of sternum": "bone_manubrium", "Body of sternum": "bone_sternal_body", "Xiphoid process": "bone_xiphoid",
    "Anterior cruciate ligament": "lig_acl", "Posterior cruciate ligament": "lig_pcl",
    "Anterior longitudinal ligament": "lig_longitudinal_anterior", "Posterior longitudinal ligament": "lig_longitudinal_posterior",
    "Supraspinous ligament": "lig_supraspinous", "Nuchal ligament": "lig_nuchal",
    "Acromioclavicular ligament": "lig_acromioclavicular", "Inguinal ligament": "lig_inguinal",
    "Fibular collateral ligament": "lig_knee_fibular", "Stylomandibular ligament": "lig_stylomandibular",
    "Calcaneal tendon": "lig_achilles", "Medial meniscus": "cart_meniscus_medial", "Lateral meniscus": "cart_meniscus_lateral",
    "Pubic symphysis": "cart_pubic_symphysis", "Interpubic disc": "cart_pubic_symphysis",
    "Temporalis muscle": "muscle_temporalis", "Sternocleidomastoid muscle": "muscle_scm",
    "Latissimus dorsi muscle": "muscle_latissimus", "Brachioradialis muscle": "muscle_brachioradialis",
    "Supraspinatus muscle": "muscle_supraspinatus", "Infraspinatus muscle": "muscle_infraspinatus",
    "Subscapularis muscle": "muscle_subscapularis", "Teres minor muscle": "muscle_teres_minor",
    "Gluteus maximus muscle": "muscle_gluteus_maximus", "Gluteus medius muscle": "muscle_gluteus_medius",
    "Rectus femoris muscle": "muscle_rectus_femoris", "Vastus lateralis muscle": "muscle_vastus_lateralis",
    "Vastus medialis muscle": "muscle_vastus_medialis", "Vastus intermedius muscle": "muscle_vastus_intermedius",
    "Semitendinosus muscle": "muscle_semitendinosus", "Semimembranosus muscle": "muscle_semimembranosus",
    "Sartorius muscle": "muscle_sartorius", "Soleus muscle": "muscle_soleus", "Tibialis anterior muscle": "muscle_tibialis_anterior",
    "Rectus abdominis muscle": "muscle_rectus_abdominis", "External abdominal oblique muscle": "muscle_external_oblique",
    "Adductor longus": "muscle_adductor_longus",
}
PART_REFERENCES = {
    "Superficial part of masseter": ("muscle_masseter", "Masetero · porción superficial"),
    "Deep part of masseter": ("muscle_masseter", "Masetero · porción profunda"),
    "Long head of biceps brachii": ("muscle_biceps", "Bíceps braquial · cabeza larga"),
    "Short head of biceps brachii": ("muscle_biceps", "Bíceps braquial · cabeza corta"),
    "Long head of triceps brachii": ("muscle_triceps", "Tríceps braquial · cabeza larga"),
    "Lateral head of triceps brachii": ("muscle_triceps", "Tríceps braquial · cabeza lateral"),
    "Medial head of triceps brachii": ("muscle_triceps", "Tríceps braquial · cabeza medial"),
    "Long head of biceps femoris": ("muscle_biceps_femoris", "Bíceps femoral · cabeza larga"),
    "Short head of biceps femoris": ("muscle_biceps_femoris", "Bíceps femoral · cabeza corta"),
    "Medial head of gastrocnemius": ("muscle_gastrocnemius_medial", "Gastrocnemio · cabeza medial"),
    "Lateral head of gastrocnemius": ("muscle_gastrocnemius_lateral", "Gastrocnemio · cabeza lateral"),
}
for source, label in [("Acromial", "porción acromial"), ("Clavicular", "porción clavicular"), ("Scapular spinal", "porción espinal")]:
    PART_REFERENCES[f"{source} part of deltoid muscle"] = ("muscle_deltoid", "Deltoides · " + label)
for source, label in [("Ascending", "porción ascendente"), ("Descending", "porción descendente"), ("Transverse", "porción transversa")]:
    PART_REFERENCES[f"{source} part of trapezius muscle"] = ("muscle_trapezius", "Trapecio · " + label)
for source, label in [("Clavicular head", "porción clavicular"), ("Sternocostal head", "porción esternocostal"), ("(Abdominal part", "porción abdominal")]:
    name = source + " of pectoralis major muscle" + (")" if source.startswith("(") else "")
    PART_REFERENCES[name] = ("muscle_pectoralis", "Pectoral mayor · " + label)
for source in ("Descending", "Transverse"):
    PART_REFERENCES[source + " part of iliofemoral ligament"] = ("lig_iliofemoral", "Ligamento iliofemoral · porción " + ("descendente" if source == "Descending" else "transversa"))
for source in ("Deep", "Superficial"):
    PART_REFERENCES[source + " part of tibial collateral ligament"] = ("lig_knee_tibial", "Ligamento colateral tibial · porción " + ("profunda" if source == "Deep" else "superficial"))

TRANSLATIONS = {
    "Hip bone": ("Hueso coxal", "Hueso coxal"), "Coracoclavicular ligament": ("Ligamento coracoclavicular", "Ligamento coracoclavicular"),
    "Conoid ligament": ("Ligamento conoide", "Ligamento coracoclavicular"), "Trapezoid ligament": ("Ligamento trapezoide", "Ligamento coracoclavicular"),
    "Patellar ligament": ("Ligamento patelar", "Ligamento rotuliano"), "Ulnar collateral ligament": ("Ligamento colateral ulnar del codo", "Ligamento colateral cubital"),
    "Radial collateral ligament": ("Ligamento colateral radial del codo", "Ligamento colateral radial"),
    "Ligamenta flava": ("Ligamentos amarillos", "Ligamento amarillo"), "Interspinous ligaments": ("Ligamentos interespinosos", "Ligamento interespinoso"),
    "Intertransverse ligaments": ("Ligamentos intertransversos", "Ligamento intertransverso"), "Ligament of head of femur": ("Ligamento de la cabeza del fémur", "Ligamento de la cabeza del fémur"),
    "Sacrospinous ligament": ("Ligamento sacroespinoso", "Ligamento sacroespinoso"), "Sacrotuberous ligament": ("Ligamento sacrotuberoso", "Ligamento sacrotuberoso"),
    "Ischiofemoral ligament": ("Ligamento isquiofemoral", "Ligamento isquiofemoral"), "Pubofemoral ligament": ("Ligamento pubofemoral", "Ligamento pubofemoral"),
    "Obturator membrane": ("Membrana obturatriz", "Membrana obturatriz"), "Glenoid labrum": ("Rodete glenoideo", "Rodete glenoideo"),
    "Acetabular labrum": ("Rodete acetabular", "Labrum acetabular"), "Interosseous membrane of forearm": ("Membrana interósea del antebrazo", "Membrana interósea"),
    "Interosseous membrane of leg": ("Membrana interósea de la pierna", "Membrana interósea"), "Oblique popliteal ligament": ("Ligamento poplíteo oblicuo", "Ligamento poplíteo oblicuo"),
    "Transverse ligament of knee": ("Ligamento transverso de la rodilla", "Ligamento transverso de la rodilla"),
    "Stylohyoid ligament": ("Ligamento estilohioideo", "Ligamento estilohioideo"), "Sphenomandibular ligament": ("Ligamento esfenomandibular", "Ligamento esfenomandibular"),
    "Diaphragm": ("Diafragma", "Diafragma (anatomía)"), "Pectoralis minor muscle": ("Pectoral menor", "Músculo pectoral menor"),
    "Serratus anterior muscle": ("Serrato anterior", "Músculo serrato anterior"), "Brachialis muscle": ("Braquial", "Músculo braquial"),
    "Coracobrachialis muscle": ("Coracobraquial", "Músculo coracobraquial"), "Teres major muscle": ("Redondo mayor", "Músculo redondo mayor"),
    "Levator scapulae": ("Elevador de la escápula", "Músculo elevador de la escápula"), "Rhomboid major muscle": ("Romboides mayor", "Músculo romboides mayor"),
    "Rhomboid minor muscle": ("Romboides menor", "Músculo romboides menor"), "Iliacus muscle": ("Ilíaco", "Músculo ilíaco"), "Psoas major": ("Psoas mayor", "Músculo psoas mayor"),
    "Gluteus minimus muscle": ("Glúteo menor", "Músculo glúteo menor"), "Piriformis muscle": ("Piriforme", "Músculo piriforme"),
    "Tensor fasciae latae": ("Tensor de la fascia lata", "Músculo tensor de la fascia lata"), "Gracilis muscle": ("Grácil", "Músculo grácil"),
    "Adductor magnus": ("Aductor mayor", "Músculo aductor mayor"), "Adductor brevis": ("Aductor corto", "Músculo aductor corto"),
    "Pectineus muscle": ("Pectíneo", "Músculo pectíneo"), "Quadratus femoris muscle": ("Cuadrado femoral", "Músculo cuadrado femoral"),
    "Obturator internus": ("Obturador interno", "Músculo obturador interno"), "Obturator externus": ("Obturador externo", "Músculo obturador externo"),
    "Superior gemellus muscle": ("Gemelo superior", "Músculo gemelo superior"), "Inferior gemellus muscle": ("Gemelo inferior", "Músculo gemelo inferior"),
    "Popliteus muscle": ("Poplíteo", "Músculo poplíteo"), "Plantaris muscle": ("Plantar", "Músculo plantar"),
    "Tibialis posterior muscle": ("Tibial posterior", "Músculo tibial posterior"), "Fibularis longus muscle": ("Fibular largo", "Músculo peroneo largo"),
    "Fibularis brevis muscle": ("Fibular corto", "Músculo peroneo corto"), "Fibularis tertius muscle": ("Fibular tercero", "Músculo peroneo tercero"),
    "Internal abdominal oblique muscle": ("Oblicuo interno del abdomen", "Músculo oblicuo interno del abdomen"),
    "Transversus abdominis muscle": ("Transverso del abdomen", "Músculo transverso del abdomen"), "Quadratus lumborum muscle": ("Cuadrado lumbar", "Músculo cuadrado lumbar"),
    "Frontalis muscle": ("Frontal", "Músculo frontal"), "Occipitalis muscle": ("Occipital", "Músculo occipital"),
    "Orbicularis oris muscle": ("Orbicular de la boca", "Músculo orbicular de la boca"), "Bucinator": ("Buccinador", "Músculo buccinador"),
    "Platysma": ("Platisma", "Platisma"), "Iliotibial tract": ("Tracto iliotibial", "Tracto iliotibial"), "Fascia lata": ("Fascia lata", "Fascia lata"),
    "Linea alba": ("Línea alba", "Línea alba"), "Plantar aponeurosis": ("Aponeurosis plantar", "Aponeurosis plantar"),
    "Palmar aponeurosis": ("Aponeurosis palmar", "Aponeurosis palmar"),
}


def read_glb(path):
    with path.open("rb") as stream:
        magic, version, total = struct.unpack("<4sII", stream.read(12))
        length, kind = struct.unpack("<II", stream.read(8))
        if magic != b"glTF" or version != 2 or total != path.stat().st_size or kind != 0x4E4F534A:
            raise ValueError(f"GLB inválido: {path.name}")
        return json.loads(stream.read(length))


def identity(name):
    clean = re.sub(r"(?:\.\d+)+$", "", name)
    side = "L" if clean.endswith(".l") else "R" if clean.endswith(".r") else "midline"
    return clean[:-2] if side != "midline" else clean, side, clean


def reference_key(base):
    if base in REFERENCE_KEYS:
        return REFERENCE_KEYS[base]
    if base in PART_REFERENCES:
        return PART_REFERENCES[base][0]
    match = re.fullmatch(r"(?:Vertebra |Atlas \(|Axis \()([CTL]\d{1,2})\)?", base)
    if match:
        return "bone_" + match[1]
    match = re.fullmatch(r"Intervertebral disc ([CTL]\d+)-([CTL]\d+|S1)", base)
    if match:
        return f"cart_disc_{match[1]}_{match[2]}"
    match = re.fullmatch(r"(\w+) rib", base, re.I)
    if match and match[1].lower() in NUMBERS:
        return f"bone_rib_{NUMBERS[match[1].lower()]:02}"
    match = re.fullmatch(r"Costal cartilage of (\w+) rib", base, re.I)
    if match and match[1].lower() in NUMBERS:
        return f"cart_costal_{NUMBERS[match[1].lower()]:02}"
    match = re.fullmatch(r"(\w+) (metacarpal|metatarsal) bone", base, re.I)
    if match and match[1].lower() in NUMBERS:
        return f"bone_{match[2].lower()}_{NUMBERS[match[1].lower()]}"
    match = re.fullmatch(r"(Distal|Middle|Proximal) phalanx of (\w+) finger of (hand|foot)", base)
    if match and match[2].lower() in NUMBERS:
        label = {"Distal": "distal", "Middle": "media", "Proximal": "proximal"}[match[1]]
        return f"bone_{match[3]}_phalanx_{NUMBERS[match[2].lower()]}_{label}"
    return None


def translated_name(base, reference):
    if base in PART_REFERENCES:
        return PART_REFERENCES[base][1], reference.get("wikipedia_title") if reference else None
    if reference:
        return reference["short_name"], reference.get("wikipedia_title")
    if base in TRANSLATIONS:
        return TRANSLATIONS[base]
    if match := re.fullmatch(r"Nucleus pulposus ([CTL]\d+)-([CTL]\d+|S1)", base):
        return f"Núcleo pulposo {match[1]}–{match[2]}", "Disco intervertebral"
    joints = {"acromioclavicular": "acromioclavicular", "elbow": "codo", "glenohumeral": "glenohumeral", "hip": "cadera",
              "knee": "rodilla", "radiocarpal": "radiocarpiana", "sternoclavicular": "esternoclavicular", "temporomandibular": "temporomandibular",
              "superior tibiofibular": "tibiofibular superior"}
    if match := re.fullmatch(r"Articular (capsule|disc) of (.+) joint", base):
        if match[2] in joints:
            kind = "Cápsula" if match[1] == "capsule" else "Disco"
            return f"{kind} articular · {joints[match[2]]}", "Cápsula articular" if kind == "Cápsula" else "Disco articular"
    if match := re.fullmatch(r"(Upper|Lower) (medial incisor|lateral incisor|canine|first premolar|second premolar|first molar tooth|second molar tooth)", base):
        names = {"medial incisor": "Incisivo central", "lateral incisor": "Incisivo lateral", "canine": "Canino", "first premolar": "Primer premolar",
                 "second premolar": "Segundo premolar", "first molar tooth": "Primer molar", "second molar tooth": "Segundo molar"}
        return names[match[2]] + (" superior" if match[1] == "Upper" else " inferior"), "Diente"
    if base.startswith("Sinus of "):
        return "Seno · " + base[9:], "Seno paranasal"
    # Keep source English for untranslated entries; do not manufacture equivalences.
    return base, None


def region_of(base, path, reference):
    if reference:
        return reference["view_region"]
    text = normalize(" ".join(path) + " " + base)
    if any(s in text for s in ("lower limb", "pelvi", "hip ", "femor", "foot", "patell", "tibi", "fibular", "tarsal", "plantar", "sacrotuber", "sacrospin", "inguinal")):
        return "lower"
    if any(s in text for s in ("upper limb", "pectoral girdle", "shoulder", "elbow", "hand", "carpal", "forearm", "humer", "scapul", "brach", "ulnar", "radial", "clavic")):
        return "upper"
    if any(s in text for s in ("thorax", "abdom", "costal", "rib", "stern", "diaphragm", "pectoralis", "latissimus")):
        return "thorax"
    return "head_spine"


def category(base, asset, reference):
    text = base.lower()
    if base in ("Iliopectineal arch", "Trochlea of superior oblique muscle"):
        return "tejido", "otro", "tejido"
    if any(word in text for word in ("cartilage", "meniscus", "labrum", "articular disc", "intervertebral disc", "nucleus pulposus", "interpubic disc", "symphysis")):
        return "cartilago", "cartilago", "fibrocartilago" if "meniscus" in text or "labrum" in text else "cartilago"
    if any(word in text for word in ("sinus", "cells of", "fat pad", "bursa", "fascia", "septum", "sheath", "tarsus")):
        return "tejido", "otro", "tejido"
    if asset == "skeletal":
        tooth = any(word in text for word in ("incisor", "canine", "premolar", "molar tooth"))
        return ("diente" if tooth else "hueso"), "oseo", "diente" if tooth else "hueso"
    if asset == "articular" or any(word in text for word in ("ligament", "tendon", "retinaculum", "aponeurosis", "tendinous", "iliotibial", "linea alba")):
        return "ligamento", "articular", "tendon" if "tendon" in text or "tendinous" in text else "capsula" if "capsule" in text else "ligamento"
    return "musculo", "muscular", "muscle"


def build_real_metadata(root: Path):
    manifest = json.loads((root / "data/z_anatomy_manifest.json").read_text(encoding="utf-8"))
    translations = json.loads((root / "data/real_translations.json").read_text(encoding="utf-8"))["entries"]
    # Some entries appear in more than one system; prefer the exact file of each export.
    nomenclature = {}
    for entry in manifest["organs"]:
        nomenclature.setdefault(normalize(entry["node"]), []).append(entry)
    clinical = {s["Mesh_ID"]: s for s in procedural_metadata()["structures"]}
    groups, assets = {}, []
    for kind, filename in ASSETS:
        path = root / "static/models" / filename
        document = read_glb(path)
        asset = {"key": kind, "url": "/static/models/" + filename, "bytes": path.stat().st_size,
                 "node_bindings": {}, "excluded_nodes": {}}
        assets.append(asset)
        for node_index, node in enumerate(document["nodes"]):
            if "mesh" not in node:
                continue
            base, side, clean = identity(node.get("name", ""))
            if re.search(r"\.[gji]$", base) or not base:
                asset["excluded_nodes"][str(node_index)] = "marcador del atlas, no estructura anatómica"
                continue
            key = normalize(clean)
            if key in groups and groups[key]["asset"] != kind:
                asset["excluded_nodes"][str(node_index)] = "estructura ya incluida desde otro GLB"
                continue
            if key not in groups:
                candidates = nomenclature.get(key, [])
                term = next((e for e in candidates if e["system"] == kind), candidates[0] if candidates else {})
                stem = reference_key(base)
                reference = clinical.get(stem + "_" + side) if stem and side != "midline" else clinical.get(stem)
                if reference is None and stem:
                    reference = clinical.get(stem + "_L") or clinical.get(stem + "_R")
                reference = copy.deepcopy(reference) if reference else None
                name, wiki = translated_name(base, reference)
                spanish = translations.get(base.casefold(), {})
                if name == base and spanish.get("spanish"):
                    name = spanish["spanish"]
                    wiki = name
                system, layer, subtype = category(base, kind, reference)
                region = region_of(base, term.get("path", []), reference)
                mesh_id = "real_" + uuid.uuid5(uuid.NAMESPACE_URL, "z-anatomy:" + key).hex
                aliases = [base, clean, name, spanish.get("spanish", ""), term.get("name_en", ""), term.get("ta2_latin", "")]
                if reference:
                    aliases += reference["aliases"]
                if base == "Hip bone":
                    aliases += ["pelvis", "ilion", "isquion", "pubis"]
                if base == "Patellar ligament":
                    reference = clinical.get("lig_patellar_" + side)
                if base == "Radial collateral ligament":
                    reference = clinical.get("lig_elbow_radial_" + side)
                if base == "Ulnar collateral ligament":
                    reference = clinical.get("lig_elbow_ulnar_" + side)
                pending = "Pendiente de revisión específica; consulta la nomenclatura y la referencia enciclopédica."
                record = {"Mesh_ID": mesh_id, "nombre": name + (" · " + SIDES[side] if side != "midline" else ""),
                    "short_name": name, "nombre_original": base, "original_nodes": [], "node_refs": [], "side": side,
                    "nombre_oficial_ta2": term.get("ta2_latin") or (reference or {}).get("nombre_oficial_ta2"),
                    "sistema": system, "sistema_label": SYSTEMS.get(system, "Dentición" if system == "diente" else "Otros tejidos"),
                    "region": REGIONS[region] + (" · " + SIDES[side] if side != "midline" else ""), "view_region": region, "capa": layer,
                    "subtype": subtype, "aliases": sorted(set(a for a in aliases if a)), "wikipedia_title": wiki,
                    "descripcion": f"{name}. Malla anatómica de Z-Anatomy / BodyParts3D. " +
                      ("Esta pieza representa una porción; las notas de estudio corresponden al músculo o ligamento de referencia completo." if base in PART_REFERENCES else ""),
                    "origen": (reference or {}).get("origen", "No aplica como origen muscular." if system == "hueso" else pending),
                    "insercion": (reference or {}).get("insercion", pending), "inervacion": (reference or {}).get("inervacion", pending),
                    "inserciones_articulaciones": (reference or {}).get("inserciones_articulaciones", pending),
                    "funcion": (reference or {}).get("funcion", pending), "revision": "notas_locales_pendientes_revision_docente",
                    "sources": [{"title": "Z-Anatomy · atlas y modelos", "url": "https://github.com/Z-Anatomy/Models-of-human-anatomy"},
                                {"title": "Nomenclatura del exportador Anatria3D · CC BY-SA 4.0", "url": "https://github.com/Nurkan1/Anatria-3D/tree/main/public/anatomy"}],
                    "nomenclature_path": term.get("path", [])}
                if spanish:
                    record["translation_source"] = "Español · TA2.csv distribuido por Z-Anatomy"
                    record["sources"].append({"title": "Z-Anatomy · columna Español del catálogo", "url": "https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/master/TA2.csv"})
                if reference:
                    record["sources"] += reference.get("sources", [])
                groups[key] = {"asset": kind, "record": record}
            record = groups[key]["record"]
            record["original_nodes"].append(node["name"])
            record["node_refs"].append({"asset": kind, "node": node_index})
            asset["node_bindings"][str(node_index)] = record["Mesh_ID"]
    records = [g["record"] for g in groups.values()]
    muscle_sections = study_metadata(records)
    records.sort(key=lambda s: (s["capa"] != "oseo", s["capa"] != "muscular", normalize(s["nombre"])))
    hierarchy = {}
    for record in records:
        hierarchy.setdefault(record["sistema"], {}).setdefault(record["region"], {}).setdefault(record["nombre"], []).append(record["Mesh_ID"])
    return {"schema_version": 1, "model": {"source": "z-anatomy-real", "url": None, "title": "Atlas anatómico real",
            "assets": sorted(assets, key=lambda a: ASSET_ORDER[a["key"]]), "regions": REGIONS,
            "counts": dict(Counter(r["sistema"] for r in records)),
            "muscle_sections": muscle_sections,
            "note": "Modelos reales: Z-Anatomy / BodyParts3D. Esqueleto y músculos: export JMK712. Articulaciones y nomenclatura: Anatria3D. CC BY-SA 4.0; notas locales pendientes de revisión docente.",
            "license": "CC BY-SA 4.0 · conservar atribuciones de cada asset",
            "default_layers": {"oseo": False, "muscular": True, "articular": False, "cartilago": False, "otro": False},
            "start_id": next(r["Mesh_ID"] for r in records if r["nombre_original"] == "Clavicle" and r["side"] == "L")},
            "structures": records, "hierarchy": hierarchy}
