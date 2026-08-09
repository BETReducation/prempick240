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
let USERS     = [];    // /api/users — { id, name } for cup/international player pickers
let CUP       = { rounds: [] };
let INTL      = { groups: [] };

const COMPS = ['PL', 'CH', 'CUP', 'INTL'];
const COMP_NAME = { PL: 'Premier League', CH: 'Championship', CUP: 'Cup', INTL: 'International' };

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

// The deadline isn't typed in any more — it's always the earliest kick-off
// among the fixtures below. This reads the live form state, not saved data,
// so it updates as kick-offs are edited (see the input listener below).
function earliestKickoffIso() {
  const isos = [...el('fixtureRows').querySelectorAll('.fx-kickoff')]
    .map(input => input.value ? ukLocalToUtcISO(input.value) : null)
    .filter(Boolean);
  if (!isos.length) return null;
  return isos.reduce((min, iso) => iso < min ? iso : min);
}

function updateDeadlineEcho() {
  const iso = earliestKickoffIso();
  el('gwDeadlineEcho').textContent = iso
    ? `Locks ${fmtUk(iso)} — the earliest kick-off above.`
    : 'Set kick-off times below — the deadline is always the earliest one.';
}

function renderFixtureEditor(gw) {
  el('gwNumber').value   = gw.number ?? '';
  el('gwLabel').value    = gw.label ?? '';
  el('saveGwBtn').textContent = 'Save Gameweek';

  const matches = (gw.matches && gw.matches.length)
    ? gw.matches
    : Array.from({ length: 6 }, (_, i) => blankMatch(i));

  el('fixtureRows').innerHTML = `
    <div class="admin-rows">
      <div class="admin-row edit admin-row-head" aria-hidden="true">
        <span>Comp</span>
        <span>Home</span>
        <span></span>
        <span>Away</span>
        <span>Kick-off (UK)</span>
      </div>
      ${matches.map((m, i) => `
        <div class="admin-row edit" data-i="${i}">
          <select class="fx-comp" data-i="${i}">
            ${COMPS.map(c => `<option value="${c}" ${m.comp === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
          <input type="text" class="fx-home" data-i="${i}" value="${esc(m.home)}" placeholder="Home team" maxlength="60">
          <span class="fixture-v">v</span>
          <input type="text" class="fx-away" data-i="${i}" value="${esc(m.away)}" placeholder="Away team" maxlength="60">
          <input type="datetime-local" class="fx-kickoff" data-i="${i}" value="${esc(utcISOToUkLocal(m.kickoff))}" title="Kick-off, UK time. The earliest kick-off in the week is the prediction deadline; the latest is what the 'This week' count resets against, ~2h after it.">
        </div>`).join('')}
    </div>`;
  updateDeadlineEcho();
}
el('fixtureRows')?.addEventListener('input', e => {
  if (e.target.classList.contains('fx-kickoff')) updateDeadlineEcho();
});

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
  const lockTime = earliestKickoffIso();

  if (!Number.isInteger(number)) { status.textContent = 'Week number is required.'; status.className = 'save-status err'; return; }
  if (!lockTime) { status.textContent = 'Set at least one kick-off time — that\'s what sets the deadline.'; status.className = 'save-status err'; return; }

  // [data-i] excludes the header row — it shares .admin-row.edit for styling
  // but carries no data-i, so including it here throws (null.value) on save.
  const rows = [...el('fixtureRows').querySelectorAll('.admin-row.edit[data-i]')];
  const matches = rows.map(r => {
    const i = r.dataset.i;
    return {
      comp: el('fixtureRows').querySelector(`.fx-comp[data-i="${i}"]`).value,
      home: el('fixtureRows').querySelector(`.fx-home[data-i="${i}"]`).value.trim(),
      away: el('fixtureRows').querySelector(`.fx-away[data-i="${i}"]`).value.trim(),
      // No separate `date` field any more — the server derives the display
      // date from `kickoff` (UK calendar day). See ukDateOnly() in server.js.
      kickoff: (() => {
        const ko = el('fixtureRows').querySelector(`.fx-kickoff[data-i="${i}"]`).value;
        return ko ? ukLocalToUtcISO(ko) : null;
      })()
    };
  }).filter(m => m.home && m.away);

  if (matches.length !== 6 &&
      !confirm(`You've filled in ${matches.length} fixtures, not 6. A week needs all six for anyone to win praise. Save anyway?`)) return;

  // A new gameweek's id must NOT be derived from `number` — two different
  // weeks that briefly share a number (e.g. a mislabel, or editing an
  // existing week's number instead of hitting "+ New gameweek") would then
  // collide on save and silently overwrite each other. Real incident: this
  // is exactly how a saved Gameweek 3 vanished after making a fresh
  // Gameweek 2 — both computed id "gw2". Match Cup/International's own
  // id scheme (Date.now, base36) instead.
  const id = EDIT_ID === '__new__' ? `gw_${Date.now().toString(36)}` : EDIT_ID;

  const clash = GWS.gameweeks.find(g => g.number === number && g.id !== id);
  if (clash && !confirm(
    `Gameweek ${number} already exists ("${clash.label}") — saving will overwrite it. Continue?`
  )) return;

  const payload = {
    id, number, label: label || `Gameweek ${number}`,
    lockTime,
    matches: matches.map((m, i) => ({ ...m, id: `${id}-m${i + 1}` })),
    ...(clash ? { allowNumberClash: true } : {})
  };

  el('saveGwBtn').disabled = true;
  status.textContent = 'Saving…'; status.className = 'save-status';
  try {
    await adminFetch('/api/admin/gameweeks', { method: 'POST', body: JSON.stringify(payload) });
    await refresh();
    EDIT_ID = id;
    status.textContent = `Saved — locks ${fmtUk(payload.lockTime)}.`;
    status.className = 'save-status ok';
    // Flip the button to a "saved" state so it's obvious the save landed.
    // Editing any field (below) flips it back to "Save Gameweek".
    el('saveGwBtn').textContent = 'Edit Gameweek';
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
  const [gws, res, preds, users, cup, intl] = await Promise.all([
    // Admin headers so this returns every week, including future ones not yet
    // revealed to players.
    adminFetch('/api/gameweeks'), API.results(), API.allPredictions().catch(() => []),
    API.users().catch(() => []),
    adminFetch('/api/admin/cup').catch(() => ({ rounds: [] })),
    adminFetch('/api/admin/international-league').catch(() => ({ groups: [] }))
  ]);
  GWS = gws;
  RESULTS = res.results || {};
  ALL_PREDS = preds || [];
  USERS = users || [];
  CUP  = { rounds: (cup.rounds || []).map(r => ({ ...r, ties: (r.ties || []).map(t => ({ replayGameweekIds: [], ...t })) })) };
  INTL = { groups: (intl.groups || []).map(g => ({ playerIds: [], matchdays: [], ...g })) };
  fillSelects();
  renderResultPanel();
  await renderPraisePreview();
  loadGwForEdit(el('editGw').value);
  renderRecords();
  renderCupPanel();
  renderIntlPanel();
}

// ── Cup ──────────────────────────────────────────────────────────────────────
// A tie carries only ids; its score is derived server-side from the assigned
// gameweek's results, so there's nothing to type here but structure.

function playerOptions(selected) {
  return `<option value="">— player —</option>` + USERS.map(u =>
    `<option value="${u.id}" ${u.id === selected ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
}
function gwOptions(selected) {
  return `<option value="">— gameweek —</option>` + (GWS?.gameweeks || []).map(g =>
    `<option value="${g.id}" ${g.id === selected ? 'selected' : ''}>${esc(g.label || 'Gameweek ' + g.number)}</option>`).join('');
}

function renderCupPanel() {
  el('cupRounds').innerHTML = CUP.rounds.map((round, ri) => `
    <div class="admin-grid" style="margin-bottom:8px;">
      <div class="form-group">
        <label>Round name</label>
        <input type="text" data-cup-round-name="${ri}" value="${esc(round.name || '')}" placeholder="First Round">
      </div>
      <div class="form-group">
        <label>Gameweek</label>
        <select data-cup-round-gw="${ri}">${gwOptions(round.gameweekId)}</select>
      </div>
      <div class="form-group" style="align-self:end;">
        <button class="btn btn-danger btn-sm" data-cup-remove-round="${ri}">Remove round</button>
      </div>
    </div>
    ${(round.ties || []).map((tie, ti) => `
      <div class="admin-grid" style="margin-left:16px;">
        <div class="form-group">
          <label>Player A</label>
          <select data-cup-tie-a="${ri}.${ti}">${playerOptions(tie.playerA)}</select>
        </div>
        <div class="form-group">
          <label>Player B <span style="color:var(--muted);font-size:11px;">(blank = bye)</span></label>
          <select data-cup-tie-b="${ri}.${ti}">${playerOptions(tie.playerB)}</select>
        </div>
        <div class="form-group" style="align-self:end;">
          <button class="btn btn-danger btn-sm" data-cup-remove-tie="${ri}.${ti}">Remove tie</button>
        </div>
      </div>
      ${(tie.replayGameweekIds || []).map((gwId, gi) => `
        <div class="admin-grid" style="margin-left:32px;">
          <div class="form-group">
            <label>Replay ${gi + 1}</label>
            <select data-cup-replay="${ri}.${ti}.${gi}">${gwOptions(gwId)}</select>
          </div>
        </div>`).join('')}
      <div class="admin-bar" style="margin-left:16px;">
        <button class="btn btn-outline btn-sm" data-cup-add-replay="${ri}.${ti}">+ Add replay</button>
      </div>
    `).join('')}
    <div class="admin-bar" style="margin-left:16px;">
      <button class="btn btn-outline btn-sm" data-cup-add-tie="${ri}">+ Add tie</button>
    </div>
  `).join('') || '<p class="empty">No rounds yet — add one below.</p>';
}

el('cupRounds')?.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.cupRoundName !== undefined) return; // input, not select
  if (t.dataset.cupRoundGw !== undefined) CUP.rounds[t.dataset.cupRoundGw].gameweekId = t.value || null;
  if (t.dataset.cupTieA !== undefined) {
    const [ri, ti] = t.dataset.cupTieA.split('.').map(Number);
    CUP.rounds[ri].ties[ti].playerA = t.value || null;
  }
  if (t.dataset.cupTieB !== undefined) {
    const [ri, ti] = t.dataset.cupTieB.split('.').map(Number);
    CUP.rounds[ri].ties[ti].playerB = t.value || null;
  }
  if (t.dataset.cupReplay !== undefined) {
    const [ri, ti, gi] = t.dataset.cupReplay.split('.').map(Number);
    CUP.rounds[ri].ties[ti].replayGameweekIds[gi] = t.value || null;
  }
});
el('cupRounds')?.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.cupRoundName !== undefined) CUP.rounds[t.dataset.cupRoundName].name = t.value;
});
el('cupRounds')?.addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.cupRemoveRound !== undefined) { CUP.rounds.splice(t.dataset.cupRemoveRound, 1); renderCupPanel(); }
  if (t.dataset.cupAddTie !== undefined) {
    CUP.rounds[t.dataset.cupAddTie].ties.push({ id: 'tie_' + Date.now().toString(36), playerA: null, playerB: null, replayGameweekIds: [] });
    renderCupPanel();
  }
  if (t.dataset.cupRemoveTie !== undefined) {
    const [ri, ti] = t.dataset.cupRemoveTie.split('.').map(Number);
    CUP.rounds[ri].ties.splice(ti, 1); renderCupPanel();
  }
  if (t.dataset.cupAddReplay !== undefined) {
    const [ri, ti] = t.dataset.cupAddReplay.split('.').map(Number);
    CUP.rounds[ri].ties[ti].replayGameweekIds.push(null); renderCupPanel();
  }
});

async function saveCup() {
  el('cupStatus').textContent = 'Saving…';
  try {
    await adminFetch('/api/admin/cup', { method: 'POST', body: JSON.stringify({ rounds: CUP.rounds }) });
    el('cupStatus').textContent = '✓ Saved';
    setTimeout(() => el('cupStatus').textContent = '', 2000);
  } catch (e) {
    el('cupStatus').textContent = 'Error: ' + e.message;
  }
}

// ── International League ─────────────────────────────────────────────────────

function renderIntlPanel() {
  el('intlGroups').innerHTML = INTL.groups.map((group, gi) => `
    <div class="admin-grid" style="margin-bottom:8px;">
      <div class="form-group">
        <label>Group name</label>
        <input type="text" data-intl-group-name="${gi}" value="${esc(group.name || '')}" placeholder="Group A">
      </div>
      <div class="form-group" style="align-self:end;">
        <button class="btn btn-danger btn-sm" data-intl-remove-group="${gi}">Remove group</button>
      </div>
    </div>
    <p class="admin-hint" style="margin-left:16px;">Players</p>
    <div class="admin-bar" style="margin-left:16px;flex-wrap:wrap;">
      ${(group.playerIds || []).map((pid, pi) => `
        <select data-intl-player="${gi}.${pi}">${playerOptions(pid)}</select>`).join('')}
      <button class="btn btn-outline btn-sm" data-intl-add-player="${gi}">+ Add player</button>
    </div>
    <p class="admin-hint" style="margin-left:16px;">Matchdays</p>
    ${(group.matchdays || []).map((md, mi) => `
      <div class="admin-grid" style="margin-left:16px;">
        <div class="form-group">
          <label>Matchday ${mi + 1} gameweek</label>
          <select data-intl-md-gw="${gi}.${mi}">${gwOptions(md.gameweekId)}</select>
        </div>
        <div class="form-group" style="align-self:end;">
          <button class="btn btn-danger btn-sm" data-intl-remove-md="${gi}.${mi}">Remove matchday</button>
        </div>
      </div>
      ${(md.fixtures || []).map((fx, fi) => `
        <div class="admin-grid" style="margin-left:32px;">
          <div class="form-group"><label>Home</label><select data-intl-fx-home="${gi}.${mi}.${fi}">${playerOptions(fx.home)}</select></div>
          <div class="form-group"><label>Away</label><select data-intl-fx-away="${gi}.${mi}.${fi}">${playerOptions(fx.away)}</select></div>
          <div class="form-group" style="align-self:end;"><button class="btn btn-danger btn-sm" data-intl-remove-fx="${gi}.${mi}.${fi}">Remove fixture</button></div>
        </div>`).join('')}
      <div class="admin-bar" style="margin-left:32px;">
        <button class="btn btn-outline btn-sm" data-intl-add-fx="${gi}.${mi}">+ Add fixture</button>
      </div>
    `).join('')}
    <div class="admin-bar" style="margin-left:16px;">
      <button class="btn btn-outline btn-sm" data-intl-add-md="${gi}">+ Add matchday</button>
    </div>
  `).join('') || '<p class="empty">No groups yet — add one below.</p>';
}

el('intlGroups')?.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.intlGroupName !== undefined) INTL.groups[t.dataset.intlGroupName].name = t.value;
});
el('intlGroups')?.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.intlPlayer !== undefined) {
    const [gi, pi] = t.dataset.intlPlayer.split('.').map(Number);
    INTL.groups[gi].playerIds[pi] = t.value || null;
  }
  if (t.dataset.intlMdGw !== undefined) {
    const [gi, mi] = t.dataset.intlMdGw.split('.').map(Number);
    INTL.groups[gi].matchdays[mi].gameweekId = t.value || null;
  }
  if (t.dataset.intlFxHome !== undefined) {
    const [gi, mi, fi] = t.dataset.intlFxHome.split('.').map(Number);
    INTL.groups[gi].matchdays[mi].fixtures[fi].home = t.value || null;
  }
  if (t.dataset.intlFxAway !== undefined) {
    const [gi, mi, fi] = t.dataset.intlFxAway.split('.').map(Number);
    INTL.groups[gi].matchdays[mi].fixtures[fi].away = t.value || null;
  }
});
el('intlGroups')?.addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.intlRemoveGroup !== undefined) { INTL.groups.splice(t.dataset.intlRemoveGroup, 1); renderIntlPanel(); }
  if (t.dataset.intlAddPlayer !== undefined) { INTL.groups[t.dataset.intlAddPlayer].playerIds.push(null); renderIntlPanel(); }
  if (t.dataset.intlAddMd !== undefined) {
    INTL.groups[t.dataset.intlAddMd].matchdays.push({ gameweekId: null, fixtures: [] }); renderIntlPanel();
  }
  if (t.dataset.intlRemoveMd !== undefined) {
    const [gi, mi] = t.dataset.intlRemoveMd.split('.').map(Number);
    INTL.groups[gi].matchdays.splice(mi, 1); renderIntlPanel();
  }
  if (t.dataset.intlAddFx !== undefined) {
    const [gi, mi] = t.dataset.intlAddFx.split('.').map(Number);
    INTL.groups[gi].matchdays[mi].fixtures.push({ home: null, away: null }); renderIntlPanel();
  }
  if (t.dataset.intlRemoveFx !== undefined) {
    const [gi, mi, fi] = t.dataset.intlRemoveFx.split('.').map(Number);
    INTL.groups[gi].matchdays[mi].fixtures.splice(fi, 1); renderIntlPanel();
  }
});
el('addIntlGroupBtn')?.addEventListener('click', () => {
  INTL.groups.push({ id: 'grp_' + Date.now().toString(36), name: '', playerIds: [], matchdays: [] });
  renderIntlPanel();
});

async function saveIntl() {
  el('intlStatus').textContent = 'Saving…';
  try {
    await adminFetch('/api/admin/international-league', { method: 'POST', body: JSON.stringify({ groups: INTL.groups }) });
    el('intlStatus').textContent = '✓ Saved';
    setTimeout(() => el('intlStatus').textContent = '', 2000);
  } catch (e) {
    el('intlStatus').textContent = 'Error: ' + e.message;
  }
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
      el('panel-cup').style.display          = b.dataset.panel === 'cup'          ? '' : 'none';
      el('panel-international').style.display = b.dataset.panel === 'international' ? '' : 'none';
    }));

  el('recordGw').addEventListener('change', renderRecords);
  el('exportCsvBtn').addEventListener('click', exportCsv);
  el('downloadXlsxBtn').addEventListener('click', async () => {
    el('downloadXlsxBtn').disabled = true;
    try { await API.downloadExcel(ADMIN_PW); }
    catch (e) { alert('Could not download workbook: ' + e.message); }
    finally { el('downloadXlsxBtn').disabled = false; }
  });

  el('addCupRoundBtn').addEventListener('click', () => {
    CUP.rounds.push({ id: 'round_' + Date.now().toString(36), name: '', gameweekId: null, ties: [] });
    renderCupPanel();
  });
  el('saveCupBtn').addEventListener('click', saveCup);
  el('saveIntlBtn').addEventListener('click', saveIntl);

  el('resultGw').addEventListener('change', async () => { renderResultPanel(); await renderPraisePreview(); });
  el('saveResultsBtn').addEventListener('click', saveResults);
  el('editGw').addEventListener('change', () => loadGwForEdit(el('editGw').value));
  el('newGwBtn').addEventListener('click', () => { el('editGw').value = '__new__'; loadGwForEdit('__new__'); });
  el('saveGwBtn').addEventListener('click', saveGameweek);
  el('deleteGwBtn').addEventListener('click', deleteGameweek);
  // Once saved the button reads "Edit Gameweek"; any edit means there are
  // unsaved changes again, so flip it back to "Save Gameweek".
  el('panel-fixtures').addEventListener('input', () => {
    if (el('saveGwBtn').textContent !== 'Save Gameweek') el('saveGwBtn').textContent = 'Save Gameweek';
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
