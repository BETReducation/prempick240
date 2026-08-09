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
| `public/admin.html` | **Admin** — publish a week's fixtures, enter results, manage the Cup and International League, download the League Workbook. Linked in the nav for admin accounts only. |
| `public/reset.html` | Password reset landing page (email token) |
| `public/cup.html` | **FP Cup** — read-only knockout bracket |
| `public/international.html` | **International League** — round-robin group tables, qualification standings |

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
        // `date` is display-only (fixtures can span Fri–Sun) and is derived
        // server-side from `kickoff` (see ukDateOnly() in server.js) — the
        // admin Fixtures form only has one date/time field, Kick-off (UK).
        // Locking is driven by the gameweek's lockTime, or an optional
        // per-match lockTime.
      ]
    }
  ]
}
```

Runtime state (gitignored, lives on the Railway volume in production):
`predictions.json`, `results.json`, `access-codes.json`, `sessions.json`,
`leaderboard-prev.json`, `position-history.json` (one position snapshot per
completed gameweek, never overwritten), `cup.json` (FP Cup rounds/ties, ids
only — scores are always derived, never stored), `international-league.json`
(groups/matchdays, same ids-only shape), `PremPick240-League.xlsx`
(the generated Excel mirror — see "Excel mirror" below).

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

`public/admin.html` + `js/admin.js`. Five panels:

- **Results** — pick a gameweek, type scores, save. Partial entry is fine; praise
  is only awarded once all six have results. Shows who won the week's praise as
  soon as the last result lands.
- **Records** — the season's audit trail. Pick a week from the dropdown to see
  everyone's predictions against the results, ranked by results called right.
  "Export CSV" dumps *every* locked week, not just the one on screen.
  Unlocked weeks stay hidden here too — the admin plays, so revealing them
  early would be a fairness hole.
- **Fixtures** — create or edit a gameweek: number, label and six fixtures.
  There's no separate deadline field — `lockTime` is always the earliest
  `kickoff` among the week's fixtures, computed server-side in
  `POST /api/admin/gameweeks` (and mirrored live in the admin form by
  `earliestKickoffIso()` as you type kick-offs in). That guarantees
  predictions always close before the first ball is kicked, and means
  publishing a week is just entering fixtures — nothing to remember to set
  separately. A week saved with no kick-off times yet keeps whatever
  `lockTime` was last set (or none), so you can publish a placeholder week
  before times are confirmed. Kick-off is **UK wall-clock**, converted to
  UTC on save by `ukLocalToUtcISO()`, which iterates against
  `Europe/London` rather than trusting the browser's zone. Verified across
  BST, GMT and both clock-change days — the season spans the October
  change, so this matters. A "Download League Workbook" button here
  streams the current Excel mirror (see below). `comp` now also accepts
  `"INTL"` for international-fixture gameweeks that feed the International
  League.
- **Cup** — build the FP Cup knockout bracket: rounds, each assigned a
  gameweek, and ties pairing two players (or a bye). A tie needs no fixture of
  its own — its "score" is simply both players' `resultPoints` in the round's
  gameweek (see `calcCup()` in `server.js`). A draw is flagged `needsReplay`;
  add a replay gameweek to the tie and it resolves automatically.
  "🎲 Randomise Round 1" shuffles every *eligible* player into Round 1
  pairings and stages them in the panel below — nothing is saved until you
  hit "Save Cup", so a bad draw just costs a re-roll. Before a real Round 1
  exists, the public Cup page shows a placeholder bracket ("Player 1" v
  "Player 2", …) sized to the current eligible headcount, so the shape of
  the draw is visible before anyone's actually seeded into it.
- **International** — build the International League: groups of players with
  round-robin matchdays, each mapped to an `INTL`-tagged gameweek. It's a
  pure league — no knockout stage after the groups. Matchday "goals" are the
  two players' `resultPoints` that week (`calcInternationalLeague()`).
  Qualification is just the current season standings, shown for reference
  when seeding groups — it isn't frozen at draw time.

Auth: `requireAdmin` accepts an admin user's session token, so a signed-in admin
needs no password. The password box is a fallback and stores to `sessionStorage`.

## Excel mirror

`excel.js` renders a generated `.xlsx` workbook (`PremPick240-League.xlsx`, on
`PERSISTENT_DIR` like the other runtime files) that mirrors everything the
server already computes: League Table, Form Guide, Manager Of The Week, Week
Record, raw Predictions, Position History, FP Cup, International League +
Qualification. **The server is the calculation engine — this file is a report,
not a template.** Every cell is a value, not a formula; editing the workbook
has no effect on the site. This is a deliberate exception to "always use
formulas" — the workbook is regenerated from scratch on every sync, so there's
nothing for a formula to preserve.

`scheduleExcelSync()` is called after every prediction save, result
save/delete, gameweek publish, and new registration. Calls are debounced
(~3s) so a burst of activity before a deadline collapses into one rebuild
rather than one per request. It rebuilds the *whole* workbook from current
JSON state each time — a new player is just another row next sync, no
range-patching logic needed. Download it from Admin → Fixtures → "Download
League Workbook" (`GET /api/admin/export-xlsx`).

## Prediction locking

Locking is per gameweek via `lockTime`. A single match may carry its own
`lockTime` to override its week (useful for a Friday-night game in a week that
otherwise locks Saturday 15:00). The server enforces this — the frontend only
reflects it.

Before a week locks, `/api/predictions` **omits** other players' picks for that
week. Don't remove that filter; it's what stops players copying each other.

Players see a week's fixtures in kick-off order, not entry order — `fixtures.js`
sorts a display-only copy (`sortedMatches()`) before rendering the fixture list
and the "everyone's predictions" grid. The stored `gameweeks.json` order is left
alone: the admin Fixtures editor relies on array position to assign match ids
(`${gwId}-m${i+1}`) on save, so re-sorting the stored array would silently
reassign ids already tied to existing predictions/results. If you need
chronological order somewhere else (admin Records, Excel), sort a copy there
too rather than touching the stored array.

## Cup / International eligibility cutoff

`cupEligibilityCutoff()` in `server.js` finds the earliest `kickoff` across
every `CUP`- or `INTL`-tagged match in `gameweeks.json` (any gameweek, past
or future — not just the current one). Whoever's registered before that
instant is eligible for the Cup and International League, for good; anyone
registering after it never is. No such gameweek yet ⇒ no cutoff yet ⇒
everyone currently registered is eligible.

This is computed live from each user's `registeredAt`, not stored — same
"derive it, don't freeze it" approach as `totalPot`/`weeklyBase`. `GET
/api/users` carries the result as `eligible` on each player, which is what
`randomiseCupRound1()` in `admin.js` filters on. The manual player-picker
dropdowns (Cup ties, International groups) are deliberately **not**
filtered by this — they still list everyone, so admin can always override
by hand without a previously-set tie or group member silently vanishing
from a `<select>` if the computed cutoff ever shifts (e.g. an earlier
CUP/INTL gameweek gets added later).

## The active gameweek — reveal & weekly-tally reset

`currentGameweek()` is the **active** week: the first one whose window has not
yet closed. A week's window closes at `gameweekResetTime()` — **2h15m after its
last kick-off** (the latest per-match `kickoff`, falling back to the week's
`lockTime` when none are set; `Infinity` if the week has no timing, so it never
closes by accident). Set per-fixture kick-off times in the admin Fixtures panel.

Two things key off this single instant:

- **Reveal.** `/api/gameweeks` hides weeks *after* the active one from players
  (`visibleGameweeks`) — so you can publish next week's fixtures early and
  nobody sees them. The moment the active week closes it rolls to the next,
  which appears on the predictions page. Admins always get every week
  (`isAdminRequest`); the admin page fetches `/api/gameweeks` via `adminFetch`
  to include them. Past weeks stay visible to everyone as history.
- **Weekly tally.** The ranking table's "This week" column
  (`weeklyPredictions`) counts predictions for the active week only. When the
  active week rolls over, the count is naturally that of the new (empty) week —
  i.e. it resets to 0 until players start predicting. Distinct from
  `predictionsEntered`, the season total kept for the profile page.

Publishing week 2/3 does **not** advance the active week or reset the tally —
only time does. Weeks are assumed chronological (they're sorted by `number`).

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
| GET | `/api/position-history` | — | Position per completed gameweek, best/worst, movement |
| GET | `/api/cup` | — | FP Cup bracket with computed scores/winners |
| GET/POST | `/api/admin/cup` | Admin | Read/write the raw bracket structure |
| GET | `/api/international-league` | — | Groups, qualification, all computed |
| GET/POST | `/api/admin/international-league` | Admin | Read/write the raw groups structure |
| GET | `/api/admin/export-xlsx` | Admin | Download the current Excel mirror |

Plus the auth/profile routes carried over unchanged from WC26 (`/api/register`,
`/api/logout`, `/api/me`, `/api/forgot-password`, `/api/reset-password`,
`/api/profile/:userId`, …).

## Deployment

Intended for **Railway** (`railway.toml`), same as WC26, but as a **separate
project with its own volume** — do not point it at the WC26 deployment.
Set `PERSISTENT_DATA_DIR` to the mounted volume so runtime JSON survives
redeploys.

## data/gameweeks.json is a seed, not the live file

In production the live gameweeks file lives on the Railway volume
(`$PERSISTENT_DATA_DIR/gameweeks.json`). `data/gameweeks.json` in the repo is
only copied across on a **first** boot when the volume has no copy yet
(`seedGameweeks()`).

Consequences:

- Weeks published through the admin page survive deploys. Before this change
  they were wiped by the next push, because the file shipped in the code image.
- **Editing `data/gameweeks.json` and pushing no longer changes production.**
  The admin page is the way to publish a week.
- Locally the two paths are the same file, so admin edits still write to the
  repo copy. **Check `git diff data/gameweeks.json` before committing** — a test
  lock time reached production this way once and locked Gameweek 1.

## Key conventions

- Flat JSON files are the datastore — no migrations, no ORM. Keep it simple.
- Vanilla JS frontend — don't introduce a framework or build step.
- Times in `gameweeks.json` are **ISO UTC**; the UI renders them in
  `Europe/London` explicitly so a player abroad still sees UK kick-off times.
- Score inputs are integers 0–99, validated server-side. They are styled via
  `input.score-input`; the older `.score-input input[type="text"]` rules are
  WC26 leftovers that match nothing here.
- The competition badge renders only for non-PL fixtures. PL is the default and
  a badge on every row was noise; CH, CUP and INTL still stand out.
- `parseInt(x) || fallback` is a trap where 0 is valid (gameweek numbers,
  scores) — use `Number.isInteger` / explicit `isNaN` checks.
- `POST /api/admin/gameweeks` rebuilds each match object, so any field it
  doesn't explicitly copy is destroyed on save. It silently wiped every
  fixture's `date` once. If you add a per-match field, add it there too.
- **The FP Cup and International League store only structure (ids), never
  scores.** `calcCup()`/`calcInternationalLeague()` always derive scores from
  `calcLeaderboard()`'s `perGameweek` at request time. Don't add a "score"
  field to `cup.json`/`international-league.json` — it would drift from the
  real predictions the moment a result is corrected.
- There is no Bundesliga-style side league in this app, by design — it existed
  in the FP Liga spreadsheet this project was modelled on and was deliberately
  dropped when the International League replaced its Copa del Rey.
