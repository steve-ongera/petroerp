import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AppContext';
import { flatNav } from '../navigation';
import { initials } from './Sidebar';

export default function Navbar({ collapsed = false, onToggleCollapse, onOpenMobile, unread = 0 }) {
  const { can, user, logout } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef(null);
  const searchInput = useRef(null);
  const menuRef = useRef(null);

  // pages the user may open that match what they typed
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return flatNav()
      .filter((i) => (!i.perm || can(i.perm)) && i.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, can]);

  // close popups on outside click / Escape, focus search with Ctrl+K
  useEffect(() => {
    const onDown = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { setSearchOpen(false); setMenuOpen(false); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const go = (path) => {
    navigate(path);
    setQuery('');
    setSearchOpen(false);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (results[0]) go(results[0].path);
  };

  const displayName = user?.full_name || user?.name || user?.username || 'Account';
  const role = user?.role_name || user?.role || '';

  return (
    <header className="navbar">
      <button type="button" className="icon-btn navbar__menu-btn" onClick={onOpenMobile} aria-label="Open menu">
        <i className="bi bi-list" />
      </button>
      <button
        type="button"
        className="icon-btn icon-btn--ghost navbar__collapse-btn"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        data-tip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        data-tip-pos="bottom"
      >
        <i className={`bi ${collapsed ? 'bi-layout-sidebar' : 'bi-layout-sidebar-inset'}`} />
      </button>

      <form className="navbar__search" onSubmit={onSubmit} ref={searchRef} role="search">
        <i className="navbar__search-icon bi bi-search" />
        <input
          ref={searchInput}
          className="navbar__search-input"
          type="search"
          placeholder="Search pages…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
          aria-label="Search pages"
        />
        <kbd className="navbar__search-kbd">Ctrl K</kbd>

        {searchOpen && query.trim() && (
          <div className="dropdown__menu dropdown__menu--left is-open" style={{ width: '100%' }}>
            {results.length === 0 ? (
              <div className="dropdown__header">No pages match “{query.trim()}”</div>
            ) : (
              results.map((r) => (
                <button type="button" key={r.path} className="dropdown__item" onClick={() => go(r.path)}>
                  <i className="bi bi-arrow-return-right" />
                  {r.label}
                </button>
              ))
            )}
          </div>
        )}
      </form>

      <div className="navbar__spacer" />

      <div className="navbar__actions">
        <Link to="/approvals" className="icon-btn" aria-label="Approvals" data-tip="Approvals" data-tip-pos="bottom">
          <i className="bi bi-check2-square" />
        </Link>

        <Link to="/notifications" className="icon-btn" aria-label="Notifications" data-tip="Notifications" data-tip-pos="bottom">
          <i className="bi bi-bell" />
          {unread > 0 && <span className="icon-btn__count">{unread > 99 ? '99+' : unread}</span>}
        </Link>

        <div className="navbar__user dropdown" ref={menuRef}>
          <button
            type="button"
            className="navbar__user-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="avatar">{initials(displayName)}</span>
            <span className="navbar__user-name">{displayName}</span>
            <i className="bi bi-chevron-down icon-xs icon-muted" />
          </button>

          {menuOpen && (
            <div className="dropdown__menu is-open" role="menu">
              <div className="dropdown__profile">
                <span className="avatar avatar--lg">{initials(displayName)}</span>
                <div className="min-w-0">
                  <div className="fw-600 text-truncate">{displayName}</div>
                  {role && <div className="text-xs text-muted text-truncate">{role}</div>}
                </div>
              </div>
              <div className="dropdown__divider" />
              <Link to="/profile" className="dropdown__item" role="menuitem" onClick={() => setMenuOpen(false)}>
                <i className="bi bi-person" /> My profile &amp; security
              </Link>
              <Link to="/notifications" className="dropdown__item" role="menuitem" onClick={() => setMenuOpen(false)}>
                <i className="bi bi-bell" /> Notifications
              </Link>
              <div className="dropdown__divider" />
              <button
                type="button"
                className="dropdown__item dropdown__item--danger"
                role="menuitem"
                onClick={() => { setMenuOpen(false); logout?.(); }}
              >
                <i className="bi bi-box-arrow-right" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}