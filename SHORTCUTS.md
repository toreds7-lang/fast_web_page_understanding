# ⌨️ Shortcuts — English Reading Helper

Select text on any web page, then press a shortcut. A popup streams the result
next to your selection.

## Lookups

| Shortcut | Action | Select | In popup |
|----------|--------|--------|----------|
| **Ctrl + D** | Dictionary definition (simple English) | a word/phrase | 🔊 speak · ☆ save |
| **Ctrl + Shift + D** | Korean meaning (한국어 뜻) | a word/phrase | 🔊 speak · ☆ save |
| **Ctrl + L** | Collocations (natural usage) | a word | 🔊 speak · ☆ save |
| **Ctrl + E** | Explain the sentence (3 sentences of context) | a sentence | ☆ save |
| **Ctrl + G** | Grammar breakdown | a sentence | ☆ save |
| **Ctrl + R** | Rewrite in simpler English | a hard sentence/paragraph | — |
| **Ctrl + P** | Pronounce aloud (offline text-to-speech); press again to stop | anything | 🔊 Normal · 🐢 Slow |

## Whole page (no selection)

| Shortcut | Action | Where |
|----------|--------|-------|
| **Ctrl + Shift + K** | 🕸️ Build a knowledge graph of the page | new tab: click a node → entity summary · 💬 chat → ask about the page |
| **Ctrl + Shift + S** | 📚 Open the Study guide & Tutor side panel | side panel: 📋 study guide (auto) · 💬 ask tutor · 🔊 read aloud |

The side panel also opens by clicking the extension's toolbar icon. It reads the
current tab's text, auto-generates a learner **study guide** (main idea, key
vocabulary, structure, what to focus on), and lets you **ask a tutor** questions
about the page (the tutor uses the page plus general English teaching). **🔊 Read
aloud** uses the browser's built-in voice — no server or API needed.

## Help

| Shortcut | Action |
|----------|--------|
| **F1** | Show / hide an on-page overlay listing every shortcut |

## In a popup

| Key / Button | Action |
|--------------|--------|
| **🔊** | Speak the word aloud (Define / Korean / Collocations) |
| **☆ Save** | Add to your spaced-repetition deck |
| **Esc** | Close the popup |
| click outside | Close the popup |

## Review page — <http://127.0.0.1:8766/review>

| Key | Action |
|-----|--------|
| **Space** | Show the answer |
| **1** | Again (see it again soon) |
| **2** | Hard |
| **3** | Good |
| **4** | Easy |

## Notes

- These keys are also browser shortcuts (bookmark, address bar, print, reload…).
  The extension only overrides them **when text is selected** — with nothing
  selected, the normal browser shortcut still works.
- If your browser claims a key (e.g. **Ctrl + L**), rebind it in
  `chrome_extension/content_script.js` (the `switch (k)` block).
- **Ctrl + Shift + K** and **Ctrl + Shift + S** are registered as **extension
  commands** (manifest `commands`, handled by `background.js`) rather than page
  keys. Verify or rebind them at `chrome://extensions/shortcuts`.
- LLM lookups need the backend running (`serve.py`, port 8766). **Ctrl + P**
  pronunciation works offline.
