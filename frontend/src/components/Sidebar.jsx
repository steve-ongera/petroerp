import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { visibleNav } from '../navigation';
import { useAccess } from '../utils/access';
import { normalizeRole } from '../utils/roles';

/** navigation.js icon key -> Bootstrap Icons class */
export const ICONS = {
  dashboard: 'bi-grid-1x2',
  settings: 'bi-gear',
  cart: 'bi-cart3',
  tank: 'bi-fuel-pump',
  sales: 'bi-graph-up-arrow',
  truck: 'bi-truck',
  finance: 'bi-bank',
  group: 'bi-diagram-3',
  report: 'bi-file-earmark-bar-graph',
  ai: 'bi-stars',
  check: 'bi-check2-square',
  bell: 'bi-bell',
  user: 'bi-person',
};

const iconClass = (key) => `bi ${ICONS[key] || 'bi-circle'}`;

export const initials = (name = '') =>
  name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'U';

const isWithin = (pathname, path) => pathname === path || pathname.startsWith(`${path}/`);

const SWIPE_CLOSE_DISTANCE = 56; // px dragged left before the drawer closes
const SWIPE_MAX_VERTICAL = 40;   // ignore mostly-vertical scrolling

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Driven by useSidebar():
 *  - desktop (>= 992px): `collapsed` hides the sidebar (.app-sidebar--collapsed)
 *  - tablet / phone: off-canvas drawer; `mobileOpen` slides it in (.app-sidebar--open).
 *    Closes via the X button, the backdrop, a left swipe, Escape, a link tap or any route change.
 * Dropdown groups are OPEN by default; click a header to close it. The group that
 * contains the current page is always re-opened on navigation.
 *
 * Menu visibility comes from visibleNav(can). The super user / Group Administrator sees EVERY group and item
 * (useAccess().can returns true for admins). Roles are enforced in the frontend only; the API requires sign-in
 * and applies company scoping.
 */
export default function Sidebar({ isDesktop = true, collapsed = false, mobileOpen = false, onClose }) {
  const { can, user, isAdmin } = useAccess();
  const { pathname } = useLocation();
  const asideRef = useRef(null);
  const navRef = useRef(null);
  const touchStart = useRef(null);
  const firstRender = useRef(true);

  const nav = useMemo(() => visibleNav(can), [can]);

  const isIconRail = isDesktop && collapsed;
  const drawerOpen = !isDesktop && mobileOpen;

  const sidebarClass = ['app-sidebar', isIconRail && 'app-sidebar--collapsed', drawerOpen && 'app-sidebar--open']
    .filter(Boolean)
    .join(' ');

  // ---- groups the user has explicitly closed (everything else is open) ----
  const [closedGroups, setClosedGroups] = useState(() => new Set());

  const toggleGroup = useCallback((name) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // re-open whichever group holds the current page
  const activeGroup = nav.find((n) => n.items?.some((i) => isWithin(pathname, i.path)))?.group;
  useEffect(() => {
    if (!activeGroup) return;
    setClosedGroups((prev) => {
      if (!prev.has(activeGroup)) return prev;
      const next = new Set(prev);
      next.delete(activeGroup);
      return next;
    });
  }, [activeGroup]);

  // keep the active link in view inside the scrolling nav
  useEffect(() => {
    const el = navRef.current?.querySelector('.app-sidebar__link--active');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [pathname]);

  // any route change closes the drawer on phones/tablets (skipped on first mount)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (!isDesktop && mobileOpen) onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // lock page scroll behind the open drawer
  useEffect(() => {
    if (!drawerOpen) return undefined;
    document.body.classList.add('drawer-open');
    return () => document.body.classList.remove('drawer-open');
  }, [drawerOpen]);

  // Escape closes the open drawer
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, onClose]);

  // swipe left on the drawer to close it (passive, never blocks the nav's own scrolling)
  useEffect(() => {
    const el = asideRef.current;
    if (!el || !drawerOpen) return undefined;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) { touchStart.current = null; return; }
      const t = e.touches[0];
      touchStart.current = { x: t.clientX, y: t.clientY, done: false };
    };
    const onTouchMove = (e) => {
      const start = touchStart.current;
      if (!start || start.done) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (dx <= -SWIPE_CLOSE_DISTANCE && dy < SWIPE_MAX_VERTICAL) { start.done = true; onClose?.(); }
    };
    const reset = () => { touchStart.current = null; };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', reset, { passive: true });
    el.addEventListener('touchcancel', reset, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', reset);
      el.removeEventListener('touchcancel', reset);
    };
  }, [drawerOpen, onClose]);

  const closeIfDrawer = !isDesktop ? onClose : undefined;
  const displayName = user?.full_name || user?.name || user?.username || 'Account';
  const role = isAdmin ? 'Super user · Full access' : (user?.role_name || normalizeRole(user?.role) || '');

  return (
    <>
      <aside
        className={sidebarClass}
        ref={asideRef}
        aria-label="Main navigation"
        aria-hidden={!isDesktop && !mobileOpen ? 'true' : undefined}
      >
        <div className="app-sidebar__brand">
          <div className="app-sidebar__brand-inner">
            
            <span className="app-sidebar__brand-text">
              PetroERP
              <span className="app-sidebar__brand-sub">Group operations</span>
            </span>
          </div>

          {/* X button: tablet / phone drawer only (hidden by CSS on desktop) */}
          {!isDesktop && (
            <button type="button" className="app-sidebar__close" onClick={onClose} aria-label="Close menu">
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
          )}
        </div>

        <nav className="app-sidebar__nav" ref={navRef}>
          {nav.length === 0 ? (
            <div className="app-sidebar__empty">No items available</div>
          ) : (
            nav.map((n) => {
              if (!n.items) {
                return (
                  <div className="app-sidebar__group" key={n.path}>
                    <NavLink
                      to={n.path}
                      onClick={closeIfDrawer}
                      className={({ isActive }) => `app-sidebar__link${isActive ? ' app-sidebar__link--active' : ''}`}
                    >
                      <i className={iconClass(n.icon)} aria-hidden="true" />
                      <span>{n.label}</span>
                    </NavLink>
                  </div>
                );
              }

              const isOpen = !closedGroups.has(n.group);
              return (
                <div className="app-sidebar__group" key={n.group}>
                  <button
                    type="button"
                    className={`app-sidebar__group-header${isOpen ? ' is-open' : ''}`}
                    aria-expanded={isOpen}
                    onClick={() => toggleGroup(n.group)}
                  >
                    <span className="app-sidebar__group-title">
                      <i className={iconClass(n.icon)} aria-hidden="true" />
                      <span>{n.group}</span>
                    </span>
                    <i className="bi bi-chevron-right app-sidebar__group-chevron" aria-hidden="true" />
                  </button>

                  <div className={`app-sidebar__group-collapse${isOpen ? ' is-open' : ''}`}>
                    <div className="app-sidebar__links">
                      {n.items.map((i) => (
                        <NavLink
                          key={i.path}
                          to={i.path}
                          onClick={closeIfDrawer}
                          tabIndex={isOpen ? 0 : -1}
                          className={({ isActive }) =>
                            `app-sidebar__link app-sidebar__link--sub${isActive ? ' app-sidebar__link--active' : ''}`
                          }
                        >
                          <span>{i.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </nav>

        <Link to="/profile" className="app-sidebar__footer" onClick={closeIfDrawer}>
          <span className="app-sidebar__footer-icon" aria-hidden="true">{initials(displayName)}</span>
          <span className="app-sidebar__footer-text">
            <span className="app-sidebar__copy">{displayName}</span>
            {role && <span className="app-sidebar__version">{role}</span>}
          </span>
        </Link>
      </aside>

      {!isDesktop && mobileOpen && <div className="app-sidebar__backdrop" onClick={onClose} aria-hidden="true" />}
    </>
  );
}