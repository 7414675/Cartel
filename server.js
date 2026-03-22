require('dotenv').config();
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const twilio   = process.env.TWILIO_ACCOUNT_SID
  ? require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

async function sendSms(to, body) {
  if (!twilio) { console.log(`[SMS mock] To: ${to} | ${body}`); return; }
  try {
    await twilio.messages.create({ from: process.env.TWILIO_FROM, to, body });
  } catch (e) {
    console.error(`[SMS error] ${e.message}`);
  }
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── File paths ────────────────────────────────────────────────────
const DATA_DIR        = process.env.DATA_DIR || path.join(__dirname, 'data');
const DRIVERS_FILE    = path.join(DATA_DIR, 'drivers.json');
const MESSAGES_FILE   = path.join(DATA_DIR, 'messages.json');
const SENDERS_FILE    = path.join(DATA_DIR, 'senders.json');
const SESSIONS_FILE   = path.join(DATA_DIR, 'sessions.json');
const BLOCKS_FILE     = path.join(DATA_DIR, 'blocks.json');
const REPORTS_FILE    = path.join(DATA_DIR, 'reports.json');
const BANNED_FILE     = path.join(DATA_DIR, 'banned.json');
const CONTACTS_FILE   = path.join(DATA_DIR, 'contacts.json');
const ADMINS_FILE     = path.join(DATA_DIR, 'admins.json');
const UPLOADS_DIR     = path.join(DATA_DIR, 'uploads');

[DATA_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(DRIVERS_FILE))  fs.writeFileSync(DRIVERS_FILE,  '{}');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(SENDERS_FILE))  fs.writeFileSync(SENDERS_FILE,  '{}');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');
if (!fs.existsSync(BLOCKS_FILE))   fs.writeFileSync(BLOCKS_FILE,   '{}');
if (!fs.existsSync(REPORTS_FILE))  fs.writeFileSync(REPORTS_FILE,  '[]');
if (!fs.existsSync(BANNED_FILE))    fs.writeFileSync(BANNED_FILE,    '{}');
if (!fs.existsSync(CONTACTS_FILE)) fs.writeFileSync(CONTACTS_FILE, '[]');
if (!fs.existsSync(ADMINS_FILE))   fs.writeFileSync(ADMINS_FILE,   '{}');

// Auto-seed admin from ADMIN_PHONE env var
if (process.env.ADMIN_PHONE) {
  const admins = JSON.parse(fs.readFileSync(ADMINS_FILE));
  const adminPhone = process.env.ADMIN_PHONE;
  if (!admins[adminPhone]) {
    admins[adminPhone] = { grantedAt: new Date().toISOString(), grantedBy: 'system' };
    fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins));
    console.log(`[Admin] Seeded admin: ${adminPhone}`);
  }
}

// ── Sessions ──────────────────────────────────────────────────────
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

function getUserSession(req) {
  const token = parseCookies(req).userSession;
  if (!token) return null;
  return loadUserSessions()[token] || null;
}

const USER_COOKIE_OPTS = 'HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000';

function isAdmin(req) {
  const user = getUserSession(req);
  if (!user) return false;
  return !!loadAdmins()[user.phone];
}

// ── Data helpers ──────────────────────────────────────────────────
const load = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const save = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const loadDrivers  = () => load(DRIVERS_FILE);
const saveDrivers  = d  => save(DRIVERS_FILE,  d);
const loadMessages = () => load(MESSAGES_FILE);
const saveMessages = m  => save(MESSAGES_FILE, m);
const loadSenders  = () => load(SENDERS_FILE);
const saveSenders  = s  => save(SENDERS_FILE,  s);
const loadBlocks   = () => load(BLOCKS_FILE);
const saveBlocks   = b  => save(BLOCKS_FILE,   b);
const loadReports  = () => load(REPORTS_FILE);
const saveReports  = r  => save(REPORTS_FILE,  r);
const loadBanned    = () => load(BANNED_FILE);
const saveBanned    = b  => save(BANNED_FILE,    b);
const loadContacts  = () => load(CONTACTS_FILE);
const saveContacts  = c  => save(CONTACTS_FILE,  c);
const loadAdmins    = () => load(ADMINS_FILE);
const saveAdmins    = a  => save(ADMINS_FILE,    a);

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

// Admin middleware — phone-number-based role check
app.use('/admin', (req, res, next) => {
  const { path: p } = req;
  if (p === '/admin.css') return next(); // already handled above
  if (isAdmin(req)) return next();
  if (p.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/');
});

// ── Admin pages ───────────────────────────────────────────────────
app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'admin', 'index.html')));

// ── Admin API ─────────────────────────────────────────────────────
// Grant admin to a phone number
app.post('/admin/api/admins/:phone', (req, res) => {
  const phone   = decodeURIComponent(req.params.phone);
  const admins  = loadAdmins();
  const granter = getUserSession(req);
  admins[phone] = { grantedAt: new Date().toISOString(), grantedBy: granter.phone };
  saveAdmins(admins);
  res.json({ success: true });
});

// Revoke admin from a phone number (cannot revoke yourself)
app.delete('/admin/api/admins/:phone', (req, res) => {
  const phone  = decodeURIComponent(req.params.phone);
  const me     = getUserSession(req);
  if (phone === me.phone) return res.status(400).json({ error: 'לא ניתן לבטל הרשאת מנהל מעצמך' });
  const admins = loadAdmins();
  delete admins[phone];
  saveAdmins(admins);
  res.json({ success: true });
});

app.get('/admin/api/admins', (req, res) => {
  const admins  = loadAdmins();
  const senders = loadSenders();
  const result  = Object.entries(admins).map(([phone, info]) => ({
    phone,
    name:      senders[phone]?.name || '—',
    grantedAt: info.grantedAt,
    grantedBy: info.grantedBy,
  }));
  res.json(result);
});

app.get('/admin/api/drivers',  (req, res) => res.json(loadDrivers()));
app.get('/admin/api/messages', (req, res) => res.json(loadMessages()));
app.get('/admin/api/reports',  (req, res) => res.json(loadReports()));
app.get('/admin/api/banned',   (req, res) => res.json(loadBanned()));

app.post('/admin/api/ban/:phone', (req, res) => {
  const phone   = decodeURIComponent(req.params.phone);
  const banned  = loadBanned();
  banned[phone] = { bannedAt: new Date().toISOString(), reason: req.body.reason || '' };
  saveBanned(banned);
  // Remove all their sessions
  const sessions = loadUserSessions();
  Object.keys(sessions).forEach(t => { if (sessions[t].phone === phone) delete sessions[t]; });
  saveUserSessions(sessions);
  // Remove from senders + drivers
  const senders = loadSenders(); delete senders[phone]; saveSenders(senders);
  const drivers = loadDrivers();
  Object.keys(drivers).forEach(p => { if (drivers[p].phone === phone) delete drivers[p]; });
  saveDrivers(drivers);
  res.json({ success: true });
});

app.post('/admin/api/unban/:phone', (req, res) => {
  const phone  = decodeURIComponent(req.params.phone);
  const banned = loadBanned();
  delete banned[phone];
  saveBanned(banned);
  res.json({ success: true });
});

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

  if (loadBanned()[normalizedPhone])
    return res.status(403).json({ error: 'מספר טלפון זה חסום מהשירות. לפרטים פנה לתמיכה.' });

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

  sendSms(normalizedPhone, `קוד האימות שלך ב-Cartel הוא: ${otp}`);

  res.json({ requiresOtp: true, phone: normalizedPhone });
});

app.post('/api/otp/verify', (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'חסרים פרטים' });

  const normalizedPhone = normalizePhone(phone);
  const pending = pendingRegistrations.get(normalizedPhone);

  if (!pending) return res.status(400).json({ error: 'לא נמצאה בקשת הרשמה. נסה להירשם מחדש.' });
  if (Date.now() > pending.expiresAt)
    return res.status(400).json({ error: 'קוד האימות פג תוקף. נסה להירשם מחדש.' });
  if (otp.trim() !== pending.otp)
    return res.status(400).json({ error: 'קוד האימות שגוי. נסה שנית.' });

  pendingRegistrations.delete(normalizedPhone);

  // Complete registration
  const senders = loadSenders();
  senders[normalizedPhone] = {
    name:         pending.name,
    registeredAt: new Date().toISOString(),
    consentAt:    new Date().toISOString(),
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

  res.status(401).json({ error: 'מספר הטלפון לא נמצא במערכת. אנא הרשם תחילה.' });
});

app.get('/api/me', (req, res) => {
  const user = getUserSession(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const drivers = loadDrivers();
  const plates = Object.entries(drivers)
    .filter(([, d]) => d.phone === user.phone)
    .map(([plate]) => plate);
  res.json({ phone: user.phone, name: user.name, plates, isAdmin: isAdmin(req) });
});

app.post('/api/logout', (req, res) => {
  deleteUserSession(parseCookies(req).userSession);
  res.setHeader('Set-Cookie', 'userSession=; HttpOnly; Path=/; Max-Age=0');
  res.json({ success: true });
});

app.get('/api/admin-check', (req, res) => {
  res.json({ isAdmin: isAdmin(req) });
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
  const all = loadMessages().filter(m =>
    myPlates.has(m.plate) ||          // received as driver
    m.senderPhone === user.phone ||   // sent by user
    m.recipientPhone === user.phone   // reply addressed to user
  );

  // Group into threads keyed by threadId (fallback to id)
  const threadMap = new Map();
  for (const m of all) {
    const key = m.threadId || m.id;
    if (!threadMap.has(key)) threadMap.set(key, []);
    threadMap.get(key).push(m);
  }

  // Sort messages within each thread chronologically; sort threads by latest message
  const threads = [...threadMap.values()]
    .map(msgs => msgs.sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt)))
    .sort((a, b) => new Date(b[b.length - 1].sentAt) - new Date(a[a.length - 1].sentAt));

  res.json({ userPhone: user.phone, threads });
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

// ── GDPR: Delete account ──────────────────────────────────────────
app.delete('/api/account', (req, res) => {
  const user = getUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // Remove from senders
  const senders = loadSenders();
  delete senders[user.phone];
  saveSenders(senders);

  // Remove from drivers
  const drivers = loadDrivers();
  Object.keys(drivers).forEach(p => {
    if (drivers[p].phone === user.phone) delete drivers[p];
  });
  saveDrivers(drivers);

  // Anonymize messages sent by this user (replace senderPhone with null)
  const messages = loadMessages();
  messages.forEach(m => {
    if (m.senderPhone === user.phone) { m.senderPhone = null; m.revealPhone = false; }
  });
  saveMessages(messages);

  // Remove blocks associated with this user
  const blocks = loadBlocks();
  delete blocks[user.phone];
  Object.keys(blocks).forEach(k => {
    blocks[k] = blocks[k].filter(p => p !== user.phone);
  });
  saveBlocks(blocks);

  // Delete session
  const token = parseCookies(req).userSession;
  deleteUserSession(token);
  res.setHeader('Set-Cookie', 'userSession=; HttpOnly; Path=/; Max-Age=0');
  res.json({ success: true });
});

// ── GDPR: Export user data ────────────────────────────────────────
app.get('/api/export', (req, res) => {
  const user = getUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const drivers = loadDrivers();
  const plates = Object.entries(drivers)
    .filter(([, d]) => d.phone === user.phone)
    .map(([plate, d]) => ({ plate, registeredAt: d.registeredAt }));

  const messages = loadMessages()
    .filter(m => plates.some(p => p.plate === m.plate))
    .map(m => ({ id: m.id, plate: m.plate, message: m.message, sentAt: m.sentAt }));

  const senders = loadSenders();
  const profile = senders[user.phone] || {};

  const exportData = {
    exportedAt: new Date().toISOString(),
    profile: {
      name: user.name,
      phone: user.phone,
      registeredAt: profile.registeredAt,
      consentAt: profile.consentAt,
    },
    vehicles: plates,
    messagesReceived: messages,
  };

  res.setHeader('Content-Disposition', `attachment; filename="cartel-data-${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(exportData);
});

// ── Contact Admin ─────────────────────────────────────────────────
app.post('/api/contact', (req, res) => {
  const { name, phone, message } = req.body;
  if (!message || !String(message).trim())
    return res.status(400).json({ error: 'יש להזין הודעה' });
  const user = getUserSession(req);
  const contacts = loadContacts();
  contacts.push({
    id:        crypto.randomBytes(8).toString('hex'),
    name:      user ? user.name : (name ? String(name).trim().slice(0, 50) : ''),
    phone:     user ? user.phone : (phone ? String(phone).trim().slice(0, 20) : ''),
    message:   String(message).trim().slice(0, 1000),
    sentAt:    new Date().toISOString(),
    read:      false,
  });
  saveContacts(contacts);
  res.json({ success: true });
});

app.get('/admin/api/contacts', (req, res) => res.json(loadContacts()));

app.post('/admin/api/contacts/:id/read', (req, res) => {
  const contacts = loadContacts();
  const c = contacts.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.read = true;
  saveContacts(contacts);
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

  // Check if driver has blocked this sender
  const blocks = loadBlocks();
  const driverBlocks = blocks[driverPhone] || [];
  if (driverBlocks.includes(user.phone))
    return res.status(403).json({ error: 'לא ניתן לשלוח הודעה לנהג זה.' });

  const msgId       = crypto.randomBytes(8).toString('hex');
  const replyToken  = crypto.randomBytes(16).toString('hex');
  const imageFile   = imageData ? saveImage(imageData, msgId) : null;

  const msgs = loadMessages();
  msgs.push({
    id:          msgId,
    threadId:    msgId,
    replyToken,
    plate:       normalizedPlate,
    message,
    senderPhone: user.phone,
    revealPhone: !!revealPhone,
    imageFile,
    sentAt:      new Date().toISOString(),
  });
  saveMessages(msgs);

  const replyUrl = `${process.env.APP_URL || `http://localhost:${PORT}`}/reply?token=${replyToken}`;
  let smsBody = `הודעה חדשה ברכבך (${normalizedPlate}):\n"${message}"`;
  if (revealPhone) smsBody += `\nמספר השולח: ${user.phone}`;
  smsBody += `\nלתגובה: ${replyUrl}`;
  sendSms(driverPhone, smsBody);
  console.log(`[SMS] To: ${driverPhone} | Plate: ${normalizedPlate} | Reply: ${replyUrl}`);

  res.json({ success: true, message: 'ההודעה נשלחה לנהג בהצלחה!' });
});

app.get('/api/check/:plate', (req, res) => {
  const plate = normalizePlate(req.params.plate);
  res.json({ registered: !!loadDrivers()[plate] });
});

// ── Report a message ──────────────────────────────────────────────
app.post('/api/report/:msgId', (req, res) => {
  const user = getUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const msg = loadMessages().find(m => m.id === req.params.msgId);
  if (!msg) return res.status(404).json({ error: 'הודעה לא נמצאה' });
  const reports = loadReports();
  if (reports.find(r => r.msgId === msg.id && r.reporterPhone === user.phone))
    return res.status(400).json({ error: 'כבר דיווחת על הודעה זו' });
  reports.push({
    id:           crypto.randomBytes(8).toString('hex'),
    msgId:        msg.id,
    plate:        msg.plate,
    message:      msg.message,
    senderPhone:  msg.senderPhone,
    reporterPhone: user.phone,
    reportedAt:   new Date().toISOString(),
  });
  saveReports(reports);
  res.json({ success: true });
});

// ── Block a sender ────────────────────────────────────────────────
app.post('/api/block/:msgId', (req, res) => {
  const user = getUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const msg = loadMessages().find(m => m.id === req.params.msgId);
  if (!msg) return res.status(404).json({ error: 'הודעה לא נמצאה' });
  const blocks = loadBlocks();
  if (!blocks[user.phone]) blocks[user.phone] = [];
  if (!blocks[user.phone].includes(msg.senderPhone))
    blocks[user.phone].push(msg.senderPhone);
  saveBlocks(blocks);
  // Notify admin via console (shown in dashboard)
  console.log(`[BLOCK] ${user.phone} blocked ${msg.senderPhone} (plate: ${msg.plate})`);
  res.json({ success: true });
});

// ── Reply API ─────────────────────────────────────────────────────
app.get('/api/reply', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });
  const msg = loadMessages().find(m => m.replyToken === token);
  if (!msg) return res.status(404).json({ error: 'הודעה לא נמצאה או שהקישור פג תוקף' });
  const drivers    = loadDrivers();
  const driverPhone = drivers[msg.plate] ? drivers[msg.plate].phone : null;

  // Build thread history
  const threadKey = msg.threadId || msg.id;
  const thread = loadMessages()
    .filter(m => (m.threadId || m.id) === threadKey)
    .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt))
    .map(m => ({
      id:          m.id,
      message:     m.message,
      imageFile:   m.imageFile || null,
      sentAt:      m.sentAt,
      isReply:     !!m.isReply,
      revealPhone: !!m.revealPhone,
      senderPhone: m.revealPhone ? m.senderPhone : null,
    }));

  res.json({
    plate:        msg.plate,
    message:      msg.message,
    imageFile:    msg.imageFile || null,
    sentAt:       msg.sentAt,
    revealPhone:  !!msg.revealPhone,
    senderPhone:  msg.revealPhone ? msg.senderPhone : null,
    driverPhone,
    thread,
  });
});

app.post('/api/reply', (req, res) => {
  const { token }   = req.query;
  const { message } = req.body;
  if (!token || !message) return res.status(400).json({ error: 'חסרים פרטים' });
  const messages = loadMessages();
  const msg = messages.find(m => m.replyToken === token);
  if (!msg) return res.status(404).json({ error: 'הודעה לא נמצאה' });

  const drivers    = loadDrivers();
  const driverPhone = drivers[msg.plate] ? drivers[msg.plate].phone : null;
  const driverName  = drivers[msg.plate] ? drivers[msg.plate].name  : null;

  // Save reply into messages so it appears in original sender's inbox
  const threadId = msg.threadId || msg.id;   // keep thread chain
  const replyEntry = {
    id:             crypto.randomBytes(16).toString('hex'),
    threadId,
    plate:          msg.plate,
    message:        String(message).trim().slice(0, 1000),
    senderPhone:    driverPhone,
    revealPhone:    !!driverPhone,
    recipientPhone: msg.senderPhone,
    isReply:        true,
    replyToken:     crypto.randomBytes(24).toString('hex'),
    sentAt:         new Date().toISOString(),
  };
  messages.push(replyEntry);
  saveMessages(messages);

  // SMS notification to original sender
  if (msg.senderPhone) {
    const smsBody = `תגובה מנהג הרכב (${msg.plate}):\n"${String(message).trim().slice(0, 160)}"`;
    sendSms(msg.senderPhone, smsBody);
  }

  res.json({ success: true, message: 'תגובתך נשלחה בהצלחה!' });
});

app.listen(PORT, () => {
  console.log(`Cartel running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin  (phone-based access)`);
});
