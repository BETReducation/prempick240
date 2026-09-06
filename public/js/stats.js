// Stats page — Form Guide, Manager Of The Week, and the Praise ledger.
// Split out of ranking.js so the Ranking page stays a single "the table"
// view; this page is everything else that page used to also carry.

function el(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

// Praise is points, not percent. Shares can be fractional when several players
// split a pot, so allow one decimal but never render 13.333333333333334.
function pts(n) {
  return Number(Math.round(Number(n) * 10) / 10).toLocaleString('en-GB');
}

// Form Guide: same rolling-last-6-played-weeks idea the original workbook
// drove with OFFSET off `Week Record` — here it's just a slice of
// `perGameweek` (already returned by /api/leaderboard), sorted by that total.
function renderFormGuide(board, gws) {
  const played = gws.gameweeks.filter(g => g.complete).sort((a, b) => a.number - b.number);
  const lastSix = played.slice(-6);

  const rows = board.map(p => {
    const weekScores = lastSix.map(g => p.perGameweek[g.id]?.resultPoints);
    const total = lastSix.length ? weekScores.reduce((s, v) => s + (v ?? 0), 0) : -1;
    return { p, weekScores, total };
  }).sort((a, b) => b.total - a.total);

  el('formGuideTable').innerHTML = `
    <thead>
      <tr>
        <th class="col-player">Player</th>
        ${lastSix.map(g => `<th class="col-num">Wk ${g.number}</th>`).join('')}
        <th class="col-pts">Last 6</th>
      </tr>
    </thead>
    <tbody>
      ${rows.length ? rows.map(({ p, weekScores, total }) => `
        <tr>
          <td class="col-player">${esc(p.displayName || p.name)}</td>
          ${weekScores.map(v => `<td class="col-num muted">${v ?? '—'}</td>`).join('')}
          <td class="col-pts strong">${total < 0 ? '—' : total}</td>
        </tr>`).join('') : `<tr><td colspan="${lastSix.length + 2}" class="empty">No completed gameweeks yet.</td></tr>`}
    </tbody>`;
}

// Manager Of The Week: whoever called the most results correct in a single
// completed gameweek, ties shared — a compact strip of the last few weeks.
function renderMotw(board, gws) {
  const played = gws.gameweeks.filter(g => g.complete).sort((a, b) => b.number - a.number);
  const rows = played.map(gw => {
    const scores = board.map(p => p.perGameweek[gw.id]?.resultPoints ?? -1);
    const max = Math.max(...scores, 0);
    if (max <= 0) return null;
    const winners = board.filter(p => (p.perGameweek[gw.id]?.resultPoints ?? -1) === max);
    return { gw, winners, max };
  }).filter(Boolean).slice(0, 6);

  el('motwList').innerHTML = rows.length ? `
    <div class="praise-list">
      ${rows.map(({ gw, winners, max }) => `
        <div class="praise-row won">
          <span class="praise-gw">${esc(gw.label || 'Week ' + gw.number)}</span>
          <span class="praise-winners">
            ${winners.map(x => `<span class="winner-chip"><i class="fa-solid fa-star"></i> ${esc(x.displayName || x.name)}</span>`).join('')}
          </span>
          <span class="praise-amount">${max}/6 correct</span>
        </div>`).join('')}
    </div>` : '<p class="empty wide-empty">No completed gameweeks yet.</p>';
}

function renderPraise(praise, board) {
  const { userId } = Session.load();

  // Correct results over every prediction made on a fixture that has been
  // played. Counting predictions rather than fixtures means a player who
  // missed a week isn't penalised in their own percentage.
  const tally = p => {
    const predicted = Object.values(p.matchPoints || {}).filter(m => m.predicted).length;
    return { correct: p.resultPoints, predicted,
             rate: predicted ? Math.round((p.resultPoints / predicted) * 100) : null };
  };

  const me = (board || []).find(p => p.id === userId);
  const myJackpots = me
    ? praise.weekly.filter(w => w.winners.some(x => x.id === userId)).length
    : 0;

  let allCorrect = 0, allPredicted = 0;
  (board || []).forEach(p => {
    const t = tally(p);
    allCorrect += t.correct;
    allPredicted += t.predicted;
  });
  const allRate = allPredicted ? Math.round((allCorrect / allPredicted) * 100) : null;
  const jackpotsWon = praise.weekly.filter(w => !w.rolledOver).length;

  const tile = (value, label, cls = '') =>
    `<div class="stat-tile${cls}">
       <span class="stat-value">${value}</span>
       <span class="stat-label">${label}</span>
     </div>`;

  const mine = me ? tally(me) : null;

  el('praiseSummary').innerHTML = `
    ${me ? `
      <p class="subsection-title">Your stats</p>
      <div class="stat-row">
        ${tile(pts(mine.correct), 'Correct predictions')}
        ${tile(mine.rate === null ? '—' : mine.rate + '%', 'Success rate')}
        ${tile(pts(myJackpots), 'Jackpots won')}
      </div>
    ` : `
      <p class="subsection-title">Your stats</p>
      <p class="empty">Sign in to see how you're doing.</p>
    `}

    <p class="subsection-title">Overall stats</p>
    <div class="stat-row">
      ${tile(allRate === null ? '—' : allRate + '%', 'Correct predictions')}
      ${tile(pts(jackpotsWon), 'Jackpots won')}
      ${tile(pts(praise.currentPot), 'Current Jackpot', ' highlight')}
    </div>`;

  el('praiseWeekly').innerHTML = praise.weekly.length ? `
    <div class="praise-list">
      ${praise.weekly.slice().reverse().map(w => `
        <div class="praise-row ${w.rolledOver ? 'rolled' : 'won'}">
          <span class="praise-gw">${esc(w.label)}</span>
          <span class="praise-winners">
            ${w.rolledOver
              ? '<span class="muted">Nobody called all six — praise rolls into the next week</span>'
              : w.winners.map(x => `<span class="winner-chip"><i class="fa-solid fa-award"></i> ${esc(x.displayName || x.name)}</span>`).join('')}
          </span>
          <span class="praise-amount">${
            w.rolledOver           ? `${pts(w.pot)} carried over`
            : w.winners.length > 1 ? `${pts(w.sharePerWinner)} each (${pts(w.pot)})`
            :                        pts(w.pot)
          }</span>
        </div>`).join('')}
    </div>` : '<p class="empty wide-empty">No completed gameweeks yet.</p>';
}

// Week Record: the same week-by-week scoreline grid as Admin → Records,
// but built on /api/predictions (locked weeks only, no admin auth needed)
// rather than the admin-only /api/predictions all-users route. Replaces the
// old results-correct-per-week table — this is a straight read of everyone's
// picks against the actual result, colour-coded, one gameweek at a time.
let STATS_GWS = null, STATS_PREDS = [], STATS_RESULTS = {};

function recordRows(gw) {
  return STATS_PREDS
    .map(p => {
      const picks = gw.matches.map(m => p.predictions[m.id] || null);
      let correct = 0, exact = 0;
      gw.matches.forEach((m, i) => {
        const r = STATS_RESULTS[m.id], pr = picks[i];
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
  const gw = STATS_GWS.gameweeks.find(g => g.id === el('recordGw').value);
  const box = el('recordTable');
  if (!gw) { box.innerHTML = '<p class="empty">No gameweeks yet.</p>'; return; }

  const rows = recordRows(gw);
  const anyResults = gw.matches.some(m => STATS_RESULTS[m.id]?.played);

  if (!rows.length) { box.innerHTML = '<p class="empty wide-empty">Nobody entered predictions for this week.</p>'; return; }

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
                const pr = p.picks[i], r = STATS_RESULTS[m.id];
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
                const r = STATS_RESULTS[m.id];
                return `<td class="col-fx">${r && r.played ? `${r.home}–${r.away}` : '—'}</td>`;
              }).join('')}
              <td class="col-pts"></td><td class="col-pts"></td>
            </tr>` : ''}
        </tbody>
      </table>
    </div>`;
}

function fillRecordSelect() {
  const locked = STATS_GWS.gameweeks.filter(g => g.locked);
  const sel = el('recordGw');
  // Newest first — you'll usually want the week just gone.
  sel.innerHTML = locked.slice().reverse()
    .map(g => `<option value="${g.id}">${esc(g.label)}</option>`).join('');
  sel.value = locked.at(-1)?.id || '';
}

async function init() {
  try {
    const [board, gws, praise, preds, res] = await Promise.all([
      API.leaderboard(), API.gameweeks(), API.praise(), API.allPredictions(), API.results()
    ]);

    STATS_GWS = gws;
    STATS_PREDS = preds || [];
    STATS_RESULTS = res.results || {};

    renderFormGuide(board, gws);
    renderMotw(board, gws);
    renderPraise(praise, board);
    fillRecordSelect();
    renderRecords();
    el('recordGw').addEventListener('change', renderRecords);

    el('loadingState').style.display = 'none';
    el('statsApp').style.display     = '';
  } catch (e) {
    el('loadingState').innerHTML = `<p>Could not load stats — ${esc(e.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
