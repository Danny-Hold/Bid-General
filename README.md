# BidPolish

A Chrome extension that adds **Fix**, **Rephrase**, **Native tone**, **Translate** and **Lookup** to chats on Freelancer.com, WhatsApp Web, Telegram Web, Slack, ChatGPT, Claude and Gemini. Compose actions replace text in place; Lookup only shows a translation popup for selected messages.

## Setup

Each person does this once, on their own machine.

1. Create one or more Gemini API keys at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Turn billing on: on the free tier Google may use your text for training. At Flash rates the real cost is a few dollars a month. Keys from different Google accounts each get their own quota — add 2–3 if you want the extension to keep working when one hits its limit.
2. Go to `chrome://extensions`, switch on **Developer mode**, click **Load unpacked**, select this folder.
3. Click **Details → Extension options**, paste the key(s), click **Send a test**. A corrected sentence should come back. If a key is rate-limited or invalid, the extension automatically tries the next one and remembers which key last worked.
4. Open a chat on Freelancer, WhatsApp, Telegram, Slack, [ChatGPT](https://chatgpt.com), [Claude](https://claude.ai) or [Gemini](https://gemini.google.com) and click into the message box. A small pill appears above the field.

| Action | Button | Default hotkey |
|---|---|---|
| Grammar and spelling only | Fix | `Ctrl+Alt+A` |
| Rewrite in natural US English | Rephrase | `Ctrl+Alt+S` |
| Native phrasing → best friend | Friend | `Ctrl+Alt+1` |
| Native phrasing → same-level teammate | Peer | `Ctrl+Alt+2` |
| Native phrasing → someone you don't know well | Polite | `Ctrl+Alt+3` |
| Native phrasing → client | Client | `Ctrl+Alt+4` |
| Native phrasing → boss | Boss | `Ctrl+Alt+5` |
| Translate English → Spanish (casual) | Spanish | `Ctrl+Alt+D` |
| Translate English → French (casual) | French | `Ctrl+Alt+F` |
| Lookup selected message → English | (popup only) | `Ctrl+O` |
| Restore the original | Undo | `Ctrl+Alt+Q` |

Hotkeys are editable in options: click a box and press the combination you want. They are stored as physical key positions, so they keep working on non-US keyboard layouts.

In **Translate**, add up to six **non-English** target languages for rewriting what you are about to send. The source is English; Fix and Rephrase already cover English writing. Each language gets its own button and hotkey. Output is casual chat phrasing, not formal translation.

In **Lookup**, add target languages for reading someone else's selected message. Default is English via `Ctrl+O`. Lookup never writes into the chat box — it only shows a popup with the translation.

Chrome reserves some combinations for itself, and a page cannot intercept a browser-level shortcut. If a hotkey does nothing in a chat box, the browser is taking it — pick another combination rather than assuming the extension is broken. The `Ctrl+Alt` range is largely free, which is why the defaults live there.

Select part of the message to rewrite just that part. Otherwise it rewrites the whole box.

## The instructions

Fix, Rephrase, Translate and Native tone are editable in the options page, and **Reset instructions** puts the defaults back.

**Fix** is deliberately strict: correct mechanical errors, change nothing else. Names, technical terms, URLs, numbers and prices pass through untouched, and a message with no errors comes back unchanged. This is the one to use on nearly every message, because it leaves the writer's own voice intact — which is what stops several people's messages converging into the same recognizable AI register.

**Rephrase** rewrites into natural US business English while staying a chat message rather than becoming a formal email. Three clauses in it are load-bearing:

- *Never add facts, prices, dates, timelines, deliverables or commitments.* A model that helpfully appends "we can start Monday" to a bid is a liability.
- *Keep the original's level of certainty.* Without this, "I think I can do this" becomes "I can do this", which is a promise nobody made.
- *No enthusiasm words, exclamation marks, emoji or em dashes.* These are the tells clients read as AI-written.

**Translate** converts an English chat message into the chosen language as a **casual** chat message — everyday wording, not formal or textbook style. The prompt template uses `{{language}}`, which is replaced with the language name for that button/hotkey. English is not offered as a translate target; use Fix or Rephrase for English.

**Lookup** translates a message you selected on the page (typically someone else's) into a configured language and shows the result in a popup. It does not touch the chat input. English is the default target.

**Native tone** is English in, English out — see below.

If you edit the prompts, keep those guardrails.

## Native tone

Fix and Rephrase both aim at *correct*. Native tone aims at *native*: it compresses the message into the set phrases and idioms a fluent speaker would actually reach for, so the writing reads like someone who grew up with the language rather than someone translating into it. It cuts filler, drops words the reader can infer, and prefers the common expression over the longhand explanation.

Register is the other half of the job, because the same idea is not written the same way to a friend and to a client. There are five levels, each with its own button and hotkey:

| Level | Button | Hotkey | Reads like |
|---|---|---|---|
| Best friend | Friend | `Ctrl+Alt+1` | Relaxed and blunt. Slang and fragments fine, politeness formulas dropped. |
| Same-level teammate | Peer | `Ctrl+Alt+2` | Casual and efficient. No ceremony, no heavy slang. |
| Someone you don't know well | Polite | `Ctrl+Alt+3` | Natural but courteous. Asks rather than instructs, keeps please and thank you. |
| Client | Client | `Ctrl+Alt+4` | Professional and respectful throughout. No slang at all. |
| Boss | Boss | `Ctrl+Alt+5` | Brief and deferential. Point first, no excuses, never instructs upward. |

Levels 3 to 5 are all written to read as respectful; 4 and 5 most of all, since those are the messages that cost you something if the tone lands wrong. Levels 1 and 2 trade politeness for speed, which is the correct move with people who already know you.

The extension's usual guardrails still apply at every level: it never adds facts, prices, dates, timelines or commitments, never upgrades "I think I can" into "I can", and never switches you out of English.

Untick a level in options to drop its button from the chat bar — someone with no boss does not need five. All five share one prompt template, where `{{audience}}` becomes who you are writing to and `{{guidance}}` becomes that level's tone rules, so edit the shared parts once and both placeholders stay in.

## Seeing what changed

After a rewrite, a panel appears above the message box showing the original and the new version. It fades on its own, and typing or clicking it dismisses it early. Both the panel and how long it stays are configurable in options — turn it off once people trust the output and it stops earning its space.

## Fast mode

On by default. It runs Fix and Translate with minimal reasoning, and Rephrase and Native tone with low reasoning, rather than letting the model deliberate — which is where most of the wait on a short message comes from. Native tone gets the larger budget because picking the right idiom for the right reader is a judgement call, not a lookup. Turn it off in options if corrections start missing things — the toggle is per person, so someone writing longer or more technical messages can run without it.

## Where settings are stored

`chrome.storage.local`, which is tied to the browser profile on that machine. Nothing syncs to a Google account, so the API keys do not follow anyone onto a personal device. If you ran an earlier build, settings are moved out of sync storage automatically the first time the options page or a rewrite runs. A single legacy `apiKey` is folded into the `apiKeys` list on load.

## Multiple API keys

You can store up to five keys (2–3 is enough for most teams). On any rewrite or model listing, the extension starts with the last key that worked. If Gemini returns a quota, rate-limit, or invalid-key error, it tries the next key in the list without you changing anything. Non-quota failures (bad model name, empty response, etc.) are not retried on another key — those need a settings fix.

## Adjusting scope

WhatsApp Web, Telegram Web, Slack, ChatGPT (`chatgpt.com` / `chat.openai.com`), Claude (`claude.ai`) and Gemini (`gemini.google.com`) are already included. Those sites use `contenteditable` composers rather than `<textarea>`, which the content script handles.

**Other Freelancer domains** (`.in`, `.co.uk`, `.com.au`) or other platforms: add them to `content_scripts.matches` in `manifest.json`.

**A different model:** Google retires model IDs on a rolling schedule, so the Model field has a **Load what this key can use** link next to it. It queries your own key, fills the box with a picker of everything available, and if your current model has been retired it switches you to a working Flash model automatically. Use it whenever a request starts failing with a model error — no code change needed.

Host permissions are locked to `generativelanguage.googleapis.com` alone. The extension physically cannot send text anywhere else — worth knowing if a client ever asks.

## Before rolling it out

Run twenty real messages from your team through Fix and let the people who will actually use it judge whether it still sounds like them. If the output feels foreign they will quietly stop using it, and you will not find out for months.
