# English Reading Helper

A Chrome extension + local Python backend for learning English while reading web
articles. Select text on any page and press a shortcut to get a simple-English
(or Korean) popup, then save words to a built-in spaced-repetition deck.

| Shortcut | What it does | Best on |
|----------|--------------|---------|
| **Ctrl+D** | Simple-English dictionary definition | a word/phrase |
| **Ctrl+Shift+D** | Korean meaning (한국어 뜻) | a word/phrase |
| **Ctrl+E** | Explain the sentence (uses 3 sentences of context) | a sentence |
| **Ctrl+G** | Grammar breakdown | a sentence |
| **Ctrl+L** | Collocations / natural usage | a word |
| **Ctrl+R** | Rewrite in simpler English | a hard sentence/paragraph |
| **Ctrl+P** | Pronounce aloud (browser text-to-speech, free) | anything |
| **Ctrl+Shift+K** | Build a **knowledge graph** of the whole page (no selection) | any article |
| **Ctrl+Shift+S** | Open the **Study guide & Tutor** side panel (no selection) | any article |

Every popup (except simplify/pronounce) has a **☆ Save** button that adds the
item to a review deck. Review at <http://127.0.0.1:8766/review> or export to Anki.
Word popups (Define, Korean, Collocations) also have a **🔊** button that speaks
the word aloud (same offline text-to-speech as Ctrl+P).

**Ctrl+Shift+S** (or clicking the extension's toolbar icon) opens a **side panel**
beside the page. It reads the current tab's text and gives you two tools: a
**📋 study guide** that auto-summarizes the page for a learner (main idea, key
vocabulary, structure, what to focus on), and a **💬 ask-tutor** chat that answers
questions about the page and can also teach general English (grammar, vocabulary,
examples). The **🔊 Read aloud** buttons use the browser's built-in voice — no
server or API key needed.

**Ctrl+Shift+K** needs no selection. It sends the page's main text to the backend,
which asks the model to extract a knowledge graph (key entities + relationships),
then opens a new tab at `/graph` showing it as an interactive node/edge diagram.
**Click a node** for a model summary of that entity; use the **💬 chat popup** to
ask anything about the page (summaries, questions), answered only from that
page's content. The graph library is vendored locally
(`static/vis-network.min.js`), so the graph view works offline.

## How it works

```
Web page ──shortcut on selection──> content_script.js ──POST /api/<action>──>
   serve.py (FastAPI) ──> ai.<action>_stream ──> OpenAI gpt-4o (streamed)
        └── tokens stream back into the floating popup
   ☆ Save ──POST /api/save──> store.py (saved.json, SM-2 schedule)
   /review (review.html) ──> /api/cards, /api/review ──> spaced repetition

Web page ──Ctrl+K──> content_script.getPageText ──POST /api/graph/build──>
   serve.py ──> ai.graph_extract (LLM → JSON) ──> graph_store.py (graphs.json)
        └── new tab /graph?id=… (graph.html + static/vis-network.min.js)
              ├── click node ──POST /api/graph/summary──> streamed entity summary
              └── 💬 chat    ──POST /api/graph/chat────> streamed page Q&A

Toolbar / Ctrl+Shift+S ──> side panel (sidebar.html) ──get-page-text──> content_script
   panel ──POST /api/page (once)──> page_store (in-memory cache) ──> page_id
   ├── 📋 study  ──POST /api/study {page_id}──> ai.study_guide_stream ──> guide
   └── 💬 tutor  ──POST /api/tutor {page_id,history}──> ai.tutor_stream ──> answer
        └── 🔊 Read aloud = browser speechSynthesis (no server call)
```

- `content_script.js` captures the selection plus context. **Word** actions
  (define, Korean, collocations) use a ~250-char context window; **sentence**
  actions (explain, grammar, simplify) use whole sentences via
  `getSentenceContext`. Pronunciation uses the browser's built-in
  `speechSynthesis` — no server call, no API key.
- `serve.py` exposes the streaming lookup endpoints plus the saved-word API
  (`/api/save`, `/api/cards`, `/api/review`, `/api/export.csv`) and the
  `/review` page. CORS is open so the content script can reach `127.0.0.1:8766`.
- `ai.py` / `prompts/*.txt` build the per-action prompts, including the
  knowledge-graph extraction (`graph.*`), node summary (`graph_summary.*`) and
  page chat (`graph_chat.*`) prompts. Graph routes live in `serve.py` under
  `/api/graph/*`, and `graph.html` is served at `/graph`.
- The **side panel** (`chrome_extension/sidebar.html` + `sidebar.js`) is opened
  by the toolbar action / `Ctrl+Shift+S`. It runs in the extension origin (with
  `host_permissions`), so it streams `POST /api/study` and `/api/tutor` from the
  local server directly. The panel pulls the page text once (via the content
  script's `get-page-text` reply), caches it on the server with `POST /api/page`,
  and then references it by `page_id` on every call — so the full text isn't
  re-sent each turn (the tutor only sends `page_id` + a short conversation
  history). `page_store.py` is an in-memory, content-hashed LRU cache; on a miss
  (server restart/eviction) the study/tutor route returns 404 and the panel
  re-ingests and retries. Prompts are `study.*` and `tutor.*`. Read-aloud uses
  the browser's `speechSynthesis` only.
- `store.py` persists saved cards to `saved.json` and schedules them with a
  simple SM-2 algorithm (grades: Again / Hard / Good / Easy).
- `graph_store.py` persists built graphs (and their source text) to
  `graphs.json` so the graph page, node summaries, and chat can reload them.
- `config.py` reads `env.txt` (`OPENAI_API_KEY`, `LLM_MODEL`).

## File layout

```
web_play_ground/
├── env.txt                     # OPENAI_API_KEY, LLM_MODEL=gpt-4o
├── config.py                   # loads env.txt
├── llm_client.py               # OpenAI streaming client
├── ai.py                       # *_stream() prompt wrappers
├── store.py                    # saved-word storage + SM-2 spaced repetition
├── graph_store.py              # built knowledge graphs (graphs.json)
├── page_store.py               # in-memory page-text cache for the side panel
├── serve.py                    # FastAPI: lookups + save/review + graph API
├── review.html                 # spaced-repetition review page
├── graph.html                  # interactive knowledge graph + chat popup
├── static/
│   └── vis-network.min.js      # vendored graph library (offline, no CDN)
├── saved.json                  # created on first save
├── graphs.json                 # created on first Ctrl+Shift+K
├── requirements.txt
├── prompts/                    # <action>.system.txt + <action>.user.txt
│   ├── define.* / korean.* / explain.* / grammar.*
│   ├── collocations.* / paraphrase.*
│   ├── graph.* / graph_summary.* / graph_chat.*
│   └── study.* / tutor.*       # side-panel study guide + tutor prompts
└── chrome_extension/
    ├── manifest.json
    ├── content_script.js       # shortcuts → popup → stream, ☆ Save button
    ├── background.js           # commands, side-panel open, local-server relay
    ├── sidebar.html            # Study guide & Tutor side panel
    ├── sidebar.js              # side-panel logic + browser read-aloud
    └── icons/
```

## Setup & run

1. Install dependencies into the existing virtual environment:

   ```powershell
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

2. Start the backend (leave it running while you read):

   ```powershell
   .\.venv\Scripts\python.exe serve.py
   ```

   Check it: open <http://127.0.0.1:8766/> for the shortcut list, or
   <http://127.0.0.1:8766/api/health> → `{"status":"ok"}`.

3. Load the extension in Chrome:
   - Go to `chrome://extensions`
   - Turn on **Developer mode** (top right)
   - Click **Load unpacked** and select `web_play_ground\chrome_extension`
   - After any code change, click **Reload** on the extension card.

4. Open any English article, select text, and use the shortcuts above. Click
   **☆ Save** to add a word, then visit
   <http://127.0.0.1:8766/review> to review. On the review page: **Space**
   reveals the answer, keys **1–4** grade it.

## Notes

- LLM output is generated by `gpt-4o`, so the backend must be running and the
  `OPENAI_API_KEY` in `env.txt` must be valid. Pronunciation works offline.
- These are also browser shortcuts (bookmark, address bar, print, reload…). The
  content script calls `preventDefault()` only when text is selected, so the
  normal shortcuts still work when nothing is selected. A few (e.g. Ctrl+L) may
  be claimed by the browser in some setups; rebind in `content_script.js` if so.
- The server runs on port **8766** (`serve.py --port` to change it). If you
  change it, update `API` in `content_script.js` and `host_permissions` in
  `manifest.json` to match.
- Saved words live in `saved.json` (plaintext). Spaced repetition uses an
  SM-2-style schedule; "Again" re-shows the card the same session.
