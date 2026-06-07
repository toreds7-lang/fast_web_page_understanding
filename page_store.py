"""In-memory cache of page text for the Study guide & Tutor side panel.

The side panel ingests a page's text once (``POST /api/page``) and then references
it by id on every study-guide and tutor call, so the full page text isn't re-sent
each turn — only a 12-char id travels with each request.

Unlike ``graph_store`` (which persists to ``graphs.json`` because the graph page
can be reopened later), this is kept **in memory**: tutor sessions are ephemeral
and we don't want to write a file for every page the user opens. The id is a
content hash, so re-ingesting the same text is idempotent. The cache is bounded to
the most recently used pages; on a miss (server restart or eviction) the side
panel simply re-ingests and retries.
"""
from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from typing import Any

# How many distinct pages to keep. Each entry is just the page text + a little
# metadata, so this stays small in memory while comfortably covering a session.
_MAX_PAGES = 64

_lock = threading.Lock()
_pages: "OrderedDict[str, dict[str, Any]]" = OrderedDict()


def _page_id(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def put(text: str, title: str = "", url: str = "") -> str:
    """Cache page text and return its content-hash id (idempotent)."""
    pid = _page_id(text)
    with _lock:
        _pages[pid] = {"text": text, "title": title, "url": url}
        _pages.move_to_end(pid)              # mark as most-recently used
        while len(_pages) > _MAX_PAGES:
            _pages.popitem(last=False)       # evict the least-recently used
    return pid


def get(page_id: str) -> dict[str, Any] | None:
    """Return the cached record for ``page_id`` (and mark it recently used)."""
    with _lock:
        rec = _pages.get(page_id)
        if rec is not None:
            _pages.move_to_end(page_id)
        return rec
