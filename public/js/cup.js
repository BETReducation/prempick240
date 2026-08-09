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

// A tie's two rows, plus a status line when there's something to say beyond
// the scores themselves. Shared by real ties and the placeholder bracket —
// placeholder ties just carry {playerAName, playerBName, placeholder:true}
// and nothing else, so every other field naturally falls through to blank.
//
// A bye is shown as a single-line entry — just the player's name, no "v
// BYE" second row and no opponent to have "beaten" — rather than a two-row
// card implying a pairing that never happened. Real ties flag this with
// bye:true (see calcCup() in server.js); placeholder ties do the same.
function renderTie(tie) {
  if (tie.bye) {
    return `<div class="bracket-tie bracket-tie--bye"><div class="bracket-tie-player ${tie.placeholder ? 'placeholder' : ''}"><span>${esc(tie.playerAName)}</span></div></div>`;
  }
  const row = (name, isWinner, score) => `
    <div class="bracket-tie-player ${isWinner ? 'winner' : ''} ${tie.placeholder ? 'placeholder' : ''}">
      <span>${esc(name)}</span>
      ${score != null ? `<span class="bracket-tie-score">${score}</span>` : ''}
    </div>`;
  // A placeholder tie has no `winner` — guard explicitly rather than relying
  // on tie.winner === tie.playerA, which is true (undefined === undefined)
  // for every placeholder row otherwise, colouring both "winner".
  const isWinner = side => !tie.placeholder && !!tie.winner && tie.winner === side;
  const result = tie.needsReplay ? 'Drawn — replay needed'
    : tie.winner    ? `${esc(tie.winnerName)} advances`
    : tie.pending && !tie.placeholder ? 'Not yet played' : '';
  return `
    <div class="bracket-tie">
      ${row(tie.playerAName, isWinner(tie.playerA), tie.scoreA)}
      <div class="bracket-tie-vs">vs</div>
      ${row(tie.playerBName, isWinner(tie.playerB), tie.scoreB)}
      ${result ? `<div class="bracket-tie-result">${result}</div>` : ''}
    </div>`;
}

// Ties alternate left/right column in draw order (tie 1 top-left, tie 2
// top-right, tie 3 second-left, …) so the bracket reads as two balanced
// halves rather than one long list.
function renderBracketColumns(ties) {
  const left  = ties.filter((_, i) => i % 2 === 0);
  const right = ties.filter((_, i) => i % 2 === 1);
  return `
    <div class="bracket-columns">
      <div class="bracket-column">${left.map(renderTie).join('')}</div>
      <div class="bracket-column">${right.map(renderTie).join('')}</div>
    </div>`;
}

// Before admin has drawn a real Round 1, show a placeholder sized to however
// many players are currently eligible to join — "Player 1" is not a real
// account, just a seed number. This is a cosmetic mask, not real bye math:
// every card is paired up with "vs" for a clean look, regardless of what
// round1Shape() actually computes for byes (the round name above it still
// reflects that real math — see renderRounds()). The real pairing, with
// real byes, only matters once admin actually draws the round; until then
// there's nothing riding on this preview being exactly accurate.
function placeholderTies(totalCount) {
  const ties = [];
  let seed = 1;
  while (seed <= totalCount) {
    if (seed + 1 <= totalCount) {
      ties.push({ playerAName: `Player ${seed}`, playerBName: `Player ${seed + 1}`, placeholder: true });
      seed += 2;
    } else {
      ties.push({ playerAName: `Player ${seed}`, bye: true, placeholder: true });
      seed += 1;
    }
  }
  return ties;
}

function renderRounds(cup) {
  const rounds = cup.rounds || [];

  // Rounds with no ties yet are provisional — just a round/gameweek/date
  // placeholder until participants and pairings are confirmed.
  const bracket  = rounds.filter(r => r.ties && r.ties.length);
  const upcoming = rounds.filter(r => !r.ties || !r.ties.length);

  if (!bracket.length) {
    const roundName = cup.previewRoundName || 'Round 1';
    el('cupRounds').innerHTML = `
      <div class="bracket-round-head">
        <h3 class="subsection-title">${esc(roundName)} — provisional</h3>
        <p class="section-note">Seeded by player count, not drawn yet — admin will randomise real players in once everyone's joined.</p>
      </div>
      ${renderBracketColumns(placeholderTies(cup.eligibleCount ?? 2))}
    `;
  } else {
    el('cupRounds').innerHTML = bracket.map(round => `
      <div class="bracket-round-head">
        <h3 class="subsection-title">${esc(round.name)}</h3>
      </div>
      ${renderBracketColumns(round.ties)}
    `).join('');
  }

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
