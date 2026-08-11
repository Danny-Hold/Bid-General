'use strict';

const TEXT_FIELDS = ['model', 'fixPrompt', 'rephrasePrompt', 'translatePrompt', 'lookupPrompt', 'nativePrompt'];
const BOOL_FIELDS = ['fastMode', 'showFeedback'];
const NUM_FIELDS = ['feedbackSeconds'];
const KEY_FIELDS = ['keyFix', 'keyRephrase', 'keyUndo'];
const $ = id => document.getElementById(id);
const status = $('status');
const keysRoot = $('apiKeys');
const translatorsRoot = $('translators');
const lookupsRoot = $('lookups');
const nativesRoot = $('natives');

const FALLBACK_HOTKEYS = [
  'Ctrl+Alt+KeyD',
  'Ctrl+Alt+KeyF',
  'Ctrl+Alt+KeyG',
  'Ctrl+Alt+KeyH',
  'Ctrl+Alt+KeyJ',
  'Ctrl+Alt+KeyK',
  'Ctrl+Alt+KeyZ'
];

const LOOKUP_FALLBACK_HOTKEYS = [
  'Ctrl+Alt+KeyZ',
  'Ctrl+Alt+KeyX',
  'Ctrl+Alt+KeyC',
  'Ctrl+Alt+KeyV',
  'Ctrl+Alt+KeyB',
  'Ctrl+Alt+KeyN'
];

function say(msg, tone) {
  status.textContent = msg;
  status.dataset.tone = tone || '';
}

function keyRows() {
  return [...keysRoot.querySelectorAll('.key-row')];
}

function readKeysFromUi() {
  const seen = new Set();
  const out = [];
  for (const row of keyRows()) {
    const key = row.querySelector('input').value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_API_KEYS) break;
  }
  return out;
}

function syncKeyControls() {
  const rows = keyRows();
  $('addKey').disabled = rows.length >= MAX_API_KEYS;
  rows.forEach(row => {
    const btn = row.querySelector('.remove');
    if (btn) btn.disabled = rows.length <= 1;
  });
}

function addKeyRow(value) {
  if (keyRows().length >= MAX_API_KEYS) return;

  const row = document.createElement('div');
  row.className = 'key-row';

  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.placeholder = 'AIza…';
  input.spellcheck = false;
  input.value = value || '';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    if (keyRows().length <= 1) {
      input.value = '';
      syncKeyControls();
      return;
    }
    row.remove();
    syncKeyControls();
  });

  row.append(input, remove);
  keysRoot.appendChild(row);
  syncKeyControls();
}

function renderKeys(keys) {
  keysRoot.replaceChildren();
  const list = keys && keys.length ? keys : [''];
  list.slice(0, MAX_API_KEYS).forEach(k => addKeyRow(k));
  syncKeyControls();
}

function translatorRows() {
  return [...translatorsRoot.querySelectorAll('.lang-row')];
}

// Every hotkey box on the page carries class "key" — the fixed actions, the
// translator rows and the tone rows — so one sweep covers all of them.
function reservedCombos(exceptInput) {
  const used = new Set();
  document.querySelectorAll('input.key').forEach(el => {
    if (el !== exceptInput && el.dataset.combo) used.add(el.dataset.combo);
  });
  return used;
}

function nextFreeHotkey() {
  const used = reservedCombos(null);
  return FALLBACK_HOTKEYS.find(h => !used.has(h)) || '';
}

function nextFreeLookupHotkey() {
  const used = reservedCombos(null);
  return LOOKUP_FALLBACK_HOTKEYS.find(h => !used.has(h)) || nextFreeHotkey();
}

function fillLanguageSelect(sel, language, options) {
  const list = options || LANGUAGE_OPTIONS;
  sel.replaceChildren();
  list.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  const custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = 'Custom…';
  sel.appendChild(custom);

  if (list.includes(language)) {
    sel.value = language;
  } else {
    sel.value = '__custom__';
  }
}

function syncTranslatorControls() {
  const rows = translatorRows();
  $('addTranslator').disabled = rows.length >= MAX_TRANSLATORS;
  rows.forEach(row => {
    const btn = row.querySelector('.remove');
    if (btn) btn.disabled = false;
  });
}

function bindHotkeyInput(input) {
  input.addEventListener('keydown', e => {
    e.preventDefault();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      say('Use at least Ctrl, Alt or Cmd, or it will fire while typing.', 'bad');
      return;
    }
    const combo = comboOf(e);
    if (reservedCombos(input).has(combo)) {
      say('That combination is already used by another action.', 'bad');
      return;
    }
    input.dataset.combo = combo;
    input.value = comboLabel(combo);
    say('Set. Save to keep it.');
  });
  input.addEventListener('focus', () => { input.value = 'Press a combination…'; });
  input.addEventListener('blur', () => { input.value = comboLabel(input.dataset.combo); });
}

function nativeRows() {
  return [...nativesRoot.querySelectorAll('.tone-row')];
}

// The five levels are fixed — you can turn one off or rebind it, not add a sixth.
function addNativeRow(level, entry) {
  const row = document.createElement('div');
  row.className = 'tone-row';
  row.dataset.id = level.id;

  const who = document.createElement('label');
  who.className = 'who';

  const on = document.createElement('input');
  on.type = 'checkbox';
  on.className = 'on';
  on.checked = !entry || entry.on !== false;

  const text = document.createElement('span');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = level.title;
  const desc = document.createElement('span');
  desc.className = 'desc';
  desc.textContent = level.blurb;
  text.append(name, desc);
  who.append(on, text);

  const hotkeyInput = document.createElement('input');
  hotkeyInput.className = 'key';
  hotkeyInput.type = 'text';
  hotkeyInput.readOnly = true;
  hotkeyInput.dataset.combo = (entry && entry.hotkey) || level.hotkey;
  hotkeyInput.value = comboLabel(hotkeyInput.dataset.combo);
  bindHotkeyInput(hotkeyInput);

  row.append(who, hotkeyInput);
  nativesRoot.appendChild(row);
}

function renderNatives(list) {
  nativesRoot.replaceChildren();
  const saved = new Map((list || []).map(n => [n.id, n]));
  NATIVE_LEVELS.forEach(level => addNativeRow(level, saved.get(level.id)));
}

function readNativesFromUi() {
  // The three fixed actions win a clash; a tone level just loses its shortcut
  // rather than its button.
  const taken = new Set(KEY_FIELDS.map(id => $(id).dataset.combo).filter(Boolean));

  return nativeRows().map(row => {
    let hotkey = (row.querySelector('input.key').dataset.combo || '').trim();
    if (taken.has(hotkey)) hotkey = '';
    if (hotkey) taken.add(hotkey);
    return {
      id: row.dataset.id,
      hotkey,
      on: row.querySelector('input.on').checked
    };
  });
}

function addTranslatorRow(entry) {
  if (translatorRows().length >= MAX_TRANSLATORS) return;

  const language = (entry && entry.language) || 'Spanish';
  const hotkey = (entry && entry.hotkey) || nextFreeHotkey() || 'Ctrl+Alt+KeyD';
  const isCustom = language && !LANGUAGE_OPTIONS.includes(language);

  const row = document.createElement('div');
  row.className = 'lang-row';

  const langWrap = document.createElement('div');
  const sel = document.createElement('select');
  fillLanguageSelect(sel, language, LANGUAGE_OPTIONS);

  const custom = document.createElement('input');
  custom.type = 'text';
  custom.className = 'lang-custom';
  custom.placeholder = 'Language name';
  custom.spellcheck = true;
  custom.value = isCustom ? language : '';
  custom.classList.toggle('hidden', !isCustom);

  sel.addEventListener('change', () => {
    const customMode = sel.value === '__custom__';
    custom.classList.toggle('hidden', !customMode);
    if (customMode) custom.focus();
  });

  langWrap.append(sel, custom);

  const hotkeyInput = document.createElement('input');
  hotkeyInput.className = 'key';
  hotkeyInput.type = 'text';
  hotkeyInput.readOnly = true;
  hotkeyInput.dataset.combo = hotkey;
  hotkeyInput.value = comboLabel(hotkey);
  bindHotkeyInput(hotkeyInput);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    row.remove();
    syncTranslatorControls();
  });

  row.append(langWrap, hotkeyInput, remove);
  translatorsRoot.appendChild(row);
  syncTranslatorControls();
}

function renderTranslators(list) {
  translatorsRoot.replaceChildren();
  const rows = list && list.length ? list : DEFAULT_TRANSLATORS;
  rows.slice(0, MAX_TRANSLATORS).forEach(addTranslatorRow);
  syncTranslatorControls();
}

function readTranslatorsFromUi() {
  const out = [];
  const seenLang = new Set();
  const seenHotkey = new Set();
  // Hotkeys already claimed by the fixed actions, tone levels or lookup.
  const claimed = new Set([
    ...KEY_FIELDS.map(id => $(id).dataset.combo),
    ...nativeRows().map(row => row.querySelector('input.key').dataset.combo),
    ...lookupRows().map(row => row.querySelector('input.key').dataset.combo)
  ].filter(Boolean));

  for (const row of translatorRows()) {
    const sel = row.querySelector('select');
    const custom = row.querySelector('input.lang-custom');
    const hotkeyEl = row.querySelector('input.key');
    const language = (sel.value === '__custom__'
      ? (custom.value || '').trim()
      : sel.value).trim();
    const hotkey = (hotkeyEl.dataset.combo || '').trim();
    if (!language || !hotkey) continue;

    // Fix / Rephrase already cover English.
    if (/^english$/i.test(language)) continue;
    const langKey = language.toLowerCase();
    if (seenLang.has(langKey) || seenHotkey.has(hotkey)) continue;
    if (claimed.has(hotkey)) continue;

    seenLang.add(langKey);
    seenHotkey.add(hotkey);
    out.push({ language, hotkey });
    if (out.length >= MAX_TRANSLATORS) break;
  }

  return out;
}

function lookupRows() {
  return [...lookupsRoot.querySelectorAll('.lang-row')];
}

function syncLookupControls() {
  const rows = lookupRows();
  $('addLookup').disabled = rows.length >= MAX_LOOKUPS;
  rows.forEach(row => {
    const btn = row.querySelector('.remove');
    if (btn) btn.disabled = rows.length <= 1;
  });
}

function addLookupRow(entry) {
  if (lookupRows().length >= MAX_LOOKUPS) return;

  const language = (entry && entry.language) || 'English';
  const hotkey = (entry && entry.hotkey) || nextFreeLookupHotkey() || 'Ctrl+Alt+KeyZ';
  const isCustom = language && !LOOKUP_LANGUAGE_OPTIONS.includes(language);

  const row = document.createElement('div');
  row.className = 'lang-row';

  const langWrap = document.createElement('div');
  const sel = document.createElement('select');
  fillLanguageSelect(sel, language, LOOKUP_LANGUAGE_OPTIONS);

  const custom = document.createElement('input');
  custom.type = 'text';
  custom.className = 'lang-custom';
  custom.placeholder = 'Language name';
  custom.spellcheck = true;
  custom.value = isCustom ? language : '';
  custom.classList.toggle('hidden', !isCustom);

  sel.addEventListener('change', () => {
    const customMode = sel.value === '__custom__';
    custom.classList.toggle('hidden', !customMode);
    if (customMode) custom.focus();
  });

  langWrap.append(sel, custom);

  const hotkeyInput = document.createElement('input');
  hotkeyInput.className = 'key';
  hotkeyInput.type = 'text';
  hotkeyInput.readOnly = true;
  hotkeyInput.dataset.combo = hotkey;
  hotkeyInput.value = comboLabel(hotkey);
  bindHotkeyInput(hotkeyInput);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    if (lookupRows().length <= 1) {
      // Keep one empty-ish row usable: reset to English default hotkey if free.
      sel.value = 'English';
      custom.value = '';
      custom.classList.add('hidden');
      const fallback = nextFreeLookupHotkey() || 'Ctrl+Alt+KeyZ';
      hotkeyInput.dataset.combo = fallback;
      hotkeyInput.value = comboLabel(fallback);
      syncLookupControls();
      return;
    }
    row.remove();
    syncLookupControls();
  });

  row.append(langWrap, hotkeyInput, remove);
  lookupsRoot.appendChild(row);
  syncLookupControls();
}

function renderLookups(list) {
  lookupsRoot.replaceChildren();
  const rows = list && list.length ? list : DEFAULT_LOOKUPS;
  rows.slice(0, MAX_LOOKUPS).forEach(addLookupRow);
  syncLookupControls();
}

function readLookupsFromUi() {
  const out = [];
  const seenLang = new Set();
  const seenHotkey = new Set();
  const claimed = new Set([
    ...KEY_FIELDS.map(id => $(id).dataset.combo),
    ...nativeRows().map(row => row.querySelector('input.key').dataset.combo),
    ...translatorRows().map(row => row.querySelector('input.key').dataset.combo)
  ].filter(Boolean));

  for (const row of lookupRows()) {
    const sel = row.querySelector('select');
    const custom = row.querySelector('input.lang-custom');
    const hotkeyEl = row.querySelector('input.key');
    const language = (sel.value === '__custom__'
      ? (custom.value || '').trim()
      : sel.value).trim();
    const hotkey = (hotkeyEl.dataset.combo || '').trim();
    if (!language || !hotkey) continue;

    const langKey = language.toLowerCase();
    if (seenLang.has(langKey) || seenHotkey.has(hotkey)) continue;
    if (claimed.has(hotkey)) continue;

    seenLang.add(langKey);
    seenHotkey.add(hotkey);
    out.push({ language, hotkey });
    if (out.length >= MAX_LOOKUPS) break;
  }

  return out;
}

async function load() {
  const data = await loadSettings();
  TEXT_FIELDS.forEach(k => { $(k).value = data[k]; });
  BOOL_FIELDS.forEach(k => { $(k).checked = data[k] !== false; });
  NUM_FIELDS.forEach(k => { $(k).value = data[k]; });
  KEY_FIELDS.forEach(k => {
    const el = $(k);
    el.dataset.combo = data[k] || DEFAULTS[k];
    el.value = comboLabel(el.dataset.combo);
  });
  renderKeys(normalizeApiKeys(data));
  renderNatives(normalizeNatives(data));
  renderTranslators(normalizeTranslators(data));
  renderLookups(normalizeLookups(data));
}

async function save(quiet) {
  const out = {};
  TEXT_FIELDS.forEach(k => { out[k] = $(k).value.trim(); });
  BOOL_FIELDS.forEach(k => { out[k] = $(k).checked; });
  KEY_FIELDS.forEach(k => { out[k] = $(k).dataset.combo || DEFAULTS[k]; });
  NUM_FIELDS.forEach(k => {
    const n = Math.round(Number($(k).value));
    out[k] = Number.isFinite(n) && n > 0 ? Math.min(n, 60) : DEFAULTS[k];
    $(k).value = out[k];
  });

  out.apiKeys = readKeysFromUi();
  out.apiKey = '';
  out.natives = normalizeNatives({ natives: readNativesFromUi() });
  out.translators = normalizeTranslators({ translators: readTranslatorsFromUi() });
  out.lookups = normalizeLookups({ lookups: readLookupsFromUi() });

  // Keep the last working key if it is still in the list.
  const prev = await chrome.storage.local.get(['apiKeys', 'apiKey', 'apiKeyIndex']);
  const prevKeys = normalizeApiKeys(prev);
  const prevKey = prevKeys[Math.min(prev.apiKeyIndex || 0, Math.max(0, prevKeys.length - 1))];
  const keep = prevKey ? out.apiKeys.indexOf(prevKey) : -1;
  out.apiKeyIndex = keep >= 0 ? keep : 0;

  // An empty instruction box would silently produce garbage, so fall back.
  if (!out.model) out.model = DEFAULTS.model;
  if (!out.fixPrompt) out.fixPrompt = DEFAULTS.fixPrompt;
  if (!out.rephrasePrompt) out.rephrasePrompt = DEFAULTS.rephrasePrompt;
  if (!out.translatePrompt) out.translatePrompt = DEFAULTS.translatePrompt;
  if (!out.lookupPrompt) out.lookupPrompt = DEFAULTS.lookupPrompt;
  if (!out.nativePrompt) out.nativePrompt = DEFAULTS.nativePrompt;
  TEXT_FIELDS.forEach(k => { $(k).value = out[k]; });
  renderKeys(out.apiKeys.length ? out.apiKeys : ['']);
  renderNatives(out.natives);
  renderTranslators(out.translators);
  renderLookups(out.lookups);

  // Local only: these settings stay on this browser profile.
  await chrome.storage.local.set(out);
  if (!quiet) {
    const n = out.apiKeys.length;
    const t = out.translators.length;
    const l = out.lookups.length;
    const v = out.natives.filter(x => x.on).length;
    say(
      n
        ? `Saved (${n} key${n === 1 ? '' : 's'}, ${t} compose / ${l} lookup lang${(t + l) === 1 ? '' : 's'}, ${v} tone${v === 1 ? '' : 's'}).`
        : 'Saved. Add at least one API key to use any of the buttons.',
      n ? 'ok' : 'bad'
    );
    setTimeout(() => { if (status.dataset.tone === 'ok') say(''); }, 2500);
  }
}

async function test() {
  await save(true);
  if (!readKeysFromUi().length) {
    say('Add at least one API key first.', 'bad');
    return;
  }
  say('Testing…');

  const sample = 'i has finish the design yesterday and i will send you the file in tommorow morning';
  const res = await chrome.runtime.sendMessage({ type: 'rewrite', mode: 'fix', text: sample });

  if (res?.ok) {
    say('Working. Fix returned: ' + res.text, 'ok');
  } else {
    say(res?.error || 'No response from the background worker.', 'bad');
  }
}

// The text input stays the single source of truth for the saved value.
// The select is a picker that writes into it.
function showPicker(models, chosen) {
  const sel = $('modelSelect');

  sel.replaceChildren(...models.map(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    return opt;
  }));

  sel.value = chosen;
  $('model').value = chosen;

  sel.classList.remove('hidden');
  $('model').classList.add('hidden');
  $('loadModels').classList.add('hidden');
  $('typeModel').classList.remove('hidden');
}

function showTextField() {
  $('modelSelect').classList.add('hidden');
  $('model').classList.remove('hidden');
  $('typeModel').classList.add('hidden');
  $('loadModels').classList.remove('hidden');
  $('model').focus();
}

async function loadModels() {
  await save(true);
  if (!readKeysFromUi().length) {
    say('Add at least one API key first.', 'bad');
    return;
  }
  say('Loading models…');

  const res = await chrome.runtime.sendMessage({ type: 'listModels' });
  if (!res?.ok) {
    say(res?.error || 'Could not reach the Gemini API.', 'bad');
    return;
  }

  const current = $('model').value.trim();

  if (res.models.includes(current)) {
    showPicker(res.models, current);
    say(`${res.models.length} models available. Pick one, then save.`, 'ok');
    return;
  }

  const fallback = res.models.find(n => /flash/i.test(n) && !/lite|preview/i.test(n))
    || res.models.find(n => /flash/i.test(n))
    || res.models[0];

  showPicker(res.models, fallback);
  say(`"${current}" is not available on this key. Switched to ${fallback}. Save to keep it.`, 'ok');
}

function reset() {
  $('fixPrompt').value = DEFAULTS.fixPrompt;
  $('rephrasePrompt').value = DEFAULTS.rephrasePrompt;
  $('translatePrompt').value = DEFAULTS.translatePrompt;
  $('lookupPrompt').value = DEFAULTS.lookupPrompt;
  $('nativePrompt').value = DEFAULTS.nativePrompt;
  say('Instructions restored. Save to keep them.');
}

$('save').addEventListener('click', () => save(false));
$('test').addEventListener('click', test);
$('reset').addEventListener('click', reset);
$('loadModels').addEventListener('click', loadModels);
$('typeModel').addEventListener('click', showTextField);
$('addKey').addEventListener('click', () => {
  addKeyRow('');
  const inputs = keysRoot.querySelectorAll('input');
  inputs[inputs.length - 1]?.focus();
});
$('addTranslator').addEventListener('click', () => {
  addTranslatorRow({ language: 'Portuguese', hotkey: nextFreeHotkey() });
});
$('addLookup').addEventListener('click', () => {
  addLookupRow({ language: 'English', hotkey: nextFreeLookupHotkey() });
});

// Capture a key combination instead of typing one.
KEY_FIELDS.forEach(id => {
  const el = $(id);
  el.addEventListener('keydown', e => {
    e.preventDefault();
    // Ignore a bare modifier press; wait for the real key.
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      say('Use at least Ctrl, Alt or Cmd, or it will fire while typing.', 'bad');
      return;
    }
    const combo = comboOf(e);
    if (reservedCombos(el).has(combo)) {
      say('That combination is already used by another action.', 'bad');
      return;
    }
    el.dataset.combo = combo;
    el.value = comboLabel(combo);
    say('Set. Save to keep it.');
  });
  el.addEventListener('focus', () => { el.value = 'Press a combination…'; });
  el.addEventListener('blur', () => { el.value = comboLabel(el.dataset.combo); });
});

$('modelSelect').addEventListener('change', e => {
  $('model').value = e.target.value;
  say('Model set to ' + e.target.value + '. Save to keep it.');
});
load();
