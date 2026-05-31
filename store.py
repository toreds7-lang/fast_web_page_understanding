"""Saved-word storage with simple spaced repetition (SM-2-style).

Cards are kept in a single JSON file (`saved.json`) next to the app, so there is
no extra dependency. Each card records the looked-up text, the generated
explanation, where it came from, and its review schedule.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import threading
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Any

# Same frozen-aware base dir convention as config.py / ai.py.
if getattr(sys, "frozen", False):
    _BASE_DIR = Path(sys.executable).parent
else:
    _BASE_DIR = Path(__file__).parent

_PATH = _BASE_DIR / "saved.json"
_lock = threading.Lock()

# Grade meaning: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy.
_MIN_EASE = 1.3


def _today() -> date:
    return date.today()


def _read() -> list[dict[str, Any]]:
    if not _PATH.exists():
        return []
    try:
        return json.loads(_PATH.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []


def _write(cards: list[dict[str, Any]]) -> None:
    _PATH.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def add_card(
    text: str,
    kind: str,
    context: str = "",
    content: str = "",
    url: str = "",
    title: str = "",
) -> dict[str, Any]:
    """Add a saved card, due immediately. De-duplicates on (text, kind)."""
    text = text.strip()
    card = {
        "id": uuid.uuid4().hex[:12],
        "text": text,
        "kind": kind,
        "context": context.strip(),
        "content": content.strip(),
        "url": url,
        "title": title,
        "created": _today().isoformat(),
        "due": _today().isoformat(),
        "interval": 0,
        "ease": 2.5,
        "reps": 0,
        "lapses": 0,
    }
    with _lock:
        cards = _read()
        # Refresh an existing card for the same text+kind instead of duplicating.
        for c in cards:
            if c.get("text") == text and c.get("kind") == kind:
                c["content"] = card["content"] or c.get("content", "")
                c["context"] = card["context"] or c.get("context", "")
                c["url"] = url or c.get("url", "")
                c["title"] = title or c.get("title", "")
                _write(cards)
                return c
        cards.append(card)
        _write(cards)
    return card


def list_cards(due_only: bool = False) -> list[dict[str, Any]]:
    cards = _read()
    if due_only:
        today = _today().isoformat()
        cards = [c for c in cards if c.get("due", today) <= today]
    # Due first, then most recently created.
    cards.sort(key=lambda c: (c.get("due", ""), c.get("created", "")))
    return cards


def _schedule(card: dict[str, Any], grade: int) -> None:
    ease = float(card.get("ease", 2.5))
    interval = int(card.get("interval", 0))
    reps = int(card.get("reps", 0))

    if grade <= 0:  # Again — reset, see it again today.
        card["reps"] = 0
        card["interval"] = 0
        card["ease"] = max(_MIN_EASE, ease - 0.20)
        card["lapses"] = int(card.get("lapses", 0)) + 1
        card["due"] = _today().isoformat()
        return

    if grade == 1:      # Hard
        ease = max(_MIN_EASE, ease - 0.15)
    elif grade == 3:    # Easy
        ease = ease + 0.15

    if reps == 0:
        interval = 1 if grade == 1 else (1 if grade == 2 else 4)
    elif reps == 1:
        interval = 3 if grade == 1 else (6 if grade == 2 else 8)
    else:
        mult = ease * (0.8 if grade == 1 else (1.0 if grade == 2 else 1.3))
        interval = max(1, round(interval * mult))

    card["ease"] = round(ease, 2)
    card["interval"] = interval
    card["reps"] = reps + 1
    card["due"] = (_today() + timedelta(days=interval)).isoformat()


def review_card(card_id: str, grade: int) -> dict[str, Any] | None:
    with _lock:
        cards = _read()
        for c in cards:
            if c.get("id") == card_id:
                _schedule(c, int(grade))
                _write(cards)
                return c
    return None


def delete_card(card_id: str) -> bool:
    with _lock:
        cards = _read()
        new = [c for c in cards if c.get("id") != card_id]
        if len(new) == len(cards):
            return False
        _write(new)
    return True


def stats() -> dict[str, int]:
    cards = _read()
    today = _today().isoformat()
    return {
        "total": len(cards),
        "due": sum(1 for c in cards if c.get("due", today) <= today),
    }


def to_csv() -> str:
    """Anki-friendly CSV: front = text + context, back = explanation."""
    out = io.StringIO()
    writer = csv.writer(out)
    for c in _read():
        front = c.get("text", "")
        context = c.get("context", "")
        if context:
            front = f"{front}\n\n({context})"
        writer.writerow([front, c.get("content", ""), c.get("kind", "")])
    return out.getvalue()
