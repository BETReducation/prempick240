const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const cors       = require('cors');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2026';

// ── Paths ──────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');

// In production (Railway) set PERSISTENT_DATA_DIR to a mounted volume path
// so predictions and results survive redeployments.
const PERSISTENT_DIR = process.env.PERSISTENT_DATA_DIR
  ? path.resolve(process.env.PERSISTENT_DATA_DIR)
  : DATA_DIR;

if (!fs.existsSync(PERSISTENT_DIR)) fs.mkdirSync(PERSISTENT_DIR, { recursive: true });

// Gameweeks live on the persistent volume, not in the code image. The copy in
// data/ is only a seed for a fresh deployment — otherwise every deploy would
// overwrite whatever weeks had been published through the admin page.
const GAMEWEEKS_SEED   = path.join(DATA_DIR,       'gameweeks.json');
const GAMEWEEKS_FILE   = path.join(PERSISTENT_DIR, 'gameweeks.json');
const PREDICTIONS_FILE = path.join(PERSISTENT_DIR, 'predictions.json');
const RESULTS_FILE     = path.join(PERSISTENT_DIR, 'results.json');
const ACCESS_CODES_FILE = path.join(PERSISTENT_DIR, 'access-codes.json');
const SESSIONS_FILE     = path.join(PERSISTENT_DIR, 'sessions.json');
const LEADERBOARD_PREV_FILE  = path.join(PERSISTENT_DIR, 'leaderboard-prev.json');

const ADMIN_EMAIL = 'gbyatt@gmail.com';

// ── One-time invite codes (50 footballer name mashups) ─────────────────────────

const INITIAL_ACCESS_CODES = [
  'Cristiano Maldini',    'Lionel Ronaldo',       'Zinedine Lampard',
  'Thierry Ibrahimovic',  'Didier Pirlo',          'Frank Torres',
  'Steven Zidane',        'Wayne Iniesta',          'Fernando Gerrard',
  'Andres Rooney',        'Cesc Buffon',            'Zlatan Fabregas',
  'Arjen Henry',          'Samuel Beckham',         'Pavel Drogba',
  'Michael Totti',        'Patrick Bale',           'Hidetoshi Messi',
  'David Nedved',         'Dimitar Ribery',         'Sergio Robben',
  'Iker Hazard',          'Gianluigi Suarez',       'Andrea Salah',
  'Gareth Seedorf',       'Eden Cannavaro',         'Luis Vieira',
  'Virgil van Ballack',   'Mohamed Scholes',        'Sadio Nesta',
  'Luka Del Piero',       'Toni van Nistelrooy',    'Thomas Essien',
  'Franck Bergkamp',      'Alessandro Aguero',      'Paolo Modric',
  'Francesco Berbatov',   'Ruud Gattuso',           'Juan Makelele',
  'Diego Sneijder',       'Kaka Terry',             'Roberto Ferdinand',
  'Ronaldinho Neville',   'Xavi Muller',            'Petr Mane',
  'Rio Casillas',         'Raul van Persie',         'Robbie Nakata',
  'John Eto',             'Dennis Gerrard'
];

// ── Startup seeding ────────────────────────────────────────────────────────────

function seedAdminAccount() {
  const data  = readJSON(PREDICTIONS_FILE, { users: [] });
  const admin = data.users.find(u => u.email && u.email.toLowerCase() === ADMIN_EMAIL);
  if (admin) {
    if (!admin.isAdmin) {
      admin.isAdmin = true;
      writeJSON(PREDICTIONS_FILE, data);
      console.log(`✅  Admin flag added to existing account: ${ADMIN_EMAIL}`);
    }
    return;
  }
  // Create fresh admin account
  const adminPw = process.env.ADMIN_USER_PASSWORD || crypto.randomBytes(8).toString('hex');
  const userId  = 'user_' + crypto.randomBytes(8).toString('hex');
  const salt    = crypto.randomBytes(16).toString('hex');
  data.users.push({
    id: userId, name: 'Gary', email: ADMIN_EMAIL,
    passwordSalt: salt, passwordHash: hashStr(adminPw, salt),
    isAdmin: true, predictions: {}, registeredAt: new Date().toISOString()
  });
  writeJSON(PREDICTIONS_FILE, data);
  if (!process.env.ADMIN_USER_PASSWORD) {
    console.log(`\n⚑   ADMIN ACCOUNT CREATED`);
    console.log(`    Email:    ${ADMIN_EMAIL}`);
    console.log(`    Password: ${adminPw}`);
    console.log(`    ⚠️  Change this after first sign-in!\n`);
  } else {
    console.log(`✅  Admin account created for ${ADMIN_EMAIL}`);
  }
}

function seedGameweeks() {
  // In local development both paths resolve to data/, so there is nothing to do.
  if (path.resolve(GAMEWEEKS_FILE) === path.resolve(GAMEWEEKS_SEED)) return;
  if (fs.existsSync(GAMEWEEKS_FILE)) return;
  if (!fs.existsSync(GAMEWEEKS_SEED)) {
    console.warn('⚠️   No gameweeks seed found — starting with an empty season');
    writeJSON(GAMEWEEKS_FILE, { season: '', praise: { seasonWeeks: 40, seasonEnd: [] }, gameweeks: [] });
    return;
  }
  fs.copyFileSync(GAMEWEEKS_SEED, GAMEWEEKS_FILE);
  console.log('✅  gameweeks.json seeded onto the persistent volume');
}

function seedAccessCodes() {
  // Seed if file is missing OR exists but has a broken/non-array codes field
  if (fs.existsSync(ACCESS_CODES_FILE)) {
    const existing = readJSON(ACCESS_CODES_FILE, null);
    if (existing && Array.isArray(existing.codes)) return; // looks healthy, skip
    console.warn('⚠️   access-codes.json exists but has unexpected structure — re-seeding');
  }
  writeJSON(ACCESS_CODES_FILE, {
    codes: INITIAL_ACCESS_CODES.map(code => ({ code, used: false, usedBy: null, usedAt: null }))
  });
  console.log(`✅  ${INITIAL_ACCESS_CODES.length} invite codes seeded`);
}

app.use(cors());
app.use(express.json({ limit: '400kb' }));

// JS and CSS: always revalidate so browsers + Cloudflare never serve
// stale versions after a deploy. ETags still let the browser skip the
// download when nothing changed (304 Not Modified).
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── Health check (used by Railway to confirm startup) ─────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Email ──────────────────────────────────────────────────────────────────────
// Provider priority (first one configured wins):
//   1. Resend  — set RESEND_API_KEY  (uses HTTPS API, not SMTP — works on Railway)
//   2. Gmail   — set GMAIL_USER + GMAIL_APP_PASSWORD  (requires App Password)
// Also set APP_URL to your public URL so reset links work.
// Set MAIL_FROM to override the sender address (e.g. "PremPick240 <admin@prempick240.com>").

const emailEnabled = !!(process.env.RESEND_API_KEY || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD));

// Gmail fallback only — Resend uses its HTTP API directly (no SMTP needed)
let gmailMailer = null;
if (!process.env.RESEND_API_KEY && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  gmailMailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    connectionTimeout: 10000,
    socketTimeout:     10000
  });
}

function getFromAddress() {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  if (process.env.RESEND_API_KEY) return '"PremPick240 Prediction League" <onboarding@resend.dev>';
  if (process.env.GMAIL_USER)     return `"PremPick240 Prediction League" <${process.env.GMAIL_USER}>`;
  return '"PremPick240 Prediction League" <noreply@example.com>';
}

const EMAIL_TEXT = (name, resetLink) =>
  `Hi ${name},\n\nWe received a request to reset your PremPick240 Prediction League password.\n\nClick the link below to set a new password. This link expires in 1 hour.\n\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email.\n\n— PremPick240 Prediction League`;

const EMAIL_HTML = (name, resetLink) => `
  <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0b0f1a;color:#e2e8f4;border-radius:12px;">
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#4dc97a;">PremPick240 Prediction League</h2>
    <p style="margin:0 0 20px;color:#6b7a99;font-size:14px;">Password reset request</p>
    <p style="margin:0 0 16px;">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 24px;color:#a0aec0;">We received a request to reset your password. Click the button below — the link expires in <strong>1 hour</strong>.</p>
    <a href="${resetLink}" style="display:inline-block;padding:12px 28px;background:#4dc97a;color:#0b0f1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Reset my password →</a>
    <p style="margin:24px 0 0;font-size:12px;color:#6b7a99;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
  </div>`;

async function sendPasswordResetEmail(to, name, resetLink) {
  if (!emailEnabled) throw new Error('Email is not configured on this server.');

  // ── Resend HTTP API (bypasses SMTP — works on Railway) ───────────────────
  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from:    getFromAddress(),
        to:      [to],
        subject: 'PremPick240 — Reset your password',
        text:    EMAIL_TEXT(name, resetLink),
        html:    EMAIL_HTML(name, resetLink)
      })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || `Resend API error ${r.status}`);
    }
    return;
  }

  // ── Gmail fallback (nodemailer) ───────────────────────────────────────────
  if (gmailMailer) {
    await gmailMailer.sendMail({
      from: getFromAddress(), to,
      subject: 'PremPick240 — Reset your password',
      text:    EMAIL_TEXT(name, resetLink),
      html:    EMAIL_HTML(name, resetLink)
    });
    return;
  }

  throw new Error('No email provider configured.');
}

// ── JSON helpers ───────────────────────────────────────────────────────────────

function readJSON(filePath, defaultValue = {}) {
  if (!fs.existsSync(filePath)) return defaultValue;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return defaultValue; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ── Input sanitisation ────────────────────────────────────────────────────────

function sanitise(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

// ── Password hashing (PBKDF2 via Node built-in crypto) ────────────────────────

function hashStr(value, salt) {
  return crypto.pbkdf2Sync(String(value), salt, 100_000, 32, 'sha256').toString('hex');
}

// Checks a submitted password against a user record.
// Supports new passwordSalt/passwordHash fields, legacy hashed PINs (pinSalt/pinHash),
// and legacy plaintext PINs — enabling transparent migration.
function checkPassword(input, user) {
  if (user.passwordSalt && user.passwordHash)
    return hashStr(input, user.passwordSalt) === user.passwordHash;
  if (user.pinSalt && user.pinHash)                       // legacy hashed PIN
    return hashStr(input, user.pinSalt)     === user.pinHash;
  if (user.pin !== undefined)                             // legacy plaintext PIN
    return String(user.pin) === String(input);
  return false;
}

// Writes a new hashed password onto a user record and removes legacy PIN fields.
// Caller must persist the data file.
function setPassword(user, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  user.passwordSalt = salt;
  user.passwordHash = hashStr(password, salt);
  delete user.pinSalt;
  delete user.pinHash;
  delete user.pin;
}

// ── Rate limiting (in-memory, per IP) ─────────────────────────────────────────

const loginAttempts = new Map();
const RATE_MAX    = 10;
const RATE_WINDOW = 15 * 60 * 1000;

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}

function isRateLimited(req) {
  const key   = getIP(req);
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > RATE_WINDOW) { loginAttempts.delete(key); return false; }
  return entry.count >= RATE_MAX;
}

function recordFailure(req) {
  const key  = getIP(req);
  const now  = Date.now();
  const prev = loginAttempts.get(key);
  if (!prev || now - prev.firstAt > RATE_WINDOW) {
    loginAttempts.set(key, { count: 1, firstAt: now });
  } else {
    loginAttempts.set(key, { count: prev.count + 1, firstAt: prev.firstAt });
  }
}

function clearFailures(req) { loginAttempts.delete(getIP(req)); }

// ── Session tokens (persisted to disk, 30-day TTL) ────────────────────────────

const sessions = new Map();
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

function saveSessions() {
  try {
    const obj = {};
    for (const [token, s] of sessions) obj[token] = s;
    writeJSON(SESSIONS_FILE, obj);
  } catch {}
}

function loadSessions() {
  const saved = readJSON(SESSIONS_FILE, {});
  const now   = Date.now();
  for (const [token, s] of Object.entries(saved)) {
    if (s.expiresAt > now) sessions.set(token, s);   // skip expired
  }
  if (sessions.size > 0) console.log(`✅  Restored ${sessions.size} session(s) from disk`);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL });
  saveSessions();
  return token;
}

function validateSession(token, userId) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() > s.expiresAt) { sessions.delete(token); saveSessions(); return false; }
  return s.userId === userId;
}

function destroySession(token) {
  if (token) { sessions.delete(token); saveSessions(); }
}

function destroyAllSessions(userId) {
  for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t);
  saveSessions();
}

// Sweep expired sessions hourly.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [t, s] of sessions) if (now > s.expiresAt) { sessions.delete(t); changed = true; }
  if (changed) saveSessions();
}, 60 * 60 * 1000);

// ── Gameweek helpers ──────────────────────────────────────────────────────────

function readGameweeks() {
  return readJSON(GAMEWEEKS_FILE, { gameweeks: [], praise: {} });
}

function findGameweek(gwId, gws) {
  return (gws.gameweeks || []).find(g => g.id === gwId) || null;
}

// Returns { match, gameweek } or null.
function findMatch(matchId, gws) {
  for (const gw of gws.gameweeks || []) {
    const match = (gw.matches || []).find(m => m.id === matchId);
    if (match) return { match, gameweek: gw };
  }
  return null;
}

function isGameweekLocked(gw) {
  if (!gw || !gw.lockTime) return false;
  return new Date() >= new Date(gw.lockTime);
}

// A match's own lockTime (if set) overrides its gameweek's — lets a single
// fixture that kicks off earlier than the rest lock on its own schedule.
function isMatchLocked(matchId, gws) {
  const found = findMatch(matchId, gws);
  if (!found) return false;
  if (found.match.lockTime) return new Date() >= new Date(found.match.lockTime);
  return isGameweekLocked(found.gameweek);
}

// The gameweek players are currently predicting: the first one not yet locked,
// falling back to the most recent gameweek once the season is over.
function currentGameweek(gws) {
  const list = gws.gameweeks || [];
  return list.find(gw => !isGameweekLocked(gw)) || list[list.length - 1] || null;
}

function gameweekComplete(gw, results) {
  const matches = gw.matches || [];
  return matches.length > 0 && matches.every(m => results[m.id] && results[m.id].played);
}

// When the weekly prediction count on the ranking table should reset to 0:
// 15 minutes after the final whistle of the last game, i.e. ~2 hours after its
// kick-off (105 min play + 15 min buffer). The last kick-off is the latest
// per-match `kickoff` time, falling back to the gameweek deadline when none are
// set. Returns Infinity if the week carries no timing at all (so it stays
// visible rather than vanishing).
const WEEK_RESET_OFFSET_MS = 120 * 60 * 1000;
function gameweekResetTime(gw) {
  if (!gw) return Infinity;
  const times = [];
  for (const m of gw.matches || []) {
    if (m.kickoff) { const t = new Date(m.kickoff).getTime(); if (!isNaN(t)) times.push(t); }
  }
  if (gw.lockTime) { const t = new Date(gw.lockTime).getTime(); if (!isNaN(t)) times.push(t); }
  if (!times.length) return Infinity;
  return Math.max(...times) + WEEK_RESET_OFFSET_MS;
}
// ── Admin middleware ───────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  // Accept legacy admin-password header
  if (req.headers['x-admin-password'] === ADMIN_PASSWORD) return next();
  // Accept session token from an admin user (auto-admin)
  const token = req.headers['x-session-token'];
  if (token) {
    const s = sessions.get(token);
    if (s && Date.now() <= s.expiresAt) {
      const data = readJSON(PREDICTIONS_FILE, { users: [] });
      const user = data.users.find(u => u.id === s.userId);
      if (user?.isAdmin) return next();
    }
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── Admin routes ───────────────────────────────────────────────────────────────

app.get('/api/admin/verify', requireAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/user-lookup', requireAdmin, (req, res) => {
  const tokens = (req.query.q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const results = data.users
    .filter(u => !u.isAdmin)
    .filter(u => {
      if (!tokens.length) return true;
      const haystack = [u.name, u.displayName, u.email].filter(Boolean).join(' ').toLowerCase();
      return tokens.every(t => haystack.includes(t));
    })
    .map(u => ({ id: u.id, name: u.displayName || u.name, email: u.email || '—', joinedAt: u.createdAt || null }));
  res.json(results);
});

app.get('/api/admin/backup', requireAdmin, (req, res) => {
  const backup = {
    exportedAt:  new Date().toISOString(),
    predictions: readJSON(PREDICTIONS_FILE, { users: [] }),
    results:     readJSON(RESULTS_FILE,     { results: {} })
  };
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="wc2026-backup-${date}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/admin/restore', requireAdmin, (req, res) => {
  const { predictions, results } = req.body;
  if (!predictions || !results)
    return res.status(400).json({ error: 'Invalid backup — must contain predictions and results' });
  writeJSON(PREDICTIONS_FILE, predictions);
  writeJSON(RESULTS_FILE, results);
  res.json({ ok: true });
});

app.post('/api/admin/clear-results', requireAdmin, (req, res) => {
  writeJSON(RESULTS_FILE, { results: {} });
  res.json({ ok: true });
});

app.post('/api/admin/clear-match-predictions', requireAdmin, (req, res) => {
  const { matchIds } = req.body;
  if (!Array.isArray(matchIds) || matchIds.length === 0)
    return res.status(400).json({ error: 'matchIds array required' });
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  let cleared = 0;
  for (const user of data.users) {
    for (const matchId of matchIds) {
      if (user.predictions && user.predictions[matchId] !== undefined) {
        delete user.predictions[matchId];
        cleared++;
      }
    }
  }
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ ok: true, cleared });
});

// Delete all non-admin accounts (keeps Gary's admin account)
app.post('/api/admin/reset-all-users', requireAdmin, (req, res) => {
  const data    = readJSON(PREDICTIONS_FILE, { users: [] });
  const toRemove = data.users.filter(u => !u.isAdmin);
  toRemove.forEach(u => destroyAllSessions(u.id));
  data.users = data.users.filter(u => u.isAdmin);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ ok: true, removed: toRemove.length });
});

// Return all access codes (admin only)
app.get('/api/access-codes', requireAdmin, (req, res) => {
  res.json(readJSON(ACCESS_CODES_FILE, { codes: [] }).codes);
});

// Reinstate (un-use) a specific access code (admin only)
app.post('/api/access-codes/reinstate', requireAdmin, (req, res) => {
  const code = sanitise(req.body.code || '', 100);
  if (!code) return res.status(400).json({ error: 'Code required.' });
  const codesData = readJSON(ACCESS_CODES_FILE, { codes: [] });
  const codesArr  = Array.isArray(codesData.codes) ? codesData.codes : [];
  const entry     = codesArr.find(c => c.code.toLowerCase() === code.toLowerCase());
  if (!entry) return res.status(404).json({ error: 'Code not found.' });
  entry.used   = false;
  entry.usedBy = null;
  entry.usedAt = null;
  writeJSON(ACCESS_CODES_FILE, codesData);
  res.json({ ok: true });
});

// ── Gameweeks ──────────────────────────────────────────────────────────────────

app.get('/api/gameweeks', (req, res) => {
  const gws     = readGameweeks();
  const results = readJSON(RESULTS_FILE, { results: {} }).results || {};
  const out = {
    season: gws.season || '',
    praise: gws.praise || {},
    currentGameweekId: currentGameweek(gws)?.id || null,
    gameweeks: (gws.gameweeks || []).map(gw => ({
      ...gw,
      locked:   isGameweekLocked(gw),
      complete: gameweekComplete(gw, results),
      matches:  (gw.matches || []).map(m => ({ ...m, locked: isMatchLocked(m.id, gws) }))
    }))
  };
  res.json(out);
});

// ── Lock status ────────────────────────────────────────────────────────────────

app.get('/api/lock-status', (req, res) => {
  const gws = readGameweeks();
  const status = {};
  for (const gw of gws.gameweeks || []) {
    status[gw.id] = { locked: isGameweekLocked(gw), lockTime: gw.lockTime || null };
  }
  res.json({ currentGameweekId: currentGameweek(gws)?.id || null, gameweeks: status });
});

// ── Admin: create / update / delete a gameweek ─────────────────────────────────

app.post('/api/admin/gameweeks', requireAdmin, (req, res) => {
  const { id, number, label, lockTime, praise, matches } = req.body;
  if (!id || !Array.isArray(matches) || matches.length === 0)
    return res.status(400).json({ error: 'id and a non-empty matches array are required' });
  if (lockTime && isNaN(new Date(lockTime).getTime()))
    return res.status(400).json({ error: 'lockTime must be a valid ISO date' });

  if (matches.some(m => !m.home || !m.away))
    return res.status(400).json({ error: 'Every match needs a home and an away team' });

  if (matches.some(m => m.kickoff && isNaN(new Date(m.kickoff).getTime())))
    return res.status(400).json({ error: 'kickoff must be a valid ISO date' });

  const clean = matches.map((m, i) => {
    return {
      id:      sanitise(m.id || `${id}-m${i + 1}`, 40),
      comp:    sanitise(m.comp || 'PL', 4),
      home:    sanitise(m.home, 60),
      away:    sanitise(m.away, 60),
      // Preserve `date` and only keep a `kickoff` that was actually supplied.
      // Defaulting kickoff to the week's lockTime used to overwrite the real
      // fixture dates on every save.
      ...(m.date    ? { date:     sanitise(m.date, 10) } : {}),
      ...(m.kickoff ? { kickoff:  m.kickoff }            : {}),
      ...(m.lockTime ? { lockTime: m.lockTime } : {})
    };
  });

  const gws  = readGameweeks();
  if (!Array.isArray(gws.gameweeks)) gws.gameweeks = [];
  // Number.isInteger, not `|| fallback` — gameweek 0 is a legitimate number.
  const num = Number.isInteger(parseInt(number)) ? parseInt(number) : gws.gameweeks.length + 1;
  const next = {
    id: sanitise(id, 40),
    number: num,
    label: sanitise(label || `Gameweek ${num}`, 60),
    lockTime: lockTime || null,
    // Only persist an override when one was explicitly supplied. Storing a
    // value here (especially 0) would pin the week's allocation and stop it
    // tracking the registered-player count.
    ...(praise != null && !isNaN(Number(praise)) ? { praise: Number(praise) } : {}),
    matches: clean
  };

  const idx = gws.gameweeks.findIndex(g => g.id === next.id);
  if (idx >= 0) gws.gameweeks[idx] = next; else gws.gameweeks.push(next);
  gws.gameweeks.sort((a, b) => (a.number || 0) - (b.number || 0));
  writeJSON(GAMEWEEKS_FILE, gws);
  res.json({ success: true, gameweek: next });
});

app.delete('/api/admin/gameweeks/:gwId', requireAdmin, (req, res) => {
  const gws = readGameweeks();
  const before = (gws.gameweeks || []).length;
  gws.gameweeks = (gws.gameweeks || []).filter(g => g.id !== req.params.gwId);
  if (gws.gameweeks.length === before) return res.status(404).json({ error: 'Gameweek not found' });
  writeJSON(GAMEWEEKS_FILE, gws);
  res.json({ success: true });
});
// ── Users / registration ───────────────────────────────────────────────────────

app.get('/api/users', (req, res) => {
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  res.json(data.users.map(u => ({ id: u.id, name: u.name })));
});

app.post('/api/register', (req, res) => {
  if (isRateLimited(req))
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });

  const name      = sanitise(req.body.name, 30);
  const email     = sanitise(req.body.email || '', 254).toLowerCase();
  const password  = String(req.body.password || '').trim();
  const legacyPin = req.body.legacyPin ? String(req.body.legacyPin).trim() : null;

  // Validate email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'A valid email address is required.' });

  // Validate password
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const data = readJSON(PREDICTIONS_FILE, { users: [] });

  // ── Sign in to existing email account ───────────────────────────────────────
  const existing = data.users.find(u => u.email && u.email.toLowerCase() === email);
  if (existing) {
    if (!checkPassword(password, existing)) {
      recordFailure(req);
      return res.status(401).json({ error: 'Email or password incorrect.' });
    }
    clearFailures(req);
    const token = createSession(existing.id);
    return res.json({ userId: existing.id, name: existing.displayName || existing.name, token });
  }

  // ── Optional migration: claim a legacy PIN-based account ────────────────────
  if (legacyPin && name) {
    const legacy = data.users.find(u =>
      !u.email && u.name.toLowerCase() === name.toLowerCase()
    );
    if (legacy && checkPassword(legacyPin, legacy)) {
      // Merge: attach email + new password to existing account, keep userId + predictions
      legacy.email = email;
      setPassword(legacy, password);
      writeJSON(PREDICTIONS_FILE, data);
      const token = createSession(legacy.id);
      return res.json({
        userId: legacy.id,
        name:   legacy.displayName || legacy.name,
        token,
        migrated: true
      });
    }
    // Wrong legacy PIN or no match — fall through to create a fresh account
  }

  // ── New account ──────────────────────────────────────────────────────────────
  if (!name)
    return res.status(400).json({ error: 'Please enter your display name to create an account.' });

  // Validate invite code
  const accessCode = sanitise(req.body.accessCode || '', 100);
  const codesData  = readJSON(ACCESS_CODES_FILE, { codes: [] });
  const codesArr   = Array.isArray(codesData.codes) ? codesData.codes : [];
  const codeEntry  = codesArr.find(
    c => c.code.toLowerCase() === accessCode.toLowerCase()
  );
  if (!codeEntry)
    return res.status(400).json({ error: 'A valid invite code is required to create an account.' });
  if (codeEntry.used)
    return res.status(400).json({ error: 'This invite code has already been used.' });

  const userId = 'user_' + crypto.randomBytes(8).toString('hex');
  const salt   = crypto.randomBytes(16).toString('hex');
  data.users.push({
    id:           userId,
    name,
    email,
    passwordSalt: salt,
    passwordHash: hashStr(password, salt),
    predictions:  {},
    registeredAt: new Date().toISOString(),
    inviteCode:   accessCode
  });

  try {
    writeJSON(PREDICTIONS_FILE, data);
    // Mark code as used
    codeEntry.used   = true;
    codeEntry.usedBy = userId;
    codeEntry.usedAt = new Date().toISOString();
    writeJSON(ACCESS_CODES_FILE, codesData);
  } catch (err) {
    console.error('Registration write error:', err);
    return res.status(500).json({ error: 'Server error saving your account. Please try again.' });
  }

  const token = createSession(userId);
  res.json({ userId, name, token });
});

// ── Logout ─────────────────────────────────────────────────────────────────────

app.post('/api/logout', (req, res) => {
  destroySession(req.headers['x-session-token']);
  res.json({ ok: true });
});

// ── Whoami ─────────────────────────────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  const token = req.headers['x-session-token'];
  if (!token) return res.json({ userId: null, isAdmin: false });
  const s = sessions.get(token);
  if (!s) return res.json({ userId: null, isAdmin: false });
  if (Date.now() > s.expiresAt) { sessions.delete(token); return res.json({ userId: null, isAdmin: false }); }
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === s.userId);
  if (!user) return res.json({ userId: null, isAdmin: false });
  res.json({ userId: user.id, name: user.displayName || user.name, isAdmin: !!user.isAdmin });
});

// ── Forgot password ────────────────────────────────────────────────────────────

app.post('/api/forgot-password', async (req, res) => {
  const email = sanitise(req.body.email || '', 254).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'A valid email address is required.' });

  // Always return 200 so attackers can't enumerate registered emails.
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.email && u.email.toLowerCase() === email);
  if (!user) return res.json({ ok: true });

  // Generate a 1-hour reset token
  const token = crypto.randomBytes(32).toString('hex');
  user.resetToken       = token;
  user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  writeJSON(PREDICTIONS_FILE, data);

  const appUrl    = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const resetLink = `${appUrl}/reset.html?token=${token}`;

  try {
    await sendPasswordResetEmail(user.email, user.displayName || user.name, resetLink);
  } catch (err) {
    console.error('Password reset email failed:', err.message);
    // Use 422 (not 503) — Railway intercepts 5xx responses and returns HTML,
    // which breaks the frontend JSON error parsing.
    return res.status(422).json({ error: err.message || 'Could not send the reset email.' });
  }

  res.json({ ok: true });
});

// ── Reset password (via email token) ──────────────────────────────────────────

app.post('/api/reset-password', (req, res) => {
  const { token, password } = req.body;
  if (!token)
    return res.status(400).json({ error: 'Reset token required.' });
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u =>
    u.resetToken === token &&
    u.resetTokenExpiry &&
    new Date(u.resetTokenExpiry) > new Date()
  );

  if (!user)
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

  setPassword(user, password);
  delete user.resetToken;
  delete user.resetTokenExpiry;
  writeJSON(PREDICTIONS_FILE, data);

  // Invalidate all existing sessions so the user must sign in with new password
  destroyAllSessions(user.id);

  res.json({ ok: true });
});

// ── Predictions ────────────────────────────────────────────────────────────────

// Everyone's predictions, but only for gameweeks that have locked — before
// kick-off a player must not be able to see what anyone else has gone for.
app.get('/api/predictions', (req, res) => {
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const gws  = readGameweeks();
  const visible = new Set();
  for (const gw of gws.gameweeks || [])
    for (const m of gw.matches || [])
      if (isMatchLocked(m.id, gws)) visible.add(m.id);

  res.json(data.users.map(u => {
    const preds = {};
    for (const [matchId, score] of Object.entries(u.predictions || {}))
      if (visible.has(matchId)) preds[matchId] = score;
    return { id: u.id, name: u.name, displayName: u.displayName || u.name, predictions: preds };
  }));
});

// A player's own predictions — always fully visible to them.
app.get('/api/predictions/:userId', (req, res) => {
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, predictions: user.predictions || {} });
});

app.post('/api/predictions/:userId', (req, res) => {
  if (!validateSession(req.headers['x-session-token'], req.params.userId))
    return res.status(401).json({ error: 'Session invalid or expired. Please sign in again.' });

  const { predictions } = req.body;
  if (!predictions || typeof predictions !== 'object')
    return res.status(400).json({ error: 'predictions object required' });

  const gws  = readGameweeks();
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Start from everything the player already has. The client submits one
  // gameweek at a time, so a blind rebuild here would wipe every other week.
  const updated = { ...(user.predictions || {}) };

  // `scope` lists the gameweek ids this submission is authoritative for. Within
  // those (and only those) an omitted match means the player cleared it, so we
  // drop it first and let the loop below re-add whatever was actually sent.
  const scope = Array.isArray(req.body.scope) ? req.body.scope : [];
  for (const gwId of scope) {
    const gw = findGameweek(gwId, gws);
    if (!gw) continue;
    for (const m of gw.matches || []) {
      if (!isMatchLocked(m.id, gws)) delete updated[m.id];
    }
  }

  let rejected = 0;
  for (const [matchId, score] of Object.entries(predictions)) {
    if (!findMatch(matchId, gws)) { rejected++; continue; }
    if (isMatchLocked(matchId, gws)) { rejected++; continue; }
    const h = parseInt(score?.home);
    const a = parseInt(score?.away);
    // Cleared/empty inputs are skipped, which deletes the prediction.
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0 || h > 99 || a > 99) continue;
    updated[matchId] = { home: h, away: a };
  }

  user.predictions  = updated;
  user.lastUpdated  = new Date().toISOString();
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true, saved: Object.keys(updated).length, rejected });
});
// ── Admin: override any player's prediction ────────────────────────────────────

app.post('/api/admin/predictions/:userId/:matchId', requireAdmin, (req, res) => {
  const { home, away } = req.body;
  const h = parseInt(home);
  const a = parseInt(away);
  if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return res.status(400).json({ error: 'Invalid scores' });
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.predictions) user.predictions = {};
  user.predictions[req.params.matchId] = { home: h, away: a };
  user.lastUpdated = new Date().toISOString();
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Results (admin) ────────────────────────────────────────────────────────────

app.get('/api/results', (req, res) => {
  res.json(readJSON(RESULTS_FILE, { results: {} }));
});

function snapshotLeaderboard() {
  const board = calcLeaderboard();
  const positions = {};
  board.forEach((p, i) => { positions[p.id] = i + 1; });
  writeJSON(LEADERBOARD_PREV_FILE, { positions, snapshottedAt: new Date().toISOString() });
}

app.get('/api/leaderboard/previous', (req, res) => {
  res.json(readJSON(LEADERBOARD_PREV_FILE, { positions: {} }));
});

app.post('/api/results', requireAdmin, (req, res) => {
  const { matchId, homeGoals, awayGoals, winner, etHome, etAway } = req.body;
  if (!matchId || homeGoals === undefined || awayGoals === undefined)
    return res.status(400).json({ error: 'matchId, homeGoals, awayGoals required' });
  if (winner && winner !== 'home' && winner !== 'away')
    return res.status(400).json({ error: 'winner must be "home" or "away"' });
  snapshotLeaderboard();
  const data = readJSON(RESULTS_FILE, { results: {} });
  const entry = {
    home: parseInt(homeGoals), away: parseInt(awayGoals),
    played: true, recordedAt: new Date().toISOString()
  };
  if (winner) entry.winner = winner;
  if (etHome != null) entry.etHome = parseInt(etHome);
  if (etAway != null) entry.etAway = parseInt(etAway);
  data.results[matchId] = entry;
  writeJSON(RESULTS_FILE, data);
  res.json({ success: true });
});

app.delete('/api/results/:matchId', requireAdmin, (req, res) => {
  snapshotLeaderboard();
  const data = readJSON(RESULTS_FILE, { results: {} });
  delete data.results[req.params.matchId];
  writeJSON(RESULTS_FILE, data);
  res.json({ success: true });
});

// ── Leaderboard ────────────────────────────────────────────────────────────────
//
// Two independent columns, never summed:
//   resultPoints — 1 per correct result (W/D/L), scoreline irrelevant
//   scorePoints  — 1 per exact scoreline
// An exact scoreline scores in BOTH columns (it is necessarily the right result).
// Ranking is by resultPoints, with scorePoints as the tie-breaker.

function calcLeaderboard() {
  const users   = readJSON(PREDICTIONS_FILE, { users: [] }).users;
  const results = readJSON(RESULTS_FILE,     { results: {} }).results || {};
  const gws     = readGameweeks();

  // The week whose prediction counts the ranking table shows: the one players
  // are currently predicting (or the most recent). Its counts stay visible
  // through lock and the games, then reset to 0 once its window closes.
  const current      = currentGameweek(gws);
  const currentOpen  = current && Date.now() < gameweekResetTime(current);
  const currentMatchIds = currentOpen ? (current.matches || []).map(m => m.id) : [];

  return users.map(user => {
    const preds = user.predictions || {};
    let resultPoints = 0, scorePoints = 0, played = 0;
    const matchPoints  = {};
    const perGameweek  = {};

    for (const gw of gws.gameweeks || []) {
      const matches = gw.matches || [];
      let gwResults = 0, gwScores = 0, gwPlayed = 0;

      for (const m of matches) {
        const result = results[m.id];
        if (!result || !result.played) continue;
        gwPlayed++; played++;

        const pred = preds[m.id];
        if (!pred) { matchPoints[m.id] = { result: 0, score: 0, predicted: false }; continue; }

        const correctResult = Math.sign(result.home - result.away) === Math.sign(pred.home - pred.away);
        const correctScore  = pred.home === result.home && pred.away === result.away;
        if (correctResult) { resultPoints++; gwResults++; }
        if (correctScore)  { scorePoints++;  gwScores++;  }
        matchPoints[m.id] = { result: correctResult ? 1 : 0, score: correctScore ? 1 : 0, predicted: true };
      }

      // "Perfect" = every fixture in the week played, and every result called right.
      perGameweek[gw.id] = {
        resultPoints: gwResults,
        scorePoints:  gwScores,
        played:       gwPlayed,
        total:        matches.length,
        perfect:      matches.length > 0 && gwPlayed === matches.length && gwResults === matches.length
      };
    }

    return {
      id: user.id,
      name: user.name,
      displayName: user.displayName || user.name,
      avatar: user.avatar || null,
      resultPoints, scorePoints,
      matchPoints, perGameweek,
      matchesScored: played,
      predictionsEntered: Object.keys(preds).length,
      weeklyPredictions: currentMatchIds.filter(id => preds[id]).length
    };
  }).sort((a, b) =>
    b.resultPoints - a.resultPoints ||
    b.scorePoints  - a.scorePoints  ||
    a.name.localeCompare(b.name)
  );
}

app.get('/api/leaderboard', (req, res) => res.json(calcLeaderboard()));

// ── Praise ─────────────────────────────────────────────────────────────────────
//
// Praise is a finite pot expressed in percent. Each completed gameweek puts its
// allocation up for grabs: anyone calling all 6 results correctly wins a share.
// Weeks nobody wins roll their allocation into the season-end pot, which is then
// split by the percentages in gameweeks.json → praise.seasonEnd.

function calcPraise() {
  const gws     = readGameweeks();
  const results = readJSON(RESULTS_FILE, { results: {} }).results || {};
  const board   = calcLeaderboard();

  // Praise is denominated in points, not percent. The season pot is one point
  // per registered player per week, so a single week is worth exactly the
  // number of players. Both figures move if someone joins mid-season — see
  // CLAUDE.md, this is deliberate.
  const seasonWeeks  = Number(gws.praise?.seasonWeeks ?? 40);
  const playerCount  = board.length;
  const weeklyBase   = playerCount;
  const totalPot     = playerCount * seasonWeeks;

  const weekly = [];
  let running = 0;   // banked by weeks nobody won; reset to 0 on every payout
  let claimed = 0;

  for (const gw of gws.gameweeks || []) {
    if (!gameweekComplete(gw, results)) continue;

    // A week's own allocation may be overridden per gameweek; otherwise it is
    // the standard weekly base.
    const allocation = gw.praise != null ? Number(gw.praise) : weeklyBase;
    running += allocation;

    const winners = board
      .filter(p => p.perGameweek[gw.id]?.perfect)
      .map(p => ({ id: p.id, name: p.name, displayName: p.displayName }));

    if (winners.length) {
      const pot = running;
      claimed += pot;
      running  = 0;                       // pot emptied, starts again from zero
      weekly.push({
        gameweekId: gw.id, number: gw.number, label: gw.label,
        allocation, pot, winners,
        sharePerWinner: pot / winners.length,
        rolledOver: false
      });
    } else {
      weekly.push({
        gameweekId: gw.id, number: gw.number, label: gw.label,
        allocation, pot: running, winners: [],
        sharePerWinner: 0,
        rolledOver: true
      });
    }
  }

  // What this week's winners would actually share: everything banked by
  // previous winnerless weeks, plus this week's own allocation.
  const currentPot = running + weeklyBase;
  const remaining  = Math.max(0, totalPot - claimed);

  // Whatever is never won weekly is split at the end of the season.
  const splits    = gws.praise?.seasonEnd || [];
  const mostExact = board.length ? Math.max(...board.map(p => p.scorePoints)) : 0;

  const seasonEnd = splits.map(s => {
    let candidates = [];
    if      (s.key === 'league1st' && board[0]) candidates = [board[0]];
    else if (s.key === 'league2nd' && board[1]) candidates = [board[1]];
    else if (s.key === 'league3rd' && board[2]) candidates = [board[2]];
    else if (s.key === 'mostExact') candidates = board.filter(p => p.scorePoints === mostExact && mostExact > 0);
    return {
      ...s,
      praise: Math.round(remaining * (s.percent / 100)),
      leaders: candidates.map(p => ({ id: p.id, name: p.name, displayName: p.displayName }))
    };
  });

  return {
    seasonWeeks, playerCount, weeklyBase,
    totalPot, claimed, remaining,
    currentPot,
    weekly,
    seasonEnd
  };
}

app.get('/api/praise', (req, res) => res.json(calcPraise()));
// ── Profile ────────────────────────────────────────────────────────────────────

app.get('/api/profile/:userId', (req, res) => {
  const data  = readJSON(PREDICTIONS_FILE, { users: [] });
  const user  = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const board = calcLeaderboard();
  const rank  = board.findIndex(u => u.id === req.params.userId) + 1;
  const entry = board.find(u => u.id === req.params.userId) || {};
  res.json({
    id: user.id, name: user.name,
    displayName: user.displayName || user.name,
    bio: user.bio || '', avatar: user.avatar || null,
    isAdmin: !!user.isAdmin,
    joinedAt: user.registeredAt,
    inviteCode: user.inviteCode || null,
    stats: {
      totalPoints:        entry.totalPoints        || 0,
      rank, totalPlayers: board.length,
      correctResults:     entry.correctResults     || 0,
      correctScores:      entry.correctScores      || 0,
      predictionsEntered: entry.predictionsEntered || 0
    },
    matchPoints: entry.matchPoints || {}
  });
});

app.post('/api/profile/:userId/update', (req, res) => {
  const { password, displayName, bio } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(password, user)) return res.status(401).json({ error: 'Incorrect password.' });
  const cleanName = sanitise(displayName, 30);
  if (!cleanName) return res.status(400).json({ error: 'Display name required.' });
  user.displayName = cleanName;
  if (bio !== undefined) user.bio = sanitise(String(bio), 200);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

app.post('/api/profile/:userId/avatar', (req, res) => {
  const { password, avatar } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(password, user)) return res.status(401).json({ error: 'Incorrect password.' });
  if (!avatar || !/^data:image\/(jpeg|png|gif|webp);base64,/.test(avatar))
    return res.status(400).json({ error: 'Invalid image format. Please use JPEG, PNG, GIF or WebP.' });
  if (avatar.length > 250_000)
    return res.status(400).json({ error: 'Image too large — please use a smaller photo.' });
  user.avatar = avatar;
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Change password ────────────────────────────────────────────────────────────

app.post('/api/users/:userId/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(currentPassword, user)) return res.status(401).json({ error: 'Current password incorrect.' });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  setPassword(user, newPassword);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Reset predictions ──────────────────────────────────────────────────────────

app.post('/api/predictions/:userId/reset', (req, res) => {
  const { password } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const user = data.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(password, user)) return res.status(401).json({ error: 'Incorrect password.' });
  user.predictions = {};
  user.lastUpdated = new Date().toISOString();
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Delete user ────────────────────────────────────────────────────────────────

app.delete('/api/users/:userId', (req, res) => {
  const { password } = req.body;
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const idx  = data.users.findIndex(u => u.id === req.params.userId);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (!checkPassword(password, data.users[idx])) return res.status(401).json({ error: 'Incorrect password.' });
  destroyAllSessions(data.users[idx].id);
  data.users.splice(idx, 1);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Admin: delete any user ──────────────────────────────────────────────────────

app.delete('/api/admin/users/:userId', requireAdmin, (req, res) => {
  const data = readJSON(PREDICTIONS_FILE, { users: [] });
  const idx  = data.users.findIndex(u => u.id === req.params.userId);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (data.users[idx].isAdmin) return res.status(403).json({ error: 'Cannot remove the admin account.' });
  destroyAllSessions(data.users[idx].id);
  data.users.splice(idx, 1);
  writeJSON(PREDICTIONS_FILE, data);
  res.json({ success: true });
});

// ── Global error handler (returns JSON for all unhandled route errors) ─────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`⚽  PremPick240 running at http://localhost:${PORT}`);
  console.log(`🔑  Admin password: ${ADMIN_PASSWORD}`);
  if (!emailEnabled) console.log('⚠️   Email not configured — set RESEND_API_KEY (recommended) or GMAIL_USER + GMAIL_APP_PASSWORD to enable password reset.');
  loadSessions();
  seedGameweeks();
  seedAdminAccount();
  seedAccessCodes();
});
