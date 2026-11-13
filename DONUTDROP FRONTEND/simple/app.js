// DonutFlash - in-game money only. Plain ES module, no build step.
// Real data (cases, balance, login, leaderboard, chat) comes from the existing API.
// Game screens are previews with demo credits; they never touch the real balance.

const API = (window.DONUTDROP_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const POLL_MS = 3000;

// Original game catalogue. Art is generated here as SVG, not copied from any other site.
const GAMES = [
  { key: 'case-battles', name: 'Case Battles', hue: 265, glyph: 'battle', desc: 'Open cases head to head. Highest total takes the pot.' },
  { key: 'limbo', name: 'Limbo', hue: 200, glyph: 'limbo', desc: 'Pick a target multiplier. Beat it to win.' },
  { key: 'upgrader', name: 'Upgrader', hue: 150, glyph: 'up', desc: 'Stake an item to try for a better one.' },
  { key: 'mines', name: 'Mines', hue: 210, glyph: 'mine', desc: 'Reveal gems, avoid the mines, cash out any time.' },
  { key: 'crash', name: 'Crash', hue: 0, glyph: 'crash', desc: 'Cash out before the rocket crashes.' },
  { key: 'plinko', name: 'Plinko', hue: 320, glyph: 'plinko', desc: 'Drop a ball and watch it bounce to a multiplier.' },
  { key: 'blackjack', name: 'Blackjack', hue: 140, glyph: 'cards', desc: 'Beat the dealer to 21 without going over.' },
  { key: 'dice', name: 'Dice', hue: 30, glyph: 'dice', desc: 'Roll over or under your chosen number.' },
  { key: 'roulette', name: 'Roulette', hue: 355, glyph: 'wheel', desc: 'Place your chips and spin the wheel.' },
  { key: 'tower', name: 'Tower', hue: 245, glyph: 'tower', desc: 'Climb floor by floor, one safe tile at a time.' },
  { key: 'chicken', name: 'Chicken', hue: 45, glyph: 'chicken', desc: 'Cross the road. Each step raises the prize.' },
  { key: 'coinflip', name: 'Coinflip', hue: 48, glyph: 'coin', desc: 'Heads or tails. Double or nothing.' },
  { key: 'slots', name: 'Slots', hue: 285, glyph: 'slots', desc: 'Spin three reels and line up the symbols.' },
  { key: 'fishing', name: 'Fishing', hue: 190, glyph: 'fish', desc: 'Cast your line and reel in a prize.' },
  { key: 'derby', name: 'Derby', hue: 110, glyph: 'derby', desc: 'Back a horse and watch the race.' },
];
const PLAYABLE = new Set(['limbo', 'dice', 'coinflip', 'crash', 'mines', 'plinko']);

const state = {
  user: null,
  balanceMinor: 0n,
  csrf: '',
  cases: [],
  demo: 1000,          // demo credits for previews only
  crashTimer: null,
  crashRunning: false,
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

function fmtNum(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtMinor(minor) {
  return fmtNum(Number(minor || 0) / 100);
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

function rand() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
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
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- original SVG art ----------

function gameArt(game) {
  const h = game.hue;
  const id = 'g' + game.key.replace(/[^a-z]/g, '');
  const bg = `<defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${h} 90% 62%)"/><stop offset="1" stop-color="hsl(${h} 70% 24%)"/>
    </linearGradient>
    <radialGradient id="${id}s" cx=".3" cy=".2" r=".7">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <filter id="${id}f" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity=".35"/>
    </filter>
  </defs>
    <rect width="100" height="100" rx="18" fill="url(#${id})"/>
    <rect width="100" height="100" rx="18" fill="url(#${id}s)"/>
    <circle cx="82" cy="18" r="16" fill="rgba(255,255,255,.12)"/>
    <circle cx="14" cy="88" r="10" fill="rgba(0,0,0,.18)"/>
    <g filter="url(#${id}f)">`;
  const glyphs = {
    battle: '<path d="M30 70 L70 30 M70 70 L30 30" stroke="#fff" stroke-width="8" stroke-linecap="round"/>',
    limbo: '<path d="M18 72 L40 52 L56 60 L82 26" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
    up: '<path d="M50 24 L74 56 L58 56 L58 78 L42 78 L42 56 L26 56 Z" fill="#fff"/>',
    mine: '<circle cx="50" cy="50" r="18" fill="#fff"/><path d="M50 18 V30 M50 70 V82 M18 50 H30 M70 50 H82" stroke="#fff" stroke-width="6" stroke-linecap="round"/>',
    crash: '<path d="M20 78 Q48 74 60 44 T82 22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="82" cy="22" r="6" fill="#fff"/>',
    plinko: '<circle cx="34" cy="34" r="5" fill="#fff"/><circle cx="66" cy="34" r="5" fill="#fff"/><circle cx="50" cy="52" r="5" fill="#fff"/><circle cx="50" cy="74" r="8" fill="#fff"/>',
    cards: '<rect x="26" y="24" width="28" height="40" rx="5" fill="#fff" transform="rotate(-10 40 44)"/><rect x="46" y="32" width="28" height="40" rx="5" fill="#fff" opacity=".85" transform="rotate(8 60 52)"/>',
    dice: '<rect x="28" y="28" width="44" height="44" rx="8" fill="#fff"/><circle cx="40" cy="40" r="4" fill="#222"/><circle cx="60" cy="60" r="4" fill="#222"/><circle cx="50" cy="50" r="4" fill="#222"/>',
    wheel: '<circle cx="50" cy="50" r="28" fill="none" stroke="#fff" stroke-width="8"/><path d="M50 22 V78 M22 50 H78" stroke="#fff" stroke-width="4"/>',
    tower: '<rect x="36" y="22" width="28" height="12" fill="#fff"/><rect x="30" y="38" width="40" height="12" fill="#fff"/><rect x="24" y="54" width="52" height="12" fill="#fff"/><rect x="18" y="70" width="64" height="10" fill="#fff"/>',
    chicken: '<ellipse cx="52" cy="56" rx="22" ry="18" fill="#fff"/><circle cx="68" cy="40" r="10" fill="#fff"/><path d="M26 38 L16 34 L26 46 Z" fill="#fff"/>',
    coin: '<circle cx="50" cy="50" r="28" fill="#fff"/><circle cx="50" cy="50" r="18" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="4"/>',
    slots: '<rect x="20" y="30" width="60" height="40" rx="8" fill="#fff"/><rect x="28" y="38" width="12" height="24" fill="rgba(0,0,0,.25)"/><rect x="44" y="38" width="12" height="24" fill="rgba(0,0,0,.25)"/><rect x="60" y="38" width="12" height="24" fill="rgba(0,0,0,.25)"/>',
    fish: '<ellipse cx="48" cy="50" rx="26" ry="16" fill="#fff"/><path d="M70 50 L84 38 L84 62 Z" fill="#fff"/><circle cx="36" cy="46" r="3" fill="#222"/>',
    derby: '<path d="M22 66 L38 34 L60 34 L72 46 L80 46 L76 66 Z" fill="#fff"/><path d="M30 66 V80 M70 66 V80" stroke="#fff" stroke-width="5"/>',
  };
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${bg}${glyphs[game.glyph] || ''}</g></svg>`;
}

// ---------- navigation ----------

const ROUTES = {
  games: renderGames,
  game: renderGame,
  rewards: renderRewards,
  leaderboard: renderLeaderboard,
  chat: renderChat,
  case: renderCaseDetail,
};

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, arg = ''] = hash.split('/');
  return { name: name || 'games', arg: decodeURIComponent(arg) };
}

function setActiveTab(name) {
  const tab = ['chat', 'games', 'rewards', 'leaderboard'].includes(name) ? name
    : (name === 'game' ? 'games' : '');
  $$('.bottomnav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
}

function route() {
  const { name, arg } = currentRoute();
  const fn = ROUTES[name] || renderGames;
  setActiveTab(name);
  closeModals();
  window.scrollTo({ top: 0 });
  fn(arg);
}

// ---------- account ----------

function renderAccount() {
  const loggedIn = Boolean(state.user);
  $('#login-btn').hidden = loggedIn;
  $('#logout-btn').hidden = !loggedIn;
  $('#wallet').hidden = !loggedIn;
  $('#balance-text').textContent = fmtMinor(state.balanceMinor);
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
  route();
}

// ---------- games grid ----------

function renderGames() {
  const user = state.user ? `Welcome back, ${state.user.name}` : 'Welcome to DonutFlash';
  const games = GAMES.map((g) => `
    <a class="card" href="#/game/${esc(g.key)}">
      <div class="art">${gameArt(g)}</div>
      <div class="name">${esc(g.name)}</div>
      ${PLAYABLE.has(g.key) ? '<span class="price">Play</span>' : '<span class="soon">Preview</span>'}
    </a>`).join('');

  view(`
    <section class="hero">
      <h1>${esc(user)}</h1>
      <p class="muted">The only legit DonutSMP casino. In-game money only.</p>
      <div class="hero-actions">
        ${state.user
          ? '<a class="btn btn-primary" href="#/rewards">Rewards</a><a class="btn btn-ghost" href="#/chat">Chat</a>'
          : '<button class="btn btn-primary" id="hero-login" type="button">Log in</button><a class="btn btn-ghost" href="#/rewards">Rewards</a>'}
      </div>
    </section>

    <div class="promo-row">
      <a class="promo promo-a" href="#/rewards"><span class="tag">Free rewards</span><b>Referrals</b><small>Invite friends, earn commission</small></a>
      <a class="promo promo-b" href="#/leaderboard"><span class="tag">Weekly leaderboard</span><b>Race</b><small>Climb the board, win prizes</small></a>
    </div>

    <h2 class="section-title">Cases <span class="muted small" id="cases-count"></span></h2>
    <div class="grid" id="cases-grid"><p class="muted">Loading cases…</p></div>

    <h2 class="section-title">DonutFlash Originals</h2>
    <div class="grid games">${games}</div>
  `);

  $('#hero-login')?.addEventListener('click', openLogin);
  loadCases();
}

async function loadCases() {
  const grid = $('#cases-grid');
  if (!grid) return;
  try {
    const data = await api('GET', '/v1/cases?limit=50');
    state.cases = data.cases || [];
  } catch (err) {
    grid.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    return;
  }
  $('#cases-count').textContent = state.cases.length ? `${state.cases.length} live` : '';
  if (!state.cases.length) {
    grid.innerHTML = '<p class="muted">No cases are live yet.</p>';
    return;
  }
  grid.innerHTML = state.cases.map((c) => `
    <button class="card" type="button" data-case="${esc(c.id)}">
      <div class="art">${safeUrl(c.imageUrl) ? `<img src="${esc(safeUrl(c.imageUrl))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:contain" />` : '<div style="width:100%;height:100%;display:grid;place-items:center;font-size:2.4rem;background:var(--panel-2)">📦</div>'}</div>
      <div class="name">${esc(c.name)}</div>
      <span class="price">${esc(fmtMinor(c.priceMinor))}</span>
    </button>`).join('');
  grid.querySelectorAll('[data-case]').forEach((el) => {
    el.addEventListener('click', () => { location.hash = '#/case/' + encodeURIComponent(el.dataset.case); });
  });
}

// ---------- case detail & opening ----------

function renderCaseDetail(id) {
  const c = state.cases.find((x) => x.id === id);
  if (!c) {
    view('<section class="panel"><p class="muted">Case not found.</p><a class="btn btn-ghost" href="#/games">Back</a></section>');
    return;
  }
  const total = Number(c.totalWeight || 0);
  const drops = (c.drops || []).map((d) => {
    const chance = total ? ((Number(d.weight || 0) / total) * 100).toFixed(2) : '–';
    return `<li>
      ${safeUrl(d.imageUrl) ? `<img src="${esc(safeUrl(d.imageUrl))}" alt="" width="28" height="28" />` : '•'}
      <span>${esc(d.displayName || d.minecraftName || 'Item')}</span>
      <span class="chance">${esc(chance)}%</span>
    </li>`;
  }).join('');

  view(`
    <a class="muted small" href="#/games">← Back</a>
    <section class="stage" style="margin-top:.5rem">
      <div class="big">${esc(c.name)}</div>
      <span class="price">${esc(fmtMinor(c.priceMinor))}</span>
      ${c.description ? `<p class="muted">${esc(c.description)}</p>` : ''}
    </section>
    <h3 style="margin-top:1rem">Possible drops</h3>
    <ul class="drop-list">${drops || '<li class="muted">No drops configured.</li>'}</ul>
    <button class="btn btn-primary btn-block" id="open-btn" type="button">
      ${state.user ? `Open for ${esc(fmtMinor(c.priceMinor))}` : 'Log in to open'}
    </button>
    <p class="error small" id="open-error" hidden></p>
    <p class="muted small" style="margin-top:.75rem">In-game money only. No real money is accepted or paid out.</p>
  `);

  $('#open-btn').addEventListener('click', () => (state.user ? openCase(c) : openLogin()));
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
    toast(`You won ${result.item?.displayName || result.item?.minecraftName || 'an item'}!`, 'ok');
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = `Open for ${fmtMinor(c.priceMinor)}`;
  }
}

// ---------- game screens ----------

function gameHeader(game) {
  return `
    <a class="muted small" href="#/games">← Games</a>
    <div class="game-head" style="margin-top:.5rem">
      <div class="art">${gameArt(game)}</div>
      <div>
        <h1 style="margin:0">${esc(game.name)}</h1>
        <p class="muted small" style="margin:0">${esc(game.desc)}</p>
      </div>
    </div>`;
}

function demoBar() {
  return `<div class="row" style="margin-bottom:.6rem"><span class="muted small">Demo credits</span><b id="demo-bal">${fmtNum(state.demo)}</b></div>`;
}

function renderGame(key) {
  const game = GAMES.find((g) => g.key === key);
  if (!game) return renderGames();
  stopCrash();

  if (!PLAYABLE.has(key)) {
    view(`${gameHeader(game)}
      <section class="stage">
        <div class="big" style="font-size:1.4rem">Preview</div>
        <p class="muted">${esc(game.name)} is laid out and ready. Its game logic is not connected yet, so there is nothing to play here.</p>
      </section>
      <p class="preview-note">Previews never use or change your real balance.</p>`);
    return;
  }

  const engines = { limbo: limbo, dice: dice, coinflip: coinflip, crash: crash, mines: mines, plinko: plinko };
  view(`${gameHeader(game)}${demoBar()}<div id="game-body"></div>
    <p class="preview-note">Demo preview with demo credits only. Real rounds need the game's server logic, which is not live yet.</p>`);
  engines[key]($('#game-body'));
}

function spend(bet) {
  if (bet <= 0 || bet > state.demo) { toast('Check your bet.', 'error'); return false; }
  state.demo -= bet;
  $('#demo-bal').textContent = fmtNum(state.demo);
  return true;
}

function payout(amount) {
  state.demo += amount;
  $('#demo-bal').textContent = fmtNum(state.demo);
}

function limbo(el) {
  el.innerHTML = `
    <div class="stage"><div class="big" id="limbo-result">1.00x</div><p class="muted" id="limbo-msg">Set a bet and target.</p></div>
    <div class="controls">
      <label>Bet<input type="number" id="l-bet" min="1" value="10" /></label>
      <label>Target multiplier<input type="number" id="l-target" min="1.01" step="0.01" value="2" /></label>
      <button class="btn btn-primary btn-block" id="l-play" type="button">Play</button>
    </div>`;
  $('#l-play').addEventListener('click', () => {
    const bet = Number($('#l-bet').value);
    const target = Number($('#l-target').value);
    if (!(target > 1) || !spend(bet)) return;
    // Multiplier from a uniform roll, house edge 1%.
    const result = Math.max(1, Math.floor((0.99 / Math.max(rand(), 1e-9)) * 100) / 100);
    $('#limbo-result').textContent = result.toFixed(2) + 'x';
    const win = result >= target;
    if (win) payout(Math.floor(bet * target));
    $('#limbo-msg').textContent = win ? `Won ${fmtNum(Math.floor(bet * target))}` : 'Busted';
  });
}

function dice(el) {
  el.innerHTML = `
    <div class="stage"><div class="big" id="d-result">--</div><p class="muted" id="d-msg">Roll under or over your number.</p></div>
    <div class="controls">
      <label>Bet<input type="number" id="d-bet" min="1" value="10" /></label>
      <label>Target (1–99)<input type="number" id="d-target" min="1" max="99" value="50" /></label>
      <div class="row">
        <button class="btn btn-ghost" id="d-under" type="button">Roll under</button>
        <button class="btn btn-primary" id="d-over" type="button">Roll over</button>
      </div>
    </div>`;
  const roll = (over) => {
    const bet = Number($('#d-bet').value);
    const t = Number($('#d-target').value);
    if (!(t >= 1 && t <= 99) || !spend(bet)) return;
    const r = Math.floor(rand() * 10000) / 100;
    $('#d-result').textContent = r.toFixed(2);
    const chance = over ? (100 - t) : t;
    const win = over ? r > t : r < t;
    const mult = Math.floor((99 / chance) * 100) / 100;
    if (win) payout(Math.floor(bet * mult));
    $('#d-msg').textContent = win ? `Won ${fmtNum(Math.floor(bet * mult))} (${mult.toFixed(2)}x)` : 'Lost';
  };
  $('#d-under').addEventListener('click', () => roll(false));
  $('#d-over').addEventListener('click', () => roll(true));
}

function coinflip(el) {
  el.innerHTML = `
    <div class="stage"><div class="big" id="c-result">?</div><p class="muted" id="c-msg">Pick a side.</p></div>
    <div class="controls">
      <label>Bet<input type="number" id="c-bet" min="1" value="10" /></label>
      <div class="row">
        <button class="btn btn-ghost" data-side="heads" type="button">Heads</button>
        <button class="btn btn-ghost" data-side="tails" type="button">Tails</button>
      </div>
    </div>`;
  el.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => {
    const bet = Number($('#c-bet').value);
    if (!spend(bet)) return;
    const side = rand() < 0.5 ? 'heads' : 'tails';
    $('#c-result').textContent = side === 'heads' ? 'Heads' : 'Tails';
    const win = side === b.dataset.side;
    if (win) payout(bet * 2);
    $('#c-msg').textContent = win ? `Won ${fmtNum(bet * 2)}` : 'Lost';
  }));
}

function crash(el) {
  el.innerHTML = `
    <div class="stage"><div class="big" id="cr-mult">1.00x</div><p class="muted" id="cr-msg">Place a bet, then cash out before it crashes.</p></div>
    <div class="controls">
      <label>Bet<input type="number" id="cr-bet" min="1" value="10" /></label>
      <div class="row">
        <button class="btn btn-primary" id="cr-start" type="button">Start</button>
        <button class="btn btn-gold" id="cr-cash" type="button" disabled>Cash out</button>
      </div>
    </div>`;
  let mult = 1;
  let bet = 0;
  let crashAt = 1;
  const finish = (won) => {
    stopCrash();
    $('#cr-start').disabled = false;
    $('#cr-cash').disabled = true;
    if (won) {
      payout(Math.floor(bet * mult));
      $('#cr-msg').textContent = `Cashed out at ${mult.toFixed(2)}x`;
    } else {
      $('#cr-msg').textContent = `Crashed at ${crashAt.toFixed(2)}x`;
    }
  };
  $('#cr-start').addEventListener('click', () => {
    bet = Number($('#cr-bet').value);
    if (!spend(bet)) return;
    // Crash point: 1% house edge, uniform roll.
    crashAt = Math.max(1, Math.floor((0.99 / Math.max(rand(), 1e-9)) * 100) / 100);
    mult = 1;
    state.crashRunning = true;
    $('#cr-start').disabled = true;
    $('#cr-cash').disabled = false;
    $('#cr-msg').textContent = 'Running…';
    state.crashTimer = setInterval(() => {
      mult = Math.round((mult + 0.01 + mult * 0.01) * 100) / 100;
      $('#cr-mult').textContent = mult.toFixed(2) + 'x';
      if (mult >= crashAt) {
        $('#cr-mult').textContent = crashAt.toFixed(2) + 'x';
        finish(false);
      }
    }, 80);
  });
  $('#cr-cash').addEventListener('click', () => {
    if (state.crashRunning) finish(true);
  });
}

function stopCrash() {
  clearInterval(state.crashTimer);
  state.crashTimer = null;
  state.crashRunning = false;
}

function mines(el) {
  el.innerHTML = `
    <div class="stage">
      <div class="mine-grid" id="m-grid"></div>
      <p class="muted" id="m-msg">Pick your bet and mines, then reveal tiles.</p>
    </div>
    <div class="controls">
      <label>Bet<input type="number" id="m-bet" min="1" value="10" /></label>
      <label>Mines (1–24)<input type="number" id="m-count" min="1" max="24" value="3" /></label>
      <div class="row">
        <button class="btn btn-primary" id="m-start" type="button">Start</button>
        <button class="btn btn-gold" id="m-cash" type="button" disabled>Cash out</button>
      </div>
    </div>`;
  const grid = $('#m-grid');
  let bombs = new Set();
  let bet = 0;
  let safe = 0;
  let live = false;
  const size = 25;

  const drawGrid = (reveal) => {
    grid.innerHTML = Array.from({ length: size }, (_, i) => {
      const isBomb = bombs.has(i);
      const cls = reveal ? (isBomb ? 'bomb' : 'gem') : '';
      return `<button type="button" data-i="${i}" class="${cls}" ${live && !reveal ? '' : 'disabled'}>${reveal ? (isBomb ? '💣' : '💎') : ''}</button>`;
    }).join('');
  };
  const multiplier = () => Math.max(1, Math.round((1 + safe * 0.2) * 100) / 100);

  drawGrid(false);
  $('#m-start').addEventListener('click', () => {
    bet = Number($('#m-bet').value);
    const count = Math.min(24, Math.max(1, Number($('#m-count').value)));
    if (!spend(bet)) return;
    bombs = new Set();
    while (bombs.size < count) bombs.add(Math.floor(rand() * size));
    safe = 0;
    live = true;
    $('#m-start').disabled = true;
    $('#m-cash').disabled = false;
    $('#m-msg').textContent = `Multiplier ${multiplier().toFixed(2)}x`;
    drawGrid(false);
    grid.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b || !live) return;
    const i = Number(b.dataset.i);
    if (bombs.has(i)) {
      live = false;
      $('#m-msg').textContent = 'Hit a mine.';
      drawGrid(true);
      endMines();
      return;
    }
    safe += 1;
    b.classList.add('gem');
    b.textContent = '💎';
    b.disabled = true;
    $('#m-msg').textContent = `Multiplier ${multiplier().toFixed(2)}x`;
  });
  const endMines = () => {
    $('#m-start').disabled = false;
    $('#m-cash').disabled = true;
  };
  $('#m-cash').addEventListener('click', () => {
    if (!live) return;
    live = false;
    const won = Math.floor(bet * multiplier());
    payout(won);
    $('#m-msg').textContent = `Cashed out ${fmtNum(won)}`;
    drawGrid(true);
    endMines();
  });
}

function plinko(el) {
  el.innerHTML = `
    <div class="stage"><div class="big" id="p-result">--</div><p class="muted" id="p-msg">Drop a ball into the board.</p></div>
    <div class="controls">
      <label>Bet<input type="number" id="p-bet" min="1" value="10" /></label>
      <button class="btn btn-primary btn-block" id="p-drop" type="button">Drop ball</button>
    </div>`;
  const slots = [5, 2, 1, 0.5, 0.3, 0.5, 1, 2, 5];
  $('#p-drop').addEventListener('click', () => {
    const bet = Number($('#p-bet').value);
    if (!spend(bet)) return;
    // Eight bounces, each left or right; final column picks the slot.
    let pos = 0;
    for (let i = 0; i < 8; i++) pos += rand() < 0.5 ? 0 : 1;
    const slot = Math.min(slots.length - 1, Math.max(0, pos));
    const mult = slots[slot];
    $('#p-result').textContent = mult.toFixed(2) + 'x';
    const won = Math.floor(bet * mult);
    if (won > 0) payout(won);
    $('#p-msg').textContent = `Won ${fmtNum(won)}`;
  });
}

// ---------- rewards, leaderboard, chat ----------

function renderRewards() {
  view(`
    <h2 class="section-title">Rewards</h2>
    <p class="muted">Free cases, rakeback, bonuses and promo codes. Everything is credited to your balance.</p>
    <div class="panel"><div class="row"><b>Free cases</b><span class="muted small">${state.user ? 'Available daily' : 'Log in to claim'}</span></div></div>
    <div class="panel"><div class="row"><b>Weekly race</b><span class="muted small">Prize pool shows when a race is live</span></div></div>
    <div class="panel"><div class="row"><b>Referrals</b><span class="muted small">Share your code to earn commission</span></div></div>
    <div class="panel"><div class="row"><b>Rakeback</b><span class="muted small">Earn back a share of what you wager</span></div></div>
  `);
}

async function renderLeaderboard() {
  view('<h2 class="section-title">Leaderboard</h2><div class="panel" id="lb"><p class="muted">Loading…</p></div>');
  const box = $('#lb');
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

async function renderChat() {
  view('<h2 class="section-title">Chat</h2><div class="panel chat" id="chat"><p class="muted">Loading…</p></div>');
  const box = $('#chat');
  try {
    const data = await api('GET', '/v1/chat?limit=50');
    const messages = data.messages || [];
    box.innerHTML = messages.length
      ? messages.map((m) => `<div class="chat-msg"><b>${esc(m.author)}</b> ${esc(m.body)}</div>`).join('')
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
      await refreshBalance();
      toast(`Welcome, ${state.user.name}!`, 'ok');
      route();
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

// ---------- shared ----------

function view(html) {
  $('#view').innerHTML = html;
}

function wire() {
  $('#login-btn').addEventListener('click', openLogin);
  $('#logout-btn').addEventListener('click', logout);
  $('#login-form').addEventListener('submit', startLogin);

  $$('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModals(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

  $('#settings-btn').addEventListener('click', () => { $('#settings-modal').hidden = false; });
  $('#wallet-btn').addEventListener('click', () => { $('#wallet-menu').hidden = !$('#wallet-menu').hidden; });
  $$('#wallet-menu [data-action]').forEach((b) => b.addEventListener('click', () => {
    $('#wallet-menu').hidden = true;
    if (b.dataset.action === 'rakeback' || b.dataset.action === 'history') location.hash = '#/rewards';
    else toast('Coming soon.');
  }));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#wallet')) $('#wallet-menu').hidden = true;
  });

  window.addEventListener('hashchange', route);
}

async function init() {
  wire();
  renderAccount();
  route();
  try {
    const me = await api('GET', '/v1/auth/me');
    state.user = { name: me.minecraftUsername || 'Player' };
    state.csrf = cookie('du_csrf') || state.csrf;
    await refreshBalance();
    route();
  } catch {
    renderAccount();
  }
}

init();
