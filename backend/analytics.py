"""Private traffic dashboard and a small, separate public collection service.

Run only on loopback behind the ngrok policy in tools/analytics-policy.json.
The atlas itself stays static on GitHub Pages. No records or secrets are public.
"""
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parents[1]
RETENTION = 7 * 86400
ORIGIN = "https://bastiiiuuu.github.io"
PUBLIC_PATH = "/anatomia-mvp/"
IP_HEADER = "x-atlas-client-ip"


class TrafficStore:
    def __init__(self, path):
        self.path = str(path)
        self.lock = threading.Lock()
        self.last_prune = 0
        self.limits = OrderedDict()
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, ip TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, path TEXT NOT NULL, device TEXT NOT NULL, referrer TEXT NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS visits_started ON visits(first_seen)")
            db.execute("CREATE INDEX IF NOT EXISTS visits_active ON visits(last_seen)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def allowed(self, ip, category, limit, now):
        with self.lock:
            key = (ip, category, now // 60)
            count = self.limits.pop(key, 0) + 1
            self.limits[key] = count
            while len(self.limits) > 4096:
                self.limits.popitem(last=False)
            return count <= limit

    def record(self, visit, ip, now):
        with self.connect() as db:
            db.execute("INSERT INTO visits VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen WHERE visits.ip=excluded.ip",
                       (visit["id"], ip, now, now, PUBLIC_PATH, visit["device"], visit["referrer"]))
            if now - self.last_prune > 3600:
                db.execute("DELETE FROM visits WHERE first_seen < ?", (now - RETENTION,))
                db.execute("DELETE FROM visits WHERE id IN (SELECT id FROM visits ORDER BY first_seen DESC LIMIT -1 OFFSET 100000)")
                self.last_prune = now

    def report(self, days, page, now):
        since = now - days * 86400
        with self.connect() as db:
            totals = dict(db.execute("SELECT COUNT(*) AS views, COUNT(DISTINCT ip) AS addresses, COALESCE(SUM(first_seen>=?),0) AS today FROM visits WHERE first_seen>=?", (now-86400, since)).fetchone())
            totals["active"] = db.execute("SELECT COUNT(DISTINCT ip) FROM visits WHERE last_seen>=? AND first_seen>=?", (now-90, since)).fetchone()[0]
            rows = [dict(row) for row in db.execute("SELECT ip,first_seen,last_seen,path,device,referrer FROM visits WHERE first_seen>=? ORDER BY first_seen DESC,id DESC LIMIT 50 OFFSET ?", (since, page*50))]
            daily = [dict(row) for row in db.execute("SELECT date(first_seen,'unixepoch') AS day,COUNT(*) AS views FROM visits WHERE first_seen>=? GROUP BY day ORDER BY day", (since,))]
            devices = [dict(row) for row in db.execute("SELECT device,COUNT(*) AS views FROM visits WHERE first_seen>=? GROUP BY device ORDER BY views DESC", (since,))]
        return {"totals": totals, "rows": rows, "daily": daily, "devices": devices, "page": page, "days": days,
                "updated_at": now, "retention_days": 7, "has_more": (page+1)*50 < totals["views"]}


def create_app(database=None, secret=None, trust_proxy=None):
    private = ROOT / "data/private"
    if secret is None:
        secret = os.environ.get("ATLAS_ADMIN_TOKEN")
        if not secret:
            private.mkdir(parents=True, exist_ok=True)
            key_file = private / "admin-token.txt"
            try:
                with key_file.open("x", encoding="utf-8") as stream:
                    stream.write(secrets.token_urlsafe(32))
            except FileExistsError:
                pass
            secret = key_file.read_text(encoding="utf-8").strip()
    if len(secret) < 32:
        raise ValueError("ATLAS_ADMIN_TOKEN debe tener al menos 32 caracteres")
    secret_bytes = secret.encode()
    store = TrafficStore(database or private / "traffic.sqlite3")
    trusted = trust_proxy if trust_proxy is not None else os.environ.get("ATLAS_ANALYTICS_TRUST_PROXY") == "1"
    app = FastAPI(title="Atlas · Tráfico privado", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store

    def peer(request):
        try:
            return ipaddress.ip_address(request.client.host)
        except ValueError:
            return None

    def address(request):
        client = peer(request)
        # The ngrok policy removes visitor-provided values and sets conn.client_ip.
        if trusted and client and client.is_loopback and request.headers.get(IP_HEADER):
            try:
                return str(ipaddress.ip_address(request.headers[IP_HEADER]))
            except ValueError:
                raise HTTPException(400, "Dirección del proxy no válida")
        return str(client) if client else "unknown"

    def local_admin(request):
        client = peer(request)
        return bool(client and client.is_loopback and request.url.hostname in {"127.0.0.1", "localhost", "::1"}
                    and not any(name in request.headers for name in (IP_HEADER,"x-forwarded-for","x-forwarded-host","forwarded")))

    def authenticated(request):
        if local_admin(request):
            return True
        value = request.cookies.get("atlas_admin", "")
        try:
            expires, nonce, signature = value.split(".")
            message = f"{expires}.{nonce}"
            expected = hmac.new(secret_bytes, message.encode(), hashlib.sha256).hexdigest()
            return int(expires) > time.time() and int(expires) <= time.time()+28801 and hmac.compare_digest(expected, signature)
        except (ValueError, TypeError):
            return False

    def require_admin(request):
        if not authenticated(request):
            raise HTTPException(401, "Acceso privado. Inicia sesión.")

    @app.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers.update({"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer",
            "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
        if request.url.path == "/collect" and request.headers.get("origin") == ORIGIN:
            response.headers.update({"Access-Control-Allow-Origin":ORIGIN,"Vary":"Origin"})
        return response

    @app.get("/health")
    def health():
        return {"status":"ok", "service":"atlas-traffic"}

    @app.options("/collect")
    def preflight(request: Request):
        if request.headers.get("origin") != ORIGIN:
            raise HTTPException(403)
        return Response(status_code=204, headers={"Access-Control-Allow-Methods":"POST", "Access-Control-Allow-Headers":"content-type,ngrok-skip-browser-warning", "Access-Control-Max-Age":"600"})

    async def small_json(request):
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body)>2048:
                raise HTTPException(413,"Solicitud demasiado grande")
        try:
            value = json.loads(body)
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, UnicodeError):
            raise HTTPException(400,"Solicitud no válida")

    @app.post("/collect", status_code=204)
    async def collect(request: Request):
        if request.headers.get("origin") != ORIGIN:
            raise HTTPException(403,"Origen no permitido")
        ip = address(request)
        now = int(time.time())
        if not store.allowed(ip,"collect",120,now):
            raise HTTPException(429,"Demasiadas solicitudes")
        body = await small_json(request)
        if not re.fullmatch(r"[a-f0-9-]{36}", str(body.get("id",""))) or body.get("path") != PUBLIC_PATH:
            raise HTTPException(400,"Visita no válida")
        device = body.get("device")
        if device not in {"Móvil","Tablet","Escritorio"}:
            device = "Escritorio"
        try:
            referrer = urlsplit(str(body.get("referrer",""))[:500]).hostname or "Directo"
        except ValueError:
            referrer = "Directo"
        await run_in_threadpool(store.record, {"id":body["id"],"device":device,"referrer":referrer[:200]}, ip, now)
        return Response(status_code=204)

    @app.get("/admin")
    @app.get("/admin/")
    def dashboard():
        return FileResponse(ROOT/"admin/index.html")

    @app.get("/admin/assets/{name}")
    def asset(name: str):
        if name not in {"admin.css","admin.js"}:
            raise HTTPException(404)
        return FileResponse(ROOT/"admin"/name)

    @app.get("/admin/api/session")
    def session(request: Request):
        return {"authenticated":authenticated(request), "local":local_admin(request)}

    @app.post("/admin/api/login")
    async def login(request: Request):
        # Admin login is same-origin only, unrelated to the public beacon CORS.
        expected_origin = "https://"+request.headers.get("host", "")
        if request.headers.get("origin") not in {expected_origin,str(request.base_url).rstrip("/")}:
            raise HTTPException(403)
        if not store.allowed(address(request),"login",5,int(time.time())):
            raise HTTPException(429,"Espera un minuto antes de volver a intentarlo")
        body = await small_json(request)
        token = str(body.get("token",""))
        if not hmac.compare_digest(hashlib.sha256(token.encode()).digest(),hashlib.sha256(secret_bytes).digest()):
            raise HTTPException(401,"Clave incorrecta")
        message = f"{int(time.time())+28800}.{secrets.token_hex(16)}"
        signature = hmac.new(secret_bytes,message.encode(),hashlib.sha256).hexdigest()
        response = JSONResponse({"ok":True})
        response.set_cookie("atlas_admin",message+"."+signature,max_age=28800,httponly=True,secure=not local_admin(request),samesite="strict",path="/admin")
        return response

    @app.post("/admin/api/logout")
    def logout():
        response = JSONResponse({"ok":True})
        response.delete_cookie("atlas_admin",path="/admin")
        return response

    @app.get("/admin/api/stats")
    def stats(request: Request, days: int=7, page: int=0):
        require_admin(request)
        if days not in {1,7} or not 0<=page<=2000:
            raise HTTPException(400)
        return store.report(days,page,int(time.time()))

    return app


app = create_app()
