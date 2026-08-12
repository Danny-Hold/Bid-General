'use strict';

const showBar = document.getElementById('showBar');
const options = document.getElementById('options');

async function load() {
  const data = await chrome.storage.local.get({ showBar: true });
  showBar.checked = data.showBar !== false;
}

showBar.addEventListener('change', async () => {
  await chrome.storage.local.set({ showBar: showBar.checked });
  // Keep the right-click action menu checkbox in sync when present.
  try {
    await chrome.runtime.sendMessage({ type: 'showBarChanged', showBar: showBar.checked });
  } catch (_) {}
});

options.addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();
