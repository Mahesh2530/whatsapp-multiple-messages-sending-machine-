import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { whatsappAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import './WhatsAppPage.css';

const WA_SERVICE_URL = 'http://localhost:3001';
const MAX_MSG_CHARS = 1024;

// Status display helpers
const STATUS_META = {
  disconnected: {
    label: 'Disconnected — WhatsApp Web is not connected',
    icon: '⚪',
  },
  initializing: {
    label: 'Initializing — Starting WhatsApp Web client...',
    icon: '🟡',
  },
  qr_ready: {
    label: 'Scan QR — Open WhatsApp on your phone and scan the QR code below',
    icon: '🔵',
  },
  connected: {
    label: 'Connected — Your WhatsApp account is linked and ready to send messages',
    icon: '🟢',
  },
};

export default function WhatsAppPage() {
  const [status, setStatus] = useState('disconnected');
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [parsedFile, setParsedFile] = useState(null);
  const [message, setMessage] = useState('');
  const [delay, setDelay] = useState(3000);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [job, setJob] = useState(null); // { sent, total, failed, current, status, currentContact }
  const [showConfirm, setShowConfirm] = useState(false);

  const fileInputRef = useRef(null);
  const socketRef = useRef(null);
  const toast = useToast();

  // ── Socket.io connection ──────────────────────────────────────

  useEffect(() => {
    const socket = io(WA_SERVICE_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected to WA service');
    });

    socket.on('status', ({ status: s }) => {
      setStatus(s);
      if (s === 'connected') setQrDataUrl(null);
    });

    socket.on('qr', ({ dataUrl }) => {
      setQrDataUrl(dataUrl);
      setStatus('qr_ready');
    });

    socket.on('progress', (data) => {
      setJob((prev) => ({ ...prev, ...data, status: 'sending' }));
    });

    socket.on('done', (data) => {
      setJob((prev) => ({ ...prev, ...data, status: 'completed' }));
      setSending(false);
      toast.success(`✅ Broadcast complete! ${data.sent} sent, ${data.failed} failed.`);
    });

    socket.on('connect_error', () => {
      console.warn('[Socket] Cannot reach WA service — is it running?');
    });

    // Also poll status via REST in case socket misses initial state
    whatsappAPI.getStatus()
      .then((res) => setStatus(res.data.status))
      .catch(() => {});

    return () => socket.disconnect();
  }, []);

  // ── Disconnect handler ────────────────────────────────────────

  const handleDisconnect = async () => {
    try {
      await whatsappAPI.disconnect();
      setQrDataUrl(null);
      setJob(null);
      toast.success('WhatsApp session disconnected');
    } catch {
      toast.error('Failed to disconnect');
    }
  };

  // ── File upload ───────────────────────────────────────────────

  const handleFile = useCallback(async (file) => {
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      toast.error('Only .csv, .xlsx, and .xls files are supported');
      return;
    }

    setUploading(true);
    try {
      const res = await whatsappAPI.uploadFile(file);
      const data = res.data;
      setParsedFile({ name: file.name, ...data });
      setContacts(data.contacts);
      toast.success(`Parsed ${data.total} contacts — ${data.valid} valid, ${data.invalid} invalid`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to parse file');
    } finally {
      setUploading(false);
    }
  }, [toast]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    handleFile(e.dataTransfer.files[0]);
  };

  // ── Send broadcast ────────────────────────────────────────────

  const handleSend = async () => {
    const validContacts = contacts.filter((c) => c.isValid);
    if (validContacts.length === 0) {
      toast.error('No valid contacts to send to');
      return;
    }
    if (!message.trim()) {
      toast.error('Please write a message');
      return;
    }

    setSending(true);
    setShowConfirm(false);
    setJob({ sent: 0, total: validContacts.length, failed: 0, current: 0, status: 'sending' });

    try {
      await whatsappAPI.sendBroadcast({ contacts, message: message.trim(), delay });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start broadcast');
      setSending(false);
      setJob(null);
    }
  };

  const validContacts = contacts.filter((c) => c.isValid);
  const canSend = status === 'connected' && validContacts.length > 0 && message.trim().length > 0 && !sending;
  const progressPct = job ? Math.round((job.sent + job.failed) / job.total * 100) : 0;

  const statusMeta = STATUS_META[status] || STATUS_META.disconnected;

  return (
    <div className="wa-page">
      <div className="page-header">
        <h1>WhatsApp Web</h1>
        <p>Send messages directly through your WhatsApp account — no API key needed</p>
      </div>

      {/* Status Banner */}
      <div className={`wa-status-banner ${status}`}>
        <div className="wa-status-dot" />
        <div className="wa-status-text">{statusMeta.label}</div>
        {status === 'connected' && (
          <button className="btn btn-ghost btn-sm" onClick={handleDisconnect}>
            Disconnect
          </button>
        )}
      </div>

      <div className="wa-layout">

        {/* ── Left: Connection Panel ── */}
        <div className="wa-connect-panel">
          <h3>📱 Connect WhatsApp</h3>
          <p>Scan the QR code with your phone to link your WhatsApp account</p>

          {status === 'connected' ? (
            <div className="wa-connected-state">
              <div className="wa-connected-icon">✅</div>
              <div className="wa-connected-label">WhatsApp Connected</div>
              <div className="wa-connected-sub">You can now send messages to your contacts</div>
            </div>
          ) : status === 'qr_ready' && qrDataUrl ? (
            <div className="wa-qr-box">
              <img src={qrDataUrl} alt="WhatsApp QR Code" />
            </div>
          ) : (
            <div className="wa-qr-box">
              <div className="wa-qr-placeholder">
                <div className="wa-qr-placeholder-icon">
                  {status === 'initializing' ? (
                    <div className="spinner spinner-lg" style={{ borderTopColor: 'var(--warning)', borderColor: 'rgba(245,158,11,0.2)', margin: '0 auto' }} />
                  ) : '📲'}
                </div>
                <div className="wa-qr-placeholder-text">
                  {status === 'initializing' ? 'Starting client...' : 'QR code will appear here'}
                </div>
              </div>
            </div>
          )}

          {/* Steps guide */}
          <div className="wa-steps">
            <div className="wa-step">
              <div className="wa-step-num">1</div>
              <div className="wa-step-text">Open <strong>WhatsApp</strong> on your phone</div>
            </div>
            <div className="wa-step">
              <div className="wa-step-num">2</div>
              <div className="wa-step-text">Tap <strong>⋮ Menu → Linked Devices → Link a Device</strong></div>
            </div>
            <div className="wa-step">
              <div className="wa-step-num">3</div>
              <div className="wa-step-text">Scan the QR code shown above</div>
            </div>
            <div className="wa-step">
              <div className="wa-step-num">4</div>
              <div className="wa-step-text">Wait for the green "Connected" indicator</div>
            </div>
          </div>
        </div>

        {/* ── Right: Send Panel ── */}
        <div className="wa-send-panel">

          {status !== 'connected' ? (
            <div className="wa-section">
              <div className="wa-locked-overlay">
                <div className="wa-locked-icon">🔒</div>
                <div className="wa-locked-title">WhatsApp Not Connected</div>
                <div className="wa-locked-sub">Scan the QR code on the left to unlock the message sender</div>
              </div>
            </div>
          ) : (
            <>
              {/* Section 1: Upload contacts */}
              <div className="wa-section">
                <h3>📂 Upload Contacts</h3>

                {!parsedFile ? (
                  <div
                    className={`wa-upload-zone ${dragActive ? 'active' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      style={{ display: 'none' }}
                      onChange={(e) => handleFile(e.target.files[0])}
                    />
                    {uploading ? (
                      <>
                        <div className="spinner spinner-lg" style={{ margin: '0 auto 12px', borderTopColor: 'var(--whatsapp)', borderColor: 'rgba(37,211,102,0.15)' }} />
                        <div className="wa-upload-zone-text">Parsing file...</div>
                      </>
                    ) : (
                      <>
                        <div className="wa-upload-zone-icon">📊</div>
                        <div className="wa-upload-zone-text">
                          Drag & drop your Excel or CSV file, or click to browse
                        </div>
                        <div className="wa-upload-zone-hint">
                          Supports .xlsx, .xls, .csv — must have a "phone" or "mobile" column
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="wa-contacts-summary">
                      <div className="wa-contacts-summary-left">
                        <div className="wa-contacts-summary-icon">📋</div>
                        <div className="wa-contacts-summary-info">
                          <strong>{parsedFile.name}</strong>
                          <span>{parsedFile.valid} valid · {parsedFile.invalid} invalid of {parsedFile.total} total</span>
                        </div>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setParsedFile(null); setContacts([]); setShowPreview(false); }}
                      >
                        Change File
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      <span className="badge badge-success">✓ {parsedFile.valid} valid</span>
                      <span className="badge badge-error">✕ {parsedFile.invalid} invalid</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginLeft: 'auto', fontSize: '0.775rem' }}
                        onClick={() => setShowPreview(!showPreview)}
                      >
                        {showPreview ? 'Hide Preview' : 'Show Preview'}
                      </button>
                    </div>

                    {showPreview && (
                      <div className="wa-preview-table-wrapper">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Phone</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {contacts.map((c, i) => (
                              <tr key={i}>
                                <td>{c.name || '—'}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{c.phone}</td>
                                <td>
                                  {c.isValid
                                    ? <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>✓ Valid</span>
                                    : <span className="badge badge-error" style={{ fontSize: '0.7rem' }}>✕ {c.error}</span>
                                  }
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Section 2: Write message */}
              <div className="wa-section">
                <h3>✍️ Write Message</h3>
                <textarea
                  className="wa-textarea"
                  placeholder={`Type your WhatsApp message here...\n\nSupports emojis, line breaks, and Unicode.\n\nExample:\nHi {{name}}! 👋\n\nWe have an exciting offer for you! 🎉`}
                  value={message}
                  onChange={(e) => {
                    if (e.target.value.length <= MAX_MSG_CHARS) setMessage(e.target.value);
                  }}
                />
                <div className="wa-char-count">
                  <span className={message.length > MAX_MSG_CHARS * 0.9 ? 'wa-char-warn' : ''}>
                    {message.length}
                  </span>{' '}
                  / {MAX_MSG_CHARS}
                </div>

                {/* Delay setting */}
                <div className="wa-delay-row">
                  <label>⏱️ Delay between messages:</label>
                  <select
                    className="wa-delay-select"
                    value={delay}
                    onChange={(e) => setDelay(parseInt(e.target.value))}
                  >
                    <option value={1000}>1 second (faster, higher risk)</option>
                    <option value={2000}>2 seconds</option>
                    <option value={3000}>3 seconds (recommended)</option>
                    <option value={5000}>5 seconds (safer)</option>
                    <option value={10000}>10 seconds (safest)</option>
                  </select>
                </div>
              </div>

              {/* Section 3: Send button */}
              <div className="wa-section">
                <h3>📤 Send Broadcast</h3>

                {!showConfirm ? (
                  <button
                    className="wa-send-btn"
                    disabled={!canSend}
                    onClick={() => setShowConfirm(true)}
                  >
                    {sending ? (
                      <>
                        <div className="spinner" style={{ borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.25)' }} />
                        Sending...
                      </>
                    ) : (
                      <>
                        📱 Send to {validContacts.length} Contact{validContacts.length !== 1 ? 's' : ''}
                      </>
                    )}
                  </button>
                ) : (
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '20px' }}>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '6px', fontSize: '0.9rem' }}>
                      ⚠️ You are about to send a WhatsApp message to <strong style={{ color: 'var(--text-primary)' }}>{validContacts.length} contacts</strong> from <strong style={{ color: 'var(--text-primary)' }}>{parsedFile?.name}</strong>.
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '16px' }}>
                      Each contact will receive an individual 1-to-1 message. This action cannot be undone.
                    </p>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button className="btn btn-ghost" onClick={() => setShowConfirm(false)}>Cancel</button>
                      <button className="wa-send-btn" style={{ flex: 1 }} onClick={handleSend}>
                        ✅ Confirm & Send
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress section */}
              {job && (
                <div className="wa-progress-section">
                  <div className="wa-progress-header">
                    <h3 style={{ margin: 0 }}>📊 Send Progress</h3>
                    <div>
                      <div className="wa-progress-counts">
                        {job.sent + job.failed} / {job.total}
                      </div>
                      <div className="wa-progress-sub">{progressPct}% complete</div>
                    </div>
                  </div>

                  <div className="wa-progress-bar-track">
                    <div
                      className="wa-progress-bar-fill"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  <div className="wa-progress-stats">
                    <div className="wa-progress-stat">
                      <div className="wa-progress-stat-dot sent" />
                      <span style={{ color: 'var(--whatsapp)' }}>{job.sent} sent</span>
                    </div>
                    <div className="wa-progress-stat">
                      <div className="wa-progress-stat-dot failed" />
                      <span style={{ color: 'var(--error)' }}>{job.failed} failed</span>
                    </div>
                    <div className="wa-progress-stat">
                      <div className="wa-progress-stat-dot pending" />
                      <span style={{ color: 'var(--text-muted)' }}>
                        {job.total - job.sent - job.failed} pending
                      </span>
                    </div>
                  </div>

                  {job.status === 'sending' && job.currentContact && (
                    <div className="wa-progress-current">
                      <div className="spinner" />
                      Sending to <strong style={{ color: 'var(--text-primary)', marginLeft: 4 }}>{job.currentContact}</strong>...
                    </div>
                  )}

                  {job.status === 'completed' && (
                    <div className="wa-done-banner">
                      🎉 Broadcast complete! {job.sent} messages delivered
                      {job.failed > 0 && `, ${job.failed} failed`}.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
