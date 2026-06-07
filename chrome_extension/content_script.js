/**
 * English reading helper content script. Select text, then:
 * - Ctrl+D        → simple-English dictionary definition of a word/phrase.
 * - Ctrl+Shift+D  → Korean meaning (한국어 뜻) of a word/phrase.
 * - Ctrl+E        → explain a sentence (uses 3 sentences of context).
 * - Ctrl+G        → grammar breakdown of a sentence.
 * - Ctrl+L        → collocations / natural usage of a word.
 * - Ctrl+R        → rewrite a hard sentence/paragraph in simpler English.
 * - Ctrl+P        → pronounce the selection aloud (browser text-to-speech);
 *                   press again while it's playing to stop (toggle, any language).
 * - Ctrl+Shift+K  → build a knowledge graph of the whole page and open it in a
 *                   new tab (with a chat popup to ask questions about the page).
 *                   Registered as an extension command (background.js), not here,
 *                   because plain Ctrl+K is reserved by the browser.
 * - F1            → show / hide a help overlay listing every shortcut.
 * Popups have a ☆ Save button → adds the word to a spaced-repetition deck
 * (review at http://127.0.0.1:8766/review).
 * Escape (or click outside) → close popup.
 */

const API = 'http://127.0.0.1:8766';

let activePopup = null;

// ── Selection helpers ────────────────────────────────────────────────────────

function getSelectionContext() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const text = sel.toString().trim();
  if (!text) return null;

  const range = sel.getRangeAt(0);
  const rect  = range.getBoundingClientRect();

  // Grab surrounding text so the definition matches the context.
  const container = range.commonAncestorContainer;
  const fullText  = container.textContent || container.nodeValue || '';
  const before = fullText.substring(
    Math.max(0, range.startOffset - 250), range.startOffset
  ).trim();
  const after = fullText.substring(
    range.endOffset, Math.min(fullText.length, range.endOffset + 250)
  ).trim();

  return { text, before, after, rect };
}

// Sentence-based context for "explain". Grabs up to `n` whole sentences before
// and after the selection, looking across the surrounding content block rather
// than a fixed character window.
function getSentenceContext(n = 3) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const text = sel.toString().trim();
  if (!text) return null;

  const range = sel.getRangeAt(0);
  const rect  = range.getBoundingClientRect();

  const container = getContextContainer(range.commonAncestorContainer);

  // Text from the start of the container up to the selection.
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(container);
  try { beforeRange.setEnd(range.startContainer, range.startOffset); } catch (_) {}
  const beforeFull = beforeRange.toString();

  // Text from the end of the selection to the end of the container.
  const afterRange = document.createRange();
  afterRange.selectNodeContents(container);
  try { afterRange.setStart(range.endContainer, range.endOffset); } catch (_) {}
  const afterFull = afterRange.toString();

  const sentencesBefore = splitSentences(beforeFull);
  const sentencesAfter  = splitSentences(afterFull);

  const before = sentencesBefore.slice(-n).join(' ').trim();
  const after  = sentencesAfter.slice(0, n).join(' ').trim();

  return { text, before, after, rect };
}

// Find a sensible content block around a node: prefer the article/main region,
// otherwise climb to an ancestor that holds a reasonable amount of text.
function getContextContainer(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el) return document.body;
  const main = el.closest && el.closest('article, main, [role="main"]');
  if (main) return main;
  while (el && el !== document.body) {
    if (el.textContent && el.textContent.trim().length >= 200) return el;
    el = el.parentElement;
  }
  return el || document.body;
}

// Split text into sentences. Keeps the ending punctuation on each sentence and
// tolerates a trailing fragment with no terminator.
function splitSentences(s) {
  const parts = (s || '').match(/[^.!?]*[.!?]+[)"'\]]*|\S[^.!?]*$/g);
  return parts ? parts.map((p) => p.trim()).filter(Boolean) : [];
}

// ── Popup ────────────────────────────────────────────────────────────────────

function removePopup() {
  if (activePopup) { activePopup.remove(); activePopup = null; }
}

function createPopup(title, rect, opts = {}) {
  removePopup();

  const popup = document.createElement('div');
  popup.setAttribute('data-ctrld-popup', '');
  popup.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'background:white',
    'border:1px solid #e5e7eb',
    'border-radius:10px',
    'padding:11px 13px',
    'max-width:380px',
    'min-width:220px',
    'max-height:280px',
    'overflow-y:auto',
    'box-shadow:0 8px 32px rgba(0,0,0,0.18)',
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    'font-size:13px',
    'line-height:1.55',
    'color:#1f2937',
  ].join(';');

  // Position near the selection, avoid running off-screen.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = rect.left;
  let y = rect.bottom + 8;
  if (x + 400 > vw) x = Math.max(8, vw - 400);
  if (y + 290 > vh) y = Math.max(8, rect.top - 295);
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;padding-bottom:6px;border-bottom:1px solid #f3f4f6';

  const titleEl = document.createElement('span');
  titleEl.textContent = title;
  titleEl.style.cssText = 'font-weight:600;color:#4f46e5;font-size:12px';

  const right = document.createElement('div');
  right.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0';

  if (typeof opts.onSpeak === 'function') {
    const speakBtn = document.createElement('button');
    speakBtn.textContent = '🔊';
    speakBtn.title = 'Speak the word';
    speakBtn.style.cssText = 'border:1px solid #e5e7eb;background:#f9fafb;cursor:pointer;font-size:12px;padding:2px 7px;border-radius:6px;line-height:1.4;font-family:inherit';
    speakBtn.onclick = () => opts.onSpeak();
    right.appendChild(speakBtn);
  }

  if (typeof opts.onSave === 'function') {
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '☆ Save';
    saveBtn.style.cssText = 'border:1px solid #e5e7eb;background:#f9fafb;cursor:pointer;color:#4f46e5;font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px;line-height:1.4;font-family:inherit';
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await opts.onSave();
        saveBtn.textContent = '★ Saved';
      } catch (err) {
        saveBtn.textContent = '⚠ Failed';
        saveBtn.disabled = false;
      }
    };
    right.appendChild(saveBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'border:none;background:none;cursor:pointer;color:#9ca3af;font-size:14px;padding:0 2px;line-height:1;font-family:inherit';
  closeBtn.onclick = removePopup;
  right.appendChild(closeBtn);

  hdr.appendChild(titleEl);
  hdr.appendChild(right);
  popup.appendChild(hdr);

  const content = document.createElement('div');
  popup.appendChild(content);

  document.body.appendChild(popup);
  activePopup = popup;

  // Click outside to dismiss.
  setTimeout(() => {
    document.addEventListener('click', function onOut(e) {
      if (activePopup && !activePopup.contains(e.target)) {
        removePopup();
        document.removeEventListener('click', onOut);
      }
    });
  }, 120);

  return content;
}

// Tiny Markdown → HTML (no external lib needed in a content script).
function simpleMd(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`([^`]+)`/g,     '<code style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:11px;font-family:monospace">$1</code>')
    .replace(/^\s*[-*]\s+/gm,  '• ')
    .replace(/\n\n+/g, '</p><p style="margin-top:6px">')
    .replace(/\n/g,    '<br>');
}

// Stream a lookup through the background worker. The request to 127.0.0.1 is
// made by the background (which has host_permissions and is exempt from Chrome's
// Local Network Access prompt); chunks are relayed back over a long-lived port
// since chrome.runtime.sendMessage can't stream.
function streamToPopup(contentEl, endpoint, body) {
  contentEl.innerHTML = '<span style="color:#9ca3af;font-size:12px">Loading…</span>';

  const port = chrome.runtime.connect({ name: 'stream' });
  let acc = '';
  let started = false;

  port.onMessage.addListener((m) => {
    if (m.chunk) {
      if (!started) { contentEl.innerHTML = ''; started = true; }
      acc += m.chunk;
      contentEl.innerHTML = '<p style="margin:0">' + simpleMd(acc) + '</p>';
    } else if (m.error) {
      contentEl.innerHTML =
        '<span style="color:#dc2626;font-size:12px">⚠️ ' + m.error +
        '<br><small>Is the server running? <code>python serve.py</code></small></span>';
    }
    // m.done just closes the stream; nothing more to render.
  });

  port.postMessage({ action: 'stream', endpoint, body });
}

// ── Save (spaced repetition) ──────────────────────────────────────────────────

async function saveCard(card) {
  // Routed through the background worker (see streamToPopup for why).
  const res = await chrome.runtime.sendMessage({
    action: 'save', endpoint: '/api/save', body: card,
  });
  if (!res || !res.ok) throw new Error((res && res.error) || 'save failed');
  return res.data;
}

// Word-centred lookups get a 🔊 speaker button that pronounces the selection.
const WORD_KINDS = new Set(['define', 'korean', 'collocations']);

// Run a streaming lookup: open a popup, stream the result, wire up the ☆ Save
// button (when `kind` is given) and a 🔊 speaker button (for word lookups).
function showStreamLookup(emoji, ctx, endpoint, body, kind) {
  const label = ctx.text.length > 40 ? ctx.text.slice(0, 40) + '…' : ctx.text;

  let contentEl;
  const opts = {};
  if (kind) {
    opts.onSave = () => saveCard({
      text: ctx.text,
      kind,
      context: (ctx.before + ' ' + ctx.text + ' ' + ctx.after)
        .replace(/\s+/g, ' ').trim().slice(0, 300),
      content: contentEl ? contentEl.innerText.trim() : '',
      url: location.href,
      title: document.title,
    });
  }
  if (WORD_KINDS.has(kind)) {
    opts.onSpeak = () => speak(ctx.text);
  }

  contentEl = createPopup(emoji + ' ' + label, ctx.rect, opts);
  streamToPopup(contentEl, endpoint, body);
}

// ── Pronunciation (free browser text-to-speech) ───────────────────────────────

function speak(text, rate) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate || 0.95;
    synth.speak(u);
    return true;
  } catch (e) {
    return false;
  }
}

function showPronounce(ctx) {
  const label = ctx.text.length > 60 ? ctx.text.slice(0, 60) + '…' : ctx.text;
  const contentEl = createPopup('🔊 ' + label, ctx.rect);

  if (!('speechSynthesis' in window)) {
    contentEl.innerHTML = '<span style="color:#dc2626;font-size:12px">This browser has no text-to-speech.</span>';
    return;
  }

  contentEl.innerHTML =
    '<div style="display:flex;gap:8px">' +
    '<button data-rate="0.95" style="flex:1;border:1px solid #e5e7eb;background:#f9fafb;cursor:pointer;color:#4f46e5;font-weight:600;padding:6px;border-radius:8px;font-family:inherit;font-size:13px">🔊 Normal</button>' +
    '<button data-rate="0.6" style="flex:1;border:1px solid #e5e7eb;background:#f9fafb;cursor:pointer;color:#4f46e5;font-weight:600;padding:6px;border-radius:8px;font-family:inherit;font-size:13px">🐢 Slow</button>' +
    '</div>';
  contentEl.querySelectorAll('button').forEach((b) => {
    b.onclick = () => speak(ctx.text, parseFloat(b.getAttribute('data-rate')));
  });

  speak(ctx.text, 0.95);   // speak once immediately
}

// ── Knowledge graph (Ctrl+Shift+K) ────────────────────────────────────────────

// Read the best readable text out of one document: prefer an article/main
// region, else the body.
function readableText(doc) {
  if (!doc) return '';
  let el = null;
  try {
    const main = doc.querySelector('article, main, [role="main"]');
    el = (main && main.innerText && main.innerText.trim().length > 200)
      ? main : doc.body;
  } catch (_) { return ''; }
  return el ? (el.innerText || '').trim() : '';
}

// Pull the page's main readable text. Some sites (e.g. Naver blog) load the real
// post inside a same-origin <iframe> (mainFrame) while the top page is mostly
// navigation/menus — and that nav text can be long, so we can't just gate on the
// top page being "thin". Instead, gather candidate text from the top document
// AND every accessible iframe, then keep the richest one. Cross-origin iframes
// are silently skipped.
function getPageText() {
  const candidates = [readableText(document)];

  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    let doc;
    try { doc = frame.contentDocument; } catch (_) { continue; }  // cross-origin
    candidates.push(readableText(doc));
  }

  const best = candidates.reduce((a, b) => (b.length > a.length ? b : a), '');
  return best.replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000);
}

async function buildGraph() {
  const text = getPageText();
  if (text.length < 80) {
    alert('This page has too little text to build a knowledge graph.');
    return;
  }

  // Open the tab synchronously (inside the message handler) to avoid popup
  // blockers, then redirect it once the graph is built.
  const tab = window.open('', '_blank');
  if (tab) {
    tab.document.write(
      '<title>Building knowledge graph…</title>' +
      '<body style="font-family:sans-serif;color:#4f46e5;display:flex;' +
      'align-items:center;justify-content:center;height:100vh;margin:0">' +
      '<div style="text-align:center"><div style="font-size:40px">🕸️</div>' +
      '<p>Building knowledge graph…</p>' +
      '<p style="color:#9ca3af;font-size:13px">Reading the page and asking the model.</p>' +
      '</div></body>');
  }

  // The actual request to the local server is made by the background worker, not
  // here. A fetch to 127.0.0.1 from this page's origin triggers Chrome's "Local
  // Network Access" permission prompt; the extension background has
  // host_permissions for the server and is exempt from that prompt.
  let res;
  try {
    res = await chrome.runtime.sendMessage({
      action: 'build-graph-fetch',
      text, title: document.title, url: location.href,
    });
  } catch (e) {
    res = { ok: false, error: e.message };
  }

  if (res && res.ok) {
    const url = API + '/graph?id=' + encodeURIComponent(res.id);
    if (tab) tab.location.href = url; else window.open(url, '_blank');
  } else {
    const msg = 'Could not build the graph: ' + ((res && res.error) || 'unknown error') +
      '. Is the server running? (python serve.py)';
    if (tab) {
      tab.document.body.innerHTML =
        '<div style="text-align:center;color:#dc2626"><div style="font-size:40px">⚠️</div>' +
        '<p>' + msg.replace(/</g, '&lt;') + '</p></div>';
    } else {
      alert(msg);
    }
  }
}

// ── Help overlay (F1) ─────────────────────────────────────────────────────────

// Single source of truth for the shortcut list — keep in sync with SHORTCUTS.md.
const SHORTCUTS = [
  ['Ctrl + D',       'Dictionary definition (simple English)'],
  ['Ctrl + Shift + D', 'Korean meaning (한국어 뜻)'],
  ['Ctrl + L',       'Collocations / natural usage'],
  ['Ctrl + E',       'Explain the sentence (with context)'],
  ['Ctrl + G',       'Grammar breakdown'],
  ['Ctrl + R',       'Rewrite in simpler English'],
  ['Ctrl + P',       'Pronounce aloud · press again to stop'],
  ['Ctrl + Shift + K', 'Build a knowledge graph of the page'],
  ['Ctrl + Shift + S', 'Open the Study guide & Tutor side panel'],
  ['Esc',            'Close the popup'],
  ['F1',             'Show / hide this help'],
];

function showHelp() {
  removePopup();

  const panel = document.createElement('div');
  panel.setAttribute('data-ctrld-popup', '');   // share the popup marker
  panel.setAttribute('data-ctrld-help', '');
  panel.style.cssText = [
    'position:fixed',
    'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
    'z-index:2147483647',
    'background:white',
    'border:1px solid #e5e7eb',
    'border-radius:12px',
    'padding:16px 18px',
    'width:380px', 'max-width:90vw',
    'max-height:80vh', 'overflow-y:auto',
    'box-shadow:0 12px 40px rgba(0,0,0,0.22)',
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    'font-size:13px', 'line-height:1.55', 'color:#1f2937',
  ].join(';');

  let rows = '';
  for (const [keys, desc] of SHORTCUTS) {
    rows +=
      '<div style="display:flex;align-items:baseline;gap:10px;padding:3px 0">' +
        '<kbd style="flex-shrink:0;min-width:120px;font-family:inherit;font-size:11px;' +
          'font-weight:600;color:#4f46e5;background:#f5f3ff;border:1px solid #e9e5ff;' +
          'border-radius:6px;padding:2px 7px;text-align:center">' +
          keys.replace(/</g, '&lt;') + '</kbd>' +
        '<span style="color:#374151">' + desc.replace(/</g, '&lt;') + '</span>' +
      '</div>';
  }

  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
      'margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f3f4f6">' +
      '<span style="font-weight:600;color:#4f46e5">⌨️ Reading Helper — Shortcuts</span>' +
      '<button data-help-close style="border:none;background:none;cursor:pointer;' +
        'color:#9ca3af;font-size:15px;line-height:1;font-family:inherit">✕</button>' +
    '</div>' + rows +
    '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #f3f4f6;' +
      'color:#9ca3af;font-size:11px">Select text first, then press a shortcut. ' +
      'F1 or Esc to close.</div>';

  panel.querySelector('[data-help-close]').onclick = removePopup;

  document.body.appendChild(panel);
  activePopup = panel;

  // Click outside to dismiss (matches createPopup's behaviour).
  setTimeout(() => {
    document.addEventListener('click', function onOut(e) {
      if (activePopup && !activePopup.contains(e.target)) {
        removePopup();
        document.removeEventListener('click', onOut);
      }
    });
  }, 120);
}

// F1 toggles the help overlay. Browsers open their own help page on F1, so we
// must preventDefault.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'F1') return;
  e.preventDefault();
  if (activePopup && activePopup.hasAttribute('data-ctrld-help')) removePopup();
  else showHelp();
}, { capture: true });

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();

  // Ctrl+Shift+D → Korean meaning (the only Shift combo we handle).
  if (e.shiftKey) {
    if (k === 'd') {
      const ctx = getSelectionContext();
      if (!ctx) return;
      e.preventDefault();
      showStreamLookup('🇰🇷', ctx, '/api/korean',
        { word: ctx.text, before: ctx.before, after: ctx.after }, 'korean');
    }
    return;
  }

  switch (k) {
    case 'd': {                              // define
      const ctx = getSelectionContext();
      if (!ctx) return;
      e.preventDefault();
      showStreamLookup('📖', ctx, '/api/define',
        { word: ctx.text, before: ctx.before, after: ctx.after }, 'define');
      break;
    }
    case 'e': {                              // explain (3 sentences of context)
      const ctx = getSentenceContext(3);
      if (!ctx) return;
      e.preventDefault();
      showStreamLookup('💡', ctx, '/api/explain',
        { sentence: ctx.text, before: ctx.before, after: ctx.after }, 'explain');
      break;
    }
    case 'g': {                              // grammar breakdown
      const ctx = getSentenceContext(2);
      if (!ctx) return;
      e.preventDefault();
      showStreamLookup('🔧', ctx, '/api/grammar',
        { sentence: ctx.text, before: ctx.before, after: ctx.after }, 'grammar');
      break;
    }
    case 'l': {                              // collocations / natural usage
      const ctx = getSelectionContext();
      if (!ctx) return;
      e.preventDefault();
      showStreamLookup('🔗', ctx, '/api/collocations',
        { word: ctx.text, before: ctx.before, after: ctx.after }, 'collocations');
      break;
    }
    case 'r': {                              // rewrite in simpler English
      const ctx = getSentenceContext(2);
      if (!ctx) return;
      e.preventDefault();
      showStreamLookup('✏️', ctx, '/api/paraphrase',
        { sentence: ctx.text, before: ctx.before, after: ctx.after });  // not savable
      break;
    }
    case 'p': {                              // pronounce / stop (toggle)
      // If speech is already playing (in any language), Ctrl+P stops it —
      // no selection needed. Otherwise it pronounces the current selection.
      const synth = window.speechSynthesis;
      if (synth && (synth.speaking || synth.pending)) {
        e.preventDefault();
        synth.cancel();
        break;
      }
      const ctx = getSelectionContext();
      if (!ctx) return;
      e.preventDefault();
      showPronounce(ctx);
      break;
    }
  }
}, { capture: true });

// Ctrl+K is a browser-reserved shortcut (focus the address bar), so a page-level
// keydown handler can't override it. Instead it's registered as an extension
// command in manifest.json; the background worker forwards it here as a message.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.action === 'build-graph') { buildGraph(); return; }
  // The Study guide & Tutor side panel asks the active tab for its readable text.
  if (msg.action === 'get-page-text') {
    sendResponse({ text: getPageText(), title: document.title, url: location.href });
    return true;  // keep the channel open for the response
  }
});

// Escape closes the popup.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activePopup) removePopup();
});
