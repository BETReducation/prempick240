// International League page — group tables, read-only. "Goals" in every
// fixture are the two players' results-correct counts in the mapped
// international gameweek (see /api/international-league).

function el(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function renderGroups(groups) {
  if (!groups.length) {
    el('intlGroupTables').innerHTML = '<p class="empty wide-empty">Groups haven\'t been drawn yet.</p>';
    return;
  }
  el('intlGroupTables').innerHTML = groups.map(g => `
    <div class="section section--no-bottom"><h3 class="subsection-title">${esc(g.name)}</h3></div>
    <div class="table-wrap">
      <table class="ranking-table">
        <thead><tr>
          <th>Player</th><th class="col-num">P</th><th class="col-num">W</th><th class="col-num">D</th>
          <th class="col-num">L</th><th class="col-num">F</th><th class="col-num">A</th>
          <th class="col-num">GD</th><th class="col-pts">Pts</th>
        </tr></thead>
        <tbody>
          ${g.table.map((r, i) => `
            <tr class="${i < 2 ? 'is-me' : ''}">
              <td>${esc(r.name)}</td><td class="col-num">${r.played}</td><td class="col-num">${r.won}</td>
              <td class="col-num">${r.drawn}</td><td class="col-num">${r.lost}</td>
              <td class="col-num">${r.for}</td><td class="col-num">${r.against}</td>
              <td class="col-num">${r.gd}</td><td class="col-pts strong">${r.points}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');
}

function renderQual(qualification) {
  el('intlQualTable').innerHTML = `
    <thead><tr><th class="col-pos">#</th><th class="col-player">Player</th><th class="col-pts">Results</th><th class="col-pts">Exact</th></tr></thead>
    <tbody>
      ${qualification.map((p, i) => `
        <tr><td class="col-pos">${i + 1}</td><td class="col-player">${esc(p.displayName || p.name)}</td>
          <td class="col-pts strong">${p.resultPoints}</td><td class="col-pts">${p.scorePoints}</td></tr>`).join('')}
    </tbody>`;
}

async function init() {
  try {
    const data = await API.internationalLeague();
    renderGroups(data.groups || []);
    renderQual(data.qualification || []);
    el('loadingState').style.display = 'none';
    el('intlApp').style.display = '';
  } catch (e) {
    el('loadingState').innerHTML = `<p>Could not load the International League — ${esc(e.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
