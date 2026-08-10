# BidPolish

A Chrome extension that adds **Fix** and **Rephrase** to any `<textarea>` on Freelancer.com. Text is replaced in place — nobody leaves the chat box, and Ctrl+Z still works.

## Setup

Each person does this once, on their own machine.

1. Create one or more Gemini API keys at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Turn billing on: on the free tier Google may use your text for training. At Flash rates the real cost is a few dollars a month. Keys from different Google accounts each get their own quota — add 2–3 if you want the extension to keep working when one hits its limit.
2. Go to `chrome://extensions`, switch on **Developer mode**, click **Load unpacked**, select this folder.
3. Click **Details → Extension options**, paste the key(s), click **Send a test**. A corrected sentence should come back. If a key is rate-limited or invalid, the extension automatically tries the next one and remembers which key last worked.
4. Open a Freelancer chat and click into the message box. A small pill appears in the bottom-right corner of the field.

| Action | Button | Default hotkey |
|---|---|---|
| Grammar and spelling only | Fix | `Ctrl+Alt+A` |
| Rewrite in natural US English | Rephrase | `Ctrl+Alt+S` |
| Restore the original | Undo | `Ctrl+Alt+Q` |

Hotkeys are editable in options: click a box and press the combination you want. They are stored as physical key positions, so they keep working on non-US keyboard layouts.

Chrome reserves some combinations for itself, and a page cannot intercept a browser-level shortcut. If a hotkey does nothing in a chat box, the browser is taking it — pick another combination rather than assuming the extension is broken. The `Ctrl+Alt` range is largely free, which is why the defaults live there.

Select part of the message to rewrite just that part. Otherwise it rewrites the whole box.

## The two instructions

Both are editable in the options page, and **Reset instructions** puts the defaults back.

**Fix** is deliberately strict: correct mechanical errors, change nothing else. Names, technical terms, URLs, numbers and prices pass through untouched, and a message with no errors comes back unchanged. This is the one to use on nearly every message, because it leaves the writer's own voice intact — which is what stops several people's messages converging into the same recognizable AI register.

**Rephrase** rewrites into natural US business English while staying a chat message rather than becoming a formal email. Three clauses in it are load-bearing:

- *Never add facts, prices, dates, timelines, deliverables or commitments.* A model that helpfully appends "we can start Monday" to a bid is a liability.
- *Keep the original's level of certainty.* Without this, "I think I can do this" becomes "I can do this", which is a promise nobody made.
- *No enthusiasm words, exclamation marks, emoji or em dashes.* These are the tells clients read as AI-written.

If you edit the prompts, keep those three.

## Seeing what changed

After a rewrite, a panel appears above the message box showing the original and the new version. It fades on its own, and typing or clicking it dismisses it early. Both the panel and how long it stays are configurable in options — turn it off once people trust the output and it stops earning its space.

## Fast mode

On by default. It runs Fix with minimal reasoning and Rephrase with low reasoning rather than letting the model deliberate, which is where most of the wait on a short message comes from. Turn it off in options if corrections start missing things — the toggle is per person, so someone writing longer or more technical messages can run without it.

## Where settings are stored

`chrome.storage.local`, which is tied to the browser profile on that machine. Nothing syncs to a Google account, so the API keys do not follow anyone onto a personal device. If you ran an earlier build, settings are moved out of sync storage automatically the first time the options page or a rewrite runs. A single legacy `apiKey` is folded into the `apiKeys` list on load.

## Multiple API keys

You can store up to five keys (2–3 is enough for most teams). On Fix, Rephrase, or model listing, the extension starts with the last key that worked. If Gemini returns a quota, rate-limit, or invalid-key error, it tries the next key in the list without you changing anything. Non-quota failures (bad model name, empty response, etc.) are not retried on another key — those need a settings fix.

## Adjusting scope

**Other Freelancer domains** (`.in`, `.co.uk`, `.com.au`) or other platforms: add them to `content_scripts.matches` in `manifest.json`.

**A different model:** Google retires model IDs on a rolling schedule, so the Model field has a **Load what this key can use** link next to it. It queries your own key, fills the box with a picker of everything available, and if your current model has been retired it switches you to a working Flash model automatically. Use it whenever a request starts failing with a model error — no code change needed.

Host permissions are locked to `generativelanguage.googleapis.com` alone. The extension physically cannot send text anywhere else — worth knowing if a client ever asks.

## Before rolling it out

Run twenty real messages from your team through Fix and let the people who will actually use it judge whether it still sounds like them. If the output feels foreign they will quietly stop using it, and you will not find out for months.
