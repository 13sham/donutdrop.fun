// DonutDrop - simplified frontend. Plain ES module, no build step.
// Talks only to the core endpoints: cases, activity, login (pay flow), balance, open case.

const API = (window.DONUTDROP_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const CURRENCY = '$';
const POLL_MS = 3000;

const state = {
  user: null,        // { name } once logged in
  balanceMinor: 0n,
  csrf: '',
  cases: [],
  openCase: null,
};

// ---------- helpers ----------

const $ = (sel) => document.querySelector(sel);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Only allow http(s) or relative image URLs.
function safeUrl(url) {
  if (!url) return '';
  return /^(https?:\/\/|\/|assets\/)/i.test(url) ? url : '';
}

function money(minor) {
  const n = Number(minor || 0) / 100;
  return CURRENCY + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Cannot reach the DonutDrop server.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Request failed (${res.status}).`);
  }
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

// ---------- header / account ----------

function renderAccount() {
  const box = $('#account');
  if (!state.user) {
    box.innerHTML = '<button class="btn btn-ghost" id="login-btn" type="button">Log in</button>';
    $('#login-btn').addEventListener('click', openLogin);
    return;
  }
  box.innerHTML = `
    <span class="user">${esc(state.user.name)}</span>
    <span class="balance">${esc(money(state.balanceMinor))}</span>
    <button class="btn btn-ghost" id="logout-btn" type="button">Log out</button>`;
  $('#logout-btn').addEventListener('click', logout);
}

async function refreshBalance() {
  const data = await api('GET', '/v1/balance');
  state.balanceMinor = BigInt(data.balanceMinor || '0');
  renderAccount();
}

async function logout() {
  try { await api('POST', '/v1/auth/logout'); } catch { /* ignore, clear locally anyway */ }
  state.user = null;
  state.csrf = '';
  state.balanceMinor = 0n;
  renderAccount();
  toast('Logged out.');
}

// ---------- cases & activity ----------

async function loadCases() {
  const grid = $('#cases-grid');
  try {
    const data = await api('GET', '/v1/cases?limit=50');
    state.cases = data.cases || [];
  } catch (err) {
    grid.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    $('#cases-count').textContent = '';
    return;
  }
  $('#cases-count').textContent = `${state.cases.length} available`;
  if (!state.cases.length) {
    grid.innerHTML = '<div class="empty">No cases are live yet. Check back soon.</div>';
    return;
  }
  grid.innerHTML = state.cases.map((c) => `
    <button class="case-card" type="button" data-case="${esc(c.id)}">
      ${safeUrl(c.imageUrl) ? `<img class="case-img" src="${esc(safeUrl(c.imageUrl))}" alt="" loading="lazy" />` : '<div class="case-img"></div>'}
      <div class="case-name">${esc(c.name)}</div>
      <div class="case-price">${esc(money(c.priceMinor))}</div>
    </button>`).join('');
  grid.querySelectorAll('[data-case]').forEach((el) => {
    el.addEventListener('click', () => openCaseModal(el.dataset.case));
  });
}

async function loadActivity() {
  const track = $('#ticker');
  try {
    const data = await api('GET', '/v1/activity/recent');
    const rows = (data.activities || []).slice(0, 20);
    if (!rows.length) {
      track.innerHTML = '<span class="muted">No drops yet.</span>';
      return;
    }
    track.innerHTML = rows.map((r) => `
      <span class="drop-chip">
        ${safeUrl(r.image_url) ? `<img src="${esc(safeUrl(r.image_url))}" alt="" />` : ''}
        <strong>${esc(r.player || 'Someone')}</strong>
        <span class="muted">won</span>
        ${esc(r.display_name || r.minecraft_name || 'an item')}
      </span>`).join('');
  } catch {
    track.innerHTML = '<span class="muted">Live drops are unavailable right now.</span>';
  }
}

async function loadFairness() {
  if (!state.user) return;
  try {
    const f = await api('GET', '/v1/fairness/current');
    $('#fair-status').textContent = `Current seed hash: ${f.serverSeedHash} (nonce ${f.nonce})`;
  } catch { /* optional */ }
}

// ---------- case modal & opening ----------

function openCaseModal(id) {
  const c = state.cases.find((x) => x.id === id);
  if (!c) return;
  state.openCase = c;
  const totalWeight = Number(c.totalWeight || 0);
  const drops = (c.drops || []).map((d) => {
    const chance = totalWeight ? ((Number(d.weight || 0) / totalWeight) * 100).toFixed(2) : '–';
    return `
      <li>
        ${safeUrl(d.imageUrl) ? `<img src="${esc(safeUrl(d.imageUrl))}" alt="" />` : ''}
        <span>${esc(d.displayName || d.minecraftName || 'Item')}</span>
        <span class="chance">${esc(chance)}%</span>
      </li>`;
  }).join('');

  $('#case-detail').innerHTML = `
    <div class="case-hero">
      ${safeUrl(c.imageUrl) ? `<img class="case-img" src="${esc(safeUrl(c.imageUrl))}" alt="" />` : ''}
      <div>
        <h2>${esc(c.name)}</h2>
        <div class="case-price" style="display:inline-block">${esc(money(c.priceMinor))}</div>
      </div>
    </div>
    ${c.description ? `<p class="muted">${esc(c.description)}</p>` : ''}
    <h3>Possible drops</h3>
    <ul class="drop-list">${drops || '<li class="muted">No drops configured.</li>'}</ul>
    <button class="btn btn-primary btn-block" id="open-btn" type="button">
      ${state.user ? `Open for ${esc(money(c.priceMinor))}` : 'Log in to open'}
    </button>
    <p class="error small" id="open-error" hidden></p>`;

  $('#open-btn').addEventListener('click', () => (state.user ? openCase(c) : (closeModals(), openLogin())));
  $('#case-modal').hidden = false;
}

async function openCase(c) {
  const btn = $('#open-btn');
  const err = $('#open-error');
  err.hidden = true;
  if (BigInt(state.balanceMinor) < BigInt(c.priceMinor)) {
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
    const name = result.item?.displayName || result.item?.minecraftName || 'an item';
    toast(`You won ${name}!`, 'ok');
    loadActivity();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = `Open for ${money(c.priceMinor)}`;
  }
}

// ---------- login (pay flow) ----------

let pollTimer;

function openLogin() {
  $('#login-form').hidden = false;
  $('#login-step').hidden = true;
  $('#login-error').hidden = true;
  $('#login-form').reset();
  $('#login-modal').hidden = false;
  $('#mc-name').focus();
}

function closeModals() {
  clearTimeout(pollTimer);
  document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
}

function showLoginError(message) {
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
    $('#login-instruction').innerHTML =
      `Send this exact message in-game: <div class="code">${esc(start.instruction)}</div>`;
    pollLogin(start.challengeId, name);
  } catch (err) {
    showLoginError(err.message);
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
      loadFairness();
      toast(`Welcome, ${state.user.name}!`, 'ok');
      return;
    }
    if (status.state === 'completed') {
      closeModals();
      toast('You are already logged in.');
      return;
    }
    if (status.state === 'expired' || status.state === 'locked') {
      closeModals();
      toast('Login expired. Please try again.', 'error');
      return;
    }
    pollTimer = setTimeout(() => pollLogin(challengeId, name), POLL_MS);
  } catch (err) {
    showLoginError(err.message);
  }
}

// ---------- wiring ----------

function wireModals() {
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModals(); });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
  $('#login-form').addEventListener('submit', startLogin);
}

async function init() {
  renderAccount();
  wireModals();
  await Promise.all([loadCases(), loadActivity()]);
  // Restore a session if the browser already has one.
  try {
    const me = await api('GET', '/v1/auth/me');
    state.user = { name: me.minecraftUsername || 'Player' };
    state.csrf = cookie('du_csrf') || state.csrf;
    await refreshBalance();
    loadFairness();
  } catch {
    renderAccount();
  }
}

init();
