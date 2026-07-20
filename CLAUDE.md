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
| `public/index.html` | **Predictions** — the front page. This week's six fixtures + prediction entry. Past weeks via tabs. Deliberately shows no results; those live on Ranking. |
| `public/ranking.html` | **Ranking** — season table + praise ledger |
| `public/member.html` | Player profile (display name, bio, avatar, stats) |
| `public/admin.html` | **Admin** — publish a week's fixtures, enter results. Linked in the nav for admin accounts only. |
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
    "seasonWeeks": 40,                // pot = registeredPlayers × this
    "seasonEnd": [ { "key": "league1st", "label": "…", "percent": 40 }, … ]
  },
  "gameweeks": [
    {
      "id": "gw1", "number": 1, "label": "Gameweek 1",
      "lockTime": "2026-08-15T14:00:00Z",   // ISO UTC — 15:00 UK in summer
      // no "praise" key: the week is worth one point per registered player.
      // Only add one to deliberately override that.
      "matches": [
        { "id": "gw1-m1", "comp": "PL", "home": "Arsenal", "away": "Chelsea",
          "date": "2026-08-15" }
        // …six of them. comp is "PL", "CH" or "CUP".
        // `date` is display-only (fixtures can span Fri–Sun); locking is driven
        // by the gameweek's lockTime, or an optional per-match lockTime.
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

Praise is a finite pot of **points** — bragging rights and certificates, not
prize money (deliberately not cash, for legal reasons).

```
totalPot    = registeredPlayers × seasonWeeks   (default 40 weeks)
weeklyBase  = totalPot / seasonWeeks = registeredPlayers
```

So with 40 players the season pot is 1,600 and a standard week is worth 40.

- Each **completed** gameweek adds `weeklyBase` to a running pot.
- Players calling **all six results** correctly share the *entire* running pot
  equally, and it resets to 0.
- A week nobody wins keeps its points banked, so the next week is worth more
  (40 → 80 → 120 …). Nothing is lost.
- `currentPot` in `/api/praise` is what this week's winners would share:
  everything banked plus this week's own allocation.
- Whatever is never won weekly (`remaining = totalPot − claimed`) is split at
  season end per `praise.seasonEnd` — 40/25/15 for the top three, 20% for most
  exact scorelines.

A planned FA Cup side competition would take a slice of that 20% — add it as
another `seasonEnd` entry, no code change.

**Player count is live.** `totalPot` and `weeklyBase` are derived from the
current number of registered players, so both move if someone joins mid-season,
and past weeks are re-valued at the new rate on the next API call. That keeps
one obvious rule ("a week is worth one point per player") at the cost of
historical figures not being frozen. If you'd rather freeze them, snapshot the
player count onto each gameweek when it completes.

A gameweek may carry an explicit `praise` field to override its allocation.
Don't set it to 0 by accident — that pins the week's value and stops it
tracking the player count.

## Admin page

`public/admin.html` + `js/admin.js`. Three panels:

- **Results** — pick a gameweek, type scores, save. Partial entry is fine; praise
  is only awarded once all six have results. Shows who won the week's praise as
  soon as the last result lands.
- **Records** — the season's audit trail. Pick a week from the dropdown to see
  everyone's predictions against the results, ranked by results called right.
  "Export CSV" dumps *every* locked week, not just the one on screen.
  Unlocked weeks stay hidden here too — the admin plays, so revealing them
  early would be a fairness hole.
- **Fixtures** — create or edit a gameweek: number, label, deadline and six
  fixtures. The deadline input is **UK wall-clock**, converted to UTC on save by
  `ukLocalToUtcISO()`, which iterates against `Europe/London` rather than
  trusting the browser's zone. Verified across BST, GMT and both clock-change
  days — the season spans the October change, so this matters.

Auth: `requireAdmin` accepts an admin user's session token, so a signed-in admin
needs no password. The password box is a fallback and stores to `sessionStorage`.

## Prediction locking

Locking is per gameweek via `lockTime`. A single match may carry its own
`lockTime` to override its week (useful for a Friday-night game in a week that
otherwise locks Saturday 15:00). The server enforces this — the frontend only
reflects it.

Before a week locks, `/api/predictions` **omits** other players' picks for that
week. Don't remove that filter; it's what stops players copying each other.

## Save / Edit state on the Fixtures page

`EDITING` in `fixtures.js` drives it. A week with nothing saved opens in entry
mode; a week you've already submitted opens showing your picks as text with an
"Edit Predictions" button.

This exists because a status message alone wasn't enough feedback — players
tapped Save, the button didn't change, and it looked like nothing happened.
The button changing state *is* the confirmation. Saving also flashes
"✓ Saved" on the button before settling into the saved view.

Once a week locks, the Fixtures page renders an "Everyone's predictions" grid
below the fixtures, colour-coded against the actual results. The score inputs
are replaced by the player's own pick as text — disabled empty boxes on a locked
week just read as broken.

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

## Watch out: data/gameweeks.json is written by the admin API

Local testing through `/api/admin/gameweeks` rewrites this tracked file, so it
picks up test lock times and fixtures. It has been committed by accident once,
which locked Gameweek 1 on the live site. **Check `git diff data/gameweeks.json`
before every commit** — restore it deliberately rather than assuming it is clean.

## Key conventions

- Flat JSON files are the datastore — no migrations, no ORM. Keep it simple.
- Vanilla JS frontend — don't introduce a framework or build step.
- Times in `gameweeks.json` are **ISO UTC**; the UI renders them in
  `Europe/London` explicitly so a player abroad still sees UK kick-off times.
- Score inputs are integers 0–99, validated server-side. They are styled via
  `input.score-input`; the older `.score-input input[type="text"]` rules are
  WC26 leftovers that match nothing here.
- The competition badge renders only for non-PL fixtures. PL is the default and
  a badge on every row was noise; CH and CUP still stand out.
- `parseInt(x) || fallback` is a trap where 0 is valid (gameweek numbers,
  scores) — use `Number.isInteger` / explicit `isNaN` checks.
- `POST /api/admin/gameweeks` rebuilds each match object, so any field it
  doesn't explicitly copy is destroyed on save. It silently wiped every
  fixture's `date` once. If you add a per-match field, add it there too.

## Carried over but unused

`server.js` still accepts a `legacyPin` on `/api/register` to migrate old
PIN-based WC26 accounts, and `auth.js` shows the matching form field. There are
no such accounts in this league — harmless, but safe to strip out.
