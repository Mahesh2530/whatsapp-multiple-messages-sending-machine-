import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { contactsAPI, whatsappAPI } from '../services/api';
import {
  Wifi,
  WifiOff,
  Users,
  Radio,
  MessageSquare,
  RefreshCw,
  CheckCircle2,
  Circle,
  ArrowRight,
  ChevronRight,
  Activity,
  AlertCircle,
  Send,
  Inbox,
  Loader2,
  FileText,
} from 'lucide-react';
import './DashboardPage.css';

// WA_API_KEY is already embedded in waApi interceptors via api.js — no standalone check needed
const WA_API_KEY = import.meta.env.VITE_WA_API_KEY || '';

export default function DashboardPage() {
  const navigate = useNavigate();
  const socketRef = useRef(null);

  const [waStatus, setWaStatus] = useState({ status: 'disconnected', phone: null, lastConnected: null });
  const [lists, setLists] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pollRef = useRef(null);

  const totalContactsCount    = lists.reduce((s, l) => s + (l.valid_contacts || 0), 0);
  const totalDuplicatesCleaned = lists.reduce((s, l) => s + ((l.total_contacts || 0) - (l.valid_contacts || 0)), 0);
  const totalCampaignsCount   = recentJobs.length;
  const totalSent             = recentJobs.reduce((s, j) => s + (j.sent  || 0), 0);
  const totalFailed           = recentJobs.reduce((s, j) => s + (j.failed || 0), 0);

  const loadData = useCallback(async (indicator = false) => {
    if (indicator) setIsRefreshing(true);

    try {
      const r = await whatsappAPI.getStatus();
      setWaStatus(r.data);
    } catch { /* silent */ }

    try {
      const r = await whatsappAPI.getJobs();
      setRecentJobs(r.data.jobs || []);
    } catch { /* silent */ }

    try {
      const r = await contactsAPI.getLists();
      setLists(r.data.lists || []);
    } catch { /* silent */ }

    setDraftMessage(localStorage.getItem('cuckoo-draft-message') || '');
    setLastRefreshed(new Date());
    setLoading(false);
    if (indicator) setTimeout(() => setIsRefreshing(false), 600);
  }, []);

  useEffect(() => {
    loadData();
    pollRef.current = setInterval(() => loadData(), 8000);
    return () => clearInterval(pollRef.current);
  }, [loadData]);

  useEffect(() => {
    const socket = io('http://localhost:3001', {
      auth: { token: WA_API_KEY },
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on('status', ({ status }) => setWaStatus(prev => ({ ...prev, status })));
    socket.on('done', () => loadData());
    socket.on('progress', (data) => {
      setRecentJobs(prev => prev.map(j =>
        j.id === data.jobId
          ? { ...j, sent: data.sent, failed: data.failed, current: data.current, status: 'sending' }
          : j
      ));
    });

    return () => socket.disconnect();
  }, [loadData]);

  // Checklist / step completion
  const connectionMode = localStorage.getItem('cuckoo-connection-mode') || 'web';
  const cloudConnected = localStorage.getItem('cuckoo-cloud-connected') === 'true';
  const isWaConnected   = waStatus.status === 'connected' || (connectionMode === 'cloud' && cloudConnected);
  const isContactsImported = totalContactsCount > 0;
  const isDraftCreated  = draftMessage.trim().length > 0;
  const isCampaignSent  = recentJobs.some(j => j.status === 'completed' || j.status === 'sending');
  const activeJobs      = recentJobs.filter(j => j.status === 'sending');

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('en-IN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const formatTime = (d) =>
    d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

  const StatusBadge = ({ status }) => {
    const map = {
      pending:   { cls: 'badge-pending',  label: 'Pending'   },
      sending:   { cls: 'badge-warning',  label: 'Sending'   },
      completed: { cls: 'badge-success',  label: 'Completed' },
      failed:    { cls: 'badge-error',    label: 'Failed'    },
    };
    const s = map[status] || map.pending;
    return <span className={`badge ${s.cls}`}>{s.label}</span>;
  };

  const steps = [
    {
      label: 'Connect WhatsApp',
      sub: isWaConnected ? (waStatus.phone ? `+${waStatus.phone}` : 'Linked') : 'Pending link',
      done: isWaConnected,
      active: !isWaConnected,
      href: '/broadcast',
    },
    {
      label: 'Import Contacts',
      sub: isContactsImported ? `${totalContactsCount.toLocaleString()} contacts` : 'Pending import',
      done: isContactsImported,
      active: isWaConnected && !isContactsImported,
      href: '/contacts',
    },
    {
      label: 'Compose Draft',
      sub: isDraftCreated ? 'Draft ready' : 'Pending write',
      done: isDraftCreated,
      active: isContactsImported && !isDraftCreated,
      href: '/broadcast',
    },
    {
      label: 'Send Campaign',
      sub: isCampaignSent ? `${totalSent.toLocaleString()} sent` : 'Ready to send',
      done: isCampaignSent,
      active: isDraftCreated && !isCampaignSent,
      href: '/broadcast',
    },
  ];

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <p>Loading your workspace…</p>
      </div>
    );
  }

  return (
    <div className="dashboard-v2">

      {/* ── Top Live Bar ────────────────────────────────────── */}
      <div className="db-live-bar">
        <div className="db-live-bar-left">
          <span className="db-live-pill">
            <span className="db-live-dot" />
            Live
          </span>
          <span className="db-live-text">
            Auto-refreshes every 8s
            {lastRefreshed && (
              <span className="db-live-time"> · {formatTime(lastRefreshed)}</span>
            )}
          </span>
        </div>
        <button
          className="db-refresh-btn"
          onClick={() => loadData(true)}
          disabled={isRefreshing}
        >
          <RefreshCw
            size={14}
            strokeWidth={2}
            className={isRefreshing ? 'db-spin' : ''}
          />
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Active Broadcast Banner ──────────────────────────── */}
      {activeJobs.map(job => (
        <div key={job.id} className="db-sending-banner">
          <div className="db-sending-left">
            <Loader2 size={16} className="db-spin" strokeWidth={2} />
            <div className="db-sending-info">
              <strong>Broadcasting now</strong>
              <span className="db-sending-msg">
                {job.message?.slice(0, 72)}{job.message?.length > 72 ? '…' : ''}
              </span>
            </div>
          </div>
          <div className="db-sending-stats">
            <span className="db-stat-sent">{job.sent} sent</span>
            <span className="db-stat-sep">/</span>
            <span className="db-stat-total">{job.total} total</span>
            {job.failed > 0 && <span className="db-stat-fail">{job.failed} failed</span>}
          </div>
          <div className="db-sending-progress-wrap">
            <div
              className="db-sending-progress-fill"
              style={{ width: `${Math.round(((job.sent + job.failed) / Math.max(job.total, 1)) * 100)}%` }}
            />
          </div>
        </div>
      ))}

      {/* ── Page Header ─────────────────────────────────────── */}
      <div className="db-header">
        <div className="db-header-text">
          <h1 className="db-title">Dashboard</h1>
          <p className="db-subtitle">Monitor your broadcast workspace in real time.</p>
        </div>
        <div className="db-header-status">
          <div className={`db-wa-status-pill ${isWaConnected ? 'wa-connected' : 'wa-disconnected'}`}>
            {isWaConnected
              ? <Wifi size={14} strokeWidth={2} />
              : <WifiOff size={14} strokeWidth={2} />
            }
            <span>{isWaConnected ? 'WhatsApp connected' : 'Not connected'}</span>
          </div>
        </div>
      </div>

      {/* ── Stats Row ───────────────────────────────────────── */}
      <div className="db-stats-row">
        <div className="db-stat-card">
          <div className="db-stat-icon db-stat-icon-blue"><Users size={18} strokeWidth={1.75} /></div>
          <div className="db-stat-body">
            <div className="db-stat-value">{totalContactsCount.toLocaleString()}</div>
            <div className="db-stat-label">Total Contacts</div>
          </div>
        </div>
        <div className="db-stat-card">
          <div className="db-stat-icon db-stat-icon-purple"><Radio size={18} strokeWidth={1.75} /></div>
          <div className="db-stat-body">
            <div className="db-stat-value">{totalCampaignsCount}</div>
            <div className="db-stat-label">Campaigns Run</div>
          </div>
        </div>
        <div className="db-stat-card">
          <div className="db-stat-icon db-stat-icon-green"><Send size={18} strokeWidth={1.75} /></div>
          <div className="db-stat-body">
            <div className="db-stat-value">{totalSent.toLocaleString()}</div>
            <div className="db-stat-label">Messages Sent</div>
          </div>
        </div>
        <div className="db-stat-card">
          <div className="db-stat-icon db-stat-icon-amber"><AlertCircle size={18} strokeWidth={1.75} /></div>
          <div className="db-stat-body">
            <div className="db-stat-value">{totalFailed}</div>
            <div className="db-stat-label">Failed</div>
          </div>
        </div>
        <div className="db-stat-card">
          <div className="db-stat-icon db-stat-icon-slate"><Inbox size={18} strokeWidth={1.75} /></div>
          <div className="db-stat-body">
            <div className="db-stat-value">{totalDuplicatesCleaned}</div>
            <div className="db-stat-label">Duplicates Removed</div>
          </div>
        </div>
      </div>

      {/* ── Workflow Progress ────────────────────────────────── */}
      <div className="db-section">
        <div className="db-section-header">
          <h2 className="db-section-title">Getting Started</h2>
          <p className="db-section-sub">Complete these steps to launch your first campaign.</p>
        </div>
        <div className="db-progress-track">
          {steps.map((step, i) => (
            <div key={i} className="db-step-wrap">
              <div
                className={`db-step ${step.done ? 'step-done' : step.active ? 'step-active' : 'step-future'}`}
                onClick={() => navigate(step.href)}
                role="button"
                tabIndex={0}
              >
                <div className="db-step-icon-wrap">
                  {step.done
                    ? <CheckCircle2 size={20} strokeWidth={2} />
                    : <Circle size={20} strokeWidth={1.75} />
                  }
                  <span className="db-step-num">{i + 1}</span>
                </div>
                <div className="db-step-text">
                  <div className="db-step-label">{step.label}</div>
                  <div className="db-step-sub">{step.sub}</div>
                </div>
                <ChevronRight size={16} strokeWidth={1.75} className="db-step-arrow" />
              </div>
              {i < steps.length - 1 && (
                <div className={`db-step-connector ${step.done ? 'connector-done' : ''}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Split Panels ─────────────────────────────────────── */}
      <div className="db-split">
        {/* Campaigns table */}
        <div className="db-section db-campaigns-section">
          <div className="db-section-header db-section-header-row">
            <div>
              <h2 className="db-section-title">Recent Campaigns</h2>
              <p className="db-section-sub">Latest broadcast activity from this session.</p>
            </div>
            {recentJobs.length > 0 && (
              <button className="db-link-btn" onClick={() => navigate('/campaigns')}>
                All campaigns <ArrowRight size={14} strokeWidth={2} />
              </button>
            )}
          </div>

          {recentJobs.length === 0 ? (
            <div className="db-empty">
              <div className="db-empty-icon"><Activity size={32} strokeWidth={1.5} /></div>
              <div className="db-empty-title">No campaigns yet</div>
              <p className="db-empty-sub">Your broadcast history will appear here once you send your first campaign.</p>
              <button className="btn btn-primary" onClick={() => navigate('/broadcast')}>
                Start broadcasting
              </button>
            </div>
          ) : (
            <div className="db-table-wrap">
              <table className="db-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Sent</th>
                    <th>Failed</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.slice(0, 6).map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => navigate('/campaigns')}
                      className={`db-table-row ${job.status === 'sending' ? 'row-sending' : ''}`}
                    >
                      <td>
                        <div className="db-campaign-name">Campaign #{job.id}</div>
                        <div className="db-campaign-msg">
                          {job.message
                            ? (job.message.length > 60 ? job.message.slice(0, 60) + '…' : job.message)
                            : '—'}
                        </div>
                        {job.status === 'sending' && (
                          <div className="db-inline-progress">
                            <div
                              className="db-inline-fill"
                              style={{ width: `${Math.round(((job.sent + job.failed) / Math.max(job.total, 1)) * 100)}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td><StatusBadge status={job.status} /></td>
                      <td className="db-cell-sent">{job.sent}/{job.total}</td>
                      <td className={job.failed > 0 ? 'db-cell-fail' : 'db-cell-zero'}>{job.failed}</td>
                      <td className="db-cell-date">{formatDate(job.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right panel: Quick actions + WhatsApp card */}
        <div className="db-right-col">
          {/* WhatsApp Connection Card */}
          <div className="db-section db-wa-card">
            <div className="db-section-header">
              <h2 className="db-section-title">WhatsApp</h2>
            </div>
            <div className="db-wa-status-block">
              <div className={`db-wa-icon-wrap ${isWaConnected ? 'wa-icon-connected' : 'wa-icon-disconnected'}`}>
                {isWaConnected
                  ? <Wifi size={22} strokeWidth={1.75} />
                  : <WifiOff size={22} strokeWidth={1.75} />
                }
              </div>
              <div className="db-wa-info">
                <div className="db-wa-label">
                  {waStatus.status === 'initializing' ? 'Initializing…' : isWaConnected ? 'Connected' : 'Not Connected'}
                </div>
                {isWaConnected && waStatus.phone && (
                  <div className="db-wa-phone">+{waStatus.phone}</div>
                )}
                {!isWaConnected && (
                  <div className="db-wa-hint">Scan QR to connect</div>
                )}
              </div>
            </div>
            <button
              className="db-wa-action-btn"
              onClick={() => navigate('/broadcast')}
            >
              {isWaConnected ? 'Manage session' : 'Connect now'}
              <ArrowRight size={14} strokeWidth={2} />
            </button>
          </div>

          {/* Quick Actions Card */}
          <div className="db-section db-actions-card">
            <h2 className="db-section-title">Quick Actions</h2>
            <div className="db-quick-actions">
              <button className="db-quick-action" onClick={() => navigate('/broadcast')}>
                <div className="db-qa-icon"><MessageSquare size={18} strokeWidth={1.75} /></div>
                <div className="db-qa-text">
                  <span className="db-qa-label">New Broadcast</span>
                  <span className="db-qa-sub">Compose and send</span>
                </div>
                <ChevronRight size={16} strokeWidth={1.75} className="db-qa-arrow" />
              </button>
              <button className="db-quick-action" onClick={() => navigate('/contacts')}>
                <div className="db-qa-icon"><Users size={18} strokeWidth={1.75} /></div>
                <div className="db-qa-text">
                  <span className="db-qa-label">Import Contacts</span>
                  <span className="db-qa-sub">Upload CSV or Excel</span>
                </div>
                <ChevronRight size={16} strokeWidth={1.75} className="db-qa-arrow" />
              </button>
              <button className="db-quick-action" onClick={() => navigate('/campaigns')}>
                <div className="db-qa-icon"><FileText size={18} strokeWidth={1.75} /></div>
                <div className="db-qa-text">
                  <span className="db-qa-label">View History</span>
                  <span className="db-qa-sub">Past campaigns</span>
                </div>
                <ChevronRight size={16} strokeWidth={1.75} className="db-qa-arrow" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
