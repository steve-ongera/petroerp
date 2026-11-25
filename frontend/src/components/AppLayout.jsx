// components/AppLayout.jsx
import { useLocation } from 'react-router-dom';

import Navbar from './Navbar';
import Sidebar from './Sidebar';
import { useSidebar } from '../hooks/useSidebar';

/**
 * Shell used by App.jsx:  <AppLayout><Outlet /></AppLayout>
 * Sidebar + Navbar + page content, same structure as the school portal:
 * only .app-shell__main scrolls, so the sidebar and navbar never scroll away.
 */
export default function AppLayout({ children }) {
  const { pathname } = useLocation();
  const { isDesktop, collapsed, mobileOpen, toggleSidebar, closeMobileSidebar } = useSidebar();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>

      <Sidebar
        isDesktop={isDesktop}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onClose={closeMobileSidebar}
      />

      <div className="app-shell__main">
        <Navbar onToggleSidebar={toggleSidebar} />
        <main id="main" className="app-shell__content fade-in" key={pathname}>
          {children}
        </main>
        {/* keep your existing toast container here, e.g. <Toasts />  (styles: .toast-stack / .toast-item) */}
      </div>
    </div>
  );
}