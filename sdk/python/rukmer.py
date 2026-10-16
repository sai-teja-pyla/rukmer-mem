"""Small Rukmer memory client. No third-party dependencies."""

from __future__ import annotations

import json
from urllib import request, error


class RukmerClient:
    def __init__(self, base_url: str, api_key: str | None = None, user: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.user = user

    def search(self, query: str, **extra):
        return self._call("/v4/search", {"query": query, **extra})

    def add(self, text: str, **extra):
        body = {"text": text, "title": extra.pop("title", text[:80]), **extra}
        return self._call("/v3/documents", body)

    def remember(self, messages, **extra):
        return self._call("/v4/remember", {"messages": messages, **extra})

    def profile(self, **extra):
        return self._call("/v4/profile", extra or None, method="GET")

    def inject(self, query: str, **extra):
        return self._call("/v4/inject", {"query": query, **extra})

    def _call(self, path: str, body, method: str = "POST"):
        data = None if method == "GET" else json.dumps(body or {}).encode()
        req = request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.api_key:
            req.add_header("Authorization", f"Bearer {self.api_key}")
        if self.user:
            req.add_header("x-rukmer-user", self.user)
        try:
            with request.urlopen(req) as res:
                return json.loads(res.read().decode() or "{}")
        except error.HTTPError as exc:
            raw = exc.read().decode()
            try:
                msg = json.loads(raw).get("error") or raw
            except json.JSONDecodeError:
                msg = raw
            raise RuntimeError(msg or f"Rukmer {exc.code}") from exc
