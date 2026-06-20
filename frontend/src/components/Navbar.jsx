import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';
import './Navbar.css';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const navItems = [
    { to: '/dashboard', icon: '📊', label: 'Dashboard' },
    { to: '/contacts', icon: '👥', label: 'Contacts' },
    { to: '/compose', icon: '✍️', label: 'Compose' },
    { to: '/campaigns', icon: '📡', label: 'Campaigns' },
    { to: '/whatsapp', icon: '📱', label: 'WhatsApp Web' },
  ];

  return (
    <>
      {/* Mobile toggle */}
      <button className="mobile-nav-toggle" onClick={() => setMobileOpen(!mobileOpen)}>
        {mobileOpen ? '✕' : '☰'}
      </button>

      <nav className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">📨</div>
          <div>
            <div className="sidebar-brand-name">WA Broadcaster</div>
            <div className="sidebar-brand-tag">Private Messaging</div>
          </div>
        </div>

        {/* Nav items */}
        <div className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>

        {/* User section */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              {user?.name ? user.name.charAt(0).toUpperCase() : '👤'}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name || 'User'}</div>
              <div className="sidebar-user-email">{user?.email || user?.phone || ''}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm sidebar-logout" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </nav>

      {/* Mobile overlay */}
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
    </>
  );
}
