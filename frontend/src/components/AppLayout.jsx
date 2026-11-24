import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Navbar from './Navbar';
import Sidebar from './Sidebar';

const KEY = 'petroerp:sidebar-collapsed';

/**
 * Shell used by App.jsx:  <AppLayout><Outlet /></AppLayout>
 * Sidebar + Navbar + page content. If your existing AppLayout already renders toasts,
 * keep that part and drop it where marked below.
 */
export default function AppLayout({ children }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [collapsed]);

  // close the mobile drawer after every navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle('modal-open', mobileOpen);
    return () => document.body.classList.remove('modal-open');
  }, [mobileOpen]);

  return (
    <div className={`app-shell${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>

      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        onNavigate={() => setMobileOpen(false)}
      />
      <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />

      <div className="app-main">
        <Navbar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <main id="main" className="app-content fade-in" key={pathname}>
          {children}
        </main>
        {/* keep your existing toast container here, e.g. <Toasts />  (styles: .toast-stack / .toast) */}
      </div>
    </div>
  );
}