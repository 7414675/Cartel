require('dotenv').config();
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── File paths ────────────────────────────────────────────────────
const DATA_DIR        = path.join(__dirname, 'data');
const DRIVERS_FILE    = path.join(DATA_DIR, 'drivers.json');
const MESSAGES_FILE   = path.join(DATA_DIR, 'messages.json');
const SENDERS_FILE    = path.join(DATA_DIR, 'senders.json');
const SESSIONS_FILE   = path.join(DATA_DIR, 'sessions.json');
const UPLOADS_DIR     = path.join(DATA_DIR, 'uploads');
const ADMIN_USER      = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS      = process.env.ADMIN_PASSWORD || 'cartel2026';
const ADMIN_PHONE_RAW = process.env.ADMIN_PHONE || null;

[DATA_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d); });
if (!fs.existsSync(DRIVERS_FILE))  fs.writeFileSync(DRIVERS_FILE,  '{}');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(SENDERS_FILE))  fs.writeFileSync(SENDERS_FILE,  '{}');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');

// ── Sessions ──────────────────────────────────────────────────────
const adminSessions        = new Set();
const pendingRegistrations = new Map(); // phone → { name, plate, otp, expiresAt }

// Persist user sessions to disk so logins survive server restarts
function loadUserSessions() { return load(SESSIONS_FILE); }
function saveUserSessions(s) { save(SESSIONS_FILE, s); }

function setUserSession(token, data) {
  const sessions = loadUserSessions();
  sessions[token] = data;
  saveUserSessions(sessions);
}
function deleteUserSession(token) {
  const sessions = loadUserSessions();
  delete sessions[token];
  saveUserSessions(sessions);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  });
  return out;
}

function isAdminAuth(req) { return adminSessions.has(parseCookies(req).adminSession); }
function getUserSession(req) {
  const token = parseCookies(req).userSession;
  if (!token) return null;
  return loadUserSessions()[token] || null;
}

const USER_COOKIE_OPTS = 'HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000';

// ── Data helpers ──────────────────────────────────────────────────
const load = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const save = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const loadDrivers  = () => load(DRIVERS_FILE);
const saveDrivers  = d  => save(DRIVERS_FILE,  d);
const loadMessages = () => load(MESSAGES_FILE);
const saveMessages = m  => save(MESSAGES_FILE, m);
const loadSenders  = () => load(SENDERS_FILE);
const saveSenders  = s  => save(SENDERS_FILE,  s);

function normalizePlate(p) { return p.replace(/[-\s]/g, '').toUpperCase(); }
function normalizePhone(phone) {
  const c = phone.replace(/[-\s()]/g, '');
  if (c.startsWith('0'))   return '+972' + c.slice(1);
  if (c.startsWith('972')) return '+' + c;
  return c;
}

function saveImage(b64, msgId) {
  const m = b64.match(/^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/i);
  if (!m) return null;
  const ext   = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const fname = `${msgId}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fname), Buffer.from(m[2], 'base64'));
  return fname;
}

// ── Rate limiter ──────────────────────────────────────────────────
const rateLimitMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now(), windowMs = 10 * 60 * 1000, max = 5;
  const reqs = (rateLimitMap.get(ip) || []).filter(t => now - t < windowMs);
  reqs.push(now);
  rateLimitMap.set(ip, reqs);
  return reqs.length <= max;
}

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// Admin CSS — no auth required
app.get('/admin/admin.css', (req, res) =>
  res.sendFile(path.join(__dirname, 'admin', 'admin.css')));

// Uploaded images — publicly accessible
app.get('/images/:filename', (req, res) => {
  const fname = path.basename(req.params.filename);
  const fpath = path.join(UPLOADS_DIR, fname);
  if (!fs.existsSync(fpath)) return res.status(404).end();
  res.sendFile(fpath);
});

// Admin auth middleware
app.use('/admin', (req, res, next) => {
  const { method, path: p } = req;
  if (method === 'GET'  && p === '/login')     return next();
  if (method === 'POST' && p === '/api/login') return next();
  if (isAdminAuth(req))                        return next();
  if (p.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/admin/login');
});

// ── Admin pages ───────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  if (isAdminAuth(req)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});
app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'admin', 'index.html')));

// ── Admin API ─────────────────────────────────────────────────────
app.post('/admin/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const sid = crypto.randomBytes(32).toString('hex');
    adminSessions.add(sid);
    res.setHeader('Set-Cookie',
      `adminSession=${sid}; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000`);
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
});

app.post('/admin/api/logout', (req, res) => {
  adminSessions.delete(parseCookies(req).adminSession);
  res.setHeader('Set-Cookie', 'adminSession=; HttpOnly; Path=/; Max-Age=0');
  res.json({ success: true });
});

app.get('/admin/api/drivers',  (req, res) => res.json(loadDrivers()));
app.get('/admin/api/messages', (req, res) => res.json(loadMessages()));

app.delete('/admin/api/drivers/:plate', (req, res) => {
  const plate   = normalizePlate(req.params.plate);
  const drivers = loadDrivers();
  if (!drivers[plate]) return res.status(404).json({ error: 'נהג לא נמצא' });
  delete drivers[plate];
  saveDrivers(drivers);
  res.json({ success: true });
});

app.delete('/admin/api/messages/:id', (req, res) => {
  let msgs = loadMessages();
  const before = msgs.length;
  msgs = msgs.filter(m => m.id !== req.params.id);
  if (msgs.length === before) return res.status(404).json({ error: 'הודעה לא נמצאה' });
  saveMessages(msgs);
  res.json({ success: true });
});

// ── Public static files ───────────────────────────────────────────
app.use(express.static('public'));

// ── User auth API ─────────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { plate, phone, name } = req.body;
  if (!phone)
    return res.status(400).json({ error: 'מספר טלפון הוא שדה חובה' });

  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 10)
    return res.status(400).json({ error: 'מספר טלפון לא תקין' });

  if (plate && plate.trim()) {
    const normalizedPlate = normalizePlate(plate);
    if (!/^\d{7,8}$/.test(normalizedPlate))
      return res.status(400).json({ error: 'מספר רכב לא תקין' });
  }

  // Generate OTP and store pending registration
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  pendingRegistrations.set(normalizedPhone, {
    name:      name ? String(name).trim().slice(0, 50) : '',
    plate:     plate ? plate.trim() : '',
    otp,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  console.log(`[OTP] Phone: ${normalizedPhone} | Code: ${otp} (auto-approved for testing)`);

  res.json({ requiresOtp: true, phone: normalizedPhone });
});

app.post('/api/otp/verify', (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'חסרים פרטים' });

  const normalizedPhone = normalizePhone(phone);
  const pending = pendingRegistrations.get(normalizedPhone);

  // Auto-approve for testing — any code passes (also check expiry)
  if (!pending) return res.status(400).json({ error: 'לא נמצאה בקשת הרשמה. נסה להירשם מחדש.' });
  if (Date.now() > pending.expiresAt)
    return res.status(400).json({ error: 'קוד האימות פג תוקף. נסה להירשם מחדש.' });

  pendingRegistrations.delete(normalizedPhone);

  // Complete registration
  const senders = loadSenders();
  senders[normalizedPhone] = {
    name:         pending.name,
    registeredAt: new Date().toISOString(),
  };
  saveSenders(senders);

  if (pending.plate) {
    const normalizedPlate = normalizePlate(pending.plate);
    if (/^\d{7,8}$/.test(normalizedPlate)) {
      const drivers = loadDrivers();
      drivers[normalizedPlate] = {
        name:         pending.name,
        phone:        normalizedPhone,
        registeredAt: new Date().toISOString(),
      };
      saveDrivers(drivers);
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  setUserSession(token, { phone: normalizedPhone, name: pending.name });
  res.setHeader('Set-Cookie', `userSession=${token}; ${USER_COOKIE_OPTS}`);
  res.json({
    success: true,
    message: pending.plate
      ? 'הרישום הושלם! תקבל הודעות כאשר מישהו ישלח הודעה לגבי הרכב שלך.'
      : 'הרישום הושלם! כעת תוכל לשלוח הודעות.',
  });
});

app.post('/api/login', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'מספר טלפון הוא שדה חובה' });

  const normalizedPhone = normalizePhone(phone);

  // Check senders registry first
  const senders = loadSenders();
  if (senders[normalizedPhone]) {
    const token = crypto.randomBytes(32).toString('hex');
    setUserSession(token, { phone: normalizedPhone, name: senders[normalizedPhone].name || '' });
    res.setHeader('Set-Cookie', `userSession=${token}; ${USER_COOKIE_OPTS}`);
    return res.json({ success: true, name: senders[normalizedPhone].name || '' });
  }

  // Fallback: check drivers (for users registered before senders.json existed)
  const drivers = loadDrivers();
  const driverData = Object.values(drivers).find(d => d.phone === normalizedPhone);
  if (driverData) {
    const token = crypto.randomBytes(32).toString('hex');
    setUserSession(token, { phone: normalizedPhone, name: driverData.name || '' });
    res.setHeader('Set-Cookie', `userSession=${token}; ${USER_COOKIE_OPTS}`);
    return res.json({ success: true, name: driverData.name || '' });
  }

  // Last fallback: admin phone
  if (ADMIN_PHONE_RAW && normalizedPhone === normalizePhone(ADMIN_PHONE_RAW)) {
    const token = crypto.randomBytes(32).toString('hex');
    setUserSession(token, { phone: normalizedPhone, name: ADMIN_USER });
    res.setHeader('Set-Cookie', `userSession=${token}; ${USER_COOKIE_OPTS}`);
    return res.json({ success: true, name: ADMIN_USER });
  }

  res.status(401).json({ error: 'מספר הטלפון לא נמצא במערכת. אנא הרשם תחילה.' });
});

app.get('/api/me', (req, res) => {
  const user = getUserSession(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const drivers = loadDrivers();
  const plates = Object.entries(drivers)
    .filter(([, d]) => d.phone === user.phone)
    .map(([plate]) => plate);
  res.json({ phone: user.phone, name: user.name, plates });
});

app.post('/api/logout', (req, res) => {
  deleteUserSession(parseCookies(req).userSession);
  res.setHeader('Set-Cookie', 'userSession=; HttpOnly; Path=/; Max-Age=0');
  res.json({ success: true });
});

app.get('/api/admin-check', (req, res) => {
  res.json({ isAdmin: isAdminAuth(req) });
});

app.get('/api/inbox', (req, res) => {
  const user = getUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const drivers = loadDrivers();
  const myPlates = new Set(
    Object.entries(drivers)
      .filter(([, d]) => d.phone === user.phone)
      .map(([plate]) => plate)
  );
  const messages = loadMessages().filter(m => myPlates.has(m.plate)).reverse();
  res.json(messages);
});

app.get('/api/profile', (req, res) => {
  const user = getUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const drivers = loadDrivers();
  const plates = Object.entries(drivers)
    .filter(([, d]) => d.phone === user.phone)
    .map(([plate]) => plate);
  res.json({ name: user.name, phone: user.phone, plates });
});

app.put('/api/profile', (req, res) => {
  const user = getUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { name, plate } = req.body;
  const newName = name !== undefined ? String(name).trim().slice(0, 50) : user.name;

  const senders = loadSenders();
  if (senders[user.phone]) {
    senders[user.phone].name = newName;
    saveSenders(senders);
  }

  const drivers = loadDrivers();
  if (plate !== undefined) {
    const trimmedPlate = plate.trim();
    Object.keys(drivers).forEach(p => {
      if (drivers[p].phone === user.phone) delete drivers[p];
    });
    if (trimmedPlate) {
      const normalizedPlate = normalizePlate(trimmedPlate);
      if (!/^\d{7,8}$/.test(normalizedPlate)) {
        return res.status(400).json({ error: 'מספר רכב לא תקין' });
      }
      drivers[normalizedPlate] = { name: newName, phone: user.phone, registeredAt: new Date().toISOString() };
    }
  } else {
    Object.keys(drivers).forEach(p => {
      if (drivers[p].phone === user.phone) drivers[p].name = newName;
    });
  }
  saveDrivers(drivers);

  setUserSession(parseCookies(req).userSession, { phone: user.phone, name: newName });
  res.json({ success: true });
});

// ── Core API ──────────────────────────────────────────────────────
app.post('/api/notify', (req, res) => {
  const user = getUserSession(req);
  if (!user) {
    return res.status(401).json({
      error:     'עליך להיות רשום כדי לשלוח הודעות',
      needsAuth: true,
    });
  }

  const ip = req.ip || req.socket.remoteAddress;
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: 'יותר מדי הודעות. נסה שוב מאוחר יותר.' });

  const { plate, message, revealPhone, imageData } = req.body;
  if (!plate || !message)
    return res.status(400).json({ error: 'מספר רכב והודעה הם שדות חובה' });
  if (message.length > 300)
    return res.status(400).json({ error: 'ההודעה ארוכה מדי (מקסימום 300 תווים)' });

  const normalizedPlate = normalizePlate(plate);
  const drivers = loadDrivers();
  if (!drivers[normalizedPlate])
    return res.status(404).json({ error: 'מספר הרכב לא נמצא במערכת' });

  const driverPhone = drivers[normalizedPlate].phone;
  const msgId       = crypto.randomBytes(8).toString('hex');
  const replyToken  = crypto.randomBytes(16).toString('hex');
  const imageFile   = imageData ? saveImage(imageData, msgId) : null;

  const msgs = loadMessages();
  msgs.push({
    id:          msgId,
    replyToken,
    plate:       normalizedPlate,
    message,
    senderPhone: user.phone,
    revealPhone: !!revealPhone,
    imageFile,
    sentAt:      new Date().toISOString(),
  });
  saveMessages(msgs);

  let logLine = `[SMS] To: ${driverPhone} | Plate: ${normalizedPlate} | Message: ${message}`;
  if (revealPhone) logLine += ` | Sender: ${user.phone}`;
  logLine += `\n  → Driver reply: http://localhost:${PORT}/reply?token=${replyToken}`;
  console.log(logLine);

  res.json({ success: true, message: 'ההודעה נשלחה לנהג בהצלחה!' });
});

app.get('/api/check/:plate', (req, res) => {
  const plate = normalizePlate(req.params.plate);
  res.json({ registered: !!loadDrivers()[plate] });
});

// ── Reply API ─────────────────────────────────────────────────────
app.get('/api/reply', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });
  const msg = loadMessages().find(m => m.replyToken === token);
  if (!msg) return res.status(404).json({ error: 'הודעה לא נמצאה או שהקישור פג תוקף' });
  res.json({
    plate:       msg.plate,
    message:     msg.message,
    imageFile:   msg.imageFile || null,
    sentAt:      msg.sentAt,
    revealPhone: !!msg.revealPhone,
    senderPhone: msg.revealPhone ? msg.senderPhone : null,
  });
});

app.post('/api/reply', (req, res) => {
  const { token }   = req.query;
  const { message } = req.body;
  if (!token || !message) return res.status(400).json({ error: 'חסרים פרטים' });
  const msg = loadMessages().find(m => m.replyToken === token);
  if (!msg) return res.status(404).json({ error: 'הודעה לא נמצאה' });
  console.log(`[Anonymous Reply] Plate: ${msg.plate} | ${message}`);
  res.json({ success: true, message: 'תגובתך נשלחה בהצלחה!' });
});

app.listen(PORT, () => {
  console.log(`Cartel running at http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin  (${ADMIN_USER} / ${ADMIN_PASS})`);
});
