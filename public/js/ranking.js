// Ranking page — the season table. Form Guide, Manager Of The Week and
// Praise moved to stats.js/stats.html — this page is "the table" only.

function el(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

// Movement arrows: moving up the table renders green (teal), down renders red.
function movementBadge(movement) {
  if (!movement) return '<span class="muted">-</span>';
  return movement > 0
    ? `<span class="move-up">▲ ${movement}</span>`
    : `<span class="move-down">▼ ${Math.abs(movement)}</span>`;
}

function renderTable(board, gws, meId, positionHistory) {
  const played = gws.gameweeks.filter(g => g.complete);
  const currentGwId = gws.currentGameweekId;
  const moveById = {};
  (positionHistory || []).forEach(p => { moveById[p.id] = p.movement; });

  el('rankingTable').innerHTML = `
    <thead>
      <tr>
        <th class="col-pos">#</th>
        <th class="col-player">Player</th>
        <th class="col-num" title="Movement since last completed gameweek">Move</th>
        <th class="col-pts" title="Correct results this gameweek">Week Results</th>
        <th class="col-pts" title="Exact scorelines this gameweek">Week Exact</th>
        <th class="col-pts" title="1 point per correct result, season total">Total Results</th>
        <th class="col-pts" title="Exact scorelines — tie-breaker, season total">Total Exact</th>
        <th class="col-num" title="Weeks won the jackpot (all six results correct)">Jackpot wins</th>
      </tr>
    </thead>
    <tbody>
      ${board.length ? board.map((p, i) => {
        const jackpotWins = played.filter(g => p.perGameweek[g.id]?.perfect).length;
        const weekStats = currentGwId ? p.perGameweek[currentGwId] : null;
        return `
        <tr class="${p.id === meId ? 'is-me' : ''}">
          <td class="col-pos">${i + 1}</td>
          <td class="col-player">
            ${esc(p.displayName || p.name)}
          </td>
          <td class="col-num">${movementBadge(moveById[p.id])}</td>
          <td class="col-pts">${weekStats?.resultPoints ?? 0}</td>
          <td class="col-pts">${weekStats?.scorePoints ?? 0}</td>
          <td class="col-pts">${p.resultPoints}</td>
          <td class="col-pts">${p.scorePoints}</td>
          <td class="col-num">${jackpotWins ? `<span class="perfect-badge">${jackpotWins}</span>` : '—'}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="8" class="empty">No players yet.</td></tr>`}
    </tbody>`;
}

async function init() {
  try {
    const [board, gws, positionHistory] = await Promise.all([
      API.leaderboard(), API.gameweeks(), API.positionHistory().catch(() => [])
    ]);
    const { userId } = Session.load();

    el('seasonLabel').textContent = gws.season ? `Season ${gws.season}` : 'Season';
    renderTable(board, gws, userId, positionHistory);

    el('loadingState').style.display = 'none';
    el('rankingApp').style.display   = '';
  } catch (e) {
    el('loadingState').innerHTML = `<p>Could not load the table — ${esc(e.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
