// excel.js — the Excel "mirror". The server is the calculation engine (see
// CLAUDE.md); this module never computes anything itself, it only renders
// whatever it's handed into a workbook that a human can open, browse and
// download from Admin. Every sync rewrites the whole file from scratch —
// there is no attempt to patch existing cells — which is what makes "a new
// player just appears in the right places" true for free: they're just
// another row next time the workbook is rebuilt.
//
// Writes are debounced: any number of prediction saves/results/registrations
// in a short burst (e.g. everyone piling in before a deadline) collapse into
// one rebuild a few seconds later, rather than one full workbook rewrite per
// request.

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const DEBOUNCE_MS = 3000;
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
const HEADER_FONT = { bold: true };

let filePath = null;
let getState = null;
let timer = null;
let dirty = false;

// Wire the module up once at server startup: `getStateFn` is called fresh at
// sync time (never cached) so the workbook always reflects the very latest
// data, however long it sat in the debounce queue.
function initExcelSync(getStateFn, outputPath) {
  getState = getStateFn;
  filePath = outputPath;
}

function scheduleExcelSync() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(runSync, DEBOUNCE_MS);
}

async function runSync() {
  timer = null;
  if (!dirty || !getState || !filePath) return;
  dirty = false;
  try {
    const state = getState();
    await buildWorkbook(state, filePath);
  } catch (err) {
    console.error('Excel mirror sync failed:', err);
  }
}

function styledHeader(row) {
  row.eachCell(c => { c.font = HEADER_FONT; c.fill = HEADER_FILL; });
  row.commit();
}

function autoWidth(sheet, widths) {
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

function nameOf(user) {
  return (user && (user.displayName || user.name)) || 'Unknown';
}

async function buildWorkbook(state, outputPath) {
  const { users, gws, board, positionHistory, cup, intl } = state;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PremPick240';
  wb.created = new Date();

  buildReadme(wb);
  buildLeagueTable(wb, board);
  buildFormGuide(wb, board, gws);
  buildManagerOfWeek(wb, board, gws);
  buildWeekRecord(wb, board, gws);
  buildPredictions(wb, users, gws);
  buildPositionHistory(wb, positionHistory, gws);
  buildCup(wb, cup);
  buildInternational(wb, intl);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Write to a temp file then rename, so a reader (e.g. someone downloading
  // mid-rebuild) never sees a half-written file.
  const tmpPath = outputPath + '.tmp';
  await wb.xlsx.writeFile(tmpPath);
  fs.renameSync(tmpPath, outputPath);
}

function buildReadme(wb) {
  const sheet = wb.addWorksheet('README');
  sheet.getColumn(1).width = 100;
  const lines = [
    'PremPick240 — League Workbook',
    '',
    'This file is generated automatically by the website. It is a live mirror of ' +
      'whatever the site is currently showing — every sheet is rebuilt from scratch ' +
      'a few seconds after a prediction is saved, a result is entered, or a new ' +
      'player joins.',
    '',
    'Because it is generated, every cell here is a value, not a formula — editing ' +
      'this file has no effect on the website. The website (not this workbook) is ' +
      'the source of truth.',
    '',
    'Sheets:',
    '  League Table                  Season standings — Results, Exact, Perfect weeks',
    '  Form Guide                    Each player\'s results-correct total over their last 6 played weeks',
    '  Manager Of The Week           Weekly top scorer(s), one row per completed gameweek',
    '  Week Record                   Raw grid: results-correct count per player per week',
    '  Predictions                   Every player\'s raw score predictions, written the moment they save',
    '  Position History              League position per player per completed week, plus best/worst',
    '  PP Cup                        Knockout bracket — ties decided by that week\'s results-correct count',
    '  International League          Same accrual as League Table, totalled over international-tagged gameweeks only'
  ];
  lines.forEach((line, i) => { sheet.getCell(i + 1, 1).value = line; });
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
}

function buildLeagueTable(wb, board) {
  const sheet = wb.addWorksheet('League Table');
  autoWidth(sheet, [6, 28, 10, 10, 10, 12, 10]);
  const header = sheet.addRow(['Pos', 'Player', 'Played', 'Results', 'Exact', 'Perfect weeks', 'This week']);
  styledHeader(header);
  board.forEach((p, i) => {
    const perfect = Object.values(p.perGameweek || {}).filter(g => g.perfect).length;
    sheet.addRow([i + 1, nameOf(p), p.matchesScored, p.resultPoints, p.scorePoints, perfect, p.weeklyPredictions ?? 0]);
  });
}

// Same rolling-6-week window the original workbook drove with OFFSET —
// here it's just a slice of `perGameweek` in already-completed-week order.
function playedGameweeksInOrder(gws) {
  return (gws.gameweeks || [])
    .filter(g => g.complete)
    .sort((a, b) => a.number - b.number);
}

function buildFormGuide(wb, board, gws) {
  const sheet = wb.addWorksheet('Form Guide');
  const played = playedGameweeksInOrder(gws);
  const lastSix = played.slice(-6);
  autoWidth(sheet, [28, ...lastSix.map(() => 8), 14]);
  const header = sheet.addRow(['Player', ...lastSix.map(g => `Wk ${g.number}`), 'Last 6 weeks']);
  styledHeader(header);

  const rows = board.map(p => {
    const weekScores = lastSix.map(g => p.perGameweek[g.id]?.resultPoints ?? '');
    const total = lastSix.length
      ? weekScores.reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0)
      : -1;
    return { p, weekScores, total };
  }).sort((a, b) => b.total - a.total);

  rows.forEach(({ p, weekScores, total }) => {
    sheet.addRow([nameOf(p), ...weekScores, total]);
  });
}

function buildManagerOfWeek(wb, board, gws) {
  const sheet = wb.addWorksheet('Manager Of The Week');
  autoWidth(sheet, [12, 40, 12]);
  const header = sheet.addRow(['Gameweek', 'Winner(s)', 'Results correct']);
  styledHeader(header);

  playedGameweeksInOrder(gws).forEach(gw => {
    const scores = board.map(p => p.perGameweek[gw.id]?.resultPoints ?? -1);
    const max = Math.max(...scores, 0);
    if (max <= 0) return;
    const winners = board.filter(p => (p.perGameweek[gw.id]?.resultPoints ?? -1) === max);
    sheet.addRow([gw.label || `Week ${gw.number}`, winners.map(nameOf).join(' / '), max]);
  });
}

function buildWeekRecord(wb, board, gws) {
  const sheet = wb.addWorksheet('Week Record');
  const weeks = (gws.gameweeks || []).slice().sort((a, b) => a.number - b.number);
  autoWidth(sheet, [28, ...weeks.map(() => 6)]);
  const header = sheet.addRow(['Player', ...weeks.map(g => `Wk ${g.number}`)]);
  styledHeader(header);
  board.forEach(p => {
    sheet.addRow([nameOf(p), ...weeks.map(g => {
      const gwStats = p.perGameweek[g.id];
      return gwStats && gwStats.played > 0 ? gwStats.resultPoints : '';
    })]);
  });
}

function buildPredictions(wb, users, gws) {
  const sheet = wb.addWorksheet('Predictions');
  autoWidth(sheet, [24, 10, 28, 8, 8, 20]);
  const header = sheet.addRow(['Player', 'Gameweek', 'Fixture', 'Home', 'Away', 'Saved at']);
  styledHeader(header);

  const matchLookup = {};
  for (const gw of gws.gameweeks || []) {
    for (const m of gw.matches || []) matchLookup[m.id] = { gw, m };
  }

  for (const user of users) {
    const preds = user.predictions || {};
    for (const [matchId, pick] of Object.entries(preds)) {
      const found = matchLookup[matchId];
      if (!found) continue;
      sheet.addRow([
        user.displayName || user.name,
        found.gw.label || `Week ${found.gw.number}`,
        `${found.m.home} v ${found.m.away}`,
        pick.home, pick.away,
        user.lastUpdated || ''
      ]);
    }
  }
}

function buildPositionHistory(wb, positionHistory, gws) {
  const sheet = wb.addWorksheet('Position History');
  const completed = playedGameweeksInOrder(gws);
  autoWidth(sheet, [28, ...completed.map(() => 6), 10, 10]);
  const header = sheet.addRow(['Player', ...completed.map(g => `Wk ${g.number}`), 'Best', 'Worst']);
  styledHeader(header);

  positionHistory.forEach(p => {
    const byGw = {};
    p.history.forEach(h => { byGw[h.gameweekId] = h.position; });
    sheet.addRow([
      nameOf(p),
      ...completed.map(g => byGw[g.id] ?? ''),
      p.best, p.worst
    ]);
  });
}

function buildCup(wb, cup) {
  const sheet = wb.addWorksheet('PP Cup');
  autoWidth(sheet, [16, 24, 8, 8, 24, 14]);
  const header = sheet.addRow(['Round', 'Player A', 'Score', 'Score', 'Player B', 'Result']);
  styledHeader(header);
  for (const round of cup.rounds || []) {
    for (const tie of round.ties || []) {
      const result = tie.needsReplay ? 'Drawn — replay needed'
        : tie.winner ? `${tie.winnerName} advances`
        : tie.pending ? 'Not yet played' : '';
      sheet.addRow([round.name, tie.playerAName, tie.scoreA ?? '', tie.scoreB ?? '', tie.playerBName, result]);
    }
  }
}

function buildInternational(wb, intl) {
  const sheet = wb.addWorksheet('International League');
  autoWidth(sheet, [6, 28, 10, 10, 10]);
  const header = sheet.addRow(['Rank', 'Player', 'Results', 'Exact', 'Played']);
  styledHeader(header);
  (intl.table || []).forEach((p, i) => {
    sheet.addRow([i + 1, nameOf(p), p.resultPoints, p.scorePoints, p.played]);
  });
}

module.exports = { initExcelSync, scheduleExcelSync };
