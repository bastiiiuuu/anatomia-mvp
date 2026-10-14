"""Shared pure-Python helpers; also importable in Blender's embedded Python."""
import json
import struct
import unicodedata
from pathlib import Path


def normalize(value):
    return " ".join("".join(c for c in unicodedata.normalize("NFKD", value.casefold())
                           if not unicodedata.combining(c)).split())


def hierarchy(structures):
    result = {}
    for s in structures:
        result.setdefault(s["sistema"], {}).setdefault(s["region"], {}).setdefault(
            s["nombre"], []).append(s["Mesh_ID"])
    return result


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def read_glb_json(path):
    with Path(path).open("rb") as stream:
        magic, version, total = struct.unpack("<4sII", stream.read(12))
        if magic != b"glTF" or version != 2 or Path(path).stat().st_size != total:
            raise ValueError("GLB v2 inválido")
        length, kind = struct.unpack("<II", stream.read(8))
        if kind != 0x4E4F534A:
            raise ValueError("Falta el bloque JSON glTF")
        return json.loads(stream.read(length))


def validate_glb(path, structures, require_draco=True):
    document = read_glb_json(path)
    primitives = [p for m in document.get("meshes", []) for p in m["primitives"]]
    if not primitives:
        raise ValueError("El GLB no contiene geometría")
    if require_draco and any("KHR_draco_mesh_compression" not in p.get("extensions", {})
                             for p in primitives):
        raise ValueError("Draco no se aplicó a todas las primitivas; revisa la instalación de Blender")
    nodes = [n for n in document.get("nodes", []) if "mesh" in n]
    exported = [n.get("extras", {}).get("Mesh_ID") for n in nodes]
    expected = [s["Mesh_ID"] for s in structures]
    if len(exported) != len(set(exported)) or set(exported) != set(expected):
        raise ValueError(f"Identidades GLB/JSON diferentes: {set(expected) ^ set(exported)}")
    return {"nodes": len(nodes), "primitives": len(primitives), "bytes": Path(path).stat().st_size,
            "draco": all("KHR_draco_mesh_compression" in p.get("extensions", {}) for p in primitives)}
