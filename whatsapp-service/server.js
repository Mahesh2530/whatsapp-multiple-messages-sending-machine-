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

// ── App Setup ────────────────────────────────────────────────────

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

const upload = multer({ storage: multer.memoryStorage() });

// ── State ────────────────────────────────────────────────────────

let waStatus = 'disconnected'; // disconnected | initializing | qr_ready | connected
let latestQRDataUrl = null;
let waClient = null;

// In-memory job store
const jobs = {};
let jobCounter = 1;

// ── WhatsApp Client Factory ──────────────────────────────────────

function createClient() {
  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: path.join(__dirname, '.wwebjs_auth'),
    }),
    puppeteer: {
      headless: true,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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
    waStatus = 'qr_ready';
    try {
      latestQRDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
      io.emit('qr', { dataUrl: latestQRDataUrl });
      io.emit('status', { status: waStatus });
    } catch (err) {
      console.error('[WA] QR generation error:', err);
    }
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`[WA] Loading: ${percent}% — ${message}`);
    waStatus = 'initializing';
    io.emit('status', { status: waStatus });
  });

  client.on('ready', () => {
    console.log('[WA] Client ready!');
    waStatus = 'connected';
    latestQRDataUrl = null;
    io.emit('status', { status: waStatus });
  });

  client.on('authenticated', () => {
    console.log('[WA] Authenticated');
  });

  client.on('auth_failure', (msg) => {
    console.error('[WA] Auth failure:', msg);
    waStatus = 'disconnected';
    io.emit('status', { status: waStatus });
  });

  client.on('disconnected', (reason) => {
    console.log('[WA] Disconnected:', reason);
    waStatus = 'disconnected';
    latestQRDataUrl = null;
    io.emit('status', { status: waStatus });
    // Only reinitialize if it wasn't an explicit logout from our own /disconnect endpoint
    if (reason !== 'LOGOUT') {
      setTimeout(() => {
        console.log('[WA] Reinitializing...');
        initClient();
      }, 5000);
    }
  });

  return client;
}

let isInitializing = false;

async function initClient() {
  if (isInitializing) {
    console.log('[WA] Already initializing, skipping.');
    return;
  }
  isInitializing = true;
  waStatus = 'initializing';
  io.emit('status', { status: waStatus });

  // Destroy existing client safely
  if (waClient) {
    try {
      await waClient.destroy();
    } catch (e) {
      console.warn('[WA] Destroy warning:', e.message);
    }
    waClient = null;
  }

  waClient = createClient();
  try {
    await waClient.initialize();
  } catch (err) {
    console.error('[WA] Initialize error:', err.message);
    waStatus = 'disconnected';
    io.emit('status', { status: waStatus });
  } finally {
    isInitializing = false;
  }
}

// Start the WA client immediately
initClient();

// ── File Parsing ─────────────────────────────────────────────────

/**
 * Parse an uploaded buffer (Excel or CSV) and return a list of contacts.
 * Auto-detects the column that holds the phone number.
 */
function parseContactsBuffer(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  let workbook;
  if (ext === '.csv') {
    workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  } else {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) {
    return { contacts: [], valid: 0, invalid: 0 };
  }

  // Find phone column
  const phoneKeys = ['phone', 'mobile', 'number', 'phonenumber', 'phone_number', 'tel', 'whatsapp', 'contact'];
  const nameKeys = ['name', 'fullname', 'full_name', 'contact_name', 'customer', 'person'];

  const sampleRow = rows[0];
  const headers = Object.keys(sampleRow).map((k) => k.toLowerCase().trim());

  const phoneCol = Object.keys(sampleRow).find((k) =>
    phoneKeys.includes(k.toLowerCase().trim())
  );
  const nameCol = Object.keys(sampleRow).find((k) =>
    nameKeys.includes(k.toLowerCase().trim())
  );

  if (!phoneCol) {
    throw new Error(`No phone column found. Headers detected: ${Object.keys(sampleRow).join(', ')}`);
  }

  const contacts = [];
  let validCount = 0;
  let invalidCount = 0;

  rows.forEach((row, i) => {
    const rawPhone = String(row[phoneCol] || '').trim();
    const name = nameCol ? String(row[nameCol] || '').trim() : '';

    // Normalize phone number
    const cleaned = rawPhone.replace(/[\s\-().+]/g, '');
    const isValid = /^\d{7,15}$/.test(cleaned);

    // Format phone for WhatsApp (needs country code, no +)
    let phone = cleaned;
    if (isValid) {
      // If it starts with 0, assume Indian number and replace with 91
      if (phone.startsWith('0')) {
        phone = '91' + phone.slice(1);
      }
      // If it's 10 digits (Indian), prepend 91
      if (phone.length === 10) {
        phone = '91' + phone;
      }
    }

    const contact = {
      row: i + 2,
      name: name || `Contact ${i + 1}`,
      phone: rawPhone,
      normalizedPhone: phone,
      isValid,
      error: isValid ? null : 'Invalid phone number',
    };

    contacts.push(contact);
    if (isValid) validCount++;
    else invalidCount++;
  });

  return { contacts, valid: validCount, invalid: invalidCount, total: rows.length };
}

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
      io.emit('done', { jobId, ...job });
      return;
    }

    try {
      const chatId = `${contact.normalizedPhone}@c.us`;
      await waClient.sendMessage(chatId, message);
      job.sent++;
      console.log(`[JOB ${jobId}] Sent to ${contact.name} (${contact.phone})`);
    } catch (err) {
      job.failed++;
      console.error(`[JOB ${jobId}] Failed to send to ${contact.phone}:`, err.message);
    }

    job.current = i + 1;

    io.emit('progress', {
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
  io.emit('done', { jobId, sent: job.sent, total: job.total, failed: job.failed });
  console.log(`[JOB ${jobId}] Completed: ${job.sent}/${job.total} sent, ${job.failed} failed`);
}

// ── REST Routes ──────────────────────────────────────────────────

/**
 * GET /api/wa/status
 * Returns current WhatsApp session status.
 */
app.get('/api/wa/status', (req, res) => {
  res.json({ status: waStatus });
});

/**
 * GET /api/wa/qr
 * Returns the current QR code as a base64 data URL.
 */
app.get('/api/wa/qr', (req, res) => {
  if (waStatus !== 'qr_ready' || !latestQRDataUrl) {
    return res.status(404).json({ error: 'No QR code available', status: waStatus });
  }
  res.json({ dataUrl: latestQRDataUrl, status: waStatus });
});

/**
 * POST /api/wa/disconnect
 * Logs out the current WhatsApp session and clears auth data.
 */
app.post('/api/wa/disconnect', async (req, res) => {
  try {
    if (waClient) {
      await waClient.logout();
      await waClient.destroy();
      waClient = null;
    }
    waStatus = 'disconnected';
    latestQRDataUrl = null;
    io.emit('status', { status: waStatus });
    res.json({ message: 'Disconnected successfully' });
    // Reinitialize so a new QR appears
    setTimeout(() => initClient(), 2000);
  } catch (err) {
    console.error('[WA] Disconnect error:', err.message);
    waStatus = 'disconnected';
    waClient = null;
    io.emit('status', { status: waStatus });
    res.json({ message: 'Disconnected' });
    setTimeout(() => initClient(), 2000);
  }
});


/**
 * POST /api/wa/upload
 * Accepts a multipart file (Excel or CSV) and returns parsed contacts.
 */
app.post('/api/wa/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const allowedExts = ['.csv', '.xlsx', '.xls'];
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!allowedExts.includes(ext)) {
    return res.status(400).json({ error: 'Only .csv, .xlsx, and .xls files are supported' });
  }

  try {
    const result = parseContactsBuffer(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
  });

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

// ── Socket.io ────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('[Socket.io] Client connected:', socket.id);

  // Immediately send current state to newly connected client
  socket.emit('status', { status: waStatus });
  if (waStatus === 'qr_ready' && latestQRDataUrl) {
    socket.emit('qr', { dataUrl: latestQRDataUrl });
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
