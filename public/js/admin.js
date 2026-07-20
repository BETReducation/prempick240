// Admin page — publish each week's fixtures and enter results.
//
// Auth: an admin user's session token is enough (the server's requireAdmin
// accepts it), so normally there's nothing to type. The password box is a
// fallback for when you're not signed in.

let GWS      = null;   // /api/gameweeks payload
let RESULTS  = {};     // matchId -> { home, away, played }
let EDIT_ID  = null;   // gameweek id being edited on the Fixtures panel
let ADMIN_PW = sessionStorage.getItem('pp240_adminpw') || null;
let ALL_PREDS = [];    // every player's predictions — locked weeks only

const COMPS = ['PL', 'CH', 'CUP'];
const COMP_NAME = { PL: 'Premier League', CH: 'Championship', CUP: 'Cup' };

function el(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function adminHeaders(extra = {}) {
  const { token } = Session.load();
  const h = { 'Content-Type': 'application/json', ...extra };
  if (token)    h['x-session-token']  = token;
  if (ADMIN_PW) h['x-admin-password'] = ADMIN_PW;
  return h;
}

async function adminFetch(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: adminHeaders(opts.headers) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
  return body;
}

// ── UK time <-> UTC ───────────────────────────────────────────────────────────
// The deadline input shows UK time regardless of where the admin is sitting,
// so BST/GMT is handled explicitly rather than trusting the browser's zone.

function londonPartsOf(ms) {
  const s = new Date(ms).toLocaleString('en-GB', {
    timeZone: 'Europe/London', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/);
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
}

// "2026-08-21T20:00" understood as UK wall-clock -> ISO UTC instant
function ukLocalToUtcISO(local) {
  if (!local) return null;
  const [d, t] = local.split('T');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, mi]   = t.split(':').map(Number);
  const target = Date.UTC(Y, M - 1, D, h, mi);
  let guess = target;
  // Converge on the instant whose London rendering equals what was typed.
  for (let i = 0; i < 4; i++) {
    const diff = londonPartsOf(guess) - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess).toISOString();
}

// ISO UTC -> "2026-08-21T20:00" in UK wall-clock, for the input's value
function utcISOToUkLocal(iso) {
  if (!iso) return '';
  const ms = londonPartsOf(new Date(iso).getTime());
  return new Date(ms).toISOString().slice(0, 16);
}

function fmtUk(iso) {
  if (!iso) return 'no deadline';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
  });
}

// ── Results panel ─────────────────────────────────────────────────────────────

function renderResultPanel() {
  const gw = GWS.gameweeks.find(g => g.id === el('resultGw').value);
  if (!gw) { el('resultRows').innerHTML = '<p class="empty">No gameweeks yet.</p>'; return; }

  el('resultGwHint').textContent =
    `Deadline ${fmtUk(gw.lockTime)} · ${gw.locked ? 'locked' : 'still open'}`;

  el('resultRows').innerHTML = `
    <div class="admin-rows">
      ${gw.matches.map(m => {
        const r = RESULTS[m.id] || {};
        const has = r.played;
        return `
        <div class="admin-row${has ? ' done' : ''}" data-match="${m.id}">
          <span class="admin-row-comp comp-${m.comp.toLowerCase()}">${m.comp}</span>
          <span class="admin-row-team home">${esc(m.home)}</span>
          <input type="number" class="score-input res-in" data-match="${m.id}" data-side="home"
                 min="0" max="99" inputmode="numeric" value="${r.home ?? ''}">
          <span class="fixture-v">v</span>
          <input type="number" class="score-input res-in" data-match="${m.id}" data-side="away"
                 min="0" max="99" inputmode="numeric" value="${r.away ?? ''}">
          <span class="admin-row-team away">${esc(m.away)}</span>
          <span class="admin-row-state">${has ? '<i class="fa-solid fa-check"></i> saved' : 'not entered'}</span>
          ${has ? `<button class="btn btn-danger btn-xs clear-res" data-match="${m.id}">Clear</button>` : '<span></span>'}
        </div>`;
      }).join('')}
    </div>`;

  el('resultRows').querySelectorAll('.clear-res').forEach(b =>
    b.addEventListener('click', () => clearResult(b.dataset.match)));
}

async function saveResults() {
  const gw = GWS.gameweeks.find(g => g.id === el('resultGw').value);
  const status = el('resultStatus');
  const pending = [];

  for (const m of gw.matches) {
    const h = el('resultRows').querySelector(`.res-in[data-match="${m.id}"][data-side="home"]`).value;
    const a = el('resultRows').querySelector(`.res-in[data-match="${m.id}"][data-side="away"]`).value;
    if (h === '' || a === '') continue;            // partially filled rows are skipped
    const cur = RESULTS[m.id];
    if (cur && cur.home === +h && cur.away === +a) continue;  // unchanged
    pending.push({ matchId: m.id, homeGoals: +h, awayGoals: +a });
  }

  if (!pending.length) { status.textContent = 'Nothing to save.'; status.className = 'save-status'; return; }

  el('saveResultsBtn').disabled = true;
  status.textContent = 'Saving…'; status.className = 'save-status';
  try {
    for (const p of pending) {
      await adminFetch('/api/results', { method: 'POST', body: JSON.stringify(p) });
    }
    await refresh();
    status.textContent = `Saved ${pending.length} result${pending.length > 1 ? 's' : ''}.`;
    status.className = 'save-status ok';
  } catch (e) {
    status.textContent = 'Failed — ' + e.message;
    status.className = 'save-status err';
  } finally {
    el('saveResultsBtn').disabled = false;
  }
}

async function clearResult(matchId) {
  if (!confirm('Remove this result? Scores and praise will be recalculated.')) return;
  try {
    await adminFetch(`/api/results/${matchId}`, { method: 'DELETE' });
    await refresh();
    el('resultStatus').textContent = 'Result removed.';
    el('resultStatus').className = 'save-status ok';
  } catch (e) {
    el('resultStatus').textContent = 'Failed — ' + e.message;
    el('resultStatus').className = 'save-status err';
  }
}

// Shows who's in line for praise once every fixture in the week has a result.
async function renderPraisePreview() {
  const gw = GWS.gameweeks.find(g => g.id === el('resultGw').value);
  const box = el('praisePreview');
  if (!gw) { box.innerHTML = ''; return; }

  const complete = gw.matches.every(m => RESULTS[m.id]?.played);
  if (!complete) {
    const done = gw.matches.filter(m => RESULTS[m.id]?.played).length;
    box.innerHTML = `<p class="section-note">${done} of ${gw.matches.length} results entered — praise is awarded once all six are in.</p>`;
    return;
  }

  const praise = await API.praise();
  const wk = praise.weekly.find(w => w.gameweekId === gw.id);
  if (!wk) { box.innerHTML = ''; return; }

  box.innerHTML = wk.rolledOver
    ? `<div class="lock-notice"><i class="fa-solid fa-arrow-right"></i>
         <span>Nobody called all six. <strong>${wk.pot}</strong> praise rolls into next week.</span></div>`
    : `<div class="lock-notice locked"><i class="fa-solid fa-award"></i>
         <span><strong>${wk.winners.map(w => esc(w.displayName || w.name)).join(', ')}</strong>
         ${wk.winners.length > 1 ? `share ${wk.pot} praise (${Math.round(wk.sharePerWinner * 10) / 10} each)` : `wins ${wk.pot} praise`}.</span></div>`;
}

// ── Fixtures panel ────────────────────────────────────────────────────────────

function blankMatch(i) {
  return { id: '', comp: 'PL', home: '', away: '', date: '' };
}

function renderFixtureEditor(gw) {
  el('gwNumber').value   = gw.number ?? '';
  el('gwLabel').value    = gw.label ?? '';
  el('gwDeadline').value = utcISOToUkLocal(gw.lockTime);
  el('gwDeadlineEcho').textContent = gw.lockTime ? `Locks ${fmtUk(gw.lockTime)}` : '';

  const matches = (gw.matches && gw.matches.length)
    ? gw.matches
    : Array.from({ length: 6 }, (_, i) => blankMatch(i));

  el('fixtureRows').innerHTML = `
    <div class="admin-rows">
      ${matches.map((m, i) => `
        <div class="admin-row edit" data-i="${i}">
          <select class="fx-comp" data-i="${i}">
            ${COMPS.map(c => `<option value="${c}" ${m.comp === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
          <input type="text" class="fx-home" data-i="${i}" value="${esc(m.home)}" placeholder="Home team" maxlength="60">
          <span class="fixture-v">v</span>
          <input type="text" class="fx-away" data-i="${i}" value="${esc(m.away)}" placeholder="Away team" maxlength="60">
          <input type="date" class="fx-date" data-i="${i}" value="${esc(m.date || '')}">
        </div>`).join('')}
    </div>`;
}

function loadGwForEdit(id) {
  EDIT_ID = id;
  const gw = id === '__new__'
    ? { number: (GWS.gameweeks.at(-1)?.number || 0) + 1, label: '', lockTime: '', matches: [] }
    : GWS.gameweeks.find(g => g.id === id);
  if (!gw) return;
  if (id === '__new__') gw.label = `Gameweek ${gw.number}`;
  renderFixtureEditor(gw);
  el('deleteGwBtn').style.display = id === '__new__' ? 'none' : '';
}

async function saveGameweek() {
  const status = el('fixtureStatus');
  const number = parseInt(el('gwNumber').value);
  const label  = el('gwLabel').value.trim();
  const local  = el('gwDeadline').value;

  if (!Number.isInteger(number)) { status.textContent = 'Week number is required.'; status.className = 'save-status err'; return; }
  if (!local) { status.textContent = 'A prediction deadline is required.'; status.className = 'save-status err'; return; }

  const rows = [...el('fixtureRows').querySelectorAll('.admin-row.edit')];
  const matches = rows.map(r => {
    const i = r.dataset.i;
    return {
      comp: el('fixtureRows').querySelector(`.fx-comp[data-i="${i}"]`).value,
      home: el('fixtureRows').querySelector(`.fx-home[data-i="${i}"]`).value.trim(),
      away: el('fixtureRows').querySelector(`.fx-away[data-i="${i}"]`).value.trim(),
      date: el('fixtureRows').querySelector(`.fx-date[data-i="${i}"]`).value || null
    };
  }).filter(m => m.home && m.away);

  if (matches.length !== 6 &&
      !confirm(`You've filled in ${matches.length} fixtures, not 6. A week needs all six for anyone to win praise. Save anyway?`)) return;

  const id = EDIT_ID === '__new__' ? `gw${number}` : EDIT_ID;
  const payload = {
    id, number, label: label || `Gameweek ${number}`,
    lockTime: ukLocalToUtcISO(local),
    matches: matches.map((m, i) => ({ ...m, id: `${id}-m${i + 1}` }))
  };

  el('saveGwBtn').disabled = true;
  status.textContent = 'Saving…'; status.className = 'save-status';
  try {
    await adminFetch('/api/admin/gameweeks', { method: 'POST', body: JSON.stringify(payload) });
    await refresh();
    EDIT_ID = id;
    status.textContent = `Saved — locks ${fmtUk(payload.lockTime)}.`;
    status.className = 'save-status ok';
  } catch (e) {
    status.textContent = 'Failed — ' + e.message;
    status.className = 'save-status err';
  } finally {
    el('saveGwBtn').disabled = false;
  }
}

async function deleteGameweek() {
  const gw = GWS.gameweeks.find(g => g.id === EDIT_ID);
  if (!gw) return;
  if (!confirm(`Delete ${gw.label}? Predictions already made for it stay on file but stop counting.`)) return;
  try {
    await adminFetch(`/api/admin/gameweeks/${EDIT_ID}`, { method: 'DELETE' });
    await refresh();
    el('fixtureStatus').textContent = 'Gameweek deleted.';
    el('fixtureStatus').className = 'save-status ok';
  } catch (e) {
    el('fixtureStatus').textContent = 'Failed — ' + e.message;
    el('fixtureStatus').className = 'save-status err';
  }
}


// ── Records ───────────────────────────────────────────────────────────────────
// The season's audit trail: one week at a time, everyone's picks against the
// actual results. /api/predictions withholds weeks that haven't locked, which
// applies to admins too — that's deliberate, since the admin plays as well.

function recordRows(gw) {
  return ALL_PREDS
    .map(p => {
      const picks = gw.matches.map(m => p.predictions[m.id] || null);
      let correct = 0, exact = 0;
      gw.matches.forEach((m, i) => {
        const r = RESULTS[m.id], pr = picks[i];
        if (!r || !r.played || !pr) return;
        if (Math.sign(r.home - r.away) === Math.sign(pr.home - pr.away)) correct++;
        if (pr.home === r.home && pr.away === r.away) exact++;
      });
      return { ...p, picks, correct, exact, entered: picks.filter(Boolean).length };
    })
    .filter(p => p.entered > 0)
    .sort((a, b) => b.correct - a.correct || b.exact - a.exact || a.name.localeCompare(b.name));
}

function renderRecords() {
  const gw = GWS.gameweeks.find(g => g.id === el('recordGw').value);
  const box = el('recordTable');
  if (!gw) { box.innerHTML = '<p class="empty">No gameweeks yet.</p>'; el('recordHint').textContent = ''; return; }

  if (!gw.locked) {
    el('recordHint').textContent = 'Not locked yet';
    box.innerHTML = `<p class="empty">${esc(gw.label)} hasn't locked yet, so predictions stay hidden — including from you. They appear here the moment the deadline passes.</p>`;
    return;
  }

  const rows = recordRows(gw);
  const anyResults = gw.matches.some(m => RESULTS[m.id]?.played);
  el('recordHint').textContent = `${rows.length} player${rows.length === 1 ? '' : 's'} entered`;

  if (!rows.length) { box.innerHTML = '<p class="empty">Nobody entered predictions for this week.</p>'; return; }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="preds-table">
        <thead>
          <tr>
            <th class="col-player">Player</th>
            ${gw.matches.map(m => `<th class="col-fx"><span>${esc(m.home)}</span><span class="muted">v ${esc(m.away)}</span></th>`).join('')}
            ${anyResults ? '<th class="col-pts">Results</th><th class="col-pts">Exact</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${rows.map(p => `
            <tr>
              <td class="col-player">${esc(p.displayName || p.name)}</td>
              ${gw.matches.map((m, i) => {
                const pr = p.picks[i], r = RESULTS[m.id];
                if (!pr) return '<td class="col-fx muted">—</td>';
                let cls = '';
                if (r && r.played) {
                  const right = Math.sign(r.home - r.away) === Math.sign(pr.home - pr.away);
                  const ex = pr.home === r.home && pr.away === r.away;
                  cls = ex ? ' exact' : (right ? ' hit' : ' miss');
                }
                return `<td class="col-fx${cls}">${pr.home}–${pr.away}</td>`;
              }).join('')}
              ${anyResults ? `<td class="col-pts strong">${p.correct}</td><td class="col-pts">${p.exact}</td>` : ''}
            </tr>`).join('')}
          ${anyResults ? `
            <tr class="actual-row">
              <td class="col-player">Actual</td>
              ${gw.matches.map(m => {
                const r = RESULTS[m.id];
                return `<td class="col-fx">${r && r.played ? `${r.home}–${r.away}` : '—'}</td>`;
              }).join('')}
              <td class="col-pts"></td><td class="col-pts"></td>
            </tr>` : ''}
        </tbody>
      </table>
    </div>`;
}

// Export the whole season, not just the week on screen — that's the point of
// keeping a record.
function exportCsv() {
  const lines = [];
  lines.push(['Gameweek', 'Deadline', 'Player', 'Fixture', 'Predicted', 'Actual', 'Correct result', 'Exact score'].join(','));
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  for (const gw of GWS.gameweeks) {
    if (!gw.locked) continue;
    for (const p of recordRows(gw)) {
      gw.matches.forEach((m, i) => {
        const pr = p.picks[i], r = RESULTS[m.id];
        const played = r && r.played;
        lines.push([
          q(gw.label), q(gw.lockTime || ''), q(p.displayName || p.name),
          q(`${m.home} v ${m.away}`),
          q(pr ? `${pr.home}-${pr.away}` : ''),
          q(played ? `${r.home}-${r.away}` : ''),
          q(!pr || !played ? '' : (Math.sign(r.home - r.away) === Math.sign(pr.home - pr.away) ? 'Y' : 'N')),
          q(!pr || !played ? '' : (pr.home === r.home && pr.away === r.away ? 'Y' : 'N'))
        ].join(','));
      });
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `prempick240-predictions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Shared ────────────────────────────────────────────────────────────────────

function fillSelects() {
  const opts = GWS.gameweeks.map(g =>
    `<option value="${g.id}">${esc(g.label)}${g.complete ? ' ✓' : ''}</option>`).join('');

  const rSel = el('resultGw');
  const keepR = rSel.value;
  rSel.innerHTML = opts;
  rSel.value = keepR && GWS.gameweeks.some(g => g.id === keepR)
    ? keepR
    : (GWS.currentGameweekId || GWS.gameweeks.at(-1)?.id || '');

  const recSel = el('recordGw');
  const keepRec = recSel.value;
  // Newest first — you'll usually want the week just gone.
  const recOpts = GWS.gameweeks.slice().reverse()
    .map(g => `<option value="${g.id}">${esc(g.label)}${g.locked ? '' : ' (open)'}</option>`).join('');
  recSel.innerHTML = recOpts;
  recSel.value = keepRec && GWS.gameweeks.some(g => g.id === keepRec)
    ? keepRec
    : (GWS.gameweeks.filter(g => g.locked).slice(-1)[0]?.id || GWS.gameweeks[0]?.id || '');

  const eSel = el('editGw');
  const keepE = eSel.value;
  eSel.innerHTML = opts + '<option value="__new__">+ New gameweek</option>';
  eSel.value = (keepE && (keepE === '__new__' || GWS.gameweeks.some(g => g.id === keepE)))
    ? keepE
    : (EDIT_ID || GWS.currentGameweekId || GWS.gameweeks.at(-1)?.id || '__new__');
}

async function refresh() {
  const [gws, res, preds] = await Promise.all([
    API.gameweeks(), API.results(), API.allPredictions().catch(() => [])
  ]);
  GWS = gws;
  RESULTS = res.results || {};
  ALL_PREDS = preds || [];
  fillSelects();
  renderResultPanel();
  await renderPraisePreview();
  loadGwForEdit(el('editGw').value);
  renderRecords();
}

async function boot() {
  el('loadingState').style.display = 'none';
  el('adminDenied').style.display  = 'none';
  el('adminApp').style.display     = '';
  await refresh();

  el('adminTabs').querySelectorAll('.tab-btn').forEach(b =>
    b.addEventListener('click', () => {
      el('adminTabs').querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      el('panel-results').style.display  = b.dataset.panel === 'results'  ? '' : 'none';
      el('panel-fixtures').style.display = b.dataset.panel === 'fixtures' ? '' : 'none';
      el('panel-records').style.display  = b.dataset.panel === 'records'  ? '' : 'none';
    }));

  el('recordGw').addEventListener('change', renderRecords);
  el('exportCsvBtn').addEventListener('click', exportCsv);

  el('resultGw').addEventListener('change', async () => { renderResultPanel(); await renderPraisePreview(); });
  el('saveResultsBtn').addEventListener('click', saveResults);
  el('editGw').addEventListener('change', () => loadGwForEdit(el('editGw').value));
  el('newGwBtn').addEventListener('click', () => { el('editGw').value = '__new__'; loadGwForEdit('__new__'); });
  el('saveGwBtn').addEventListener('click', saveGameweek);
  el('deleteGwBtn').addEventListener('click', deleteGameweek);
  el('gwDeadline').addEventListener('change', () => {
    const iso = ukLocalToUtcISO(el('gwDeadline').value);
    el('gwDeadlineEcho').textContent = iso ? `Locks ${fmtUk(iso)}` : '';
  });
}

async function checkAccess() {
  try {
    const r = await fetch('/api/admin/verify', { headers: adminHeaders() });
    if (r.ok) return boot();
  } catch {}
  el('loadingState').style.display = 'none';
  el('adminDenied').style.display  = '';
}

document.addEventListener('DOMContentLoaded', () => {
  el('adminPwBtn').addEventListener('click', async () => {
    ADMIN_PW = el('adminPw').value.trim();
    const r = await fetch('/api/admin/verify', { headers: adminHeaders() });
    if (r.ok) {
      sessionStorage.setItem('pp240_adminpw', ADMIN_PW);
      el('adminPwError').classList.add('hidden');
      boot();
    } else {
      ADMIN_PW = null;
      sessionStorage.removeItem('pp240_adminpw');
      el('adminPwError').textContent = 'That password was not accepted.';
      el('adminPwError').classList.remove('hidden');
    }
  });
  checkAccess();
});
