// Cup page — read-only bracket view. Ties need no fixtures of their own: the
// server derives each tie's score from the players' results-correct count in
// the gameweek the round is assigned to (see /api/cup).

function el(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function renderRounds(cup) {
  if (!cup.rounds || !cup.rounds.length) {
    el('cupRounds').innerHTML = '<p class="empty">The cup bracket hasn\'t been set up yet.</p>';
    return;
  }
  el('cupRounds').innerHTML = cup.rounds.map(round => `
    <div class="section section--no-bottom">
      <h3 class="subsection-title">${esc(round.name)}</h3>
    </div>
    <div class="table-wrap">
      <table class="ranking-table">
        <thead><tr><th>Player</th><th class="col-pts">Score</th><th></th><th class="col-pts">Score</th><th>Player</th><th>Result</th></tr></thead>
        <tbody>
          ${round.ties.map(tie => `
            <tr>
              <td class="${tie.winner === tie.playerA ? 'strong' : ''}">${esc(tie.playerAName)}</td>
              <td class="col-pts">${tie.scoreA ?? '—'}</td>
              <td class="muted">v</td>
              <td class="col-pts">${tie.scoreB ?? '—'}</td>
              <td class="${tie.winner === tie.playerB ? 'strong' : ''}">${esc(tie.playerBName)}</td>
              <td class="muted">${
                tie.needsReplay ? 'Drawn — replay needed'
                : tie.winner    ? `${esc(tie.winnerName)} advances`
                : tie.pending   ? 'Not yet played' : ''
              }</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `).join('');
}

async function init() {
  try {
    const cup = await API.cup();
    renderRounds(cup);
    el('loadingState').style.display = 'none';
    el('cupApp').style.display = '';
  } catch (e) {
    el('loadingState').innerHTML = `<p>Could not load the cup — ${esc(e.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
