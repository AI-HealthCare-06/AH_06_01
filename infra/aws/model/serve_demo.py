"""Loopback-only synthetic demo inference with the same pinned M1/M2 handler.

Run with the existing model Python environment, then start Vite with
VITE_REXRUN_DEMO_MODEL_API_URL=http://127.0.0.1:8007. Never used in production.
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse
import argparse
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[3]
os.environ.setdefault("REXRUN_MODEL_SOURCE", str(ROOT / "ai/m1_stage"))
sys.path.insert(0, str(ROOT / "ai"))
from handler import create_handler, predictor


def reject_storage(*args, **kwargs):
    raise RuntimeError("Synthetic demo must not read account storage")


handle = create_handler(call=reject_storage)


class DemoHandler(BaseHTTPRequestHandler):
    def send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin", "")
        parsed = urlparse(origin)
        if parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send(200, {})

    def do_GET(self):
        self.send(200 if self.path == "/health" else 404,
                  {"ready": self.path == "/health", "syntheticOnly": True})

    def do_POST(self):
        if self.headers.get("Authorization"):
            return self.send(403, {"error": "SYNTHETIC_ONLY"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 128:
                return self.send(413, {"error": "FIXED_PERSONA_ONLY"})
            body = self.rfile.read(length).decode("utf-8")
        except (ValueError, UnicodeError):
            return self.send(400, {"error": "INVALID_BODY"})
        response = handle({"rawPath": self.path, "requestContext": {"http": {"method": "POST"}}, "body": body})
        self.send(response["statusCode"], json.loads(response["body"]))

    def log_message(self, format, *args):
        pass  # No request bodies, health values or account tokens in logs.


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8007)
    args = parser.parse_args()
    predictor()  # Verify model identity and load once before accepting requests.
    server = HTTPServer(("127.0.0.1", args.port), DemoHandler)
    print(f"Synthetic M1/M2 demo ready on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()
