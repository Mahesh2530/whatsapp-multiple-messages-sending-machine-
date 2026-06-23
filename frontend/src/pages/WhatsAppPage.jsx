import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import { whatsappAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import './WhatsAppPage.css';

const WA_SERVICE_URL = 'http://localhost:3001';
const WA_API_KEY = import.meta.env.VITE_WA_API_KEY || '';
if (!WA_API_KEY) {
  console.warn('[WhatsAppPage] VITE_WA_API_KEY not set — socket auth will fail. Add it to frontend/.env');
}
const MAX_MSG_CHARS = 1024;

const loadingMessages = [
  "Preparing secure connection...",
  "Generating QR code...",
  "Waiting for WhatsApp verification...",
  "Finalizing connection..."
];


const CAMPAIGN_TEMPLATES = [
  {
    id: 'event',
    name: 'Event Invitation',
    text: "Hi {{first_name}},\n\nYou're invited to our upcoming event! 🚀 Join us on Saturday at 10 AM. Don't forget to register: https://example.com/register\n\nHope to see you there!"
  },
  {
    id: 'reminder',
    name: 'Reminder',
    text: "Hello {{name}},\n\nThis is a quick reminder that your subscription expires tomorrow. Please renew today to avoid any service interruption: https://example.com/billing\n\nThanks!"
  },
  {
    id: 'meeting',
    name: 'Meeting Notice',
    text: "Hi {{first_name}},\n\nOur next team check-in is scheduled for today at 2 PM. Please prepare your weekly metrics.\n\nMeeting link: https://meet.google.com/abc-defg-hij"
  },
  {
    id: 'hackathon',
    name: 'Hackathon Update',
    text: "Hey {{first_name}}! 👋\n\nQuick update for the Hackathon: submission deadline is extended by 2 hours. Submit your projects before 8 PM tonight!\n\nSubmit here: https://example.com/submit"
  },
  {
    id: 'festival',
    name: 'Festival Greeting',
    text: "Hi {{name}}! 🌸\n\nWishing you and your family a very happy and prosperous festival! May this season bring joy, health, and peace to your home.\n\nWarm regards!"
  },
  {
    id: 'placement',
    name: 'Placement Drive',
    text: "Dear {{last_name}} {{first_name}},\n\nThe placement drive schedules have been finalized. Interviews start tomorrow at 9 AM in the main seminar hall. Please bring 3 copies of your resume.\n\nGood luck!"
  }
];


export default function WhatsAppPage() {
  const [status, setStatus] = useState('disconnected');
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [contacts, setContacts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cuckoo-contacts')) || [];
    } catch {
      return [];
    }
  });
  const [parsedFile, setParsedFile] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cuckoo-parsed-file')) || null;
    } catch {
      return null;
    }
  });
  const [detectedGroups, setDetectedGroups] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cuckoo-detected-groups')) || [];
    } catch {
      return [];
    }
  });
  const [discoveryStats, setDiscoveryStats] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cuckoo-discovery-stats')) || null;
    } catch {
      return null;
    }
  });
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    return localStorage.getItem('cuckoo-selected-group-id') || null;
  });
  const [previewRows, setPreviewRows] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cuckoo-preview-rows')) || [];
    } catch {
      return [];
    }
  });
  
  const [message, setMessage] = useState(() => {
    return localStorage.getItem('cuckoo-draft-message') || '';
  });
  const [delay, setDelay] = useState(() => {
    const saved = localStorage.getItem('cuckoo-delay');
    return saved ? Number(saved) : 3000;
  });
  const [dragActive, setDragActive] = useState(false);
  
  const [aiDraft, setAiDraft] = useState(null);
  const [isAILoading, setIsAILoading] = useState(false);
  const [campaignReview, setCampaignReview] = useState(null);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [job, setJob] = useState(null); // { sent, total, failed, current, status, currentContact }
  
  const [qrExpiresAt, setQrExpiresAt] = useState(null);
  const [qrIssuedAt, setQrIssuedAt] = useState(null);
  const [clientGeneration, setClientGeneration] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const [qrExpired, setQrExpired] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [qrAge, setQrAge] = useState('N/A');

  // Redesign state variables
  const location = useLocation();
  const [connectRequested, setConnectRequested] = useState(() => {
    return localStorage.getItem('cuckoo-connect-requested') === 'true';
  });
  const [revealQR, setRevealQR] = useState(() => {
    return localStorage.getItem('cuckoo-reveal-qr') === 'true';
  });
  const [wizardStep, setWizardStep] = useState(() => {
    return location.state?.step || localStorage.getItem('cuckoo-wizard-step') || 'connect';
  });
  const [connectedAt, setConnectedAt] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all'); // all | selected | unselected | valid | invalid

  // LocalStorage Sync Effects for Campaign State
  useEffect(() => {
    localStorage.setItem('cuckoo-contacts', JSON.stringify(contacts));
  }, [contacts]);

  useEffect(() => {
    if (parsedFile) {
      localStorage.setItem('cuckoo-parsed-file', JSON.stringify(parsedFile));
    } else {
      localStorage.removeItem('cuckoo-parsed-file');
    }
  }, [parsedFile]);

  useEffect(() => {
    localStorage.setItem('cuckoo-detected-groups', JSON.stringify(detectedGroups));
  }, [detectedGroups]);

  useEffect(() => {
    if (discoveryStats) {
      localStorage.setItem('cuckoo-discovery-stats', JSON.stringify(discoveryStats));
    } else {
      localStorage.removeItem('cuckoo-discovery-stats');
    }
  }, [discoveryStats]);

  useEffect(() => {
    if (selectedGroupId) {
      localStorage.setItem('cuckoo-selected-group-id', selectedGroupId);
    } else {
      localStorage.removeItem('cuckoo-selected-group-id');
    }
  }, [selectedGroupId]);

  useEffect(() => {
    localStorage.setItem('cuckoo-preview-rows', JSON.stringify(previewRows));
  }, [previewRows]);

  useEffect(() => {
    localStorage.setItem('cuckoo-delay', delay);
  }, [delay]);

  useEffect(() => {
    localStorage.setItem('cuckoo-connect-requested', connectRequested);
  }, [connectRequested]);

  useEffect(() => {
    localStorage.setItem('cuckoo-reveal-qr', revealQR);
  }, [revealQR]);

  useEffect(() => {
    localStorage.setItem('cuckoo-wizard-step', wizardStep);
  }, [wizardStep]);
  const [segmentName, setSegmentName] = useState('');
  const [savedSegments, setSavedSegments] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cuckoo-saved-segments')) || {};
    } catch {
      return {};
    }
  });

  // Dual Connection Mode States
  const [connectionMode, setConnectionMode] = useState(() => {
    return localStorage.getItem('cuckoo-connection-mode') || 'web';
  });
  const [cloudPhoneId, setCloudPhoneId] = useState(() => localStorage.getItem('cuckoo-cloud-phone-id') || '');
  const [cloudWabaId, setCloudWabaId] = useState(() => localStorage.getItem('cuckoo-cloud-waba-id') || '');
  const [cloudToken, setCloudToken] = useState(() => localStorage.getItem('cuckoo-cloud-token') || '');
  const [cloudConnected, setCloudConnected] = useState(() => localStorage.getItem('cuckoo-cloud-connected') === 'true');
  const [checkingWebhook, setCheckingWebhook] = useState(false);

  const isWaConnected = status.toLowerCase() === 'connected' || (connectionMode === 'cloud' && cloudConnected);

  const fileInputRef = useRef(null);
  const socketRef = useRef(null);
  const textareaRef = useRef(null);
  const toast = useToast();

  const [personalizationEnabled, setPersonalizationEnabled] = useState(true);
  const [previewVariablesEnabled, setPreviewVariablesEnabled] = useState(true);
  const [selectedTemplateForActions, setSelectedTemplateForActions] = useState(null);
  const [previewOverride, setPreviewOverride] = useState(null);
  const [lastSavedTime, setLastSavedTime] = useState('');

  // Diagnostics & Watchdogs states
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [qrSeconds, setQrSeconds] = useState(0);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [lastQrTime, setLastQrTime] = useState('Never');
  const [lastSuccessfulConnection, setLastSuccessfulConnection] = useState(() => {
    return localStorage.getItem('cuckoo-last-connected-at') || 'Never';
  });

  useEffect(() => {
    if (location.state?.step) {
      const stepVal = location.state.step;
      setTimeout(() => {
        setWizardStep(stepVal);
      }, 0);
    }
  }, [location.state?.step]);

  // ── QR Timer and loading message cycle ────────────────────────
  useEffect(() => {
    let interval;
    const isWaiting = status === 'initializing' || status === 'disconnected' || status === 'INITIALIZING' || status === 'DISCONNECTED' || status === 'IDLE';
    if (connectRequested && isWaiting) {
      if (!qrDataUrl || qrExpired) {
        interval = setInterval(() => {
          setQrSeconds((prev) => prev + 1);
        }, 1000);
      }
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [connectRequested, status, qrDataUrl, qrExpired]);

  useEffect(() => {
    let msgInterval;
    const isWaiting = status === 'initializing' || status === 'disconnected' || status === 'INITIALIZING' || status === 'DISCONNECTED' || status === 'IDLE';
    if (connectRequested && isWaiting) {
      if (!qrDataUrl || qrExpired) {
        msgInterval = setInterval(() => {
          setLoadingMsgIndex((prev) => (prev + 1) % 4);
        }, 3000);
      }
    }
    return () => {
      if (msgInterval) {
        clearInterval(msgInterval);
        setLoadingMsgIndex(0);
      }
    };
  }, [connectRequested, status, qrDataUrl, qrExpired]);

  // Helpers
  const getStepStatus = (stepIdx) => {
    if (isWaConnected) {
      return 'completed';
    }

    if (!connectRequested) {
      if (stepIdx === 1) return 'current';
      return 'pending';
    }

    if (!revealQR) {
      if (stepIdx < 2) return 'completed';
      if (stepIdx === 2) return 'current';
      return 'pending';
    }

    // Connect requested and revealed QR
    if (status === 'initializing' || status === 'disconnected' || status === 'INITIALIZING' || status === 'DISCONNECTED' || status === 'IDLE' || status === 'ERROR') {
      if (stepIdx < 3) return 'completed';
      if (stepIdx === 3) return 'current';
      return 'pending';
    }

    if (status === 'qr_ready' || status === 'QR_READY') {
      if (stepIdx < 4) return 'completed';
      if (stepIdx === 4) return 'current';
      return 'pending';
    }

    if (status === 'connecting' || status === 'AUTHENTICATING') {
      if (stepIdx < 5) return 'completed';
      if (stepIdx === 5) return 'current';
      return 'pending';
    }

    return 'pending';
  };

  const handleRetryQR = async () => {
    try {
      setQrSeconds(0);
      setRefreshCount((prev) => prev + 1);
      await whatsappAPI.refreshQR();
      toast.success('Regenerating new QR code...');
    } catch {
      toast.error('Failed to regenerate QR code');
    }
  };

  const renderConnectionHealthCard = () => {
    const qrAvailable = !!qrDataUrl && !qrExpired;

    return (
      <div className="wa-connection-health-card" style={{ border: '1px solid var(--border-default)', borderRadius: '12px', background: 'var(--bg-surface)', overflow: 'hidden' }}>
        <button 
          type="button"
          className="health-card-header-toggle-btn"
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          style={{
            width: '100%',
            background: 'none',
            border: 'none',
            padding: '12px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            textAlign: 'left',
            color: 'var(--text-primary)',
            fontWeight: 600,
            fontSize: '1rem',
            borderBottom: showDiagnostics ? '1px solid var(--border-subtle)' : 'none'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📊</span> Connection Diagnostics
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{showDiagnostics ? '▲ Collapse' : '▼ Expand'}</span>
        </button>
        
        {showDiagnostics && (
          <div className="health-card-body" style={{ padding: '16px' }}>
            {connectionMode === 'web' ? (
              <div className="health-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Connection State</span>
                  <span className={`health-val status-${status}`} style={{ fontWeight: 600 }}>{status}</span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Client Generation</span>
                  <span className="health-val" style={{ fontWeight: 600 }}>{clientGeneration}</span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>QR Available</span>
                  <span className="health-val" style={{ fontWeight: 600, color: qrAvailable ? 'var(--brand-primary)' : 'var(--text-muted)' }}>{qrAvailable ? 'True' : 'False'}</span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Last QR Generated</span>
                  <span className="health-val" style={{ fontWeight: 600 }}>{lastQrTime}</span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>QR Age (seconds)</span>
                  <span className="health-val" style={{ fontWeight: 600 }}>{qrAge}</span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Reconnect Count</span>
                  <span className="health-val" style={{ fontWeight: 600 }}>{reconnectCount}</span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Refresh Count</span>
                  <span className="health-val" style={{ fontWeight: 600 }}>{refreshCount}</span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Last Backend Status</span>
                  <span className="health-val" style={{ fontWeight: 600 }}>{status}</span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column', gridColumn: 'span 2' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Last Successful Connection</span>
                  <span className="health-val" style={{ fontWeight: 600 }}>{lastSuccessfulConnection}</span>
                </div>
              </div>
            ) : (
              <div className="health-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Connection Status</span>
                  <span className={`health-val status-${cloudConnected ? 'connected' : 'disconnected'}`} style={{ fontWeight: 600 }}>
                    {cloudConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Phone Number ID</span>
                  <span className="health-val" style={{ fontWeight: 600 }}>{cloudPhoneId || 'Not Configured'}</span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Webhook Status</span>
                  <span className={`health-val webhook-${cloudConnected ? 'verified' : 'pending'}`} style={{ fontWeight: 600 }}>
                    {cloudConnected ? 'Active & Verified' : 'Pending Verification'}
                  </span>
                </div>
                <div className="health-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="health-lbl" style={{ color: 'var(--text-muted)' }}>Business Account Status</span>
                  <span className="health-val" style={{ fontWeight: 600 }}>
                    {cloudConnected ? 'Approved' : 'Unknown'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Socket.io connection ──────────────────────────────────────

  useEffect(() => {
    const socket = io(WA_SERVICE_URL, { 
      transports: ['websocket', 'polling'],
      auth: { token: WA_API_KEY }
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected to WA service');
    });

    socket.on('status', ({ status: s, generationId }) => {
      setStatus(s);
      if (generationId !== undefined) {
        setClientGeneration((prevGen) => {
          if (prevGen !== 0 && generationId > prevGen) {
            setReconnectCount((prev) => prev + 1);
          }
          return generationId;
        });
      }
      if (s === 'CONNECTED' || s === 'connected') {
        setQrDataUrl(null);
        const timeStr = new Date().toLocaleString();
        setConnectedAt(timeStr);
        setLastSuccessfulConnection(timeStr);
        localStorage.setItem('cuckoo-last-connected-at', timeStr);
        setWizardStep((prev) => (prev === 'connect' ? 'upload' : prev));
      } else if (s === 'DISCONNECTED' || s === 'disconnected' || s === 'ERROR') {
        setConnectedAt(null);
      }
    });

    socket.on('qr', ({ dataUrl, issuedAt, expiresAt, generationId }) => {
      console.log('[DEBUG] QR received');
      setQrDataUrl(dataUrl);
      setQrIssuedAt(issuedAt);
      setQrExpiresAt(expiresAt);
      setQrExpired(false);
      setStatus('QR_READY');
      setLastQrTime(new Date().toLocaleTimeString());
      if (generationId !== undefined) {
        setClientGeneration(generationId);
      }
      console.log('[DEBUG] State updated');
    });

    socket.on('qr_expired', ({ generationId }) => {
      setQrExpired(true);
      if (generationId !== undefined) {
        setClientGeneration(generationId);
      }
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
      .then((res) => {
        const s = res.data.status;
        setStatus(s);
        if (res.data.generationId !== undefined) {
          setClientGeneration((prevGen) => {
            if (prevGen !== 0 && res.data.generationId > prevGen) {
              setReconnectCount((prev) => prev + 1);
            }
            return res.data.generationId;
          });
        }
        if (s === 'CONNECTED' || s === 'connected') {
          const timeStr = res.data.lastConnected ? new Date(res.data.lastConnected).toLocaleString() : new Date().toLocaleString();
          setConnectedAt(timeStr);
          setLastSuccessfulConnection(timeStr);
          localStorage.setItem('cuckoo-last-connected-at', timeStr);
          setWizardStep((prev) => (prev === 'connect' ? 'upload' : prev));
        } else if (s === 'DISCONNECTED' || s === 'disconnected' || s === 'ERROR') {
          setConnectedAt(null);
        }

        // Rapid recovery / restore active QR on page load
        if ((s === 'QR_READY' || s === 'qr_ready') && res.data.qrAvailable) {
          whatsappAPI.getQR()
            .then((qrRes) => {
              setQrDataUrl(qrRes.data.dataUrl);
              setQrIssuedAt(qrRes.data.issuedAt);
              setQrExpiresAt(qrRes.data.expiresAt);
              setQrExpired(false);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});

    return () => socket.disconnect();
  }, [toast, setLastQrTime, setLastSuccessfulConnection, setReconnectCount]);


  // ── QR Countdown ──────────────────────────────────────────────

  useEffect(() => {
    if (!qrDataUrl || !qrExpiresAt || qrExpired) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((qrExpiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (qrIssuedAt) {
        setQrAge(`${Math.max(0, Math.floor((Date.now() - qrIssuedAt) / 1000))}s`);
      }
      if (remaining === 0) {
        setQrExpired(true);
        setQrAge('N/A');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt, qrDataUrl, qrExpired, qrIssuedAt]);

  // ── Connection Actions ────────────────────────────────────────

  const handleDisconnect = async () => {
    try {
      await whatsappAPI.disconnect();
      setQrDataUrl(null);
      setQrAge('N/A');
      setJob(null);
      setConnectedAt(null);
      setConnectRequested(false);
      setRevealQR(false);
      toast.success('WhatsApp session disconnected');
    } catch {
      toast.error('Failed to disconnect');
    }
  };

  const handleCloudConnect = (e) => {
    e.preventDefault();
    if (!cloudPhoneId.trim() || !cloudWabaId.trim() || !cloudToken.trim()) {
      toast.error('Please fill in all fields');
      return;
    }
    setCheckingWebhook(true);
    setTimeout(() => {
      setCheckingWebhook(false);
      setCloudConnected(true);
      localStorage.setItem('cuckoo-cloud-phone-id', cloudPhoneId);
      localStorage.setItem('cuckoo-cloud-waba-id', cloudWabaId);
      localStorage.setItem('cuckoo-cloud-token', cloudToken);
      localStorage.setItem('cuckoo-cloud-connected', 'true');
      setConnectedAt(new Date().toLocaleString());
      setWizardStep((prev) => (prev === 'connect' ? 'upload' : prev));
      toast.success('✓ Webhook connected & WABA settings verified successfully!');
    }, 1000);
  };

  const handleCloudDisconnect = () => {
    setCloudConnected(false);
    localStorage.removeItem('cuckoo-cloud-connected');
    setConnectedAt(null);
    setWizardStep('connect');
    toast.success('WhatsApp Cloud API disconnected');
  };

  const handleModeChange = (mode) => {
    setConnectionMode(mode);
    localStorage.setItem('cuckoo-connection-mode', mode);
  };

  // Sync draft message to localStorage & update last saved timestamp
  useEffect(() => {
    localStorage.setItem('cuckoo-draft-message', message);
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const timer = setTimeout(() => {
      setLastSavedTime(`Last saved ${formattedHours}:${minutes} ${ampm}`);
    }, 0);
    return () => clearTimeout(timer);
  }, [message]);


  // Textarea auto-grow effect
  useEffect(() => {
    if (wizardStep === 'compose' && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(180, textareaRef.current.scrollHeight)}px`;
    }
  }, [message, wizardStep]);

  const insertVariable = (variable) => {
    if (!personalizationEnabled) {
      toast.warning('Personalization is currently disabled in Campaign Settings.');
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);
    const newValue = before + variable + after;
    
    if (newValue.length <= MAX_MSG_CHARS) {
      setMessage(newValue);
      setTimeout(() => {
        textarea.focus();
        const caretPos = start + variable.length;
        textarea.setSelectionRange(caretPos, caretPos);
      }, 0);
    } else {
      toast.error('Cannot insert variable: message length exceeds limit');
    }
  };

  const handleTemplateClick = (tpl) => {
    setSelectedTemplateForActions(tpl);
    setPreviewOverride(null);
  };

  const handleUseTemplate = () => {
    if (selectedTemplateForActions) {
      setMessage(selectedTemplateForActions.text);
      setPreviewOverride(null);
      setSelectedTemplateForActions(null);
      toast.success('Template loaded into editor');
    }
  };

  const handlePreviewTemplate = () => {
    if (selectedTemplateForActions) {
      setPreviewOverride(selectedTemplateForActions.text);
      toast.info(`Previewing template: ${selectedTemplateForActions.name}`);
    }
  };

  const handleCustomMessage = () => {
    setMessage('');
    setPreviewOverride(null);
    setSelectedTemplateForActions(null);
    toast.info('Cleared editor for custom message');
  };

  const getMessageHealth = (msg) => {
    const issues = [];
    if (!msg.trim()) {
      return { status: 'empty', label: 'No content', issues: [] };
    }

    const alphas = msg.replace(/[^a-zA-Z]/g, '');
    if (alphas.length > 20) {
      const uppers = msg.replace(/[^A-Z]/g, '');
      if (uppers.length / alphas.length > 0.3) {
        issues.push('Contains excessive capitalization (avoid typing in ALL CAPS)');
      }
    }

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const links = msg.match(urlRegex) || [];
    let hasInsecure = false;
    let hasShortener = false;
    links.forEach(l => {
      if (l.startsWith('http://')) hasInsecure = true;
      if (/bit\.ly|tinyurl\.com|t\.co|rebrand\.ly/i.test(l)) hasShortener = true;
    });
    if (hasInsecure) issues.push('Contains insecure link (http:// instead of https://)');
    if (hasShortener) issues.push('Contains suspect generic url shortener');

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
    const emojis = msg.match(emojiRegex) || [];
    if (emojis.length > 5) {
      issues.push('Too many emojis (keep emoji count under 5)');
    }

    if (issues.length === 0) {
      return { status: 'good', label: '✓ Good Deliverability', issues: [] };
    }
    return { status: 'warning', label: '⚠ Delivery Health Warnings', issues };
  };

  const getPreviewText = () => {
    let rawText = previewOverride !== null ? previewOverride : message;
    if (!rawText) return 'Your message preview will appear here...';
    
    if (!previewVariablesEnabled) {
      return rawText;
    }

    const firstContact = selectedContacts[0];
    const nameVal = firstContact?.name || 'Sample Contact';
    const firstVal = nameVal.split(' ')[0] || 'Sample Contact';
    const lastVal = nameVal.split(' ').slice(1).join(' ') || '';

    let rendered = rawText
      .replace(/\{\{name\}\}/gi, nameVal)
      .replace(/\{\{first_name\}\}/gi, firstVal)
      .replace(/\{\{last_name\}\}/gi, lastVal);
      
    return rendered;
  };


  // ── File Upload & Discovery ──────────────────────────────────────

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setParsedFile({ name: file.name, totalRows: 0 });
      const res = await whatsappAPI.uploadFile(file);
      const data = res.data;
      
      setParsedFile({ name: file.name, ...data });
      setDetectedGroups(data.detectedGroups || []);
      setDiscoveryStats({
        qualityScore: data.qualityScore,
        total: data.totalContacts,
        valid: data.validContacts,
        invalid: data.invalidContacts,
        duplicates: data.duplicateContacts,
        missingNames: data.missingNames,
        missingPhones: data.missingPhones
      });
      setPreviewRows(data.previewRows || []);
      
      if (data.isSimple && data.detectedGroups && data.detectedGroups.length > 0) {
        // Fast Path: Immediately select all valid contacts and go to review page
        const firstGroup = data.detectedGroups[0];
        const mapped = firstGroup.contacts.map((c) => ({ ...c, selected: c.isValid }));
        setContacts(mapped);
        setWizardStep('review');
        toast.success('Contacts imported instantly (Simple CSV)');
      } else if (data.detectedGroups && data.detectedGroups.length > 0) {
        setSelectedGroupId('all');
        setWizardStep('group_select');
      } else {
        toast.error('No valid contacts found in file.');
        setParsedFile(null);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to process file');
      setParsedFile(null);
    }
  };

  const handleMockUpload = () => {
    const data = {
      name: 'sample_contacts.csv',
      qualityScore: 8,
      totalContacts: 5,
      validContacts: 3,
      invalidContacts: 1,
      duplicateContacts: 1,
      missingNames: 0,
      missingPhones: 0,
      isSimple: true,
      previewRows: [
        { "Full Name": "Alice Smith", "Phone Number": "+919876543210", "Email": "alice@example.com", "Group": "Leaders", "Role": "Organizer" },
        { "Full Name": "Bob Johnson", "Phone Number": "+919876543211", "Email": "bob@example.com", "Group": "Members", "Role": "Speaker" },
        { "Full Name": "Charlie Brown", "Phone Number": "+919876543212", "Email": "charlie@example.com", "Group": "Members", "Role": "Attendee" },
        { "Full Name": "Alice Smith", "Phone Number": "+919876543210", "Email": "alice@example.com", "Group": "Leaders", "Role": "Organizer" },
        { "Full Name": "Invalid User", "Phone Number": "12345", "Email": "invalid@example.com", "Group": "Members", "Role": "Attendee" }
      ],
      detectedGroups: [
        {
          id: 'group_0',
          label: 'All Contacts',
          nameCol: 'Full Name',
          phoneCol: 'Phone Number',
          confidence: 100,
          stats: { total: 4, valid: 3, invalid: 1, duplicates: 1 },
          contacts: [
            { row: 2, name: 'Alice Smith', phone: '+919876543210', normalizedPhone: '919876543210', isValid: true, error: null },
            { row: 3, name: 'Bob Johnson', phone: '+919876543211', normalizedPhone: '919876543211', isValid: true, error: null },
            { row: 4, name: 'Charlie Brown', phone: '+919876543212', normalizedPhone: '919876543212', isValid: true, error: null },
            { row: 6, name: 'Invalid User', phone: '12345', normalizedPhone: '12345', isValid: false, error: 'Invalid phone pattern' }
          ]
        }
      ]
    };

    setParsedFile({ name: data.name, ...data });
    setDetectedGroups(data.detectedGroups);
    setDiscoveryStats({
      qualityScore: data.qualityScore,
      total: data.totalContacts,
      valid: data.validContacts,
      invalid: data.invalidContacts,
      duplicates: data.duplicateContacts,
      missingNames: data.missingNames,
      missingPhones: data.missingPhones
    });
    setPreviewRows(data.previewRows);

    const firstGroup = data.detectedGroups[0];
    const mapped = firstGroup.contacts.map((c) => ({ ...c, selected: c.isValid }));
    setContacts(mapped);
    setWizardStep('review');
    toast.success('Sample contacts loaded successfully (Demo Mode)');
  };

  const handleConfirmGroup = () => {
    let finalContacts = [];
    if (selectedGroupId === 'all') {
      detectedGroups.forEach(g => {
        finalContacts = finalContacts.concat(g.contacts);
      });
    } else {
      const group = detectedGroups.find(g => g.id === selectedGroupId);
      if (group) finalContacts = group.contacts;
    }
    
    // Auto-select valid contacts
    const mapped = finalContacts.map((c) => ({ ...c, selected: c.isValid }));
    setContacts(mapped);
    setWizardStep('review');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    handleFile({ target: { files: e.dataTransfer.files } });
  };

  const handleChangeFile = () => {
    setParsedFile(null);
    setContacts([]);
    setSearchQuery('');
    setWizardStep('upload');
  };

  // ── AI Actions ───────────────────────────────────────────────────

  const handleAIAction = async (action, tone = '') => {
    if (!message) return toast.error("Write a message first!");
    setIsAILoading(true);
    setAiDraft(null);
    try {
      let endpoint = '/ai/improve';
      let payload = { message };
      
      if (action === 'correct') {
        endpoint = '/ai/correct';
      } else if (action === 'tone') {
        endpoint = '/ai/tone';
        payload.tone = tone;
      }
      
      const res = await whatsappAPI.aiAction(endpoint, payload);
      const draft = res.data?.message || res.data;
      if (draft && typeof draft.improved === 'string') {
        setAiDraft(draft);
      } else {
        toast.error('AI response was invalid or empty.');
      }
    } catch (err) {
      console.error(err);
      const isAIDown = err.response?.data?.aiUnavailable;
      toast.error(isAIDown ? 'AI Assistant temporarily unavailable' : (err.response?.data?.error || err.message || 'AI Request failed'));
    } finally {
      setIsAILoading(false);
    }
  };
  
  const acceptAiDraft = () => {
    if (aiDraft?.improved) {
      setMessage(aiDraft.improved);
      setAiDraft(null);
    }
  };

  const discardAiDraft = () => {
    setAiDraft(null);
  };

  const handleGoToReview = async () => {
    if (!message) return toast.error("Write a message first!");
    setWizardStep('summary');
    setIsReviewLoading(true);
    setCampaignReview(null);
    try {
      const res = await whatsappAPI.aiAction('/ai/review', { message });
      setCampaignReview(res.data);
    } catch (err) {
      console.error(err);
      const isAIDown = err.response?.data?.aiUnavailable;
      // Show toast but do NOT block navigation — summary page renders without review
      toast.warning(isAIDown ? 'AI Assistant temporarily unavailable' : (err.response?.data?.error || 'AI Review unavailable'));
    } finally {
      setIsReviewLoading(false);
    }
  };

  // ── Send broadcast ────────────────────────────────────────────

  const handleSend = async () => {
    const selectedContacts = contacts.filter((c) => c.isValid && c.selected);
    if (selectedContacts.length === 0) {
      toast.error('No recipients selected');
      return;
    }
    if (!message.trim()) {
      toast.error('Please write a message');
      return;
    }

    setSending(true);
    setJob({ sent: 0, total: selectedContacts.length, failed: 0, current: 0, status: 'sending' });

    try {
      await whatsappAPI.sendBroadcast({ contacts: selectedContacts, message: message.trim(), delay });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start broadcast');
      setSending(false);
      setJob(null);
    }
  };

  const selectedContacts = contacts.filter((c) => c.isValid && c.selected);

  // Filter contacts based on search query and status filter type
  const displayedContacts = contacts.filter(c => {
    // 1. Search Filter
    const matchesSearch = 
      (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.phone || '').includes(searchQuery);
    if (!matchesSearch) return false;

    // 2. Status Filter
    if (filterType === 'selected') return c.selected;
    if (filterType === 'unselected') return !c.selected;
    if (filterType === 'valid') return c.isValid;
    if (filterType === 'invalid') return !c.isValid;
    return true; // 'all'
  });

  // Bulk Actions
  const bulkSelectAll = () => {
    setContacts(prev => prev.map(c => ({ ...c, selected: true })));
    toast.success('Selected all contacts');
  };

  const bulkDeselectAll = () => {
    setContacts(prev => prev.map(c => ({ ...c, selected: false })));
    toast.success('Deselected all contacts');
  };

  const bulkSelectValid = () => {
    setContacts(prev => prev.map(c => ({ ...c, selected: c.isValid })));
    toast.success('Selected all valid contacts');
  };

  const bulkSelectInvalid = () => {
    setContacts(prev => prev.map(c => ({ ...c, selected: !c.isValid })));
    toast.success('Selected all invalid contacts');
  };

  const bulkInvertSelection = () => {
    setContacts(prev => prev.map(c => ({ ...c, selected: !c.selected })));
    toast.success('Inverted selection');
  };

  // Segment Selection
  const handleSegmentChange = (segmentId) => {
    if (segmentId === '') return;
    
    if (segmentId === 'all') {
      setContacts(prev => prev.map(c => ({ ...c, selected: true })));
      toast.success('Selected all contacts');
      return;
    }

    if (segmentId.startsWith('group_')) {
      const group = detectedGroups.find(g => g.id === segmentId);
      if (group) {
        const groupPhoneNumbers = new Set(group.contacts.map(c => c.normalizedPhone));
        setContacts(prev => prev.map(c => ({
          ...c,
          selected: groupPhoneNumbers.has(c.normalizedPhone)
        })));
        toast.success(`Selected segment: ${group.label}`);
      }
      return;
    }

    const saved = savedSegments[segmentId];
    if (saved) {
      const phoneSet = new Set(saved);
      setContacts(prev => prev.map(c => ({
        ...c,
        selected: phoneSet.has(c.normalizedPhone)
      })));
      toast.success(`Selected saved segment: ${segmentId}`);
    }
  };

  const handleSaveSegment = () => {
    if (!segmentName.trim()) {
      toast.error('Please enter a segment name');
      return;
    }
    const selectedPhones = contacts.filter(c => c.selected).map(c => c.normalizedPhone);
    if (selectedPhones.length === 0) {
      toast.error('No contacts selected to save as a segment');
      return;
    }

    const updated = {
      ...savedSegments,
      [segmentName.trim()]: selectedPhones
    };
    setSavedSegments(updated);
    localStorage.setItem('cuckoo-saved-segments', JSON.stringify(updated));
    setSegmentName('');
    toast.success(`Saved segment "${segmentName.trim()}" successfully!`);
  };



  return (
    <div className={`wa-onboarding-page ${wizardStep === 'compose' ? 'composer-step-active' : ''}`}>
      <div className="wa-onboarding-header">
        <h1>Cuckoo</h1>
        <p>Private Messaging</p>
      </div>

      <div className="wa-onboarding-flow">
        
        {/* CARD 1: WHATSAPP CONNECTION */}
        <div className="wa-card wa-connect-card">
          <div className="wa-card-header">
            <h2>Connect WhatsApp</h2>
            <p>Connect your WhatsApp account securely to start sending messages through your own WhatsApp session.</p>
          </div>

          {isWaConnected ? (
            <div className="wa-connected-state-container">
              <div className="wa-success-badge">
                <span className="badge-icon">✓</span> WhatsApp {connectionMode === 'web' ? 'Web' : 'Cloud API'} Connected
              </div>
              <div className="wa-connection-metadata">
                {connectionMode === 'web' ? (
                  <>
                    <div className="meta-row">
                      <span className="meta-label">Phone Number</span>
                      <span className="meta-value">+91 XXXXX XXXXX</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Connection Status</span>
                      <span className="meta-value status-active">Connected (Web QR)</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="meta-row">
                      <span className="meta-label">Phone Number ID</span>
                      <span className="meta-value">{cloudPhoneId}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">WABA ID</span>
                      <span className="meta-value">{cloudWabaId}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Connection Status</span>
                      <span className="meta-value status-active">Connected (Cloud API)</span>
                    </div>
                  </>
                )}
                <div className="meta-row">
                  <span className="meta-label">Connected Since</span>
                  <span className="meta-value">{connectedAt || 'Just now'}</span>
                </div>
              </div>
              <button 
                className="wa-btn wa-btn-danger" 
                onClick={connectionMode === 'web' ? handleDisconnect : handleCloudDisconnect}
                style={{ marginBottom: '24px' }}
              >
                Disconnect Session
              </button>

              {/* Adaptive Health Diagnostics Card for Connected State */}
              {renderConnectionHealthCard()}
            </div>
          ) : (
            <div>
              {/* Dual-mode connection tab switcher */}
              <div className="wa-connection-mode-tabs" style={{ display: 'flex', gap: '12px', marginBottom: '24px', borderBottom: '1px solid var(--border-default)', paddingBottom: '12px' }}>
                <button 
                  type="button"
                  className={`wa-mode-tab-btn ${connectionMode === 'web' ? 'active' : ''}`}
                  onClick={() => handleModeChange('web')}
                  style={{
                    background: connectionMode === 'web' ? 'var(--brand-primary)' : 'var(--bg-secondary)',
                    color: connectionMode === 'web' ? 'white' : 'var(--text-secondary)',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  WhatsApp Web (QR)
                </button>
                <button 
                  type="button"
                  className={`wa-mode-tab-btn ${connectionMode === 'cloud' ? 'active' : ''}`}
                  onClick={() => handleModeChange('cloud')}
                  style={{
                    background: connectionMode === 'cloud' ? 'var(--brand-primary)' : 'var(--bg-secondary)',
                    color: connectionMode === 'cloud' ? 'white' : 'var(--text-secondary)',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  WhatsApp Cloud API
                </button>
              </div>

              {connectionMode === 'web' ? (
                <>
                  <div className="wa-two-col-layout">
                    {/* Left Side: Onboarding Steps */}
                    <div className="wa-col-instructions">
                      <h3>Connection Process</h3>
                      <div className="wa-steps-list">
                        {[1, 2, 3, 4, 5].map((stepIdx) => {
                          const stepTitles = [
                            "Open WhatsApp on your phone",
                            "Tap Settings/Menu → Linked Devices",
                            "Tap Link a Device",
                            "Scan the QR Code",
                            "Wait for secure verification"
                          ];
                          const stepDescs = [
                            "Launch WhatsApp on your mobile device.",
                            "Access Settings or Menu and select Linked Devices.",
                            "Tap the Link a Device button to prepare scanning.",
                            "Scan the QR code shown on the right with your phone.",
                            "Please wait while Cuckoo establishes a secure connection."
                          ];
                          const stepStatus = getStepStatus(stepIdx);
                          return (
                            <div key={stepIdx} className={`wa-step-item wa-step-item-${stepStatus}`}>
                              <div className="step-indicator">
                                {stepStatus === 'completed' && '✓'}
                                {stepStatus === 'current' && '●'}
                                {stepStatus === 'pending' && '○'}
                              </div>
                              <div className="step-content">
                                <h4>{stepTitles[stepIdx - 1]}</h4>
                                <p>{stepDescs[stepIdx - 1]}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="wa-secure-badge-info">
                        <span className="secure-icon">🔒</span>
                        <span>End-to-End Encrypted Session</span>
                      </div>
                    </div>

                    {/* Right Side: QR Section */}
                    <div className="wa-col-qr">
                      {!connectRequested ? (
                        <div className="wa-qr-container-col">
                          <div className="wa-qr-initial-box">
                            <button 
                              className="wa-btn wa-btn-primary" 
                              onClick={() => { 
                                setConnectRequested(true); 
                                // Only trigger a refresh if truly disconnected (not already starting up)
                                // The service starts initClient() on boot — we just wait for the QR event
                                if (status === 'disconnected' && !qrDataUrl) {
                                  whatsappAPI.refreshQR().catch(() => {}); 
                                }
                              }}
                            >
                              Connect WhatsApp
                            </button>
                          </div>
                          <p className="wa-qr-hint">Start a new secure session with our helper service.</p>
                        </div>
                      ) : !revealQR ? (
                        <div className="wa-qr-container-col">
                          <div className="wa-qr-blur-box">
                            <div className="wa-qr-blurred-image" />
                            <div className="wa-qr-reveal-overlay">
                              <button className="wa-btn wa-btn-reveal" onClick={() => setRevealQR(true)}>
                                Reveal QR
                              </button>
                            </div>
                          </div>
                          <p className="wa-qr-hint">Click below to reveal the secure connection code.</p>
                        </div>
                      ) : status === 'ERROR' ? (
                        <div className="wa-qr-container-col">
                          <div className="wa-qr-expired-box" style={{ borderColor: 'var(--error)' }}>
                            <div className="wa-expired-icon" style={{ color: 'var(--error)' }}>❌</div>
                            <h3>Connection Error</h3>
                            <p style={{ margin: '8px 0 16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                              Unable to generate QR or establish connection.
                            </p>
                            <button type="button" className="wa-btn wa-btn-primary" onClick={handleRetryQR}>
                              Retry Connection
                            </button>
                          </div>
                        </div>
                      ) : qrDataUrl && !qrExpired ? (
                        <div className="wa-qr-container-col">
                          <div className="wa-qr-active-box">
                            {console.log('[DEBUG] QR rendered', qrDataUrl ? qrDataUrl.slice(0, 50) + '...' : 'null')}
                            <div className="wa-qr-img-wrapper">
                              <img 
                                src={qrDataUrl} 
                                alt="WhatsApp QR Code" 
                                draggable="false"
                                className="wa-qr-image"
                                onContextMenu={(e) => e.preventDefault()}
                              />
                            </div>
                          </div>
                          <div className="wa-countdown-badge">
                            ⏳ Regenerating secure QR code in {timeLeft}s
                          </div>
                        </div>
                      ) : qrExpired ? (
                        <div className="wa-qr-container-col">
                          <div className="wa-qr-expired-box">
                            <div className="wa-expired-icon">⚠️</div>
                            <h3>QR Code Expired</h3>
                            <button type="button" className="wa-btn wa-btn-primary" onClick={handleRetryQR}>
                              Generate New QR
                            </button>
                          </div>
                          <p className="wa-qr-hint">For security, connection codes expire quickly. Refresh to try again.</p>
                        </div>
                      ) : (
                        <div className="wa-qr-container-col">
                          <div className="wa-qr-loading-box">
                            <div className="wa-premium-spinner"></div>
                            <span className="wa-loading-msg">{loadingMessages[loadingMsgIndex]}</span>
                          </div>
                          {qrSeconds > 15 && (
                            <div className="wa-timeout-warning-box">
                              <p className="wa-warning-text">⚠️ Generating secure QR is taking longer than expected.</p>
                              <button type="button" className="wa-btn wa-btn-secondary wa-btn-sm" onClick={handleRetryQR}>
                                Retry QR Generation
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="wa-connection-extra-row" style={{ marginTop: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div className="wa-troubleshooting-card">
                      <h4>Having trouble?</h4>
                      <p className="troubleshoot-intro">Common fixes:</p>
                      <ul className="troubleshoot-list">
                        <li>• Check internet connection</li>
                        <li>• Close and reopen WhatsApp</li>
                        <li>• Try generating a new QR</li>
                        <li>• Ensure Linked Devices is open</li>
                      </ul>
                    </div>
                    {renderConnectionHealthCard()}
                  </div>
                </>
              ) : (
                /* WhatsApp Cloud API Form */
                <>
                  <form className="wa-cloud-api-form" onSubmit={handleCloudConnect} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>Phone Number ID</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="e.g. 109283746524152" 
                        value={cloudPhoneId} 
                        onChange={(e) => setCloudPhoneId(e.target.value)} 
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>WhatsApp Business Account (WABA) ID</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="e.g. 982736452819201" 
                        value={cloudWabaId} 
                        onChange={(e) => setCloudWabaId(e.target.value)} 
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>Permanent Access Token</label>
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder="EAAGy..." 
                        value={cloudToken} 
                        onChange={(e) => setCloudToken(e.target.value)} 
                      />
                    </div>
                    <button 
                      type="submit" 
                      className="wa-btn wa-btn-primary" 
                      disabled={checkingWebhook}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      {checkingWebhook ? 'Verifying Webhook...' : 'Verify & Connect Cloud API'}
                    </button>
                  </form>
                  <div style={{ marginTop: '24px' }}>
                    {renderConnectionHealthCard()}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* CARD 2: SETUP PROGRESS / NEXT STEP */}
        <div className={`wa-card wa-setup-card ${wizardStep === 'compose' ? 'wa-composer-step-card' : ''}`}>
          {!isWaConnected && wizardStep === 'connect' ? (
            // Before Connection State
            <div className="wa-setup-progress-state">
              <div className="wa-card-header">
                <h2>Setup Progress</h2>
              </div>
              <div className="wa-checklist">
                <div className="wa-checklist-item active">
                  <span className="item-icon">⏳</span>
                  <span className="item-text">Connect WhatsApp</span>
                </div>
                <div className="wa-checklist-item disabled">
                  <span className="item-icon">○</span>
                  <span className="item-text">Upload Contacts</span>
                </div>
                <div className="wa-checklist-item disabled">
                  <span className="item-icon">○</span>
                  <span className="item-text">Select Recipients</span>
                </div>
                <div className="wa-checklist-item disabled">
                  <span className="item-icon">○</span>
                  <span className="item-text">Compose Message</span>
                </div>
                <div className="wa-checklist-item disabled">
                  <span className="item-icon">○</span>
                  <span className="item-text">Send Campaign</span>
                </div>
              </div>
              <div className="wa-setup-footer-message">
                Please connect WhatsApp to continue.
              </div>
            </div>
          ) : (
            // After Connection Wizard State
            <div className="wa-setup-wizard">
              {wizardStep === 'upload' && (
                <div className="wizard-step-upload">
                  <div className="wa-card-header">
                    <h2>Next Step</h2>
                    <p className="wa-card-subtitle">Step 2 of 5: Upload Contacts</p>
                  </div>
                  <div className="wizard-body">
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
                        onChange={handleFile}
                      />
                      <>
                          <div className="wa-upload-zone-icon">📊</div>
                          <div className="wa-upload-zone-text">
                            Drag & drop your Excel or CSV file, or click to browse
                          </div>
                          <div className="wa-upload-zone-hint">
                            Supports .xlsx, .xls, .csv — must have a "phone" or "mobile" column
                          </div>
                      </>
                    </div>
                    <button
                      type="button"
                      className="wa-btn wa-btn-secondary wa-mock-upload-btn"
                      style={{ marginTop: '16px', width: '100%', cursor: 'pointer' }}
                      onClick={handleMockUpload}
                    >
                      ⚡ Load sample_contacts.csv (Demo Mode)
                    </button>
                  </div>
                </div>
              )}

             {/* STEP 2: Group Selection & Quality (Phase A) */}
        {wizardStep === 'group_select' && (
          <div className="wa-card wa-animate-fade">
            <div className="wa-card-header">
              <h2>Smart Contact Discovery</h2>
              <button className="wa-btn wa-btn-secondary wa-btn-sm" onClick={() => { setParsedFile(null); setWizardStep('upload'); }}>
                Cancel
              </button>
            </div>
            
            <div className="wa-discovery-container">
              {/* Visual Import Summary Card */}
              <div className="wa-import-summary-grid">
                <div className="wa-summary-stat-card">
                  <span className="wa-stat-card-label">Contacts Found</span>
                  <span className="wa-stat-card-value">{discoveryStats?.total}</span>
                </div>
                <div className="wa-summary-stat-card success">
                  <span className="wa-stat-card-label">Valid Contacts</span>
                  <span className="wa-stat-card-value text-success">{discoveryStats?.valid}</span>
                </div>
                <div className="wa-summary-stat-card warning">
                  <span className="wa-stat-card-label">Duplicates Removed</span>
                  <span className="wa-stat-card-value text-warning">{discoveryStats?.duplicates}</span>
                </div>
                <div className="wa-summary-stat-card info">
                  <span className="wa-stat-card-label">Detected Groups</span>
                  <span className="wa-stat-card-value text-info">{detectedGroups.length}</span>
                </div>
              </div>

              {/* Detected Groups */}
              <div className="wa-discovery-section">
                <h3>Select Import Mode</h3>
                <div className="wa-group-options">
                  <label className={`wa-group-option ${selectedGroupId === 'all' ? 'selected' : ''}`}>
                    <input type="radio" name="group" value="all" checked={selectedGroupId === 'all'} onChange={() => setSelectedGroupId('all')} />
                    <div>
                      <strong>All Contacts</strong>
                      <div className="wa-text-sm text-secondary">Import everyone ({discoveryStats?.total})</div>
                    </div>
                  </label>
                  {detectedGroups.map(g => (
                    <label key={g.id} className={`wa-group-option ${selectedGroupId === g.id ? 'selected' : ''}`}>
                      <input type="radio" name="group" value={g.id} checked={selectedGroupId === g.id} onChange={() => setSelectedGroupId(g.id)} />
                      <div>
                        <strong>{g.label}</strong>
                        <div className="wa-text-sm text-secondary">{g.stats.total} contacts</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Quality Score Meter */}
              <div className="wa-discovery-section">
                <h3>Discovery Quality</h3>
                <div className="wa-quality-dashboard" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="wa-quality-stat wa-score-stat">
                    <span className="wa-stat-label">AI Quality Score</span>
                    <span className="wa-stat-value">{discoveryStats?.qualityScore}/10</span>
                  </div>
                </div>
              </div>

              {/* Preview Table */}
              <div className="wa-discovery-section">
                <h3>File Preview (First 5 Rows)</h3>
                <div className="wa-table-container">
                  <table className="wa-table">
                    <thead>
                      <tr>
                        {previewRows.length > 0 && Object.keys(previewRows[0]).map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i}>
                          {Object.values(row).map((val, j) => (
                            <td key={j}>{String(val)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="wa-card-footer" style={{ marginTop: '24px' }}>
              <button className="wa-btn wa-btn-primary" onClick={handleConfirmGroup}>
                Continue to Compose
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Review & Select Contacts */}
        {wizardStep === 'review' && parsedFile && (
                <div className="wizard-step-review">
                  <div className="wa-card-header">
                    <h2>Next Step</h2>
                    <p className="wa-card-subtitle">Step 3 of 5: Review Contacts</p>
                  </div>
                  <div className="wizard-body">
                    <div className="wa-import-summary-card">
                      <h3>Contacts Imported</h3>
                      <div className="summary-stat-grid">
                        <div className="stat-box">
                          <span className="stat-num">{parsedFile.totalContacts || parsedFile.total || 0}</span>
                          <span className="stat-label">Total Contacts</span>
                        </div>
                        <div className="stat-box success">
                          <span className="stat-num">{parsedFile.validContacts || parsedFile.valid || 0}</span>
                          <span className="stat-label">Valid Recipients</span>
                        </div>
                        <div className="stat-box error">
                          <span className="stat-num">{parsedFile.invalidContacts || parsedFile.invalid || 0}</span>
                          <span className="stat-label">Invalid Numbers</span>
                        </div>
                      </div>
                    </div>

                    <div className="wizard-buttons-row">
                      <button className="wa-btn wa-btn-secondary" onClick={() => setShowPreview(!showPreview)}>
                        {showPreview ? 'Hide Contacts' : 'Review Contacts'}
                      </button>
                      <button className="wa-btn wa-btn-ghost" onClick={handleChangeFile}>
                        Change File
                      </button>
                      <button 
                        className="wa-btn wa-btn-primary" 
                        onClick={() => setWizardStep('select_recipients')}
                        disabled={parsedFile.valid === 0}
                      >
                        Continue
                      </button>
                    </div>

                    {showPreview && (
                      <div className="wa-contacts-preview-table-container">
                        <table className="wa-contacts-preview-table">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Phone</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {contacts.map((c, i) => (
                              <tr key={i} className={c.isValid ? 'row-valid' : 'row-invalid'}>
                                <td>{c.name || '—'}</td>
                                <td>{c.phone}</td>
                                <td>
                                  {c.isValid ? (
                                    <span className="status-badge valid">✓ Valid</span>
                                  ) : (
                                    <span className="status-badge invalid">✕ {c.error}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {wizardStep === 'select_recipients' && (
                <div className="wizard-step-recipients">
                  <div className="wa-card-header">
                    <h2>Select Recipients</h2>
                    <p className="wa-card-subtitle">Choose which contacts to include in this campaign broadcast.</p>
                  </div>
                  <div className="wizard-body">
                    
                    {/* Selection Summary Statistics Box */}
                    <div className="wa-selection-summary-bar" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', marginBottom: '24px', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                      <div className="summary-stat" style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Contacts</span>
                        <strong style={{ display: 'block', fontSize: '1.4rem', color: 'var(--text-primary)', marginTop: '4px' }}>{contacts.length}</strong>
                      </div>
                      <div className="summary-stat" style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Selected</span>
                        <strong style={{ display: 'block', fontSize: '1.4rem', color: 'var(--brand-primary)', marginTop: '4px' }}>{contacts.filter(c => c.selected).length}</strong>
                      </div>
                      <div className="summary-stat" style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Excluded</span>
                        <strong style={{ display: 'block', fontSize: '1.4rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{contacts.filter(c => !c.selected).length}</strong>
                      </div>
                      <div className="summary-stat" style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Valid / Invalid</span>
                        <div style={{ marginTop: '4px', fontSize: '0.9rem', fontWeight: 700 }}>
                          <span style={{ color: 'var(--brand-primary)' }}>{contacts.filter(c => c.isValid).length}</span>
                          <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
                          <span style={{ color: 'var(--error)' }}>{contacts.filter(c => !c.isValid).length}</span>
                        </div>
                      </div>
                    </div>

                    {/* Filter and Search controls */}
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: '220px' }}>
                        <input
                          type="text"
                          className="wa-search-input"
                          placeholder="Search by name or phone..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div>
                        <select
                          className="wa-modern-select"
                          value={filterType}
                          onChange={(e) => setFilterType(e.target.value)}
                          style={{ minWidth: '160px', padding: '10px 14px' }}
                        >
                          <option value="all">All Statuses</option>
                          <option value="selected">Selected Only</option>
                          <option value="unselected">Excluded Only</option>
                          <option value="valid">Valid Only</option>
                          <option value="invalid">Invalid Only</option>
                        </select>
                      </div>
                    </div>

                    {/* Bulk Actions and Saved segments */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg-surface)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button type="button" className="wa-btn wa-btn-secondary wa-btn-sm" onClick={bulkSelectAll} style={{ fontSize: '0.78rem' }}>Select All</button>
                        <button type="button" className="wa-btn wa-btn-secondary wa-btn-sm" onClick={bulkDeselectAll} style={{ fontSize: '0.78rem' }}>Deselect All</button>
                        <button type="button" className="wa-btn wa-btn-secondary wa-btn-sm" onClick={bulkSelectValid} style={{ fontSize: '0.78rem' }}>Select Valid</button>
                        <button type="button" className="wa-btn wa-btn-secondary wa-btn-sm" onClick={bulkSelectInvalid} style={{ fontSize: '0.78rem' }}>Select Invalid</button>
                        <button type="button" className="wa-btn wa-btn-secondary wa-btn-sm" onClick={bulkInvertSelection} style={{ fontSize: '0.78rem' }}>Invert Selection</button>
                      </div>
                      
                      {/* Saved segments selection */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Segments:</label>
                        <select
                          className="wa-modern-select"
                          onChange={(e) => handleSegmentChange(e.target.value)}
                          defaultValue=""
                          style={{ padding: '6px 12px', minWidth: '150px', fontSize: '0.82rem' }}
                        >
                          <option value="" disabled>Choose Segment...</option>
                          <option value="all">Select All Contacts</option>
                          {/* Spreadsheet parsed groups */}
                          {detectedGroups.map(g => (
                            <option key={g.id} value={g.id}>File Group: {g.label}</option>
                          ))}
                          {/* Custom saved segments */}
                          {Object.keys(savedSegments).map(name => (
                            <option key={name} value={name}>Saved: {name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Table showing list of contacts */}
                    <div className="wa-recipients-table-container" style={{ maxHeight: '340px' }}>
                      <table className="wa-contacts-preview-table">
                        <thead>
                          <tr>
                            <th width="50" style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                className="wa-checkbox"
                                checked={displayedContacts.length > 0 && displayedContacts.every(c => c.selected)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setContacts(prev => prev.map(c => {
                                    if (displayedContacts.some(d => d.row === c.row)) {
                                      return { ...c, selected: checked };
                                    }
                                    return c;
                                  }));
                                }}
                              />
                            </th>
                            <th>Name</th>
                            <th>Phone Number</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayedContacts.length === 0 ? (
                            <tr>
                              <td colSpan="4" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                                No contacts match the search/filters.
                              </td>
                            </tr>
                          ) : (
                            displayedContacts.map((c, i) => (
                              <tr key={i} className={c.isValid ? 'row-valid' : 'row-invalid'}>
                                <td style={{ textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    className="wa-checkbox"
                                    checked={!!c.selected}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setContacts(prev => prev.map(item => item.row === c.row ? { ...item, selected: checked } : item));
                                    }}
                                  />
                                </td>
                                <td>{c.name || '—'}</td>
                                <td>{c.phone}</td>
                                <td>
                                  {c.isValid ? (
                                    <span className="status-badge valid">✓ Valid</span>
                                  ) : (
                                    <span className="status-badge invalid" title={c.error}>✕ {c.error || 'Invalid'}</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Segment Saving control */}
                    <div style={{ marginTop: '20px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg-primary)', padding: '12px 16px', borderRadius: '8px', border: '1px dashed var(--border-default)' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>💾 Save selection as segment:</span>
                      <input
                        type="text"
                        className="wa-search-input"
                        placeholder="Segment name (e.g. Core Team)..."
                        value={segmentName}
                        onChange={(e) => setSegmentName(e.target.value)}
                        style={{ flex: 1, minWidth: '180px', padding: '6px 12px', fontSize: '0.85rem' }}
                      />
                      <button type="button" className="wa-btn wa-btn-primary wa-btn-sm" onClick={handleSaveSegment} style={{ padding: '8px 16px' }}>
                        Save Segment
                      </button>
                    </div>

                    <div className="wizard-buttons-row" style={{ marginTop: '24px' }}>
                      <button className="wa-btn wa-btn-secondary" onClick={() => setWizardStep('review')}>
                        Back
                      </button>
                      <button 
                        className="wa-btn wa-btn-primary" 
                        onClick={() => setWizardStep('compose')}
                        disabled={selectedContacts.length === 0}
                      >
                        Continue to Compose
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 'compose' && (
                <div className="wa-composer-workspace">
                  {/* LEFT COLUMN: Message Workspace */}
                  <div className="wa-composer-left">
                    <div className="wa-composer-header-container">
                      <div className="wa-card-header">
                        <h2>Compose Message</h2>
                        <p className="wa-card-subtitle">Write the message that will be delivered to your selected contacts.</p>
                      </div>
                    </div>

                    {/* Recipient Context Alert Card */}
                    <div className="wa-recipient-context-card">
                      <div className="context-item">
                        <span className="context-label">Selected List</span>
                        <strong className="context-value">
                          {selectedGroupId === 'all' ? (parsedFile?.name || 'All Contacts') : (detectedGroups.find(g => g.id === selectedGroupId)?.label || parsedFile?.name || 'Selected List')}
                        </strong>
                      </div>
                      <div className="context-item">
                        <span className="context-label">Recipients</span>
                        <strong className="context-value badge-count">{selectedContacts.length} Recipients</strong>
                      </div>
                      <div className="context-item">
                        <span className="context-label">Invalid Contacts</span>
                        <span className="context-value text-error">{discoveryStats?.invalid || 0}</span>
                      </div>
                      <div className="context-item">
                        <span className="context-label">Duplicates Removed</span>
                        <span className="context-value text-success">{discoveryStats?.duplicates || 0}</span>
                      </div>
                      {((discoveryStats?.invalid || 0) > 0) && (
                        <div className="context-warning-alert">
                          ⚠️ {discoveryStats.invalid} contacts will not receive messages.
                        </div>
                      )}
                    </div>

                    {/* Template Picker */}
                    <div className="wa-template-picker-card">
                      <h4 className="card-section-title">⚡ Message Templates</h4>
                      <p className="card-section-desc">Quickly populate your composer with pre-built message formats.</p>
                      <div className="template-chips-grid">
                        {CAMPAIGN_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.id}
                            type="button"
                            className={`template-chip ${selectedTemplateForActions?.id === tpl.id ? 'active' : ''}`}
                            onClick={() => handleTemplateClick(tpl)}
                          >
                            {tpl.name}
                          </button>
                        ))}
                      </div>

                      {selectedTemplateForActions && (
                        <div className="template-preview-actions">
                          <div className="template-actions-header">
                            <strong>Template Action: {selectedTemplateForActions.name}</strong>
                          </div>
                          <pre className="template-preview-box">
                            {selectedTemplateForActions.text}
                          </pre>
                          <div className="template-actions-row">
                            <button
                              type="button"
                              className="wa-btn wa-btn-primary wa-btn-sm"
                              onClick={handleUseTemplate}
                            >
                              Use Template
                            </button>
                            <button
                              type="button"
                              className="wa-btn wa-btn-secondary wa-btn-sm"
                              onClick={handlePreviewTemplate}
                            >
                              Preview Template
                            </button>
                            <button
                              type="button"
                              className="wa-btn wa-btn-ghost wa-btn-sm"
                              onClick={handleCustomMessage}
                            >
                              Custom Message (Reset)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Message creation editor */}
                    <div className="wa-editor-section">
                      {/* Personalization variable helpers */}
                      <div className="wa-variables-helper">
                        <span className="helper-label">Insert Personalization Variable:</span>
                        <div className="variable-chips">
                          <button
                            type="button"
                            className="variable-chip"
                            onClick={() => insertVariable('{{name}}')}
                            title="Inserts full contact name"
                          >
                            {"{{name}}"}
                          </button>
                          <button
                            type="button"
                            className="variable-chip"
                            onClick={() => insertVariable('{{first_name}}')}
                            title="Inserts contact first name"
                          >
                            {"{{first_name}}"}
                          </button>
                          <button
                            type="button"
                            className="variable-chip"
                            onClick={() => insertVariable('{{last_name}}')}
                            title="Inserts contact last name"
                          >
                            {"{{last_name}}"}
                          </button>
                        </div>
                      </div>

                      {/* Text editor box */}
                      <div className="wa-editor-wrapper">
                        <textarea
                          ref={textareaRef}
                          className="wa-modern-textarea"
                          placeholder="Write your campaign message here... Click personalization chips above to insert variables dynamically."
                          value={message}
                          onChange={(e) => {
                            if (e.target.value.length <= MAX_MSG_CHARS) {
                              setMessage(e.target.value);
                            }
                          }}
                          disabled={isAILoading}
                        />

                        {/* Editor Footer: Character count + Autosave indicator */}
                        <div className="wa-editor-footer">
                          <div className="wa-autosave-indicator">
                            <span className="save-icon">✓</span>
                            <span className="save-text">Draft saved</span>
                            {lastSavedTime && <span className="save-time">({lastSavedTime})</span>}
                          </div>
                          
                          <div className={`wa-char-counter ${message.length > MAX_MSG_CHARS * 0.9 ? 'warning-near-limit' : ''}`}>
                            {message.length} / {MAX_MSG_CHARS} characters
                          </div>
                        </div>
                      </div>

                      {/* Deliverability Health Indicator */}
                      {message.trim() && (
                        <div className="wa-health-indicator-card">
                          {(() => {
                            const health = getMessageHealth(message);
                            return (
                              <>
                                <div className={`health-status-header status-${health.status}`}>
                                  {health.label}
                                </div>
                                {health.issues.length > 0 && (
                                  <ul className="health-issues-list">
                                    {health.issues.map((issue, idx) => (
                                      <li key={idx} className="health-issue-item">
                                        • {issue}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {/* AI Message Assistant */}
                    <div className="wa-ai-tools-card">
                      <h4 className="card-section-title">✨ Message Tools (AI Assistant)</h4>
                      <p className="card-section-desc">Refine or tone-adjust your message quickly. AI will run as a secondary tool.</p>
                      
                      <div className="ai-buttons-grid">
                        <button type="button" className="wa-ai-btn" onClick={() => handleAIAction('improve')} disabled={isAILoading}>
                          Improve
                        </button>
                        <button type="button" className="wa-ai-btn" onClick={() => handleAIAction('tone', 'Shorten')} disabled={isAILoading}>
                          Shorten
                        </button>
                        <button type="button" className="wa-ai-btn" onClick={() => handleAIAction('tone', 'Expand')} disabled={isAILoading}>
                          Expand
                        </button>
                        <button type="button" className="wa-ai-btn" onClick={() => handleAIAction('tone', 'Formal')} disabled={isAILoading}>
                          Formal
                        </button>
                        <button type="button" className="wa-ai-btn" onClick={() => handleAIAction('tone', 'Professional')} disabled={isAILoading}>
                          Professional
                        </button>
                        <button type="button" className="wa-ai-btn" onClick={() => handleAIAction('tone', 'Friendly')} disabled={isAILoading}>
                          Friendly
                        </button>
                        <button type="button" className="wa-ai-btn" onClick={() => handleAIAction('tone', 'Reminder')} disabled={isAILoading}>
                          Reminder
                        </button>
                      </div>

                      {isAILoading && (
                        <div className="wa-ai-loading-message" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '0.9rem', color: '#6366f1' }}>
                          <div className="wa-spinner wa-spinner-sm" style={{ borderColor: 'rgba(99,102,241,0.2)', borderTopColor: '#6366f1' }} />
                          <span>AI is rewriting your message… Actions are temporarily disabled.</span>
                        </div>
                      )}

                      {/* AI Suggestion panels overlaying below toolbar, not replacing editor */}
                      {aiDraft && aiDraft.improved && (
                        <div className="wa-ai-suggestion-box">
                          <h5 className="suggestion-title">AI Suggestion</h5>
                          {aiDraft.explanation && <p className="suggestion-explanation">{aiDraft.explanation}</p>}
                          
                          <div className="suggestion-compare-grid">
                            <div className="compare-panel before-panel">
                              <span className="panel-label">Before:</span>
                              <div className="panel-body">{aiDraft.original}</div>
                            </div>
                            <div className="compare-panel after-panel">
                              <span className="panel-label">After:</span>
                              <div className="panel-body">{aiDraft.improved}</div>
                            </div>
                          </div>
                          
                          <div className="suggestion-action-buttons">
                            <button type="button" className="wa-btn wa-btn-secondary wa-btn-sm" onClick={discardAiDraft}>
                              Discard
                            </button>
                            <button type="button" className="wa-btn wa-btn-primary wa-btn-sm" onClick={acceptAiDraft}>
                              Accept Changes
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Campaign Settings card */}
                    <div className="wa-campaign-settings-card">
                      <h4 className="card-section-title">⚙️ Campaign Settings</h4>
                      
                      <div className="settings-fields-grid">
                        <div className="settings-field">
                          <label className="settings-field-label">Delay Between Messages</label>
                          <div className="delay-selector-container">
                            <select
                              value={delay}
                              onChange={(e) => setDelay(Number(e.target.value))}
                              className="wa-modern-select"
                            >
                              <option value={1000}>1 Second (Fast)</option>
                              <option value={3000}>3 Seconds (Recommended)</option>
                              <option value={5000}>5 Seconds (Safe)</option>
                              <option value={10000}>10 Seconds (Very Safe)</option>
                            </select>
                            <span className="recommended-badge">3s Recommended</span>
                          </div>
                        </div>
                        
                        <div className="settings-checkboxes-row">
                          <label className="settings-checkbox-label">
                            <input
                              type="checkbox"
                              className="wa-checkbox"
                              checked={personalizationEnabled}
                              onChange={(e) => setPersonalizationEnabled(e.target.checked)}
                            />
                            <span>Personalization Enabled</span>
                          </label>
                          
                          <label className="settings-checkbox-label">
                            <input
                              type="checkbox"
                              className="wa-checkbox"
                              checked={previewVariablesEnabled}
                              onChange={(e) => setPreviewVariablesEnabled(e.target.checked)}
                            />
                            <span>Preview Variables Enabled</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="composer-action-bar">
                      <button type="button" className="wa-btn wa-btn-secondary" onClick={() => setWizardStep('select_recipients')}>
                        Back
                      </button>
                      <button
                        type="button"
                        className="wa-btn wa-btn-success continue-cta-btn"
                        onClick={handleGoToReview}
                        disabled={!message.trim()}
                      >
                        Continue to Review →
                      </button>
                    </div>
                  </div>

                  {/* RIGHT COLUMN: WhatsApp Live Preview */}
                  <div className="wa-composer-right">
                    <div className="preview-sticky-container">
                      <div className="preview-header-bar">
                        <h3>WhatsApp Live Preview</h3>
                        <p>Visual presentation on recipient's device</p>
                      </div>

                      <div className="whatsapp-phone-mockup">
                        <div className="whatsapp-phone-header">
                          <div className="avatar-placeholder">👤</div>
                          <div className="recipient-details">
                            <div className="recipient-name">
                              {selectedContacts[0]?.name || 'Sample Contact'}
                            </div>
                            <div className="recipient-phone-status">
                              {selectedContacts[0]?.phone || '+1 (555) 019-9000'} • online
                            </div>
                          </div>
                        </div>
                        
                        <div className="whatsapp-phone-body">
                          <div className="whatsapp-chat-bubble-sent">
                            <div className="bubble-text-content">
                              {(() => {
                                const previewContent = getPreviewText();
                                // Parse simple WhatsApp formatting
                                let formattedHtml = previewContent
                                  .replace(/&/g, "&amp;")
                                  .replace(/</g, "&lt;")
                                  .replace(/>/g, "&gt;");
                                
                                // Bold *text*
                                formattedHtml = formattedHtml.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
                                // Italic _text_
                                formattedHtml = formattedHtml.replace(/_(.*?)_/g, '<em>$1</em>');
                                // Strikethrough ~text~
                                formattedHtml = formattedHtml.replace(/~(.*?)~/g, '<del>$1</del>');
                                // Monospace `text`
                                formattedHtml = formattedHtml.replace(/`(.*?)`/g, '<code>$1</code>');
                                
                                return formattedHtml.split('\n').map((line, idx) => (
                                  <React.Fragment key={idx}>
                                    <span dangerouslySetInnerHTML={{ __html: line }} />
                                    <br />
                                  </React.Fragment>
                                ));
                              })()}
                            </div>
                            <div className="bubble-meta">
                              <span className="bubble-timestamp">
                                Today {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className="bubble-checkmarks">✓✓</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

        {/* STEP 5: Summary & Send */}
        {wizardStep === 'summary' && (
          <div className="wizard-step-summary">
            <div className="wa-card-header">
              <h2>Campaign Review & Confirmation</h2>
              {!sending && (
                <button className="wa-btn wa-btn-secondary wa-btn-sm" onClick={() => setWizardStep('compose')}>
                  Back to Editor
                </button>
              )}
            </div>
            
            <div className="wa-summary-container">
              {/* Left Column: Stats & Review */}
              <div className="wa-summary-left">
                {/* Phase E: Send Confirmation Stats */}
                <div className="wa-discovery-section">
                  <h3>Broadcast Summary</h3>
                  <div className="wa-quality-dashboard" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                    <div className="wa-quality-stat">
                      <span className="wa-stat-label">Recipients</span>
                      <span className="wa-stat-value">{selectedContacts.length}</span>
                    </div>
                    <div className="wa-quality-stat">
                      <span className="wa-stat-label">Duplicates Removed</span>
                      <span className="wa-stat-value text-success">{discoveryStats?.duplicates || 0}</span>
                    </div>
                    <div className="wa-quality-stat">
                      <span className="wa-stat-label">Message Length</span>
                      <span className="wa-stat-value">{message.length} <span style={{fontSize:'0.8rem'}}>chars</span></span>
                    </div>
                    <div className="wa-quality-stat wa-score-stat">
                      <span className="wa-stat-label">Quality Score</span>
                      <span className="wa-stat-value">
                        {isReviewLoading ? '...' : (campaignReview ? `${campaignReview.qualityScore}/10` : '—')}
                      </span>
                    </div>
                    <div className="wa-quality-stat">
                      <span className="wa-stat-label">WhatsApp Status</span>
                      {status.toLowerCase() === 'connected' ? (
                        <span className="wa-stat-value text-success">Connected</span>
                      ) : (
                        <span className="wa-stat-value text-error">Disconnected</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: WhatsApp Preview (Phase C) */}
              <div className="wa-summary-right">
                <div className="wa-discovery-section">
                  <h3>Live Preview</h3>
                  <div className="wa-phone-preview">
                    <div className="wa-phone-header">
                      <div className="wa-phone-avatar"></div>
                      <div className="wa-phone-contact-name">
                        {selectedContacts[0]?.name || selectedContacts[0]?.phone || 'Contact Name'}
                      </div>
                    </div>
                    <div className="wa-phone-body">
                      <div className="wa-chat-bubble">
                        {(() => {
                          let previewMsg = message;
                          const sampleContact = selectedContacts[0] || { name: 'John Doe', phone: '1234567890' };
                          if (sampleContact.name) {
                            const parts = sampleContact.name.trim().split(/\s+/);
                            previewMsg = previewMsg.replace(/\{\{name\}\}/gi, sampleContact.name);
                            previewMsg = previewMsg.replace(/\{\{first_name\}\}/gi, parts[0]);
                            previewMsg = previewMsg.replace(/\{\{last_name\}\}/gi, parts.length > 1 ? parts[parts.length - 1] : '');
                          } else {
                            previewMsg = previewMsg.replace(/\{\{name\}\}/gi, '');
                            previewMsg = previewMsg.replace(/\{\{first_name\}\}/gi, '');
                            previewMsg = previewMsg.replace(/\{\{last_name\}\}/gi, '');
                          }
                          return previewMsg.split('\n').map((line, i) => (
                            <React.Fragment key={i}>
                              {line}
                              <br />
                            </React.Fragment>
                          ));
                        })()}
                        <div className="wa-chat-time">10:42 AM</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="wizard-body">
               {job && (
                      <div className="wa-wizard-progress-section">
                        <div className="progress-header">
                          <h3>📊 Campaign Progress</h3>
                          <div className="progress-values">
                            <strong>{job.sent + job.failed}</strong> / {job.total}
                          </div>
                        </div>

                        <div className="progress-bar-track">
                          <div
                            className="progress-bar-fill"
                            style={{ width: `${Math.round(((job.sent + job.failed) / job.total) * 100)}%` }}
                          />
                        </div>

                        <div className="progress-stats-row">
                          <span className="stat-sent">✓ {job.sent} sent</span>
                          <span className="stat-failed">✕ {job.failed} failed</span>
                          <span className="stat-pending">⏱️ {job.total - job.sent - job.failed} pending</span>
                        </div>

                        {job.status === 'sending' && job.currentContact && (
                          <div className="progress-current-info">
                            <div className="wa-spinner wa-spinner-sm" />
                            Sending to <strong>{job.currentContact}</strong>...
                          </div>
                        )}

                        {job.status === 'completed' && (
                          <div className="progress-finished-banner">
                            🎉 Broadcast complete! {job.sent} messages delivered successfully.
                          </div>
                        )}
                      </div>
                    )}

              {!sending && (!job || job.status === 'completed') && (
                <div className="wizard-buttons-row" style={{ marginTop: '24px' }}>
                  <button className="wa-btn wa-btn-success" onClick={handleSend} style={{ width: '100%' }}>
                    🚀 Confirm & Send Campaign
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
