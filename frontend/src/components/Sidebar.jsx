import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AppContext';
import { visibleNav } from '../navigation';

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
};

const iconClass = (key) => `bi ${ICONS[key] || 'bi-circle'}`;

export const initials = (name = '') =>
  name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'U';

const isWithin = (pathname, path) => pathname === path || pathname.startsWith(`${path}/`);

/** Groups consecutive single links / groups so each block gets its own divider. */
const toSections = (nav) =>
  nav.reduce((acc, n) => {
    const kind = n.items ? 'groups' : 'links';
    const last = acc[acc.length - 1];
    if (last && last.kind === kind) last.entries.push(n);
    else acc.push({ kind, entries: [n] });
    return acc;
  }, []);

export default function Sidebar({ collapsed = false, onToggleCollapse, onNavigate }) {
  const { can, user } = useAuth();
  const { pathname } = useLocation();

  const nav = useMemo(() => visibleNav(can), [can]);
  const sections = useMemo(() => toSections(nav), [nav]);

  const activeGroup = nav.find((n) => n.items?.some((i) => isWithin(pathname, i.path)))?.group;
  const [open, setOpen] = useState(activeGroup ? [activeGroup] : []);

  // keep the group that owns the current page open
  useEffect(() => {
    if (activeGroup) setOpen((o) => (o.includes(activeGroup) ? o : [...o, activeGroup]));
  }, [activeGroup]);

  const toggleGroup = (name) => {
    // in the icon-only rail, a group click expands the rail and opens that group
    if (collapsed) {
      onToggleCollapse?.();
      setOpen((o) => (o.includes(name) ? o : [...o, name]));
      return;
    }
    setOpen((o) => (o.includes(name) ? o.filter((g) => g !== name) : [...o, name]));
  };

  const displayName = user?.full_name || user?.name || user?.username || 'Account';
  const role = user?.role_name || user?.role || '';

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">PE</span>
        <span className="sidebar__brand-text">
          <span className="sidebar__brand-name">PetroERP</span>
          <span className="sidebar__brand-sub">Group operations</span>
        </span>
        <button
          type="button"
          className="sidebar__brand-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className="bi bi-chevron-expand" />
        </button>
      </div>

      <nav className="sidebar__scroll">
        {sections.map((section, idx) => (
          <div className="sidebar__section" key={idx}>
            {section.entries.map((n) => {
              if (!n.items) {
                return (
                  <NavLink
                    key={n.path}
                    to={n.path}
                    data-label={n.label}
                    onClick={onNavigate}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  >
                    <i className={`nav-link__icon ${iconClass(n.icon)}`} />
                    <span className="nav-link__label">{n.label}</span>
                  </NavLink>
                );
              }

              const isOpen = open.includes(n.group);
              const hasActive = n.group === activeGroup;
              return (
                <div
                  key={n.group}
                  className={`nav-group${isOpen ? ' is-open' : ''}${hasActive ? ' has-active' : ''}`}
                >
                  <button
                    type="button"
                    className="nav-group__toggle"
                    data-label={n.group}
                    aria-expanded={isOpen}
                    onClick={() => toggleGroup(n.group)}
                  >
                    <i className={`nav-link__icon ${iconClass(n.icon)}`} />
                    <span className="nav-link__label">{n.group}</span>
                    <i className="nav-link__chevron bi bi-chevron-down" />
                  </button>
                  <div className="nav-group__items">
                    {n.items.map((i) => (
                      <NavLink
                        key={i.path}
                        to={i.path}
                        onClick={onNavigate}
                        className={({ isActive }) => `nav-sub-link${isActive ? ' active' : ''}`}
                      >
                        {i.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <Link to="/profile" className="sidebar__user" onClick={onNavigate} data-label={displayName}>
          <span className="avatar">{initials(displayName)}</span>
          <span className="sidebar__user-meta">
            <span className="sidebar__user-name">{displayName}</span>
            {role && <span className="sidebar__user-role">{role}</span>}
          </span>
        </Link>
      </div>
    </aside>
  );
}