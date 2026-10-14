"""Study regions from the atlas nomenclature; no geometric clipping or invented depth."""

SECTIONS = {
    "head": {"label": "Cabeza y cara", "region": "head_spine", "posterior": False},
    "neck": {"label": "Cuello", "region": "head_spine", "posterior": False},
    "thorax": {"label": "Tórax", "region": "thorax", "posterior": False},
    "abdomen": {"label": "Abdomen", "region": "thorax", "posterior": False},
    "back": {"label": "Espalda", "region": "head_spine", "posterior": True},
    "shoulder": {"label": "Hombro", "region": "upper", "posterior": False},
    "arm": {"label": "Brazo", "region": "upper", "posterior": False},
    "forearm": {"label": "Antebrazo", "region": "upper", "posterior": False},
    "hand": {"label": "Mano", "region": "upper", "posterior": False},
    "pelvis": {"label": "Pelvis y glúteos", "region": "lower", "posterior": True},
    "thigh": {"label": "Muslo", "region": "lower", "posterior": False},
    "leg": {"label": "Pierna", "region": "lower", "posterior": False},
    "foot": {"label": "Pie", "region": "lower", "posterior": False},
}

GROUPS = {
    "facial": "Expresión facial", "head_other": "Masticación, órbita y otros",
    "pharynx": "Faringe", "larynx": "Laringe", "neck_other": "Otros músculos del cuello",
    "thorax": "Pared torácica y diafragma", "abdomen": "Pared abdominal y región lumbar",
    "back_hypaxial": "Extrínsecos y otros dorsales", "erector": "Erectores de la columna",
    "transversospinal": "Transversoespinosos", "suboccipital": "Suboccipitales",
    "back_other": "Otros músculos intrínsecos", "deltoid": "Deltoides",
    "rotator_cuff": "Manguito rotador", "shoulder_other": "Otros músculos del hombro",
    "arm_anterior": "Compartimento anterior", "arm_posterior": "Compartimento posterior",
    "forearm_anterior": "Compartimento anterior", "forearm_posterior": "Compartimento posterior",
    "hand": "Músculos intrínsecos de la mano", "gluteal_superficial": "Grupo glúteo superficial",
    "gluteal_deep": "Grupo glúteo profundo", "iliopsoas": "Iliopsoas",
    "pelvic_floor": "Suelo pélvico", "thigh_anterior": "Compartimento anterior · cuádriceps y sartorio",
    "thigh_medial": "Compartimento medial · aductores", "thigh_posterior": "Compartimento posterior · isquiotibiales",
    "leg_anterior": "Compartimento anterior", "leg_lateral": "Compartimento lateral",
    "leg_posterior": "Compartimento posterior", "foot": "Músculos intrínsecos del pie",
}


def muscle_group(base, path):
    """Return one section/group for an intact mesh using source anatomical groups."""
    text = " / ".join(path).lower()
    name = base.lower().strip("()")
    if "muscles of head" in text:
        return "head", "facial" if "facial muscles" in text else "head_other"
    if "muscles of neck" in text:
        return "neck", "pharynx" if "pharyngeal" in text else "larynx" if "laryngeal" in text else "neck_other"
    if "dorsal part" in text:
        group = next((key for word, key in [("suboccipital", "suboccipital"), ("erector spinae", "erector"),
                     ("transversospinal", "transversospinal"), ("hypaxial", "back_hypaxial")] if word in text), "back_other")
        return "back", group
    if "abdominal part" in text:
        return "abdomen", "abdomen"
    if "thoracic part" in text or any(w in name for w in ("pectoralis", "intercostal", "diaphragm", "transversus thoracis", "serratus anterior", "subclavius")):
        return "thorax", "thorax"
    if "muscles of hand" in text:
        return "hand", "hand"
    if "compartment of forearm" in text:
        return "forearm", "forearm_anterior" if "anterior compartment" in text else "forearm_posterior"
    if "compartment of arm" in text:
        return "arm", "arm_anterior" if "anterior compartment" in text else "arm_posterior"
    if "scapulohumeral" in text or name == "teres major muscle":
        return "shoulder", "deltoid" if "deltoid" in text else "rotator_cuff" if "rotator cuff" in text else "shoulder_other"
    if "muscles of foot" in text or "of foot" in name:
        return "foot", "foot"
    if "compartment of leg" in text:
        return "leg", "leg_anterior" if "anterior compartment" in text else "leg_lateral" if "lateral compartment" in text else "leg_posterior"
    if "compartment of thigh" in text or name == "adductor minimus":
        return "thigh", "thigh_anterior" if "anterior compartment" in text else "thigh_posterior" if "posterior compartment" in text else "thigh_medial"
    if "gluteal muscles" in text:
        return "pelvis", "gluteal_deep" if "deep gluteal" in text else "gluteal_superficial"
    if name in ("iliacus muscle", "psoas major"):
        return "pelvis", "iliopsoas"
    if any(w in name for w in ("coccygeus", "pubo-analis", "anal sphincter")):
        return "pelvis", "pelvic_floor"
    if any(w in name for w in ("splenius", "interspinales", "levatores", "rhomboid")):
        return "back", "back_other"
    # New/unknown source terms stay unclassified instead of being assigned by height.
    return None, None


def study_metadata(records):
    sections = {key: {**value, "groups": {}, "count": 0} for key, value in SECTIONS.items()}
    for record in records:
        if record["capa"] != "muscular":
            continue
        section, group = muscle_group(record["nombre_original"], record["nomenclature_path"])
        record["study_section"] = section
        record["study_group"] = group
        if section:
            sections[section]["count"] += 1
            sections[section]["groups"][group] = GROUPS[group]
    return sections
