import { useCallback, useEffect, useState } from 'react';

const KEY = 'petroerp:sidebar-collapsed';
const DESKTOP_QUERY = '(min-width: 992px)'; // must match the 991px breakpoint in main.css

const readDesktop = () =>
  typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(DESKTOP_QUERY).matches;

/**
 * Sidebar state shared by AppLayout, Sidebar and Navbar.
 *  - desktop (>= 992px): `collapsed` hides / shows the sidebar (remembered in localStorage)
 *  - tablet / phone:     `mobileOpen` slides the off-canvas drawer in and out
 */
export function useSidebar() {
  const [isDesktop, setIsDesktop] = useState(readDesktop);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e) => {
      setIsDesktop(e.matches);
      if (e.matches) setMobileOpen(false); // growing past the breakpoint closes the drawer
    };
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [collapsed]);

  const toggleSidebar = useCallback(() => {
    if (isDesktop) setCollapsed((c) => !c);
    else setMobileOpen((o) => !o);
  }, [isDesktop]);

  const openMobileSidebar = useCallback(() => setMobileOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  return { isDesktop, collapsed, mobileOpen, toggleSidebar, openMobileSidebar, closeMobileSidebar };
}