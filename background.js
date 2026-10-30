/* background.js — menu de contexto "Guardar seleção no notepadL" */

const DEFAULT_BASE = 'https://f6582d65f.na122.preview.abacusai.app';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'save-selection',
      title: 'Guardar seleção no notepadL',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'save-selection') return;
  const text = (info.selectionText || '').trim();
  if (!text) return;

  const stored = await chrome.storage.local.get(['token', 'baseUrl']);
  if (!stored.token) {
    notify('Sessão necessária', 'Abra a extensão notepadL e inicie sessão primeiro.');
    return;
  }

  const base = (stored.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const firstLine = text.split('\n')[0].trim();
  const title = (firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine) || 'Nova nota';
  const content = '<p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>';

  try {
    const res = await fetch(base + '/api/notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + stored.token
      },
      body: JSON.stringify({ title, content })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    notify('Nota guardada', 'A seleção foi guardada no notepadL.');
  } catch (err) {
    notify('Não foi possível guardar', String(err.message || err));
  }
});

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message
    });
  } catch (e) { /* notificações indisponíveis */ }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
