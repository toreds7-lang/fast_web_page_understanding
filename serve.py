"""FastAPI backend for the Ctrl+D dictionary Chrome extension.

Minimal build: a single /api/define endpoint that streams a simple-English
dictionary entry for the selected word, plus a health check. Designed to be
extended later (Ctrl+E explain, RAG chat) — see ai.py for notes.
"""
import argparse
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import ai
import graph_store
import store

# Frozen-aware base dir (matches config.py / ai.py) for static files.
if getattr(sys, "frozen", False):
    _BASE_DIR = Path(sys.executable).parent
else:
    _BASE_DIR = Path(__file__).parent


class DefineBody(BaseModel):
    word: str
    before: str = ""
    after: str = ""


class ExplainBody(BaseModel):
    sentence: str
    before: str = ""
    after: str = ""


class SaveBody(BaseModel):
    text: str
    kind: str = "define"
    context: str = ""
    content: str = ""
    url: str = ""
    title: str = ""


class ReviewBody(BaseModel):
    id: str
    grade: int


class GraphBuildBody(BaseModel):
    text: str
    title: str = ""
    url: str = ""


class GraphSummaryBody(BaseModel):
    id: str
    label: str


class GraphChatBody(BaseModel):
    id: str
    question: str


def build_app() -> FastAPI:
    app = FastAPI(title="Ctrl+D Dictionary API")

    # The content script runs on arbitrary article pages and fetches this
    # local server, so cross-origin requests must be allowed.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/api/define")
    def api_define(body: DefineBody) -> StreamingResponse:
        if not body.word.strip():
            raise HTTPException(400, "word is empty")
        return StreamingResponse(
            ai.define_stream(body.word, body.before, body.after),
            media_type="text/plain; charset=utf-8",
        )

    @app.post("/api/explain")
    def api_explain(body: ExplainBody) -> StreamingResponse:
        if not body.sentence.strip():
            raise HTTPException(400, "sentence is empty")
        return StreamingResponse(
            ai.explain_stream(body.sentence, body.before, body.after),
            media_type="text/plain; charset=utf-8",
        )

    @app.post("/api/grammar")
    def api_grammar(body: ExplainBody) -> StreamingResponse:
        if not body.sentence.strip():
            raise HTTPException(400, "sentence is empty")
        return StreamingResponse(
            ai.grammar_stream(body.sentence, body.before, body.after),
            media_type="text/plain; charset=utf-8",
        )

    @app.post("/api/collocations")
    def api_collocations(body: DefineBody) -> StreamingResponse:
        if not body.word.strip():
            raise HTTPException(400, "word is empty")
        return StreamingResponse(
            ai.collocations_stream(body.word, body.before, body.after),
            media_type="text/plain; charset=utf-8",
        )

    @app.post("/api/paraphrase")
    def api_paraphrase(body: ExplainBody) -> StreamingResponse:
        if not body.sentence.strip():
            raise HTTPException(400, "sentence is empty")
        return StreamingResponse(
            ai.paraphrase_stream(body.sentence, body.before, body.after),
            media_type="text/plain; charset=utf-8",
        )

    @app.post("/api/korean")
    def api_korean(body: DefineBody) -> StreamingResponse:
        if not body.word.strip():
            raise HTTPException(400, "word is empty")
        return StreamingResponse(
            ai.korean_stream(body.word, body.before, body.after),
            media_type="text/plain; charset=utf-8",
        )

    # ── Saved words + spaced repetition ──────────────────────────────────────

    @app.post("/api/save")
    def api_save(body: SaveBody) -> JSONResponse:
        if not body.text.strip():
            raise HTTPException(400, "text is empty")
        card = store.add_card(
            text=body.text, kind=body.kind, context=body.context,
            content=body.content, url=body.url, title=body.title,
        )
        return JSONResponse({"ok": True, "id": card["id"]})

    @app.get("/api/cards")
    def api_cards(due: int = 0) -> JSONResponse:
        return JSONResponse({
            "cards": store.list_cards(due_only=bool(due)),
            "stats": store.stats(),
        })

    @app.post("/api/review")
    def api_review(body: ReviewBody) -> JSONResponse:
        card = store.review_card(body.id, body.grade)
        if card is None:
            raise HTTPException(404, "card not found")
        return JSONResponse({"ok": True, "card": card})

    @app.delete("/api/cards/{card_id}")
    def api_delete(card_id: str) -> JSONResponse:
        if not store.delete_card(card_id):
            raise HTTPException(404, "card not found")
        return JSONResponse({"ok": True})

    @app.get("/api/export.csv")
    def api_export() -> PlainTextResponse:
        return PlainTextResponse(
            store.to_csv(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=saved_words.csv"},
        )

    @app.get("/review")
    def review_page() -> FileResponse:
        path = _BASE_DIR / "review.html"
        if not path.exists():
            raise HTTPException(404, "review.html not found")
        return FileResponse(path)

    # ── Knowledge graph (Ctrl+K) ──────────────────────────────────────────────

    @app.post("/api/graph/build")
    def api_graph_build(body: GraphBuildBody) -> JSONResponse:
        if not body.text.strip():
            raise HTTPException(400, "text is empty")
        try:
            graph = ai.graph_extract(body.text, body.title)
        except Exception as exc:  # extraction or JSON parse failed
            raise HTTPException(502, f"graph extraction failed: {exc}")
        if not graph.get("nodes"):
            raise HTTPException(502, "no entities could be extracted from this page")
        record = graph_store.add_graph(
            text=body.text, graph=graph, url=body.url, title=body.title
        )
        return JSONResponse({
            "id": record["id"], "graph": graph,
            "title": body.title, "url": body.url,
        })

    @app.get("/api/graph/{graph_id}")
    def api_graph_get(graph_id: str) -> JSONResponse:
        record = graph_store.get_graph(graph_id)
        if record is None:
            raise HTTPException(404, "graph not found")
        return JSONResponse({
            "id": record["id"], "graph": record["graph"],
            "title": record.get("title", ""), "url": record.get("url", ""),
        })

    @app.post("/api/graph/summary")
    def api_graph_summary(body: GraphSummaryBody) -> StreamingResponse:
        record = graph_store.get_graph(body.id)
        if record is None:
            raise HTTPException(404, "graph not found")
        if not body.label.strip():
            raise HTTPException(400, "label is empty")
        return StreamingResponse(
            ai.node_summary_stream(body.label, record["text"]),
            media_type="text/plain; charset=utf-8",
        )

    @app.post("/api/graph/chat")
    def api_graph_chat(body: GraphChatBody) -> StreamingResponse:
        record = graph_store.get_graph(body.id)
        if record is None:
            raise HTTPException(404, "graph not found")
        if not body.question.strip():
            raise HTTPException(400, "question is empty")
        return StreamingResponse(
            ai.graph_chat_stream(body.question, record["text"], record.get("title", "")),
            media_type="text/plain; charset=utf-8",
        )

    @app.get("/graph")
    def graph_page() -> FileResponse:
        path = _BASE_DIR / "graph.html"
        if not path.exists():
            raise HTTPException(404, "graph.html not found")
        return FileResponse(path)

    # Serve vendored assets (vis-network.min.js) for the graph page, offline.
    _static_dir = _BASE_DIR / "static"
    if _static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=_static_dir), name="static")

    @app.get("/api/health")
    def api_health() -> dict:
        return {"status": "ok"}

    @app.get("/")
    def index() -> HTMLResponse:
        return HTMLResponse(
            "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
            "<title>Ctrl+D Dictionary</title>"
            "<style>body{font-family:sans-serif;max-width:600px;margin:40px auto;"
            "padding:0 20px;color:#1f2937}h1{color:#4f46e5}"
            "code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style></head>"
            "<body><h1>Ctrl+D Dictionary</h1>"
            "<p>Server is running on <code>http://127.0.0.1:8765</code>.</p>"
            "<p>Load the Chrome extension from <code>chrome_extension/</code>, "
            "open any English article, select a word and press <code>Ctrl+D</code>.</p>"
            "</body></html>"
        )

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Ctrl+D dictionary backend")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    app = build_app()
    print(f"Ctrl+D dictionary server -> http://{args.host}:{args.port}", file=sys.stderr)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
