"""Isolated read-only trading analysis API. Requires an authorized upstream feed."""
from __future__ import annotations

import json
import os
import threading
import hmac
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .engine import Bar, MARKETS, SignalEngine

ENGINE = SignalEngine()
LOCK = threading.Lock()
SNAPSHOTS: dict[str, dict] = {}


def authorized_user(token: str) -> bool:
    auth_url = os.environ.get("NEXUS_AUTH_URL", "").rstrip("/")
    anon_key = os.environ.get("NEXUS_ANON_KEY", "")
    allowed_id = os.environ.get("TRADER_ALLOWED_USER_ID", "")
    if not auth_url or not anon_key or not allowed_id or not token:
        return False
    request = Request(auth_url + "/auth/v1/user", headers={
        "Authorization": "Bearer " + token, "apikey": anon_key,
    })
    try:
        with urlopen(request, timeout=3) as response:
            user = json.load(response)
        return user.get("id") == allowed_id
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return False


class Handler(BaseHTTPRequestHandler):
    def _headers(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = os.environ.get("TRADER_ALLOWED_ORIGIN", "")
        if origin and self.headers.get("Origin") == origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def _json(self, status: int, payload: object) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._headers(status)
        self.wfile.write(data)

    def _token(self) -> str:
        value = self.headers.get("Authorization", "")
        return value[7:] if value.startswith("Bearer ") else ""

    def do_OPTIONS(self) -> None:
        if self.path != "/snapshot" or self.headers.get("Origin") != os.environ.get("TRADER_ALLOWED_ORIGIN", ""):
            return self._json(403, {"error": "forbidden"})
        self._headers(204)

    def do_GET(self) -> None:
        if self.path != "/snapshot":
            return self._json(404, {"error": "not found"})
        if not authorized_user(self._token()):
            return self._json(401, {"error": "unauthorized"})
        now = datetime.now(timezone.utc)
        with LOCK:
            result = [SNAPSHOTS[m] for m in MARKETS if m in SNAPSHOTS
                      and 0 <= (now - datetime.fromisoformat(SNAPSHOTS[m]["bar_end"])).total_seconds() <= 25]
        self._json(200, result)

    def do_POST(self) -> None:
        if self.path != "/bar":
            return self._json(404, {"error": "not found"})
        secret = os.environ.get("TRADER_INGEST_TOKEN", "")
        if not secret or not hmac.compare_digest(self._token(), secret):
            return self._json(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > 4096:
                return self._json(413, {"error": "invalid size"})
            bar = Bar.from_dict(json.loads(self.rfile.read(length)))
            with LOCK:
                result = ENGINE.process(bar)
                SNAPSHOTS[bar.market] = result
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            return self._json(400, {"error": "invalid bar"})
        self._json(200, result)


def main() -> None:
    required = ("TRADER_INGEST_TOKEN", "NEXUS_AUTH_URL", "NEXUS_ANON_KEY", "TRADER_ALLOWED_ORIGIN", "TRADER_ALLOWED_USER_ID")
    if any(not os.environ.get(key) for key in required):
        raise SystemExit("Missing required trader service configuration")
    port = int(os.environ.get("TRADER_PORT", "8765"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
