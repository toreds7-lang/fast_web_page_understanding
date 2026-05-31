"""Storage for built knowledge graphs.

Each built page is kept in a single JSON file (`graphs.json`) next to the app,
mirroring the no-dependency approach of `store.py`. A record holds the source
page text (so node summaries and chat can be grounded in it) and the extracted
{summary, nodes, edges} graph.
"""
from __future__ import annotations

import json
import sys
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

# Same frozen-aware base dir convention as config.py / store.py.
if getattr(sys, "frozen", False):
    _BASE_DIR = Path(sys.executable).parent
else:
    _BASE_DIR = Path(__file__).parent

_PATH = _BASE_DIR / "graphs.json"
_lock = threading.Lock()

# Keep storage bounded — drop the oldest graphs past this many.
_MAX_GRAPHS = 100


def _read() -> list[dict[str, Any]]:
    if not _PATH.exists():
        return []
    try:
        return json.loads(_PATH.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []


def _write(graphs: list[dict[str, Any]]) -> None:
    _PATH.write_text(json.dumps(graphs, ensure_ascii=False, indent=2), encoding="utf-8")


def add_graph(text: str, graph: dict[str, Any], url: str = "", title: str = "") -> dict[str, Any]:
    """Persist a built graph and return its record (including the new id)."""
    record = {
        "id": uuid.uuid4().hex[:12],
        "url": url,
        "title": title,
        "text": text,
        "graph": graph,
        "created": datetime.now().isoformat(timespec="seconds"),
    }
    with _lock:
        graphs = _read()
        graphs.append(record)
        if len(graphs) > _MAX_GRAPHS:
            graphs = graphs[-_MAX_GRAPHS:]
        _write(graphs)
    return record


def get_graph(graph_id: str) -> dict[str, Any] | None:
    for g in _read():
        if g.get("id") == graph_id:
            return g
    return None
