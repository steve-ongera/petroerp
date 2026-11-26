/**
 * PetroERP - application shell.
 *
 *  - Routes are generated from src/navigation.js (menu + detail routes) so the sidebar and the router never drift apart.
 *  - Pages live in src/pages/<group>/<Name>.jsx and are code-split automatically (import.meta.glob). A page that has
 *    not been written yet shows a "not built" placeholder instead of breaking the build - add pages one group at a time.
 *  - <RequireAuth> sends anonymous users to /login; <Guard roles={...}> shows "no access" for pages the role cannot use.
 *    Access is ROLE based: each nav entry lists the roles allowed (see navigation.js). The Group Administrator /
 *    super user passes every guard. Role enforcement lives ONLY in the frontend; the API just requires a signed-in
 *    user and still applies legal-entity (company) scoping and workflow rules.
 *  - <AppLayout> (components/AppLayout.jsx) renders Sidebar + Navbar + <Outlet/> + toasts.
 */
import { Component, Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import AppLayout from './components/AppLayout';
import { AppProvider, useAuth } from './context/AppContext';
import { allRoutes, firstAllowedPath, titleFor } from './navigation';
import { errorMessage } from './services/api';
import { useAccess } from './utils/access';
import './styles/main.css';

// ------------------------------------------------------------------ lazy page registry
const PAGE_LOADERS = import.meta.glob('./pages/**/*.jsx');       // { './pages/sales/Customers.jsx': () => import(...) }
const pageCache = {};

function pageFor(key) {
  if (!pageCache[key]) {
    const loader = PAGE_LOADERS[`./pages/${key}.jsx`];
    pageCache[key] = loader ? lazy(loader) : () => <NotBuilt name={key} />;
  }
  return pageCache[key];
}

// ------------------------------------------------------------------ small state screens
const center = { display: 'grid', placeItems: 'center', minHeight: '60vh', padding: 24, textAlign: 'center' };

function Loader({ label = 'Loading…' }) {
  return <div className="state-screen" style={center} role="status" aria-live="polite">{label}</div>;
}

function NotBuilt({ name }) {
  return (
    <div className="state-card" style={center}>
      <div>
        <h2>Page not built yet</h2>
        <p>The screen <code>src/pages/{name}.jsx</code> has not been created. The API behind it is ready.</p>
      </div>
    </div>
  );
}

/** Shows the role the app saw, which makes role-code mismatches obvious. */
function Forbidden() {
  const { role } = useAccess();
  return (
    <div className="state-card" style={center}>
      <div>
        <h2>No access</h2>
        <p>
          Your role{role ? <> (<code>{role}</code>)</> : ''} does not have access to this page.
          Ask a Group Administrator if you need it.
        </p>
        <Link to="/">Back to home</Link>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="state-card" style={center}>
      <div><h2>Page not found</h2><Link to="/">Back to home</Link></div>
    </div>
  );
}

/** Catches render errors in a page so one broken screen never blanks the whole app. */
class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Page error:', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state-card" style={center} role="alert">
        <div>
          <h2>Something went wrong on this page</h2>
          <p>{errorMessage(this.state.error)}</p>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    );
  }
}

// ------------------------------------------------------------------ guards
function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loader label="Restoring your session…" />;
  if (status !== 'authed') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

/** roles: undefined/null = any signed-in user; [] = Group Administrator only; [..] = those roles. Admin always passes. */
function Guard({ roles, children }) {
  const { can } = useAccess();
  return can(roles) ? children : <Forbidden />;
}

/** Renders a page inside a boundary + Suspense and keeps the browser tab title in step. */
function Page({ pageKey }) {
  const { pathname } = useLocation();
  const Component = pageFor(pageKey);
  useEffect(() => { document.title = `${titleFor(pathname)} · PetroERP`; }, [pathname]);
  return (
    <ErrorBoundary key={pathname}>
      <Suspense fallback={<Loader />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}

function Home() {
  const { can } = useAccess();
  const path = firstAllowedPath(can);
  // Avoid a redirect loop if the only allowed page is "/" itself
  return path === '/' ? <Forbidden /> : <Navigate to={path} replace />;
}

// ------------------------------------------------------------------ login
/** Uses pages/auth/Login.jsx when it exists; otherwise this minimal built-in form so you can always sign in. */
function FallbackLogin() {
  const { login } = useAuth();
  const [f, setF] = useState({ username: '', password: '', otp: '' });
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(f.username.trim(), f.password, f.otp.trim() || undefined); }
    catch (err) {
      const msg = errorMessage(err);
      if (/otp|authenticator/i.test(msg)) setNeedOtp(true);
      setError(msg);
    } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="login-screen" style={{ ...center, minHeight: '100vh', background: '#0b1f3a' }}>
      <form onSubmit={submit} className="login-card" style={{ background: '#fff', padding: 32, borderRadius: 10, width: 340, textAlign: 'left' }}>
        <h1 style={{ margin: '0 0 4px', color: '#0b1f3a' }}>PetroERP</h1>
        <p style={{ margin: '0 0 20px', color: '#4b5b6b' }}>Sign in to continue</p>
        <label>Username<input autoFocus autoComplete="username" value={f.username} onChange={set('username')} required style={{ width: '100%', margin: '4px 0 12px' }} /></label>
        <label>Password<input type="password" autoComplete="current-password" value={f.password} onChange={set('password')} required style={{ width: '100%', margin: '4px 0 12px' }} /></label>
        {needOtp && <label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" value={f.otp} onChange={set('otp')} style={{ width: '100%', margin: '4px 0 12px' }} /></label>}
        {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
        <button className="btn" disabled={busy} style={{ width: '100%', background: '#0f7b4f', color: '#fff', border: 0, padding: 10, borderRadius: 6 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function LoginRoute() {
  const { status, can } = useAccess();
  const location = useLocation();
  if (status === 'loading') return <Loader label="Restoring your session…" />;
  if (status === 'authed') return <Navigate to={location.state?.from || firstAllowedPath(can)} replace />;
  const Custom = PAGE_LOADERS['./pages/auth/Login.jsx'] ? pageFor('auth/Login') : FallbackLogin;
  return (
    <Suspense fallback={<Loader />}>
      <ErrorBoundary><Custom /></ErrorBoundary>
    </Suspense>
  );
}

// ------------------------------------------------------------------ routes
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />

      <Route element={<RequireAuth><AppLayout><Outlet /></AppLayout></RequireAuth>}>
        <Route index element={<Home />} />
        {allRoutes().map((r) => (
          <Route key={r.path} path={r.path} element={<Guard roles={r.roles}><Page pageKey={r.page} /></Guard>} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </BrowserRouter>
  );
}