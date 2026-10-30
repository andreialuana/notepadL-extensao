/* api.js — comunicação com a aplicação notepadL */

const DEFAULT_BASE = 'https://f6582d65f.na122.preview.abacusai.app';

let BASE_URL = DEFAULT_BASE;

async function loadBaseUrl() {
  const data = await chrome.storage.local.get('baseUrl');
  BASE_URL = (data.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  return BASE_URL;
}

function setBaseUrl(url) {
  BASE_URL = (url || DEFAULT_BASE).replace(/\/+$/, '');
  return chrome.storage.local.set({ baseUrl: BASE_URL });
}

async function apiFetch(path, options = {}) {
  const { method = 'GET', body, token, timeout = 15000 } = options;
  if (!BASE_URL) await loadBaseUrl();

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new Error('O servidor não respondeu a tempo. Verifique a ligação à internet.');
    }
    throw new Error('Não foi possível contactar o servidor. Verifique a ligação e o endereço nas definições.');
  }
  clearTimeout(timer);

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = { error: text }; }
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || ('Erro ' + res.status);
    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }
  return data;
}

const Api = {
  signup: (email, username, password) =>
    apiFetch('/api/signup', { method: 'POST', body: { email, username, password } }),

  login: (email, password) =>
    apiFetch('/api/auth/login', { method: 'POST', body: { email, password } }),

  loginWithKey: (accessKey) =>
    apiFetch('/api/auth/login', { method: 'POST', body: { accessKey } }),

  me: (token) => apiFetch('/api/me', { token }),

  listNotes: (token) => apiFetch('/api/notes', { token }),
  createNote: (token, note) => apiFetch('/api/notes', { method: 'POST', token, body: note }),
  getNote: (token, id) => apiFetch('/api/notes/' + id, { token }),
  updateNote: (token, id, patch) => apiFetch('/api/notes/' + id, { method: 'PATCH', token, body: patch }),
  deleteNote: (token, id) => apiFetch('/api/notes/' + id, { method: 'DELETE', token }),

  trash: (token) => apiFetch('/api/notes/trash', { token }),
  restore: (token, id) => apiFetch('/api/notes/' + id + '/restore', { method: 'POST', token }),
  permanentDelete: (token, id) => apiFetch('/api/notes/' + id + '/permanent-delete', { method: 'POST', token }),

  share: (token, id, emailOrUsername, permission) =>
    apiFetch('/api/notes/' + id + '/share', { method: 'POST', token, body: { emailOrUsername, permission } }),
  unshare: (token, id, userId) =>
    apiFetch('/api/notes/' + id + '/share', { method: 'DELETE', token, body: { userId } }),

  team: (token) => apiFetch('/api/team', { token }),
  users: (token) => apiFetch('/api/users', { token }),

  changePassword: (token, password) =>
    apiFetch('/api/me/password', { method: 'POST', token, body: { password } }),
  regenerateKey: (token) =>
    apiFetch('/api/me/regenerate-key', { method: 'POST', token })
};
