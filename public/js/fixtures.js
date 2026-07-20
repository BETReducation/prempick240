// Fixtures page — the front page. Shows each gameweek's six fixtures and,
// for signed-in players, lets them enter scores until the week locks.

let GW_DATA    = null;   // /api/gameweeks payload
let RESULTS    = {};     // matchId -> { home, away, played }
let MY_PREDS   = {};     // matchId -> { home, away }
let ACTIVE_GW  = null;   // gameweek id currently shown
let DIRTY      = false;
let ALL_PREDS  = [];     // every player's predictions — server only exposes locked weeks
let EDITING    = false;  // true = inputs live; false = picks shown as saved text

const COMP_LABEL = { PL: 'Premier League', CH: 'Championship', CUP: 'Cup tie' };

// Fixtures in a week can span several days, so each row shows its own date.
function fmtMatchDate(m) {
  const iso = m.date || m.kickoff;
  if (!iso) return '';
  const d = new Date(m.date ? m.date + 'T12:00:00Z' : m.kickoff);
  const opts = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' };
  // Only show a time when we actually know one.
  if (!m.date && m.kickoff) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return d.toLocaleString('en-GB', opts);
}

function el(id) { return document.getElementById(id); }

function fmtLock(iso) {
  if (!iso) return 'No deadline set';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/London'   // it's a UK league — show UK time to everyone
  });
}

function fmtLockShort(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/London'
  }).replace(',', '');
}

function countdown(iso) {
  const ms = new Date(iso) - new Date();
  if (ms <= 0) return null;
  const mins  = Math.floor(ms / 60000);
  const days  = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days  > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderTabs() {
  const wrap = el('gwTabs');
  wrap.innerHTML = GW_DATA.gameweeks.map(gw => `
    <button class="tab-btn${gw.id === ACTIVE_GW ? ' active' : ''}" data-gw="${gw.id}">
      ${gw.label}${gw.complete ? ' <i class="fa-solid fa-check" style="font-size:10px;opacity:.6;"></i>' : ''}
    </button>
  `).join('');
  wrap.querySelectorAll('.tab-btn').forEach(t =>
    t.addEventListener('click', () => {
      if (DIRTY && !confirm('You have unsaved predictions. Switch week anyway?')) return;
      ACTIVE_GW = t.dataset.gw;
      DIRTY = false;
      render();
    })
  );
}

function renderBanner(gw) {
  const banner = el('lockBanner');
  const { userId } = Session.load();

  if (gw.locked) {
    banner.innerHTML = `<div class="lock-notice locked">
      <i class="fa-solid fa-lock"></i>
      <span>${gw.label} locked at ${fmtLock(gw.lockTime)}. Everyone's predictions are now visible.</span>
    </div>`;
  } else if (!userId) {
    banner.innerHTML = `<div class="lock-notice">
      <i class="fa-solid fa-circle-info"></i>
      <span>Sign in to enter your predictions. Deadline: <strong>${fmtLock(gw.lockTime)}</strong>.</span>
    </div>`;
  } else {
    const left = countdown(gw.lockTime);
    // Two renderings: the full sentence for desktop, a terse one for the
    // mobile strip where it shares a row with the gameweek tabs.
    banner.innerHTML = `<div class="lock-notice">
      <i class="fa-regular fa-clock"></i>
      <span class="lock-full">Deadline <strong>${fmtLock(gw.lockTime)}</strong>${left ? ` — ${left} left` : ''}.</span>
      <span class="lock-short"><strong>${fmtLockShort(gw.lockTime)}</strong>${left ? `<span class="lock-left">${left} left</span>` : ''}</span>
    </div>`;
  }
}

function hasSavedPicks(gw) {
  return gw.matches.some(m => MY_PREDS[m.id] &&
    MY_PREDS[m.id].home != null && MY_PREDS[m.id].away != null);
}

// Save / Edit state. A week you've already submitted opens in the saved view,
// so the button reading "Edit Predictions" is itself the confirmation that
// something is stored — which a status message alone failed to convey.
function renderSaveBar(gw) {
  const { userId } = Session.load();
  const bar = el('saveBar');
  if (gw.locked || !userId) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  el('saveBtn').style.display  = EDITING ? '' : 'none';
  el('clearBtn').style.display = EDITING ? '' : 'none';
  el('editBtn').style.display  = EDITING ? 'none' : '';
}

function renderFixtures(gw) {
  const { userId } = Session.load();
  const editable = !gw.locked && !!userId && EDITING;

  el('fixtureList').innerHTML = `
    <div class="fixture-grid">
      ${gw.matches.map((m, i) => {
        const pred = MY_PREDS[m.id] || {};
        return `
        <div class="fixture-row">
          ${m.comp && m.comp !== 'PL'
            ? `<span class="fixture-comp comp-${m.comp.toLowerCase()}" title="${COMP_LABEL[m.comp] || m.comp}">${m.comp}</span>`
            : '<span class="fixture-comp-none"></span>'}
          <span class="fixture-team home">${m.home}</span>
          <div class="fixture-scores">
            ${editable ? `
              <input type="number" class="score-input" data-match="${m.id}" data-side="home"
                     min="0" max="99" inputmode="numeric" value="${pred.home ?? ''}">
              <span class="fixture-v">v</span>
              <input type="number" class="score-input" data-match="${m.id}" data-side="away"
                     min="0" max="99" inputmode="numeric" value="${pred.away ?? ''}">
            ` : `
              <span class="fixture-mypick${pred.home == null ? ' none' : ''}">${
                pred.home == null ? '—' : `${pred.home}–${pred.away}`
              }</span>
            `}
          </div>
          <span class="fixture-team away">${m.away}</span>
          <span class="fixture-date">${fmtMatchDate(m)}</span>
        </div>`;
      }).join('')}
    </div>`;

  el('fixtureList').querySelectorAll('.score-input').forEach(input => {
    input.addEventListener('input', () => {
      const m = input.dataset.match, side = input.dataset.side;
      const v = input.value === '' ? null : Math.max(0, Math.min(99, parseInt(input.value)));
      if (!MY_PREDS[m]) MY_PREDS[m] = {};
      MY_PREDS[m][side] = isNaN(v) ? null : v;
      DIRTY = true;
      el('saveStatus').textContent = '';
    });
  });

  renderSaveBar(gw);
  renderEveryonesPredictions(gw);
}

// Once a week locks, everyone's picks become public — that's half the fun.
// Before the lock the server withholds them, so there's nothing to show.
function renderEveryonesPredictions(gw) {
  const box = el('allPreds');
  if (!box) return;

  if (!gw.locked) {
    box.innerHTML = '';
    return;
  }

  // Only players who actually entered something for this week.
  const rows = ALL_PREDS
    .map(p => ({ ...p, picks: gw.matches.map(m => p.predictions[m.id]) }))
    .filter(p => p.picks.some(Boolean));

  if (!rows.length) {
    box.innerHTML = '<p class="empty">Nobody entered predictions for this week.</p>';
    return;
  }

  const { userId } = Session.load();

  // Rank by results called right, so the table doubles as the week's scoreboard.
  rows.forEach(p => {
    p.correct = gw.matches.reduce((n, m, i) => {
      const r = RESULTS[m.id], pr = p.picks[i];
      if (!r || !r.played || !pr) return n;
      return n + (Math.sign(r.home - r.away) === Math.sign(pr.home - pr.away) ? 1 : 0);
    }, 0);
    p.exact = gw.matches.reduce((n, m, i) => {
      const r = RESULTS[m.id], pr = p.picks[i];
      if (!r || !r.played || !pr) return n;
      return n + (pr.home === r.home && pr.away === r.away ? 1 : 0);
    }, 0);
  });
  rows.sort((a, b) => b.correct - a.correct || b.exact - a.exact || a.name.localeCompare(b.name));

  const anyResults = gw.matches.some(m => RESULTS[m.id]?.played);

  box.innerHTML = `
    <h3 class="subsection-title">Everyone's predictions</h3>
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
            <tr class="${p.id === userId ? 'is-me' : ''}">
              <td class="col-player">${esc(p.displayName || p.name)}</td>
              ${gw.matches.map((m, i) => {
                const pr = p.picks[i], r = RESULTS[m.id];
                if (!pr) return '<td class="col-fx muted">—</td>';
                let cls = '';
                if (r && r.played) {
                  const right = Math.sign(r.home - r.away) === Math.sign(pr.home - pr.away);
                  const exact = pr.home === r.home && pr.away === r.away;
                  cls = exact ? ' exact' : (right ? ' hit' : ' miss');
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

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function render() {
  const gw = GW_DATA.gameweeks.find(g => g.id === ACTIVE_GW);
  if (!gw) return;
  const { userId } = Session.load();
  // Nothing saved yet for this week? Go straight into entry mode.
  if (userId && !gw.locked && !DIRTY && !hasSavedPicks(gw)) EDITING = true;
  el('gwLabel').textContent = gw.locked ? `${gw.label} · Locked` : `${gw.label} · Open`;
  renderTabs();
  renderBanner(gw);
  renderFixtures(gw);
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function save() {
  // Close the on-screen keyboard first. On iOS a sticky bottom bar can sit
  // behind the keyboard, and the status message below is hidden by it — so
  // the save looks like it did nothing even when it worked.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  const { userId } = Session.load();
  if (!userId) {
    const st = el('saveStatus');
    st.textContent = 'You are signed out — sign in again to save.';
    st.className = 'save-status err';
    return;
  }

  const gw = GW_DATA.gameweeks.find(g => g.id === ACTIVE_GW);
  const payload = {};
  let incomplete = 0;

  for (const m of gw.matches) {
    const p = MY_PREDS[m.id];
    if (!p) continue;
    if (p.home == null || p.away == null) { incomplete++; continue; }
    payload[m.id] = { home: p.home, away: p.away };
  }

  const status = el('saveStatus');
  try {
    el('saveBtn').disabled = true;
    const r = await API.savePredictions(userId, payload, [gw.id]);
    DIRTY = false;
    const n = Object.keys(payload).length;
    status.textContent = incomplete
      ? `Saved ${n} — ${incomplete} fixture${incomplete > 1 ? 's' : ''} still need both scores.`
      : (n ? `Saved all ${n} predictions.` : 'Nothing to save — enter both scores for a fixture.');
    status.className = 'save-status ' + (incomplete || !n ? 'warn' : 'ok');
    if (r.rejected) status.textContent += ` (${r.rejected} rejected — deadline passed)`;

    if (n) {
      // Flash the confirmation on the button, then drop into the saved view.
      const btn = el('saveBtn');
      btn.textContent = '✓ Saved';
      btn.classList.add('btn-saved');
      setTimeout(() => {
        btn.textContent = 'Save Predictions';
        btn.classList.remove('btn-saved');
        EDITING = false;
        render();
      }, 1400);
    }
  } catch (e) {
    status.textContent = 'Could not save — ' + (e.message || 'try again');
    status.className = 'save-status err';
  } finally {
    el('saveBtn').disabled = false;
  }
}

function clearWeek() {
  const gw = GW_DATA.gameweeks.find(g => g.id === ACTIVE_GW);
  if (!confirm(`Clear your predictions for ${gw.label}?`)) return;
  gw.matches.forEach(m => { delete MY_PREDS[m.id]; });
  DIRTY = true;
  EDITING = true;
  render();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const [gws, results, all] = await Promise.all([
      API.gameweeks(), API.results(), API.allPredictions().catch(() => [])
    ]);
    GW_DATA = gws;
    RESULTS = results.results || {};
    ALL_PREDS = all || [];

    if (!GW_DATA.gameweeks.length) {
      el('loadingState').innerHTML = '<p>No gameweeks published yet. Check back soon.</p>';
      return;
    }

    const { userId } = Session.load();
    if (userId) {
      try {
        const mine = await API.myPredictions(userId);
        MY_PREDS = mine.predictions || {};
      } catch { MY_PREDS = {}; }
    }

    ACTIVE_GW = GW_DATA.currentGameweekId || GW_DATA.gameweeks[GW_DATA.gameweeks.length - 1].id;
    el('loadingState').style.display = 'none';
    el('fixturesApp').style.display  = '';
    render();

    el('saveBtn').addEventListener('click', save);
    el('clearBtn').addEventListener('click', clearWeek);
    el('editBtn').addEventListener('click', () => {
      EDITING = true;
      render();
      el('saveStatus').textContent = '';
    });
    window.addEventListener('beforeunload', e => { if (DIRTY) e.preventDefault(); });
  } catch (e) {
    el('loadingState').innerHTML = `<p>Could not load fixtures — ${e.message}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
