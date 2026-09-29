const $ = (h) => Object.assign(document.createElement('div'), { innerHTML: h }).firstElementChild;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) };
const app = document.getElementById('app');
let date = new URLSearchParams(location.search).get('date') || new Date().toLocaleDateString('en-CA');
let market = null, msg = '';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-token': store.get('token') || '', 'x-admin-key': store.get('adminKey') || '' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const fmt = (n) => (n > 0 ? '+' : '') + n;

async function render() {
  const [days, state] = await Promise.all([
    api('/api/days'),
    api(`/api/day?date=${date}`).catch(() => null),
  ]);
  const name = store.get('name');
  app.innerHTML = '';
  const dayOpts = [...new Set([date, ...days.map((d) => d.date)])]
    .map((d) => `<option ${d === date ? 'selected' : ''}>${d}</option>`).join('');
  const head = $(`<div class="card"><div class="row">
    <b>${name ? 'Playing as ' + esc(name) : 'Not joined'}</b><span style="flex:1"></span>
    <select id="day">${dayOpts}</select></div>${msg ? `<p class="bad">${esc(msg)}</p>` : ''}</div>`);
  app.append(head);
  head.querySelector('#day').onchange = (e) => { date = e.target.value; market = null; msg = ''; render(); };

  if (!name) {
    const j = $(`<div class="card"><h2>Join the tournament</h2><div class="row">
      <input id="n" placeholder="Your name"><input id="c" placeholder="Join code (if any)">
      <button>Join</button></div></div>`);
    j.querySelector('button').onclick = async () => {
      try {
        const r = await api('/api/join', { method: 'POST', body: { name: j.querySelector('#n').value, code: j.querySelector('#c').value } });
        store.set('name', r.name); store.set('token', r.token); msg = ''; render();
      } catch (e) { msg = e.message; render(); }
    };
    app.append(j);
  }

  if (!state) { app.append($(`<div class="card">No contest for <b>${date}</b> yet. Ask the host to create it.</div>`)); admin(); return; }

  const { day, locked, leaderboard, picks, hiddenCount } = state;
  app.append($(`<div class="card"><h2>${esc(day.title || day.date)}</h2><span class="mut">${
    day.locks_at ? (locked ? '🔒 Picks locked' : '⏳ Picks lock ' + new Date(day.locks_at).toLocaleString()) : 'No lock time set'}</span></div>`));

  if (name && !locked) {
    const f = $(`<div class="card"><h2>Add a pick</h2><div class="row">
      <input id="t" placeholder="Kalshi market URL or ticker" value="${esc(market?.ticker || '')}"><button id="look" class="ghost">Look up</button></div></div>`);
    f.querySelector('#look').onclick = async () => {
      try { market = await api('/api/market?ticker=' + encodeURIComponent(f.querySelector('#t').value)); msg = ''; }
      catch (e) { market = null; msg = e.message; }
      render();
    };
    if (market) {
      const m = $(`<div style="margin-top:10px"><b>${esc(market.title)}</b> <span class="mut">${esc(market.subtitle)}</span>
        <div class="row" style="margin-top:8px"><input id="note" placeholder="Why? (optional)">
        <button data-s="yes">YES @ ${market.yesPrice ?? '?'}¢</button><button data-s="no">NO @ ${market.noPrice ?? '?'}¢</button></div></div>`);
      m.querySelectorAll('button').forEach((b) => b.onclick = async () => {
        try { await api('/api/picks', { method: 'POST', body: { date, ticker: market.ticker, side: b.dataset.s, note: m.querySelector('#note').value } }); market = null; msg = ''; }
        catch (e) { msg = e.message; }
        render();
      });
      f.append(m);
    }
    app.append(f);
  }

  const lb = $(`<div class="card"><h2>Leaderboard</h2><table><tr><th>#</th><th>Player</th><th>Record</th><th>Points</th></tr>${
    leaderboard.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.player)}</td><td>${r.correct}/${r.settled} settled · ${r.picks} picks</td>
      <td class="${r.points >= 0 ? 'good' : 'bad'}">${fmt(r.points)}</td></tr>`).join('') || '<tr><td colspan=4 class="mut">No picks yet</td></tr>'}</table>
    <p class="mut">Points = paper P&amp;L on a $1 contract bought at the price when you picked. A right call at 20¢ earns +80; a wrong call at 90¢ costs −90.</p></div>`);
  app.append(lb);

  const pk = $(`<div class="card"><h2>Picks</h2>${hiddenCount ? `<p class="mut">${hiddenCount} other pick(s) hidden until lock.</p>` : ''}<table>${
    picks.map((p) => `<tr><td>${esc(p.player)}</td><td>${esc(p.title)}<div class="mut">${esc(p.ticker)}${p.note ? ' — ' + esc(p.note) : ''}</div></td>
      <td><span class="pill">${p.side.toUpperCase()} @ ${p.entry_price}¢</span></td>
      <td class="${p.score > 0 ? 'good' : 'bad'}">${p.score === null ? 'pending' : fmt(p.score)}</td>
      <td>${!locked && p.player === name ? `<button class="ghost" data-t="${esc(p.ticker)}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td class="mut">Nothing to show</td></tr>'}</table></div>`);
  pk.querySelectorAll('button[data-t]').forEach((b) => b.onclick = async () => {
    await api(`/api/picks?date=${date}&ticker=${encodeURIComponent(b.dataset.t)}`, { method: 'DELETE' }); render();
  });
  app.append(pk);
  admin();
}

function admin() {
  const a = $(`<details class="card"><summary class="mut">Host tools</summary><div class="row" style="margin-top:8px">
    <input id="k" placeholder="Admin key" type="password" value="${esc(store.get('adminKey') || '')}">
    <input id="ti" placeholder="Day title"><input id="lk" type="datetime-local">
    <button>Create / update ${date}</button></div></details>`);
  a.querySelector('button').onclick = async () => {
    store.set('adminKey', a.querySelector('#k').value);
    const lk = a.querySelector('#lk').value;
    try { await api('/api/days', { method: 'POST', body: { date, title: a.querySelector('#ti').value, locksAt: lk ? new Date(lk).toISOString() : null } }); msg = ''; }
    catch (e) { msg = e.message; }
    render();
  };
  app.append(a);
}

render().catch((e) => { app.textContent = e.message; });
setInterval(() => { if (!document.activeElement || document.activeElement.tagName === 'BODY') render().catch(() => {}); }, 60000);
