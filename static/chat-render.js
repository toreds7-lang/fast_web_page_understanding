/**
 * Rich Markdown rendering shared by the graph page chat (graph.html) and the
 * side-panel tutor chat (chrome_extension/sidebar.js).
 *
 * Exposes `window.ChatRender`:
 *   - streamHtml(text)        → HTML string; cheap, used per chunk while a reply
 *                               streams in (Markdown + GFM tables, no math/diagrams).
 *   - renderFull(el, text)    → sets el.innerHTML to the full render: Markdown +
 *                               tables, then KaTeX math, then Mermaid diagrams.
 *
 * Capabilities (tables / math / Mermaid) light up only if their library loaded;
 * otherwise it degrades to a tiny built-in Markdown pass so the chat still works.
 *
 * Libraries (vendored locally so this works offline and inside the MV3 extension,
 * which forbids remote scripts): marked, DOMPurify, KaTeX (+auto-render), Mermaid.
 */
(function (global) {
  'use strict';

  // marked passes raw HTML through, and Mermaid/KaTeX inject their own markup, so
  // we sanitize the Markdown→HTML step (model output) before touching the DOM.
  function sanitize(html) {
    if (global.DOMPurify && global.DOMPurify.sanitize) {
      // Keep class (used to find ```mermaid blocks) and let SVG/MathML through
      // for the diagrams/equations we render afterwards.
      return global.DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true, mathMl: true } });
    }
    return html;
  }

  if (global.marked && global.marked.setOptions) {
    global.marked.setOptions({ gfm: true, breaks: true });
  }

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Fallback used when marked is unavailable — mirrors the project's original md().
  function liteMd(text) {
    return '<p>' + esc(text)
      .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*$/gm, '<strong>$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^\s*[-*]\s+/gm, '• ')
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n/g, '<br>') + '</p>';
  }

  // Markdown → sanitized HTML. Cheap enough to run on every streamed chunk.
  function streamHtml(text) {
    if (global.marked && global.marked.parse) {
      try { return sanitize(global.marked.parse(text || '')); } catch (_) {}
    }
    return liteMd(text);
  }

  function renderMath(el) {
    if (!global.renderMathInElement) return;
    try {
      global.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      });
    } catch (_) {}
  }

  let mermaidReady = false;
  function renderMermaid(el) {
    if (!global.mermaid) return;
    if (!mermaidReady) {
      try {
        global.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
      } catch (_) {}
      mermaidReady = true;
    }
    // marked emits ```mermaid fences as <pre><code class="language-mermaid">…</code></pre>.
    const blocks = el.querySelectorAll('code.language-mermaid, code.lang-mermaid');
    blocks.forEach((code, i) => {
      const src = code.textContent || '';
      const host = document.createElement('div');
      host.className = 'mermaid';
      (code.closest('pre') || code).replaceWith(host);
      const id = 'mmd-' + Date.now() + '-' + i + '-' + Math.floor(Math.random() * 1e6);
      try {
        const out = global.mermaid.render(id, src);
        if (out && typeof out.then === 'function') {
          out.then(function (r) { host.innerHTML = r.svg; })
             .catch(function () { host.innerHTML = '<pre><code>' + esc(src) + '</code></pre>'; });
        } else if (out && out.svg) {
          host.innerHTML = out.svg;            // very old sync API
        }
      } catch (_) {
        host.innerHTML = '<pre><code>' + esc(src) + '</code></pre>';
      }
    });
  }

  // Full render once a reply finishes: Markdown + tables, then math, then diagrams.
  function renderFull(el, text) {
    el.innerHTML = streamHtml(text);
    renderMath(el);
    renderMermaid(el);
  }

  global.ChatRender = { streamHtml: streamHtml, renderFull: renderFull };
})(window);
