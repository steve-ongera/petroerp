import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AppContext';
import { flatNav } from '../navigation';
import { initials } from './Sidebar';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

const titleCase = (s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const segLabel = (seg) => (/^\d+$/.test(seg) || seg.length > 20 ? `#${seg.slice(0, 8)}` : titleCase(seg));

export default function Navbar({ onToggleSidebar, unread = 0 }) {
  const { can, user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef(null);
  const searchInput = useRef(null);
  const menuRef = useRef(null);

  // Results are permission-filtered by flatNav(can), so we can't link to a page the user can't open.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return flatNav(can)
      .filter((i) => i.label.toLowerCase().includes(q) || i.path.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, can]);

  // Breadcrumbs (display only): labels come from the same nav, folders are plain text.
  const crumbs = useMemo(() => {
    const pages = flatNav(can);
    const segs = pathname.split('/').filter(Boolean);
    return segs.map((seg, i) => {
      const to = '/' + segs.slice(0, i + 1).join('/');
      const page = pages.find((p) => p.path === to);
      return { to, label: page?.label || segLabel(seg), isPage: !!page };
    });
  }, [pathname, can]);

  useEffect(() => {
    const onDown = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setMenuOpen(false);
        setMobileSearchOpen(false);
        searchInput.current?.blur();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMobileSearchOpen(true);
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

  // close the phone search bar and menus whenever the page changes
  useEffect(() => {
    setMobileSearchOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  const go = (path) => {
    navigate(path);
    setQuery('');
    setSearchOpen(false);
    setMobileSearchOpen(false);
    searchInput.current?.blur();
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (results[0]) go(results[0].path);
  };

  const toggleMobileSearch = () => {
    setMobileSearchOpen((v) => !v);
    setTimeout(() => searchInput.current?.focus(), 30);
  };

  const displayName = user?.full_name || user?.name || user?.username || 'Account';
  const role = user?.role_name || user?.role || '';

  return (
    <header className="app-navbar">
      <div className="app-navbar__left">
        <button
          type="button"
          className="app-navbar__toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle menu"
        >
          <i className="bi bi-layout-sidebar" aria-hidden="true" />
        </button>

        <nav className="app-navbar__breadcrumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span className="app-navbar__crumb" key={c.to}>
                {i > 0 && <i className="bi bi-chevron-right app-navbar__crumb-sep" aria-hidden="true" />}
                {last ? (
                  <span className="crumb-text is-current" aria-current="page" title={c.label}>{c.label}</span>
                ) : c.isPage ? (
                  <Link to={c.to} title={c.label}>{c.label}</Link>
                ) : (
                  <span className="crumb-text" title={c.label}>{c.label}</span>
                )}
              </span>
            );
          })}
        </nav>
      </div>

      {/* Search: inline box on >= 768px; on phones it drops under the navbar when the icon is tapped */}
      <div ref={searchRef} className={`app-navbar__search-wrap${mobileSearchOpen ? ' is-open' : ''}`}>
        <form className="app-navbar__search" onSubmit={onSubmit} role="search" autoComplete="off">
          <i className="bi bi-search" aria-hidden="true" />
          <input
            ref={searchInput}
            type="search"
            placeholder="Search pages…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            aria-label="Search pages"
          />
          <kbd>{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
        </form>

        {searchOpen && query.trim() && (
          <div className="app-navbar__suggest" role="listbox">
            {results.length === 0 ? (
              <div className="app-navbar__dropdown-empty">No pages match “{query.trim()}”</div>
            ) : (
              results.map((r, i) => (
                <div
                  key={r.path}
                  role="option"
                  aria-selected={i === 0}
                  className={`app-navbar__suggest-item${i === 0 ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(r.path)}
                >
                  <i className="bi bi-arrow-return-right" aria-hidden="true" />
                  <div style={{ minWidth: 0 }}>
                    <div className="app-navbar__suggest-title">{r.label}</div>
                    <div className="app-navbar__suggest-group">{r.path}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Right-hand group. Must stay the LAST child of <header>: main.css centres the search box with `.app-navbar > :last-child`. */}
      <div className="app-navbar__actions">
        <button
          type="button"
          className="app-navbar__icon-btn app-navbar__search-toggle"
          onClick={toggleMobileSearch}
          aria-label={mobileSearchOpen ? 'Close search' : 'Search pages'}
          aria-expanded={mobileSearchOpen}
        >
          <i className={`bi ${mobileSearchOpen ? 'bi-x-lg' : 'bi-search'}`} aria-hidden="true" />
        </button>

        <Link to="/approvals" className="app-navbar__icon-btn" aria-label="Approvals" data-tip="Approvals" data-tip-pos="bottom">
          <i className="bi bi-check2-square" aria-hidden="true" />
        </Link>

        <Link to="/notifications" className="app-navbar__icon-btn" aria-label="Notifications" data-tip="Notifications" data-tip-pos="bottom">
          <i className="bi bi-bell" aria-hidden="true" />
          {unread > 0 && <span className="badge-count">{unread > 99 ? '99+' : unread}</span>}
        </Link>

        <span className="app-navbar__divider" aria-hidden="true" />

        <div className="app-navbar__menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="app-navbar__user"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="app-navbar__avatar">{initials(displayName)}</span>
            <span className="app-navbar__user-info">
              <strong>{displayName}</strong>
              {role && <small>{role}</small>}
            </span>
            <i className="bi bi-chevron-down" style={{ fontSize: '0.7rem' }} aria-hidden="true" />
          </button>

          {menuOpen && (
            <div className="app-navbar__dropdown app-navbar__profile-menu" style={{ width: '14.5rem' }} role="menu">
              <div className="app-navbar__profile-menu-head">
                <strong>{displayName}</strong>
                {role && <small>{role}</small>}
              </div>
              <div className="app-navbar__profile-menu-divider" />
              <Link to="/profile" className="app-navbar__profile-menu-item" role="menuitem" onClick={() => setMenuOpen(false)}>
                <i className="bi bi-person" /> My profile &amp; security
              </Link>
              <Link to="/notifications" className="app-navbar__profile-menu-item" role="menuitem" onClick={() => setMenuOpen(false)}>
                <i className="bi bi-bell" /> Notifications
              </Link>
              <div className="app-navbar__profile-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="app-navbar__profile-menu-item app-navbar__profile-menu-item--danger"
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