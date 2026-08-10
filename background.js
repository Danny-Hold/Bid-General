'use strict';

importScripts('defaults.js');

// Models sometimes wrap output in quotes or a code fence despite instructions.
function tidy(text) {
  let t = (text || '').trim();
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
  if (t.length > 1 && /^["'\u201C\u2018]/.test(t) && /["'\u201D\u2019]$/.test(t)) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

// Correcting a verb tense does not need a reasoning pass. Gemini 3.x defaults
// to a high thinking level, so constraining it is the single biggest latency
// win available here. Fast mode is on unless the user turns it off.
const THINKING_LEVEL = {
  fix: 'MINIMAL',
  rephrase: 'LOW',
  translate: 'MINIMAL',
  // Picking the right idiom for the right reader is a judgement call, so this
  // one gets the same budget as Rephrase rather than the minimum.
  native: 'LOW'
};

function isRetryableKeyError(status, data) {
  if (status === 429 || status === 403) return true;
  const msg = String(data?.error?.message || '');
  const code = String(data?.error?.status || data?.error?.code || '');
  return /resource.?exhausted|quota|rate.?limit|too many requests|permission.?denied|api key not valid|invalid api key/i
    .test(msg + ' ' + code);
}

// job: { mode, text, language, level }
function systemPromptFor(settings, job) {
  if (job.mode === 'rephrase') return settings.rephrasePrompt;

  if (job.mode === 'translate') {
    const lang = String(job.language || '').trim() || 'Spanish';
    const template = settings.translatePrompt || DEFAULT_TRANSLATE_PROMPT;
    return template.split('{{language}}').join(lang);
  }

  if (job.mode === 'native') {
    const level = nativeLevel(job.level) || NATIVE_LEVELS[0];
    const template = settings.nativePrompt || DEFAULT_NATIVE_PROMPT;
    return template
      .split('{{audience}}').join(level.audience)
      .split('{{guidance}}').join(level.guidance);
  }

  return settings.fixPrompt;
}

async function callGenerate(apiKey, settings, job, withThinking) {
  const system = systemPromptFor(settings, job);

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(settings.model) + ':generateContent';

  // temperature / top_p / top_k are deprecated on the 3.x models.
  const generationConfig = { maxOutputTokens: 2048 };
  if (withThinking && settings.fastMode !== false) {
    generationConfig.thinkingConfig = {
      thinkingLevel: THINKING_LEVEL[job.mode] || 'MINIMAL'
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: job.text }] }],
      generationConfig
    })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Models outside the 3.x line reject thinkingLevel. Retry once without it
    // on the same key rather than rotating.
    if (withThinking && res.status === 400 && !isRetryableKeyError(res.status, data)) {
      return callGenerate(apiKey, settings, job, false);
    }

    const err = new Error(data?.error?.message || ('Gemini returned HTTP ' + res.status));
    err.retryable = isRetryableKeyError(res.status, data);
    throw err;
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const out = tidy(parts.map(p => p.text || '').join(''));
  if (!out) throw new Error('Model returned nothing. Try again.');
  return out;
}

async function rewrite(job) {
  const settings = await loadSettings();
  const keys = normalizeApiKeys(settings);
  if (!keys.length) {
    throw new Error('No API key set. Open the extension options.');
  }

  if (job.mode === 'translate' && !String(job.language || '').trim()) {
    throw new Error('No target language set. Open the extension options.');
  }

  if (job.mode === 'native' && !nativeLevel(job.level)) {
    throw new Error('Unknown tone level. Open the extension options.');
  }

  const start = Math.min(settings.apiKeyIndex || 0, keys.length - 1);
  let lastError = null;

  for (let i = 0; i < keys.length; i++) {
    const idx = (start + i) % keys.length;
    try {
      const out = await callGenerate(keys[idx], settings, job, true);
      if (idx !== settings.apiKeyIndex) {
        await chrome.storage.local.set({ apiKeyIndex: idx });
      }
      return out;
    } catch (err) {
      lastError = err;
      if (!err.retryable) throw err;
      // Quota / invalid key: try the next one.
    }
  }

  throw lastError || new Error('All API keys failed.');
}

// Google retires model IDs on a rolling schedule, so rather than hardcoding a
// name that will expire, ask the key which models it can actually reach.
async function listModels() {
  const settings = await loadSettings();
  const keys = normalizeApiKeys(settings);
  if (!keys.length) throw new Error('Enter at least one API key first.');

  const start = Math.min(settings.apiKeyIndex || 0, keys.length - 1);
  let lastError = null;

  for (let i = 0; i < keys.length; i++) {
    const idx = (start + i) % keys.length;
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { headers: { 'x-goog-api-key': keys[idx] } }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      lastError = new Error(data?.error?.message || ('Gemini returned HTTP ' + res.status));
      if (isRetryableKeyError(res.status, data)) continue;
      throw lastError;
    }

    const names = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      // Drop anything that isn't plain text generation.
      .filter(n => n && !/embedding|aqa|image|tts|audio|video|veo|robotics|live|learnlm/i.test(n));

    if (!names.length) {
      lastError = new Error('No text models available on this key.');
      continue;
    }

    // Flash first, since that is the right tier for this job.
    names.sort((a, b) => {
      const fa = /flash/i.test(a) ? 0 : 1;
      const fb = /flash/i.test(b) ? 0 : 1;
      return fa - fb || b.localeCompare(a);
    });

    if (idx !== settings.apiKeyIndex) {
      await chrome.storage.local.set({ apiKeyIndex: idx });
    }
    return names;
  }

  throw lastError || new Error('All API keys failed.');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'rewrite') {
    rewrite({ mode: msg.mode, text: msg.text, language: msg.language, level: msg.level })
      .then(text => sendResponse({ ok: true, text }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true; // keep the message channel open for the async reply
  }

  if (msg?.type === 'listModels') {
    listModels()
      .then(models => sendResponse({ ok: true, models }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
});
