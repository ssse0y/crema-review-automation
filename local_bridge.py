from __future__ import annotations

import base64
import json
import os
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(os.environ.get("CREMA_CAPTURE_DIR", Path.home() / "Downloads" / "crema-negative-reviews"))
ROOT.mkdir(parents=True, exist_ok=True)


def log(message: str) -> None:
    with (ROOT / "automation.log").open("a", encoding="utf-8") as fp:
        fp.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {message}\n")


class Handler(BaseHTTPRequestHandler):
    def _reply(self, status=200, **data):
        body = json.dumps({"ok": status < 400, **data}, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(size) or b"{}")
            today = datetime.now().strftime("%Y-%m-%d")
            if self.path == "/capture":
                index = int(data.get("index", 0))
                label = str(data.get("label", "")).strip()
                suffix = f"_{index:02d}" if index else f"_{label or '진단'}"
                target = ROOT / f"{today}{suffix}.png"
                encoded = data["dataUrl"].split(",", 1)[1]
                target.write_bytes(base64.b64decode(encoded))
                self._reply(path=str(target))
            elif self.path == "/reviews":
                target = ROOT / f"{today}_부정리뷰.json"
                target.write_text(json.dumps(data.get("rows", []), ensure_ascii=False, indent=2), encoding="utf-8")
                self._reply(path=str(target))
            elif self.path == "/log":
                log(str(data.get("message", "")))
                self._reply()
            else:
                self._reply(404, error="not found")
        except Exception as exc:
            log(f"bridge error: {exc}")
            self._reply(500, error=str(exc))

    def log_message(self, *_):
        return


if __name__ == "__main__":
    log("로컬 저장 도우미 시작")
    ThreadingHTTPServer(("127.0.0.1", 18765), Handler).serve_forever()
