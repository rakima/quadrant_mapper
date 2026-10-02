"""Static-file server for the browser-local quadrant mapper."""

from __future__ import annotations

import argparse
import mimetypes
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


WEB_DIR = Path(__file__).resolve().parent / "web"


class StaticRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = unquote(urlparse(self.path).path)
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (WEB_DIR / relative).resolve()
        try:
            target.relative_to(WEB_DIR.resolve())
        except ValueError:
            self.send_error(404)
            return
        if not target.is_file():
            self.send_error(404)
            return
        body = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"}:
            content_type = f"{content_type}; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
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

    server = ThreadingHTTPServer((args.host, args.port), StaticRequestHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"四象限分類ツール: {url}")
    print("ユーザーデータはブラウザー内のIndexedDBに保存されます。")
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
