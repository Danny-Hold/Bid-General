'use strict';

/**
 * Shared defaults. Loaded by both the service worker (importScripts) and the
 * options page (<script>), so the prompt text lives in exactly one place.
 */

const DEFAULT_FIX_PROMPT =
`You are proofreading a short chat message that a freelancer is about to send to a client on a freelancing marketplace. The writer is not a native English speaker.

Correct only mechanical errors: spelling, grammar, verb tense, subject-verb agreement, articles (a/an/the), prepositions, plurals, pronouns, word order, capitalization, spacing and punctuation. Use US spelling.

Do not rephrase. Do not reorder or merge sentences. Do not swap correct words for better ones. Do not add or remove information. Do not change the length, the tone or the level of formality. Keep the writer's contractions, casing and line breaks as they are.

Leave these exactly as written: names, technical terms, file names, URLs, numbers, prices, dates and any code.

If the message has no errors, return it unchanged.

Return only the message text. No commentary, no explanation, no quotation marks, no markdown.`;

const DEFAULT_REPHRASE_PROMPT =
`Rewrite a short chat message that a freelancer is about to send to a client on a freelancing marketplace, so that it reads the way a native US English speaker would write it.

Keep it a chat message: conversational, direct, and the same length or shorter. Do not turn it into a formal email.

Preserve the meaning exactly. Never add facts, prices, dates, timelines, deliverables, qualifications or commitments that are not already in the original. If something is vague, leave it vague. Keep questions as questions. Keep the original's level of certainty: do not turn "I think I can" into "I can".

Leave these exactly as written: names, technical terms, file names, URLs, numbers, prices, dates and any code.

Avoid marketing language, enthusiasm words such as "excited", "passionate" or "amazing", exclamation marks, emoji, em dashes, and openers such as "I hope this message finds you well". Do not add a greeting or a sign-off that was not already there.

If the message already reads naturally, return it unchanged.

Return only the message text. No commentary, no explanation, no quotation marks, no markdown.`;

const MAX_API_KEYS = 5;

const DEFAULTS = {
  // Prefer apiKeys. apiKey is kept only so older installs migrate cleanly.
  apiKey: '',
  apiKeys: [],
  apiKeyIndex: 0,
  model: 'gemini-3.6-flash',
  fastMode: true,
  keyFix: 'Ctrl+Alt+KeyA',
  keyRephrase: 'Ctrl+Alt+KeyS',
  keyUndo: 'Ctrl+Alt+KeyQ',
  showFeedback: true,
  feedbackSeconds: 6,
  fixPrompt: DEFAULT_FIX_PROMPT,
  rephrasePrompt: DEFAULT_REPHRASE_PROMPT
};

/** Build a stable combo string from a keyboard event. */
function comboOf(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(e.code);
  return parts.join('+');
}

/** Turn 'Ctrl+Shift+KeyA' into 'Ctrl + Shift + A' for display. */
function comboLabel(combo) {
  return String(combo || '')
    .split('+')
    .map(p => p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num '))
    .join(' + ');
}

/** Unique non-empty keys from apiKeys, falling back to the legacy apiKey field. */
function normalizeApiKeys(settings) {
  const raw = Array.isArray(settings?.apiKeys) ? settings.apiKeys.slice() : [];
  if (settings?.apiKey) raw.unshift(settings.apiKey);

  const seen = new Set();
  const out = [];
  for (const k of raw) {
    const key = String(k || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_API_KEYS) break;
  }
  return out;
}

/**
 * Settings live in chrome.storage.local, which is tied to this browser profile
 * and never leaves the machine. chrome.storage.sync would push the API key to
 * every device signed into the same Google account, including personal ones.
 */
async function loadSettings() {
  const local = await chrome.storage.local.get(DEFAULTS);

  // One-time move for anyone who ran an earlier build that used sync.
  if (!local.apiKey && !(local.apiKeys && local.apiKeys.length)) {
    const synced = await chrome.storage.sync.get(DEFAULTS);
    if (synced.apiKey || (synced.apiKeys && synced.apiKeys.length)) {
      await chrome.storage.local.set(synced);
      await chrome.storage.sync.clear();
      return migrateApiKeys(synced);
    }
  }

  return migrateApiKeys(local);
}

/** Fold the legacy single apiKey into apiKeys once, then drop the old field. */
async function migrateApiKeys(settings) {
  const keys = normalizeApiKeys(settings);
  const needsWrite =
    settings.apiKey ||
    JSON.stringify(settings.apiKeys || []) !== JSON.stringify(keys);

  if (needsWrite) {
    const next = {
      ...settings,
      apiKeys: keys,
      apiKey: '',
      apiKeyIndex: Math.min(Math.max(0, Number(settings.apiKeyIndex) || 0), Math.max(0, keys.length - 1))
    };
    await chrome.storage.local.set({
      apiKeys: next.apiKeys,
      apiKey: '',
      apiKeyIndex: next.apiKeyIndex
    });
    return next;
  }

  return {
    ...settings,
    apiKeys: keys,
    apiKeyIndex: Math.min(Math.max(0, Number(settings.apiKeyIndex) || 0), Math.max(0, keys.length - 1))
  };
}
