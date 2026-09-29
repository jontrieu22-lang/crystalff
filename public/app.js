const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const odds = (o) => (o == null ? '—' : o > 0 ? `+${o}` : `${o}`);
const money = (n) => (n == null ? '—' : `$${n.toLocaleString()}`);
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  me: ls.get('me'),            // { id, name }
  host: ls.get('hostKey') || '',
  tab: 'week',
  week: Number(new URLSearchParams(location.search).get('week')) || null,
  data: null, catalog: null, season: null,
  picking: false, choosingName: false, filter: '',
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, body: body && JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-admin-key': state.host },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function toast(msg) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

async function loadWeek() {
  state.data = await api(`/api/week${state.week ? `?week=${state.week}` : ''}`);
  state.week = state.data.week;
}

function countdown(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const lockLabel = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' ET';

// ---------- views ----------

function header() {
  return `<header>
    <h1>🏈 Loser of the Week</h1>
    <button class="chip" data-act="who">${state.me ? esc(state.me.name) : 'Who are you?'}</button>
  </header>
  <div class="tabs">
    ${['week', 'season', 'rules'].map((t) => `<button data-tab="${t}" class="${state.tab === t ? 'on' : ''}">${{ week: 'This week', season: 'Season', rules: 'Rules' }[t]}</button>`).join('')}
  </div>`;
}

function weekView() {
  const d = state.data;
  const mine = state.me && d.legs.find((l) => l.playerId === state.me.id);
  const left = countdown(d.locksAt);
  const p = d.parlay;

  let banner = '';
  if (d.soleMiss) banner = `<div class="banner bad">😬 ${esc(d.soleMiss)} was the only leg that missed and owes next week's $5 ($10 total).</div>`;
  else if (p.won) banner = `<div class="banner good">💰 Parlay hit! Every leg cashed.</div>`;
  else if (p.settled && p.misses > 1) banner = `<div class="banner warn">${p.misses} legs missed. Nobody's on the hook alone.</div>`;

  const legs = d.legs.map((l) => `<div class="leg">
      <div class="st">${{ hit: '✅', miss: '❌', void: '➖', pending: '⏳' }[l.status]}</div>
      <div class="grow">
        <div class="who">${esc(l.player)}</div>
        <div>${esc(l.label)} <b>${l.side.toUpperCase()}</b></div>
        <div class="mut">${esc(l.game)}${l.liveOdds != null && l.status === 'pending' && l.liveOdds !== l.odds ? ` · now ${odds(l.liveOdds)}` : ''}</div>
      </div>
      <div class="odds">${odds(l.odds)}</div>
    </div>`).join('');

  return `
  <div class="card">
    <div class="weeknav">
      <button data-act="prev" aria-label="Previous week">‹</button>
      <div style="text-align:center">
        <div class="big">Week ${d.week}</div>
        <div class="mut">${left ? `🔓 Locks ${lockLabel(d.locksAt)} · ${left} left` : '🔒 Locked'}</div>
      </div>
      <button data-act="next" aria-label="Next week">›</button>
    </div>
  </div>
  ${banner}
  ${!d.locked && state.me ? `<button class="btn" data-act="pick" style="margin-bottom:12px">${mine ? 'Change my leg' : 'Pick my leg'}</button>` : ''}
  ${!state.me ? `<button class="btn" data-act="who" style="margin-bottom:12px">Tap your name to play</button>` : ''}
  <div class="card">
    <div class="row" style="margin-bottom:6px">
      <div class="grow"><b>The parlay</b> <span class="mut">${d.legs.length} leg${d.legs.length === 1 ? '' : 's'}</span></div>
      <div class="odds">${odds(p.odds)}</div>
    </div>
    ${legs || '<p class="mut">No legs yet. Be the first.</p>'}
    ${d.waitingOn.length && !d.locked ? `<p class="mut">Waiting on: ${d.waitingOn.map(esc).join(', ')}</p>` : ''}
    ${d.waitingOn.length && d.locked ? `<p class="mut">No leg: ${d.waitingOn.map(esc).join(', ')}</p>` : ''}
  </div>
  <div class="card">
    <div class="row"><span class="grow mut">Kalshi odds (est.)</span><b>${odds(p.odds)}</b></div>
    ${d.actualOdds ? `<div class="row"><span class="grow mut">Actual odds placed</span><b>${esc(d.actualOdds)}</b></div>` : ''}
    <div class="row"><span class="grow mut">Pot (${d.legs.length} × $5)</span><b>${money(p.stake)}</b></div>
    <div class="row"><span class="grow mut">Est. payout</span><b>${money(p.payout)}</b></div>
    <div class="row"><span class="grow mut">Placing it</span><b>${esc(d.placer) || 'TBD'}</b></div>
    ${d.note ? `<p class="mut">${esc(d.note)}</p>` : ''}
    ${p.hits || p.misses ? `<p class="mut">${p.hits} hit · ${p.misses} missed · ${p.pending} pending</p>` : ''}
  </div>
  ${hostPanel()}`;
}

function seasonView() {
  const s = state.season;
  if (!s) return '<p class="mut">Loading…</p>';
  const pct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);
  return `<div class="card">
    <b>Best situation monitors</b>
    <p class="mut">Leg hit rate across the season. "Solo" = weeks you were the only miss.</p>
    <table>
      <tr><th>#</th><th>Player</th><th>Hit</th><th>W-L</th><th>Avg odds</th><th>Solo</th></tr>
      ${s.table.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.player)}</td><td><b>${pct(r.hitRate)}</b></td>
        <td>${r.hits}-${r.misses}</td><td>${odds(r.avgOdds)}</td><td>${r.soleMisses || ''}</td></tr>`).join('')}
    </table>
    <p class="mut">Parlays hit: ${s.parlaysWon} of ${s.parlaysSettled} settled weeks.</p>
  </div>`;
}

function rulesView() {
  return `<div class="card"><pre><b>Rules</b>

1. Max odds per leg: +120. Longer legs are greyed out.
2. If your leg is the only leg that misses, you're on the hook for next week's $5 automatically (your total that week is $10).
3. Place by Saturday at 2:00 PM ET. The app locks picks then, and only games after the lock are available.
4. James Clause: if you put in a poison-pill leg (+600) and it's the only one that doesn't hit, you owe everyone the parlay value without your leg.

<b>How the app works</b>
• One leg per person per week, and no two people can take the same leg.
• Legs and odds come live from Kalshi. No account or money needed in the app.
• Odds are locked in when you pick. Results fill in automatically when Kalshi settles the market.</pre></div>`;
}

function hostPanel() {
  const d = state.data;
  if (!state.host) return `<p class="mut" style="text-align:center"><a href="#" data-act="host" style="color:inherit">Host tools</a></p>`;
  return `<details class="card"><summary><b>Host tools</b></summary>
    <p class="mut">Week ${d.week}</p>
    <label class="mut">Placing it</label>
    <select id="h-placer"><option value="">TBD</option>${d.players.map((p) => `<option ${p.name === d.placer ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <label class="mut">Actual odds placed</label><input id="h-odds" value="${esc(d.actualOdds)}" placeholder="+612">
    <label class="mut">Note</label><input id="h-note" value="${esc(d.note)}">
    <button class="btn" data-act="saveweek" style="margin-top:10px">Save week</button>
    <hr style="border-color:var(--line)">
    <label class="mut">Remove a leg (works after lock)</label>
    <select id="h-leg">${d.legs.map((l) => `<option value="${l.playerId}">${esc(l.player)}: ${esc(l.label)}</option>`).join('')}</select>
    <button class="btn ghost" data-act="rmleg" style="margin-top:6px">Remove leg</button>
    <hr style="border-color:var(--line)">
    <label class="mut">Add player</label><input id="h-name" placeholder="Name">
    <button class="btn ghost" data-act="addplayer" style="margin-top:6px">Add</button>
    <label class="mut">Remove player (deletes their legs)</label>
    <select id="h-rm">${d.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <button class="btn ghost" data-act="rmplayer" style="margin-top:6px">Remove</button>
    <p><a href="#" data-act="hostout" class="mut">Sign out of host tools</a></p>
  </details>`;
}

function nameSheet() {
  return `<div class="sheet"><div class="sheet-head"><div class="row"><b class="grow">Who are you?</b>
      ${state.me ? '<button class="chip" data-act="close">Close</button>' : ''}</div></div>
    <div class="sheet-body"><div class="names">
      ${state.data.players.map((p) => `<button data-name="${p.id}">${esc(p.name)}</button>`).join('')}
    </div><p class="mut">Not listed? Ask the host to add you.</p></div></div>`;
}

function pickSheet() {
  const d = state.data;
  const takenBy = new Map(d.legs.map((l) => [l.ticker, l]));
  const f = state.filter.trim().toLowerCase();
  let body;
  if (!state.catalog) body = '<p class="mut">Loading this week\'s Kalshi markets…</p>';
  else if (state.catalog.error) body = `<p class="mut">Couldn't load Kalshi: ${esc(state.catalog.error)}</p>`;
  else {
    const games = state.catalog.games.map((g) => {
      const groups = g.groups.map((gr) => {
        const rows = gr.markets.filter((m) => !f || `${g.title} ${gr.title} ${m.label}`.toLowerCase().includes(f)).map((m) => {
          const t = takenBy.get(m.ticker);
          const mineHere = t && t.playerId === state.me?.id;
          const btn = (side) => {
            const s = m[side];
            if (!s) return `<button class="side" disabled>${side.toUpperCase()}<b>—</b></button>`;
            const dis = !s.ok || (t && !mineHere);
            return `<button class="side ${mineHere && t.side === side ? 'mine' : ''}" ${dis ? 'disabled' : ''}
              data-pick="${esc(m.ticker)}" data-side="${side}" data-label="${esc(m.label)}" data-group="${esc(gr.title)}" data-game="${esc(g.title)}" data-odds="${s.odds}">
              ${side.toUpperCase()}<b>${odds(s.odds)}</b></button>`;
          };
          return `<div class="mkt"><div class="grow">${esc(m.label)}${t && !mineHere ? `<div class="taken">Taken by ${esc(t.player)}</div>` : ''}</div>${btn('yes')}${btn('no')}</div>`;
        }).join('');
        return rows && `<div class="group"><h4>${esc(gr.title)}</h4>${rows}</div>`;
      }).join('');
      const day = new Date(g.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      return groups && `<details class="game" ${f ? 'open' : ''}><summary>${esc(g.title)} <span class="mut">${day}</span></summary>${groups}</details>`;
    }).join('');
    body = games || `<p class="mut">${f ? 'No matches.' : 'Kalshi has no open markets for this week\'s games yet. Check back closer to the weekend.'}</p>`;
  }
  return `<div class="sheet"><div class="sheet-head">
      <div class="row" style="margin-bottom:8px"><b class="grow">Pick your Week ${d.week} leg</b><button class="chip" data-act="close">Close</button></div>
      <input id="filter" type="search" placeholder="Search a team, player, or bet…" value="${esc(state.filter)}">
      <div class="mut" style="margin-top:6px">Max +${state.catalog?.maxOdds ?? 120}. Greyed-out legs are too long or already taken.</div>
    </div><div class="sheet-body">${body}</div></div>`;
}

function render() {
  const focus = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  if (!state.data) return;
  let html = header();
  html += state.tab === 'week' ? weekView() : state.tab === 'season' ? seasonView() : rulesView();
  if (state.choosingName || (!state.me && state.tab === 'week' && ls.get('seenNames') !== true)) html += nameSheet();
  else if (state.picking) html += pickSheet();
  app.innerHTML = html;
  if (focus) {
    const el = document.getElementById(focus);
    if (el) { el.focus(); if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); }
  }
}

// ---------- actions ----------

async function refresh() {
  try { await loadWeek(); if (state.tab === 'season') state.season = await api('/api/season'); render(); }
  catch (e) { toast(e.message); }
}

async function openPicker() {
  state.picking = true; state.filter = ''; state.catalog = null; render();
  try { state.catalog = await api(`/api/catalog?week=${state.week}`); }
  catch (e) { state.catalog = { error: e.message }; }
  render();
}

async function pick(b) {
  const { pick: ticker, side, label, group, game } = b.dataset;
  if (!confirm(`${group}: ${label}, ${side.toUpperCase()} at ${odds(Number(b.dataset.odds))}?\n\nThis replaces any leg you already have this week.`)) return;
  try {
    const r = await api('/api/leg', { method: 'POST', body: { week: state.week, playerId: state.me.id, ticker, side, group, game } });
    state.picking = false;
    toast(`Locked in at ${odds(r.odds)}`);
    await refresh();
  } catch (e) { toast(e.message); }
}

async function host(action, extra = {}) {
  try { await api('/api/admin', { method: 'POST', body: { action, week: state.week, ...extra } }); toast('Saved'); await refresh(); }
  catch (e) { toast(e.message); }
}

app.addEventListener('input', (e) => {
  if (e.target.id === 'filter') { state.filter = e.target.value; render(); }
});

app.addEventListener('click', async (e) => {
  const b = e.target.closest('button, a');
  if (!b) return;
  if (b.dataset.tab) {
    state.tab = b.dataset.tab;
    render();
    if (state.tab === 'season') { state.season = await api('/api/season').catch(() => null); render(); }
    return;
  }
  if (b.dataset.name) {
    const p = state.data.players.find((x) => x.id === Number(b.dataset.name));
    state.me = { id: p.id, name: p.name }; ls.set('me', state.me); ls.set('seenNames', true);
    state.choosingName = false; render(); return;
  }
  if (b.dataset.pick) return pick(b);
  switch (b.dataset.act) {
    case 'who': state.choosingName = true; render(); break;
    case 'close': state.picking = false; state.choosingName = false; ls.set('seenNames', true); render(); break;
    case 'pick': openPicker(); break;
    case 'prev': if (state.week > 1) { state.week--; refresh(); } break;
    case 'next': if (state.week < 22) { state.week++; refresh(); } break;
    case 'host': {
      e.preventDefault();
      const key = prompt('Host key');
      if (!key) return;
      state.host = key;
      try { await api('/api/admin', { method: 'POST', body: { action: 'check' } }); ls.set('hostKey', key); render(); }
      catch { state.host = ''; toast('Wrong host key'); }
      break;
    }
    case 'hostout': e.preventDefault(); state.host = ''; ls.set('hostKey', ''); render(); break;
    case 'saveweek': host('week', { placer: $('h-placer'), actualOdds: $('h-odds'), note: $('h-note') }); break;
    case 'addplayer': host('addPlayer', { name: $('h-name') }); break;
    case 'rmplayer': if (confirm('Remove this player and all their legs?')) host('removePlayer', { playerId: $('h-rm') }); break;
    case 'rmleg':
      if (!$('h-leg') || !confirm('Remove this leg?')) return;
      try { await api('/api/leg', { method: 'DELETE', body: { week: state.week, playerId: Number($('h-leg')) } }); toast('Removed'); refresh(); }
      catch (err) { toast(err.message); }
      break;
  }
});
const $ = (id) => document.getElementById(id)?.value;

refresh();
// Live board: refresh every 15s while the tab is visible and no sheet is open.
setInterval(() => {
  if (document.visibilityState === 'visible' && !state.picking && !state.choosingName && !document.querySelector('details[open]:not(.game)')) refresh();
}, 15000);
