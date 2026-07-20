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

function renderPraise(praise) {
  el('praiseSummary').innerHTML = `
    <div class="stat-row">
      <div class="stat-tile highlight">
        <span class="stat-value">${pts(praise.currentPot)}</span>
        <span class="stat-label">On offer this week</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">${pts(praise.totalPot)}</span>
        <span class="stat-label">Total season pot</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">${pts(praise.claimed)}</span>
        <span class="stat-label">Won so far</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">${pts(praise.remaining)}</span>
        <span class="stat-label">Left in the pot</span>
      </div>
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
    renderPraise(praise);

    el('loadingState').style.display = 'none';
    el('rankingApp').style.display   = '';
  } catch (e) {
    el('loadingState').innerHTML = `<p>Could not load the table — ${esc(e.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
