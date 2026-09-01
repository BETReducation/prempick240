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

// Vietnam has no DST (fixed UTC+7), so this is just a second render of the
// same instant — no wall-clock reconciliation needed like the UK side.
const VN_TZ = 'Asia/Ho_Chi_Minh';

// Fixtures in a week can span several days, so each row shows its own date.
// Date only — no kick-off time shown here, that's reserved for the deadline.
function fmtMatchDate(m) {
  const iso = m.date || m.kickoff;
  if (!iso) return '';
  const d = new Date(m.date ? m.date + 'T12:00:00Z' : m.kickoff);
  const opts = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' };
  return d.toLocaleString('en-GB', opts);
}

// UK wall-clock kick-off time, shown on the left of the fixture card.
// Only exact kick-offs have a time to show — a placeholder week with just a
// date carries no `kickoff`, so this stays blank rather than guessing.
function fmtKickoffTime(m) {
  if (!m.kickoff) return '';
  return new Date(m.kickoff).toLocaleString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
  });
}

// Players see fixtures in kick-off order regardless of how admin entered
// them. This is display-only — a sorted copy, never the stored array — so
// it can't disturb the id <-> position relationship the admin Fixtures
// editor relies on when it resaves a week.
function sortedMatches(gw) {
  const when = m => m.kickoff ? new Date(m.kickoff).getTime()
    : m.date ? new Date(m.date + 'T12:00:00Z').getTime()
    : Infinity;
  return [...gw.matches].sort((a, b) => when(a) - when(b));
}

function el(id) { return document.getElementById(id); }

function fmtLock(iso) {
  if (!iso) return 'No deadline set';
  const opts = {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit'
  };
  const uk = new Date(iso).toLocaleString('en-GB', { ...opts, timeZone: 'Europe/London' });
  const vn = new Date(iso).toLocaleString('en-GB', { ...opts, timeZone: VN_TZ });
  return `${uk} UK / ${vn} VN`;
}

function fmtLockShort(iso) {
  if (!iso) return '';
  const full = {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit'
  };
  const uk = new Date(iso).toLocaleString('en-GB', { ...full, timeZone: 'Europe/London' }).replace(',', '');
  // Mobile is space-constrained — VN side drops the date, just the time.
  const vn = new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: VN_TZ });
  return `${uk} UK / ${vn} VN`;
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
  // On mobile the strip scrolls horizontally and starts scrolled to the left,
  // so the active gameweek's own tab can sit off-screen past week 1/2. Bring
  // it into view without disturbing the rest of the page's scroll position.
  const activeTab = wrap.querySelector('.tab-btn.active');
  if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
      ${sortedMatches(gw).map((m, i) => {
        const pred = MY_PREDS[m.id] || {};
        return `
        <div class="fixture-card">
          <div class="fixture-row${gw.locked ? ' fixture-row--toggle' : ''}" data-match="${m.id}">
            <span class="fixture-kickoff">${fmtKickoffTime(m)}</span>
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
            <span class="fixture-date">${fmtMatchDate(m)}${fmtKickoffTime(m) ? `<span class="fixture-date-time">, ${fmtKickoffTime(m)}</span>` : ''}${gw.locked ? '<span class="fixture-chevron">▾</span>' : ''}</span>
          </div>
          ${gw.locked ? `<div class="fixture-preds" id="preds-${m.id}" hidden>${renderMatchPreds(m, userId, gw)}</div>` : ''}
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

  el('fixtureList').querySelectorAll('.fixture-row--toggle').forEach(row => {
    row.addEventListener('click', () => {
      const panel = el(`preds-${row.dataset.match}`);
      if (!panel) return;
      panel.hidden = !panel.hidden;
      row.classList.toggle('open', !panel.hidden);
    });
  });

  renderSaveBar(gw);
}

// Still in for this week's jackpot? Praise is only won by calling all six
// results right, so as soon as one result in the gameweek is known, anyone
// who missed it (or never predicted it) is out — regardless of which
// fixture card you're looking at. Nothing to show until a result exists.
function contentionMap(gw) {
  const decided = gw.matches.filter(mm => RESULTS[mm.id] && RESULTS[mm.id].played);
  if (!decided.length) return null;
  const map = {};
  ALL_PREDS.forEach(p => {
    map[p.id] = decided.every(mm => {
      const pick = p.predictions[mm.id];
      const r = RESULTS[mm.id];
      return pick && Math.sign(r.home - r.away) === Math.sign(pick.home - pick.away);
    });
  });
  return map;
}

// Once a week locks, everyone's picks for a single fixture become public —
// that's half the fun. Rendered into the collapsible panel under each card;
// before the lock the server withholds picks, so callers never get here.
function renderMatchPreds(m, userId, gw) {
  const r = RESULTS[m.id];
  const rows = ALL_PREDS
    .map(p => ({ ...p, pick: p.predictions[m.id] }))
    .filter(p => p.pick);

  if (!rows.length) return '<p class="empty fixture-preds-empty">Nobody predicted this one.</p>';

  const contention = contentionMap(gw);

  rows.forEach(p => {
    let cls = '';
    if (r && r.played) {
      const right = Math.sign(r.home - r.away) === Math.sign(p.pick.home - p.pick.away);
      const exact = p.pick.home === r.home && p.pick.away === r.away;
      cls = exact ? 'exact' : (right ? 'hit' : 'miss');
    }
    p.cls = cls;
  });
  // Called-it-right players first, so a glance at the top of the list shows who nailed it.
  const order = { exact: 0, hit: 1, '': 2, miss: 2 };
  rows.sort((a, b) => (order[a.cls] - order[b.cls]) || a.name.localeCompare(b.name));

  return `
    ${r && r.played ? `<div class="fixture-pred-row fixture-pred-actual"><span>Actual</span><span>${r.home}–${r.away}</span></div>` : ''}
    ${rows.map(p => `
      <div class="fixture-pred-row${p.cls ? ' ' + p.cls : ''}${p.id === userId ? ' is-me' : ''}">
        <span>${contention ? `<span class="jackpot-dot ${contention[p.id] ? 'in' : 'out'}" title="${contention[p.id] ? 'Still in for the jackpot' : 'Out of the jackpot'}"></span>` : ''}${esc(p.displayName || p.name)}</span>
        <span>${p.pick.home}–${p.pick.away}</span>
      </div>`).join('')}`;
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
