#!/usr/bin/env node
// Syncs finished Premier League / Championship results from football-data.org
// into the live PremPick240 site.
//
// A match is only looked up once its site-recorded kickoff is at least
// READY_AFTER_MS in the past — the same 2h15m grace period the server itself
// uses in gameweekResetTime() (server.js) to close out a gameweek. Run this
// on a schedule (see crontab) rather than continuously; each run is a single
// idempotent pass that only posts results for matches not already recorded.
//
// Required env vars (see .env, gitignored):
//   SITE_URL               e.g. https://prempick240-production.up.railway.app
//   ADMIN_PASSWORD          x-admin-password for POST /api/results
//   FOOTBALL_DATA_API_KEY   X-Auth-Token for api.football-data.org

const SITE_URL = process.env.SITE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const FD_API_KEY = process.env.FOOTBALL_DATA_API_KEY;

if (!SITE_URL || !ADMIN_PASSWORD || !FD_API_KEY) {
  console.error('Missing SITE_URL, ADMIN_PASSWORD, or FOOTBALL_DATA_API_KEY env vars.');
  process.exit(1);
}

const READY_AFTER_MS = (2 * 60 + 15) * 60 * 1000; // 2h15m

function normalize(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Site uses short names ("Brighton"), football-data.org uses full club
// names ("Brighton & Hove Albion FC") — containment either direction covers
// every case seen so far (see CLAUDE.md team list).
function namesMatch(siteName, apiName) {
  const a = normalize(siteName);
  const b = normalize(apiName);
  return a.length > 0 && (b.includes(a) || a.includes(b));
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const [gwData, resultsData] = await Promise.all([
    fetchJson(`${SITE_URL}/api/gameweeks`, {}),
    fetchJson(`${SITE_URL}/api/results`, {}),
  ]);

  const existing = resultsData.results || {};
  const now = Date.now();

  const pending = [];
  for (const gw of gwData.gameweeks || []) {
    for (const m of gw.matches || []) {
      if (existing[m.id] && existing[m.id].played) continue;
      if (!m.kickoff) continue;
      const readyAt = new Date(m.kickoff).getTime() + READY_AFTER_MS;
      if (now < readyAt) continue;
      pending.push({ ...m, gwId: gw.id });
    }
  }

  if (pending.length === 0) {
    console.log(`[${new Date().toISOString()}] nothing ready to sync.`);
    return;
  }

  console.log(`[${new Date().toISOString()}] ${pending.length} match(es) ready: ${pending.map(m => m.id).join(', ')}`);

  // One football-data.org call covering every pending match's date range.
  const kickoffs = pending.map(m => new Date(m.kickoff).getTime());
  const dateFrom = new Date(Math.min(...kickoffs) - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const dateTo = new Date(Math.max(...kickoffs) + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const fd = await fetchJson(
    `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
    { 'X-Auth-Token': FD_API_KEY }
  );
  const fdMatches = fd.matches || [];

  for (const m of pending) {
    const kickoffMs = new Date(m.kickoff).getTime();
    const candidate = fdMatches.find(fm => {
      const withinWindow = Math.abs(new Date(fm.utcDate).getTime() - kickoffMs) < 6 * 3600 * 1000;
      return withinWindow && namesMatch(m.home, fm.homeTeam.name) && namesMatch(m.away, fm.awayTeam.name);
    });

    if (!candidate) {
      console.warn(`  ${m.id} (${m.home} v ${m.away}): no matching football-data.org fixture found`);
      continue;
    }
    if (candidate.status !== 'FINISHED') {
      console.log(`  ${m.id} (${m.home} v ${m.away}): found, status=${candidate.status}, waiting`);
      continue;
    }

    const homeGoals = candidate.score.fullTime.home;
    const awayGoals = candidate.score.fullTime.away;

    const postRes = await fetch(`${SITE_URL}/api/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': ADMIN_PASSWORD },
      body: JSON.stringify({ matchId: m.id, homeGoals, awayGoals }),
    });

    if (!postRes.ok) {
      console.error(`  ${m.id}: FAILED to post result (${postRes.status}) ${await postRes.text()}`);
      continue;
    }
    console.log(`  ${m.id} (${m.home} ${homeGoals}-${awayGoals} ${m.away}): recorded`);
  }
}

main().catch(err => {
  console.error(`[${new Date().toISOString()}] sync-scores failed:`, err);
  process.exit(1);
});
