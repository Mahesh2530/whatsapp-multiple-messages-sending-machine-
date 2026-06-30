import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { authAPI } from '../services/api';
import './AuthPage.css';

export default function AuthPage() {
  const [step, setStep] = useState(1); // 1 = enter email/phone, 2 = enter OTP
  const [method, setMethod] = useState(() => localStorage.getItem('cuckoo-last-auth-method') || 'email');
  const [email, setEmail] = useState(() => localStorage.getItem('cuckoo-last-email') || '');
  const [phone, setPhone] = useState(() => localStorage.getItem('cuckoo-last-phone') || '');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [devOtp, setDevOtp] = useState('');

  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const handleSendOTP = async (e) => {
    e.preventDefault();
    if (method === 'email' && !email) {
      toast.error('Please enter your email address');
      return;
    }
    if (method === 'phone' && !phone) {
      toast.error('Please enter your phone number');
      return;
    }

    setLoading(true);
    try {
      const payload = method === 'email' ? { email } : { phone };
      const response = await authAPI.sendOTP(payload);
      setDevOtp(response.data.dev_otp || '');
      setStep(2);
      toast.success('OTP sent! Check your ' + (method === 'email' ? 'email' : 'phone'));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (!otp || otp.length !== 6) {
      toast.error('Please enter the 6-digit OTP');
      return;
    }

    setLoading(true);
    try {
      const payload = method === 'email' ? { email, code: otp } : { phone, code: otp };
      const response = await authAPI.verifyOTP(payload);
      
      // Save last used login credentials in localStorage
      localStorage.setItem('cuckoo-last-auth-method', method);
      if (method === 'email') {
        localStorage.setItem('cuckoo-last-email', email);
      } else {
        localStorage.setItem('cuckoo-last-phone', phone);
      }

      login(response.data.access_token, response.data.user);
      toast.success('Welcome! You are now logged in.');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Background effects */}
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
      </div>

      <div className="auth-container">
        {/* Back to home */}
        <button className="auth-back" onClick={() => navigate('/')}>
          ← Back to home
        </button>

        <div className="auth-card">
          {/* Logo */}
          <div className="auth-logo">
            <img src="/logo.png" className="auth-logo-img" alt="Cuckoo Logo" style={{ height: '48px', width: '48px', objectFit: 'contain', marginBottom: '12px' }} />
            <h1>Cuckoo</h1>
          </div>

          {step === 1 ? (
            <>
              <h2 className="auth-title">Welcome</h2>
              <p className="auth-subtitle">
                Sign in or create an account to start broadcasting
              </p>

              {/* Method toggle */}
              <div className="auth-method-toggle">
                <button
                  className={`auth-method-btn ${method === 'email' ? 'active' : ''}`}
                  onClick={() => setMethod('email')}
                >
                  📧 Email
                </button>
                <button
                  className={`auth-method-btn ${method === 'phone' ? 'active' : ''}`}
                  onClick={() => setMethod('phone')}
                >
                  📱 Phone
                </button>
              </div>

              <form onSubmit={handleSendOTP}>
                {method === 'email' ? (
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      className="form-input"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Phone Number</label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="+91 98765 43210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoFocus
                    />
                  </div>
                )}

                <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={loading}>
                  {loading ? (
                    <><span className="spinner" /> Sending OTP...</>
                  ) : (
                    'Send OTP →'
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="auth-title">Enter OTP</h2>
              <p className="auth-subtitle">
                We sent a 6-digit code to{' '}
                <strong>{method === 'email' ? email : phone}</strong>
              </p>

              {devOtp && (
                <div className="auth-dev-otp">
                  <span>🔧 Dev OTP:</span>
                  <code>{devOtp}</code>
                </div>
              )}

              <form onSubmit={handleVerifyOTP}>
                <div className="form-group">
                  <label className="form-label">Verification Code</label>
                  <input
                    type="text"
                    className="form-input auth-otp-input"
                    placeholder="000000"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                  />
                </div>

                <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={loading}>
                  {loading ? (
                    <><span className="spinner" /> Verifying...</>
                  ) : (
                    'Verify & Login →'
                  )}
                </button>
              </form>

              <button className="btn btn-ghost auth-resend" onClick={() => { setStep(1); setOtp(''); setDevOtp(''); }}>
                ← Use a different {method}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
