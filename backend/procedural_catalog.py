"""Anatomical catalogue + compact geometric recipes, generated ONLY in RAM.

Coordinates are schematic (Y superior, Z anterior; patient left = +X).
The adult skeleton's 206 bones are represented as 212 selectable segments:
sternum has 3 segments and each fused hip bone has 3 components.
This is an educational schematic, not patient-specific anatomy or a certified atlas.
"""
import math
from collections import Counter
from urllib.parse import quote

REGIONS = {
    "all": "Cuerpo Completo", "head_spine": "Cabeza y Columna", "thorax": "Tórax",
    "upper": "Miembro Superior", "lower": "Pelvis y Miembro Inferior",
}
LAYERS = {"hueso": "oseo", "ligamento": "articular", "musculo": "muscular", "cartilago": "cartilago"}
SYSTEMS = {"hueso": "Sistema óseo", "ligamento": "Sistema articular", "musculo": "Sistema muscular", "cartilago": "Cartílagos y discos"}


def ellipsoid(center, scale):
    return {"type": "ellipsoid", "center": center, "scale": scale}


def tube(points, radius=.055):
    return {"type": "tube", "points": points, "radius": radius}


def capsule(a, b, radius):
    return {"type": "capsule", "a": a, "b": b, "radius": radius}


def plate(outline, z, depth=.12):
    return {"type": "extrude", "outline": outline, "z": z, "depth": depth}


def muscle_shape(a, b, width, depth=None, curve=None):
    return {"type": "muscle", "a": a, "b": b, "width": width, "depth": depth or width * .65, "curve": curve}


def long_bone(a, b, radius, head=None, condyles=False):
    mid = [(a[i] + b[i]) / 2 for i in range(3)]
    mid[2] += radius * .3
    parts = [tube([a, mid, b], radius), ellipsoid(a, [radius * 1.4] * 3)]
    if condyles:
        parts += [ellipsoid([b[0] + dx, b[1], b[2]], [radius * 1.45, radius * 1.2, radius * 1.6])
                  for dx in [-radius * .9, radius * .9]]
    else:
        parts.append(ellipsoid(b, [radius * 1.35] * 3))
    if head:
        parts += [capsule(a, head, radius * .7), ellipsoid(head, [radius * 1.65] * 3)]
    return parts


def spine_z(y):
    return (.24 * math.exp(-((y - 10.7) / .8) ** 2)
            - .38 * math.exp(-((y - 12.9) / 1.1) ** 2)
            + .16 * math.exp(-((y - 15.2) / .5) ** 2))


def build_metadata():
    records = []

    def add(key, name, system, region, parts, side=None, wiki=None, aliases=(),
            origin=None, insertion=None, nerve=None, function=None, description=None,
            subtype=None, latin=None):
        marker, sign, side_label = side or ("", 1, "")
        mesh_id = key + ("_" + marker if marker else "")
        visible = name + (" · " + side_label if marker else "")
        is_bone = system == "hueso"
        origin = origin or ("No aplica como origen muscular; ver articulaciones y fijaciones." if is_bone else "Fijación proximal: consultar referencia específica.")
        insertion = insertion or ("Participa en articulaciones de esta región; fijaciones simplificadas en el esquema." if is_bone else "Fijación distal: consultar referencia específica.")
        nerve = nerve or ("No se asigna un nervio motor único a un hueso o cartílago; inervación regional sensitiva." if system in ("hueso", "cartilago") else "Inervación sensitiva regional; no es una estructura muscular motora.")
        title = wiki or name
        url = "https://es.wikipedia.org/wiki/" + quote(title.replace(" ", "_"))
        record = {"Mesh_ID": mesh_id, "nombre": visible, "short_name": name,
                  "nombre_oficial_ta2": latin, "sistema": system, "sistema_label": SYSTEMS[system],
                  "region": REGIONS[region] + (" · " + side_label if marker else ""),
                  "view_region": region, "capa": LAYERS[system], "side": marker or "midline",
                  "aliases": list(dict.fromkeys([name, *aliases, *([name + " " + side_label] if marker else [])])),
                  "origen": origin, "insercion": insertion, "inervacion": nerve,
                  "descripcion": description or f"{name}: estructura de {REGIONS[region].lower()} representada mediante geometría paramétrica simplificada.",
                  "inserciones_articulaciones": insertion if is_bone else f"Origen/fijación proximal: {origin} Inserción/fijación distal: {insertion}",
                  "funcion": function or ("Soporte, protección y palanca para el movimiento regional." if is_bone else "Estabilidad y transmisión de fuerzas en la región."),
                  "wikipedia_title": title, "sources": [{"title": title + " · Wikipedia en español", "url": url}],
                  "revision": "esquema_pendiente_revision_docente", "subtype": subtype,
                  "geometry": {"mirror": sign, "parts": parts}}
        records.append(record)
        return record

    sides = [("L", 1, "izquierdo"), ("R", -1, "derecho")]
    bone = lambda key, name, region, parts, **kw: add("bone_" + key, name, "hueso", region, parts, **kw)
    ligament = lambda key, name, region, parts, **kw: add("lig_" + key, name, "ligamento", region, parts, **kw)
    cartilage = lambda key, name, region, parts, **kw: add("cart_" + key, name, "cartilago", region, parts, **kw)

    # Vertebral loops: C1 has no body; C2 has dens; no C1-C2 intervertebral disc.
    spine = []
    for prefix, count, start, step, radius, label in [
        ("C", 7, 15.75, .19, .21, "cervical"), ("T", 12, 14.35, .235, .25, "torácica"),
        ("L", 5, 11.4, .32, .33, "lumbar")]:
        for i in range(1, count + 1):
            y = start - (i - 1) * step
            tag = f"{prefix}{i}"; z = spine_z(y)
            spine.append((tag, y, z, radius))
            name = f"Vértebra {label} {tag}"
            wiki = "Atlas (hueso)" if tag == "C1" else "Axis (hueso)" if tag == "C2" else f"Vértebra {label}"
            bone(tag, name, "head_spine", [{"type": "vertebra", "y": y, "z": z, "radius": radius,
                 "height": step * .63, "variant": "atlas" if tag == "C1" else "axis" if tag == "C2" else prefix}],
                 wiki=wiki, aliases=[tag, "atlas" if tag == "C1" else "axis" if tag == "C2" else tag],
                 insertion="Articulaciones intervertebrales; C1 y C2 participan en las articulaciones craneocervicales.",
                 function="Protege el canal vertebral y permite movilidad segmentaria.")
    bone("sacrum", "Sacro", "head_spine", [plate([[-.43, 9.8], [.43, 9.8], [.36, 9.35], [0, 8.88], [-.36, 9.35]], -.37, .25)],
         wiki="Sacro", insertion="Se articula con L5, ambos huesos coxales y cóccix.", function="Transmite cargas de la columna a la pelvis.")
    bone("coccyx", "Cóccix", "head_spine", [tube([[0, 8.9, -.27], [0, 8.66, -.19], [0, 8.5, -.08]], .08)], wiki="Cóccix")
    for upper, lower in zip(spine[1:], spine[2:] + [("S1", 9.78, -.22, .34)]):
        tag, y, z, r = upper; below, y2, z2, r2 = lower
        cartilage(f"disc_{tag}_{below}", f"Disco intervertebral {tag}–{below}", "head_spine",
                  [ellipsoid([0, (y + y2) / 2, (z + z2) / 2], [r * 1.05, (y - y2) * .2, r * .8])],
                  wiki="Disco intervertebral", aliases=[f"disco {tag} {below}"],
                  origin=f"Platillo inferior de {tag}.", insertion=f"Platillo superior de {below}.",
                  function="Distribución de cargas y movilidad entre cuerpos vertebrales.")
    points = [[0, y, z] for _, y, z, _ in spine] + [[0, 9.5, -.25]]
    ligament("longitudinal_anterior", "Ligamento longitudinal anterior", "head_spine",
             [tube([[x, y, z + .21] for x, y, z in points], .045)], wiki="Ligamento longitudinal anterior",
             origin="Región basilar del occipital y atlas.", insertion="Cara anterior de cuerpos y discos hasta el sacro.", function="Limita la extensión vertebral.")
    ligament("longitudinal_posterior", "Ligamento longitudinal posterior", "head_spine",
             [tube([[x, y, z - .2] for x, y, z in points[1:]], .035)], wiki="Ligamento longitudinal posterior",
             origin="Axis; continuación craneal por la membrana tectoria.", insertion="Cara posterior de cuerpos vertebrales dentro del canal hasta el sacro.", function="Contribuye a limitar flexión y desplazamiento posterior discal.")
    ligament("supraspinous", "Ligamento supraespinoso", "head_spine",
             [tube([[0, y, z - .68] for _, y, z, _ in spine[6:]] + [[0, 9.5, -.65]], .045)], wiki="Ligamento supraespinoso",
             origin="Apófisis espinosa de C7.", insertion="Extremos de apófisis espinosas hasta sacro.", function="Limita flexión de la columna.")
    ligament("nuchal", "Ligamento nucal", "head_spine", [tube([[0, 16.1, -.5], [0, 15.5, -.65], [0, 14.6, -.64]], .055)],
             wiki="Ligamento nucal", origin="Occipital.", insertion="Apófisis espinosas cervicales, especialmente C7.", function="Sostén cervical y límite de flexión.")
    for a, b in zip(spine[6:-1], spine[7:]):
        ligament(f"interspinous_{a[0]}_{b[0]}", f"Ligamento interespinoso {a[0]}–{b[0]}", "head_spine",
                 [tube([[0, a[1], a[2] - .55], [0, b[1], b[2] - .55]], .025)], wiki="Ligamento interespinoso",
                 origin=f"Apófisis espinosa de {a[0]}.", insertion=f"Apófisis espinosa de {b[0]}.", function="Contribuye a limitar flexión vertebral.")

    # Thorax: 12 bilateral ribs, only 1-10 have separate anterior costal cartilage.
    for key, name, outline in [
        ("manubrium", "Manubrio del esternón", [[-.24, 14.65], [.24, 14.65], [.22, 14.08], [-.22, 14.08]]),
        ("sternal_body", "Cuerpo del esternón", [[-.16, 14.08], [.16, 14.08], [.15, 12.7], [-.15, 12.7]]),
        ("xiphoid", "Apófisis xifoides", [[-.12, 12.7], [.12, 12.7], [0, 12.35]])]:
        bone(key, name, "thorax", [plate(outline, .95, .13)], wiki="Esternón", aliases=["esternón", "sternum"],
             insertion="Articulación con clavículas y cartílagos costales según el segmento.", function="Protección anterior del tórax y anclaje costal.")
    for side in sides:
        for i in range(1, 13):
            y = 14.35 - (i - 1) * .235
            width = 1.15 + .6 * math.sin((i - 1) / 12 * math.pi)
            if i > 10: width -= .3 + (i - 11) * .14
            points = [[.18, y, spine_z(y)], [.65, y + .03, -.72], [width * .9, y - .08, -.55],
                      [width, y - .25, .08], [width * .87, y - .43, .72]]
            if i <= 10: points.append([.52 if i <= 7 else .75, y - .45, .97])
            category = "verdadera" if i <= 7 else "falsa" if i <= 10 else "flotante"
            bone(f"rib_{i:02}", f"Costilla {i}", "thorax", [tube(points, .058 if i > 2 else .064)], side=side,
                 wiki="Costilla", aliases=[f"costilla {i} {category}", f"rib {i}"], subtype=category,
                 insertion="Vértebras torácicas; unión esternal directa, indirecta o ausente según el grupo.",
                 function="Protección torácica y participación en la mecánica respiratoria.",
                 description=f"Costilla {i}: {category}. " + ("Sin unión anterior al esternón." if i > 10 else "Unión anterior por cartílago costal."))
            if i <= 10:
                end = [.17, y - .29, 1.01] if i <= 7 else [.42 + (i - 8) * .1, y - .19, .99]
                cartilage(f"costal_{i:02}", f"Cartílago costal {i}", "thorax",
                          [tube([points[-1], [(.52 + end[0]) / 2, y - .34, 1.03], end], .058)], side=side,
                          wiki="Cartílago costal", origin=f"Extremo anterior de costilla {i}.",
                          insertion="Esternón." if i <= 7 else "Cartílago de la costilla superior: arco costal.", function="Elasticidad de la pared torácica.")

    # Skull shell patches leave schematic orbital spaces; small facial/ear bones are selectable.
    shell = lambda theta, phi: {"type": "shell", "center": [0, 16.85, -.02], "scale": [.82, .99, .8], "theta": theta, "phi": phi}
    bone("frontal", "Frontal", "head_spine", [shell([.08, 1.33], [.54, 2.6])], wiki="Hueso frontal")
    bone("occipital", "Occipital", "head_spine", [shell([.3, 2.04], [3.42, 6.03])], wiki="Hueso occipital")
    bone("sphenoid", "Esfenoides", "head_spine", [ellipsoid([0, 16.47, .06], [.6, .16, .31]),
         plate([[-.48, 16.55], [.48, 16.55], [.25, 16.24], [-.25, 16.24]], -.02)], wiki="Hueso esfenoides")
    bone("ethmoid", "Etmoides", "head_spine", [ellipsoid([0, 16.44, .54], [.12, .22, .13])], wiki="Hueso etmoides")
    bone("vomer", "Vómer", "head_spine", [plate([[-.04, 16.35], [.04, 16.35], [.04, 16.05], [-.04, 16.05]], .62, .08)], wiki="Vómer")
    bone("mandible", "Mandíbula", "head_spine", [tube([[-.6, 16.14, .11], [-.54, 15.74, .47], [-.3, 15.65, .76],
         [0, 15.64, .83], [.3, 15.65, .76], [.54, 15.74, .47], [.6, 16.14, .11]], .095),
         ellipsoid([-.6, 16.16, .1], [.12, .08, .13]), ellipsoid([.6, 16.16, .1], [.12, .08, .13])],
         wiki="Mandíbula", insertion="Articulación temporomandibular bilateral.", function="Sostiene dentición inferior y participa en masticación.")
    bone("hyoid", "Hueso hioides", "head_spine", [tube([[-.27, 15.3, .21], [-.22, 15.23, .5], [0, 15.2, .62], [.22, 15.23, .5], [.27, 15.3, .21]], .045)],
         wiki="Hueso hioides", insertion="Suspensión muscular y ligamentaria; no articula directamente con otros huesos.", function="Anclaje para lengua y musculatura de deglución.")
    for side in sides:
        bone("parietal", "Parietal", "head_spine", [shell([.03, 1.4], [-.32, .54]), shell([.03, 1.4], [5.74, 6.25])], side=side, wiki="Hueso parietal")
        bone("temporal", "Temporal", "head_spine", [ellipsoid([.71, 16.49, -.11], [.14, .32, .45]), tube([[.61, 16.42, .05], [.47, 16.37, .56]], .06)], side=side, wiki="Hueso temporal")
        bone("maxilla", "Maxilar", "head_spine", [plate([[.04, 16.25], [.43, 16.25], [.47, 15.95], [.03, 15.95]], .63, .14)], side=side, wiki="Maxilar superior", aliases=["maxilar superior"])
        bone("zygomatic", "Cigomático", "head_spine", [ellipsoid([.57, 16.3, .53], [.18, .14, .15])], side=side, wiki="Hueso cigomático", aliases=["malar"])
        bone("nasal", "Nasal", "head_spine", [ellipsoid([.08, 16.37, .79], [.06, .18, .05])], side=side, wiki="Hueso nasal")
        bone("lacrimal", "Lagrimal", "head_spine", [ellipsoid([.2, 16.42, .64], [.045, .1, .05])], side=side, wiki="Hueso lagrimal")
        bone("palatine", "Palatino", "head_spine", [ellipsoid([.17, 16.02, .37], [.15, .05, .2])], side=side, wiki="Hueso palatino")
        bone("inferior_concha", "Cornete nasal inferior", "head_spine", [tube([[.12, 16.15, .5], [.16, 16.21, .63], [.17, 16.28, .58]], .035)], side=side, wiki="Cornete inferior")
        for j, (key, name, wiki) in enumerate([("malleus", "Martillo", "Martillo (hueso)"), ("incus", "Yunque", "Yunque (hueso)"), ("stapes", "Estribo", "Estribo (hueso)")]):
            bone(key, name, "head_spine", [capsule([.66, 16.47 + j * .06, -.09], [.72, 16.52 + j * .06, -.04], .022)], side=side, wiki=wiki, function="Transmisión mecánica del sonido en oído medio.")
        ligament("stylomandibular", "Ligamento estilomandibular", "head_spine", [tube([[.61, 16.34, .03], [.57, 15.77, .25]], .025)], side=side,
                 wiki="Ligamento estilomandibular", origin="Apófisis estiloides temporal.", insertion="Ángulo y borde posterior mandibular.", function="Refuerzo fascial de la región mandibular.")

    # Upper/lower limbs: the same canonical right-half recipe is mirrored in X.
    for side in sides:
        bone("clavicle", "Clavícula", "upper", [tube([[.18, 14.62, .84], [.76, 14.58, .93], [1.38, 14.55, .58], [2.02, 14.49, .27]], .085)],
             side=side, wiki="Clavícula", latin="Clavicula", insertion="Esternón medialmente y acromion lateralmente.")
        bone("scapula", "Escápula", "upper", [plate([[.69, 14.4], [1.83, 14.57], [2.12, 14.13], [1.19, 12.94]], -.65, .13),
             tube([[.83, 14.08, -.64], [1.6, 14.34, -.73], [2.12, 14.52, -.03]], .095),
             tube([[1.98, 14.27, -.36], [2.01, 14.45, .18], [1.85, 14.37, .35]], .07)], side=side, wiki="Escápula", aliases=["omóplato", "acromion", "apófisis coracoides"],
             insertion="Cavidad glenoidea con húmero y acromion con clavícula.")
        bone("humerus", "Húmero", "upper", long_bone([2.18, 14.12, 0], [2.58, 10.66, .04], .13, head=[2.03, 14.24, .01], condyles=True), side=side, wiki="Húmero", insertion="Escápula, radio y ulna.")
        bone("radius", "Radio", "upper", long_bone([2.75, 10.49, .08], [3.09, 7.81, .16], .074), side=side, wiki="Radio (hueso)", insertion="Húmero, ulna y carpo; posición lateral en postura anatómica.")
        bone("ulna", "Cúbito (ulna)", "upper", long_bone([2.5, 10.53, .03], [2.85, 7.78, .15], .072) + [ellipsoid([2.48, 10.7, -.03], [.12, .19, .13])],
             side=side, wiki="Cúbito", aliases=["ulna", "cúbito"], insertion="Húmero y radio; el olécranon forma la prominencia posterior del codo.")
        carpals = [("scaphoid", "Escafoides", 0, 0), ("lunate", "Semilunar", 1, 0), ("triquetrum", "Piramidal", 2, 0), ("pisiform", "Pisiforme", 2, .35),
                   ("trapezium", "Trapecio del carpo", 0, 1), ("trapezoid", "Trapezoide", 1, 1), ("capitate", "Grande", 2, 1), ("hamate", "Ganchoso", 3, 1)]
        for key, name, col, row in carpals:
            x = 3.13 - col * .105
            bone("carpal_" + key, name, "upper", [ellipsoid([x, 7.66 - row * .16, .17 + (.11 if key == "pisiform" else 0)], [.066, .085, .075])],
                 side=side, wiki="Hueso " + ("trapecio" if key == "trapezium" else name.lower()), aliases=["carpo", "carpiano " + name])
        for digit in range(1, 6):
            x = 3.37 - (digit - 1) * .15
            start = [x, 7.46, .18]; end = [x + (.08 if digit == 1 else 0), 6.94 if digit > 1 else 7.15, .21]
            bone(f"metacarpal_{digit}", f"Metacarpiano {digit}", "upper", long_bone(start, end, .038), side=side, wiki="Metacarpiano", aliases=[f"metacarpiano {digit}"])
            cursor = end
            lengths = [.22, .19] if digit == 1 else [.27, .19, .15]
            labels = ["proximal", "distal"] if digit == 1 else ["proximal", "media", "distal"]
            for label, length in zip(labels, lengths):
                target = [cursor[0] + (.09 if digit == 1 else 0), cursor[1] - length - .035, cursor[2]]
                bone(f"hand_phalanx_{digit}_{label}", f"Falange {label} de mano · dedo {digit}", "upper", long_bone(cursor, target, .026), side=side,
                     wiki="Falange (anatomía)", aliases=[f"falange mano dedo {digit} {label}", "pulgar" if digit == 1 else f"dedo {digit}"])
                cursor = [target[0], target[1] - .025, target[2]]

        bone("ilium", "Ilion", "lower", [plate([[.25, 9.79], [.71, 10.03], [1.43, 9.95], [1.67, 9.55], [1.22, 8.9], [.57, 8.87]], -.19, .28)],
             side=side, wiki="Ilion", aliases=["hueso coxal", "pelvis"], insertion="Componente superior del hueso coxal fusionado en adulto; articulación sacroilíaca.")
        bone("ischium", "Isquion", "lower", [tube([[1.08, 8.93, -.04], [1.06, 8.35, -.32], [.56, 8.1, -.15], [.23, 8.5, .41]], .13)],
             side=side, wiki="Isquion", aliases=["hueso coxal"], insertion="Componente posteroinferior del hueso coxal; aporta al acetábulo.")
        bone("pubis", "Pubis", "lower", [plate([[.05, 8.56], [.26, 8.73], [1.08, 8.89], [.73, 8.67], [.25, 8.36], [.06, 8.35]], .29, .16)],
             side=side, wiki="Pubis", aliases=["hueso coxal"], insertion="Componente anterior del hueso coxal; sínfisis con el pubis contralateral.")
        bone("femur", "Fémur", "lower", long_bone([1.03, 8.74, -.02], [.8, 4.98, .08], .145, head=[.69, 8.93, -.03], condyles=True)
             + [ellipsoid([1.14, 8.72, -.08], [.19, .23, .18]), ellipsoid([.92, 8.43, -.14], [.1, .13, .1])],
             side=side, wiki="Fémur", latin="Femur", insertion="Cabeza en acetábulo; cóndilos con tibia y superficie patelar con rótula.")
        bone("patella", "Rótula", "lower", [ellipsoid([.8, 4.96, .39], [.18, .24, .095])], side=side, wiki="Rótula", latin="Patella", aliases=["patela", "patella"], function="Mejora el brazo de palanca del aparato extensor de rodilla.")
        bone("tibia", "Tibia", "lower", long_bone([.8, 4.67, .06], [.72, 1.09, .02], .12, condyles=False)
             + [ellipsoid([.8, 4.73, .04], [.28, .13, .22]), ellipsoid([.72, 1.03, .02], [.18, .14, .17]), ellipsoid([.8, 4.34, .21], [.1, .15, .08])],
             side=side, wiki="Tibia", insertion="Fémur, fíbula y astrágalo; hueso medial portante de la pierna.")
        bone("fibula", "Peroné (fíbula)", "lower", long_bone([1.07, 4.55, -.02], [1.01, .91, -.03], .053),
             side=side, wiki="Peroné", aliases=["fíbula", "fibula", "peroné"], insertion="Tibia y astrágalo; su maléolo lateral estabiliza el tobillo.")
        tarsals = [("talus", "Astrágalo", [.76, .9, .16], [.2, .16, .23]),
                   ("calcaneus", "Calcáneo", [.79, .43, -.09], [.22, .2, .38]),
                   ("navicular", "Navicular del pie", [.66, .66, .51], [.17, .12, .14]),
                   ("cuboid", "Cuboides", [.99, .49, .53], [.15, .12, .2]),
                   ("medial_cuneiform", "Cuneiforme medial", [.55, .57, .72], [.1, .1, .16]),
                   ("intermediate_cuneiform", "Cuneiforme intermedio", [.72, .54, .75], [.09, .09, .13]),
                   ("lateral_cuneiform", "Cuneiforme lateral", [.86, .53, .74], [.09, .09, .14])]
        for key, name, center, scale in tarsals:
            bone("tarsal_" + key, name, "lower", [ellipsoid(center, scale)], side=side,
                 wiki="Hueso navicular" if key == "navicular" else "Huesos cuneiformes" if "cuneiform" in key else name,
                 aliases=["tarso", "talo" if key == "talus" else name, "escafoides tarsiano" if key == "navicular" else name])
        for digit in range(1, 6):
            x = .49 + (digit - 1) * .14
            start = [x, .45, .85]; end = [x - .035, .31, 1.4 - (digit - 1) * .055]
            bone(f"metatarsal_{digit}", f"Metatarsiano {digit}", "lower", long_bone(start, end, .038), side=side, wiki="Metatarsiano")
            cursor = end
            labels = ["proximal", "distal"] if digit == 1 else ["proximal", "media", "distal"]
            for j, label in enumerate(labels):
                length = (.21 if digit == 1 else .14) * (1 - j * .15)
                target = [cursor[0], .28, cursor[2] + length]
                bone(f"foot_phalanx_{digit}_{label}", f"Falange {label} de pie · dedo {digit}", "lower", long_bone(cursor, target, .027), side=side,
                     wiki="Falange (anatomía)", aliases=[f"falange pie dedo {digit} {label}", "hallux" if digit == 1 else f"dedo pie {digit}"])
                cursor = [target[0], target[1], target[2] + .025]
        for label, x in [("medial", .68), ("lateral", .95)]:
            cartilage("meniscus_" + label, "Menisco " + label, "lower", [ellipsoid([x, 4.78, .06], [.13, .035, .18])],
                      side=side, wiki="Menisco (anatomía)", origin="Meseta tibial y fijaciones capsulares.", insertion="Cuernos meniscales en áreas intercondíleas tibiales.", function="Distribuye carga en la articulación de la rodilla.")
    cartilage("pubic_symphysis", "Sínfisis púbica", "lower", [ellipsoid([0, 8.49, .4], [.075, .17, .11])],
              wiki="Sínfisis del pubis", origin="Cara sinfisaria de un pubis.", insertion="Cara sinfisaria del pubis opuesto.", function="Unión fibrocartilaginosa anterior de la pelvis.")

    # Anchors are geometric approximations. Medical attachment text stays distinct from coordinates.
    ligament_specs = [
        ("acromioclavicular", "Ligamento acromioclavicular", "upper", [2, 14.52, .2], [2.13, 14.51, -.03], "Extremo acromial de clavícula.", "Acromion.", "Estabilidad acromioclavicular.", None),
        ("coracoclavicular", "Ligamento coracoclavicular", "upper", [1.85, 14.54, .47], [1.91, 14.37, .3], "Cara inferior de clavícula.", "Apófisis coracoides (porciones conoide y trapezoide).", "Suspende la escápula y estabiliza la cintura escapular.", None),
        ("elbow_ulnar", "Ligamento colateral ulnar del codo", "upper", [2.4, 10.75, .1], [2.45, 10.34, .05], "Epicóndilo medial humeral.", "Ulna: coronoides y olécranon según fascículo.", "Resiste el valgo del codo.", "Ligamento colateral cubital"),
        ("elbow_radial", "Ligamento colateral radial del codo", "upper", [2.79, 10.73, .04], [2.83, 10.38, .04], "Epicóndilo lateral humeral.", "Ligamento anular y región lateral de ulna.", "Estabilidad lateral del codo.", "Ligamento colateral radial"),
        ("iliofemoral", "Ligamento iliofemoral", "lower", [.71, 9.2, .28], [1.04, 8.58, .23], "Espina ilíaca anteroinferior y reborde acetabular.", "Línea intertrocantérica femoral.", "Limita extensión de cadera.", None),
        ("inguinal", "Ligamento inguinal", "lower", [1.42, 9.46, .26], [.19, 8.64, .52], "Espina ilíaca anterosuperior.", "Tubérculo del pubis.", "Límite inferior del canal inguinal y referencia regional.", None),
        ("acl", "Ligamento cruzado anterior", "lower", [.72, 4.73, .19], [.92, 5.03, -.08], "Área intercondílea anterior tibial.", "Cara medial del cóndilo lateral femoral.", "Limita traslación anterior de tibia respecto de fémur.", None),
        ("pcl", "Ligamento cruzado posterior", "lower", [.89, 4.71, -.14], [.66, 5.04, .14], "Área intercondílea posterior tibial.", "Cara lateral del cóndilo medial femoral.", "Limita traslación posterior de tibia.", None),
        ("knee_tibial", "Ligamento colateral tibial", "lower", [.53, 5.1, .06], [.54, 4.44, .07], "Epicóndilo medial femoral.", "Cara medial de tibia; conexiones capsulares y meniscales.", "Resiste valgo de rodilla.", None),
        ("knee_fibular", "Ligamento colateral fibular", "lower", [1.08, 5.1, .02], [1.09, 4.55, -.02], "Epicóndilo lateral femoral.", "Cabeza de fíbula.", "Resiste varo de rodilla.", None),
        ("patellar", "Ligamento patelar", "lower", [.8, 4.74, .39], [.8, 4.35, .28], "Ápice y borde inferior de rótula.", "Tuberosidad tibial.", "Transmite fuerza del cuádriceps a tibia.", "Ligamento rotuliano"),
        ("achilles", "Tendón calcáneo (Aquiles)", "lower", [.88, 2.1, -.39], [.81, .56, -.38], "Confluencia de gastrocnemio y sóleo.", "Tuberosidad posterior del calcáneo.", "Transmite fuerza de flexión plantar; es un tendón, no un ligamento.", "Tendón de Aquiles"),
    ]
    for side in sides:
        for key, name, region, a, b, origin, insertion, function, wiki in ligament_specs:
            aliases = ["LCA", "ACL"] if key == "acl" else ["LCP", "PCL"] if key == "pcl" else ["Aquiles", "tendón calcáneo"] if key == "achilles" else ["ligamento rotuliano"] if key == "patellar" else []
            ligament(key, name, region, [tube([a, [(a[i] + b[i]) / 2 for i in range(3)], b], .04 if key != "achilles" else .075)],
                     side=side, wiki=wiki, aliases=aliases, origin=origin, insertion=insertion, function=function,
                     subtype="tendon" if key == "achilles" else "ligament")

    # Muscle table: key, name, region, origin-anchor, insertion-anchor, width, depth,
    # anatomical origin, insertion, innervation, function, wiki title override.
    muscle_specs = [
        ("masseter", "Masetero", "head_spine", [.6, 16.31, .45], [.53, 15.79, .4], .16, .11, "Arco cigomático.", "Cara lateral de rama y ángulo mandibular.", "Nervio masetérico (V3).", "Eleva la mandíbula.", None),
        ("temporalis", "Temporal", "head_spine", [.76, 16.85, .07], [.48, 16.02, .41], .22, .11, "Fosa y fascia temporales.", "Apófisis coronoides mandibular.", "Nervios temporales profundos (V3).", "Elevación y retrusión mandibular.", None),
        ("scm", "Esternocleidomastoideo", "head_spine", [.63, 16.16, -.15], [.35, 14.66, .83], .13, .1, "Manubrio esternal y tercio medial de clavícula.", "Apófisis mastoides y línea nucal superior.", "Nervio accesorio (XI), aportes cervicales C2–C3.", "Flexión cervical bilateral y rotación contralateral unilateral.", None),
        ("trapezius", "Trapecio", "head_spine", [.09, 15.94, -.78], [1.9, 14.22, -.77], .38, .12, "Occipital, ligamento nucal y apófisis espinosas C7–T12.", "Clavícula lateral, acromion y espina escapular.", "Nervio accesorio (XI); C3–C4 sensitivos.", "Eleva, retrae y rota superiormente la escápula según fibras.", None),
        ("deltoid", "Deltoides", "upper", [2.14, 14.5, .1], [2.37, 12.94, .18], .37, .31, "Clavícula lateral, acromion y espina escapular.", "Tuberosidad deltoidea humeral.", "Nervio axilar (C5–C6).", "Abducción de hombro; fibras anteriores/posteriores flexionan/extienden.", None),
        ("biceps", "Bíceps braquial", "upper", [2.24, 13.55, .3], [2.7, 10.39, .26], .24, .2, "Tubérculo supraglenoideo y apófisis coracoides escapular.", "Tuberosidad radial y aponeurosis bicipital.", "Nervio musculocutáneo (C5–C6).", "Supinación del antebrazo y flexión del codo.", None),
        ("triceps", "Tríceps braquial", "upper", [2.18, 13.8, -.31], [2.49, 10.62, -.2], .27, .22, "Tubérculo infraglenoideo y caras posteriores humerales.", "Olécranon ulnar.", "Nervio radial (C6–C8). ", "Extiende el codo; cabeza larga contribuye en hombro.", None),
        ("pectoralis", "Pectoral mayor", "thorax", [.2, 13.87, 1.11], [2.22, 13.62, .31], .47, .14, "Clavícula medial, esternón, cartílagos costales y aponeurosis abdominal.", "Labio lateral del surco intertubercular humeral.", "Nervios pectorales lateral y medial (C5–T1).", "Aducción y rotación medial del húmero.", None),
        ("latissimus", "Dorsal ancho", "thorax", [.47, 10.69, -.6], [2.2, 13.46, -.19], .43, .15, "Columna torácica inferior, fascia toracolumbar, cresta ilíaca y costillas inferiores.", "Suelo del surco intertubercular humeral.", "Nervio toracodorsal (C6–C8).", "Extensión, aducción y rotación medial humeral.", None),
        ("brachioradialis", "Braquiorradial", "upper", [2.85, 11.13, .23], [3.09, 8.06, .27], .16, .13, "Cresta supracondílea lateral humeral.", "Radio distal próximo a estiloides.", "Nervio radial (C5–C6).", "Flexión del codo, especialmente en posición neutra.", None),
        ("supraspinatus", "Supraespinoso", "upper", [1.29, 14.43, -.78], [2.2, 14.17, .1], .16, .11, "Fosa supraespinosa escapular.", "Faceta superior del tubérculo mayor humeral.", "Nervio supraescapular (C5–C6).", "Inicia abducción y estabiliza cabeza humeral.", None),
        ("infraspinatus", "Infraespinoso", "upper", [1.19, 13.6, -.8], [2.25, 14.03, -.23], .27, .12, "Fosa infraespinosa escapular.", "Faceta media del tubérculo mayor humeral.", "Nervio supraescapular (C5–C6).", "Rotación lateral y estabilidad humeral.", None),
        ("subscapularis", "Subescapular", "upper", [1.21, 13.62, -.37], [2.07, 14.02, .22], .25, .11, "Fosa subescapular.", "Tubérculo menor humeral.", "Nervios subescapulares (C5–C6).", "Rotación medial y estabilidad humeral.", None),
        ("teres_minor", "Redondo menor", "upper", [1.62, 13.37, -.68], [2.27, 13.95, -.24], .12, .09, "Borde lateral escapular.", "Faceta inferior del tubérculo mayor humeral.", "Nervio axilar (C5–C6).", "Rotación lateral y estabilidad humeral.", None),
        ("gluteus_maximus", "Glúteo mayor", "lower", [1.01, 9.57, -.62], [1.21, 8.24, -.39], .54, .32, "Ilion posterior, sacro, cóccix y ligamento sacrotuberoso.", "Tracto iliotibial y tuberosidad glútea femoral.", "Nervio glúteo inferior (L5–S2).", "Extiende y rota lateralmente la cadera.", None),
        ("gluteus_medius", "Glúteo medio", "lower", [1.35, 9.69, -.11], [1.24, 8.71, -.12], .39, .22, "Cara externa del ilion entre líneas glúteas anterior y posterior.", "Cara lateral del trocánter mayor.", "Nervio glúteo superior (L4–S1).", "Abduce cadera y estabiliza pelvis durante apoyo unipodal.", None),
        ("rectus_femoris", "Recto femoral", "lower", [.95, 9.17, .44], [.8, 5.28, .42], .28, .22, "Espina ilíaca anteroinferior y región supraacetabular.", "Rótula por tendón cuadricipital y tibia por ligamento patelar.", "Nervio femoral (L2–L4).", "Extiende rodilla y flexiona cadera.", None),
        ("vastus_lateralis", "Vasto lateral", "lower", [1.31, 8.47, .1], [1.01, 5.27, .31], .32, .23, "Trocánter mayor y labio lateral de línea áspera.", "Rótula y tuberosidad tibial mediante aparato extensor.", "Nervio femoral (L2–L4).", "Extiende la rodilla.", None),
        ("vastus_medialis", "Vasto medial", "lower", [.69, 8.15, .17], [.59, 5.3, .29], .26, .22, "Línea intertrocantérica y labio medial de línea áspera.", "Rótula y tuberosidad tibial mediante aparato extensor.", "Nervio femoral (L2–L4).", "Extensión de rodilla y control patelar medial.", None),
        ("vastus_intermedius", "Vasto intermedio", "lower", [1.03, 8.31, .19], [.8, 5.28, .27], .23, .15, "Caras anterior y lateral del cuerpo femoral.", "Rótula y tuberosidad tibial mediante aparato extensor.", "Nervio femoral (L2–L4).", "Extiende la rodilla; profundo al recto femoral.", None),
        ("biceps_femoris", "Bíceps femoral", "lower", [1.1, 8.28, -.4], [1.11, 4.61, -.18], .25, .19, "Tuberosidad isquiática (cabeza larga), línea áspera y línea supracondílea (corta). ", "Cabeza de fíbula.", "Nervio ciático: división tibial (larga) y fibular común (corta).", "Flexiona rodilla; cabeza larga extiende cadera.", None),
        ("semitendinosus", "Semitendinoso", "lower", [.72, 8.27, -.47], [.58, 4.41, -.03], .16, .14, "Tuberosidad isquiática.", "Tibia medial proximal (pata de ganso).", "División tibial del nervio ciático (L5–S2).", "Extiende cadera y flexiona rodilla con rotación medial.", None),
        ("semimembranosus", "Semimembranoso", "lower", [.65, 8.3, -.3], [.58, 4.65, -.19], .21, .17, "Tuberosidad isquiática.", "Cóndilo medial tibial, cara posterior.", "División tibial del nervio ciático (L5–S2).", "Extiende cadera y flexiona rodilla con rotación medial.", None),
        ("sartorius", "Sartorio", "lower", [1.46, 9.51, .36], [.55, 4.39, .2], .085, .065, "Espina ilíaca anterosuperior.", "Tibia medial proximal (pata de ganso).", "Nervio femoral (L2–L3).", "Flexiona, abduce y rota lateralmente cadera; flexiona rodilla.", None),
        ("gastrocnemius_medial", "Gastrocnemio · cabeza medial", "lower", [.65, 4.94, -.29], [.8, 2.1, -.39], .24, .22, "Región posterior del cóndilo medial femoral.", "Calcáneo mediante tendón calcáneo.", "Nervio tibial (S1–S2).", "Flexión plantar y contribución a flexión de rodilla.", "Músculo gastrocnemio"),
        ("gastrocnemius_lateral", "Gastrocnemio · cabeza lateral", "lower", [1.03, 4.94, -.27], [.9, 2.1, -.4], .22, .21, "Región posterior del cóndilo lateral femoral.", "Calcáneo mediante tendón calcáneo.", "Nervio tibial (S1–S2).", "Flexión plantar y contribución a flexión de rodilla.", "Músculo gastrocnemio"),
        ("soleus", "Sóleo", "lower", [.89, 4.1, -.18], [.86, 1.52, -.27], .27, .17, "Tibia posterior (línea del sóleo), cabeza y cuerpo proximal de fíbula.", "Calcáneo mediante tendón calcáneo.", "Nervio tibial (S1–S2).", "Flexión plantar y sostén postural.", None),
        ("tibialis_anterior", "Tibial anterior", "lower", [.77, 4.26, .29], [.59, .8, .42], .17, .15, "Cóndilo lateral y tibia lateral proximal, membrana interósea.", "Cuneiforme medial y base del primer metatarsiano.", "Nervio fibular profundo (L4–L5).", "Dorsiflexión e inversión del pie.", None),
        ("rectus_abdominis", "Recto del abdomen", "thorax", [.26, 12.35, 1.02], [.18, 8.83, .67], .26, .13, "Cresta y sínfisis púbicas.", "Apófisis xifoides y cartílagos costales 5–7.", "Nervios toracoabdominales (T7–T12).", "Flexiona tronco y comprime contenido abdominal.", "Músculo recto abdominal"),
        ("external_oblique", "Oblicuo externo del abdomen", "thorax", [1.45, 11.96, .65], [.96, 9.74, .63], .34, .12, "Caras externas de costillas 5–12.", "Línea alba, tubérculo púbico y cresta ilíaca anterior.", "Nervios toracoabdominales y subcostal (T7–T12).", "Compresión abdominal y rotación contralateral del tronco.", "Músculo oblicuo externo del abdomen"),
        ("erector_spinae", "Erectores de la columna (grupo)", "head_spine", [.4, 9.86, -.59], [.42, 14.29, -.83], .17, .15, "Sacro, cresta ilíaca y apófisis espinosas lumbares.", "Costillas y apófisis vertebrales según fascículo.", "Ramos posteriores de nervios espinales.", "Extensión y estabilización vertebral; grupo simplificado.", "Músculo erector de la columna"),
        ("adductor_longus", "Aductor largo", "lower", [.25, 8.71, .57], [.66, 6.22, .22], .24, .17, "Cuerpo del pubis.", "Tercio medio de línea áspera femoral.", "Nervio obturador (L2–L4).", "Aducción de cadera.", None),
        ("iliopsoas", "Iliopsoas (grupo)", "lower", [.54, 11.01, .41], [.87, 8.4, .2], .2, .16, "Psoas: columna T12–L5; ilíaco: fosa ilíaca.", "Trocánter menor femoral.", "Psoas: ramos L1–L3; ilíaco: nervio femoral L2–L3.", "Flexión de cadera; dos músculos agrupados en el esquema.", "Músculo iliopsoas"),
    ]
    for side in sides:
        for key, name, region, a, b, width, depth, origin, insertion, nerve, function, wiki in muscle_specs:
            aliases = [name]
            if key.startswith("vastus") or key == "rectus_femoris": aliases += ["cuádriceps", "quadriceps"]
            if key in ("biceps_femoris", "semitendinosus", "semimembranosus"): aliases += ["isquiotibiales", "hamstrings"]
            if key in ("supraspinatus", "infraspinatus", "subscapularis", "teres_minor"): aliases += ["manguito rotador"]
            if key.startswith("gastrocnemius"): aliases += ["gemelos", "gastrocnemio"]
            add("muscle_" + key, name, "musculo", region, [muscle_shape(a, b, width, depth)], side=side,
                wiki=wiki or "Músculo " + name.lower(), aliases=aliases,
                origin=origin, insertion=insertion, nerve=nerve, function=function,
                subtype="grupo" if "grupo" in name else "muscle")
            if key in ("supraspinatus", "infraspinatus", "subscapularis", "teres_minor"):
                start = [a[i] * .3 + b[i] * .7 for i in range(3)]
                ligament("cuff_" + key, "Tendón del " + name.lower(), "upper", [tube([start, b], .045)], side=side,
                         wiki="Manguito rotador", aliases=["manguito rotador", "tendón " + name], origin=origin, insertion=insertion,
                         function="Transmite fuerza muscular y estabiliza la cabeza humeral; componente tendinoso del manguito.", subtype="tendon")

    hierarchy = {}
    for record in records:
        hierarchy.setdefault(record["sistema"], {}).setdefault(record["region"], {}).setdefault(record["nombre"], []).append(record["Mesh_ID"])
    counts = dict(Counter(r["sistema"] for r in records))
    return {"schema_version": 1, "model": {"url": None, "source": "procedural-full-body", "title": "Cuerpo Completo",
            "license": "Geometría matemática original del proyecto", "counts": counts,
            "note": "Modelo esquemático: formas, posiciones e inserciones aproximadas. No es un atlas de precisión clínica.",
            "regions": REGIONS, "default_layers": {"oseo": True, "articular": True, "cartilago": True, "muscular": False}},
            "structures": records, "hierarchy": hierarchy}
