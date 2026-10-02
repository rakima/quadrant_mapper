"""Local-only HTTP server for the quadrant mapper."""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import mimetypes
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from models import ValidationError, normalize_image_path, validate_id
from storage import JsonRepository


ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"


class QuadrantRequestHandler(BaseHTTPRequestHandler):
    repository: JsonRepository

    def _send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status: int, message: str) -> None:
        self._send_json(status, {"error": message})

    def _read_json(self) -> object:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValidationError("リクエストサイズが不正です。") from error
        if length <= 0 or length > 15 * 1024 * 1024:
            raise ValidationError("リクエストは15MB以下にしてください。")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValidationError("JSONを読み込めません。") from error

    def _route(self) -> tuple[str, list[str]]:
        parsed = urlparse(self.path)
        return parsed.path, [unquote(part) for part in parsed.path.strip("/").split("/")]

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path, parts = self._route()
        try:
            if path == "/api/bootstrap":
                settings = self.repository.list_settings()
                datasets = self.repository.list_datasets()
                self._send_json(200, {
                    "settings": settings,
                    "datasets": datasets,
                    "warnings": self.repository.warnings,
                })
                return
            if path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if len(parts) >= 3 and parts[:2] == ["api", "images"]:
                relative = "/".join(parts[2:])
                image = normalize_image_path(relative, self.repository.images_dir)
                assert image is not None
                target = (self.repository.images_dir / image).resolve()
                content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                body = target.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(body)
                return
            self._serve_static(path)
        except (OSError, ValidationError) as error:
            self._send_error_json(404, str(error))

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path, _ = self._route()
        try:
            payload = self._read_json()
            if path == "/api/settings":
                self._send_json(201, self.repository.save_setting(payload))
                return
            if path == "/api/datasets":
                self._send_json(201, self.repository.save_dataset(payload))
                return
            if path == "/api/images":
                if not isinstance(payload, dict) or not isinstance(payload.get("data"), str):
                    raise ValidationError("画像データを指定してください。")
                try:
                    content = base64.b64decode(payload["data"], validate=True)
                except (binascii.Error, ValueError) as error:
                    raise ValidationError("画像データを読み込めません。") from error
                image = self.repository.save_image(str(payload.get("filename", "image")), content)
                self._send_json(201, {"image": image})
                return
            self._send_error_json(404, "APIが見つかりません。")
        except ValidationError as error:
            self._send_error_json(400, str(error))
        except (OSError, TypeError) as error:
            self._send_error_json(400, f"保存できません: {error}")

    def do_PUT(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path, parts = self._route()
        try:
            payload = self._read_json()
            if len(parts) != 3:
                self._send_error_json(404, "APIが見つかりません。")
                return
            kind, resource_id = parts[1], validate_id(parts[2], "ID")
            if not isinstance(payload, dict) or payload.get("id") != resource_id:
                raise ValidationError("URLのIDとJSONのIDが一致しません。")
            if kind == "settings":
                result = self.repository.save_setting(payload, overwrite=True)
            elif kind == "datasets":
                result = self.repository.save_dataset(payload, overwrite=True)
            else:
                self._send_error_json(404, "APIが見つかりません。")
                return
            self._send_json(200, result)
        except ValidationError as error:
            self._send_error_json(400, str(error))
        except (OSError, TypeError) as error:
            self._send_error_json(400, f"保存できません: {error}")

    def _serve_static(self, request_path: str) -> None:
        relative = "index.html" if request_path in ("", "/") else request_path.lstrip("/")
        target = (WEB_DIR / relative).resolve()
        try:
            target.relative_to(WEB_DIR.resolve())
        except ValueError:
            self.send_error(404)
            return
        if not target.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"} else content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="四象限分類ツールをローカルで起動します。")
    parser.add_argument("--host", default="127.0.0.1", help="待受アドレス（既定: 127.0.0.1）")
    parser.add_argument("--port", type=int, default=8765, help="待受ポート（既定: 8765）")
    parser.add_argument("--no-browser", action="store_true", help="ブラウザーを自動で開かない")
    args = parser.parse_args()

    class Handler(QuadrantRequestHandler):
        repository = JsonRepository(ROOT / "data")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"四象限分類ツール: {url}")
    print("終了するには Ctrl+C を押してください。")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=[url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを終了します。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
