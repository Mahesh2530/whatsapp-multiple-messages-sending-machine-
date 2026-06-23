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
 *   qr          { dataUrl, issuedAt, expiresAt } — new QR code ready
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

let waClient = null;
let isInitializing = false;
let clientGenerationId = 0;
let waStatus = 'IDLE'; // IDLE | INITIALIZING | GENERATING_QR | QR_READY | AUTHENTICATING | CONNECTED | DISCONNECTED | ERROR | RECOVERING
let lastConnectedAt = null;

let latestQRDataUrl = null;
let qrExpiresAt = null;
let qrIssuedAt = null;
let qrWatchdog = null;

let recoveryAttempts = 0;
const MAX_RECOVERY_ATTEMPTS = 3;
let initTimeoutWatcher = null;
let readyTimeoutWatcher = null;

// Audit Logging Helper
function auditLog(generationId, eventName, details = '') {
  const timestamp = new Date().toISOString();
  console.log(`[WA][GEN:${generationId}] ${eventName} ${timestamp}${details ? ' ' + details : ''}`);
}

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

function createClient(generationId) {
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
    try {
      if (generationId !== clientGenerationId) {
        auditLog(generationId, 'QR_RECEIVED', 'Stale generation event ignored');
        return;
      }
      auditLog(generationId, 'QR_RECEIVED');
      
      waStatus = 'QR_READY';
      qrIssuedAt = Date.now();
      qrExpiresAt = qrIssuedAt + 60000; // QR valid for 60 seconds
      
      latestQRDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
      io.to('admin').emit('qr', { dataUrl: latestQRDataUrl, issuedAt: qrIssuedAt, expiresAt: qrExpiresAt, generationId });
      io.to('admin').emit('status', { status: waStatus, generationId });

      if (qrWatchdog) clearTimeout(qrWatchdog);
      qrWatchdog = setTimeout(() => {
        try {
          if (generationId !== clientGenerationId) return;
          auditLog(generationId, 'DISCONNECTED', 'QR code expired after 60s');
          latestQRDataUrl = null;
          qrIssuedAt = null;
          io.to('admin').emit('qr_expired', { generationId });
        } catch (watchdogErr) {
          console.error('[WA] Watchdog tick error:', watchdogErr);
        }
      }, 60000);

    } catch (err) {
      console.error('[WA] QR generation error:', err);
    }
  });

  client.on('loading_screen', (percent, message) => {
    try {
      if (generationId !== clientGenerationId) return;
      auditLog(generationId, 'CLIENT_INITIALIZED', `Percent: ${percent}%, Msg: ${message}`);
      
      if (waStatus !== 'CONNECTED' && waStatus !== 'AUTHENTICATED' && waStatus !== 'AUTHENTICATING') {
        waStatus = 'INITIALIZING';
        io.to('admin').emit('status', { status: waStatus, generationId });
      }
    } catch (err) {
      console.error('[WA] Loading screen error:', err);
    }
  });

  client.on('ready', () => {
    try {
      if (generationId !== clientGenerationId) {
        auditLog(generationId, 'READY', 'Stale generation event ignored');
        return;
      }
      auditLog(generationId, 'READY');
      
      waStatus = 'CONNECTED';
      lastConnectedAt = new Date().toISOString();
      latestQRDataUrl = null;
      qrIssuedAt = null;
      recoveryAttempts = 0; // reset recovery attempts on successful connection
      
      if (qrWatchdog) clearTimeout(qrWatchdog);
      if (initTimeoutWatcher) clearTimeout(initTimeoutWatcher);
      if (readyTimeoutWatcher) clearTimeout(readyTimeoutWatcher);
      
      io.to('admin').emit('status', { status: waStatus, generationId });
    } catch (err) {
      console.error('[WA] Ready event handler error:', err);
    }
  });

  client.on('authenticated', () => {
    try {
      if (generationId !== clientGenerationId) {
        auditLog(generationId, 'AUTHENTICATED', 'Stale generation event ignored');
        return;
      }
      auditLog(generationId, 'AUTHENTICATED');
      waStatus = 'AUTHENTICATING';
      if (initTimeoutWatcher) clearTimeout(initTimeoutWatcher);
      
      if (readyTimeoutWatcher) clearTimeout(readyTimeoutWatcher);
      readyTimeoutWatcher = setTimeout(() => {
        try {
          if (generationId !== clientGenerationId) return;
          if (waStatus === 'AUTHENTICATING') {
            auditLog(generationId, 'ERROR', 'Client authenticated but failed to transition to ready within 60s');
            waStatus = 'ERROR';
            io.to('admin').emit('status', { status: waStatus, generationId });
          }
        } catch (readyErr) {
          console.error('[WA] Ready watchdog error:', readyErr);
        }
      }, 60000);

      io.to('admin').emit('status', { status: waStatus, generationId });
    } catch (err) {
      console.error('[WA] Authenticated event handler error:', err);
    }
  });

  client.on('auth_failure', (msg) => {
    try {
      if (generationId !== clientGenerationId) {
        auditLog(generationId, 'AUTH_FAILURE', 'Stale generation event ignored');
        return;
      }
      auditLog(generationId, 'AUTH_FAILURE', msg);
      
      waStatus = 'ERROR';
      latestQRDataUrl = null;
      qrIssuedAt = null;
      if (initTimeoutWatcher) clearTimeout(initTimeoutWatcher);
      if (readyTimeoutWatcher) clearTimeout(readyTimeoutWatcher);
      io.to('admin').emit('status', { status: waStatus, generationId });
    } catch (err) {
      console.error('[WA] Auth failure event handler error:', err);
    }
  });

  client.on('disconnected', (reason) => {
    try {
      if (generationId !== clientGenerationId) {
        auditLog(generationId, 'DISCONNECTED', 'Stale generation event ignored');
        return;
      }
      auditLog(generationId, 'DISCONNECTED', reason);
      
      waStatus = 'DISCONNECTED';
      latestQRDataUrl = null;
      qrIssuedAt = null;
      if (qrWatchdog) clearTimeout(qrWatchdog);
      if (initTimeoutWatcher) clearTimeout(initTimeoutWatcher);
      if (readyTimeoutWatcher) clearTimeout(readyTimeoutWatcher);
      io.to('admin').emit('status', { status: waStatus, generationId });
    } catch (err) {
      console.error('[WA] Disconnected event handler error:', err);
    }
  });

  return client;
}

async function initClient() {
  auditLog(clientGenerationId, 'CLIENT_INIT_REQUEST');
  if (isInitializing) {
    auditLog(clientGenerationId, 'CLIENT_INIT_REQUEST', 'Ignored: already initializing');
    return;
  }

  isInitializing = true;
  clientGenerationId++;
  const currentGen = clientGenerationId;
  auditLog(currentGen, 'CLIENT_INIT_STARTED');

  // 1. Destroy old client if it exists to preserve single client guarantee
  if (waClient) {
    auditLog(currentGen - 1, 'CLIENT_DESTROY', 'Replacing with new generation');
    try {
      const oldClient = waClient;
      waClient = null;
      await oldClient.destroy();
    } catch (e) {
      console.warn('[WA] Destroy warning:', e.message);
    }
  }

  // 2. Setup Watchdog for timeout auto-recovery (45 seconds)
  if (initTimeoutWatcher) clearTimeout(initTimeoutWatcher);
  initTimeoutWatcher = setTimeout(async () => {
    try {
      if (currentGen !== clientGenerationId) return;

      // Auto-recovery rule: triggers only if no QR is received, not authenticated, and timeout exceeded
      if ((waStatus === 'INITIALIZING' || waStatus === 'IDLE') && !latestQRDataUrl) {
        auditLog(currentGen, 'CLIENT_RESTART', `Generation timeout. Recovery attempt ${recoveryAttempts + 1}/${MAX_RECOVERY_ATTEMPTS}`);
        
        if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
          recoveryAttempts++;
          waStatus = 'RECOVERING';
          io.to('admin').emit('status', { status: waStatus, generationId: currentGen });
          isInitializing = false;
          initClient();
        } else {
          auditLog(currentGen, 'ERROR', 'Max recovery attempts reached. Halting client.');
          waStatus = 'ERROR';
          io.to('admin').emit('status', { status: waStatus, generationId: currentGen });
        }
      }
    } catch (watcherErr) {
      console.error('[WA] initClient watcher error:', watcherErr);
    }
  }, 45000);

  waStatus = 'INITIALIZING';
  io.to('admin').emit('status', { status: waStatus, generationId: currentGen });

  try {
    waClient = createClient(currentGen);
    await waClient.initialize();
  } catch (err) {
    if (currentGen === clientGenerationId) {
      auditLog(currentGen, 'ERROR', `Initialize error: ${err.message}`);
      waStatus = 'ERROR';
      io.to('admin').emit('status', { status: waStatus, generationId: currentGen });
    }
  } finally {
    if (currentGen === clientGenerationId) {
      isInitializing = false;
    }
  }
}

// Start the WA client immediately
initClient();

// ── File Parsing ─────────────────────────────────────────────────

app.post('/api/wa/contacts/discover', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const allowedExts = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ error: 'Only .csv, .xlsx, and .xls files are supported' });
    }

    const result = await processSpreadsheet(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Sending Logic ────────────────────────────────────────────────

async function runSendJob(jobId, contacts, message, delayMs) {
  const job = jobs[jobId];
  job.status = 'sending';

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    if (waStatus !== 'CONNECTED' || !waClient) {
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

app.get('/api/wa/status', (req, res) => {
  try {
    auditLog(clientGenerationId, 'STATUS_REQUEST');
    const status = process.env.MOCK_WA === 'true' ? 'CONNECTED' : waStatus;
    const phone = process.env.MOCK_WA === 'true' ? '919876543210' : (waClient && waClient.info && waClient.info.wid ? waClient.info.wid.user : null);
    const lastConnected = process.env.MOCK_WA === 'true' ? new Date().toISOString() : lastConnectedAt;
    
    res.json({
      status,
      phone,
      lastConnected,
      generationId: clientGenerationId,
      qrAvailable: !!latestQRDataUrl && (!qrExpiresAt || Date.now() < qrExpiresAt)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wa/qr', (req, res) => {
  try {
    // Only return if not expired and available
    const isExpired = qrExpiresAt && Date.now() >= qrExpiresAt;
    if (waStatus !== 'QR_READY' || !latestQRDataUrl || isExpired) {
      return res.status(404).json({ error: 'No QR code available', status: waStatus });
    }
    res.json({ dataUrl: latestQRDataUrl, issuedAt: qrIssuedAt, expiresAt: qrExpiresAt, status: waStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wa/qr/refresh', (req, res) => {
  try {
    auditLog(clientGenerationId, 'QR_REFRESH_REQUEST');
    
    // Rule: If QR code exists and is valid, return it and do not regenerate
    if (waStatus === 'QR_READY' && latestQRDataUrl && qrExpiresAt && Date.now() < qrExpiresAt) {
      auditLog(clientGenerationId, 'QR_REFRESH_REQUEST', 'Skipped: valid QR code exists');
      io.to('admin').emit('qr', { dataUrl: latestQRDataUrl, issuedAt: qrIssuedAt, expiresAt: qrExpiresAt, generationId: clientGenerationId });
      return res.json({ message: 'Valid QR already exists', status: waStatus });
    }

    recoveryAttempts = 0; // reset for manual retry
    isInitializing = false; // reset flag to enforce startup
    initClient();
    res.json({ message: 'Refreshing QR' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wa/disconnect', async (req, res) => {
  try {
    auditLog(clientGenerationId, 'CLIENT_DESTROY', 'Disconnect requested');
    if (waClient) {
      const oldClient = waClient;
      waClient = null;
      try {
        await oldClient.logout();
      } catch (logoutErr) {
        console.warn('[WA] Logout warning:', logoutErr.message);
      }
      try {
        await oldClient.destroy();
      } catch (destroyErr) {
        console.warn('[WA] Destroy warning:', destroyErr.message);
      }
    }
    
    const authPath = path.join(__dirname, '.wwebjs_auth');
    if (fs.existsSync(authPath)) {
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log('[WA] Auth directory cleaned.');
      } catch (rmErr) {
        console.warn('[WA] Could not clean auth directory:', rmErr.message);
      }
    }

    waStatus = 'DISCONNECTED';
    latestQRDataUrl = null;
    qrIssuedAt = null;
    isInitializing = false;
    recoveryAttempts = 0;
    
    if (qrWatchdog) clearTimeout(qrWatchdog);
    if (initTimeoutWatcher) clearTimeout(initTimeoutWatcher);
    if (readyTimeoutWatcher) clearTimeout(readyTimeoutWatcher);
    
    io.to('admin').emit('status', { status: waStatus, generationId: clientGenerationId });
    res.json({ message: 'Disconnected successfully' });
  } catch (err) {
    console.error('[WA] Disconnect error:', err.message);
    waStatus = 'DISCONNECTED';
    waClient = null;
    isInitializing = false;
    recoveryAttempts = 0;
    if (qrWatchdog) clearTimeout(qrWatchdog);
    if (initTimeoutWatcher) clearTimeout(initTimeoutWatcher);
    if (readyTimeoutWatcher) clearTimeout(readyTimeoutWatcher);
    io.to('admin').emit('status', { status: waStatus, generationId: clientGenerationId });
    res.json({ message: 'Disconnected' });
  }
});

// ── AI Composer Routes (Local fallbacks are P0) ──────────────────

app.post('/api/wa/ai/correct', async (req, res) => {
  try {
    const result = await correctMessage(req.body.message || '');
    res.json({ message: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/wa/ai/tone', async (req, res) => {
  try {
    const result = await changeTone(req.body.message || '', req.body.tone || 'Formal');
    res.json({ message: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/wa/ai/improve', async (req, res) => {
  try {
    const result = await improveMessage(req.body.message || '');
    res.json({ message: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/wa/ai/review', async (req, res) => {
  try {
    const review = await reviewCampaign(req.body.message || '');
    res.json(review);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Message Jobs REST Endpoints ──────────────────────────────────

app.post('/api/wa/send', (req, res) => {
  try {
    if (waStatus !== 'CONNECTED') {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wa/job/:id', (req, res) => {
  try {
    const job = jobs[req.params.id];
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wa/jobs', (req, res) => {
  try {
    const jobList = Object.values(jobs).sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    res.json({ jobs: jobList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Socket.io Connection Middleware ──────────────────────────────

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

  // Immediately send current state and generation to newly connected client
  socket.emit('status', { status: waStatus, generationId: clientGenerationId });
  
  if (latestQRDataUrl) {
    const isExpired = qrExpiresAt && Date.now() >= qrExpiresAt;
    if (!isExpired) {
      socket.emit('qr', { dataUrl: latestQRDataUrl, issuedAt: qrIssuedAt, expiresAt: qrExpiresAt, generationId: clientGenerationId });
    }
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
