"""RAG — memoria del proyecto sobre fuentes arquitectónicas canónicas."""
from ai_platform.rag.indexer import build_index, index_stats
from ai_platform.rag.query import format_context, search
from ai_platform.rag.vector import build_vectors, vector_search

__all__ = [
    "build_index",
    "index_stats",
    "search",
    "format_context",
    "build_vectors",
    "vector_search",
]
