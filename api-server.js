// Tiny backend: OpenAI proxy with Firebase Auth verification
// Env: OPENAI_API_KEY (required), FIREBASE_SERVICE_ACCOUNT (JSON, recommended), CORS_ORIGIN (optional)

const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));

const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));

// Firebase Admin (optional but recommended)
let adminReady = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(svc) });
    adminReady = true;
  }
} catch (e) {
  console.warn('FIREBASE_SERVICE_ACCOUNT parse error:', e.message);
}

// Auth middleware
async function authenticate(req, res, next) {
  if (!adminReady) {
    return res.status(500).json({ error: 'Auth not configured on server' });
  }
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token', details: e.message });
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required');
}
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Chat completions proxy
app.post('/api/chat', authenticate, async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
    const params = req.body || {};
    // Forward to OpenAI (JSON API)
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: params.model || 'gpt-4o',
        messages: params.messages || [],
        response_format: params.response_format,
        max_tokens: params.max_tokens,
        temperature: params.temperature
      })
    });
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: 'OpenAI error', details: text });
    }
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Chat proxy failed', details: e.message });
  }
});

// Audio transcription proxy (streams multipart directly to OpenAI)
app.post('/api/transcribe', authenticate, async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': contentType
      },
      body: req
    });
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: 'OpenAI error', details: text });
    }
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Transcription proxy failed', details: e.message });
  }
});

// Dynamic env.js served by server (no secrets exposed)
app.get('/env.js', (req, res) => {
  res.type('application/javascript; charset=utf-8');
  const firebaseConfig = process.env.FIREBASE_CONFIG || '';
  let cfgLine = '';
  if (firebaseConfig) {
    cfgLine = `window.FIREBASE_CONFIG=${firebaseConfig};`;
  }
  // API base resolves to this same origin
  res.send(`window.API_BASE_URL=window.location.origin;${cfgLine}`);
});

// Serve static files
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`AI proxy listening on :${port}`);
});


