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

  // Mirrors NATIVE_LEVELS in defaults.js — the content script does not load it.
  // Only what the bar needs: the id to send, and how to label the button.
  const NATIVE_LEVELS = [
    { id: 'friend', label: 'Friend', who: 'a best friend' },
    { id: 'teammate', label: 'Peer', who: 'a same-level teammate' },
    { id: 'polite', label: 'Polite', who: 'someone you do not know well' },
    { id: 'client', label: 'Client', who: 'a client' },
    { id: 'boss', label: 'Boss', who: 'your boss' }
  ];

  const cfg = {
    showFeedback: true,
    feedbackSeconds: 6,
    translators: [
      { language: 'Spanish', hotkey: 'Ctrl+Alt+KeyD' },
      { language: 'French', hotkey: 'Ctrl+Alt+KeyF' }
    ],
    lookups: [
      { language: 'English', hotkey: 'Ctrl+Alt+KeyZ' }
    ],
    natives: NATIVE_LEVELS.map((l, i) => ({
      id: l.id,
      hotkey: 'Ctrl+Alt+Digit' + (i + 1),
      on: true
    }))
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
    if (Array.isArray(s.lookups)) {
      cfg.lookups = s.lookups
        .map(t => ({
          language: String(t?.language || '').trim(),
          hotkey: String(t?.hotkey || '').trim()
        }))
        .filter(t => t.language && t.hotkey);
    }
    if (Array.isArray(s.natives)) {
      cfg.natives = s.natives
        .map(n => ({
          id: String(n?.id || '').trim(),
          hotkey: String(n?.hotkey || '').trim(),
          on: n?.on !== false
        }))
        .filter(n => NATIVE_LEVELS.some(l => l.id === n.id));
    }

    if (!fixBtn) return;
    fixBtn.title = 'Correct grammar and spelling only (' + comboLabel(keys.fix) + ')';
    rephraseBtn.title = 'Rewrite in natural US business English (' + comboLabel(keys.rephrase) + ')';
    undoBtn.title = 'Restore the original text (' + comboLabel(keys.undo) + ')';
    rebuildNativeButtons();
    rebuildTranslateButtons();
  }

  const WATCHED = [
    'keyFix', 'keyRephrase', 'keyUndo',
    'showFeedback', 'feedbackSeconds', 'translators', 'lookups', 'natives'
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
  let nativeSep, nativeWrap;
  let nativeBtns = [];
  let panel, beforeEl, afterEl;
  let lookupPanel, lookupBeforeEl, lookupAfterEl, lookupTitleEl;
  let rafId = null;
  let panelTimer = null;
  let fadeTimer = null;
  let lookupTimer = null;
  let lookupFadeTimer = null;
  let lookupBusy = false;
  let lookupAnchor = null; // { left, top, bottom, right }

  // ---------------------------------------------------------------- helpers

  function isTextarea(el) {
    return el instanceof HTMLTextAreaElement && !el.disabled && !el.readOnly;
  }

  // WhatsApp / Telegram use contenteditable divs, not <textarea>.
  // Focus often lands on a nested node — climb to the outermost editable.
  function resolveTarget(el) {
    if (!(el instanceof HTMLElement)) return null;
    if (isTextarea(el)) return el;

    let node = el;
    let outer = null;
    while (node) {
      if (node instanceof HTMLElement && node.isContentEditable) outer = node;
      node = node.parentElement;
    }
    if (!outer) return null;

    // Skip tiny fields (emoji search, title edits, etc.).
    const r = outer.getBoundingClientRect();
    if (r.width < 80 || r.height < 16) return null;
    return outer;
  }

  function isTarget(el) {
    return !!resolveTarget(el);
  }

  function getText(el) {
    if (isTextarea(el)) return el.value;
    return String(el.innerText || el.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n');
  }

  function getSelectionOffsets(el) {
    if (isTextarea(el)) {
      return { start: el.selectionStart, end: el.selectionEnd };
    }

    const value = getText(el);
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      return { start: 0, end: value.length };
    }

    try {
      const range = sel.getRangeAt(0);
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const end = start + range.toString().length;
      return {
        start: Math.max(0, Math.min(start, value.length)),
        end: Math.max(0, Math.min(end, value.length))
      };
    } catch (_) {
      return { start: 0, end: value.length };
    }
  }

  function setSelectionOffsets(el, start, end) {
    if (isTextarea(el)) {
      el.focus();
      el.setSelectionRange(start, end);
      return true;
    }

    el.focus();
    const sel = window.getSelection();
    if (!sel) return false;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let charIndex = 0;
    let startNode = null;
    let startOff = 0;
    let endNode = null;
    let endOff = 0;
    let node;

    while ((node = walker.nextNode())) {
      const len = node.nodeValue ? node.nodeValue.length : 0;
      const next = charIndex + len;

      if (!startNode && start <= next) {
        startNode = node;
        startOff = Math.max(0, start - charIndex);
      }
      if (!endNode && end <= next) {
        endNode = node;
        endOff = Math.max(0, end - charIndex);
        break;
      }
      charIndex = next;
    }

    if (!startNode) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }

    if (!endNode) {
      endNode = startNode;
      endOff = startNode.nodeValue ? startNode.nodeValue.length : 0;
    }

    try {
      const range = document.createRange();
      range.setStart(startNode, Math.min(startOff, startNode.nodeValue.length));
      range.setEnd(endNode, Math.min(endOff, endNode.nodeValue.length));
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (_) {
      return false;
    }
  }

  function selectAllEditable(el) {
    el.focus();
    const sel = window.getSelection();
    if (!sel) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function dispatchEditEvents(el, data) {
    try {
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data
      }));
    } catch (_) {}
    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        inputType: 'insertText',
        data
      }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function normalizeVisible(s) {
    return String(s || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function waitFrames(n = 2) {
    return new Promise(resolve => {
      const step = () => {
        if (n-- <= 0) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // Replace a range so React / WhatsApp / Telegram listeners see it.
  // Prefer execCommand('insertText') so the site's own undo stack still works.
  async function replaceRange(el, start, end, text, opts) {
    const preferPaste =
      !!opts?.preferPaste &&
      !isTextarea(el) &&
      // Only use the paste path for full composer rewrites. Partial selection
      // rewriting is more fragile and we keep the old execCommand behavior.
      start <= 0 &&
      end >= getText(el).length;

    el.focus();

    if (isTextarea(el)) {
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
      return true;
    }

    if (preferPaste) {
      selectAllEditable(el);
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
          composed: true
        }));
      } catch (_) {}

      await waitFrames(2);

      // Verify: WhatsApp Lexical normally replaces the whole composer.
      if (normalizeVisible(getText(el)) === normalizeVisible(text)) return true;
    }

    const whole = start <= 0 && end >= getText(el).length;
    if (whole || !setSelectionOffsets(el, start, end)) selectAllEditable(el);

    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      selectAllEditable(el);
      try {
        ok = document.execCommand('insertText', false, text);
      } catch (_) {
        ok = false;
      }
    }

    if (!ok) {
      // Last resort — may be less reliable on Lexical-based composers.
      el.textContent = text;
      dispatchEditEvents(el, text);
    }

    await waitFrames(1);
    return normalizeVisible(getText(el)) === normalizeVisible(
      (start <= 0 && end >= getText(el).length) ? text : text
    );
  }

  // ------------------------------------------------------------------- UI

  function rebuildNativeButtons() {
    if (!nativeWrap) return;

    nativeWrap.replaceChildren();
    nativeBtns = [];

    const list = (cfg.natives || []).filter(n => n.on !== false);
    nativeSep.style.display = list.length ? '' : 'none';
    nativeWrap.style.display = list.length ? 'contents' : 'none';

    list.forEach(n => {
      const level = NATIVE_LEVELS.find(l => l.id === n.id);
      if (!level) return;

      const btn = document.createElement('button');
      btn.className = 'tone';
      btn.textContent = level.label;
      btn.title = 'Rewrite the way a native would say it to ' + level.who +
        (n.hotkey ? ' (' + comboLabel(n.hotkey) + ')' : '');
      btn.dataset.level = level.id;
      btn.disabled = busy;
      btn.addEventListener('click', () => run('native', { level: level.id }));
      nativeWrap.appendChild(btn);
      nativeBtns.push(btn);
    });

    schedule();
  }

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
      btn.addEventListener('click', () => run('translate', { language: t.language }));
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
      /* Tone buttons are a scale, so they read as one group rather than five
         unrelated actions. */
      button.tone { color: #4A5566; letter-spacing: .04em; }
      button.tone:hover:not(:disabled) { background: #EAF0EE; color: #24564C; }
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
      .translate-wrap, .native-wrap { display: contents; }

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
      .lookup {
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
        z-index: 1;
        max-width: min(560px, calc(100vw - 16px));
      }
      .lookup .head {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 9.5px;
        letter-spacing: .09em;
        text-transform: uppercase;
        color: #2F6F62;
        margin: 0 0 8px;
      }
      .lookup .status {
        margin: 0;
        font-size: 12.5px;
        color: #6B7484;
      }
      .lookup[data-error="1"] .status { color: #8A4B12; }
      @media (prefers-reduced-motion: reduce) { .panel, .lookup { transition: none; } }
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

    nativeSep = document.createElement('span');
    nativeSep.className = 'sep';

    nativeWrap = document.createElement('span');
    nativeWrap.className = 'native-wrap';

    translateSep = document.createElement('span');
    translateSep.className = 'sep';

    translateWrap = document.createElement('span');
    translateWrap.className = 'translate-wrap';

    // English actions first (Fix, Rephrase, tone), then the other languages.
    bar.append(
      fixBtn, sep, rephraseBtn,
      nativeSep, nativeWrap,
      translateSep, translateWrap,
      undoBtn, note
    );

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

    lookupPanel = document.createElement('div');
    lookupPanel.className = 'lookup';
    lookupPanel.title = 'Click to dismiss';
    lookupTitleEl = document.createElement('div');
    lookupTitleEl.className = 'head';
    lookupTitleEl.textContent = 'Lookup';
    const lookupStatus = document.createElement('p');
    lookupStatus.className = 'status';
    lookupStatus.style.display = 'none';

    const lookupOld = document.createElement('div');
    lookupOld.className = 'pair old';
    const lookupOldTag = document.createElement('span');
    lookupOldTag.className = 'tag';
    lookupOldTag.textContent = 'Selected';
    lookupBeforeEl = document.createElement('p');
    lookupBeforeEl.className = 'txt';
    lookupOld.append(lookupOldTag, lookupBeforeEl);

    const lookupNew = document.createElement('div');
    lookupNew.className = 'pair new';
    const lookupNewTag = document.createElement('span');
    lookupNewTag.className = 'tag';
    lookupNewTag.textContent = 'Translation';
    lookupAfterEl = document.createElement('p');
    lookupAfterEl.className = 'txt';
    lookupNew.append(lookupNewTag, lookupAfterEl);

    lookupPanel.append(lookupTitleEl, lookupStatus, lookupOld, lookupNew);
    lookupPanel.addEventListener('mousedown', e => { e.preventDefault(); hideLookup(); });
    lookupPanel._status = lookupStatus;
    lookupPanel._old = lookupOld;
    lookupPanel._new = lookupNew;

    shadow.append(style, bar, panel, lookupPanel);
    document.documentElement.appendChild(host);

    applySettings({
      keyFix: keys.fix,
      keyRephrase: keys.rephrase,
      keyUndo: keys.undo,
      translators: cfg.translators,
      natives: cfg.natives
    });

    bar.addEventListener('mousedown', e => e.preventDefault());
    fixBtn.addEventListener('click', () => run('fix'));
    rephraseBtn.addEventListener('click', () => run('rephrase'));
    undoBtn.addEventListener('click', undo);
  }

  function position() {
    rafId = null;

    if (!activeEl || !activeEl.isConnected) {
      hide();
      positionLookup();
      return;
    }

    const r = activeEl.getBoundingClientRect();
    // WhatsApp / Telegram composers are often a single short line.
    if (r.width < 80 || r.height < 16 || r.bottom < 0 || r.top > innerHeight) {
      bar.style.display = 'none';
      positionLookup();
      return;
    }

    bar.style.display = 'flex';
    const w = bar.offsetWidth, h = bar.offsetHeight;

    const barTop = Math.max(4, r.top - h + OVERLAP);
    bar.style.left = Math.max(4, Math.min(r.right - w - 8, innerWidth - w - 4)) + 'px';
    bar.style.top = barTop + 'px';

    if (panel && panel.style.display === 'block') {
      panel.style.width = Math.min(Math.max(r.width, 240), 560) + 'px';
      panel.style.left = Math.max(4, r.left) + 'px';
      const ph = panel.offsetHeight;
      const above = barTop - ph - 6;
      panel.style.top = (above >= 4 ? above : Math.min(innerHeight - ph - 4, r.bottom + 8)) + 'px';
    }

    positionLookup();
  }

  function positionLookup() {
    if (!lookupPanel || lookupPanel.style.display !== 'block' || !lookupAnchor) return;
    const a = lookupAnchor;
    const w = Math.min(560, Math.max(280, a.right - a.left), innerWidth - 16);
    lookupPanel.style.width = w + 'px';
    lookupPanel.style.left = Math.max(4, Math.min(a.left, innerWidth - w - 4)) + 'px';
    const ph = lookupPanel.offsetHeight;
    const above = a.top - ph - 8;
    lookupPanel.style.top = (above >= 4 ? above : Math.min(innerHeight - ph - 4, a.bottom + 8)) + 'px';
  }

  function schedule() {
    if (rafId == null) rafId = requestAnimationFrame(position);
  }

  function hide() {
    if (bar) bar.style.display = 'none';
  }

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

  function ensureUi() {
    if (!host) buildBar();
  }

  function selectionPayload() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const text = String(sel.toString() || '').replace(/\u00a0/g, ' ').trim();
    if (!text) return null;
    let rect;
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch (_) {
      rect = null;
    }
    if (!rect || (!rect.width && !rect.height)) {
      rect = { left: innerWidth / 2 - 140, right: innerWidth / 2 + 140, top: 80, bottom: 100 };
    }
    return {
      text,
      anchor: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      }
    };
  }

  function showLookupWorking(language, anchor) {
    ensureUi();
    clearTimeout(lookupTimer);
    clearTimeout(lookupFadeTimer);
    lookupAnchor = anchor;
    lookupTitleEl.textContent = 'Lookup → ' + language;
    lookupPanel._status.style.display = 'block';
    lookupPanel._status.textContent = 'Translating…';
    lookupPanel.dataset.error = '0';
    lookupPanel._old.style.display = 'none';
    lookupPanel._new.style.display = 'none';
    lookupPanel.style.display = 'block';
    lookupPanel.style.opacity = '0';
    schedule();
    requestAnimationFrame(() => { lookupPanel.style.opacity = '1'; });
  }

  function showLookupResult(language, before, after, anchor) {
    ensureUi();
    clearTimeout(lookupTimer);
    clearTimeout(lookupFadeTimer);
    lookupAnchor = anchor;
    lookupTitleEl.textContent = 'Lookup → ' + language;
    lookupPanel._status.style.display = 'none';
    lookupPanel.dataset.error = '0';
    lookupBeforeEl.textContent = before;
    lookupAfterEl.textContent = after;
    lookupPanel._old.style.display = '';
    lookupPanel._new.style.display = '';
    lookupPanel.style.display = 'block';
    lookupPanel.style.opacity = '0';
    schedule();
    requestAnimationFrame(() => { lookupPanel.style.opacity = '1'; });
    lookupTimer = setTimeout(hideLookup, Math.max(3, cfg.feedbackSeconds) * 1000);
  }

  function showLookupError(msg, anchor) {
    ensureUi();
    clearTimeout(lookupTimer);
    clearTimeout(lookupFadeTimer);
    lookupAnchor = anchor || lookupAnchor || {
      left: 24, right: 320, top: 80, bottom: 100
    };
    lookupTitleEl.textContent = 'Lookup';
    lookupPanel._status.style.display = 'block';
    lookupPanel._status.textContent = msg;
    lookupPanel.dataset.error = '1';
    lookupPanel._old.style.display = 'none';
    lookupPanel._new.style.display = 'none';
    lookupPanel.style.display = 'block';
    lookupPanel.style.opacity = '1';
    schedule();
    lookupTimer = setTimeout(hideLookup, 5000);
  }

  function hideLookup() {
    if (!lookupPanel || lookupPanel.style.display === 'none') return;
    clearTimeout(lookupTimer);
    clearTimeout(lookupFadeTimer);
    lookupPanel.style.opacity = '0';
    lookupFadeTimer = setTimeout(() => {
      lookupPanel.style.display = 'none';
      lookupAnchor = null;
    }, 200);
  }

  async function runLookup(language) {
    if (lookupBusy) return;
    const payload = selectionPayload();
    if (!payload) {
      showLookupError('Select a message first, then press the hotkey.');
      return;
    }
    if (payload.text.length < 2) {
      showLookupError('Selection is too short.', payload.anchor);
      return;
    }

    lookupBusy = true;
    showLookupWorking(language, payload.anchor);
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'rewrite',
        mode: 'lookup',
        text: payload.text,
        language
      });
      if (!res?.ok) throw new Error(res?.error || 'No response.');
      showLookupResult(language, payload.text, res.text, payload.anchor);
    } catch (err) {
      const raw = String(err?.message || err);
      const msg = /extension context invalidated/i.test(raw)
        ? 'Extension was reloaded — refresh this page.'
        : raw;
      showLookupError(msg.slice(0, 160), payload.anchor);
    } finally {
      lookupBusy = false;
    }
  }

  function setBusy(on) {
    busy = on;
    bar.dataset.busy = on ? '1' : '0';
    fixBtn.disabled = rephraseBtn.disabled = undoBtn.disabled = on;
    translateBtns.forEach(btn => { btn.disabled = on; });
    nativeBtns.forEach(btn => { btn.disabled = on; });
    fixBtn.textContent = on ? 'Working' : 'Fix';
    rephraseBtn.style.display = on ? 'none' : '';

    const tones = nativeBtns.length;
    if (nativeWrap) nativeWrap.style.display = on ? 'none' : (tones ? 'contents' : 'none');
    if (nativeSep) nativeSep.style.display = on || !tones ? 'none' : '';

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

  // extra carries the per-mode argument: { language } or { level }.
  async function run(mode, extra) {
    if (busy || !activeEl) return;

    const value = getText(activeEl);
    const { start: selStart, end: selEnd } = getSelectionOffsets(activeEl);

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
        ...(extra || {})
      });
      if (!res?.ok) throw new Error(res?.error || 'No response.');
      if (!activeEl.isConnected) return;

      snapshot = { el: activeEl, before: value, start, end };
      await replaceRange(activeEl, start, end, res.text, {
        preferPaste: !hasSel
      });
      undoBtn.style.display = '';
      showPanel(text, res.text);
    } catch (err) {
      const raw = String(err?.message || err);
      const msg = /extension context invalidated/i.test(raw)
        ? 'Extension was reloaded — refresh this page.'
        : raw;
      showError(msg.slice(0, 140));
    } finally {
      setBusy(false);
      schedule();
    }
  }

  async function undo() {
    if (!snapshot || !snapshot.el.isConnected) return;
    const el = snapshot.el;
    const full = getText(el);
    // Undo always rewrites whole composer.
    await replaceRange(el, 0, full.length, snapshot.before, { preferPaste: true });
    setSelectionOffsets(el, snapshot.start, snapshot.end);
    snapshot = null;
    undoBtn.style.display = 'none';
    hidePanel();
    schedule();
  }

  // ---------------------------------------------------------------- events

  function onFocusIn(e) {
    const target = resolveTarget(e.target);
    if (!target) return;
    if (!host) buildBar();
    activeEl = target;
    if (!snapshot || snapshot.el !== activeEl) {
      snapshot = null;
      undoBtn.style.display = 'none';
    }
    schedule();
  }

  function onFocusOut(e) {
    if (!activeEl) return;
    if (e.target !== activeEl && !activeEl.contains(e.target)) return;

    // Let a click on the bar land before hiding. Also keep the bar if focus
    // merely moved to a nested node inside the same composer.
    setTimeout(() => {
      const ae = document.activeElement;
      if (ae === activeEl || (activeEl && activeEl.contains(ae))) return;
      activeEl = null;
      hide();
      hidePanel();
    }, 120);
  }

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule, true);
  document.addEventListener('input', e => {
    if (!activeEl) return;
    if (e.target !== activeEl && !activeEl.contains(e.target)) return;
    onTyping();
    schedule();
  }, true);

  document.addEventListener('keydown', e => {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) return;

    const combo = comboOf(e);

    // Lookup works on any page selection — not only inside the chat box.
    const lookup = (cfg.lookups || []).find(row => row.hotkey === combo);
    if (lookup) {
      e.preventDefault();
      runLookup(lookup.language);
      return;
    }

    const target = resolveTarget(document.activeElement);
    if (!target) return;
    if (target !== activeEl) activeEl = target;

    if (combo === keys.fix) { e.preventDefault(); run('fix'); }
    else if (combo === keys.rephrase) { e.preventDefault(); run('rephrase'); }
    else if (combo === keys.undo) { e.preventDefault(); undo(); }
    else {
      const n = (cfg.natives || []).find(row => row.on !== false && row.hotkey === combo);
      if (n) { e.preventDefault(); run('native', { level: n.id }); return; }

      const t = (cfg.translators || []).find(row => row.hotkey === combo);
      if (t) { e.preventDefault(); run('translate', { language: t.language }); }
    }
  }, true);
})();
