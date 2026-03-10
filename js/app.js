/* Scout Pro — Main Application JS */
'use strict';

const SKILLS = ['Running', 'Fielding', 'Pitching', 'Hitting'];

// ─── API helper ───────────────────────────────────────────────────────────────
async function api(file, action, data = null, method = 'GET') {
  const url = `api/${file}.php?action=${action}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (data) { opts.method = 'POST'; opts.body = JSON.stringify(data); }
  const res = await fetch(url, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

// ─── App State ────────────────────────────────────────────────────────────────
const App = {
  user: null,
  currentTab: null,
  pollTimer: null,

  async init() {
    try {
      const { coach } = await api('auth', 'me');
      if (coach) { this.user = coach; this.showApp(); }
      else { this.showLogin(); }
    } catch { this.showLogin(); }
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
    const tabs = isAdmin
      ? [['divisions','Divisions','⬡'],['players','Players','👤'],['coaches','Coaches','🛡'],['evaluate','Evaluate','⚾'],['results','Results','📊']]
      : [['evaluate','Evaluate','⚾'],['results','My Results','📊']];

    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-logo">
          <div class="header-icon">⚾</div>
          <div>
            <span class="header-title">Scout Pro</span>
            ${isAdmin ? '<span class="badge-admin">ADMIN</span>' : ''}
          </div>
        </div>
        <div class="header-right">
          <span class="welcome-text">Welcome, <span>${escHtml(this.user.name)}</span></span>
          <button class="btn-logout" onclick="App.doLogout()">Sign Out</button>
        </div>
      </div>
      <div class="main-layout">
        <nav class="sidebar" id="sidebar">
          ${tabs.map(([id,label,icon]) => `
            <button class="nav-btn" data-tab="${id}" onclick="App.switchTab('${id}')">
              <span class="nav-icon">${icon}</span><span>${label}</span>
            </button>`).join('')}
        </nav>
        <main class="content" id="main-content">
          <div style="color:var(--dim);padding-top:40px;text-align:center"><div class="spinner"></div></div>
        </main>
      </div>`;

    this.switchTab(tabs[0][0]);
  },

  switchTab(tab) {
    clearInterval(this.pollTimer);
    this.currentTab = tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const views = { divisions: Divisions, players: Players, coaches: Coaches, evaluate: Evaluate, results: Results };
    views[tab]?.load();
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
          <div class="div-card">
            <span class="diamond">◇</span>
            <span style="flex:1">${escHtml(d.name)}</span>
            <span class="text-dim text-sm">${d.player_count} players</span>
            <button class="btn-danger" onclick="Divisions.delete(${d.id})">🗑</button>
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
    this.render(coaches);
  },

  render(coaches) {
    const cards = coaches.map(c => `
      <div class="coach-card">
        <div class="coach-avatar ${c.is_admin ? 'admin' : 'coach'}">${c.is_admin ? '🛡' : '👤'}</div>
        <div style="flex:1">
          <div>${escHtml(c.name)}</div>
          <div class="text-xs text-dim">${c.is_admin ? 'Administrator' : 'Coach'}</div>
        </div>
        ${!c.is_admin ? `<button class="btn-danger" onclick="Coaches.delete(${c.id})">🗑</button>` : ''}
      </div>`).join('');

    setMain(`
      <h2 class="section-title">Coaches</h2>
      <div class="form-row mb16">
        <div class="grow"><input id="c-name" placeholder="Coach name" /></div>
        <div class="med"><input id="c-pass" type="password" placeholder="Password" /></div>
        <button class="btn btn-primary" onclick="Coaches.add()">＋ Add Coach</button>
        <button class="btn btn-demo" onclick="Demo.seedCoaches()">⚡ Demo Data</button>
      </div>
      <div id="coaches-alert"></div>
      <div class="card-grid">${cards}</div>`);
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

  async load() {
    setMain(`<h2 class="section-title">Evaluation Session</h2><div class="spinner"></div>`);
    const [session, divisions] = await Promise.all([
      api('sessions', 'active').catch(() => null),
      api('divisions', 'list')
    ]);
    this.session = session;
    this.divisions = divisions;
    if (session) {
      this.players = await api('players', 'list', null, 'GET').then(all => all.filter(p => p.division_id == session.division_id));
      this.progress = await api('sessions', 'progress', null, 'GET').then(data => {
        // re-fetch with session_id
        return fetch(`api/sessions.php?action=progress&session_id=${session.id}`).then(r => r.json());
      });
      this.renderActive();
      // poll every 5s
      App.pollTimer = setInterval(() => this.refresh(), 5000);
    } else {
      this.renderSetup();
    }
  },

  async refresh() {
    if (App.currentTab !== 'evaluate') return;
    const [session, progress] = await Promise.all([
      api('sessions', 'active').catch(() => null),
      this.session ? fetch(`api/sessions.php?action=progress&session_id=${this.session.id}`).then(r => r.json()) : []
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
        <p class="text-muted text-sm mb16">Start a session for a division. Coaches will score each player on all four skills.</p>
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
    const skillIndex   = s.current_skill_index;
    const currentSkill = SKILLS[skillIndex] || 'Complete';
    const nextSkill    = SKILLS[skillIndex + 1];
    const sessionDone  = skillIndex >= SKILLS.length;

    // Build progress map: player_id -> skill_index -> avg score
    const pmap = {};
    (this.progress || []).forEach(row => {
      if (!pmap[row.player_id]) pmap[row.player_id] = {};
      pmap[row.player_id][row.skill_index] = parseFloat(row.avg_score).toFixed(1);
    });

    const rows = this.players.map(p => {
      const cells = SKILLS.map((sk, si) => {
        const sc = pmap[p.id]?.[si];
        return `<td class="center">${sc ? `<span class="score-val ${scoreClass(sc)}">${sc}</span>` : '<span class="score-none">—</span>'}</td>`;
      }).join('');
      return `<tr><td>${escHtml(p.name)}</td>${cells}</tr>`;
    }).join('');

    const skillHeaders = SKILLS.map((sk, i) =>
      `<th class="center" style="color:${i === skillIndex ? 'var(--blue)' : i < skillIndex ? 'var(--green)' : 'var(--dim)'}">${i < skillIndex ? '✓ ' : ''}${sk}</th>`
    ).join('');

    const steps = SKILLS.map((sk, i) => `
      <div class="skill-step ${i < skillIndex ? 'done' : i === skillIndex ? 'current' : 'upcoming'}">
        ${i < skillIndex ? '✓' : sk}
      </div>`).join('');

    const nextSkillBtn = !sessionDone
      ? `<button class="btn btn-primary" onclick="Evaluate.nextSkill()">
           Next Skill: ${escHtml(nextSkill || 'Finish')} →
         </button>`
      : '';

    setMain(`
      <h2 class="section-title">Evaluation Session</h2>
      <div class="session-banner">
        <p class="session-title">🟢 Session Active — ${escHtml(s.division_name)}</p>
        <p class="session-sub">Current skill: <strong style="color:var(--blue)">${escHtml(currentSkill)}</strong></p>
      </div>
      <div class="skill-progress" style="margin-bottom:20px">${steps}</div>
      <div class="table-wrap mb16">
        <table>
          <thead><tr><th>Player</th>${skillHeaders}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
        ${nextSkillBtn}
        <button class="btn btn-secondary" style="border-color:var(--red);color:var(--red)" onclick="Evaluate.end()">■ End Session</button>
      </div>`);
  },

  async nextSkill() {
    if (!confirm(`Advance all coaches to the next skill?`)) return;
    try {
      await api('sessions', 'advance', { session_id: this.session.id });
      await this.refresh();
    } catch (e) { alert(e.message); }
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
  allScores: {},        // { skillIndex: { playerId: score } }
  scoredSet: new Set(), // player IDs scored for current skill
  localPlayerIndex: 0,
  selectedScore: null,
  mode: 'evaluate',     // 'evaluate' | 'list' | 'score'
  viewSkillIndex: 0,
  editPlayerIndex: 0,

  async load() {
    setMain(`<div class="no-session"><div class="big-icon">⚾</div><p class="text-muted">Loading…</p></div>`);
    const session = await api('sessions', 'active').catch(() => null);
    this.session = session;
    if (!session) { this.renderNoSession(); return; }

    this.players = await fetch(`api/players.php?action=list&division_id=${session.division_id}`).then(r => r.json());
    await this.loadAllScores();
    this.buildScoredSet();
    this.localPlayerIndex = this.firstUnscoredIndex();
    this.selectedScore = null;
    this.mode = 'evaluate';
    this.render();

    App.pollTimer = setInterval(() => this.poll(), 4000);
  },

  async loadAllScores() {
    const s = this.session;
    const rows = await fetch(`api/evaluations.php?action=my_all_scores&session_id=${s.id}`).then(r => r.json());
    this.allScores = {};
    rows.forEach(r => {
      const si = parseInt(r.skill_index);
      const pid = parseInt(r.player_id);
      if (!this.allScores[si]) this.allScores[si] = {};
      this.allScores[si][pid] = parseInt(r.score);
    });
  },

  buildScoredSet() {
    const si = this.session.current_skill_index;
    this.scoredSet = new Set(Object.keys(this.allScores[si] || {}).map(Number));
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
    if (App.currentTab !== 'evaluate') return;
    const session = await api('sessions', 'active').catch(() => null);
    if (!session) { clearInterval(App.pollTimer); this.renderNoSession(); return; }

    if (session.current_skill_index !== this.session.current_skill_index) {
      this.session = session;
      this.selectedScore = null;
      this.mode = 'evaluate';
      this.buildScoredSet();
      this.localPlayerIndex = this.firstUnscoredIndex();
      this.render();
    }
  },

  // ── Skill progress bar (clickable for done/current skills) ──
  skillStepsHtml() {
    const si = this.session.current_skill_index;
    return SKILLS.map((sk, i) => {
      const state = i < si ? 'done' : i === si ? 'current' : 'upcoming';
      const clickable = i <= si;
      return `<div class="skill-step ${state}${clickable ? ' clickable' : ''}"
        ${clickable ? `onclick="CoachEvaluate.viewSkill(${i})"` : ''}>
        ${i < si ? '✓' : sk}
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
    const s = this.session;
    if (!s || s.current_skill_index >= SKILLS.length) { this.renderComplete(); return; }
    if (this.mode === 'list')  { this.renderList(); return; }
    if (this.mode === 'score') { this.renderScore(); return; }
    // evaluate mode
    if (this.localPlayerIndex >= this.players.length) { this.renderSkillDone(); return; }
    this.renderEvaluate();
  },

  // ── Evaluate: score next unscored player ──
  renderEvaluate() {
    const s = this.session;
    const player = this.players[this.localPlayerIndex];
    const skill  = SKILLS[s.current_skill_index];
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
    const skill = SKILLS[si];
    const currentSi = this.session.current_skill_index;
    const hasUnscored = this.localPlayerIndex < this.players.length;

    const tabs = SKILLS.map((sk, i) => {
      const accessible = i <= currentSi;
      const active = i === si;
      return `<button class="skill-tab${active ? ' active' : ''}${!accessible ? ' disabled' : ''}"
        ${accessible ? `onclick="CoachEvaluate.viewSkill(${i})"` : ''}>${i < currentSi ? '✓ ' : ''}${sk}</button>`;
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
      ${hasUnscored && si === currentSi
        ? `<button class="btn btn-primary mb16" style="width:100%" onclick="CoachEvaluate.backToEvaluate()">← Back to Scoring</button>`
        : ''}
      <div class="review-list">${rows}</div>`);
  },

  // ── Score: re-score a specific player/skill ──
  renderScore() {
    const p  = this.players[this.editPlayerIndex];
    const si = this.viewSkillIndex;
    const skill = SKILLS[si];
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
    const s = this.session;
    const skill = SKILLS[s.current_skill_index];
    const nextSkill = SKILLS[s.current_skill_index + 1];

    setMain(`
      <div class="skill-progress">${this.skillStepsHtml()}</div>
      <div class="skill-done-card">
        <div class="skill-done-icon">✅</div>
        <h2 class="skill-done-title">${escHtml(skill)} Complete</h2>
        <p class="skill-done-sub">You've scored all ${this.players.length} players.</p>
        ${nextSkill
          ? `<p class="skill-done-next">Waiting for admin to start<br><strong>${escHtml(nextSkill)}</strong></p>`
          : `<p class="skill-done-next">Waiting for admin to finish the session.</p>`}
        <button class="btn btn-secondary mt12" onclick="CoachEvaluate.viewSkill(${s.current_skill_index})">Review ${escHtml(skill)} Scores</button>
        <div class="skill-done-spinner mt12"><div class="spinner"></div></div>
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
        <h2 style="color:var(--blue)">Evaluation Complete!</h2>
        <p class="text-muted mt8">All skills evaluated. Check the Results tab.</p>
      </div>`);
  },

  selectScore(n) {
    this.selectedScore = n;
    this.submit();
  },

  // Submit score for current unscored player in evaluate mode
  async submit() {
    const s = this.session;
    const p = this.players[this.localPlayerIndex];
    if (!p || !this.selectedScore) return;
    try {
      await api('evaluations', 'submit', {
        session_id: s.id, player_id: p.id,
        skill_index: s.current_skill_index, score: this.selectedScore
      });
      if (!this.allScores[s.current_skill_index]) this.allScores[s.current_skill_index] = {};
      this.allScores[s.current_skill_index][p.id] = this.selectedScore;
      this.scoredSet.add(p.id);
      this.selectedScore = null;
      this.localPlayerIndex = this.firstUnscoredIndex();
      this.render();
    } catch (e) { alert(e.message); }
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
      await api('evaluations', 'submit', {
        session_id: s.id, player_id: p.id,
        skill_index: si, score: this.selectedScore
      });
      if (!this.allScores[si]) this.allScores[si] = {};
      this.allScores[si][p.id] = this.selectedScore;
      if (si === s.current_skill_index) {
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
    } catch (e) { alert(e.message); }
  }
};

// ─── RESULTS ──────────────────────────────────────────────────────────────────
const Results = {
  divisions: [],
  filterDiv: 'all',
  isAdmin: false,

  async load() {
    this.isAdmin = App.user.is_admin;
    setMain(`<h2 class="section-title">${this.isAdmin ? 'All Results' : 'My Evaluations'}</h2><div class="spinner"></div>`);
    this.divisions = await api('divisions', 'list');
    await this.render();
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
          const skillCells = SKILLS.map((_, si) => {
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
      : `<tr class="empty-row"><td colspan="8">No results yet.</td></tr>`;

    setMain(`
      <h2 class="section-title">${this.isAdmin ? 'All Results' : 'My Evaluations'}</h2>
      <div class="filter-bar">${filterBtns}</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Player</th><th class="center">Division</th>
              ${SKILLS.map(s => `<th class="center">${s}</th>`).join('')}
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
    divisions: Divisions,
    players:   Players,
    coaches:   Coaches,
    evaluate:  EvaluateRouter,
    results:   Results
  };
  views[tab]?.load();
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
