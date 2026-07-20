// Fixtures page — the front page. Shows each gameweek's six fixtures and,
// for signed-in players, lets them enter scores until the week locks.

let GW_DATA    = null;   // /api/gameweeks payload
let RESULTS    = {};     // matchId -> { home, away, played }
let MY_PREDS   = {};     // matchId -> { home, away }
let ACTIVE_GW  = null;   // gameweek id currently shown
let DIRTY      = false;

const COMP_LABEL = { PL: 'Premier League', CH: 'Championship' };

function el(id) { return document.getElementById(id); }

function fmtLock(iso) {
  if (!iso) return 'No deadline set';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/London'   // it's a UK league — show UK time to everyone
  });
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
    banner.innerHTML = `<div class="lock-notice">
      <i class="fa-regular fa-clock"></i>
      <span>Deadline <strong>${fmtLock(gw.lockTime)}</strong>${left ? ` — ${left} left` : ''}.</span>
    </div>`;
  }
}

function renderFixtures(gw) {
  const { userId } = Session.load();
  const editable = !gw.locked && !!userId;

  el('fixtureList').innerHTML = `
    <div class="fixture-grid">
      ${gw.matches.map((m, i) => {
        const pred   = MY_PREDS[m.id] || {};
        const result = RESULTS[m.id];
        const scored = result && result.played;

        // Once a result is in, show how the player's call went.
        let outcome = '';
        if (scored && pred.home != null) {
          const rightResult = Math.sign(result.home - result.away) === Math.sign(pred.home - pred.away);
          const rightScore  = pred.home === result.home && pred.away === result.away;
          outcome = `<span class="pred-outcome ${rightResult ? 'hit' : 'miss'}">
            ${rightResult ? '<i class="fa-solid fa-check"></i> Result' : '<i class="fa-solid fa-xmark"></i> Missed'}
            ${rightScore ? ' <i class="fa-solid fa-bullseye"></i> Exact' : ''}
          </span>`;
        }

        return `
        <div class="fixture-row${scored ? ' played' : ''}">
          <span class="fixture-comp comp-${m.comp.toLowerCase()}" title="${COMP_LABEL[m.comp] || m.comp}">${m.comp}</span>
          <span class="fixture-team home">${m.home}</span>
          <div class="fixture-scores">
            <input type="number" class="score-input" data-match="${m.id}" data-side="home"
                   min="0" max="99" inputmode="numeric" value="${pred.home ?? ''}" ${editable ? '' : 'disabled'}>
            <span class="fixture-v">v</span>
            <input type="number" class="score-input" data-match="${m.id}" data-side="away"
                   min="0" max="99" inputmode="numeric" value="${pred.away ?? ''}" ${editable ? '' : 'disabled'}>
          </div>
          <span class="fixture-team away">${m.away}</span>
          <span class="fixture-actual">${scored ? `${result.home}–${result.away}` : ''}</span>
          ${outcome}
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

  // Save controls only make sense on an open week for a signed-in player.
  el('saveBar').style.display  = editable ? '' : 'none';
  el('clearBtn').style.display = editable ? '' : 'none';
}

function render() {
  const gw = GW_DATA.gameweeks.find(g => g.id === ACTIVE_GW);
  if (!gw) return;
  el('gwLabel').textContent = gw.locked ? `${gw.label} · Locked` : `${gw.label} · Open`;
  renderTabs();
  renderBanner(gw);
  renderFixtures(gw);
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function save() {
  const { userId } = Session.load();
  if (!userId) return;

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
    status.textContent = incomplete
      ? `Saved — ${incomplete} fixture${incomplete > 1 ? 's' : ''} still incomplete.`
      : `Saved all ${Object.keys(payload).length} predictions.`;
    status.className = 'save-status ' + (incomplete ? 'warn' : 'ok');
    if (r.rejected) status.textContent += ` (${r.rejected} rejected — deadline passed)`;
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
  render();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const [gws, results] = await Promise.all([API.gameweeks(), API.results()]);
    GW_DATA = gws;
    RESULTS = results.results || {};

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
    window.addEventListener('beforeunload', e => { if (DIRTY) e.preventDefault(); });
  } catch (e) {
    el('loadingState').innerHTML = `<p>Could not load fixtures — ${e.message}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
