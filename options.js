'use strict';

const TEXT_FIELDS = ['model', 'fixPrompt', 'rephrasePrompt'];
const BOOL_FIELDS = ['fastMode', 'showFeedback'];
const NUM_FIELDS = ['feedbackSeconds'];
const KEY_FIELDS = ['keyFix', 'keyRephrase', 'keyUndo'];
const $ = id => document.getElementById(id);
const status = $('status');
const keysRoot = $('apiKeys');

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
  TEXT_FIELDS.forEach(k => { $(k).value = out[k]; });
  renderKeys(out.apiKeys.length ? out.apiKeys : ['']);

  // Local only: these settings stay on this browser profile.
  await chrome.storage.local.set(out);
  if (!quiet) {
    const n = out.apiKeys.length;
    say(n ? `Saved (${n} key${n === 1 ? '' : 's'}).` : 'Saved. Add at least one API key to use Fix/Rephrase.', n ? 'ok' : 'bad');
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
    const clash = KEY_FIELDS.find(o => o !== id && $(o).dataset.combo === combo);
    if (clash) {
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
