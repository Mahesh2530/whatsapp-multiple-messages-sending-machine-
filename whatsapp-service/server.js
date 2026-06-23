/**
 * WhatsApp Web Automation Service
 * ────────────────────────────────
 * Port: 3001
 * Uses whatsapp-web.js with LocalAuth (session persists across restarts)
 *
 * REST endpoints:
 *   GET  /api/wa/status       — session status
 *   GET  /api/wa/qr           — QR code as base64 PNG
 *   POST /api/wa/send         — start a broadcast job
 *   GET  /api/wa/job/:id      — job progress
 *   POST /api/wa/disconnect   — logout / clear session
 *   POST /api/wa/upload       — parse Excel/CSV → return contacts
 *
 * Socket.io events (server → client):
 *   qr          { dataUrl }   — new QR code ready
 *   status      { status }    — status changed
 *   progress    { jobId, sent, total, failed, current } — send progress
 *   done        { jobId, sent, total, failed }          — job finished
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const { processSpreadsheet } = require('./smartDiscovery');
const { correctMessage, changeTone, improveMessage, reviewCampaign } = require('./smartComposer');

// ── Process-wide Error Handlers to prevent Windows crash ─────────
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// ── App Setup ────────────────────────────────────────────────────

const API_KEY = process.env.WA_API_KEY;
if (!API_KEY) {
  throw new Error("Missing WA_API_KEY");
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
  },
});

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
}));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path} - Auth: ${req.headers.authorization}`);
  next();
});


const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
app.use('/api/wa', authMiddleware);

// ── State ────────────────────────────────────────────────────────

let waStatus = 'disconnected'; // disconnected | initializing | qr_ready | connected
let waClient = null;
let lastConnectedAt = null;

let latestQRDataUrl = null;
let qrExpiresAt = null;
let qrWatchdog = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

// Persistent job store
const JOBS_FILE = path.join(__dirname, 'jobs.json');
let jobs = {};
let jobCounter = 1;

try {
  if (fs.existsSync(JOBS_FILE)) {
    jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    const now = Date.now();
    for (const id in jobs) {
      const createdAt = new Date(jobs[id].createdAt).getTime();
      if (now - createdAt > 24 * 60 * 60 * 1000 && ['completed', 'failed'].includes(jobs[id].status)) {
        delete jobs[id];
      } else {
        jobCounter = Math.max(jobCounter, parseInt(id) + 1);
      }
    }
  }
} catch (e) {
  console.warn('Could not load jobs.json:', e.message);
}

const saveJobs = () => {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs));
  } catch (e) {
    console.error('Failed to save jobs:', e.message);
  }
};

// ── WhatsApp Client Factory ──────────────────────────────────────

function createClient() {
  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: path.join(__dirname, '.wwebjs_auth'),
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--no-first-run',
        '--mute-audio',
      ],
      timeout: 120000,
    },
  });

  client.on('qr', async (qr) => {
    console.log('[WA] QR received');
    console.log('[DEBUG] QR generated');
    waStatus = 'qr_ready';
    const issuedAt = Date.now();
    qrExpiresAt = issuedAt + 60000; // QR valid for 60 seconds
    try {
      latestQRDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
      io.to('admin').emit('qr', { dataUrl: latestQRDataUrl, issuedAt, expiresAt: qrExpiresAt });
      console.log('[DEBUG] QR emitted');
      io.to('admin').emit('status', { status: waStatus });
    } catch (err) {
      console.error('[WA] QR generation error:', err);
    }

    if (qrWatchdog) clearTimeout(qrWatchdog);
    qrWatchdog = setTimeout(() => {
      console.log('[WA] QR expired (60s). Emitting qr_expired (no watchdog restart).');
      console.log('[DEBUG] QR expired');
      // No client destruction or auto-restart
      io.to('admin').emit('qr_expired');
    }, 60000);
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`[WA] Loading: ${percent}% — ${message}`);
    waStatus = 'initializing';
    io.to('admin').emit('status', { status: waStatus });
  });

  client.on('ready', () => {
    console.log('[WA] Client ready!');
    waStatus = 'connected';
    lastConnectedAt = new Date().toISOString();
    latestQRDataUrl = null;
    reconnectAttempts = 0;
    if (qrWatchdog) clearTimeout(qrWatchdog);
    io.to('admin').emit('status', { status: waStatus });
  });

  client.on('authenticated', () => {
    console.log('[WA] Authenticated');
  });

  client.on('auth_failure', (msg) => {
    console.error('[WA] Auth failure:', msg);
    waStatus = 'disconnected';
    io.to('admin').emit('status', { status: waStatus });
  });

  client.on('disconnected', (reason) => {
    console.log('[WA] Disconnected:', reason);
    waStatus = 'disconnected';
    latestQRDataUrl = null;
    if (qrWatchdog) clearTimeout(qrWatchdog);
    io.to('admin').emit('status', { status: waStatus });
    // Automatic reinitialization disabled (no auto recovery)
    console.log('[WA] Disconnected. Automatic reconnection disabled.');
  });

  return client;
}

let currentInitPromise = Promise.resolve();
let resolveInit = null;

async function initClient() {
  console.log('[WA] initClient called');
  
  // 1. If we have an existing client, destroy it to abort any ongoing initialization/navigation
  if (waClient) {
    try {
      console.log('[WA] Destroying current client instance to trigger abort...');
      const oldClient = waClient;
      waClient = null;
      await oldClient.destroy();
    } catch (e) {
      console.warn('[WA] Destroy warning:', e.message);
    }
  }

  // 2. Wait for any previous init run's cleanup/finally to finish
  await currentInitPromise;

  // 3. Set up the lock for this run
  currentInitPromise = new Promise((resolve) => {
    resolveInit = resolve;
  });

  waStatus = 'initializing';
  io.to('admin').emit('status', { status: waStatus });

  console.log('[WA] Initializing new WhatsApp client...');
  waClient = createClient();
  try {
    await waClient.initialize();
  } catch (err) {
    console.error('[WA] Initialize error:', err.message);
    waStatus = 'disconnected';
    io.to('admin').emit('status', { status: waStatus });
  } finally {
    // 4. Release lock
    if (resolveInit) {
      resolveInit();
      resolveInit = null;
    }
  }
}

// Start the WA client immediately
initClient();

// ── File Parsing ─────────────────────────────────────────────────

app.post('/api/wa/contacts/discover', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const allowedExts = ['.csv', '.xlsx', '.xls'];
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!allowedExts.includes(ext)) {
    return res.status(400).json({ error: 'Only .csv, .xlsx, and .xls files are supported' });
  }

  try {
    const result = await processSpreadsheet(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Sending Logic ────────────────────────────────────────────────

/**
 * Sends messages to a list of contacts sequentially with a delay.
 * Updates the job store and emits Socket.io progress events.
 */
async function runSendJob(jobId, contacts, message, delayMs) {
  const job = jobs[jobId];
  job.status = 'sending';

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    if (waStatus !== 'connected' || !waClient) {
      job.status = 'failed';
      job.error = 'WhatsApp disconnected during send';
      io.to('admin').emit('done', { jobId, ...job });
      saveJobs();
      return;
    }

    try {
      let personalizedMsg = message;
      if (contact.name) {
        const parts = contact.name.trim().split(/\s+/);
        personalizedMsg = personalizedMsg.replace(/\{\{name\}\}/gi, contact.name);
        personalizedMsg = personalizedMsg.replace(/\{\{first_name\}\}/gi, parts[0]);
        personalizedMsg = personalizedMsg.replace(/\{\{last_name\}\}/gi, parts.length > 1 ? parts[parts.length - 1] : '');
      } else {
        personalizedMsg = personalizedMsg.replace(/\{\{name\}\}/gi, '');
        personalizedMsg = personalizedMsg.replace(/\{\{first_name\}\}/gi, '');
        personalizedMsg = personalizedMsg.replace(/\{\{last_name\}\}/gi, '');
      }

      const chatId = `${contact.normalizedPhone}@c.us`;
      const sendPromise = waClient.sendMessage(chatId, personalizedMsg);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Send timeout')), 15000));
      await Promise.race([sendPromise, timeoutPromise]);
      job.sent++;
      console.log(`[JOB ${jobId}] Sent to ${contact.name} (${contact.phone})`);
    } catch (err) {
      job.failed++;
      console.error(`[JOB ${jobId}] Failed to send to ${contact.phone}:`, err.message);
    }

    job.current = i + 1;
    saveJobs();

    io.to('admin').emit('progress', {
      jobId,
      sent: job.sent,
      total: job.total,
      failed: job.failed,
      current: job.current,
      currentContact: contact.name || contact.phone,
    });

    // Delay between messages (except after the last one)
    if (i < contacts.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  io.to('admin').emit('done', { jobId, sent: job.sent, total: job.total, failed: job.failed });
  saveJobs();
  console.log(`[JOB ${jobId}] Completed: ${job.sent}/${job.total} sent, ${job.failed} failed`);
}

// ── REST Routes ──────────────────────────────────────────────────

/**
 * GET /api/wa/status
 * Returns current WhatsApp session status.
 */
app.get('/api/wa/status', (req, res) => {
  const status = process.env.MOCK_WA === 'true' ? 'connected' : waStatus;
  const phone = process.env.MOCK_WA === 'true' ? '919876543210' : (waClient && waClient.info && waClient.info.wid ? waClient.info.wid.user : null);
  const lastConnected = process.env.MOCK_WA === 'true' ? new Date().toISOString() : lastConnectedAt;
  res.json({
    status,
    phone,
    lastConnected
  });
});

/**
 * GET /api/wa/qr
 * Returns the current QR code as a base64 data URL.
 */
app.get('/api/wa/qr', (req, res) => {
  if (waStatus !== 'qr_ready' || !latestQRDataUrl) {
    return res.status(404).json({ error: 'No QR code available', status: waStatus });
  }
  res.json({ dataUrl: latestQRDataUrl, issuedAt: qrExpiresAt - 20000, expiresAt: qrExpiresAt, status: waStatus });
});

app.post('/api/wa/qr/refresh', (req, res) => {
  console.log('[WA] Manual QR refresh requested');
  console.log('[DEBUG] QR refreshed');
  initClient();
  res.json({ message: 'Refreshing QR' });
});

/**
 * POST /api/wa/disconnect
 * Logs out the current WhatsApp session and clears auth data.
 */
app.post('/api/wa/disconnect', async (req, res) => {
  try {
    if (waClient) {
      console.log('[WA] Logging out client...');
      try {
        await waClient.logout();
      } catch (logoutErr) {
        console.warn('[WA] Logout warning (likely file lock on Windows):', logoutErr.message);
      }
      
      console.log('[WA] Destroying client...');
      try {
        await waClient.destroy();
      } catch (destroyErr) {
        console.warn('[WA] Destroy warning:', destroyErr.message);
      }
      waClient = null;
    }
    
    // Clear local auth folder manually if it still exists to ensure clean slate on Windows
    const authPath = path.join(__dirname, '.wwebjs_auth');
    if (fs.existsSync(authPath)) {
      try {
        console.log('[WA] Cleaning up auth directory manually...');
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log('[WA] Auth directory cleaned.');
      } catch (rmErr) {
        console.warn('[WA] Could not clean auth directory:', rmErr.message);
      }
    }

    waStatus = 'disconnected';
    latestQRDataUrl = null;
    if (qrWatchdog) clearTimeout(qrWatchdog);
    io.to('admin').emit('status', { status: waStatus });
    res.json({ message: 'Disconnected successfully' });
    // Reinitialize disabled to prevent auto-regeneration
    // setTimeout(() => initClient(), 2000);
  } catch (err) {
    console.error('[WA] Disconnect error:', err.message);
    waStatus = 'disconnected';
    waClient = null;
    if (qrWatchdog) clearTimeout(qrWatchdog);
    io.to('admin').emit('status', { status: waStatus });
    res.json({ message: 'Disconnected' });
    // Reinitialize disabled to prevent auto-regeneration
    // setTimeout(() => initClient(), 2000);
  }
});


/**
 * POST /api/wa/ai/correct
 */
app.post('/api/wa/ai/correct', async (req, res) => {
  try {
    const text = await correctMessage(req.body.message);
    res.json({ message: text });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/ai/tone', async (req, res) => {
  try {
    const text = await changeTone(req.body.message, req.body.tone);
    res.json({ message: text });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/ai/improve', async (req, res) => {
  try {
    const text = await improveMessage(req.body.message);
    res.json({ message: text });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/ai/review', async (req, res) => {
  try {
    const review = await reviewCampaign(req.body.message);
    res.json(review);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/wa/send
 * Body: { contacts: [{name, phone, normalizedPhone}], message, delay? }
 * Queues and starts a broadcast job.
 */
app.post('/api/wa/send', (req, res) => {
  if (waStatus !== 'connected') {
    return res.status(400).json({
      error: 'WhatsApp is not connected. Please scan the QR code first.',
    });
  }

  const { contacts, message, delay } = req.body;

  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'No contacts provided' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }
  if (message.length > 1024) {
    return res.status(400).json({ error: 'Message is too long (max 1024 chars)' });
  }

  const validContacts = contacts.filter((c) => c.isValid);
  if (validContacts.length === 0) {
    return res.status(400).json({ error: 'No valid contacts to send to' });
  }

  const delayMs = Math.max(1000, Math.min(10000, parseInt(delay) || 3000));

  const jobId = String(jobCounter++);
  jobs[jobId] = {
    id: jobId,
    status: 'pending',
    total: validContacts.length,
    sent: 0,
    failed: 0,
    current: 0,
    message: message.trim(),
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  // Start sending in background
  runSendJob(jobId, validContacts, message.trim(), delayMs).catch((err) => {
    console.error(`[JOB ${jobId}] Unexpected error:`, err);
    jobs[jobId].status = 'failed';
    jobs[jobId].error = err.message;
    saveJobs();
  });

  saveJobs();
  res.json({ jobId, message: 'Broadcast started', total: validContacts.length });
});

/**
 * GET /api/wa/job/:id
 * Returns current progress of a send job.
 */
app.get('/api/wa/job/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

/**
 * GET /api/wa/jobs
 * Returns all jobs sorted newest-first.
 */
app.get('/api/wa/jobs', (req, res) => {
  const jobList = Object.values(jobs).sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json({ jobs: jobList });
});

// ── Socket.io ────────────────────────────────────────────────────

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token !== API_KEY) {
    return next(new Error('Authentication error'));
  }
  socket.data.userId = 'admin';
  next();
});

io.on('connection', (socket) => {
  console.log('[Socket.io] Client connected:', socket.id);
  socket.join('admin');

  // Immediately send current state to newly connected client
  socket.emit('status', { status: waStatus });
  if (waStatus === 'qr_ready' && latestQRDataUrl) {
    socket.emit('qr', { dataUrl: latestQRDataUrl, issuedAt: qrExpiresAt - 20000, expiresAt: qrExpiresAt });
  }

  socket.on('disconnect', () => {
    console.log('[Socket.io] Client disconnected:', socket.id);
  });
});

// ── Start Server ─────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🟢 WhatsApp Service running on http://localhost:${PORT}`);
  console.log('   Endpoints:');
  console.log('   GET  /api/wa/status');
  console.log('   GET  /api/wa/qr');
  console.log('   POST /api/wa/upload');
  console.log('   POST /api/wa/send');
  console.log('   POST /api/wa/disconnect');
  console.log('   GET  /api/wa/job/:id\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error('   Run this to free it: netstat -ano | findstr :3001');
    console.error('   Then: taskkill /PID <PID> /F\n');
    process.exit(1);
  } else {
    throw err;
  }
});
