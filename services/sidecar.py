"""TruthLens sidecar: FAISS index service + PDF page renderer for OCR.

Run:  .venv/bin/python services/sidecar.py [port]   (default 8100)
Endpoints:
  GET  /health            -> {"faiss": true, "pymupdf": true}
  POST /faiss/add         {namespace, items:[{id, vector:[...]}]}
  POST /faiss/search      {namespace, vector:[...], k} -> {hits:[{id, score}]}
  POST /render            {pdfBase64} -> {pages:[{page, imageBase64}]}
  POST /embed             {texts:[...]} -> {model, dim, vectors} (503 when unavailable)
  POST /guard             {texts:[...]} -> {model, results:[{label, score}]} (503 when unavailable; Llama Prompt Guard 2)
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

# Hardening caps: the sidecar is localhost-bound with no auth, so every
# count a client controls gets a bound before any work is allocated.
MAX_BODY_BYTES = 200_000_000
MAX_ADD_ITEMS = 1000
MAX_TEXTS = 100
MAX_PASSAGES = 100
MAX_PAIRS = 100


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


GUARD_MODEL_NAME = os.environ.get("TRUTHLENS_GUARD_MODEL", "meta-llama/Llama-Prompt-Guard-2-86M")
_guard_model = None
_guard_tokenizer = None
_guard_error = None

# Prompt Guard 2 sees at most 512 tokens, so long passages are scanned
# in character segments and one malicious segment condemns the text.
GUARD_SEGMENT_CHARS = 1800


def get_guard():
    """Lazy Prompt Guard 2 load (gated meta-llama weights: needs an HF
    token that accepted the licence), same failure policy as NLI."""
    global _guard_model, _guard_tokenizer, _guard_error
    if _guard_model is not None:
        return _guard_model, _guard_tokenizer
    try:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        device = os.environ.get("TRUTHLENS_EMBED_DEVICE", "cpu")
        _guard_tokenizer = AutoTokenizer.from_pretrained(GUARD_MODEL_NAME)
        _guard_model = AutoModelForSequenceClassification.from_pretrained(GUARD_MODEL_NAME).to(device)
        _guard_model.eval()
    except Exception as e:
        _guard_error = f"{type(e).__name__}: {e}"
    return _guard_model, _guard_tokenizer


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
    idx, ids = None, []
    if os.path.exists(path) and os.path.exists(ids_path):
        try:
            with open(ids_path) as f:
                ids = json.load(f)
            idx = faiss.read_index(path)
        except Exception as e:
            aside = f"{ids_path}.corrupt"
            try:
                os.replace(ids_path, aside)
            except OSError:
                pass
            print(f"[sidecar] corrupt index for {ns}, preserved at {aside}: {e}", file=sys.stderr)
            idx, ids = None, []
    INDEXES[ns] = (idx, ids)
    return INDEXES[ns]


def save_index(ns):
    idx, ids = INDEXES[ns]
    if idx is not None:
        path = os.path.join(DATA, f"{ns}.faiss")
        ids_path = os.path.join(DATA, f"{ns}.ids.json")
        faiss.write_index(idx, path + ".tmp")
        os.replace(path + ".tmp", path)
        with open(ids_path + ".tmp", "w") as f:
            json.dump(ids, f)
        os.replace(ids_path + ".tmp", ids_path)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"faiss": True, "pymupdf": True, "embeddings": _embed_model is not None, "embeddingsModel": EMBED_MODEL_NAME, "embeddingsError": _embed_error, "rerank": _rerank_model is not None, "rerankModel": RERANK_MODEL_NAME, "rerankError": _rerank_error, "nli": _nli_model is not None, "nliModel": NLI_MODEL_NAME, "nliError": _nli_error, "guard": _guard_model is not None, "guardModel": GUARD_MODEL_NAME, "guardError": _guard_error})
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
            declared = int(self.headers.get("content-length") or 0)
        except (TypeError, ValueError):
            return self._json(400, {"error": "bad content-length."})
        if declared > MAX_BODY_BYTES:
            return self._json(413, {"error": "request body too large (200 MB limit)."})
        try:
            body = json.loads((self.rfile.read(declared) if declared > 0 else b"") or b"{}")
        except Exception as e:
            return self._json(400, {"error": f"bad json: {e}"})
        if self.path == "/faiss/add":
            ns = check_namespace(body.get("namespace", "default"))
            items = body.get("items", [])
            if len(items) > MAX_ADD_ITEMS:
                return self._json(413, {"error": f"too many items (limit {MAX_ADD_ITEMS})."})
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
            if not all(isinstance(it, dict) and "vector" in it and "id" in it for it in items):
                raise ValueError("every item must carry id and vector")
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
            if "vector" not in body:
                raise ValueError("vector is required")
            vec = np.array([body["vector"]], dtype="float32")
            if vec.shape[1] != idx.d:
                raise ValueError(f"vector dimension {vec.shape[1]} does not match index dimension {idx.d}")
            faiss.normalize_L2(vec)
            k = max(1, min(int(body.get("k", 5)), idx.ntotal))
            scores, pos = idx.search(vec, k)
            hits = [{"id": ids[int(p)], "score": float(s)} for s, p in zip(scores[0], pos[0]) if p >= 0]
            return self._json(200, {"hits": hits})
        if self.path == "/embed":
            texts = body.get("texts")
            if not isinstance(texts, list) or not texts or not all(isinstance(t, str) for t in texts):
                return self._json(400, {"error": "texts must be a non-empty list of strings"})
            if len(texts) > MAX_TEXTS:
                return self._json(413, {"error": f"too many texts (limit {MAX_TEXTS})."})
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
            if len(passages) > MAX_PASSAGES:
                return self._json(413, {"error": f"too many passages (limit {MAX_PASSAGES})."})
            model = get_rerank_model()
            if model is None:
                return self._json(503, {"error": f"rerank unavailable: {_rerank_error}"})
            scores = model.predict([(query, p) for p in passages])
            return self._json(200, {"model": RERANK_MODEL_NAME, "scores": [float(s) for s in scores]})
        if self.path == "/nli":
            pairs = body.get("pairs")
            if not isinstance(pairs, list) or not pairs or not all(isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) for x in p) for p in pairs):
                return self._json(400, {"error": "pairs must be a non-empty list of [premise, hypothesis] string pairs"})
            if len(pairs) > MAX_PAIRS:
                return self._json(413, {"error": f"too many pairs (limit {MAX_PAIRS})."})
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
        if self.path == "/guard":
            texts = body.get("texts")
            if not isinstance(texts, list) or not texts or not all(isinstance(t, str) for t in texts):
                return self._json(400, {"error": "texts must be a non-empty list of strings"})
            if len(texts) > MAX_TEXTS:
                return self._json(413, {"error": f"too many texts (limit {MAX_TEXTS})."})
            model, tokenizer = get_guard()
            if model is None:
                return self._json(503, {"error": f"guard unavailable: {_guard_error}"})
            import torch

            id2label = {int(k): str(v).upper() for k, v in model.config.id2label.items()}
            mal_idx = next((i for i, label in id2label.items() if "MALICIOUS" in label or label == "LABEL_1"), None)
            results = []
            with torch.no_grad():
                for text in texts:
                    segments = [text[i:i + GUARD_SEGMENT_CHARS] for i in range(0, len(text), GUARD_SEGMENT_CHARS)] or [""]
                    mal_max, ben_min = 0.0, 1.0
                    for seg in segments:
                        inputs = tokenizer(seg, return_tensors="pt", truncation=True, max_length=512)
                        inputs = {k: v.to(model.device) for k, v in inputs.items()}
                        probs = torch.softmax(model(**inputs).logits[0], dim=-1).tolist()
                        if mal_idx is not None and mal_idx < len(probs):
                            mal_p = float(probs[mal_idx])
                        else:
                            best = max(range(len(probs)), key=lambda i: probs[i])
                            mal_p = float(probs[best]) if "MALICIOUS" in id2label.get(best, "") else 0.0
                        mal_max = max(mal_max, mal_p)
                        ben_min = min(ben_min, 1.0 - mal_p)
                    if mal_max >= 0.5:
                        results.append({"label": "MALICIOUS", "score": mal_max})
                    else:
                        results.append({"label": "BENIGN", "score": ben_min})
            return self._json(200, {"model": GUARD_MODEL_NAME, "results": results})
        if self.path == "/render":
            pdf = base64.b64decode(body.get("pdfBase64") or "")
            if len(pdf) > 25_000_000:
                return self._json(413, {"error": "PDF too large to render (25 MB limit)."})
            doc = None
            try:
                doc = pymupdf.open(stream=pdf, filetype="pdf")
                pages = []
                for i, page in enumerate(doc):
                    png = page.get_pixmap(dpi=150).tobytes("png")
                    pages.append({"page": i + 1, "imageBase64": base64.b64encode(png).decode()})
                return self._json(200, {"pages": pages})
            except Exception as e:
                return self._json(422, {"error": f"render failed: {e}"})
            finally:
                if doc is not None:
                    doc.close()
        return self._json(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8100
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
