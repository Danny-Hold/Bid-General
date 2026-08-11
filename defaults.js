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

const DEFAULT_TRANSLATE_PROMPT =
`Translate a short English chat message that a freelancer is about to send to a client on a freelancing marketplace into casual {{language}}.

The source is English. Write natural, everyday {{language}} — the way people actually message on a freelancing site, not formal, literary or textbook language. Prefer common words and spoken phrasing. Keep contractions and a relaxed tone where that language uses them.

Keep it a chat message: casual, conversational, direct, and about the same length. Do not turn it into a formal email, business letter or polished marketing copy. Do not add a greeting or sign-off that was not already there.

Preserve the meaning exactly. Never add facts, prices, dates, timelines, deliverables, qualifications or commitments that are not already in the original. If something is vague, leave it vague. Keep questions as questions. Keep the original's level of certainty.

Leave these exactly as written when they are proper nouns or identifiers: names, technical terms, file names, URLs, numbers, prices, dates and any code. Translate surrounding prose only.

Return only the translated message text. No commentary, no explanation, no quotation marks, no markdown.`;

/**
 * Lookup / read-translate. For understanding someone else's selected message.
 * Does not write into the chat box — the content script only shows the result.
 * English is a valid target here (unlike compose Translate).
 */
const DEFAULT_LOOKUP_PROMPT =
`Translate the following chat message into clear, natural {{language}}.

The text is something another person wrote that the user has selected in order to understand it. Keep the meaning exactly. Prefer everyday wording over formal or literary phrasing. Keep it about the same length.

Leave these exactly as written when they are proper nouns or identifiers: names, technical terms, file names, URLs, numbers, prices, dates and any code.

If the message is already in {{language}}, return it unchanged.

Return only the translated message text. No commentary, no explanation, no quotation marks, no markdown.`;

/**
 * Native tone. English in, English out. Unlike Rephrase (which only makes the
 * message read naturally), this one deliberately compresses into the set
 * phrases and idioms a native writer would actually reach for, and pitches the
 * respect level at whoever is on the other side of the chat.
 * {{audience}} and {{guidance}} are filled in per level.
 */
const DEFAULT_NATIVE_PROMPT =
`Rewrite a short English chat message so that it reads the way a fluent native English speaker would actually write it to {{audience}}.

The point of this rewrite is to sound native, not translated. Native writers compress: they cut filler, drop words the reader can infer, and reach for the common set phrase instead of explaining the idea longhand. Prefer the everyday idioms, phrasal verbs and fixed expressions ordinary native speakers use in chat — "let me know", "get back to you", "sounds good", "up to you", "give it a shot", "heads up", "on it", "no rush" — but only where one genuinely fits. Never force an idiom in, never use a rare or literary one, and never use one the reader would have to stop and decode. Where plain wording is what a native would write, use plain wording.

Aim shorter than the original wherever the meaning allows.

{{guidance}}

Preserve the meaning exactly. Never add facts, prices, dates, timelines, deliverables, qualifications or commitments that are not already in the original. If something is vague, leave it vague. Keep questions as questions. Keep the original's level of certainty: do not turn "I think I can" into "I can".

Leave these exactly as written: names, technical terms, file names, URLs, numbers, prices, dates and any code.

Keep it a chat message rather than an email, and keep it in English. Do not add a greeting or a sign-off that was not already there. No emoji, no em dashes, no marketing language, and no exclamation marks unless the original had them.

Return only the message text. No commentary, no explanation, no quotation marks, no markdown.`;

/**
 * Five relationship levels, ordered from most casual to most deferential.
 * Levels 3 to 5 all have to read as respectful; 4 and 5 most of all.
 * `id` is what gets stored and sent, so it must not change once shipped.
 */
const NATIVE_LEVELS = [
  {
    id: 'friend',
    label: 'Friend',
    title: 'Best friend',
    blurb: 'Relaxed and blunt. Slang and fragments fine.',
    audience: 'a close friend',
    hotkey: 'Ctrl+Alt+Digit1',
    guidance:
`The reader is a close friend. Write the way you would text someone you have known for years: relaxed, blunt and short, contractions everywhere, sentence fragments and mild slang are fine. Drop the politeness formulas — no "please could you", no "I was wondering if", no thanking them for small things. Warmth here comes from sounding easy, not from sounding polite.`
  },
  {
    id: 'teammate',
    label: 'Peer',
    title: 'Same-level teammate',
    blurb: 'Casual and efficient. No ceremony.',
    audience: 'a teammate at the same level as you',
    hotkey: 'Ctrl+Alt+Digit2',
    guidance:
`The reader is a teammate at your own level. Write like a working peer in a team chat: casual, efficient and direct, contractions throughout, no ceremony and no throat-clearing. Getting to the point fast is the courteous thing here. Keep it clear of heavy slang and in-jokes — assume a manager could scroll past it.`
  },
  {
    id: 'polite',
    label: 'Polite',
    title: 'Someone you do not know well',
    blurb: 'Natural but courteous. Asks, never instructs.',
    audience: 'someone you do not know well and want to come across as respectful to',
    hotkey: 'Ctrl+Alt+Digit3',
    guidance:
`The reader is someone you do not know well, so this has to read as respectful as well as natural. Keep it plainly worded and friendly, but stay courteous throughout: ask rather than instruct ("could you", "would you mind" rather than "send me"), keep "please" and "thank you" where they belong, and soften anything that would land as blunt or demanding. No slang, no in-jokes, no over-familiarity. The respect comes from being considerate and clear, not from being stiff, formal or wordy.`
  },
  {
    id: 'client',
    label: 'Client',
    title: 'Client',
    blurb: 'Professional and respectful. No slang at all.',
    audience: 'a client who is paying you for your work',
    hotkey: 'Ctrl+Alt+Digit4',
    guidance:
`The reader is a paying client and this message has to earn their confidence, so respect is the priority. Be professional, courteous and warm the whole way through: keep "please", "thank you" and "I appreciate" where they fit, acknowledge their point before answering it, and take responsibility rather than making excuses. Concise and native, but never casual, never curt and never slangy: no "yeah", "gonna", "no worries", "my bad", "ASAP". Use only idioms that are safe in professional writing, such as "happy to", "let me know", "get back to you", "walk you through".`
  },
  {
    id: 'boss',
    label: 'Boss',
    title: 'Boss',
    blurb: 'Brief and deferential. Point first.',
    audience: 'your manager, who is senior to you',
    hotkey: 'Ctrl+Alt+Digit5',
    guidance:
`The reader is your manager or someone senior to you, so the message must read as clearly respectful while staying efficient. Lead with the point — senior readers skim, and brevity is itself a courtesy — then keep the tone deferential: ask, do not tell, and never issue an instruction to them. No slang and no over-familiarity. Keep "please" and "thank you" where they fit. State problems plainly, without excuses and without defensiveness, and keep any hedge the original had; do not turn a maybe into a promise, yours or theirs.`
  }
];

const DEFAULT_NATIVES = NATIVE_LEVELS.map(l => ({ id: l.id, hotkey: l.hotkey, on: true }));

const MAX_API_KEYS = 5;
const MAX_TRANSLATORS = 6;
const MAX_LOOKUPS = 6;

/** Look up a tone level by its stored id. */
function nativeLevel(id) {
  return NATIVE_LEVELS.find(l => l.id === String(id || '').trim()) || null;
}

/** Target languages only — English is handled by Fix / Rephrase, not Translate. */
const LANGUAGE_OPTIONS = [
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Italian',
  'Dutch',
  'Polish',
  'Ukrainian',
  'Russian',
  'Turkish',
  'Arabic',
  'Hindi',
  'Bengali',
  'Indonesian',
  'Malay',
  'Vietnamese',
  'Thai',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Japanese',
  'Korean'
];

/** Lookup may target English — that is the usual case for reading others' messages. */
const LOOKUP_LANGUAGE_OPTIONS = ['English', ...LANGUAGE_OPTIONS];

const DEFAULT_TRANSLATORS = [
  { language: 'Spanish', hotkey: 'Ctrl+Alt+KeyD' },
  { language: 'French', hotkey: 'Ctrl+Alt+KeyF' }
];

const DEFAULT_LOOKUPS = [
  { language: 'English', hotkey: 'Ctrl+KeyO' }
];

/** Older prompt — migrate installs still on this text to the casual version. */
const LEGACY_TRANSLATE_PROMPT =
`Translate a short chat message that a freelancer is about to send to a client on a freelancing marketplace into {{language}}.

Keep it a chat message: conversational, direct, and about the same length. Do not turn it into a formal email or add a greeting or sign-off that was not already there.

Preserve the meaning exactly. Never add facts, prices, dates, timelines, deliverables, qualifications or commitments that are not already in the original. If something is vague, leave it vague. Keep questions as questions. Keep the original's level of certainty.

Leave these exactly as written when they are proper nouns or identifiers: names, technical terms, file names, URLs, numbers, prices, dates and any code. Translate surrounding prose only.

If the message is already in {{language}}, return it unchanged.

Return only the translated message text. No commentary, no explanation, no quotation marks, no markdown.`;

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
  translators: DEFAULT_TRANSLATORS,
  lookups: DEFAULT_LOOKUPS,
  natives: DEFAULT_NATIVES,
  showFeedback: true,
  feedbackSeconds: 6,
  fixPrompt: DEFAULT_FIX_PROMPT,
  rephrasePrompt: DEFAULT_REPHRASE_PROMPT,
  translatePrompt: DEFAULT_TRANSLATE_PROMPT,
  lookupPrompt: DEFAULT_LOOKUP_PROMPT,
  nativePrompt: DEFAULT_NATIVE_PROMPT
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

/** Short button label for a language name (e.g. "Chinese (Simplified)" → "Chinese"). */
function languageLabel(language) {
  const name = String(language || '').trim();
  if (!name) return 'Lang';
  const base = name.split(/[(/]/)[0].trim();
  return base.length > 10 ? base.slice(0, 9) + '…' : base;
}

/** Clean translator rows: language + hotkey, deduped, capped. English is not a target. */
function normalizeTranslators(settings) {
  const raw = Array.isArray(settings?.translators) ? settings.translators : null;
  const seenLang = new Set();
  const seenHotkey = new Set();
  const out = [];

  for (const row of raw || DEFAULT_TRANSLATORS) {
    const language = String(row?.language || '').trim();
    const hotkey = String(row?.hotkey || '').trim();
    if (!language || !hotkey) continue;
    // Fix / Rephrase already cover English — translate is English → other languages.
    if (/^english$/i.test(language)) continue;
    const langKey = language.toLowerCase();
    if (seenLang.has(langKey) || seenHotkey.has(hotkey)) continue;
    seenLang.add(langKey);
    seenHotkey.add(hotkey);
    out.push({ language, hotkey });
    if (out.length >= MAX_TRANSLATORS) break;
  }

  return out.length ? out : DEFAULT_TRANSLATORS.map(t => ({ language: t.language, hotkey: t.hotkey }));
}

/** Selection / read translators. English is allowed. */
function normalizeLookups(settings) {
  const raw = Array.isArray(settings?.lookups) ? settings.lookups : null;
  const seenLang = new Set();
  const seenHotkey = new Set();
  const out = [];

  for (const row of raw || DEFAULT_LOOKUPS) {
    const language = String(row?.language || '').trim();
    const hotkey = String(row?.hotkey || '').trim();
    if (!language || !hotkey) continue;
    const langKey = language.toLowerCase();
    if (seenLang.has(langKey) || seenHotkey.has(hotkey)) continue;
    seenLang.add(langKey);
    seenHotkey.add(hotkey);
    out.push({ language, hotkey });
    if (out.length >= MAX_LOOKUPS) break;
  }

  return out.length ? out : DEFAULT_LOOKUPS.map(t => ({ language: t.language, hotkey: t.hotkey }));
}

/**
 * Always returns all five levels, in canonical order, whatever is in storage.
 * A hotkey that is missing or already claimed by an earlier level is dropped to
 * '' — the button still works by click, it just has no shortcut.
 */
function normalizeNatives(settings) {
  const raw = Array.isArray(settings?.natives) ? settings.natives : [];
  const saved = new Map();
  for (const row of raw) {
    const id = String(row?.id || '').trim();
    if (id && !saved.has(id)) saved.set(id, row);
  }

  const used = new Set();
  return NATIVE_LEVELS.map(level => {
    const row = saved.get(level.id);
    let hotkey = String(row?.hotkey || level.hotkey).trim();
    if (used.has(hotkey)) hotkey = used.has(level.hotkey) ? '' : level.hotkey;
    if (hotkey) used.add(hotkey);
    return { id: level.id, hotkey, on: row ? row.on !== false : true };
  });
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
      return migrateSettings(synced);
    }
  }

  return migrateSettings(local);
}

/** Fold the legacy single apiKey into apiKeys once, then drop the old field. */
async function migrateSettings(settings) {
  const keys = normalizeApiKeys(settings);
  const translators = normalizeTranslators(settings);
  const lookups = normalizeLookups(settings);
  const natives = normalizeNatives(settings);
  const translatePrompt =
    !settings.translatePrompt || settings.translatePrompt === LEGACY_TRANSLATE_PROMPT
      ? DEFAULT_TRANSLATE_PROMPT
      : settings.translatePrompt;
  const lookupPrompt = settings.lookupPrompt || DEFAULT_LOOKUP_PROMPT;
  const nativePrompt = settings.nativePrompt || DEFAULT_NATIVE_PROMPT;

  const needsWrite =
    settings.apiKey ||
    JSON.stringify(settings.apiKeys || []) !== JSON.stringify(keys) ||
    JSON.stringify(settings.translators || []) !== JSON.stringify(translators) ||
    JSON.stringify(settings.lookups || []) !== JSON.stringify(lookups) ||
    JSON.stringify(settings.natives || []) !== JSON.stringify(natives) ||
    settings.translatePrompt !== translatePrompt ||
    settings.lookupPrompt !== lookupPrompt ||
    settings.nativePrompt !== nativePrompt;

  const next = {
    ...settings,
    apiKeys: keys,
    apiKey: '',
    apiKeyIndex: Math.min(Math.max(0, Number(settings.apiKeyIndex) || 0), Math.max(0, keys.length - 1)),
    translators,
    lookups,
    natives,
    translatePrompt,
    lookupPrompt,
    nativePrompt
  };

  if (needsWrite) {
    await chrome.storage.local.set({
      apiKeys: next.apiKeys,
      apiKey: '',
      apiKeyIndex: next.apiKeyIndex,
      translators: next.translators,
      lookups: next.lookups,
      natives: next.natives,
      translatePrompt: next.translatePrompt,
      lookupPrompt: next.lookupPrompt,
      nativePrompt: next.nativePrompt
    });
  }

  return next;
}
