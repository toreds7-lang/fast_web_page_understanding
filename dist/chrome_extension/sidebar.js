/**
 * Study guide & Tutor side panel.
 *
 * Pulls the active tab's readable text (via the content script), then:
 *  - 📋 Study guide: a learner-oriented orientation of the page (auto-generated).
 *  - 💬 Ask tutor:  a page-aware chat that can also teach general English.
 *  - 🔊 Browser voice (Web Speech API) reads the guide / answers aloud. No server TTS.
 *
 * This page runs in the extension origin and has host_permissions for the local
 * server, so it can fetch + stream 127.0.0.1 directly (no Local Network Access
 * prompt, no background relay needed).
 */
const API = 'http://127.0.0.1:8766';
const $ = (id) => document.getElementById(id);

// Current page. The text is held here so we can (re-)ingest it, but it's sent to
// the server only once: the server caches it and we reference it by `pageId` on
// every study/tutor call, so the full text isn't re-sent each turn.
let page = null;            // { text, title, url }
let pageId = null;          // server-side cache id for the current page
let studyText = '';         // plain text of the rendered study guide (for read-aloud)
let history = [];           // [{ role: 'user'|'assistant', content }]
let busy = false;           // a study/tutor stream is in flight

// ── Helpers ───────────────────────────────────────────────────────────────────
// Markdown rendering (tables, math, Mermaid) lives in vendor/chat-render.js as
// `ChatRender`, shared with graph.html.

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Browser voice (Web Speech API only) ───────────────────────────────────────

let speakingBtn = null;     // the 🔊 button currently in "stop" state, if any

function stopSpeaking() {
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
  if (speakingBtn) { speakingBtn.dataset.on = ''; restoreSpeakLabel(speakingBtn); }
  speakingBtn = null;
}

function restoreSpeakLabel(btn) {
  btn.textContent = btn.dataset.label || '🔊';
}

// Toggle read-aloud of `getText()`'s result on `btn`. Clicking again stops.
function wireSpeak(btn, getText, label) {
  btn.dataset.label = label || btn.textContent;
  btn.addEventListener('click', () => {
    const synth = window.speechSynthesis;
    if (!synth) { btn.textContent = '🔇 no voice'; return; }
    // If this (or any) button is speaking, stop.
    if (speakingBtn) { stopSpeaking(); return; }
    const text = (getText() || '').trim();
    if (!text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    u.onend = () => { if (speakingBtn === btn) { btn.dataset.on = ''; restoreSpeakLabel(btn); speakingBtn = null; } };
    u.onerror = u.onend;
    synth.speak(u);
    speakingBtn = btn;
    btn.dataset.on = '1';
    btn.textContent = '⏹ Stop';
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function activate(which) {
  for (const t of ['study', 'tutor']) {
    $('tab' + cap(t)).classList.toggle('active', t === which);
    $('panel' + cap(t)).classList.toggle('active', t === which);
  }
  if (which === 'tutor') $('q').focus();
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
$('tabStudy').addEventListener('click', () => activate('study'));
$('tabTutor').addEventListener('click', () => activate('tutor'));

// ── Streaming (direct fetch; extension origin is LNA-exempt) ───────────────────

// Cache the current page's text on the server, once, and remember its id.
async function ingestPage() {
  if (!page) throw new Error('no page loaded');
  const resp = await fetch(API + '/api/page', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: page.text, title: page.title, url: page.url }),
  });
  if (!resp.ok) throw new Error('could not cache page (' + resp.status + ')');
  pageId = (await resp.json()).id;
  return pageId;
}

// Stream `endpoint` with the cached page (`page_id`) plus `extra` fields into
// `el`, rendering markdown as it arrives. Re-ingests once on a cache miss (404:
// server restarted or the page was evicted). Returns the accumulated plain text.
async function streamInto(el, endpoint, extra) {
  if (!pageId) await ingestPage();

  const call = () => fetch(API + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ page_id: pageId }, extra)),
  });

  let resp = await call();
  if (resp.status === 404) {       // page no longer cached → re-ingest and retry
    await ingestPage();
    resp = await call();
  }
  if (!resp.ok) {
    let detail = resp.statusText;
    try { detail = (await resp.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let acc = '';
  el.innerHTML = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
    el.innerHTML = ChatRender.streamHtml(acc);   // fast pass while streaming
    el.scrollTop = el.scrollHeight;
  }
  if (acc.trim()) ChatRender.renderFull(el, acc); // tables + math + diagrams
  el.scrollTop = el.scrollHeight;
  return acc;
}

function errorHtml(msg) {
  return '<p style="color:#dc2626">⚠️ ' + esc(msg) +
    '<br><small>Is the server running? <code>python serve.py</code></small></p>';
}

// ── Load the active tab's text ────────────────────────────────────────────────

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve((tabs && tabs[0]) || null);
    });
  });
}

function askPageText(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'get-page-text' }, (resp) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(resp || null);
    });
  });
}

async function loadPage() {
  stopSpeaking();
  $('pageTitle').textContent = 'Reading page…';
  const tab = await getActiveTab();
  if (!tab || tab.id == null) {
    $('pageTitle').textContent = 'No active tab';
    return;
  }
  const data = await askPageText(tab.id);
  if (!data || !(data.text || '').trim()) {
    page = null;
    $('pageTitle').textContent = tab.title || 'This page';
    $('studyContent').innerHTML =
      '<div class="empty">Couldn\'t read this page. Open a normal web page (not a ' +
      'chrome:// or extension page) and click <b>↻ Reload page</b>.</div>';
    return;
  }
  page = data;
  pageId = null;             // a new page must be re-ingested
  $('pageTitle').textContent = data.title || data.url || 'This page';
  // A new page invalidates the old conversation.
  history = [];
  resetTutor();
  generateStudy();
}

// ── Study guide ───────────────────────────────────────────────────────────────

async function generateStudy() {
  if (!page) { loadPage(); return; }
  if (busy) return;
  busy = true; $('regen').disabled = true; studyText = '';
  const el = $('studyContent');
  el.innerHTML = '<div class="empty">Generating study guide…</div>';
  try {
    studyText = await streamInto(el, '/api/study', {});
    if (!studyText.trim()) el.innerHTML = '<div class="empty">(no study guide)</div>';
  } catch (e) {
    el.innerHTML = errorHtml(e.message);
  } finally {
    busy = false; $('regen').disabled = false;
  }
}

$('regen').addEventListener('click', generateStudy);
$('reload').addEventListener('click', loadPage);
wireSpeak($('speakStudy'), () => $('studyContent').innerText, '🔊 Read aloud');

// ── Ask tutor ─────────────────────────────────────────────────────────────────

const TUTOR_EMPTY =
  '<div class="empty">Ask anything about the page — e.g. "What\'s the main idea?" ' +
  'or "Explain this grammar."</div>';

function resetTutor() { $('log').innerHTML = TUTOR_EMPTY; }

// Clear the visible chat *and* the conversation context sent to the server, so
// the next question starts a fresh thread (mirrors the graph chat's 🗑 button).
function clearTutor() {
  if (busy) return;
  stopSpeaking();
  history = [];
  resetTutor();
  $('q').focus();
}

function clearEmpty() {
  const e = $('log').querySelector('.empty');
  if (e) e.remove();
}

function addMsg(who, html) {
  clearEmpty();
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + who;
  const label = who === 'user' ? 'You' : 'Tutor';
  wrap.innerHTML =
    '<div class="who"><span>' + label + '</span></div>' +
    '<div class="bubble">' + html + '</div>';
  $('log').appendChild(wrap);
  $('log').scrollTop = $('log').scrollHeight;
  return wrap;
}

async function ask() {
  if (busy) return;
  const q = $('q').value.trim();
  if (!q) return;
  if (!page) {
    addMsg('bot', '<p class="hint">Load a page first (↻ Reload page).</p>');
    return;
  }
  $('q').value = '';
  addMsg('user', esc(q));
  const wrap = addMsg('bot', '<span class="hint">Thinking…</span>');
  const bubble = wrap.querySelector('.bubble');

  busy = true; $('send').disabled = true;
  try {
    const answer = await streamInto(bubble, '/api/tutor', { question: q, history });
    if (!answer.trim()) { bubble.innerHTML = '<p><em>(no response)</em></p>'; }
    else {
      history.push({ role: 'user', content: q });
      history.push({ role: 'assistant', content: answer });
      // Add a 🔊 read-aloud button to the answer's header.
      const spk = document.createElement('button');
      spk.className = 'spk'; spk.textContent = '🔊';
      spk.title = 'Read aloud (browser voice)';
      wrap.querySelector('.who').appendChild(spk);
      wireSpeak(spk, () => bubble.innerText, '🔊');
    }
  } catch (e) {
    bubble.innerHTML = errorHtml(e.message);
  } finally {
    busy = false; $('send').disabled = false;
  }
}

$('send').addEventListener('click', ask);
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
$('clearTutor').addEventListener('click', clearTutor);

// ── Start ─────────────────────────────────────────────────────────────────────
loadPage();
