// Tiny backend: OpenAI proxy with Firebase Auth verification
// Env: OPENAI_API_KEY (required), FIREBASE_SERVICE_ACCOUNT (JSON, recommended), CORS_ORIGIN (optional)

const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
// Use global fetch (available in Node 18+)

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
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Debug endpoint to confirm env visibility (safe: no secrets exposed)
app.get('/debug/env', (req, res) => {
  res.json({
    OPENAI_API_KEY_present: !!OPENAI_API_KEY,
    OPENAI_API_KEY_length: OPENAI_API_KEY ? OPENAI_API_KEY.length : 0,
    ELEVENLABS_API_KEY_present: !!ELEVENLABS_API_KEY,
    ELEVENLABS_API_KEY_length: ELEVENLABS_API_KEY ? ELEVENLABS_API_KEY.length : 0,
    FIREBASE_CONFIG_present: !!process.env.FIREBASE_CONFIG,
    ADMIN_READY: adminReady,
  });
});

// Chat completions proxy
app.post('/api/chat', authenticate, async (req, res) => {
  try {
    // Log presence (not value) of the key for debugging
    console.log('[/api/chat] OPENAI_API_KEY present:', !!OPENAI_API_KEY, 'len:', OPENAI_API_KEY ? OPENAI_API_KEY.length : 0);
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

// ElevenLabs TTS proxy
app.post('/api/tts', authenticate, async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) return res.status(500).json({ error: 'ELEVENLABS_API_KEY missing' });
    const { text, voiceId, settings } = req.body || {};
    if (!text || !voiceId) return res.status(400).json({ error: 'text and voiceId required' });
    console.log('[/api/tts] voiceId:', voiceId, 'text.len:', text.length);
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: settings?.stability ?? 0.5,
          similarity_boost: settings?.similarity_boost ?? 0.8,
          style: settings?.style ?? 0.0,
          use_speaker_boost: settings?.use_speaker_boost ?? true
        }
      })
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error('[/api/tts] ElevenLabs error', resp.status, txt);
      return res.status(resp.status).json({ error: 'ElevenLabs error', details: txt });
    }
    // Send as Buffer (avoid piping web stream in Node)
    const audioBuffer = Buffer.from(await resp.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (e) {
    res.status(500).json({ error: 'TTS proxy failed', details: e.message });
  }
});

// ElevenLabs list voices (no auth required) - with fallback for permission issues
app.get('/api/voices', async (req, res) => {
  console.log('[/api/voices] Request received');
  try {
    if (!ELEVENLABS_API_KEY) {
      console.log('[/api/voices] Missing ElevenLabs API key - returning fallback');
      // Return fallback with Young Jerome voice
      return res.json({
        voices: [{
          voice_id: '6OzrBCQf8cjERkYgzSg8',
          name: 'Young Jerome',
          category: 'premade',
          description: 'Young adult male voice'
        }]
      });
    }
    console.log('[/api/voices] Fetching voices from ElevenLabs');
    const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.log('[/api/voices] ElevenLabs error:', resp.status, text);
      
      // If permissions error, return fallback with Young Jerome
      if (resp.status === 401 || text.includes('missing_permissions')) {
        console.log('[/api/voices] Permissions issue - returning Young Jerome fallback');
        return res.json({
          voices: [{
            voice_id: '6OzrBCQf8cjERkYgzSg8',
            name: 'Young Jerome',
            category: 'premade',
            description: 'Young adult male voice'
          }]
        });
      }
      
      return res.status(resp.status).json({ error: 'ElevenLabs error', details: text });
    }
    const data = await resp.json();
    console.log('[/api/voices] Successfully fetched', data.voices?.length || 0, 'voices');
    res.json(data);
  } catch (e) {
    console.error('[/api/voices] Error:', e);
    // Return fallback on any error
    console.log('[/api/voices] Returning Young Jerome fallback due to error');
    res.json({
      voices: [{
        voice_id: '6OzrBCQf8cjERkYgzSg8',
        name: 'Young Jerome',
        category: 'premade',
        description: 'Young adult male voice'
      }]
    });
  }
});

// Audio transcription proxy (streams multipart directly to OpenAI)
app.post('/api/transcribe', authenticate, async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    console.log('[/api/transcribe] content-type:', contentType);
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': contentType
      },
      body: req,
      duplex: 'half'
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error('[/api/transcribe] OpenAI error', resp.status, text);
      return res.status(resp.status).json({ error: 'OpenAI error', details: text });
    }
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    console.error('[/api/transcribe] Failed:', e);
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


