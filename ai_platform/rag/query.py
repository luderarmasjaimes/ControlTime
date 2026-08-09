"""Consultas RAG — FTS + búsqueda vectorial TF-IDF."""
from __future__ import annotations

import re
import sqlite3

from ai_platform.rag.indexer import INDEX_DB, build_index
from ai_platform.rag.vector import build_vectors, vector_search

MAX_RESULTS = 8


def _authoritative_identifier_hits(query: str) -> list[dict]:
    """Resolve explicit ADR identifiers against the canonical log first."""
    if not INDEX_DB.exists():
        return []
    numbers = re.findall(r"\bADR[-\s]?(\d{3})\b", query, re.IGNORECASE)
    if not numbers:
        return []
    conn = sqlite3.connect(INDEX_DB)
    conn.row_factory = sqlite3.Row
    hits: list[dict] = []
    for number in dict.fromkeys(numbers):
        row = conn.execute(
            """
            SELECT path, chunk_idx, substr(content, 1, 400) AS snippet
            FROM documents
            WHERE path LIKE ? AND chunk_idx = 0
            ORDER BY path
            LIMIT 1
            """,
            (f"docs/decisions/{number}-%",),
        ).fetchone()
        if row:
            hits.append({
                "path": row["path"],
                "chunk": row["chunk_idx"],
                "snippet": row["snippet"],
                "source": "canonical-id",
            })
    conn.close()
    return hits


def search_fts(query: str, limit: int = MAX_RESULTS) -> list[dict]:
    if not INDEX_DB.exists():
        build_index()

    conn = sqlite3.connect(INDEX_DB)
    conn.row_factory = sqlite3.Row
    q = query.replace('"', '""')
    try:
        rows = conn.execute(
            """
            SELECT d.path, d.chunk_idx, snippet(documents_fts, 1, '>>>', '<<<', '...', 40) AS snippet
            FROM documents_fts
            JOIN documents d ON documents_fts.rowid = d.id
            WHERE documents_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (q, limit),
        ).fetchall()
    except sqlite3.OperationalError:
        rows = conn.execute(
            """
            SELECT path, chunk_idx, substr(content, 1, 300) AS snippet
            FROM documents
            WHERE content LIKE ?
            LIMIT ?
            """,
            (f"%{query}%", limit),
        ).fetchall()
    conn.close()

    return [
        {"path": r["path"], "chunk": r["chunk_idx"], "snippet": r["snippet"], "source": "fts"}
        for r in rows
    ]


def search(query: str, limit: int = MAX_RESULTS) -> list[dict]:
    """Híbrido FTS + vector (deduplicado por path+chunk)."""
    fts_hits = search_fts(query, limit)
    if INDEX_DB.exists():
        build_vectors()
    vec_hits = vector_search(query, limit)
    seen: set[tuple[str, int]] = set()
    merged: list[dict] = []
    # Exact identifiers (ADR-072, SPEC-014, tenant_id) must win over a merely
    # similar historical document. This is especially important now that the
    # index intentionally retains superseded ADRs for auditability.
    for hit in _authoritative_identifier_hits(query) + fts_hits + vec_hits:
        key = (hit["path"], hit["chunk"])
        if key in seen:
            continue
        seen.add(key)
        merged.append(hit)
        if len(merged) >= limit:
            break
    return merged


def format_context(query: str, limit: int = MAX_RESULTS) -> str:
    hits = search(query, limit)
    if not hits:
        return f"_Sin resultados RAG para: {query}_"
    lines = [f"# Contexto RAG: {query}", ""]
    for h in hits:
        src = h.get("source", "?")
        score = f" score={h['score']}" if "score" in h else ""
        lines.append(f"## `{h['path']}` (chunk {h['chunk']}, {src}{score})")
        lines.append(h["snippet"])
        lines.append("")
    return "\n".join(lines)
