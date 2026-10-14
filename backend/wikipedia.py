"""Asynchronous Wikipedia text lookup. Bounded LRU and inflight coalescing in RAM only."""
import asyncio
import time
from collections import OrderedDict
from urllib.parse import quote

import httpx


class WikipediaService:
    def __init__(self, client: httpx.AsyncClient, ttl=21600, max_entries=256):
        self.client = client
        self.ttl = ttl
        self.max_entries = max_entries
        self.cache = OrderedDict()
        self.inflight = {}
        self.limit = asyncio.Semaphore(4)

    async def summary(self, title):
        cached = self.cache.get(title)
        if cached and cached[0] > time.monotonic():
            self.cache.move_to_end(title)
            return {**cached[1], "cached": True}
        task = self.inflight.get(title)
        if task is None:
            task = asyncio.create_task(self._load(title))
            self.inflight[title] = task
            task.add_done_callback(lambda done: self.inflight.pop(title, None))
        return {**await asyncio.shield(task), "cached": False}

    async def _load(self, title):
        result = {"status": "unavailable", "title": title, "extract": "", "url": "https://es.wikipedia.org/wiki/" + quote(title.replace(" ", "_")),
                  "license": "CC BY-SA 4.0 · Wikipedia", "message": "Wikipedia no está disponible; la ficha local sigue funcionando."}
        async with self.limit:
            try:
                response = await self.client.get("https://es.wikipedia.org/api/rest_v1/page/summary/" + quote(title.replace(" ", "_"), safe=""))
                result["http_status"] = response.status_code
                if response.status_code == 404:
                    result.update(status="not_found", message="No hay un resumen para este título; consulta la referencia enlazada.")
                elif response.is_success:
                    document = response.json()
                    if document.get("type") == "disambiguation":
                        result.update(status="disambiguation", message="El título es ambiguo; no se asigna un texto automáticamente.")
                    elif isinstance(document.get("extract"), str) and document["extract"].strip():
                        result.update(status="ok", title=document.get("title", title), extract=document["extract"][:6000],
                                      revision=document.get("revision"), timestamp=document.get("timestamp"), message="")
                else:
                    result["message"] = f"Wikipedia devolvió HTTP {response.status_code}; la ficha local sigue disponible. Puedes abrir el artículo enlazado."
            except (httpx.HTTPError, ValueError, TypeError):
                pass
        duration = self.ttl if result["status"] == "ok" else 60
        self.cache[title] = (time.monotonic() + duration, result)
        self.cache.move_to_end(title)
        while len(self.cache) > self.max_entries:
            self.cache.popitem(last=False)
        return result

    async def close(self):
        tasks = list(self.inflight.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
