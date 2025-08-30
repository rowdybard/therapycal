// Minimal Express API server with PostgreSQL and Firebase Auth verification
// Env required: DATABASE_URL, FIREBASE_SERVICE_ACCOUNT (JSON), PORT (optional), CORS_ORIGIN (optional)

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const admin = require('firebase-admin');

// Initialize Firebase Admin from env JSON
let serviceAccount = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
} catch (e) {
  console.error('Invalid FIREBASE_SERVICE_ACCOUNT JSON:', e.message);
}

if (!serviceAccount) {
  console.warn('FIREBASE_SERVICE_ACCOUNT not set. API will not verify tokens properly.');
}

if (!admin.apps.length && serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const app = express();

// CORS
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

// Database
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  // Create tables if not exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      user_uid TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      color TEXT,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS providers (
      id SERIAL PRIMARY KEY,
      user_uid TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      title TEXT,
      color TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      user_uid TEXT NOT NULL,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
      start_time TIMESTAMP WITH TIME ZONE NOT NULL,
      end_time TIMESTAMP WITH TIME ZONE NOT NULL,
      duration_minutes INTEGER,
      priority TEXT,
      status TEXT,
      notes TEXT,
      repeats TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

// Auth middleware
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    if (!admin.apps.length) return res.status(500).json({ error: 'Auth not configured' });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token', details: e.message });
  }
}

// Helpers
const mapClientRow = (r) => ({
  id: String(r.id),
  name: r.name,
  email: r.email,
  phone: r.phone,
  color: r.color,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapProviderRow = (r) => ({
  id: String(r.id),
  name: r.name,
  email: r.email,
  title: r.title,
  color: r.color,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapAppointmentRow = (r) => ({
  id: String(r.id),
  clientId: String(r.client_id),
  providerId: r.provider_id == null ? null : String(r.provider_id),
  start: r.start_time,
  end: r.end_time,
  duration: r.duration_minutes,
  priority: r.priority,
  status: r.status,
  notes: r.notes,
  repeats: r.repeats,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// Routes
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use('/api', authenticate);

// Clients
app.get('/api/clients', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM clients WHERE user_uid = $1 ORDER BY name ASC',
    [req.user.uid]
  );
  res.json(rows.map(mapClientRow));
});

app.post('/api/clients', async (req, res) => {
  const { name, email, phone, color, notes } = req.body || {};
  if (!name || String(name).trim() === '') return res.status(400).json({ error: 'name required' });
  const { rows } = await pool.query(
    `INSERT INTO clients (user_uid, name, email, phone, color, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [req.user.uid, name.trim(), email || null, phone || null, color || null, notes || null]
  );
  res.status(201).json(mapClientRow(rows[0]));
});

app.put('/api/clients/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, email, phone, color, notes } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE clients SET name = COALESCE($3,name), email = $4, phone = $5, color = $6, notes = $7, updated_at = NOW()
     WHERE id = $1 AND user_uid = $2 RETURNING *`,
    [id, req.user.uid, name, email || null, phone || null, color || null, notes || null]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(mapClientRow(rows[0]));
});

app.delete('/api/clients/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rowCount } = await pool.query(
    'DELETE FROM clients WHERE id = $1 AND user_uid = $2',
    [id, req.user.uid]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

// Providers
app.get('/api/providers', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM providers WHERE user_uid = $1 ORDER BY name ASC',
    [req.user.uid]
  );
  res.json(rows.map(mapProviderRow));
});

app.post('/api/providers', async (req, res) => {
  const { name, email, title, color } = req.body || {};
  if (!name || String(name).trim() === '') return res.status(400).json({ error: 'name required' });
  const { rows } = await pool.query(
    `INSERT INTO providers (user_uid, name, email, title, color)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [req.user.uid, name.trim(), email || null, title || null, color || null]
  );
  res.status(201).json(mapProviderRow(rows[0]));
});

app.put('/api/providers/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, email, title, color } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE providers SET name = COALESCE($3,name), email = $4, title = $5, color = $6, updated_at = NOW()
     WHERE id = $1 AND user_uid = $2 RETURNING *`,
    [id, req.user.uid, name, email || null, title || null, color || null]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(mapProviderRow(rows[0]));
});

app.delete('/api/providers/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rowCount } = await pool.query(
    'DELETE FROM providers WHERE id = $1 AND user_uid = $2',
    [id, req.user.uid]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

// Appointments
app.get('/api/appointments', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM appointments WHERE user_uid = $1 ORDER BY start_time ASC',
    [req.user.uid]
  );
  res.json(rows.map(mapAppointmentRow));
});

app.post('/api/appointments', async (req, res) => {
  const { clientId, providerId, start, end, duration, priority, status, notes, repeats } = req.body || {};
  if (!clientId || !start || !end) return res.status(400).json({ error: 'clientId, start, end required' });
  const { rows } = await pool.query(
    `INSERT INTO appointments (user_uid, client_id, provider_id, start_time, end_time, duration_minutes, priority, status, notes, repeats)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      req.user.uid,
      parseInt(clientId, 10),
      providerId ? parseInt(providerId, 10) : null,
      new Date(start),
      new Date(end),
      duration || null,
      priority || null,
      status || null,
      notes || null,
      repeats || null,
    ]
  );
  res.status(201).json(mapAppointmentRow(rows[0]));
});

app.put('/api/appointments/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { clientId, providerId, start, end, duration, priority, status, notes, repeats } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE appointments SET
      client_id = COALESCE($3, client_id),
      provider_id = $4,
      start_time = COALESCE($5, start_time),
      end_time = COALESCE($6, end_time),
      duration_minutes = $7,
      priority = $8,
      status = $9,
      notes = $10,
      repeats = $11,
      updated_at = NOW()
     WHERE id = $1 AND user_uid = $2
     RETURNING *`,
    [
      id,
      req.user.uid,
      clientId ? parseInt(clientId, 10) : null,
      providerId ? parseInt(providerId, 10) : null,
      start ? new Date(start) : null,
      end ? new Date(end) : null,
      duration || null,
      priority || null,
      status || null,
      notes || null,
      repeats || null,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(mapAppointmentRow(rows[0]));
});

app.delete('/api/appointments/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rowCount } = await pool.query(
    'DELETE FROM appointments WHERE id = $1 AND user_uid = $2',
    [id, req.user.uid]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

// Start
const port = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(port, () => console.log(`API listening on :${port}`)))
  .catch((e) => {
    console.error('Failed to init DB:', e);
    process.exit(1);
  });


