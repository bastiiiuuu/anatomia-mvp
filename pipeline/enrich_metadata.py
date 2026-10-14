"""Exact dictionary mapping + optional Spanish Wikipedia evidence. Does not invent TA2."""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from common import hierarchy, normalize, write_json

HERE = Path(__file__).resolve().parent
DEFAULT_CATALOG = HERE / "catalogo_medico.json"
FIELDS = ("nombre", "nombre_oficial_ta2", "descripcion", "inserciones_articulaciones", "funcion")


def lookup_index(dictionary):
    result = {}
    for entry in dictionary["entries"]:
        for name in [entry["key"], entry["nombre"], entry["nombre_oficial_ta2"], *entry["aliases"]]:
            key = normalize(name)
            if key in result and result[key]["key"] != entry["key"]:
                raise ValueError(f"Alias ambiguo en diccionario: {name}")
            result[key] = entry
    return result


def wikipedia(title, cache_dir, user_agent):
    """Exact title only. Keep revision ID and provenance; disk cache avoids API overload."""
    import hashlib
    cache = cache_dir / (hashlib.sha256(title.encode()).hexdigest() + ".json")
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    params = {"action": "query", "format": "json", "formatversion": 2, "redirects": 1,
              "prop": "extracts|info|revisions|pageprops", "exintro": 1, "explaintext": 1,
              "exchars": 1000, "inprop": "url", "rvprop": "ids|timestamp", "titles": title}
    req = Request("https://es.wikipedia.org/w/api.php?" + urlencode(params),
                  headers={"User-Agent": user_agent})
    with urlopen(req, timeout=20) as response:
        page = json.load(response)["query"]["pages"][0]
    if page.get("missing") or "disambiguation" in page.get("pageprops", {}):
        raise ValueError(f"Artículo inexistente o ambiguo: {title}")
    result = {"title": page["title"], "extract": page.get("extract", ""),
              "url": page.get("fullurl", "https://es.wikipedia.org/wiki/" + quote(page["title"])),
              "revision_id": page["revisions"][0]["revid"],
              "retrieved_at": datetime.now(timezone.utc).isoformat(),
              "license": "CC BY-SA 4.0; verificar condiciones del artículo",
              "revision": "pendiente"}
    write_json(cache, result)
    time.sleep(0.2)
    return result


def enrich(metadata, dictionary, wiki=False, cache_dir=None, user_agent="", titles=None):
    index = lookup_index(dictionary)
    for s in metadata["structures"]:
        key = s.get("catalog_key") or s.get("source_name") or s["nombre"]
        entry = index.get(normalize(key))
        if entry:
            for field in FIELDS:
                s[field] = entry[field]
            if s.get("display_name_override"):
                s["nombre"] = s["display_name_override"]
            # Preserve explicit regional/lateral classification from the model manifest.
            for field in ("sistema", "region", "capa"):
                if s.get(field) in (None, "", "Sin clasificar", "otro"):
                    s[field] = entry[field]
            s["aliases"] = sorted(set(s.get("aliases", []) + entry["aliases"] + [s.get("source_name", "")]) - {""})
            s["sources"] = [dictionary["sources"][k] for k in entry["source_keys"]]
            s["revision"] = "con_fuentes_pendiente_revision_docente"
        else:
            s.setdefault("nombre_oficial_ta2", None)
            for field in FIELDS[2:]:
                s.setdefault(field, "Pendiente de documentación.")
            s.setdefault("sources", [])
            s["revision"] = "sin_correspondencia_pendiente"
        title = (titles or {}).get(s["Mesh_ID"]) or (entry or {}).get("wikipedia_title")
        if wiki and title:
            try:
                s["wikipedia_evidence"] = wikipedia(title, cache_dir, user_agent)
                s.pop("enrichment_error", None)
            except (URLError, ValueError, KeyError, TimeoutError) as error:
                s["enrichment_error"] = str(error)
                print(f"Aviso: {s['nombre']}: {error}", file=sys.stderr)
    metadata["hierarchy"] = hierarchy(metadata["structures"])
    return metadata


def demo(dictionary):
    structures = [{"Mesh_ID": "demo_" + e["key"], "catalog_key": e["key"],
                   "nombre": e["nombre"], "sistema": e["sistema"], "region": e["region"],
                   "capa": e["capa"]} for e in dictionary["entries"]]
    return {"schema_version": 1, "model": {"url": None, "source": "demo",
            "title": "Rodilla · geometría esquemática", "license": "Geometría original del MVP",
            "note": "Proporciones, inserciones y lateralidad visuales simplificadas; no es un atlas anatómico."},
            "structures": structures, "hierarchy": hierarchy(structures)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dictionary", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--wikipedia", action="store_true")
    parser.add_argument("--titles", type=Path, help="JSON Mesh_ID -> título exacto de Wikipedia")
    parser.add_argument("--cache-dir", type=Path, default=HERE.parent / "data/wiki-cache")
    parser.add_argument("--user-agent", default="", help="Identifica aplicación y correo de contacto")
    args = parser.parse_args()
    if not args.demo and not args.input:
        parser.error("Usa --demo o --input")
    if args.wikipedia and not args.user_agent:
        parser.error("--wikipedia requiere --user-agent con contacto")
    dictionary = json.loads(args.dictionary.read_text(encoding="utf-8"))
    metadata = demo(dictionary) if args.demo else json.loads(args.input.read_text(encoding="utf-8"))
    titles = json.loads(args.titles.read_text(encoding="utf-8")) if args.titles else {}
    write_json(args.output, enrich(metadata, dictionary, args.wikipedia, args.cache_dir, args.user_agent, titles))
    print(f"Fichas: {len(metadata['structures'])}; salida: {args.output}")


if __name__ == "__main__":
    main()
