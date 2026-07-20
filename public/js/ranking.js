// Ranking page — season table plus the praise ledger.

function el(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

// Praise is points, not percent. Shares can be fractional when several players
// split a pot, so allow one decimal but never render 13.333333333333334.
function pts(n) {
  return Number(Math.round(Number(n) * 10) / 10).toLocaleString('en-GB');
}

function renderTable(board, gws, meId) {
  const played = gws.gameweeks.filter(g => g.complete);

  el('rankingTable').innerHTML = `
    <thead>
      <tr>
        <th class="col-pos">#</th>
        <th class="col-player">Player</th>
        <th class="col-pts" title="1 point per correct result">Results</th>
        <th class="col-pts" title="Exact scorelines — tie-breaker">Exact</th>
        <th class="col-num" title="Weeks with all six results correct">Perfect weeks</th>
        <th class="col-num">Predictions</th>
      </tr>
    </thead>
    <tbody>
      ${board.length ? board.map((p, i) => {
        const perfect = played.filter(g => p.perGameweek[g.id]?.perfect).length;
        return `
        <tr class="${p.id === meId ? 'is-me' : ''}">
          <td class="col-pos">${i + 1}</td>
          <td class="col-player">
            <a href="member.html?id=${encodeURIComponent(p.id)}">${esc(p.displayName || p.name)}</a>
          </td>
          <td class="col-pts strong">${p.resultPoints}</td>
          <td class="col-pts">${p.scorePoints}</td>
          <td class="col-num">${perfect ? `<span class="perfect-badge">${perfect}</span>` : '—'}</td>
          <td class="col-num muted">${p.predictionsEntered}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="6" class="empty">No players yet.</td></tr>`}
    </tbody>`;
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
    </div>` : '<p class="empty">No completed gameweeks yet.</p>';

}

async function init() {
  try {
    const [board, gws, praise] = await Promise.all([
      API.leaderboard(), API.gameweeks(), API.praise()
    ]);
    const { userId } = Session.load();

    el('seasonLabel').textContent = gws.season ? `Season ${gws.season}` : 'Season';
    renderTable(board, gws, userId);
    renderPraise(praise, board);

    el('loadingState').style.display = 'none';
    el('rankingApp').style.display   = '';
  } catch (e) {
    el('loadingState').innerHTML = `<p>Could not load the table — ${esc(e.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
