"""Validated metadata and accent-insensitive search; no database needed for the MVP."""
import json
import unicodedata
from pathlib import Path

from pydantic import BaseModel, Field, model_validator


def normalize(text: str) -> str:
    return " ".join("".join(c for c in unicodedata.normalize("NFKD", text.casefold())
                           if not unicodedata.combining(c)).split())


class Structure(BaseModel):
    Mesh_ID: str = Field(min_length=1)
    nombre: str
    nombre_oficial_ta2: str | None = None
    sistema: str
    region: str
    capa: str
    aliases: list[str] = Field(default_factory=list)
    descripcion: str = "Pendiente de documentación."
    inserciones_articulaciones: str = "Pendiente de documentación."
    funcion: str = "Pendiente de documentación."
    sources: list[dict] = Field(default_factory=list)
    revision: str = "pendiente"
    origen: str = "No documentado."
    insercion: str = "No documentado."
    inervacion: str = "No documentado."
    model_config = {"extra": "allow"}


class Metadata(BaseModel):
    schema_version: int = 1
    model: dict
    structures: list[Structure]
    hierarchy: dict

    @model_validator(mode="after")
    def check_ids(self):
        ids = [s.Mesh_ID for s in self.structures]
        if len(ids) != len(set(ids)):
            raise ValueError("Mesh_ID duplicados: el modelo no puede vincularse sin ambigüedad.")
        hierarchy_ids = [i for regions in self.hierarchy.values()
                         for structures in regions.values() for values in structures.values()
                         for i in values]
        if sorted(ids) != sorted(hierarchy_ids):
            raise ValueError("La jerarquía debe contener cada Mesh_ID exactamente una vez.")
        return self


class Catalog:
    def __init__(self, source: Path | dict):
        document = json.loads(source.read_text(encoding="utf-8")) if isinstance(source, Path) else source
        self.metadata = Metadata.model_validate(document)
        self.by_id = {s.Mesh_ID: s for s in self.metadata.structures}
        self.index = [(s, [normalize(x) for x in [s.nombre, s.nombre_oficial_ta2 or "", *s.aliases]])
                      for s in self.metadata.structures]

    def search(self, query: str, limit: int = 30) -> tuple[list[Structure], int]:
        q = normalize(query)
        if not q:
            return [], 0
        terms = q.split()
        results = []
        for structure, names in self.index:
            matches = [n for n in names if all(t in n for t in terms)]
            if matches:
                rank = min(0 if n == q else 1 if n.startswith(q) else 2 for n in matches)
                results.append((rank, structure.nombre.casefold(), structure))
        results.sort(key=lambda row: row[:2])
        return [r[2] for r in results[:limit]], len(results)
