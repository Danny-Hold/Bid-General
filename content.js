'use strict';

(() => {
  const MIN_CHARS = 10;
  // How far the bar dips over the top edge of the box, so it reads as attached.
  const OVERLAP = 8;

  // Physical key codes, so the binding survives non-US keyboard layouts.
  const keys = {
    fix: 'Ctrl+Alt+KeyA',
    rephrase: 'Ctrl+Alt+KeyS',
    undo: 'Ctrl+Alt+KeyQ'
  };

  function comboOf(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    parts.push(e.code);
    return parts.join('+');
  }

  function comboLabel(combo) {
    return String(combo || '')
      .split('+')
      .map(p => p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num '))
      .join(' + ');
  }

  function languageLabel(language) {
    const name = String(language || '').trim();
    if (!name) return 'Lang';
    const base = name.split(/[(/]/)[0].trim();
    return base.length > 10 ? base.slice(0, 9) + '…' : base;
  }

  const cfg = {
    showFeedback: true,
    feedbackSeconds: 6,
    translators: [
      { language: 'Spanish', hotkey: 'Ctrl+Alt+KeyD' },
      { language: 'French', hotkey: 'Ctrl+Alt+KeyF' }
    ]
  };

  function applySettings(s) {
    if (s.keyFix) keys.fix = s.keyFix;
    if (s.keyRephrase) keys.rephrase = s.keyRephrase;
    if (s.keyUndo) keys.undo = s.keyUndo;
    if (typeof s.showFeedback === 'boolean') cfg.showFeedback = s.showFeedback;
    if (Number(s.feedbackSeconds) > 0) cfg.feedbackSeconds = Number(s.feedbackSeconds);
    if (Array.isArray(s.translators)) {
      cfg.translators = s.translators
        .map(t => ({
          language: String(t?.language || '').trim(),
          hotkey: String(t?.hotkey || '').trim()
        }))
        .filter(t => t.language && t.hotkey && !/^english$/i.test(t.language));
    }

    if (!fixBtn) return;
    fixBtn.title = 'Correct grammar and spelling only (' + comboLabel(keys.fix) + ')';
    rephraseBtn.title = 'Rewrite in natural US business English (' + comboLabel(keys.rephrase) + ')';
    undoBtn.title = 'Restore the original text (' + comboLabel(keys.undo) + ')';
    rebuildTranslateButtons();
  }

  const WATCHED = [
    'keyFix', 'keyRephrase', 'keyUndo',
    'showFeedback', 'feedbackSeconds', 'translators'
  ];

  chrome.storage.local.get(WATCHED).then(applySettings).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const next = {};
    WATCHED.forEach(k => {
      if (k in changes) next[k] = changes[k].newValue;
    });
    applySettings(next);
  });

  let activeEl = null;
  let busy = false;
  let snapshot = null; // { el, before, start, end }
  let host, shadow, bar, fixBtn, rephraseBtn, undoBtn, note;
  let translateSep, translateWrap;
  let translateBtns = [];
  let panel, beforeEl, afterEl;
  let rafId = null;
  let panelTimer = null;
  let fadeTimer = null;

  // ---------------------------------------------------------------- helpers

  function isTarget(el) {
    return el instanceof HTMLTextAreaElement && !el.disabled && !el.readOnly;
  }

  // Replace a range inside a textarea so that React (or any listener) sees it,
  // and so that the browser's own Ctrl+Z history still works.
  function replaceRange(el, start, end, text) {
    el.focus();
    el.setSelectionRange(start, end);

    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      ).set;
      const v = el.value;
      setter.call(el, v.slice(0, start) + text + v.slice(end));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const caret = start + text.length;
    el.setSelectionRange(caret, caret);
  }

  // ------------------------------------------------------------------- UI

  function rebuildTranslateButtons() {
    if (!translateWrap) return;

    translateWrap.replaceChildren();
    translateBtns = [];

    const list = cfg.translators || [];
    translateSep.style.display = list.length ? '' : 'none';
    translateWrap.style.display = list.length ? 'contents' : 'none';

    list.forEach(t => {
      const btn = document.createElement('button');
      btn.textContent = languageLabel(t.language);
      btn.title = 'Translate to ' + t.language + ' (' + comboLabel(t.hotkey) + ')';
      btn.dataset.language = t.language;
      btn.disabled = busy;
      btn.addEventListener('click', () => run('translate', t.language));
      translateWrap.appendChild(btn);
      translateBtns.push(btn);
    });

    schedule();
  }

  function buildBar() {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .bar {
        position: fixed;
        display: none;
        align-items: center;
        gap: 2px;
        padding: 2px;
        border: 1px solid #D3D9E2;
        border-radius: 7px;
        background: #FFFFFF;
        box-shadow: 0 1px 2px rgba(14,21,33,.06), 0 4px 12px rgba(14,21,33,.08);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        pointer-events: auto;
        opacity: .75;
        transition: opacity .12s ease;
        max-width: min(920px, calc(100vw - 16px));
        flex-wrap: wrap;
      }
      .bar:hover, .bar[data-busy="1"], .bar[data-error="1"] { opacity: 1; }
      button {
        appearance: none;
        border: 0;
        background: transparent;
        color: #3C4655;
        font: inherit;
        font-size: 10.5px;
        letter-spacing: .06em;
        text-transform: uppercase;
        padding: 4px 7px;
        border-radius: 5px;
        cursor: pointer;
      }
      button:hover:not(:disabled) { background: #EEF1F5; color: #0E1521; }
      button:focus-visible { outline: 2px solid #2F6F62; outline-offset: 1px; }
      button:disabled { opacity: .4; cursor: default; }
      .undo { color: #2F6F62; }
      .note {
        display: none;
        max-width: 220px;
        padding: 4px 7px;
        font-size: 10.5px;
        letter-spacing: .02em;
        color: #8A4B12;
        text-transform: none;
      }
      .bar[data-error="1"] .note { display: block; }
      .sep { width: 1px; align-self: stretch; background: #E4E8EE; margin: 2px 1px; }
      .translate-wrap { display: contents; }

      .panel {
        position: fixed;
        display: none;
        opacity: 0;
        box-sizing: border-box;
        padding: 10px 12px;
        border: 1px solid #D3D9E2;
        border-radius: 8px;
        background: #FFFFFF;
        box-shadow: 0 2px 4px rgba(14,21,33,.06), 0 8px 24px rgba(14,21,33,.10);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        pointer-events: auto;
        cursor: pointer;
        transition: opacity .18s ease;
      }
      .pair + .pair { margin-top: 8px; padding-top: 8px; border-top: 1px solid #EEF1F5; }
      .tag {
        display: block;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 9.5px;
        letter-spacing: .09em;
        text-transform: uppercase;
        margin-bottom: 3px;
      }
      .pair.old .tag { color: #8A93A2; }
      .pair.new .tag { color: #2F6F62; }
      .txt {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.5;
        color: #0E1521;
        max-height: 96px;
        overflow-y: auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .pair.old .txt { color: #6B7484; }
      @media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
      @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
    `;

    bar = document.createElement('div');
    bar.className = 'bar';

    fixBtn = document.createElement('button');
    fixBtn.textContent = 'Fix';
    fixBtn.title = 'Correct grammar and spelling only (Ctrl+Alt+A)';

    rephraseBtn = document.createElement('button');
    rephraseBtn.textContent = 'Rephrase';
    rephraseBtn.title = 'Rewrite in natural US business English (Ctrl+Alt+S)';

    undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo';
    undoBtn.className = 'undo';
    undoBtn.title = 'Restore the original text (Ctrl+Alt+Q)';
    undoBtn.style.display = 'none';

    note = document.createElement('span');
    note.className = 'note';

    const sep = document.createElement('span');
    sep.className = 'sep';

    translateSep = document.createElement('span');
    translateSep.className = 'sep';

    translateWrap = document.createElement('span');
    translateWrap.className = 'translate-wrap';

    bar.append(fixBtn, sep, rephraseBtn, translateSep, translateWrap, undoBtn, note);

    panel = document.createElement('div');
    panel.className = 'panel';
    panel.title = 'Click to dismiss';

    const oldPair = document.createElement('div');
    oldPair.className = 'pair old';
    const oldTag = document.createElement('span');
    oldTag.className = 'tag';
    oldTag.textContent = 'Before';
    beforeEl = document.createElement('p');
    beforeEl.className = 'txt';
    oldPair.append(oldTag, beforeEl);

    const newPair = document.createElement('div');
    newPair.className = 'pair new';
    const newTag = document.createElement('span');
    newTag.className = 'tag';
    newTag.textContent = 'After';
    afterEl = document.createElement('p');
    afterEl.className = 'txt';
    newPair.append(newTag, afterEl);

    panel.append(oldPair, newPair);
    panel.addEventListener('mousedown', e => { e.preventDefault(); hidePanel(); });

    shadow.append(style, bar, panel);
    document.documentElement.appendChild(host);

    // Keep the textarea's focus and selection when the bar is clicked.
    applySettings({
      keyFix: keys.fix,
      keyRephrase: keys.rephrase,
      keyUndo: keys.undo,
      translators: cfg.translators
    });

    bar.addEventListener('mousedown', e => e.preventDefault());
    fixBtn.addEventListener('click', () => run('fix'));
    rephraseBtn.addEventListener('click', () => run('rephrase'));
    undoBtn.addEventListener('click', undo);
  }

  function position() {
    rafId = null;
    if (!activeEl || !activeEl.isConnected) return hide();

    const r = activeEl.getBoundingClientRect();
    if (r.width < 120 || r.height < 24 || r.bottom < 0 || r.top > innerHeight) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    // measure after display so offsetWidth is real
    const w = bar.offsetWidth, h = bar.offsetHeight;

    // Sit above the box, right-aligned, overlapping its top edge slightly.
    const barTop = Math.max(4, r.top - h + OVERLAP);
    bar.style.left = Math.max(4, r.right - w - 8) + 'px';
    bar.style.top = barTop + 'px';

    if (panel && panel.style.display === 'block') {
      panel.style.width = Math.min(r.width, 560) + 'px';
      panel.style.left = Math.max(4, r.left) + 'px';
      const ph = panel.offsetHeight;
      // Above the bar if it fits, otherwise below the box.
      const above = barTop - ph - 6;
      panel.style.top = (above >= 4 ? above : Math.min(innerHeight - ph - 4, r.bottom + 8)) + 'px';
    }
  }

  function schedule() {
    if (rafId == null) rafId = requestAnimationFrame(position);
  }

  function hide() {
    if (bar) bar.style.display = 'none';
  }

  // Typing means they have read it and moved on.
  function onTyping() {
    if (busy) return;
    hidePanel();
  }

  function showPanel(before, after) {
    if (!cfg.showFeedback || !panel) return;

    clearTimeout(panelTimer);
    clearTimeout(fadeTimer);

    beforeEl.textContent = before;
    afterEl.textContent = after;
    panel.style.display = 'block';
    panel.style.opacity = '0';
    schedule();
    requestAnimationFrame(() => { panel.style.opacity = '1'; });

    panelTimer = setTimeout(hidePanel, Math.max(1, cfg.feedbackSeconds) * 1000);
  }

  function hidePanel() {
    if (!panel || panel.style.display === 'none') return;
    clearTimeout(panelTimer);
    clearTimeout(fadeTimer);
    panel.style.opacity = '0';
    fadeTimer = setTimeout(() => { panel.style.display = 'none'; }, 200);
  }

  function setBusy(on) {
    busy = on;
    bar.dataset.busy = on ? '1' : '0';
    fixBtn.disabled = rephraseBtn.disabled = undoBtn.disabled = on;
    translateBtns.forEach(btn => { btn.disabled = on; });
    fixBtn.textContent = on ? 'Working' : 'Fix';
    rephraseBtn.style.display = on ? 'none' : '';
    if (translateWrap) translateWrap.style.display = on ? 'none' : (cfg.translators.length ? 'contents' : 'none');
    if (translateSep) translateSep.style.display = on || !cfg.translators.length ? 'none' : '';
  }

  function showError(msg) {
    note.textContent = msg;
    bar.dataset.error = '1';
    setTimeout(() => {
      bar.dataset.error = '0';
      note.textContent = '';
      schedule();
    }, 5000);
    schedule();
  }

  // --------------------------------------------------------------- actions

  async function run(mode, language) {
    if (busy || !activeEl) return;

    const value = activeEl.value;
    const selStart = activeEl.selectionStart;
    const selEnd = activeEl.selectionEnd;

    // Rewrite the selection if there is one, otherwise the whole message.
    const hasSel = selEnd > selStart;
    const start = hasSel ? selStart : 0;
    const end = hasSel ? selEnd : value.length;
    const text = value.slice(start, end).trim();

    if (text.length < MIN_CHARS) {
      showError(mode === 'translate' ? 'Too short to translate.' : 'Too short to rewrite.');
      return;
    }

    setBusy(true);
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'rewrite',
        mode,
        text,
        language: language || undefined
      });
      if (!res?.ok) throw new Error(res?.error || 'No response.');
      if (!activeEl.isConnected) return;

      snapshot = { el: activeEl, before: value, start, end };
      replaceRange(activeEl, start, end, res.text);
      undoBtn.style.display = '';
      showPanel(text, res.text);
    } catch (err) {
      showError(String(err.message || err).slice(0, 140));
    } finally {
      setBusy(false);
      schedule();
    }
  }

  function undo() {
    if (!snapshot || !snapshot.el.isConnected) return;
    const el = snapshot.el;
    replaceRange(el, 0, el.value.length, snapshot.before);
    el.setSelectionRange(snapshot.start, snapshot.end);
    snapshot = null;
    undoBtn.style.display = 'none';
    hidePanel();
    schedule();
  }

  // ---------------------------------------------------------------- events

  function onFocusIn(e) {
    if (!isTarget(e.target)) return;
    if (!host) buildBar();
    activeEl = e.target;
    if (!snapshot || snapshot.el !== activeEl) {
      snapshot = null;
      undoBtn.style.display = 'none';
    }
    schedule();
  }

  function onFocusOut(e) {
    if (e.target !== activeEl) return;
    // Let a click on the bar land before hiding.
    setTimeout(() => {
      if (document.activeElement !== activeEl) {
        activeEl = null;
        hide();
        hidePanel();
      }
    }, 120);
  }

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule, true);
  document.addEventListener('input', e => {
    if (e.target !== activeEl) return;
    onTyping();
    schedule();
  }, true);

  document.addEventListener('keydown', e => {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) return;
    if (!isTarget(document.activeElement)) return;

    const combo = comboOf(e);
    if (combo === keys.fix) { e.preventDefault(); run('fix'); }
    else if (combo === keys.rephrase) { e.preventDefault(); run('rephrase'); }
    else if (combo === keys.undo) { e.preventDefault(); undo(); }
    else {
      const t = (cfg.translators || []).find(row => row.hotkey === combo);
      if (t) { e.preventDefault(); run('translate', t.language); }
    }
  }, true);
})();
