// Cup page — read-only bracket view. Ties need no fixtures of their own: the
// server derives each tie's score from the players' results-correct count in
// the gameweek the round is assigned to (see /api/cup).

function el(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function renderRounds(cup) {
  const rounds = cup.rounds || [];
  if (!rounds.length) {
    el('cupRounds').innerHTML = '<p class="empty wide-empty">The cup bracket hasn\'t been set up yet.</p>';
    el('cupSchedule').innerHTML = '';
    return;
  }

  // Rounds with no ties yet are provisional — just a round/gameweek/date
  // placeholder until participants and pairings are confirmed.
  const bracket  = rounds.filter(r => r.ties && r.ties.length);
  const upcoming = rounds.filter(r => !r.ties || !r.ties.length);

  el('cupRounds').innerHTML = bracket.length ? bracket.map(round => `
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
  `).join('') : '<p class="empty wide-empty">No rounds under way yet — check the schedule below.</p>';

  if (!upcoming.length) {
    el('cupSchedule').innerHTML = '';
    return;
  }

  el('cupSchedule').innerHTML = `
    <details class="cup-schedule-details">
      <summary>Upcoming rounds — pairings TBC (${upcoming.length})</summary>
      <div class="table-wrap">
        <table class="ranking-table">
          <thead><tr><th>Round</th><th>Gameweek</th><th>Date</th></tr></thead>
          <tbody>
            ${upcoming.map(round => `
              <tr>
                <td>${esc(round.name || '—')}</td>
                <td>${round.gameweek ? esc(round.gameweek.label || ('Gameweek ' + round.gameweek.number)) : 'TBC'}</td>
                <td>${round.gameweek ? esc(fmtDate(round.gameweek.date)) || '—' : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </details>
  `;
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
