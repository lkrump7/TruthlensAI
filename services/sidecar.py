"""TruthLens sidecar: FAISS index service + PDF page renderer for OCR.

Run:  .venv/bin/python services/sidecar.py [port]   (default 8100)
Endpoints:
  GET  /health            -> {"faiss": true, "pymupdf": true}
  POST /faiss/add         {namespace, items:[{id, vector:[...]}]}
  POST /faiss/search      {namespace, vector:[...], k} -> {hits:[{id, score}]}
  POST /render            {pdfBase64} -> {pages:[{page, imageBase64}]}
  POST /embed             {texts:[...]} -> {model, dim, vectors} (503 when unavailable)
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


EMBED_MODEL_NAME = os.environ.get("TRUTHLENS_EMBED_MODEL", "all-mpnet-base-v2")
_embed_model = None
_embed_error = None


RERANK_MODEL_NAME = os.environ.get("TRUTHLENS_RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
_rerank_model = None
_rerank_error = None


def get_rerank_model():
    """Lazy cross-encoder load, same failure policy as embeddings:
    success latches, failure is reported and retried on a later call."""
    global _rerank_model, _rerank_error
    if _rerank_model is not None:
        return _rerank_model
    try:
        from sentence_transformers import CrossEncoder

        device = os.environ.get("TRUTHLENS_EMBED_DEVICE", "cpu")
        _rerank_model = CrossEncoder(RERANK_MODEL_NAME, device=device)
    except Exception as e:
        _rerank_error = f"{type(e).__name__}: {e}"
    return _rerank_model


NLI_MODEL_NAME = os.environ.get("TRUTHLENS_NLI_MODEL", "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli")
_nli_model = None
_nli_tokenizer = None
_nli_error = None


def get_nli():
    """Lazy NLI load (transformers sequence classification), CPU by
    default, same failure policy as the other models."""
    global _nli_model, _nli_tokenizer, _nli_error
    if _nli_model is not None:
        return _nli_model, _nli_tokenizer
    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        device = os.environ.get("TRUTHLENS_EMBED_DEVICE", "cpu")
        _nli_tokenizer = AutoTokenizer.from_pretrained(NLI_MODEL_NAME)
        _nli_model = AutoModelForSequenceClassification.from_pretrained(NLI_MODEL_NAME).to(device)
        _nli_model.eval()
    except Exception as e:
        _nli_error = f"{type(e).__name__}: {e}"
    return _nli_model, _nli_tokenizer


def get_embed_model():
    """Lazy sentence-transformer load: the sidecar must serve FAISS and
    PDF rendering even where the embedding model cannot be installed."""
    global _embed_model, _embed_error
    # Success latches; failure does not. A transient failure (a full GPU,
    # a network blip during download) must not disable embeddings until
    # restart, so a later call retries the load.
    if _embed_model is not None:
        return _embed_model
    try:
        from sentence_transformers import SentenceTransformer

        # CPU by default: this sidecar shares machines with other work,
        # and a full GPU must degrade to slower embeddings, not to none.
        device = os.environ.get("TRUTHLENS_EMBED_DEVICE", "cpu")
        _embed_model = SentenceTransformer(EMBED_MODEL_NAME, device=device)
    except Exception as e:  # not installed, or model download failed
        _embed_error = f"{type(e).__name__}: {e}"
    return _embed_model


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
            return self._json(200, {"faiss": True, "pymupdf": True, "embeddings": _embed_model is not None, "embeddingsModel": EMBED_MODEL_NAME, "embeddingsError": _embed_error, "rerank": _rerank_model is not None, "rerankModel": RERANK_MODEL_NAME, "rerankError": _rerank_error, "nli": _nli_model is not None, "nliModel": NLI_MODEL_NAME, "nliError": _nli_error})
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
        if self.path == "/embed":
            texts = body.get("texts")
            if not isinstance(texts, list) or not texts or not all(isinstance(t, str) for t in texts):
                return self._json(400, {"error": "texts must be a non-empty list of strings"})
            model = get_embed_model()
            if model is None:
                return self._json(503, {"error": f"embeddings unavailable: {_embed_error}"})
            vecs = model.encode(texts, normalize_embeddings=True)
            return self._json(200, {"model": EMBED_MODEL_NAME, "dim": int(vecs.shape[1]), "vectors": vecs.tolist()})
        if self.path == "/rerank":
            query = body.get("query")
            passages = body.get("passages")
            if not isinstance(query, str) or not isinstance(passages, list) or not passages or not all(isinstance(p, str) for p in passages):
                return self._json(400, {"error": "query and a non-empty passages list of strings are required"})
            model = get_rerank_model()
            if model is None:
                return self._json(503, {"error": f"rerank unavailable: {_rerank_error}"})
            scores = model.predict([(query, p) for p in passages])
            return self._json(200, {"model": RERANK_MODEL_NAME, "scores": [float(s) for s in scores]})
        if self.path == "/nli":
            pairs = body.get("pairs")
            if not isinstance(pairs, list) or not pairs or not all(isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) for x in p) for p in pairs):
                return self._json(400, {"error": "pairs must be a non-empty list of [premise, hypothesis] string pairs"})
            model, tokenizer = get_nli()
            if model is None:
                return self._json(503, {"error": f"nli unavailable: {_nli_error}"})
            import torch

            id2label = {int(k): str(v).lower() for k, v in model.config.id2label.items()}
            results = []
            with torch.no_grad():
                for premise, hypothesis in pairs:
                    inputs = tokenizer(premise, hypothesis, return_tensors="pt", truncation=True, max_length=512)
                    inputs = {k: v.to(model.device) for k, v in inputs.items()}
                    probs = torch.softmax(model(**inputs).logits[0], dim=-1).tolist()
                    best = max(range(len(probs)), key=lambda i: probs[i])
                    results.append({"label": id2label.get(best, "neutral"), "score": float(probs[best]),
                                    "scores": {id2label.get(i, str(i)): float(p) for i, p in enumerate(probs)}})
            return self._json(200, {"model": NLI_MODEL_NAME, "results": results})
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
