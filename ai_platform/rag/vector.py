"""
Índice vectorial TF-IDF — capa semántica sobre FTS canónico.
"""
from __future__ import annotations

import json
import math
import re
import sqlite3
from collections import Counter
from pathlib import Path

from ai_platform.rag.indexer import INDEX_DB, INDEX_DIR

VECTOR_META = INDEX_DIR / "vectors.json"


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-ZáéíóúñÁÉÍÓÚÑ0-9_]{3,}", text.lower())


def build_vectors(force: bool = False) -> dict:
    if not INDEX_DB.exists():
        return {"vectors": 0, "error": "Run rag index first"}

    if VECTOR_META.exists() and not force:
        return json.loads(VECTOR_META.read_text(encoding="utf-8"))

    conn = sqlite3.connect(INDEX_DB)
    rows = conn.execute("SELECT id, path, content FROM documents").fetchall()
    conn.close()

    doc_tokens: dict[int, Counter] = {}
    df: Counter = Counter()
    for doc_id, _path, content in rows:
        tokens = _tokenize(content)
        doc_tokens[doc_id] = Counter(tokens)
        for t in set(tokens):
            df[t] += 1

    n_docs = max(len(rows), 1)
    vectors: dict[str, dict[str, float]] = {}
    for doc_id, counts in doc_tokens.items():
        vec: dict[str, float] = {}
        total = sum(counts.values()) or 1
        for term, cnt in counts.items():
            tf = cnt / total
            idf = math.log((n_docs + 1) / (df[term] + 1)) + 1
            vec[term] = tf * idf
        vectors[str(doc_id)] = vec

    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    meta = {"vectors": len(vectors), "vocabulary_size": len(df)}
    VECTOR_META.write_text(json.dumps({"meta": meta, "vectors": vectors}), encoding="utf-8")
    return meta


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a.get(k, 0) * b.get(k, 0) for k in set(a) | set(b))
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def vector_search(query: str, limit: int = 8) -> list[dict]:
    if not VECTOR_META.exists():
        build_vectors()

    data = json.loads(VECTOR_META.read_text(encoding="utf-8"))
    vectors: dict[str, dict[str, float]] = data.get("vectors", {})
    q_tokens = _tokenize(query)
    q_counts = Counter(q_tokens)
    total = sum(q_counts.values()) or 1
    q_vec = {t: c / total for t, c in q_counts.items()}

    scored: list[tuple[float, int]] = []
    for doc_id, vec in vectors.items():
        scored.append((_cosine(q_vec, vec), int(doc_id)))
    scored.sort(reverse=True)

    conn = sqlite3.connect(INDEX_DB)
    conn.row_factory = sqlite3.Row
    results = []
    for score, doc_id in scored[: limit * 2]:
        if score < 0.01:
            continue
        row = conn.execute(
            "SELECT path, chunk_idx, substr(content, 1, 400) AS snippet FROM documents WHERE id = ?",
            (doc_id,),
        ).fetchone()
        if row:
            results.append({
                "path": row["path"],
                "chunk": row["chunk_idx"],
                "snippet": row["snippet"],
                "score": round(score, 4),
                "source": "vector",
            })
        if len(results) >= limit:
            break
    conn.close()
    return results
