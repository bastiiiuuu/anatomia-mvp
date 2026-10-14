import os
import gzip
import hashlib
import json
from contextlib import asynccontextmanager
from pathlib import Path

import httpx

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .catalog import Catalog, Structure
from .procedural_catalog import build_metadata
from .real_catalog import build_real_metadata
from .wikipedia import WikipediaService

ROOT = Path(__file__).resolve().parents[1]


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.catalog = Catalog(build_real_metadata(ROOT))
    app.state.procedural = Catalog(build_metadata())
    app.state.demo = Catalog(ROOT / "data/demo_metadata.json")
    full = app.state.catalog.metadata.model_dump()
    # Clinical notes are fetched only for the selected piece. IDs and aliases remain complete.
    scene_fields = {"Mesh_ID", "nombre", "nombre_original", "nombre_oficial_ta2", "sistema", "sistema_label",
                    "region", "view_region", "capa", "subtype", "aliases", "side", "study_section", "study_group"}
    scene_data = {"model": full["model"], "structures": [{k: v for k, v in s.items() if k in scene_fields} for s in full["structures"]]}
    app.state.documents = {}
    for key, data in (("metadata", full), ("scene", scene_data)):
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        app.state.documents[key] = {"body": body, "gzip": gzip.compress(body, compresslevel=5, mtime=0),
                                    "etag": hashlib.sha256(body).hexdigest()}
    agent = os.environ.get("WIKIPEDIA_USER_AGENT", "AtlasProcedural/0.2 (http://127.0.0.1:8000; local educational app)")
    async with httpx.AsyncClient(timeout=httpx.Timeout(5, connect=3), follow_redirects=True,
            headers={"User-Agent": agent, "Api-User-Agent": agent, "Accept": "application/json"}) as client:
        app.state.wikipedia = WikipediaService(client)
        try:
            yield
        finally:
            await app.state.wikipedia.close()


app = FastAPI(title="Atlas · Anatomía real 3D", version="0.4.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


def catalog(request: Request, demo: bool) -> Catalog:
    return request.app.state.demo if demo else request.app.state.catalog


@app.get("/")
def index():
    return FileResponse(ROOT / "static/index.html")


@app.get("/api/health")
def health(request: Request):
    return {"status": "ok", "structures": len(request.app.state.catalog.by_id)}


@app.get("/api/dev", include_in_schema=False)
def dev_version():
    # Opt-in local development only. Browser reloads on saved HTML/CSS/JS changes.
    enabled = os.environ.get("ANATOMY_DEV") == "1"
    files = [ROOT / "static" / name for name in ("index.html", "styles.css", "studio.css", "label-layout.js","camera-motion.js","studio-ui.js","viewer.js", "materials.js", "batch-renderer.js", "batch-worker.js", "performance.js", "data-source.js", "dev.js")]
    version = ":".join(str(p.stat().st_mtime_ns) for p in files) if enabled else None
    return JSONResponse({"enabled": enabled, "version": version}, headers={"Cache-Control": "no-store"})


@app.get("/api/metadata")
def metadata(request: Request, demo: bool = False):
    if demo:
        return catalog(request, demo).metadata.model_dump()
    return cached_document(request, "metadata")


def cached_document(request: Request, key: str):
    document = request.app.state.documents[key]
    accepted = request.headers.get("accept-encoding", "")
    # Respect q=0 rather than assuming every advertised encoding is allowed.
    use_gzip = False
    for part in accepted.split(","):
        values = [value.strip() for value in part.split(";")]
        if values[0].lower() != "gzip":
            continue
        quality = 1.0
        try:
            for value in values[1:]:
                if value.lower().startswith("q="):
                    quality = float(value[2:])
        except ValueError:
            quality = 0.0
        use_gzip = quality > 0
    etag = '"' + document["etag"] + ("-gzip" if use_gzip else "") + '"'
    headers = {"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
    candidates = [value.strip().removeprefix("W/") for value in request.headers.get("if-none-match", "").split(",")]
    if etag in candidates or "*" in candidates:
        return Response(status_code=304, headers=headers)
    if use_gzip:
        headers["Content-Encoding"] = "gzip"
    return Response(document["gzip" if use_gzip else "body"], media_type="application/json", headers=headers)


@app.get("/api/scene")
def scene(request: Request):
    return cached_document(request, "scene")


@app.get("/api/buscar")
def buscar(request: Request, q: str = Query("", max_length=120),
           limit: int = Query(30, ge=1, le=100), demo: bool = False):
    results, total = catalog(request, demo).search(q, limit)
    return {"q": q, "total": total, "results": [s.model_dump() for s in results]}


@app.get("/api/estructuras/{mesh_id}", response_model=Structure)
def structure(mesh_id: str, request: Request, demo: bool = False):
    item = catalog(request, demo).by_id.get(mesh_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Estructura no encontrada")
    return item


@app.get("/api/estructuras/{mesh_id}/wikipedia")
async def wikipedia_summary(mesh_id: str, request: Request):
    item = request.app.state.catalog.by_id.get(mesh_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Estructura no encontrada")
    # Only curated titles from the generated catalogue; no arbitrary URL proxy.
    if not item.wikipedia_title:
        return {"status": "not_mapped", "title": item.nombre, "extract": "", "url": "https://es.wikipedia.org/",
                "license": "", "cached": False, "message": "Sin correspondencia editorial con un artículo español; se conserva el nombre original y el término latino del atlas."}
    return await request.app.state.wikipedia.summary(item.wikipedia_title)
