/* popup.js — lógica da extensão notepadL */

const state = {
  mode: 'online',
  token: null,
  user: null,
  scope: 'mine',
  notes: { mine: [], shared: [], team: [] },
  currentId: null,
  currentNote: null,
  dirty: false,
  saveTimer: null,
  lastSync: null,
  search: ''
};

const $ = (id) => document.getElementById(id);

/* ---------------- utilidades ---------------- */

function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }

function showView(name) {
  ['view-choice', 'view-auth', 'view-app'].forEach((v) => {
    const el = $(v);
    if (!el) return;
    if (v === name) show(el); else hide(el);
  });
}

function flash(msgEl, text, type) {
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.className = 'msg ' + (type || 'error');
  show(msgEl);
  clearTimeout(msgEl._t);
  msgEl._t = setTimeout(() => hide(msgEl), 6000);
}

function clearFlash(msgEl) { if (msgEl) hide(msgEl); }

function timeAgo(date) {
  if (!date) return '—';
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 5) return 'agora mesmo';
  if (diff < 60) return 'há ' + diff + ' segundos';
  const m = Math.floor(diff / 60);
  if (m < 60) return 'há ' + m + (m === 1 ? ' minuto' : ' minutos');
  const h = Math.floor(m / 60);
  if (h < 24) return 'há ' + h + (h === 1 ? ' hora' : ' horas');
  const d = Math.floor(h / 24);
  return 'há ' + d + (d === 1 ? ' dia' : ' dias');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

/* ---------------- arranque ---------------- */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadBaseUrl();

  const stored = await chrome.storage.local.get(['token', 'user', 'mode']);
  state.token = stored.token || null;
  state.user = stored.user || null;
  state.mode = stored.mode || 'online';

  bindEvents();
  buildTeamToggle();

  if (state.mode === 'offline') {
    await enterOffline();
    return;
  }

  if (state.token) {
    try {
      const me = await Api.me(state.token);
      state.user = me;
      await chrome.storage.local.set({ user: me });
      await enterApp();
      return;
    } catch (err) {
      if (err.status === 401) {
        await clearSession();
      } else {
        showView('view-choice');
        return;
      }
    }
  }
  showView('view-choice');
}

function bindEvents() {
  document.querySelectorAll('.choice-card').forEach((card) => {
    card.addEventListener('click', () => chooseMode(card.dataset.mode));
  });

  $('backFromAuth').addEventListener('click', (e) => { e.preventDefault(); showView('view-choice'); });
  $('backFromChoice').addEventListener('click', (e) => { e.preventDefault(); enterApp(); });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
  });

  $('formLogin').addEventListener('submit', onLogin);
  $('formRegister').addEventListener('submit', onRegister);

  $('btnLogout').addEventListener('click', onLogout);
  $('btnSettings').addEventListener('click', openSettings);
  $('btnProfile').addEventListener('click', openProfile);

  $('btnNew').addEventListener('click', onNewNote);
  $('btnSync').addEventListener('click', () => loadNotes(true));
  $('btnTrash').addEventListener('click', openTrash);

  $('search').addEventListener('input', (e) => { state.search = e.target.value.toLowerCase(); renderList(); });

  document.querySelectorAll('.mini-tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.mini-tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      state.scope = t.dataset.scope;
      renderList();
    });
  });

  $('noteTitle').addEventListener('input', () => { markDirty(); });
  $('editor').addEventListener('input', () => { markDirty(); });

  document.querySelectorAll('#toolbar button').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => applyCommand(btn.dataset.cmd, btn.dataset.arg));
  });

  $('btnDelete').addEventListener('click', onDeleteNote);
  $('btnShare').addEventListener('click', openShare);
  $('btnPrint').addEventListener('click', onPrint);
  $('btnDownload').addEventListener('click', onDownload);

  $('btnDoShare').addEventListener('click', doShare);
  $('btnCopyKey').addEventListener('click', copyKey);
  $('btnRegenKey').addEventListener('click', regenKey);
  $('btnChangePass').addEventListener('click', changePassword);
  $('btnSaveBase').addEventListener('click', saveBase);

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => hide($(btn.dataset.close)));
  });

  document.querySelectorAll('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => { if (e.target === ov) hide(ov); });
  });
}

/* ---------------- escolha de versão ---------------- */

async function chooseMode(mode) {
  state.mode = mode;
  await chrome.storage.local.set({ mode });
  if (mode === 'offline') {
    await enterOffline();
  } else {
    showView('view-auth');
    switchAuthTab('login');
  }
}

function switchAuthTab(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  hide($('formLogin')); hide($('formRegister'));
  if (tab === 'login') show($('formLogin'));
  if (tab === 'register') show($('formRegister'));

  clearFlash($('msgBox'));
}

/* ---------------- autenticação ---------------- */

async function onLogin(e) {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  try {
    const data = await Api.login(email, password);
    await startSession(data);
  } catch (err) {
    flash($('msgBox'), err.message, 'error');
  }
}

async function onRegister(e) {
  e.preventDefault();
  const email = $('regEmail').value.trim();
  const username = $('regUsername').value.trim();
  const password = $('regPassword').value;
  if (password.length < 6) {
    flash($('msgBox'), 'A senha deve ter pelo menos 6 caracteres.', 'error');
    return;
  }
  try {
    const data = await Api.signup(email, username, password);
    await startSession(data);
  } catch (err) {
    flash($('msgBox'), err.message, 'error');
  }
}

async function startSession(data) {
  state.token = data.token;
  state.user = { id: data.id, email: data.email, username: data.username, accessKey: data.accessKey };
  state.mode = 'online';
  await chrome.storage.local.set({ token: state.token, user: state.user, mode: 'online' });
  await enterApp();
}

async function clearSession() {
  state.token = null;
  state.user = null;
  await chrome.storage.local.remove(['token', 'user']);
}

async function onLogout() {
  await clearSession();
  state.notes = { mine: [], shared: [], team: [] };
  state.currentId = null;
  state.currentNote = null;
  hide($('btnLogout'));
  hide($('btnProfile'));
  $('userLabel').textContent = '';
  showView('view-choice');
}

/* ---------------- aplicação ---------------- */

async function enterApp() {
  showView('view-app');
  if (state.mode === 'online') {
    show($('btnLogout'));
    show($('btnProfile'));
    $('userLabel').textContent = state.user ? state.user.username : '';
    document.querySelectorAll('.mini-tab').forEach((t) => {
      t.classList.toggle('hidden', false);
    });
    await loadNotes();
  } else {
    hide($('btnLogout'));
    hide($('btnProfile'));
    $('userLabel').textContent = 'modo local';
    document.querySelectorAll('.mini-tab').forEach((t) => {
      if (t.dataset.scope !== 'mine') t.classList.add('hidden');
    });
    state.scope = 'mine';
    await loadOfflineNotes();
  }
  renderList();
}

async function enterOffline() {
  state.mode = 'offline';
  await enterApp();
}

/* ---------------- notas online ---------------- */

async function loadNotes(showFeedback) {
  if (state.mode !== 'online') return;
  try {
    const data = await Api.listNotes(state.token);
    state.notes.mine = data.own || [];
    state.notes.shared = data.shared || [];
    try {
      state.notes.team = await Api.team(state.token);
    } catch (e) { state.notes.team = []; }
    state.lastSync = new Date();
    renderList();
    updateSyncStatus();
    if (showFeedback) updateSyncStatus('Sincronizado agora.');
  } catch (err) {
    if (err.status === 401) {
      await clearSession();
      showView('view-choice');
      return;
    }
    updateSyncStatus('Falha ao sincronizar: ' + err.message);
  }
}

function currentList() {
  if (state.scope === 'shared') return state.notes.shared;
  if (state.scope === 'team') return state.notes.team;
  return state.notes.mine;
}

function renderList() {
  const list = $('noteList');
  list.innerHTML = '';
  const items = currentList().filter((n) => {
    if (!state.search) return true;
    const hay = (n.title + ' ' + stripHtml(n.content)).toLowerCase();
    return hay.indexOf(state.search) !== -1;
  });

  if (!items.length) {
    const li = document.createElement('li');
    li.style.cssText = 'padding:14px 8px;font-size:11px;color:#8d8d8d;text-align:center;';
    li.textContent = state.search ? 'Nenhuma nota encontrada.' : 'Sem notas nesta lista.';
    list.appendChild(li);
    return;
  }

  items.forEach((note) => {
    const li = document.createElement('li');
    li.className = 'note-item' + (note.id === state.currentId ? ' active' : '');
    const preview = stripHtml(note.content).slice(0, 60) || 'Nota vazia';
    let badge = '';
    if (state.scope === 'shared' && note.owner) badge = '<div class="ni-badge">partilhada por ' + escapeHtml(note.owner.username) + '</div>';
    if (state.scope === 'team' && note.owner) badge = '<div class="ni-badge">' + escapeHtml(note.owner.username) + '</div>';
    if (state.scope === 'mine' && note.isTeam) badge = '<div class="ni-badge">no mural</div>';
    li.innerHTML =
      '<div class="ni-title">' + escapeHtml(note.title || 'Sem título') + '</div>' +
      badge +
      '<div class="ni-meta">' + escapeHtml(preview) + '</div>' +
      '<div class="ni-meta">' + timeAgo(note.updatedAt) + '</div>';
    li.addEventListener('click', () => openNote(note));
    list.appendChild(li);
  });
}

function openNote(note) {
  if (state.dirty) saveNow();
  state.currentId = note.id;
  state.currentNote = note;
  $('noteTitle').value = note.title || '';
  $('editor').innerHTML = note.content || '';
  show($('editorWrap'));
  hide($('emptyState'));
  state.dirty = false;
  renderList();
  updateShareInfo(note);
  updateSyncStatus();
}

function updateShareInfo(note) {
  const el = $('shareInfo');
  if (!note) { el.textContent = ''; return; }
  if (state.scope === 'shared' && note.owner) {
    el.textContent = 'Partilhada por ' + note.owner.username;
    return;
  }
  const shares = note.shares || [];
  if (shares.length) {
    el.textContent = 'Partilhada com ' + shares.length + (shares.length === 1 ? ' utilizador' : ' utilizadores');
  } else if (note.isTeam) {
    el.textContent = 'Publicada no mural';
  } else {
    el.textContent = 'Privada';
  }
}

function updateSyncStatus(override) {
  const el = $('syncStatus');
  if (override) { el.textContent = override; return; }
  if (state.mode === 'offline') {
    el.textContent = 'Guardado neste navegador · ' + timeAgo(state.lastSync);
    return;
  }
  el.textContent = state.lastSync ? 'Última sincronização: ' + timeAgo(state.lastSync) : 'Por sincronizar';
}

function markDirty() {
  state.dirty = true;
  $('syncStatus').textContent = 'A guardar...';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 900);
}

async function saveNow() {
  clearTimeout(state.saveTimer);
  if (!state.currentNote || !state.dirty) return;
  const title = $('noteTitle').value.trim() || 'Sem título';
  const content = $('editor').innerHTML;

  if (state.mode === 'offline') {
    const notes = await getOfflineNotes();
    const idx = notes.findIndex((n) => n.id === state.currentId);
    if (idx !== -1) {
      notes[idx].title = title;
      notes[idx].content = content;
      notes[idx].updatedAt = new Date().toISOString();
      await chrome.storage.local.set({ offlineNotes: notes });
      state.currentNote = notes[idx];
      state.lastSync = new Date();
      state.dirty = false;
      renderList();
      updateSyncStatus();
    }
    return;
  }

  try {
    const updated = await Api.updateNote(state.token, state.currentId, { title, content });
    state.currentNote = Object.assign({}, state.currentNote, updated);
    const idx = state.notes.mine.findIndex((n) => n.id === state.currentId);
    if (idx !== -1) state.notes.mine[idx] = Object.assign({}, state.notes.mine[idx], updated);
    state.lastSync = new Date();
    state.dirty = false;
    renderList();
    updateSyncStatus();
  } catch (err) {
    $('syncStatus').textContent = 'Não foi possível guardar: ' + err.message;
  }
}

async function onNewNote() {
  if (state.dirty) await saveNow();
  if (state.mode === 'offline') {
    const notes = await getOfflineNotes();
    const note = { id: 'local_' + Date.now(), title: 'Nova nota', content: '', updatedAt: new Date().toISOString() };
    notes.unshift(note);
    await chrome.storage.local.set({ offlineNotes: notes });
    state.notes.mine = notes;
    state.scope = 'mine';
    renderList();
    openNote(note);
    $('noteTitle').select();
    return;
  }
  try {
    const note = await Api.createNote(state.token, { title: 'Nova nota', content: '' });
    state.notes.mine.unshift(note);
    state.scope = 'mine';
    document.querySelectorAll('.mini-tab').forEach((t) => t.classList.toggle('active', t.dataset.scope === 'mine'));
    renderList();
    openNote(note);
    $('noteTitle').select();
  } catch (err) {
    updateSyncStatus('Erro ao criar nota: ' + err.message);
  }
}

async function onDeleteNote() {
  if (!state.currentNote) return;
  if (!confirm('Mover a nota «' + (state.currentNote.title || 'Sem título') + '» para a reciclagem?')) return;

  if (state.mode === 'offline') {
    let notes = await getOfflineNotes();
    notes = notes.filter((n) => n.id !== state.currentId);
    await chrome.storage.local.set({ offlineNotes: notes });
    state.notes.mine = notes;
    closeEditor();
    renderList();
    return;
  }

  try {
    await Api.deleteNote(state.token, state.currentId);
    state.notes.mine = state.notes.mine.filter((n) => n.id !== state.currentId);
    closeEditor();
    renderList();
    updateSyncStatus('Nota movida para a reciclagem.');
  } catch (err) {
    updateSyncStatus('Erro ao apagar: ' + err.message);
  }
}

function closeEditor() {
  state.currentId = null;
  state.currentNote = null;
  state.dirty = false;
  hide($('editorWrap'));
  show($('emptyState'));
}

/* ---------------- modo local ---------------- */

async function getOfflineNotes() {
  const data = await chrome.storage.local.get('offlineNotes');
  return data.offlineNotes || [];
}

async function loadOfflineNotes() {
  state.notes.mine = await getOfflineNotes();
  state.lastSync = new Date();
  updateSyncStatus();
}

/* ---------------- formatação ---------------- */

function applyCommand(cmd, arg) {
  $('editor').focus();
  if (cmd === 'createLink') {
    const url = prompt('Endereço da ligação (https://...):', 'https://');
    if (!url) return;
    document.execCommand('createLink', false, url);
  } else if (cmd === 'formatBlock') {
    document.execCommand('formatBlock', false, arg);
  } else {
    document.execCommand(cmd, false, null);
  }
  markDirty();
}

/* ---------------- partilha ---------------- */

function buildTeamToggle() {
  const body = document.querySelector('#modalShare .modal-body');
  if (!body || document.getElementById('teamToggleWrap')) return;
  const wrap = document.createElement('label');
  wrap.id = 'teamToggleWrap';
  wrap.style.cssText = 'display:flex;align-items:center;gap:7px;font-size:11.5px;color:#5d5d5d;cursor:pointer;';
  wrap.innerHTML = '<input type="checkbox" id="teamToggle" style="width:auto;margin:0;"> Publicar esta nota no mural da equipa';
  const hint = body.querySelector('.hint');
  body.insertBefore(wrap, hint);
  wrap.querySelector('input').addEventListener('change', onToggleTeam);
}

async function onToggleTeam(e) {
  const isTeam = e.target.checked;
  if (state.mode === 'offline' || !state.currentNote) return;
  try {
    const updated = await Api.updateNote(state.token, state.currentId, { isTeam });
    state.currentNote = Object.assign({}, state.currentNote, updated);
    const idx = state.notes.mine.findIndex((n) => n.id === state.currentId);
    if (idx !== -1) state.notes.mine[idx] = Object.assign({}, state.notes.mine[idx], updated);
    await loadNotes();
    updateShareInfo(state.currentNote);
  } catch (err) {
    flash($('shareMsg'), err.message, 'error');
    e.target.checked = !isTeam;
  }
}

async function openShare() {
  if (!state.currentNote) return;
  if (state.mode === 'offline') {
    alert('As notas locais não podem ser partilhadas. Escolha a versão «Com autorização» para partilhar notas.');
    return;
  }
  show($('modalShare'));
  clearFlash($('shareMsg'));
  $('shareTarget').value = '';
  $('teamToggle').checked = !!state.currentNote.isTeam;

  const isOwner = state.currentNote.ownerId === (state.user && state.user.id);
  $('btnDoShare').disabled = !isOwner;
  $('btnDoShare').textContent = isOwner ? 'Partilhar' : 'Só o dono pode partilhar';

  await renderShareList();
  await fillUsersDatalist();
}

async function fillUsersDatalist() {
  try {
    const users = await Api.users(state.token);
    const dl = $('usersList');
    dl.innerHTML = '';
    users.forEach((u) => {
      if (state.user && u.id === state.user.id) return;
      const opt = document.createElement('option');
      opt.value = u.email;
      opt.label = u.username;
      dl.appendChild(opt);
    });
  } catch (e) { /* silencioso */ }
}

async function renderShareList() {
  const box = $('shareList');
  box.innerHTML = '';
  let note = state.currentNote;
  try {
    note = await Api.getNote(state.token, state.currentId);
  } catch (e) { /* usa o que temos */ }
  const shares = note.shares || [];
  if (!shares.length) {
    const d = document.createElement('div');
    d.className = 'hint';
    d.textContent = 'Ainda não partilhou esta nota com ninguém.';
    box.appendChild(d);
    return;
  }
  shares.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'share-row';
    const name = s.user ? (s.user.username + ' · ' + s.user.email) : s.userId;
    row.innerHTML = '<span class="sr-name">' + escapeHtml(name) + '</span>' +
      '<span class="sr-perm">' + (s.permission === 'EDIT' ? 'edita' : 'lê') + '</span>';
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = 'Revogar';
    btn.addEventListener('click', () => revokeShare(s.userId));
    row.appendChild(btn);
    box.appendChild(row);
  });
}

async function doShare() {
  const target = $('shareTarget').value.trim();
  const perm = $('sharePerm').value;
  if (!target) { flash($('shareMsg'), 'Indique o email ou nome de utilizador.', 'error'); return; }
  try {
    await Api.share(state.token, state.currentId, target, perm);
    flash($('shareMsg'), 'Nota partilhada com ' + target + '.', 'ok');
    $('shareTarget').value = '';
    await renderShareList();
    await loadNotes();
  } catch (err) {
    flash($('shareMsg'), err.message, 'error');
  }
}

async function revokeShare(userId) {
  try {
    await Api.unshare(state.token, state.currentId, userId);
    await renderShareList();
    await loadNotes();
  } catch (err) {
    flash($('shareMsg'), err.message, 'error');
  }
}

/* ---------------- reciclagem ---------------- */

async function openTrash() {
  show($('modalTrash'));
  const box = $('trashList');
  box.innerHTML = '';

  if (state.mode === 'offline') {
    box.innerHTML = '<div class="hint">No modo local as notas apagadas não são guardadas.</div>';
    return;
  }

  try {
    const notes = await Api.trash(state.token);
    if (!notes.length) {
      box.innerHTML = '<div class="hint">Sem notas na reciclagem.</div>';
      return;
    }
    notes.forEach((n) => {
      const row = document.createElement('div');
      row.className = 'trash-item';
      row.innerHTML = '<span class="ti-title">' + escapeHtml(n.title || 'Sem título') + '</span>';
      const b1 = document.createElement('button');
      b1.className = 'btn small';
      b1.textContent = 'Restaurar';
      b1.addEventListener('click', async () => {
        try { await Api.restore(state.token, n.id); await loadNotes(); openTrash(); }
        catch (e) { alert(e.message); }
      });
      const b2 = document.createElement('button');
      b2.className = 'btn small';
      b2.textContent = 'Eliminar';
      b2.addEventListener('click', async () => {
        if (!confirm('Eliminar definitivamente «' + (n.title || 'Sem título') + '»?')) return;
        try { await Api.permanentDelete(state.token, n.id); openTrash(); }
        catch (e) { alert(e.message); }
      });
      row.appendChild(b1);
      row.appendChild(b2);
      box.appendChild(row);
    });
  } catch (err) {
    box.innerHTML = '<div class="hint">' + escapeHtml(err.message) + '</div>';
  }
}

/* ---------------- imprimir / descarregar ---------------- */

function noteAsHtml() {
  const title = $('noteTitle').value || 'Sem título';
  return '<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><title>' + escapeHtml(title) +
    '</title><style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;color:#2c2c2c;line-height:1.6}' +
    'h1{font-size:22px;font-weight:normal;border-bottom:1px solid #d6d2ca;padding-bottom:8px}' +
    'blockquote{border-left:3px solid #2fb3a3;margin:8px 0;padding:2px 10px;color:#5d5d5d}' +
    'pre{background:#f2f0ec;padding:8px;font-family:Consolas,monospace}</style></head><body><h1>' +
    escapeHtml(title) + '</h1>' + $('editor').innerHTML + '</body></html>';
}

function onPrint() {
  const blob = new Blob([noteAsHtml()], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url });
}

function onDownload() {
  const title = ($('noteTitle').value || 'nota').replace(/[^\wÀ-ÿ\- ]+/g, '').trim().slice(0, 60) || 'nota';
  const blob = new Blob([noteAsHtml()], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title + '.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------------- perfil ---------------- */

async function openProfile() {
  show($('modalProfile'));
  clearFlash($('profileMsg'));
  $('newPassword').value = '';
  try {
    const me = await Api.me(state.token);
    state.user = me;
    $('profileInfo').innerHTML =
      '<b>' + escapeHtml(me.username) + '</b><br>' + escapeHtml(me.email);
    $('profileKey').textContent = me.accessKey || '—';
  } catch (err) {
    $('profileInfo').textContent = err.message;
  }
}

async function copyKey() {
  const key = $('profileKey').textContent;
  try {
    await navigator.clipboard.writeText(key);
    flash($('profileMsg'), 'Chave copiada.', 'ok');
  } catch (e) {
    flash($('profileMsg'), 'Não foi possível copiar. Selecione e copie manualmente.', 'error');
  }
}

async function regenKey() {
  if (!confirm('Gerar uma nova chave? A chave atual deixa de funcionar.')) return;
  try {
    const data = await Api.regenerateKey(state.token);
    $('profileKey').textContent = data.accessKey || data.key || '—';
    flash($('profileMsg'), 'Nova chave gerada.', 'ok');
  } catch (err) {
    flash($('profileMsg'), err.message, 'error');
  }
}

async function changePassword() {
  const pass = $('newPassword').value;
  if (pass.length < 6) { flash($('profileMsg'), 'A senha deve ter pelo menos 6 caracteres.', 'error'); return; }
  try {
    await Api.changePassword(state.token, pass);
    $('newPassword').value = '';
    flash($('profileMsg'), 'Senha alterada.', 'ok');
  } catch (err) {
    flash($('profileMsg'), err.message, 'error');
  }
}

/* ---------------- definições ---------------- */

async function openSettings() {
  await loadBaseUrl();
  $('baseUrlInput').value = BASE_URL;
  clearFlash($('settingsMsg'));
  show($('modalSettings'));
}

async function saveBase() {
  const url = $('baseUrlInput').value.trim();
  if (!/^https?:\/\//.test(url)) {
    flash($('settingsMsg'), 'O endereço deve começar por https://', 'error');
    return;
  }
  await setBaseUrl(url);
  flash($('settingsMsg'), 'Endereço guardado.', 'ok');
}