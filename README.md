# PremPick240 · Prediction League

A private weekly prediction league for the Premier League and Championship season.

## Setup

```bash
npm install
node server.js
```

Then open **http://localhost:3000**.

## How it works

Each week six difficult fixtures are selected across the Premier League and
Championship. Players predict a scoreline for each before the first kick-off
(usually 15:00 on Saturday, but the deadline is set per week).

| Page | Purpose |
|------|---------|
| **Fixtures** (`index.html`) | The front page. This week's six fixtures, prediction entry, and the deadline countdown. Past weeks are browsable via the tabs. |
| **Ranking** (`ranking.html`) | Season table plus the praise ledger — weekly winners and the end-of-season pot. |
| **Member** (`member.html`) | Player profile: display name, bio, avatar, stats. |

## Scoring

Two independent columns — they are never added together.

| Column | Awarded for |
|--------|-------------|
| **Results** | 1 point per correct result (win / draw / loss). The scoreline doesn't matter. |
| **Exact** | 1 point per exact scoreline. |

An exact scoreline necessarily scores in both columns. The table ranks on
**Results**, using **Exact** as the tie-breaker.

## Praise

Praise is a finite pot expressed in percent — bragging rights and certificates,
not prize money.

- Each completed gameweek puts its allocation (default **1%**) up for grabs.
- Anyone calling **all six results** correctly shares that week's praise equally.
- A week nobody wins rolls its allocation into the end-of-season pot.
- The season-end pot is split **40% / 25% / 15%** for the top three in the table,
  with the remaining **20%** for most exact scorelines.

All of these figures live in `data/gameweeks.json` under `praise` and can be
changed without touching code.

## Admin

Admin routes take an `x-admin-password` header (default `admin2026`, override
with the `ADMIN_PASSWORD` env var).

Publish a gameweek:

```bash
curl -X POST localhost:3000/api/admin/gameweeks \
  -H 'Content-Type: application/json' -H 'x-admin-password: admin2026' \
  -d '{
    "id": "gw3", "number": 3, "label": "Gameweek 3",
    "lockTime": "2026-08-29T14:00:00Z",
    "matches": [
      { "comp": "PL", "home": "Arsenal", "away": "Spurs" }
    ]
  }'
```

Enter a result:

```bash
curl -X POST localhost:3000/api/results \
  -H 'Content-Type: application/json' -H 'x-admin-password: admin2026' \
  -d '{ "matchId": "gw3-m1", "homeGoals": 2, "awayGoals": 1 }'
```
