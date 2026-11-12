// DonutFlash - in-game money only. Plain ES module, no build step.
// Wired to existing backend endpoints only. Other games show "coming soon".

const API = (window.DONUTDROP_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const CURRENCY_SYMBOL = '';        // in-game money, no currency symbol
const POLL_MS = 3000;

// Game cards from the videos. `route` is set only when the backend supports that game yet.
const GAMES = [
  { key: 'case-battles', name: 'Case Battles', icon: '⚔️', live: false },
  { key: 'limbo', name: 'Limbo', icon: '🎯', live: false },
  { key: 'upgrader', name: 'Upgrader', icon: '⬆️', live: true },
  { key: 'mines', name: 'Mines', icon: '💣', live: false },
  { key: 'crash', name: 'Crash', icon: '📈', live: false },
  { key: 'plinko', name: 'Plinko', icon: '🔻', live: false },
  { key: 'blackjack', name: 'Blackjack', icon: '🃏', live: false },
  { key: 'dice', name: 'Dice', icon: '🎲', live: false },
  { key: 'roulette', name: 'Roulette', icon: '🎡', live: false },
  { key: 'tower', name: 'Tower', icon: '🗼', live: false },
  { key: 'chicken', name: 'Chicken', icon: '🐔', live: false },
  { key: 'coinflip', name: 'Coinflip', icon: '🪙', live: false },
  { key: 'slots', name: 'Slots', icon: '🎰', live: false },
  { key: 'fishing', name: 'Fishing', icon: '🎣', live: false },
  { key: 'derby', name: 'Derby', icon: '🏇', live: false },
];

const state = {
  user: null,
  balanceMinor: 0n,
  csrf: '',
  cases: [],
};

// ---------- helpers ----------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function safeUrl(url) {
  return url && /^(https?:\/\/|\/|assets\/)/i.test(url) ? url : '';
}

function fmt(minor) {
  const n = Number(minor || 0);
  return CURRENCY_SYMBOL + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Stored values are integer minor units.
function fmtMinor(minor) {
  return fmt(Number(minor || 0) / 100);
}

function cookie(name) {
  const prefix = name + '=';
  const found = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : '';
}

function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function api(method, path, body, extraHeaders = {}) {
  const headers = { Accept: 'application/json', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method)) {
    const token = state.csrf || cookie('__Host-du_csrf') || cookie('du_csrf');
    if (token) headers['X-CSRF-Token'] = token;
  }
  let res;
  try {
    res = await fetch(API + path, {
      method, headers, credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Cannot reach the DonutFlash server.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status}).`);
  return data;
}

let toastTimer;
function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- navigation ----------

function showTab(name) {
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  $$('.bottomnav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'chat') loadChat();
  window.scrollTo({ top: 0 });
}

// ---------- account ----------

function renderAccount() {
  const loggedIn = Boolean(state.user);
  $('#login-btn').hidden = loggedIn;
  $('#wallet').hidden = !loggedIn;
  $('#balance-text').textContent = fmtMinor(state.balanceMinor);
  $('#welcome-title').textContent = loggedIn
    ? `Welcome back, ${state.user.name}`
    : 'Welcome to DonutFlash';
}

async function refreshBalance() {
  const data = await api('GET', '/v1/balance');
  state.balanceMinor = BigInt(data.balanceMinor || '0');
  renderAccount();
}

async function logout() {
  try { await api('POST', '/v1/auth/logout'); } catch { /* clear locally anyway */ }
  state.user = null;
  state.csrf = '';
  state.balanceMinor = 0n;
  renderAccount();
  toast('Logged out.');
}

// ---------- games & cases ----------

function renderGames() {
  $('#games-grid').innerHTML = GAMES.map((g) => `
    <button class="card ${g.live ? '' : 'locked'}" type="button" data-game="${esc(g.key)}">
      <div class="art">${esc(g.icon)}</div>
      <div class="name">${esc(g.name)}</div>
      ${g.live ? '<span class="price">Play</span>' : '<span class="soon">Coming soon</span>'}
    </button>`).join('');
}

async function loadCases() {
  const grid = $('#cases-grid');
  try {
    const data = await api('GET', '/v1/cases?limit=50');
    state.cases = data.cases || [];
  } catch (err) {
    grid.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    return;
  }
  if (!state.cases.length) {
    grid.innerHTML = '<p class="muted">No cases are live yet.</p>';
    return;
  }
  grid.innerHTML = state.cases.map((c) => `
    <button class="card" type="button" data-case="${esc(c.id)}">
      <div class="art">${safeUrl(c.imageUrl) ? `<img src="${esc(safeUrl(c.imageUrl))}" alt="" loading="lazy" />` : '📦'}</div>
      <div class="name">${esc(c.name)}</div>
      <span class="price">${esc(fmtMinor(c.priceMinor))}</span>
    </button>`).join('');
}

function openCaseModal(id) {
  const c = state.cases.find((x) => x.id === id);
  if (!c) return;
  const total = Number(c.totalWeight || 0);
  const drops = (c.drops || []).map((d) => {
    const chance = total ? ((Number(d.weight || 0) / total) * 100).toFixed(2) : '–';
    return `<li>
      ${safeUrl(d.imageUrl) ? `<img src="${esc(safeUrl(d.imageUrl))}" alt="" width="28" height="28" />` : '•'}
      <span>${esc(d.displayName || d.minecraftName || 'Item')}</span>
      <span class="chance">${esc(chance)}%</span>
    </li>`;
  }).join('');

  $('#case-detail').innerHTML = `
    <h2>${esc(c.name)}</h2>
    <p><span class="price">${esc(fmtMinor(c.priceMinor))}</span></p>
    ${c.description ? `<p class="muted">${esc(c.description)}</p>` : ''}
    <h3>Possible drops</h3>
    <ul class="drop-list">${drops || '<li class="muted">No drops configured.</li>'}</ul>
    <button class="btn btn-primary btn-block" id="open-btn" type="button">
      ${state.user ? `Open for ${esc(fmtMinor(c.priceMinor))}` : 'Log in to open'}
    </button>
    <p class="error small" id="open-error" hidden></p>
    <p class="muted small">In-game money only. No real money is accepted or paid out.</p>`;

  $('#open-btn').addEventListener('click', () => (state.user ? openCase(c) : (closeModals(), openLogin())));
  $('#case-modal').hidden = false;
}

async function openCase(c) {
  const btn = $('#open-btn');
  const err = $('#open-error');
  err.hidden = true;
  if (state.balanceMinor < BigInt(c.priceMinor)) {
    err.textContent = 'Not enough balance. Deposit in-game first.';
    err.hidden = false;
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Opening…';
  try {
    const fair = await api('GET', '/v1/fairness/current');
    const result = await api('POST', `/v1/cases/${encodeURIComponent(c.id)}/open`, {
      clientSeed: randomHex(16),
      serverSeedHash: fair.serverSeedHash,
      expectedPriceMinor: String(c.priceMinor),
    }, { 'Idempotency-Key': crypto.randomUUID() });
    state.balanceMinor = BigInt(result.round?.balanceAfterMinor ?? state.balanceMinor);
    renderAccount();
    closeModals();
    toast(`You won ${result.item?.displayName || result.item?.minecraftName || 'an item'}!`, 'ok');
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = `Open for ${fmtMinor(c.priceMinor)}`;
  }
}

// ---------- leaderboard & chat ----------

async function loadLeaderboard() {
  const box = $('#leaderboard-list');
  try {
    const data = await api('GET', '/v1/leaderboard');
    const entries = data.entries || [];
    box.innerHTML = entries.length
      ? entries.map((e) => `
          <div class="lb-row">
            <span>#${esc(e.rank)} ${esc(e.username)}${e.isViewer ? ' (you)' : ''}</span>
            <span class="muted">${esc(e.value)}</span>
          </div>`).join('')
      : '<p class="muted">No entries yet.</p>';
  } catch (err) {
    box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

async function loadChat() {
  const box = $('#chat-list');
  try {
    const data = await api('GET', '/v1/chat?limit=50');
    const messages = data.messages || [];
    box.innerHTML = messages.length
      ? messages.map((m) => `<div><b>${esc(m.author)}</b> <span>${esc(m.body)}</span></div>`).join('')
      : '<p class="muted">No messages yet.</p>';
    box.scrollTop = box.scrollHeight;
  } catch (err) {
    box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

// ---------- login (in-game command flow) ----------

let pollTimer;

function openLogin() {
  $('#login-form').hidden = false;
  $('#login-step').hidden = true;
  $('#login-error').hidden = true;
  $('#login-submit').disabled = false;
  $('#login-form').reset();
  $('#login-modal').hidden = false;
  $('#mc-name').focus();
}

function closeModals() {
  clearTimeout(pollTimer);
  $$('.modal').forEach((m) => { m.hidden = true; });
}

function loginError(message) {
  const el = $('#login-error');
  el.textContent = message;
  el.hidden = false;
  $('#login-submit').disabled = false;
}

async function startLogin(e) {
  e.preventDefault();
  const name = $('#mc-name').value.trim();
  $('#login-error').hidden = true;
  $('#login-submit').disabled = true;
  try {
    const start = await api('POST', '/v1/auth/pay/start', { minecraftUsername: name });
    $('#login-form').hidden = true;
    $('#login-step').hidden = false;
    $('#login-instruction').textContent = start.instruction;
    pollLogin(start.challengeId, name);
  } catch (err) {
    loginError(err.message);
  }
}

async function pollLogin(challengeId, name) {
  try {
    const status = await api('GET', '/v1/auth/pay/status?challengeId=' + encodeURIComponent(challengeId));
    if (status.state === 'confirmed') {
      const result = await api('POST', '/v1/auth/link/complete', { challengeId });
      state.csrf = result.csrfToken || '';
      state.user = { name: result.user?.minecraftUsername || result.user?.username || name };
      closeModals();
      renderAccount();
      await refreshBalance();
      toast(`Welcome, ${state.user.name}!`, 'ok');
      return;
    }
    if (status.state === 'completed') {
      closeModals();
      return;
    }
    if (status.state === 'expired' || status.state === 'locked') {
      closeModals();
      toast('Login expired. Please try again.', 'error');
      return;
    }
    pollTimer = setTimeout(() => pollLogin(challengeId, name), POLL_MS);
  } catch (err) {
    loginError(err.message);
  }
}

// ---------- wiring ----------

function wire() {
  $$('.bottomnav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.go)));
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModals(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

  $('#login-btn').addEventListener('click', openLogin);
  $('#login-form').addEventListener('submit', startLogin);

  $('#settings-btn').addEventListener('click', () => { $('#settings-modal').hidden = false; });
  $('#wallet-btn').addEventListener('click', () => { $('#wallet-menu').hidden = !$('#wallet-menu').hidden; });
  $$('#wallet-menu [data-action]').forEach((b) => b.addEventListener('click', () => {
    $('#wallet-menu').hidden = true;
    if (b.dataset.action === 'rakeback' || b.dataset.action === 'history') showTab('rewards');
    else toast('Coming soon.');
  }));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#wallet')) $('#wallet-menu').hidden = true;
  });

  $('#sound-toggle').addEventListener('change', () => {});
  $('#games-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-game]');
    if (!b) return;
    const game = GAMES.find((g) => g.key === b.dataset.game);
    if (game && !game.live) toast(`${game.name} is coming soon.`);
  });
  $('#cases-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-case]');
    if (b) openCaseModal(b.dataset.case);
  });
}

async function init() {
  renderGames();
  wire();
  renderAccount();
  showTab('games');
  await loadCases();
  try {
    const me = await api('GET', '/v1/auth/me');
    state.user = { name: me.minecraftUsername || 'Player' };
    state.csrf = cookie('du_csrf') || state.csrf;
    await refreshBalance();
  } catch {
    renderAccount();
  }
}

init();
