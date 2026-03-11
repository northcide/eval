/* Scout Pro — Main Application JS */
'use strict';

// Skills are now per-league and fetched from the API
// LeagueSkills caches them to avoid repeated fetches within a session
const LeagueSkills = {
  _cache: null,
  async get() {
    if (this._cache) return this._cache;
    try {
      const data = await api('skills', 'list');
      this._cache = data.map(s => s.name);
    } catch {
      this._cache = ['Running', 'Fielding', 'Pitching', 'Hitting'];
    }
    return this._cache;
  },
  invalidate() { this._cache = null; }
};

// ─── Offline IndexedDB ────────────────────────────────────────────────────────
const OfflineDB = {
  _db: null,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('scout-pro-offline', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('eval_queue')) {
          db.createObjectStore('eval_queue', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'k' });
        }
      };
      req.onsuccess  = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror    = e => reject(e.target.error);
    });
  },

  async kvSet(k, v) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ k, v });
      tx.oncomplete = resolve; tx.onerror = e => reject(e.target.error);
    });
  },

  async kvGet(k) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(k);
      req.onsuccess = e => resolve(e.target.result?.v ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  },

  async enqueue(item) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('eval_queue', 'readwrite');
      tx.objectStore('eval_queue').add({ ...item, queued_at: Date.now() });
      tx.oncomplete = resolve; tx.onerror = e => reject(e.target.error);
    });
  },

  async getQueue() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('eval_queue', 'readonly');
      const req = tx.objectStore('eval_queue').getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  },

  async dequeue(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('eval_queue', 'readwrite');
      tx.objectStore('eval_queue').delete(id);
      tx.oncomplete = resolve; tx.onerror = e => reject(e.target.error);
    });
  },

  async queueSize() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('eval_queue', 'readonly');
      const req = tx.objectStore('eval_queue').count();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }
};

// ─── Sync ─────────────────────────────────────────────────────────────────────
const Sync = {
  _busy: false,

  async upload() {
    if (this._busy || !navigator.onLine) return 0;
    this._busy = true;
    const queue = await OfflineDB.getQueue();
    let n = 0;
    for (const item of queue) {
      try {
        const res = await fetch('api/evaluations.php?action=submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id:  item.session_id,
            player_id:   item.player_id,
            skill_index: item.skill_index,
            score:       item.score
          })
        });
        if (res.ok) { await OfflineDB.dequeue(item.id); n++; }
        else break;
      } catch { break; }
    }
    this._busy = false;
    await this.refreshUI();
    return n;
  },

  async refreshUI() {
    const count   = await OfflineDB.queueSize();
    const online  = navigator.onLine;
    const offBadge = document.getElementById('offline-badge');
    const syncBtn  = document.getElementById('sync-btn');
    const syncCnt  = document.getElementById('sync-count');
    if (offBadge) offBadge.hidden = online;
    if (syncBtn)  syncBtn.hidden  = count === 0;
    if (syncCnt)  syncCnt.textContent = count > 0 ? `↑ ${count}` : '';
  },

  async registerBgSync() {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('upload-evaluations');
    } catch (_) {}
  }
};

// ─── API helper ───────────────────────────────────────────────────────────────
async function api(file, action, data = null, method = 'GET') {
  let url = `api/${file}.php?action=${action}`;
  if (App.managingLeague) url += `&managing_league_id=${App.managingLeague.id}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (data) {
    opts.method = 'POST';
    opts.body = JSON.stringify(App.managingLeague
      ? { ...data, managing_league_id: App.managingLeague.id }
      : data);
  }
  const res = await fetch(url, { ...opts, credentials: 'same-origin' });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

// ─── App State ────────────────────────────────────────────────────────────────
const App = {
  user: null,
  currentTab: null,
  pollTimer: null,
  managingLeague: null,

  async init() {
    try {
      const { coach } = await api('auth', 'me');
      if (coach) { this.user = coach; this.showApp(); }
      else { this.showLogin(); }
    } catch { this.showLogin(); }

    window.addEventListener('online', async () => {
      await Sync.refreshUI();
      const n = await Sync.upload();
      if (n > 0 && App.currentTab === 'evaluate') CoachEvaluate.load();
    });
    window.addEventListener('offline', () => Sync.refreshUI());
    await Sync.refreshUI();
  },

  showLogin() {
    document.getElementById('app').innerHTML = renderLogin();
    document.getElementById('login-form').addEventListener('submit', e => { e.preventDefault(); this.doLogin(); });
  },

  async doLogin() {
    const name = document.getElementById('login-name').value.trim();
    const pass = document.getElementById('login-pass').value;
    const err  = document.getElementById('login-error');
    const btn  = document.getElementById('login-btn');

    err.textContent = '';
    err.classList.add('hidden');

    if (!name) { showLoginError('Please enter your name.'); return; }
    if (!pass)  { showLoginError('Please enter your password.'); return; }

    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      const { coach } = await api('auth', 'login', { name, password: pass });
      this.user = coach;
      this.showApp();
    } catch (e) {
      const msg = e.message?.includes('fetch') || e.message?.includes('network') || e.message?.includes('Failed')
        ? 'Cannot reach the server. Check your connection and try again.'
        : (e.message || 'Login failed. Please try again.');
      showLoginError(msg);
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  },

  async doLogout() {
    await api('auth', 'logout');
    this.user = null;
    clearInterval(this.pollTimer);
    this.showLogin();
  },

  showApp() {
    const isAdmin = this.user.is_admin;
    const isSuperAdmin = isAdmin && this.user.league_id === null;
    const isLeagueAdmin = isAdmin && this.user.league_id !== null;

    let tabs;
    if (isSuperAdmin) {
      tabs = [['leagues','Leagues','🏆']];
    } else if (isLeagueAdmin) {
      tabs = [['leagues','My League','🏆']];
    } else {
      tabs = [['evaluate','Evaluate','⚾'],['results','My Results','📊']];
    }

    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-logo">
          <div class="header-icon">⚾</div>
          <div>
            <span class="header-title">Scout Pro</span>
            ${isSuperAdmin ? '<span class="badge-admin">SUPERADMIN</span>' : isLeagueAdmin ? '<span class="badge-admin">ADMIN</span>' : ''}
          </div>
        </div>
        <div class="header-right">
          <span class="welcome-text">Welcome, <span>${escHtml(this.user.name)}</span></span>
          <span id="offline-badge" class="offline-badge" hidden>Offline</span>
          <button id="sync-btn" class="sync-btn" hidden onclick="Sync.upload()"><span id="sync-count"></span></button>
          <button class="btn-logout" onclick="ChangePassword.show()">🔑 Password</button>
          <button class="btn-logout" onclick="App.doLogout()">Sign Out</button>
        </div>
      </div>
      <div class="main-layout">
        <nav class="sidebar ${tabs.length <= 3 ? 'sidebar-few' : ''}" id="sidebar">
          ${tabs.map(([id,label,icon]) => `
            <button class="nav-btn" data-tab="${id}" onclick="App.switchTab('${id}')">
              <span class="nav-icon">${icon}</span><span>${label}</span>
            </button>`).join('')}
        </nav>
        <div class="content-wrap">
          <div id="manage-banner" class="manage-banner" hidden>
            <span>Managing: <strong id="manage-league-name"></strong></span>
            <button class="manage-exit-btn" onclick="App.exitManageMode()">← Back to Leagues</button>
          </div>
          <main class="content" id="main-content">
            <div style="color:var(--dim);padding-top:40px;text-align:center"><div class="spinner"></div></div>
          </main>
        </div>
      </div>`;

    this.switchTab(tabs[0][0]);
  },

  switchTab(tab) {
    clearInterval(this.pollTimer);
    this.currentTab = tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const views = { leagues: Leagues, divisions: Divisions, players: Players, coaches: Coaches, skills: Skills, evaluate: Evaluate, results: Results };
    views[tab]?.load();
  },

  enterManageMode(league) {
    this.managingLeague = league;
    const isLeagueAdmin = this.user.is_admin && this.user.league_id !== null;
    const adminTabs = [['divisions','Divisions','⬡'],['players','Players','👤'],['coaches','Coaches','🛡'],['skills','Skills','⚙'],['evaluate','Evaluate','⚾'],['results','Results','📊']];
    const sidebar = document.getElementById('sidebar');
    sidebar.className = 'sidebar';
    sidebar.innerHTML = adminTabs.map(([id,label,icon]) => `
      <button class="nav-btn" data-tab="${id}" onclick="App.switchTab('${id}')">
        <span class="nav-icon">${icon}</span><span>${label}</span>
      </button>`).join('');
    const banner = document.getElementById('manage-banner');
    document.getElementById('manage-league-name').textContent = league.name;
    document.querySelector('.manage-exit-btn').textContent = isLeagueAdmin ? '← Back to My League' : '← Back to Leagues';
    banner.hidden = false;
    this.switchTab('divisions');
  },

  exitManageMode() {
    this.managingLeague = null;
    clearInterval(this.pollTimer);
    const isLeagueAdmin = this.user.is_admin && this.user.league_id !== null;
    const label = isLeagueAdmin ? 'My League' : 'Leagues';
    const sidebar = document.getElementById('sidebar');
    sidebar.className = 'sidebar sidebar-few';
    sidebar.innerHTML = `<button class="nav-btn active" data-tab="leagues" onclick="App.switchTab('leagues')">
      <span class="nav-icon">🏆</span><span>${label}</span></button>`;
    document.getElementById('manage-banner').hidden = true;
    this.currentTab = 'leagues';
    Leagues.load();
  }
};

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setMain(html) { document.getElementById('main-content').innerHTML = html; }
function scoreClass(n) { return n >= 8 ? 'score-high' : n >= 6 ? 'score-mid' : n >= 4 ? 'score-low' : 'score-poor'; }
function playerNumber(id) {
  return String(id).padStart(3, '0');
}
function posBadgeClass(pos) {
  if (pos === 'Pitcher/Catcher') return 'pos-PitcherCatcher';
  return 'pos-' + (pos || 'Player');
}

// ─── LOGIN render ─────────────────────────────────────────────────────────────
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function renderLogin() {
  return `
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-logo">⚾</div>
      <h1 class="login-title">Scout Pro</h1>
      <p class="login-sub">Baseball Evaluation System</p>
      <div class="login-card">
        <form id="login-form">
          <div class="field-group">
            <label class="field-label">Coach Name</label>
            <input id="login-name" placeholder="Enter your name" autocomplete="username"
              oninput="document.getElementById('login-error').classList.add('hidden')" />
          </div>
          <div class="field-group">
            <label class="field-label">Password</label>
            <input id="login-pass" type="password" placeholder="Enter your password" autocomplete="current-password"
              oninput="document.getElementById('login-error').classList.add('hidden')" />
          </div>
          <div id="login-error" class="alert alert-error hidden"></div>
          <button id="login-btn" type="submit" class="btn btn-primary btn-full mt16">Sign In</button>
        </form>
        <p class="login-hint">Default admin: "Administrator" / "admin123"</p>
      </div>
    </div>
  </div>`;
}

// Fix alert hidden toggling
document.addEventListener('change', () => {}, true);
const origSetMain = setMain;

// ─── Change Password Modal ─────────────────────────────────────────────────────
const ChangePassword = {
  show() {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="cp-overlay" onclick="ChangePassword.close()">
        <div class="modal-box" onclick="event.stopPropagation()">
          <h3 class="modal-title">Change Password</h3>
          <div class="field-group">
            <label class="field-label">Current Password</label>
            <input id="cp-current" type="password" placeholder="Current password" autocomplete="current-password" />
          </div>
          <div class="field-group">
            <label class="field-label">New Password</label>
            <input id="cp-new" type="password" placeholder="New password (min 6 chars)" autocomplete="new-password" />
          </div>
          <div class="field-group">
            <label class="field-label">Confirm New Password</label>
            <input id="cp-confirm" type="password" placeholder="Confirm new password" autocomplete="new-password" />
          </div>
          <div id="cp-alert" class="alert alert-error hidden"></div>
          <div class="modal-actions">
            <button class="btn" onclick="ChangePassword.close()">Cancel</button>
            <button class="btn btn-primary" onclick="ChangePassword.save()">Save Password</button>
          </div>
        </div>
      </div>`);
    document.getElementById('cp-current').focus();
  },

  close() {
    document.getElementById('cp-overlay')?.remove();
  },

  async save() {
    const current = document.getElementById('cp-current').value;
    const newPass = document.getElementById('cp-new').value;
    const confirm = document.getElementById('cp-confirm').value;
    const alert   = document.getElementById('cp-alert');

    alert.classList.add('hidden');

    if (!current || !newPass || !confirm) {
      alert.textContent = 'All fields are required.';
      alert.classList.remove('hidden');
      return;
    }
    if (newPass !== confirm) {
      alert.textContent = 'New passwords do not match.';
      alert.classList.remove('hidden');
      return;
    }
    try {
      await api('coaches', 'change_password', { current_password: current, new_password: newPass });
      this.close();
    } catch (e) {
      alert.textContent = e.message;
      alert.classList.remove('hidden');
    }
  }
};

// ─── LEAGUES (Superadmin only) ────────────────────────────────────────────────
const Leagues = {
  _all: [],
  _page: 0,
  _perPage: 15,

  async load() {
    const title = (App.user.is_admin && App.user.league_id !== null) ? 'My League' : 'Leagues';
    setMain(`<h2 class="section-title">${title}</h2><div class="spinner"></div>`);
    try {
      this._all  = await api('leagues', 'list');
      this._page = 0;
      this.render();
    } catch (e) {
      setMain(`<h2 class="section-title">${title}</h2><div class="alert alert-error">${escHtml(e.message)}</div>`);
    }
  },

  render() {
    const isSuperAdmin = App.user.is_admin && App.user.league_id === null;

    if (!isSuperAdmin) {
      // League admin: simple view — just their league(s) with a Manage button
      const cards = this._all.length
        ? this._all.map(l => `
            <div class="league-card">
              <div class="league-icon">🏆</div>
              <div class="league-card-info">
                <div class="league-name">${escHtml(l.name)}</div>
                <div class="text-xs text-dim">${l.coach_count} coaches · ${l.division_count} divisions</div>
              </div>
              <div class="league-card-actions">
                <button class="btn btn-sm btn-primary" onclick="Leagues.manage(${l.id})">Manage →</button>
              </div>
            </div>`).join('')
        : `<div class="empty-state"><p class="text-dim">No league found.</p></div>`;

      setMain(`
        <h2 class="section-title">My League</h2>
        <div class="league-list">${cards}</div>`);
      return;
    }

    // Superadmin: full view with create form, search, pagination, delete
    const q        = (document.getElementById('lg-search')?.value || '').toLowerCase();
    const filtered = this._all.filter(l => l.name.toLowerCase().includes(q));
    const total    = filtered.length;
    const pages    = Math.ceil(total / this._perPage) || 1;
    const page     = Math.min(this._page, pages - 1);
    const slice    = filtered.slice(page * this._perPage, (page + 1) * this._perPage);

    const cards = slice.length
      ? slice.map(l => `
          <div class="league-card">
            <div class="league-icon">🏆</div>
            <div class="league-card-info">
              <div class="league-name">${escHtml(l.name)}</div>
              <div class="text-xs text-dim">${l.coach_count} coaches · ${l.division_count} divisions</div>
            </div>
            <div class="league-card-actions">
              <button class="btn btn-sm btn-primary" onclick="Leagues.manage(${l.id})">Manage →</button>
              <button class="btn-danger" onclick="Leagues.delete(${l.id})">🗑</button>
            </div>
          </div>`).join('')
      : `<div class="empty-state"><p class="text-dim">${this._all.length ? 'No leagues match your search.' : 'No leagues yet. Create one below.'}</p></div>`;

    const pagination = pages > 1 ? `
      <div class="league-pagination">
        <button class="btn btn-sm" ${page === 0 ? 'disabled' : ''} onclick="Leagues.goPage(${page - 1})">← Prev</button>
        <span class="text-sm text-dim">Page ${page + 1} of ${pages} · ${total} leagues</span>
        <button class="btn btn-sm" ${page >= pages - 1 ? 'disabled' : ''} onclick="Leagues.goPage(${page + 1})">Next →</button>
      </div>` : total > 0 ? `<p class="text-xs text-dim mb16">${total} league${total !== 1 ? 's' : ''}</p>` : '';

    const currentSearch = document.getElementById('lg-search')?.value || '';

    setMain(`
      <h2 class="section-title">Leagues</h2>
      <div class="card mb16" style="padding:20px">
        <h3 style="margin:0 0 16px;font-size:15px;font-weight:700">Create New League</h3>
        <div class="field-group">
          <label class="field-label">League Name</label>
          <input id="lg-name" placeholder="e.g. Westside Little League" />
        </div>
        <div class="field-group">
          <label class="field-label">League Admin Name</label>
          <input id="lg-admin-name" placeholder="Admin's login name" />
        </div>
        <div class="field-group">
          <label class="field-label">League Admin Password</label>
          <input id="lg-admin-pass" type="password" placeholder="Min 6 characters" />
        </div>
        <div id="leagues-alert"></div>
        <button class="btn btn-primary" onclick="Leagues.create()">＋ Create League</button>
      </div>
      <div class="league-search-wrap mb16">
        <input id="lg-search" class="league-search-input" placeholder="Search leagues…"
          value="${escHtml(currentSearch)}"
          oninput="Leagues._page=0;Leagues.render()" />
      </div>
      <div class="league-list mb8">${cards}</div>
      ${pagination}`);

  },

  goPage(p) {
    this._page = p;
    this.render();
  },

  async create() {
    const leagueName = document.getElementById('lg-name').value.trim();
    const adminName  = document.getElementById('lg-admin-name').value.trim();
    const adminPass  = document.getElementById('lg-admin-pass').value;
    if (!leagueName || !adminName || !adminPass) return showAlert('leagues-alert', 'All fields required');
    try {
      await api('leagues', 'create', { league_name: leagueName, admin_name: adminName, admin_password: adminPass });
      this.load();
    } catch (e) { showAlert('leagues-alert', e.message); }
  },

  manage(id) {
    const l = this._all.find(x => x.id === id);
    if (l) App.enterManageMode({ id: l.id, name: l.name });
  },

  async delete(id) {
    const l = this._all.find(x => x.id === id);
    if (!l) return;
    if (!confirm(`Delete league "${l.name}"?\n\nThis will permanently delete all coaches, divisions, players, and evaluation data for this league.`)) return;
    try { await api('leagues', 'delete', { id }); this.load(); }
    catch (e) { alert(e.message); }
  }
};

// ─── SKILLS (League admin + superadmin manage mode) ───────────────────────────
const CANNED_SKILLS = ['Running', 'Fielding', 'Pitching', 'Hitting', 'Batting', 'Throwing', 'Speed', 'Catching', 'Defense', 'Offense'];

const Skills = {
  _skills: [],

  async load() {
    setMain(`<h2 class="section-title">Skills</h2><div class="spinner"></div>`);
    try {
      this._skills = await api('skills', 'list');
      LeagueSkills.invalidate();
      this.render();
    } catch (e) {
      setMain(`<h2 class="section-title">Skills</h2><div class="alert alert-error">${escHtml(e.message)}</div>`);
    }
  },

  render() {
    const existingNames = new Set(this._skills.map(s => s.name.toLowerCase()));
    const cannedBtns = CANNED_SKILLS.map(name => {
      const has = existingNames.has(name.toLowerCase());
      return `<button class="canned-skill-btn ${has ? 'canned-added' : ''}" ${has ? 'disabled' : `onclick="Skills.addCanned('${name}')"`}>${escHtml(name)}${has ? ' ✓' : ' +'}</button>`;
    }).join('');

    const skillRows = this._skills.length
      ? this._skills.map((s, i) => `
          <div class="skill-row" data-id="${s.id}">
            <div class="skill-drag-handle">
              <button class="skill-order-btn" ${i === 0 ? 'disabled' : ''} onclick="Skills.moveUp(${s.id})">↑</button>
              <button class="skill-order-btn" ${i === this._skills.length - 1 ? 'disabled' : ''} onclick="Skills.moveDown(${s.id})">↓</button>
            </div>
            <span class="skill-order-num">${i + 1}</span>
            <span class="skill-row-name">${escHtml(s.name)}</span>
            <button class="btn-danger" onclick="Skills.delete(${s.id})">🗑</button>
          </div>`).join('')
      : `<p class="text-dim">No skills yet. Add some below.</p>`;

    setMain(`
      <h2 class="section-title">Skills</h2>
      <div class="card card-pad mb16">
        <h3 class="skills-section-title">Quick Add</h3>
        <p class="text-xs text-dim mb12">Click to add a standard skill:</p>
        <div class="canned-skills-wrap">${cannedBtns}</div>
      </div>
      <div class="card card-pad mb16">
        <h3 class="skills-section-title">Custom Skill</h3>
        <div class="form-row">
          <div class="grow"><input id="skill-name" placeholder="Skill name (e.g. Arm Strength)" maxlength="50" /></div>
          <button class="btn btn-primary" onclick="Skills.addCustom()">＋ Add</button>
        </div>
        <div id="skills-alert" class="mt8"></div>
      </div>
      <div class="card card-pad">
        <p class="text-sm text-dim mb12">Skills are evaluated in the order listed. Drag the arrows to reorder.</p>
        <div id="skill-list">${skillRows}</div>
      </div>`);
  },

  async addCanned(name) {
    try {
      await api('skills', 'create', { name });
      this.load();
    } catch (e) { alert(e.message); }
  },

  async addCustom() {
    const name = document.getElementById('skill-name').value.trim();
    if (!name) return showAlert('skills-alert', 'Please enter a skill name');
    try {
      await api('skills', 'create', { name });
      this.load();
    } catch (e) { showAlert('skills-alert', e.message); }
  },

  async moveUp(id) {
    const idx = this._skills.findIndex(s => s.id === id);
    if (idx <= 0) return;
    [this._skills[idx - 1], this._skills[idx]] = [this._skills[idx], this._skills[idx - 1]];
    await this._saveOrder();
  },

  async moveDown(id) {
    const idx = this._skills.findIndex(s => s.id === id);
    if (idx < 0 || idx >= this._skills.length - 1) return;
    [this._skills[idx], this._skills[idx + 1]] = [this._skills[idx + 1], this._skills[idx]];
    await this._saveOrder();
  },

  async _saveOrder() {
    try {
      await api('skills', 'reorder', { ids: this._skills.map(s => s.id) });
      LeagueSkills.invalidate();
      this.render();
    } catch (e) { alert(e.message); }
  },

  async delete(id) {
    const skill = this._skills.find(s => s.id === id);
    const name = skill ? skill.name : 'this skill';
    if (!confirm(`Remove skill "${name}"?\n\nThis won't delete existing evaluation scores for this skill.`)) return;
    try {
      await api('skills', 'delete', { id });
      this.load();
    } catch (e) { alert(e.message); }
  }
};

// ─── DIVISIONS ────────────────────────────────────────────────────────────────
const Divisions = {
  async load() {
    setMain(`<h2 class="section-title">Divisions</h2><div class="spinner"></div>`);
    const divs = await api('divisions', 'list');
    this.render(divs);
  },

  render(divs) {
    const cards = divs.length
      ? divs.map(d => `
          <div class="div-card" onclick="Divisions.goToPlayers(${d.id})" style="cursor:pointer">
            <span class="diamond">◇</span>
            <span style="flex:1">${escHtml(d.name)}</span>
            <span class="text-dim text-sm">${d.player_count} players</span>
            <button class="btn-danger" onclick="event.stopPropagation();Divisions.delete(${d.id})">🗑</button>
          </div>`).join('')
      : `<p class="text-dim">No divisions yet.</p>`;

    setMain(`
      <h2 class="section-title">Divisions</h2>
      <div class="form-row mb16">
        <div class="grow"><input id="div-name" placeholder="Division name (e.g. Majors, AAA)" /></div>
        <button class="btn btn-primary" onclick="Divisions.add()">＋ Add</button>
        <button class="btn btn-demo" onclick="Demo.seedDivisions()">⚡ Demo Data</button>
      </div>
      <div id="div-alert"></div>
      <div class="card-grid">${cards}</div>`);
  },

  async add() {
    const name = document.getElementById('div-name').value.trim();
    if (!name) return;
    try {
      await api('divisions', 'create', { name });
      this.load();
    } catch (e) { showAlert('div-alert', e.message); }
  },

  goToPlayers(divisionId) {
    Players.filterDiv = divisionId;
    App.switchTab('players');
  },

  async delete(id) {
    if (!confirm('Delete this division? Players will be unassigned.')) return;
    try { await api('divisions', 'delete', { id }); this.load(); }
    catch (e) { alert(e.message); }
  }
};

// ─── PLAYERS ──────────────────────────────────────────────────────────────────
const Players = {
  divisions: [],
  filterDiv: 'all',
  showImport: false,

  async load() {
    setMain(`<h2 class="section-title">Players</h2><div class="spinner"></div>`);
    this.divisions = await api('divisions', 'list');
    const players  = await api('players', 'list');
    this.render(players);
  },

  render(players) {
    const divOpts = this.divisions.map(d => `<option value="${d.id}">${escHtml(d.name)}</option>`).join('');
    const filterBtns = [['all','All'], ...this.divisions.map(d => [d.id, d.name])]
      .map(([id, label]) => `<button class="filter-pill ${this.filterDiv == id ? 'active':''}" onclick="Players.filter('${id}')">${escHtml(label)}</button>`)
      .join('');

    const filtered = this.filterDiv === 'all' ? players : players.filter(p => p.division_id == this.filterDiv);
    const rows = filtered.length
      ? filtered.map((p, i) => `
          <tr id="player-row-${p.id}">
            <td>${escHtml(p.name)}</td>
            <td>${p.age || '—'}</td>
            <td>${p.position !== 'Player' ? `<span class="pos-badge ${posBadgeClass(p.position)}">${escHtml(p.position)}</span>` : ''}</td>
            <td>${escHtml(p.division_name || '—')}</td>
            <td style="white-space:nowrap">
              <button class="btn-edit" onclick="Players.startEdit(${p.id})">✎ Edit</button>
              <button class="btn-danger" onclick="Players.delete(${p.id})">🗑</button>
            </td>
          </tr>
          <tr id="player-edit-${p.id}" class="hidden">
            <td><input id="pe-name-${p.id}" value="${escHtml(p.name)}" style="width:100%" /></td>
            <td><input id="pe-age-${p.id}" type="number" value="${p.age || ''}" min="1" max="99" style="width:60px" /></td>
            <td>
              <div class="pos-checks">
                <label><input type="checkbox" id="pe-pitcher-${p.id}" ${p.is_pitcher==1?'checked':''}> Pitcher</label>
                <label><input type="checkbox" id="pe-catcher-${p.id}" ${p.is_catcher==1?'checked':''}> Catcher</label>
              </div>
            </td>
            <td>
              <select id="pe-div-${p.id}">
                <option value="">-- None --</option>
                ${divOpts.replace(`value="${p.division_id}"`, `value="${p.division_id}" selected`)}
              </select>
            </td>
            <td style="white-space:nowrap">
              <button class="btn btn-primary" style="padding:4px 10px;font-size:12px" onclick="Players.saveEdit(${p.id})">Save</button>
              <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px" onclick="Players.cancelEdit(${p.id})">Cancel</button>
            </td>
          </tr>`).join('')
      : `<tr class="empty-row"><td colspan="5">No players found.</td></tr>`;

    setMain(`
      <h2 class="section-title">Players</h2>
      <div class="card card-pad mb16">
        <p class="text-muted text-sm mb12" style="text-transform:uppercase;letter-spacing:.1em">Add Player</p>
        <div class="form-row">
          <div class="grow"><input id="p-name" placeholder="Player name" /></div>
          <div class="shrink"><input id="p-age" type="number" placeholder="Age" min="1" max="99" /></div>
          <div class="pos-checks">
            <label><input type="checkbox" id="p-pitcher"> Pitcher</label>
            <label><input type="checkbox" id="p-catcher"> Catcher</label>
          </div>
          <div class="med">
            <select id="p-div"><option value="">-- Division --</option>${divOpts}</select>
          </div>
          <button class="btn btn-primary" onclick="Players.add()">＋ Add</button>
          <button class="btn btn-secondary" onclick="Players.toggleImport()">↑ Import CSV</button>
          <button class="btn btn-demo" onclick="Demo.seedPlayers()">⚡ Demo Data</button>
        </div>
      </div>

      <div id="import-panel" class="${this.showImport ? '' : 'hidden'} import-box mb16">
        <p class="text-muted text-sm mb12">
          One player per line: <span class="code-hint">Name, Age, Position, Division</span><br>
          Position: Pitcher / Catcher / Pitcher/Catcher (or blank) &nbsp;|&nbsp; Division must match exactly.
        </p>
        <div class="field-group">
          <label class="field-label">Default Division (used if not specified in CSV)</label>
          <select id="import-div-default" style="max-width:300px">
            <option value="">-- None --</option>${divOpts}
          </select>
        </div>
        <textarea id="import-text" style="min-height:120px;font-family:monospace" placeholder="John Smith, 12, Pitcher, Majors&#10;Jane Doe, 11, Player, AAA"></textarea>
        <div class="form-row mt12">
          <button class="btn btn-primary" onclick="Players.importCSV()">Import Players</button>
          <button class="btn btn-secondary" onclick="Players.toggleImport()">Cancel</button>
        </div>
      </div>

      <div id="players-alert"></div>
      <div class="filter-bar">${filterBtns}</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Age</th><th>Position</th><th>Division</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`);
  },

  filter(divId) {
    this.filterDiv = divId;
    this.load();
  },

  toggleImport() {
    this.showImport = !this.showImport;
    document.getElementById('import-panel')?.classList.toggle('hidden', !this.showImport);
  },

  async add() {
    const name      = document.getElementById('p-name').value.trim();
    const age       = document.getElementById('p-age').value;
    const isPitcher = document.getElementById('p-pitcher').checked ? 1 : 0;
    const isCatcher = document.getElementById('p-catcher').checked ? 1 : 0;
    const div       = document.getElementById('p-div').value;
    if (!name) return showAlert('players-alert', 'Player name is required');
    if (!div)  return showAlert('players-alert', 'Please select a division');
    try {
      await api('players', 'create', { name, age, is_pitcher: isPitcher, is_catcher: isCatcher, division_id: div || null });
      this.load();
    } catch (e) { showAlert('players-alert', e.message); }
  },

  async importCSV() {
    const text   = document.getElementById('import-text').value.trim();
    const defDiv = document.getElementById('import-div-default').value;
    if (!text) return;

    const lines   = text.split('\n').filter(l => l.trim());
    const players = [];

    // Resolve division names
    const divMap = {};
    this.divisions.forEach(d => { divMap[d.name.toLowerCase()] = d.id; });

    lines.forEach(line => {
      const parts = line.split(',').map(s => s.trim());
      const [name, age, position, divName] = parts;
      if (!name) return;
      const pos = (position || '').toLowerCase();
      const isPitcher = pos.includes('pitcher') ? 1 : 0;
      const isCatcher = pos.includes('catcher') ? 1 : 0;
      const divId = divName ? (divMap[divName.toLowerCase()] || defDiv || null) : (defDiv || null);
      players.push({ name, age: age || '', is_pitcher: isPitcher, is_catcher: isCatcher, division_id: divId });
    });

    if (!players.length) return showAlert('players-alert', 'No valid rows found');
    try {
      const res = await api('players', 'import', { players, default_division_id: defDiv || null });
      showAlert('players-alert', `Imported ${res.imported} players`, 'success');
      this.showImport = false;
      this.load();
    } catch (e) { showAlert('players-alert', e.message); }
  },

  startEdit(id) {
    document.getElementById(`player-row-${id}`)?.classList.add('hidden');
    document.getElementById(`player-edit-${id}`)?.classList.remove('hidden');
  },

  cancelEdit(id) {
    document.getElementById(`player-edit-${id}`)?.classList.add('hidden');
    document.getElementById(`player-row-${id}`)?.classList.remove('hidden');
  },

  async saveEdit(id) {
    const name      = document.getElementById(`pe-name-${id}`)?.value.trim();
    const age       = document.getElementById(`pe-age-${id}`)?.value;
    const isPitcher = document.getElementById(`pe-pitcher-${id}`)?.checked ? 1 : 0;
    const isCatcher = document.getElementById(`pe-catcher-${id}`)?.checked ? 1 : 0;
    const divId     = document.getElementById(`pe-div-${id}`)?.value;
    if (!name) return showAlert('players-alert', 'Player name is required');
    try {
      await api('players', 'update', { id, name, age, is_pitcher: isPitcher, is_catcher: isCatcher, division_id: divId || null });
      this.load();
    } catch (e) { showAlert('players-alert', e.message); }
  },

  async delete(id) {
    if (!confirm('Remove this player?')) return;
    try { await api('players', 'delete', { id }); this.load(); }
    catch (e) { alert(e.message); }
  }
};

// ─── COACHES ──────────────────────────────────────────────────────────────────
const Coaches = {
  async load() {
    setMain(`<h2 class="section-title">Coaches</h2><div class="spinner"></div>`);
    const coaches = await api('coaches', 'list');
    this._all = coaches;
    this.render(coaches);
  },

  render(coaches) {
    const isSuperAdmin = App.user.is_admin && App.user.league_id === null;
    const rows = coaches.length
      ? coaches.map(c => {
          const isSelf = c.id === App.user.id;
          const isSuperAdminTarget = c.league_id === null;
          const canToggleAdmin = !isSelf && !isSuperAdminTarget;
          const adminToggleBtn = canToggleAdmin
            ? `<button class="btn-edit" onclick="Coaches.toggleAdmin(${c.id},${c.is_admin ? 0 : 1})">${c.is_admin ? '⬇ Demote' : '⬆ Make Admin'}</button>`
            : '';
          return `<tr>
            <td>${isSuperAdminTarget ? '⭐' : c.is_admin ? '🛡' : '👤'}</td>
            <td>${escHtml(c.name)}</td>
            <td>${isSuperAdminTarget ? 'Superadmin' : c.is_admin ? 'Administrator' : 'Coach'}</td>
            ${isSuperAdmin ? `<td class="text-dim">${escHtml(c.league_name || '—')}</td>` : ''}
            <td style="white-space:nowrap">
              ${adminToggleBtn}
              <button class="btn-edit" onclick="Coaches.showResetModal(${c.id})">🔑 Reset</button>
              ${!c.is_admin && !isSuperAdminTarget ? `<button class="btn-danger" onclick="Coaches.delete(${c.id})">🗑</button>` : ''}
            </td>
          </tr>`;
        }).join('')
      : `<tr class="empty-row"><td colspan="${isSuperAdmin ? 5 : 4}">No coaches yet.</td></tr>`;

    setMain(`
      <h2 class="section-title">Coaches</h2>
      <div class="card card-pad mb16">
        <p class="text-muted text-sm mb12" style="text-transform:uppercase;letter-spacing:.1em">Add Coach</p>
        <div class="form-row">
          <div class="grow"><input id="c-name" placeholder="Coach name" /></div>
          <div class="med"><input id="c-pass" type="password" placeholder="Password" /></div>
          <button class="btn btn-primary" onclick="Coaches.add()">＋ Add Coach</button>
          <button class="btn btn-demo" onclick="Demo.seedCoaches()">⚡ Demo Data</button>
        </div>
      </div>
      <div id="coaches-alert" class="mb8"></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th></th>
            <th>Name</th>
            <th>Role</th>
            ${isSuperAdmin ? '<th>League</th>' : ''}
            <th>Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div id="reset-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)Coaches.closeResetModal()">
        <div class="modal-box">
          <h3 class="modal-title">Reset Password</h3>
          <p id="reset-modal-name" class="text-sm text-dim mb12"></p>
          <input id="reset-new-pass" type="password" placeholder="New password (min 6 chars)" class="mb8" />
          <input id="reset-confirm-pass" type="password" placeholder="Confirm new password" class="mb12" />
          <div id="reset-modal-alert" class="mb8"></div>
          <div class="form-row">
            <button class="btn btn-primary grow" onclick="Coaches.confirmReset()">Reset Password</button>
            <button class="btn btn-secondary" onclick="Coaches.closeResetModal()">Cancel</button>
          </div>
        </div>
      </div>`);
  },

  _resetId: null,
  _all: [],

  showResetModal(id) {
    const coach = this._all.find(c => c.id === id);
    this._resetId = id;
    document.getElementById('reset-modal-name').textContent = coach ? coach.name : '';
    document.getElementById('reset-new-pass').value = '';
    document.getElementById('reset-confirm-pass').value = '';
    document.getElementById('reset-modal-alert').innerHTML = '';
    document.getElementById('reset-modal').style.display = 'flex';
    document.getElementById('reset-new-pass').focus();
  },

  closeResetModal() {
    document.getElementById('reset-modal').style.display = 'none';
    this._resetId = null;
  },

  async confirmReset() {
    const newPass     = document.getElementById('reset-new-pass').value;
    const confirmPass = document.getElementById('reset-confirm-pass').value;
    const alertEl     = document.getElementById('reset-modal-alert');
    if (newPass.length < 6)        return showAlert('reset-modal-alert', 'Password must be at least 6 characters');
    if (newPass !== confirmPass)   return showAlert('reset-modal-alert', 'Passwords do not match');
    try {
      await api('coaches', 'reset_password', { id: this._resetId, new_password: newPass });
      this.closeResetModal();
      showAlert('coaches-alert', 'Password reset successfully', 'success');
    } catch (e) { showAlert('reset-modal-alert', e.message); }
  },

  async add() {
    const name = document.getElementById('c-name').value.trim();
    const pass = document.getElementById('c-pass').value;
    if (!name || !pass) return showAlert('coaches-alert', 'Name and password required');
    try {
      await api('coaches', 'create', { name, password: pass });
      this.load();
    } catch (e) { showAlert('coaches-alert', e.message); }
  },

  async toggleAdmin(id, makeAdmin) {
    const coach = this._all.find(c => c.id === id);
    const action = makeAdmin ? 'make admin' : 'remove admin for';
    if (!confirm(`${makeAdmin ? 'Promote' : 'Demote'} ${coach?.name ?? 'this coach'}${makeAdmin ? ' to Administrator' : ' to Coach'}?`)) return;
    try {
      await api('coaches', 'set_admin', { id, is_admin: makeAdmin });
      this.load();
    } catch (e) { alert(e.message); }
  },

  async delete(id) {
    if (!confirm('Remove this coach?')) return;
    try { await api('coaches', 'delete', { id }); this.load(); }
    catch (e) { alert(e.message); }
  }
};

// ─── EVALUATE (Admin) ─────────────────────────────────────────────────────────
const Evaluate = {
  session: null,
  players: [],
  progress: [],
  skills: [],

  async load() {
    setMain(`<h2 class="section-title">Evaluation Session</h2><div class="spinner"></div>`);
    try {
      const [session, divisions] = await Promise.all([
        api('sessions', 'active').catch(() => null),
        api('divisions', 'list')
      ]);
      this.session = session;
      this.divisions = divisions;
      if (session) {
        this.players = await api('players', 'list').then(all => all.filter(p => p.division_id == session.division_id));
        this.progress = await fetch(`api/sessions.php?action=progress&session_id=${session.id}`).then(r => r.json());
        this.skills  = await LeagueSkills.get();
        this.renderActive();
        App.pollTimer = setInterval(() => this.refresh(), 5000);
      } else {
        this.renderSetup();
      }
    } catch (e) {
      setMain(`<div class="alert alert-error">${escHtml(e.message)}</div>`);
    }
  },

  async refresh() {
    if (App.currentTab !== 'evaluate') return;
    const [session, progress] = await Promise.all([
      api('sessions', 'active').catch(() => null),
      this.session ? fetch(`api/sessions.php?action=progress&session_id=${this.session.id}`).then(r => r.json()) : Promise.resolve([])
    ]);
    this.session  = session;
    this.progress = progress || [];
    if (session) { this.renderActive(); }
    else { clearInterval(App.pollTimer); this.renderSetup(); }
  },

  renderSetup() {
    const opts = this.divisions.map(d => `<option value="${d.id}">${escHtml(d.name)} (${d.player_count} players)</option>`).join('');
    setMain(`
      <h2 class="section-title">Evaluation Session</h2>
      <div class="card card-pad" style="max-width:460px">
        <p class="text-muted text-sm mb16">Start a session for a division. Coaches will score each player on all configured skills.</p>
        <div class="field-group">
          <label class="field-label">Select Division</label>
          <select id="eval-div"><option value="">-- Choose Division --</option>${opts}</select>
        </div>
        <div id="eval-alert"></div>
        <button class="btn btn-primary mt12" onclick="Evaluate.start()">▶ Start Evaluation Session</button>
      </div>`);
  },

  async start() {
    const divId = document.getElementById('eval-div').value;
    if (!divId) return showAlert('eval-alert', 'Please select a division');
    try {
      await api('sessions', 'start', { division_id: divId });
      this.load();
    } catch (e) { showAlert('eval-alert', e.message); }
  },

  renderActive() {
    const s = this.session;

    // Build progress map: player_id -> skill_index -> avg score
    const pmap = {};
    (this.progress || []).forEach(row => {
      if (!pmap[row.player_id]) pmap[row.player_id] = {};
      pmap[row.player_id][row.skill_index] = parseFloat(row.avg_score).toFixed(1);
    });

    const rows = this.players.map(p => {
      const cells = this.skills.map((sk, si) => {
        const sc = pmap[p.id]?.[si];
        return `<td class="center">${sc ? `<span class="score-val ${scoreClass(sc)}">${sc}</span>` : '<span class="score-none">—</span>'}</td>`;
      }).join('');
      return `<tr><td><span style="color:var(--blue);font-size:12px;font-weight:700">#${playerNumber(p.id)}</span> ${escHtml(p.name)}</td>${cells}</tr>`;
    }).join('');

    const skillHeaders = this.skills.map(sk => `<th class="center">${sk}</th>`).join('');

    setMain(`
      <h2 class="section-title">Evaluation Session</h2>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
        <div class="session-banner" style="flex:1;margin-bottom:0">
          <p class="session-title">🟢 Active — ${escHtml(s.division_name)}</p>
          <p class="session-sub">Coaches can score any skill freely</p>
        </div>
        <button class="btn" style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);white-space:nowrap" onclick="Evaluate.end()">■ End Session</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Player</th>${skillHeaders}</tr></thead>
          <tbody>${rows || '<tr class="empty-row"><td colspan="5">No players in this division.</td></tr>'}</tbody>
        </table>
      </div>`);
  },

  async end() {
    if (!confirm('End the current evaluation session?')) return;
    clearInterval(App.pollTimer);
    await api('sessions', 'end');
    this.session = null;
    this.load();
  }
};

// ─── EVALUATE (Coach view) ────────────────────────────────────────────────────
const CoachEvaluate = {
  session: null,
  players: [],
  allScores: {},           // { skillIndex: { playerId: score } }
  scoredSet: new Set(),    // player IDs scored for selectedSkillIndex
  localPlayerIndex: 0,
  selectedScore: null,
  selectedSkillIndex: 0,   // which skill the coach is currently scoring
  mode: 'evaluate',        // 'evaluate' | 'list' | 'score'
  viewSkillIndex: 0,
  editPlayerIndex: 0,
  skills: [],

  async load() {
    setMain(`<div class="no-session"><div class="big-icon">⚾</div><p class="text-muted">Loading…</p></div>`);

    let session, players, allScoresRaw;

    if (navigator.onLine) {
      session = await api('sessions', 'active').catch(() => null);
      if (session) {
        players      = await fetch(`api/players.php?action=list&division_id=${session.division_id}`).then(r => r.json());
        allScoresRaw = await fetch(`api/evaluations.php?action=my_all_scores&session_id=${session.id}`).then(r => r.json());
        // Cache for offline use
        await OfflineDB.kvSet('session', session);
        await OfflineDB.kvSet('players', players);
        await OfflineDB.kvSet('scores',  allScoresRaw);
      }
    } else {
      session      = await OfflineDB.kvGet('session');
      players      = await OfflineDB.kvGet('players') || [];
      allScoresRaw = await OfflineDB.kvGet('scores')  || [];
    }

    this.session = session;
    if (!session) { this.renderNoSession(); return; }
    if (!players.length) { this.renderNoSession(); return; }

    this.players = players;
    this.skills  = await LeagueSkills.get();

    // Build allScores from cached raw rows + anything in the local queue
    this.allScores = {};
    (allScoresRaw || []).forEach(r => {
      const si = parseInt(r.skill_index), pid = parseInt(r.player_id);
      if (!this.allScores[si]) this.allScores[si] = {};
      this.allScores[si][pid] = parseInt(r.score);
    });

    // Merge local queue into allScores so UI reflects pending scores
    const queue = await OfflineDB.getQueue();
    queue.filter(q => q.session_id === session.id).forEach(q => {
      if (!this.allScores[q.skill_index]) this.allScores[q.skill_index] = {};
      this.allScores[q.skill_index][q.player_id] = q.score;
    });

    this.selectedSkillIndex = 0;
    this.buildScoredSet();
    this.localPlayerIndex = this.firstUnscoredIndex();
    this.selectedScore = null;
    this.mode = 'evaluate';
    this.render();

    if (navigator.onLine) {
      App.pollTimer = setInterval(() => this.poll(), 4000);
    }

    await Sync.refreshUI();
  },

  buildScoredSet() {
    this.scoredSet = new Set(Object.keys(this.allScores[this.selectedSkillIndex] || {}).map(Number));
  },

  switchSkill(si) {
    this.selectedSkillIndex = si;
    this.viewSkillIndex = si;
    this.buildScoredSet();
    this.localPlayerIndex = this.firstUnscoredIndex();
    this.selectedScore = null;
    this.mode = 'evaluate';
    this.render();
  },

  firstUnscoredIndex() {
    for (let i = 0; i < this.players.length; i++) {
      if (!this.scoredSet.has(this.players[i].id)) return i;
    }
    return this.players.length;
  },

  prevPlayer() {
    if (this.localPlayerIndex > 0) {
      this.localPlayerIndex--;
      const pid = this.players[this.localPlayerIndex].id;
      this.selectedScore = this.allScores[this.session.current_skill_index]?.[pid] ?? null;
      this.render();
    }
  },

  nextPlayer() {
    if (this.localPlayerIndex < this.players.length - 1) {
      this.localPlayerIndex++;
      const pid = this.players[this.localPlayerIndex].id;
      this.selectedScore = this.allScores[this.session.current_skill_index]?.[pid] ?? null;
      this.render();
    }
  },

  async poll() {
    if (App.currentTab !== 'evaluate' || !navigator.onLine) return;
    const session = await api('sessions', 'active').catch(() => null);
    if (!session) { clearInterval(App.pollTimer); this.renderNoSession(); return; }
    this.session = session;
  },

  // ── Skill progress bar — all skills clickable ──
  skillStepsHtml() {
    return this.skills.map((sk, i) => {
      const allDone = this.players.length > 0 && this.players.every(p => this.allScores[i]?.[p.id] !== undefined);
      const active  = i === this.selectedSkillIndex;
      const state   = allDone ? 'done' : active ? 'current' : 'upcoming';
      return `<div class="skill-step ${state} clickable" onclick="CoachEvaluate.switchSkill(${i})">
        ${allDone ? '✓' : sk}
      </div>`;
    }).join('');
  },

  viewSkill(si) {
    this.mode = 'list';
    this.viewSkillIndex = si;
    this.selectedScore = null;
    this.render();
  },

  backToEvaluate() {
    this.mode = 'evaluate';
    this.selectedScore = null;
    this.render();
  },

  backToList() {
    this.mode = 'list';
    this.selectedScore = null;
    this.render();
  },

  editPlayer(playerIndex, skillIndex) {
    this.mode = 'score';
    this.editPlayerIndex = playerIndex;
    this.viewSkillIndex = skillIndex;
    const pid = this.players[playerIndex].id;
    this.selectedScore = this.allScores[skillIndex]?.[pid] ?? null;
    this.render();
  },

  // ── Main render router ──
  render() {
    if (!this.session) { this.renderNoSession(); return; }
    if (this.mode === 'list')  { this.renderList(); return; }
    if (this.mode === 'score') { this.renderScore(); return; }
    if (this.localPlayerIndex >= this.players.length) { this.renderSkillDone(); return; }
    this.renderEvaluate();
  },

  // ── Jump-to-player search ──
  filterPlayers(q) {
    const drop = document.getElementById('player-search-drop');
    if (!drop) return;
    q = q.trim().toLowerCase();
    if (!q) { drop.innerHTML = ''; drop.hidden = true; return; }
    const matches = this.players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) =>
        p.name.toLowerCase().includes(q) ||
        playerNumber(p.id).includes(q)
      )
      .slice(0, 8);
    if (!matches.length) { drop.innerHTML = '<div class="psr-empty">No match</div>'; drop.hidden = false; return; }
    drop.innerHTML = matches.map(({ p, i }) => {
      const scored = this.scoredSet.has(p.id);
      return `<button class="psr-item" onmousedown="CoachEvaluate.jumpToPlayer(${i})">
        <span class="psr-num">#${playerNumber(p.id)}</span>
        <span class="psr-name">${escHtml(p.name)}</span>
        ${scored ? '<span class="psr-check">✓</span>' : ''}
      </button>`;
    }).join('');
    drop.hidden = false;
  },

  jumpToPlayer(i) {
    this.localPlayerIndex = i;
    const pid = this.players[i].id;
    this.selectedScore = this.allScores[this.session.current_skill_index]?.[pid] ?? null;
    this.mode = 'evaluate';
    this.render();
  },

  // ── Evaluate: score next unscored player ──
  renderEvaluate() {
    const s = this.session;
    const player = this.players[this.localPlayerIndex];
    const skill  = this.skills[this.selectedSkillIndex];
    const remaining = this.players.length - this.scoredSet.size;
    const num    = playerNumber(player.id);
    const isScored = this.scoredSet.has(player.id);
    const atFirst = this.localPlayerIndex === 0;
    const atLast  = this.localPlayerIndex === this.players.length - 1;

    const scoreButtons = [1,2,3,4,5,6,7,8,9,10].map(n => {
      const sel = this.selectedScore === n;
      return `<button class="score-btn ${sel ? 'selected-'+n : ''}" onclick="CoachEvaluate.selectScore(${n})">${n}</button>`;
    }).join('');

    setMain(`
      <div class="eval-screen">
        <div class="skill-progress">${this.skillStepsHtml()}</div>
        ${!navigator.onLine ? '<div class="offline-notice">Offline — scores saving locally</div>' : ''}
        <div class="player-search-wrap">
          <span class="psr-icon">🔍</span>
          <input class="player-search-input" id="player-search-input" type="search"
            placeholder="Jump to player…" autocomplete="off" autocorrect="off"
            oninput="CoachEvaluate.filterPlayers(this.value)"
            onblur="setTimeout(()=>{const d=document.getElementById('player-search-drop');if(d)d.hidden=true;},150)" />
          <div class="player-search-drop" id="player-search-drop" hidden></div>
        </div>
        <div class="player-card">
          <div class="player-number">#${num}</div>
          <div class="player-name">${escHtml(player.name)}</div>
          <p class="player-sub">${player.position !== 'Player' ? escHtml(player.position) : ''}${player.age ? `${player.position !== 'Player' ? ' • ' : ''}Age ${player.age}` : ''}</p>
          <div class="player-nav">
            <button class="player-nav-btn" onclick="CoachEvaluate.prevPlayer()" ${atFirst ? 'disabled' : ''}>‹</button>
            <span class="player-nav-info">
              ${this.localPlayerIndex + 1} of ${this.players.length}
              ${isScored ? '<br><span class="player-nav-scored">✓ scored</span>' : ''}
            </span>
            <button class="player-nav-btn" onclick="CoachEvaluate.nextPlayer()" ${atLast ? 'disabled' : ''}>›</button>
          </div>
          <p class="player-count">${remaining} remaining</p>
          <div><span class="skill-label">${skill.toUpperCase()}</span></div>
        </div>
        <div class="card card-pad">
          <p class="text-muted text-sm mb16" style="text-align:center;text-transform:uppercase;letter-spacing:.1em">Tap to score: ${skill}</p>
          <div class="score-grid">${scoreButtons}</div>
        </div>
      </div>`);
  },

  // ── List: all players for a skill with their scores ──
  renderList() {
    const si = this.viewSkillIndex;
    const skill = this.skills[si];

    const tabs = this.skills.map((sk, i) => {
      const allDone = this.players.every(p => this.allScores[i]?.[p.id] !== undefined);
      const active = i === si;
      return `<button class="skill-tab${active ? ' active' : ''}" onclick="CoachEvaluate.viewSkill(${i})">${allDone ? '✓ ' : ''}${sk}</button>`;
    }).join('');

    const rows = this.players.map((p, pi) => {
      const score = this.allScores[si]?.[p.id];
      const num = playerNumber(p.id);
      return `<div class="review-row" onclick="CoachEvaluate.editPlayer(${pi}, ${si})">
        <span class="review-number">#${num}</span>
        <span class="review-name">${escHtml(p.name)}${p.position !== 'Player' ? `<span class="review-pos">${escHtml(p.position)}</span>` : ''}</span>
        <span class="review-score ${score != null ? scoreClass(score) : 'score-none'}">${score != null ? score : '—'}</span>
        <span class="review-chevron">›</span>
      </div>`;
    }).join('');

    setMain(`
      <div class="skill-tabs">${tabs}</div>
      <button class="btn btn-primary mb16" style="width:100%" onclick="CoachEvaluate.switchSkill(${si})">← Score ${escHtml(skill)}</button>
      <div class="review-list">${rows}</div>`);
  },

  // ── Score: re-score a specific player/skill ──
  renderScore() {
    const p  = this.players[this.editPlayerIndex];
    const si = this.viewSkillIndex;
    const skill = this.skills[si];
    const num = playerNumber(p.id);
    const existing = this.allScores[si]?.[p.id];

    const total = this.players.length;
    const pos   = this.editPlayerIndex + 1;

    const scoreButtons = [1,2,3,4,5,6,7,8,9,10].map(n => {
      const sel = this.selectedScore === n;
      return `<button class="score-btn ${sel ? 'selected-'+n : ''}" onclick="CoachEvaluate.selectAndEdit(${n})">${n}</button>`;
    }).join('');

    setMain(`
      <button class="btn btn-secondary mb16" onclick="CoachEvaluate.backToList()">← ${skill} List</button>
      <div class="player-card">
        <div class="player-number">#${num}</div>
        <div class="player-name">${escHtml(p.name)}</div>
        <p class="player-sub">${p.position !== 'Player' ? escHtml(p.position) : ''}${p.age ? `${p.position !== 'Player' ? ' • ' : ''}Age ${p.age}` : ''}</p>
        <p class="player-count">${pos} of ${total}</p>
        <div><span class="skill-label">${skill.toUpperCase()}</span></div>
        ${existing != null
          ? `<p class="player-count" style="margin-top:10px">Current score: <strong class="${scoreClass(existing)}" style="font-size:17px">${existing}/10</strong></p>`
          : ''}
      </div>
      <div class="card card-pad">
        <p class="text-muted text-sm mb16" style="text-align:center;text-transform:uppercase;letter-spacing:.1em">Tap to score: ${skill}</p>
        <div class="score-grid">${scoreButtons}</div>
      </div>`);
  },

  renderSkillDone() {
    const skill = this.skills[this.selectedSkillIndex];
    const allComplete = this.skills.every((_, i) =>
      this.players.every(p => this.allScores[i]?.[p.id] !== undefined)
    );
    const nextUndone = this.skills.findIndex((_, i) =>
      i !== this.selectedSkillIndex && this.players.some(p => this.allScores[i]?.[p.id] === undefined)
    );

    setMain(`
      <div class="eval-screen">
        <div class="skill-progress">${this.skillStepsHtml()}</div>
        <div class="skill-done-card" style="flex:1;display:flex;flex-direction:column;justify-content:center">
          <div class="skill-done-icon">✅</div>
          <h2 class="skill-done-title">${escHtml(skill)} Complete</h2>
          <p class="skill-done-sub">All ${this.players.length} players scored.</p>
          ${allComplete
            ? `<p class="skill-done-next" style="color:var(--green)">🏆 All skills complete!</p>`
            : nextUndone >= 0
              ? `<p class="skill-done-next">Tap <strong>${escHtml(this.skills[nextUndone])}</strong> above to continue.</p>`
              : ''}
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px">
            <button class="btn btn-secondary" onclick="CoachEvaluate.viewSkill(${this.selectedSkillIndex})">Review ${escHtml(skill)}</button>
            ${nextUndone >= 0 ? `<button class="btn btn-primary" onclick="CoachEvaluate.switchSkill(${nextUndone})">Score ${escHtml(this.skills[nextUndone])} →</button>` : ''}
          </div>
        </div>
      </div>`);
  },

  renderNoSession() {
    setMain(`
      <div class="no-session">
        <div class="big-icon">⚾</div>
        <h2 style="color:var(--dim)">No active evaluation session</h2>
        <p class="text-muted mt8">Wait for the administrator to start a session.</p>
      </div>`);
  },

  renderComplete() {
    setMain(`
      <div class="no-session">
        <div class="big-icon">🏆</div>
        <h2 style="color:var(--blue)">All Skills Complete!</h2>
        <p class="text-muted mt8">You've scored all players on every skill. Check the Results tab.</p>
        <div class="skill-progress mt16" style="max-width:320px;margin-left:auto;margin-right:auto">${this.skillStepsHtml()}</div>
      </div>`);
  },

  selectScore(n) {
    this.selectedScore = n;
    this.submit();
  },

  // Submit score for current unscored player in evaluate mode
  async submit() {
    const s  = this.session;
    const p  = this.players[this.localPlayerIndex];
    const si = this.selectedSkillIndex;
    if (!p || !this.selectedScore) return;

    const payload = { session_id: s.id, player_id: p.id, skill_index: si, score: this.selectedScore };

    if (navigator.onLine) {
      try {
        await api('evaluations', 'submit', payload);
      } catch {
        await OfflineDB.enqueue(payload);
        await Sync.registerBgSync();
      }
    } else {
      await OfflineDB.enqueue(payload);
      await Sync.registerBgSync();
    }

    if (!this.allScores[si]) this.allScores[si] = {};
    this.allScores[si][p.id] = this.selectedScore;
    this.scoredSet.add(p.id);
    this.selectedScore = null;
    this.localPlayerIndex = this.firstUnscoredIndex();

    // Update cached scores
    await OfflineDB.kvSet('scores', Object.entries(this.allScores).flatMap(([si, players]) =>
      Object.entries(players).map(([pid, score]) => ({ skill_index: si, player_id: pid, score }))
    ));

    this.render();
    await Sync.refreshUI();
  },

  // Submit updated score from review/score mode
  selectAndEdit(n) {
    this.selectedScore = n;
    this.submitEdit();
  },

  async submitEdit() {
    const s  = this.session;
    const p  = this.players[this.editPlayerIndex];
    const si = this.viewSkillIndex;
    if (!p || !this.selectedScore) return;
    try {
      if (navigator.onLine) {
        await api('evaluations', 'submit', {
          session_id: s.id, player_id: p.id, skill_index: si, score: this.selectedScore
        });
      } else {
        await OfflineDB.enqueue({ session_id: s.id, player_id: p.id, skill_index: si, score: this.selectedScore });
        await Sync.registerBgSync();
      }
    } catch {
      await OfflineDB.enqueue({ session_id: s.id, player_id: p.id, skill_index: si, score: this.selectedScore });
      await Sync.registerBgSync();
    }
    if (!this.allScores[si]) this.allScores[si] = {};
    this.allScores[si][p.id] = this.selectedScore;
    if (si === this.selectedSkillIndex) {
      this.scoredSet.add(p.id);
      this.localPlayerIndex = this.firstUnscoredIndex();
    }
    this.selectedScore = null;
    const next = this.editPlayerIndex + 1;
    if (next < this.players.length) {
      this.editPlayerIndex = next;
      this.selectedScore = this.allScores[si]?.[this.players[next].id] ?? null;
      this.render();
    } else {
      this.mode = 'list';
      this.render();
    }
    await Sync.refreshUI();
  }
};

// ─── RESULTS ──────────────────────────────────────────────────────────────────
const Results = {
  divisions: [],
  filterDiv: 'all',
  isAdmin: false,
  skills: [],

  async load() {
    this.isAdmin = App.user.is_admin;
    setMain(`<h2 class="section-title">${this.isAdmin ? 'All Results' : 'My Evaluations'}</h2><div class="spinner"></div>`);
    try {
      [this.divisions, this.skills] = await Promise.all([
        api('divisions', 'list'),
        LeagueSkills.get()
      ]);
      await this.render();
    } catch (e) {
      setMain(`<h2 class="section-title">${this.isAdmin ? 'All Results' : 'My Evaluations'}</h2><div class="alert alert-error">${escHtml(e.message)}</div>`);
    }
  },

  async render() {
    let url = `api/evaluations.php?action=results`;
    if (this.filterDiv !== 'all') url += `&division_id=${this.filterDiv}`;
    const rows = await fetch(url).then(r => r.json());

    // Group by player
    const playerMap = {};
    rows.forEach(row => {
      if (!playerMap[row.player_id]) {
        playerMap[row.player_id] = {
          id:      row.player_id,
          name:    row.player_name,
          age:     row.age,
          pos:     row.position,
          divName: row.division_name,
          skills:  {}
        };
      }
      playerMap[row.player_id].skills[row.skill_index] = parseFloat(row.avg_score);
    });

    // Compute overall
    const players = Object.values(playerMap).map(p => {
      const scores = Object.values(p.skills);
      p.overall = scores.length ? (scores.reduce((a,b) => a+b,0) / scores.length) : null;
      return p;
    }).sort((a, b) => (b.overall || 0) - (a.overall || 0));

    const filterBtns = [['all','All Divisions'], ...this.divisions.map(d => [d.id, d.name])]
      .map(([id, label]) => `<button class="filter-pill ${this.filterDiv == id ? 'active':''}" onclick="Results.filterBy('${id}')">${escHtml(label)}</button>`)
      .join('');

    const rankIcon = (i, overall) => {
      if (!overall) return `<span class="rank-plain">${i+1}</span>`;
      if (i === 0) return '🥇';
      if (i === 1) return '🥈';
      if (i === 2) return '🥉';
      return `<span class="rank-plain">${i+1}</span>`;
    };

    const tableRows = players.length
      ? players.map((p, i) => {
          const skillCells = this.skills.map((_, si) => {
            const sc = p.skills[si];
            return `<td class="center">${sc != null ? `<span class="score-val ${scoreClass(sc)}">${sc.toFixed(1)}</span>` : '<span class="score-none">—</span>'}</td>`;
          }).join('');
          return `<tr>
            <td>${rankIcon(i, p.overall)}</td>
            <td><div>${escHtml(p.name)}</div><div class="text-xs text-dim">${p.pos !== 'Player' ? escHtml(p.pos) : ''}${p.age ? `${p.pos !== 'Player' ? `, ` : ''}Age ${p.age}` : ''}</div></td>
            <td class="center text-muted text-sm">${escHtml(p.divName || '—')}</td>
            ${skillCells}
            <td class="center">${p.overall != null ? `<span class="score-val ${scoreClass(p.overall)}" style="font-size:16px">${p.overall.toFixed(1)}</span>` : '<span class="score-none">—</span>'}</td>
          </tr>`;
        }).join('')
      : `<tr class="empty-row"><td colspan="${4 + this.skills.length}">No results yet.</td></tr>`;

    setMain(`
      <h2 class="section-title">${this.isAdmin ? 'All Results' : 'My Evaluations'}</h2>
      <div class="filter-bar">${filterBtns}</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Player</th><th class="center">Division</th>
              ${this.skills.map(s => `<th class="center">${s}</th>`).join('')}
              <th class="center" style="color:var(--blue)">Overall</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`);
  },

  filterBy(divId) {
    this.filterDiv = divId;
    this.render();
  }
};

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
const Demo = {
  async seedDivisions() {
    if (!confirm('Add demo divisions (Majors, AAA, AA, Single-A)?\nExisting divisions will not be removed.')) return;
    try {
      const res = await api('demo', 'divisions');
      showAlert('div-alert', res.message, 'success');
      Divisions.load();
    } catch (e) { showAlert('div-alert', e.message); }
  },

  async seedPlayers() {
    if (!confirm('Reset ALL players and create 100 demo players per division?\n\nThis will delete all existing players and their scores.')) return;
    try {
      const res = await api('demo', 'players');
      showAlert('players-alert', res.message, 'success');
      Players.load();
    } catch (e) { showAlert('players-alert', e.message); }
  },

  async seedCoaches() {
    if (!confirm('Reset all coaches (except Administrator) and create 10 demo coaches?\n\nDemo coach password: coach123')) return;
    try {
      const res = await api('demo', 'coaches');
      showAlert('coaches-alert', res.message, 'success');
      Coaches.load();
    } catch (e) { showAlert('coaches-alert', e.message); }
  }
};

// ─── Route evaluate tab based on role ────────────────────────────────────────
const Evaluate_orig = Evaluate;
const EvaluateRouter = {
  load() {
    if (App.user.is_admin) Evaluate_orig.load();
    else CoachEvaluate.load();
  }
};

// ─── Helper: show alert ───────────────────────────────────────────────────────
function showAlert(targetId, msg, type = 'error') {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => { el.classList.add('hidden'); }, 4000);
}

// ─── Override switchTab to route evaluate ─────────────────────────────────────
App.switchTab = function(tab) {
  clearInterval(this.pollTimer);
  this.currentTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  // Disable content scrolling on evaluate tab so eval-screen fills height exactly
  const content = document.getElementById('main-content');
  if (content) content.classList.toggle('eval-mode', tab === 'evaluate');
  const views = {
    leagues:   Leagues,
    divisions: Divisions,
    players:   Players,
    coaches:   Coaches,
    skills:    Skills,
    evaluate:  EvaluateRouter,
    results:   Results
  };
  views[tab]?.load();
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
