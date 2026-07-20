# PremPick240 · Prediction League — Project Context

## What this is

A private prediction league for the Premier League and Championship season.
Each week six difficult fixtures are chosen; players predict scorelines before
the first kick-off and compete on a season-long table. Adapted from the
`world-cup-2026` project (BETReducation/world-cup-2026) — same stack, same
design system, different domain model.

## Stack

- **Backend:** Node.js + Express (`server.js`) — API and static files
- **Frontend:** Vanilla HTML/CSS/JS in `public/` — no build step, no framework
- **Data:** JSON flat files in `data/` (no database)
- **Run:** `node server.js` → http://localhost:3000
- **Admin password:** `admin2026` (override with `ADMIN_PASSWORD`)

## Pages

| File | Purpose |
|------|---------|
| `public/index.html` | **Fixtures** — the front page. This week's six fixtures + prediction entry. Past weeks via tabs. |
| `public/ranking.html` | **Ranking** — season table + praise ledger |
| `public/member.html` | Player profile (display name, bio, avatar, stats) |
| `public/reset.html` | Password reset landing page (email token) |

Login is a modal injected by `public/js/auth.js`, present on every page — same
flow as WC26 (email + password, invite code required for new accounts).

## Data model

`data/gameweeks.json` is the one file you edit to run the league. It is
**tracked in git**, so editing and pushing it changes production directly.

```jsonc
{
  "season": "2026/27",
  "praise": {
    "weeklyAllocation": 1.0,          // % up for grabs each week
    "seasonEnd": [ { "key": "league1st", "label": "…", "percent": 40 }, … ]
  },
  "gameweeks": [
    {
      "id": "gw1", "number": 1, "label": "Gameweek 1",
      "lockTime": "2026-08-15T14:00:00Z",   // ISO UTC — 15:00 UK in summer
      "praise": 1.0,                         // optional per-week override
      "matches": [
        { "id": "gw1-m1", "comp": "PL", "home": "Arsenal", "away": "Chelsea",
          "kickoff": "2026-08-15T14:00:00Z" }
        // …six of them, comp is "PL" or "CH"
      ]
    }
  ]
}
```

Runtime state (gitignored, lives on the Railway volume in production):
`predictions.json`, `results.json`, `access-codes.json`, `sessions.json`,
`leaderboard-prev.json`.

## Scoring

Two independent columns — **never summed**:

- `resultPoints` — 1 per correct result (W/D/L); scoreline irrelevant
- `scorePoints` — 1 per exact scoreline

An exact scoreline scores in both. Ranking is `resultPoints` desc, then
`scorePoints` desc, then name. The second column exists for tie-breaking and
end-of-season awards, which is why it is kept separate rather than added on.

## Praise

Praise is a finite pot in percent — bragging rights and certificates, not prize
money (deliberately not cash for legal reasons).

- Each **completed** gameweek puts its allocation up for grabs.
- Players calling **all six results** correctly share it equally.
- Weeks nobody wins roll into the season-end pot.
- Season-end pot splits per `praise.seasonEnd` — 40/25/15 for the top three,
  20% for most exact scorelines.

All percentages are config, not code. A planned FA Cup side competition would
take a slice of that 20% — add it as another `seasonEnd` entry.

## Prediction locking

Locking is per gameweek via `lockTime`. A single match may carry its own
`lockTime` to override its week (useful for a Friday-night game in a week that
otherwise locks Saturday 15:00). The server enforces this — the frontend only
reflects it.

Before a week locks, `/api/predictions` **omits** other players' picks for that
week. Don't remove that filter; it's what stops players copying each other.

## Saving predictions — the `scope` contract

`POST /api/predictions/:userId` merges into the player's existing predictions
rather than replacing them, because the Fixtures page submits **one gameweek at
a time**. A blind rebuild wipes every other open week.

The body carries `scope: [gameweekId, …]` listing the weeks the submission is
authoritative for. Within those weeks an omitted fixture means *cleared*;
outside them, untouched. Keep `scope` in sync if you change how the page
submits — this was a real bug, not a hypothetical.

## API routes

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/gameweeks` | — | All gameweeks, with `locked`/`complete` resolved |
| GET | `/api/lock-status` | — | Per-gameweek lock state + current gameweek |
| GET | `/api/predictions` | — | Everyone's picks, locked weeks only |
| GET | `/api/predictions/:userId` | — | One player's own picks (all weeks) |
| POST | `/api/predictions/:userId` | Session | Save picks (respects lock, see `scope`) |
| GET | `/api/results` | — | Actual results |
| GET | `/api/leaderboard` | — | Season table, two columns |
| GET | `/api/praise` | — | Weekly winners, rollover, season-end projection |
| POST | `/api/results` | Admin | Enter a result |
| DELETE | `/api/results/:matchId` | Admin | Remove a result |
| POST | `/api/admin/gameweeks` | Admin | Create or update a gameweek |
| DELETE | `/api/admin/gameweeks/:gwId` | Admin | Delete a gameweek |

Plus the auth/profile routes carried over unchanged from WC26 (`/api/register`,
`/api/logout`, `/api/me`, `/api/forgot-password`, `/api/reset-password`,
`/api/profile/:userId`, …).

## Deployment

Intended for **Railway** (`railway.toml`), same as WC26, but as a **separate
project with its own volume** — do not point it at the WC26 deployment.
Set `PERSISTENT_DATA_DIR` to the mounted volume so runtime JSON survives
redeploys.

## Key conventions

- Flat JSON files are the datastore — no migrations, no ORM. Keep it simple.
- Vanilla JS frontend — don't introduce a framework or build step.
- Times in `gameweeks.json` are **ISO UTC**; the UI renders them in
  `Europe/London` explicitly so a player abroad still sees UK kick-off times.
- Score inputs are integers 0–99, validated server-side.
- `parseInt(x) || fallback` is a trap where 0 is valid (gameweek numbers,
  scores) — use `Number.isInteger` / explicit `isNaN` checks.

## Carried over but unused

`server.js` still accepts a `legacyPin` on `/api/register` to migrate old
PIN-based WC26 accounts, and `auth.js` shows the matching form field. There are
no such accounts in this league — harmless, but safe to strip out.
