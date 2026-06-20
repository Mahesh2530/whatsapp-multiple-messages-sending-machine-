import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor: attach JWT token ──────────────────────

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor: handle 401 ───────────────────────────

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/auth';
    }
    return Promise.reject(error);
  }
);


// ── Auth API ───────────────────────────────────────────────────

export const authAPI = {
  sendOTP: (data) => api.post('/auth/send-otp', data),
  verifyOTP: (data) => api.post('/auth/verify-otp', data),
  getMe: () => api.get('/auth/me'),
  updateProfile: (data) => api.put('/auth/profile', data),
};


// ── Contacts API ───────────────────────────────────────────────

export const contactsAPI = {
  uploadCSV: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/contacts/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  saveContacts: (data) => api.post('/contacts/save', data),
  getLists: () => api.get('/contacts/lists'),
  getListContacts: (listId) => api.get(`/contacts/lists/${listId}`),
  deleteList: (listId) => api.delete(`/contacts/lists/${listId}`),
};


// ── Messages API ───────────────────────────────────────────────

export const messagesAPI = {
  sendBroadcast: (data) => api.post('/messages/send', data),
  getJobs: () => api.get('/messages/jobs'),
  getJobDetail: (jobId) => api.get(`/messages/jobs/${jobId}`),
};


// ── WhatsApp Web API (Node.js service on port 3001) ────────────

const WA_BASE = 'http://localhost:3001/api/wa';
const waApi = axios.create({ baseURL: WA_BASE });

export const whatsappAPI = {
  getStatus: () => waApi.get('/status'),
  getQR: () => waApi.get('/qr'),
  disconnect: () => waApi.post('/disconnect'),
  uploadFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return waApi.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  sendBroadcast: (data) => waApi.post('/send', data),
  getJob: (jobId) => waApi.get(`/job/${jobId}`),
};

export default api;
