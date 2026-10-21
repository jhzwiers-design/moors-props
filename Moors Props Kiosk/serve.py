#!/usr/bin/env python3
"""Serve the kiosk folder on localhost with caching disabled, so edits always show up on reload.
Usage: python3 serve.py [port]   (default 8765). Only reachable from this computer."""
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args):
        pass

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f'Kiosk running at http://localhost:{port}  (Ctrl+C to stop)')
http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
