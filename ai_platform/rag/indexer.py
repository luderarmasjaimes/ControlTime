"""
Indexador RAG — SQLite FTS sobre ADR, SPEC, arquitectura y código clave.
"""
from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDEX_DIR = Path(__file__).parent / "data"
INDEX_DB = INDEX_DIR / "knowledge.db"

GLOB_PATTERNS = [
    # Log arquitectónico vigente y único (ADR-000 en adelante).
    "docs/decisions/*.md",
    # Log SDD temprano: se conserva e indexa solo como historia.
    "specs/adr/*.md",
    "specs/CONSTITUTION.md",
    "specs/REGISTRY.md",
    "specs/BACKLOG.md",
    "specs/*/spec.md",
    "specs/*/plan.md",
    "docs/02_Arquitectura/*.md",
    "AGENTS.md",
    "backend/src/**/*.hpp",
    "backend/src/**/*.cpp",
]


def _collect_files() -> list[Path]:
    files: list[Path] = []
    for pattern in GLOB_PATTERNS:
        files.extend(ROOT.glob(pattern))
    return sorted(set(f for f in files if f.is_file()))


def _chunk(text: str, size: int = 1200, overlap: int = 150) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        chunks.append(text[start:end])
        start = end - overlap if end < len(text) else len(text)
    return chunks or [text]


def build_index(force: bool = False) -> dict:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    if INDEX_DB.exists() and not force:
        return index_stats()

    if INDEX_DB.exists():
        INDEX_DB.unlink()

    conn = sqlite3.connect(INDEX_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE documents (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL,
            chunk_idx INTEGER NOT NULL,
            content TEXT NOT NULL,
            hash TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE documents_fts USING fts5(
            path, content, content='documents', content_rowid='id'
        );
        CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
            INSERT INTO documents_fts(rowid, path, content) VALUES (new.id, new.path, new.content);
        END;
    """)

    count = 0
    for fp in _collect_files():
        try:
            text = fp.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = str(fp.relative_to(ROOT)).replace("\\", "/")
        for i, chunk in enumerate(_chunk(text)):
            h = hashlib.sha256(chunk.encode()).hexdigest()[:16]
            conn.execute(
                "INSERT INTO documents (path, chunk_idx, content, hash) VALUES (?, ?, ?, ?)",
                (rel, i, chunk, h),
            )
            count += 1

    conn.commit()
    conn.close()

    from ai_platform.rag.vector import build_vectors
    vec_stats = build_vectors(force=True)
    return {"indexed_chunks": count, "db": str(INDEX_DB), "vectors": vec_stats}


def index_stats() -> dict:
    if not INDEX_DB.exists():
        return {"indexed_chunks": 0, "db": str(INDEX_DB)}
    conn = sqlite3.connect(INDEX_DB)
    n = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    paths = conn.execute("SELECT COUNT(DISTINCT path) FROM documents").fetchone()[0]
    conn.close()
    return {"indexed_chunks": n, "unique_paths": paths, "db": str(INDEX_DB)}
