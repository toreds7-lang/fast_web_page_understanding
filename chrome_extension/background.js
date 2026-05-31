/**
 * Background service worker.
 *
 * Two jobs:
 *
 * 1. Ctrl+Shift+K is registered as an extension command (manifest "commands")
 *    so it takes priority over the browser default. When it fires we tell the
 *    active tab's content script to build the knowledge graph.
 *
 * 2. ALL requests to the local server (127.0.0.1:8766) are made from here, not
 *    from the page. A fetch to a local address from a public web page triggers
 *    Chrome's "Local Network Access" permission prompt ("… wants to access other
 *    apps and services on this device"). The extension background has
 *    host_permissions for the server, so its requests are exempt — no prompt.
 *    - one-shot calls (graph build, save) use sendMessage,
 *    - streaming lookups use a long-lived port that relays chunks back.
 */
const API = 'http://127.0.0.1:8766';

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'build-graph') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (tab && tab.id != null) {
      chrome.tabs.sendMessage(tab.id, { action: 'build-graph' }, () => {
        // Swallow "no receiver" errors on pages without the content script
        // (e.g. chrome:// pages, the web store).
        void chrome.runtime.lastError;
      });
    }
  });
});

// One-shot requests (graph build, save) — reply once with the JSON result.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;

  if (msg.action === 'build-graph-fetch') {
    (async () => {
      try {
        const resp = await fetch(API + '/api/graph/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: msg.text, title: msg.title, url: msg.url }),
        });
        if (!resp.ok) {
          let detail = resp.statusText;
          try { detail = (await resp.json()).detail || detail; } catch (_) {}
          throw new Error(detail);
        }
        const data = await resp.json();
        sendResponse({ ok: true, id: data.id });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;  // keep the channel open for the async sendResponse
  }

  if (msg.action === 'save') {
    (async () => {
      try {
        const resp = await fetch(API + msg.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.body),
        });
        if (!resp.ok) throw new Error(resp.statusText);
        sendResponse({ ok: true, data: await resp.json() });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
});

// Streaming lookups (define/explain/grammar/...) — relay response chunks back
// over the port as they arrive, since sendMessage can't stream.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'stream') return;

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.action !== 'stream') return;
    try {
      const resp = await fetch(API + msg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg.body),
      });
      if (!resp.ok) throw new Error(resp.statusText);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        port.postMessage({ chunk: decoder.decode(value, { stream: true }) });
      }
      port.postMessage({ done: true });
    } catch (e) {
      port.postMessage({ error: e.message });
    } finally {
      port.disconnect();
    }
  });
});
