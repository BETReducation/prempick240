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
function renderTie(tie) {
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

// Before admin has drawn a real Round 1, show a like-for-like preview sized
// to however many players are currently eligible to join — "Player 1" is
// not a real account, just a seed number. Shape (how many ties, how many
// byes) comes straight from the server's round1Shape() so this always
// matches what "Randomise Round 1" would actually produce — byes only ever
// happen here, never in a later round, so the minority (not majority) sits
// out: enough ties to trim the field down to the nearest power of two,
// everyone else gets a bye.
function placeholderTies(tieCount, byeCount) {
  const ties = [];
  let seed = 1;
  for (let i = 0; i < tieCount; i++) {
    ties.push({ playerAName: `Player ${seed}`, playerBName: `Player ${seed + 1}`, placeholder: true });
    seed += 2;
  }
  for (let i = 0; i < byeCount; i++) {
    ties.push({ playerAName: `Player ${seed}`, playerBName: 'BYE', placeholder: true });
    seed += 1;
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
    const tieCount = cup.previewTieCount ?? 0, byeCount = cup.previewByeCount ?? 0;
    const roundName = cup.previewRoundName || 'Round 1';
    el('cupRounds').innerHTML = `
      <div class="section section--no-bottom">
        <h3 class="subsection-title">${esc(roundName)} — provisional</h3>
        <p class="section-note">Seeded by player count, not drawn yet — admin will randomise real players in once everyone's joined.</p>
      </div>
      ${renderBracketColumns(placeholderTies(tieCount, byeCount))}
    `;
  } else {
    el('cupRounds').innerHTML = bracket.map(round => `
      <div class="section section--no-bottom">
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
