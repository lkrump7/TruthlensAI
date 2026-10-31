"""TruthLens sidecar: FAISS index service + PDF page renderer for OCR.

Run:  .venv/bin/python services/sidecar.py [port]   (default 8100)
Endpoints:
  GET  /health            -> {"faiss": true, "pymupdf": true}
  POST /faiss/add         {namespace, items:[{id, vector:[...]}]}
  POST /faiss/search      {namespace, vector:[...], k} -> {hits:[{id, score}]}
  POST /render            {pdfBase64} -> {pages:[{page, imageBase64}]}
Indexes persist under data/faiss/<namespace>.faiss (+ .ids.json).
"""
import base64
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

import faiss
import numpy as np
import pymupdf

NS_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def check_namespace(ns):
    if not NS_RE.match(str(ns or "")):
        raise ValueError(f"invalid namespace: {ns!r}")
    return str(ns)


DATA = os.path.join(os.path.dirname(__file__), "..", "data", "faiss")
os.makedirs(DATA, exist_ok=True)
INDEXES = {}


def load_index(ns):
    if ns in INDEXES:
        return INDEXES[ns]
    path = os.path.join(DATA, f"{ns}.faiss")
    ids_path = os.path.join(DATA, f"{ns}.ids.json")
    if os.path.exists(path) and os.path.exists(ids_path):
        idx = faiss.read_index(path)
        ids = json.load(open(ids_path))
    else:
        idx, ids = None, []
    INDEXES[ns] = (idx, ids)
    return INDEXES[ns]


def save_index(ns):
    idx, ids = INDEXES[ns]
    if idx is not None:
        faiss.write_index(idx, os.path.join(DATA, f"{ns}.faiss"))
        json.dump(ids, open(os.path.join(DATA, f"{ns}.ids.json"), "w"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"faiss": True, "pymupdf": True})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        try:
            return self._do_post()
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        except Exception as e:
            return self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def _do_post(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        except Exception as e:
            return self._json(400, {"error": f"bad json: {e}"})
        if self.path == "/faiss/add":
            ns = check_namespace(body.get("namespace", "default"))
            items = body.get("items", [])
            if body.get("reset"):
                INDEXES.pop(ns, None)
                for suffix in (".faiss", ".ids.json"):
                    try:
                        os.remove(os.path.join(DATA, ns + suffix))
                    except FileNotFoundError:
                        pass
            if not items:
                return self._json(200, {"added": 0})
            idx, ids = load_index(ns)
            vecs = np.array([it["vector"] for it in items], dtype="float32")
            if vecs.ndim != 2:
                raise ValueError("items must carry vectors of one consistent dimension")
            if idx is not None and vecs.shape[1] != idx.d:
                raise ValueError(f"vector dimension {vecs.shape[1]} does not match index dimension {idx.d}")
            faiss.normalize_L2(vecs)
            if idx is None:
                idx = faiss.IndexFlatIP(vecs.shape[1])
            idx.add(vecs)
            ids.extend(it["id"] for it in items)
            INDEXES[ns] = (idx, ids)
            save_index(ns)
            return self._json(200, {"added": len(items), "total": idx.ntotal})
        if self.path == "/faiss/search":
            ns = check_namespace(body.get("namespace", "default"))
            idx, ids = load_index(ns)
            if idx is None or idx.ntotal == 0:
                return self._json(200, {"hits": []})
            vec = np.array([body["vector"]], dtype="float32")
            if vec.shape[1] != idx.d:
                raise ValueError(f"vector dimension {vec.shape[1]} does not match index dimension {idx.d}")
            faiss.normalize_L2(vec)
            scores, pos = idx.search(vec, min(int(body.get("k", 5)), idx.ntotal))
            hits = [{"id": ids[int(p)], "score": float(s)} for s, p in zip(scores[0], pos[0]) if p >= 0]
            return self._json(200, {"hits": hits})
        if self.path == "/render":
            try:
                pdf = base64.b64decode(body["pdfBase64"])
                doc = pymupdf.open(stream=pdf, filetype="pdf")
                pages = []
                for i, page in enumerate(doc):
                    png = page.get_pixmap(dpi=150).tobytes("png")
                    pages.append({"page": i + 1, "imageBase64": base64.b64encode(png).decode()})
                return self._json(200, {"pages": pages})
            except Exception as e:
                return self._json(422, {"error": f"render failed: {e}"})
        return self._json(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8100
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
