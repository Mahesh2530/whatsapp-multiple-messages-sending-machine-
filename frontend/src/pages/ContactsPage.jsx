import { useState, useEffect, useRef } from 'react';
import { contactsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import './ContactsPage.css';

export default function ContactsPage() {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [listName, setListName] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewingList, setViewingList] = useState(null);
  const [viewContacts, setViewContacts] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const fileInputRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    loadLists();
  }, []);

  const loadLists = async () => {
    try {
      const res = await contactsAPI.getLists();
      setLists(res.data.lists);
    } catch (err) {
      console.error('Load lists error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── File upload handling ─────────────────────────────────────

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      toast.error('Please upload a CSV or Excel (.xlsx, .xls) file');
      return;
    }

    setUploading(true);
    try {
      const res = await contactsAPI.uploadCSV(file);
      setPreviewData(res.data);
      setListName(file.name.replace('.csv', ''));
      toast.success(`Parsed ${res.data.total} contacts (${res.data.valid} valid)`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to parse CSV');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  // ── Download sample CSV template ─────────────────────────────

  const downloadSampleCSV = (e) => {
    e.stopPropagation(); // prevent triggering file upload click
    const sampleData = [
      'name,phone,email',
      'Rahul Sharma,+919876543210,rahul.sharma@example.com',
      'Priya Patel,+919123456789,priya.patel@example.com',
      'Amit Kumar,+918765432109,amit.kumar@example.com',
      'Sneha Gupta,+917654321098,sneha.gupta@example.com',
      'Vikram Singh,+916543210987,vikram.singh@example.com',
    ].join('\n');

    const blob = new Blob([sampleData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sample_contacts.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Sample template downloaded!');
  };

  // ── Save contacts ────────────────────────────────────────────

  const handleSave = async () => {
    if (!listName.trim()) {
      toast.error('Please enter a list name');
      return;
    }

    const validContacts = previewData.contacts.filter((c) => c.is_valid);
    if (validContacts.length === 0) {
      toast.error('No valid contacts to save');
      return;
    }

    setSaving(true);
    try {
      await contactsAPI.saveContacts({
        list_name: listName.trim(),
        contacts: validContacts,
      });
      toast.success(`Saved ${validContacts.length} contacts to "${listName}"`);
      setPreviewData(null);
      setListName('');
      loadLists();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save contacts');
    } finally {
      setSaving(false);
    }
  };

  // ── View list contacts ───────────────────────────────────────

  const handleViewList = async (list) => {
    try {
      const res = await contactsAPI.getListContacts(list.id);
      setViewingList(res.data.list);
      setViewContacts(res.data.contacts);
    } catch (err) {
      toast.error('Failed to load contacts');
    }
  };

  // ── Delete list ──────────────────────────────────────────────

  const handleDelete = async (listId) => {
    try {
      await contactsAPI.deleteList(listId);
      toast.success('Contact list deleted');
      setDeleteConfirm(null);
      loadLists();
    } catch (err) {
      toast.error('Failed to delete list');
    }
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <p>Loading contacts...</p>
      </div>
    );
  }

  return (
    <div className="contacts-page">
      <div className="page-header">
        <h1>Contacts</h1>
        <p>Upload and manage your contact lists for broadcasting</p>
      </div>

      {/* Upload section */}
      {!previewData && (
        <div
          className={`upload-zone ${dragActive ? 'active' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
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
              <div className="spinner spinner-lg" style={{ margin: '0 auto 16px' }} />
              <div className="upload-zone-text">Parsing CSV file...</div>
            </>
          ) : (
            <>
              <div className="upload-zone-icon">📄</div>
              <div className="upload-zone-text">
                Drag & drop your CSV file here, or click to browse
              </div>
              <div className="upload-zone-hint">
                CSV (.csv) or Excel (.xlsx, .xls) with a "phone", "mobile", or "number" column. Optional: "name", "email".
              </div>
              <div className="upload-zone-divider">
                <span>or</span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={downloadSampleCSV}>
                📥 Download Sample Template
              </button>
            </>
          )}
        </div>
      )}

      {/* Preview section */}
      {previewData && (
        <div className="contacts-preview">
          <div className="contacts-preview-header">
            <div>
              <h2>CSV Preview</h2>
              <div className="contacts-preview-stats">
                <span className="badge badge-success">✓ {previewData.valid} valid</span>
                <span className="badge badge-error">✕ {previewData.invalid} invalid</span>
                <span className="badge badge-warning">⚠ {previewData.duplicates} duplicates</span>
              </div>
            </div>
            <div className="contacts-preview-actions">
              <button className="btn btn-ghost" onClick={() => setPreviewData(null)}>
                Cancel
              </button>
            </div>
          </div>

          {/* List name input */}
          <div className="form-group">
            <label className="form-label">List Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., Newsletter Subscribers, VIP Clients"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
            />
          </div>

          {/* Preview table */}
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {previewData.contacts.map((c, i) => (
                  <tr key={i}>
                    <td>{c.row}</td>
                    <td>{c.name || '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{c.phone}</td>
                    <td>
                      {c.is_valid ? (
                        <span className="badge badge-success">✓ Valid</span>
                      ) : (
                        <span className="badge badge-error">✕ {c.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Save button */}
          <div className="contacts-preview-footer">
            <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
              {saving ? (
                <><span className="spinner" /> Saving...</>
              ) : (
                `Save ${previewData.valid} Valid Contacts →`
              )}
            </button>
          </div>
        </div>
      )}

      {/* Existing lists */}
      {!previewData && (
        <div className="contacts-lists">
          <h2 style={{ marginTop: '36px', marginBottom: '16px' }}>Your Contact Lists</h2>

          {lists.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">👥</div>
              <div className="empty-state-title">No contact lists yet</div>
              <div className="empty-state-description">
                Upload a CSV file to create your first contact list
              </div>
            </div>
          ) : (
            <div className="contacts-list-grid">
              {lists.map((list) => (
                <div key={list.id} className="contacts-list-card">
                  <div className="contacts-list-card-header">
                    <div className="contacts-list-card-icon">📋</div>
                    <div className="contacts-list-card-info">
                      <div className="contacts-list-card-name">{list.name}</div>
                      <div className="contacts-list-card-meta">
                        {list.valid_contacts} contacts · {formatDate(list.created_at)}
                      </div>
                    </div>
                  </div>
                  <div className="contacts-list-card-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => handleViewList(list)}>
                      View
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(list)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* View contacts modal */}
      <Modal
        isOpen={!!viewingList}
        onClose={() => { setViewingList(null); setViewContacts([]); }}
        title={viewingList?.name || 'Contacts'}
      >
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {viewContacts.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No contacts in this list.</p>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {viewContacts.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name || '—'}</td>
                      <td style={{ fontFamily: 'monospace' }}>{c.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Contact List"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm?.id)}>
              Delete List
            </button>
          </>
        }
      >
        <p>
          Are you sure you want to delete <strong>"{deleteConfirm?.name}"</strong>?
          This will remove all {deleteConfirm?.valid_contacts} contacts. This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
