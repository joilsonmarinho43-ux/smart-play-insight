import json
import os
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from .server import Handler, authorized_user


class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:" + str(cls.httpd.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def test_read_requires_valid_user(self):
        with patch("trader_service.server.authorized_user", return_value=False):
            with self.assertRaises(HTTPError) as result:
                urlopen(self.url + "/snapshot", timeout=2)
            self.assertEqual(result.exception.code, 401)

    def test_only_configured_user_is_accepted(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return None
            def read(self, *_): return b'{"id":"another-user"}'
        with patch.dict(os.environ, {"NEXUS_AUTH_URL": "http://auth.local", "NEXUS_ANON_KEY": "public-key", "TRADER_ALLOWED_USER_ID": "owner"}):
            with patch("trader_service.server.urlopen", return_value=Response()):
                self.assertFalse(authorized_user("valid-token"))

    def test_ingest_requires_secret_and_rejects_old_bar(self):
        with patch.dict(os.environ, {"TRADER_INGEST_TOKEN": "test-secret"}):
            now = datetime.now(timezone.utc) - timedelta(minutes=5)
            row = {"market": "WIN", "instrument": "WIN-DEMO", "end": now.isoformat(),
                   "open": 100, "high": 101, "low": 99, "close": 100, "volume": 100, "source": "test"}
            body = json.dumps(row).encode()
            request = Request(self.url + "/bar", body, method="POST", headers={"Content-Type": "application/json"})
            with self.assertRaises(HTTPError) as result:
                urlopen(request, timeout=2)
            self.assertEqual(result.exception.code, 401)
            request.add_header("Authorization", "Bearer test-secret")
            with urlopen(request, timeout=2) as response:
                self.assertEqual(json.load(response)["decision"], "SEM_ENTRADA")


if __name__ == "__main__":
    unittest.main()
