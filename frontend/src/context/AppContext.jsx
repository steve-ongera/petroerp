/**
 * Global app state: authentication, permissions, active legal entity, notifications, toasts.
 *
 *   const { user, can, login, logout } = useAuth();
 *   const { activeCompany, setActiveCompany, companies, notify } = useApp();
 *   api.suppliers.list({ ...companyParams() })      // adds ?company=<active> when one is selected
 *
 * `can('finance.view')` only shapes the UI. The server enforces every permission and entity restriction.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { auth, errorMessage, setUnauthorizedHandler } from '../services/api';

const Ctx = createContext(null);
const COMPANY_KEY = 'petroerp.company';
const IDLE_MINUTES = Number(import.meta.env?.VITE_IDLE_MINUTES || 30);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(auth.hasSession() ? 'loading' : 'anon');      // loading | authed | anon
  const [activeCompany, setActive] = useState(() => sessionStorage.getItem(COMPANY_KEY) || '');
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  // ---------- toasts
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((message, type = 'info', ms = 5000) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message: typeof message === 'string' ? message : errorMessage(message), type }]);
    if (ms) setTimeout(() => dismissToast(id), ms);
    return id;
  }, [dismissToast]);

  // ---------- session
  const endSession = useCallback(() => { auth.logout(); setUser(null); setUnread(0); setStatus('anon'); }, []);
  useEffect(() => { setUnauthorizedHandler(() => { setUser(null); setStatus('anon'); }); }, []);

  useEffect(() => {                                              // restore after a page reload
    if (status !== 'loading') return;
    auth.restore().then((u) => { setUser(u); setStatus('authed'); }).catch(() => endSession());
  }, [status, endSession]);

  const login = useCallback(async (username, password, otp) => {
    const data = await auth.login(username, password, otp);     // throws ApiError (shown by the login form)
    setUser(data.user);
    setStatus('authed');
    return data.user;
  }, []);

  const logout = useCallback(() => { endSession(); }, [endSession]);
  const refreshUser = useCallback(async () => { const u = await auth.me(); setUser(u); return u; }, []);

  // ---------- permissions
  const perms = useMemo(() => new Set(user?.permissions || []), [user]);
  const can = useCallback((code) => !code || perms.has(code), [perms]);
  const canAny = useCallback((codes = []) => codes.some((c) => perms.has(c)), [perms]);

  // ---------- legal entity filter
  const companies = user?.companies || [];
  useEffect(() => {                                              // drop a stale selection (e.g. after switching user)
    if (user && activeCompany && !companies.some((c) => String(c.id) === String(activeCompany))) {
      setActive(''); sessionStorage.removeItem(COMPANY_KEY);
    }
  }, [user, companies, activeCompany]);
  const setActiveCompany = useCallback((id) => {
    setActive(id ? String(id) : '');
    id ? sessionStorage.setItem(COMPANY_KEY, String(id)) : sessionStorage.removeItem(COMPANY_KEY);
  }, []);
  const companyParams = useCallback(() => (activeCompany ? { company: activeCompany } : {}), [activeCompany]);
  const activeCompanyObj = companies.find((c) => String(c.id) === String(activeCompany)) || null;

  // ---------- notifications badge (polls while the tab is visible)
  const refreshUnread = useCallback(async () => {
    try { setUnread((await api.notifications.unread()).count); } catch { /* ignore transient errors */ }
  }, []);
  useEffect(() => {
    if (status !== 'authed') return undefined;
    refreshUnread();
    const t = setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000);
    return () => clearInterval(t);
  }, [status, refreshUnread]);

  // ---------- inactivity sign-out (financial data on screen)
  useEffect(() => {
    if (status !== 'authed' || !IDLE_MINUTES) return undefined;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { endSession(); notify('You were signed out after a period of inactivity.', 'warning', 8000); }, IDLE_MINUTES * 60000);
    };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [status, endSession, notify]);

  const value = useMemo(() => ({
    user, status, login, logout, refreshUser, can, canAny,
    companies, activeCompany, activeCompanyObj, setActiveCompany, companyParams,
    unread, refreshUnread, toasts, notify, dismissToast,
  }), [user, status, login, logout, refreshUser, can, canAny, companies, activeCompany, activeCompanyObj,
    setActiveCompany, companyParams, unread, refreshUnread, toasts, notify, dismissToast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useCtx() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth/useApp must be used inside <AppProvider>.');
  return v;
}
export const useAuth = () => {
  const { user, status, login, logout, refreshUser, can, canAny } = useCtx();
  return { user, status, login, logout, refreshUser, can, canAny };
};
export const useApp = () => {
  const { companies, activeCompany, activeCompanyObj, setActiveCompany, companyParams, unread, refreshUnread, toasts, notify, dismissToast } = useCtx();
  return { companies, activeCompany, activeCompanyObj, setActiveCompany, companyParams, unread, refreshUnread, toasts, notify, dismissToast };
};