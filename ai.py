"""Streaming prompt wrappers.

  - define_stream       (Ctrl+D):       simple-English dictionary entry.
  - korean_stream       (Ctrl+Shift+D): Korean meaning (한국어 뜻) of a word.
  - explain_stream      (Ctrl+E):       explain a sentence in simple English.
  - grammar_stream      (Ctrl+G):       grammatical breakdown of a sentence.
  - collocations_stream (Ctrl+L):       natural usage / collocations of a word.
  - paraphrase_stream   (Ctrl+R):       rewrite a hard sentence in simpler English.

To extend further:
  - RAG chat: re-introduce an embeddings helper in llm_client and a rag module,
    then add chat_stream() + /api/chat.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Iterator

import llm_client

# When frozen by PyInstaller, load prompts from beside the .exe so they stay
# editable without rebuilding. Otherwise use the source directory.
if getattr(sys, "frozen", False):
    _BASE_DIR = Path(sys.executable).parent
else:
    _BASE_DIR = Path(__file__).parent
_PROMPTS_DIR = _BASE_DIR / "prompts"


def _load(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8").strip()


def _stream(action: str, **fields: str) -> Iterator[str]:
    """Stream a lookup: fill <action>.user.txt with `fields`, prepend its system
    prompt, and yield tokens. All fields are stripped before formatting."""
    user = _load(f"{action}.user.txt").format(
        **{k: v.strip() for k, v in fields.items()}
    )
    yield from llm_client.stream_messages([
        {"role": "system", "content": _load(f"{action}.system.txt")},
        {"role": "user", "content": user},
    ])


def define_stream(word: str, before: str, after: str) -> Iterator[str]:
    return _stream("define", word=word, before=before, after=after)


def korean_stream(word: str, before: str, after: str) -> Iterator[str]:
    return _stream("korean", word=word, before=before, after=after)


def explain_stream(sentence: str, before: str, after: str) -> Iterator[str]:
    return _stream("explain", sentence=sentence, before=before, after=after)


def grammar_stream(sentence: str, before: str, after: str) -> Iterator[str]:
    return _stream("grammar", sentence=sentence, before=before, after=after)


def collocations_stream(word: str, before: str, after: str) -> Iterator[str]:
    return _stream("collocations", word=word, before=before, after=after)


def paraphrase_stream(sentence: str, before: str, after: str) -> Iterator[str]:
    return _stream("paraphrase", sentence=sentence, before=before, after=after)


# ── Knowledge graph (Ctrl+K) ──────────────────────────────────────────────────
# These use literal-token substitution (``[[TEXT]]``) instead of ``str.format``
# because the prompts and page content contain ``{`` / ``}`` braces.

# Cap how much page text we send so a long article stays within the model's
# context window. Roughly ~4 chars per token, so this is on the order of 8k tokens.
_MAX_PAGE_CHARS = 32_000


def _fill(template: str, **tokens: str) -> str:
    out = template
    for key, value in tokens.items():
        out = out.replace(f"[[{key}]]", value)
    return out


def _clip(text: str) -> str:
    text = (text or "").strip()
    if len(text) > _MAX_PAGE_CHARS:
        text = text[:_MAX_PAGE_CHARS] + "\n\n[... page truncated ...]"
    return text


def _strip_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s).strip()
    return s


def _repair_json(s: str) -> str:
    """Best-effort cleanup of common model JSON glitches before re-parsing:
    strip // and /* */ comments, and remove trailing commas before ] or }."""
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.DOTALL)       # block comments
    s = re.sub(r"(?m)//.*$", "", s)                          # line comments
    s = re.sub(r",(\s*[}\]])", r"\1", s)                     # trailing commas
    return s


def _extract_json(raw: str) -> dict[str, Any]:
    """Parse the model's JSON, tolerating code fences, comments, trailing commas,
    or stray prose around the object."""
    s = _strip_fences(raw)
    # Narrow to the outermost object if there's surrounding prose.
    start, end = s.find("{"), s.rfind("}")
    candidate = s[start : end + 1] if (start != -1 and end > start) else s
    for attempt in (s, candidate, _repair_json(candidate)):
        try:
            return json.loads(attempt)
        except json.JSONDecodeError:
            continue
    # Re-raise the error from the most-cleaned attempt for a useful message.
    return json.loads(_repair_json(candidate))


def _normalize_graph(data: dict[str, Any]) -> dict[str, Any]:
    """Keep only well-formed nodes/edges and drop edges to unknown nodes."""
    nodes = []
    seen: set[str] = set()
    for n in data.get("nodes", []) or []:
        nid = str(n.get("id", "")).strip()
        if not nid or nid in seen:
            continue
        seen.add(nid)
        nodes.append({
            "id": nid,
            "label": str(n.get("label", nid)).strip() or nid,
            "type": str(n.get("type", "other")).strip().lower() or "other",
        })
    edges = []
    for e in data.get("edges", []) or []:
        src, tgt = str(e.get("source", "")).strip(), str(e.get("target", "")).strip()
        if src in seen and tgt in seen and src != tgt:
            edges.append({"source": src, "target": tgt, "label": str(e.get("label", "")).strip()})
    return {"summary": str(data.get("summary", "")).strip(), "nodes": nodes, "edges": edges}


def graph_extract(text: str, title: str) -> dict[str, Any]:
    """Extract a knowledge graph ({summary, nodes, edges}) from page text."""
    user = _fill(_load("graph.user.txt"), TITLE=title.strip() or "(untitled)", TEXT=_clip(text))
    raw = llm_client.complete_messages(
        [
            {"role": "system", "content": _load("graph.system.txt")},
            {"role": "user", "content": user},
        ],
        json_mode=True,      # force a valid JSON object (avoids prose/comments)
        max_tokens=4096,     # enough room for a 20-node / 30-edge graph
    )
    return _normalize_graph(_extract_json(raw))


def node_summary_stream(label: str, text: str) -> Iterator[str]:
    """Stream a plain-English summary of one entity, grounded in the page."""
    user = _fill(_load("graph_summary.user.txt"), LABEL=label.strip(), TEXT=_clip(text))
    return llm_client.stream_messages([
        {"role": "system", "content": _load("graph_summary.system.txt")},
        {"role": "user", "content": user},
    ])


def graph_chat_stream(question: str, text: str, title: str) -> Iterator[str]:
    """Stream an answer to a free-form question, grounded in the page."""
    user = _fill(
        _load("graph_chat.user.txt"),
        TITLE=title.strip() or "(untitled)", TEXT=_clip(text), QUESTION=question.strip(),
    )
    return llm_client.stream_messages([
        {"role": "system", "content": _load("graph_chat.system.txt")},
        {"role": "user", "content": user},
    ])


# ── Study guide + Ask tutor (side panel) ──────────────────────────────────────
# Like the graph helpers, these use ``[[TOKEN]]`` substitution because the page
# text can contain ``{`` / ``}`` braces. Both are stateless: the side panel sends
# the page text with each request (cheap over local loopback), so no storage is
# needed. The tutor also carries a short conversation history for follow-ups.


def study_guide_stream(title: str, text: str) -> Iterator[str]:
    """Stream a learner-oriented study guide for a page, grounded in its text."""
    user = _fill(_load("study.user.txt"), TITLE=title.strip() or "(untitled)", TEXT=_clip(text))
    return llm_client.stream_messages([
        {"role": "system", "content": _load("study.system.txt")},
        {"role": "user", "content": user},
    ])


def _format_history(history: list[dict[str, Any]] | None, n_pairs: int = 4) -> str:
    """Render the last ``n_pairs`` user/assistant turns as plain ``You:`` /
    ``Tutor:`` lines. Returns an empty marker when there is no prior turn."""
    turns = [t for t in (history or []) if str(t.get("content", "")).strip()]
    turns = turns[-(n_pairs * 2):]
    if not turns:
        return "(no previous messages)"
    lines = []
    for t in turns:
        who = "You" if str(t.get("role", "")).lower() == "user" else "Tutor"
        lines.append(f"{who}: {str(t.get('content', '')).strip()}")
    return "\n".join(lines)


def tutor_stream(
    question: str, text: str, title: str, history: list[dict[str, Any]] | None = None
) -> Iterator[str]:
    """Stream a tutor's answer to a question about the page, with follow-up context."""
    user = _fill(
        _load("tutor.user.txt"),
        TITLE=title.strip() or "(untitled)", TEXT=_clip(text),
        HISTORY=_format_history(history), QUESTION=question.strip(),
    )
    return llm_client.stream_messages([
        {"role": "system", "content": _load("tutor.system.txt")},
        {"role": "user", "content": user},
    ])
