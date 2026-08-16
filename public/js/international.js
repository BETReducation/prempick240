// International League page — a simple side league, read-only. Same accrual
// as the main Rankings table (1 point per correct result, a separate point
// per exact scoreline), just totalled over international-tagged gameweeks
// only (see calcInternationalLeague() in server.js).

function el(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Which gameweeks fed the table, and when — the table itself has no dates,
// so this is the only place players see which weeks counted.
function renderFixtureWeeks(fixtureWeeks) {
  if (!fixtureWeeks || !fixtureWeeks.length) return;
  el('intlFixtureWeeks').innerHTML = fixtureWeeks.map(w => `
    <tr>
      <td>${esc(w.label || ('Gameweek ' + w.number))}</td>
      <td>${w.dates.map(fmtDate).filter(Boolean).join(', ') || '—'}</td>
    </tr>`).join('');
  el('intlFixtureWeeksSection').style.display = '';
  el('intlFixtureWeeksHeading').style.display = '';
}

function renderTable(table) {
  if (!table.length) {
    el('intlTable').innerHTML = '<tr><td colspan="4" class="empty">No players yet.</td></tr>';
    return;
  }
  el('intlTable').innerHTML = `
    <thead><tr><th class="col-pos">#</th><th class="col-player">Player</th><th class="col-pts">Results</th><th class="col-pts">Exact</th></tr></thead>
    <tbody>
      ${table.map((p, i) => `
        <tr><td class="col-pos">${i + 1}</td><td class="col-player">${esc(p.displayName || p.name)}</td>
          <td class="col-pts strong">${p.resultPoints}</td><td class="col-pts">${p.scorePoints}</td></tr>`).join('')}
    </tbody>`;
}

async function init() {
  try {
    const data = await API.internationalLeague();
    renderTable(data.table || []);
    renderFixtureWeeks(data.fixtureWeeks);
    el('loadingState').style.display = 'none';
    el('intlApp').style.display = '';
  } catch (e) {
    el('loadingState').innerHTML = `<p>Could not load the International League — ${esc(e.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
