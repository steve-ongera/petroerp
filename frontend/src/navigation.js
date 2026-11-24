/**
 * PetroERP - application shell (single file).
 *
 *  - Every page is imported explicitly with lazy(), so each one is code-split and its
 *    code is only downloaded when someone opens it.
 *  - Every route is written out explicitly in <Routes> (no generated routes), grouped by module.
 *  - <RequireAuth> sends anonymous users to /login.
 *  - <Guarded perm="..."> = permission check -> error boundary -> Suspense -> page.
 *    These guards are UX only: the API enforces permissions and legal-entity access on every request.
 *  - <AppLayout> renders Sidebar + Navbar + <Outlet/> + toasts.
 *  - navigation.js is still used by the Sidebar, firstAllowedPath() and titleFor().
 *    When you add a page: (1) add the lazy import, (2) add the <Route>, (3) add it to navigation.js
 *    if it should appear in the menu / get a tab title.
 */
import { Component, Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import AppLayout from './components/AppLayout';
import { AppProvider, useAuth } from './context/AppContext';
import { firstAllowedPath, titleFor } from './navigation';
import { errorMessage } from './services/api';
import './styles/main.css';

// ---------------------------------------------------------------------------
// PAGES - all lazy-loaded
// ---------------------------------------------------------------------------

// auth & personal
const Login = lazy(() => import('./pages/auth/Login'));
const Profile = lazy(() => import('./pages/auth/Profile'));
const Approvals = lazy(() => import('./pages/admin/Approvals'));
const Notifications = lazy(() => import('./pages/admin/Notifications'));

// dashboard
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'));

// administration
const AdminCompanies = lazy(() => import('./pages/admin/Companies'));
const AdminStructure = lazy(() => import('./pages/admin/Structure'));
const AdminFiscalYears = lazy(() => import('./pages/admin/FiscalYears'));
const AdminTaxConfigs = lazy(() => import('./pages/admin/TaxConfigs'));
const AdminCurrencies = lazy(() => import('./pages/admin/Currencies'));
const AdminAccountMappings = lazy(() => import('./pages/admin/AccountMappings'));
const AdminPolicies = lazy(() => import('./pages/admin/Policies'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminAuditLog = lazy(() => import('./pages/admin/AuditLog'));

// procurement
const ProcSuppliers = lazy(() => import('./pages/procurement/Suppliers'));
const ProcSupplierDetail = lazy(() => import('./pages/procurement/SupplierDetail'));
const ProcContracts = lazy(() => import('./pages/procurement/Contracts'));
const ProcRequisitions = lazy(() => import('./pages/procurement/Requisitions'));
const ProcPurchaseOrders = lazy(() => import('./pages/procurement/PurchaseOrders'));
const ProcPurchaseOrderDetail = lazy(() => import('./pages/procurement/PurchaseOrderDetail'));
const ProcGoodsReceipts = lazy(() => import('./pages/procurement/GoodsReceipts'));
const ProcPurchaseInvoices = lazy(() => import('./pages/procurement/PurchaseInvoices'));
const ProcReturns = lazy(() => import('./pages/procurement/Returns'));

// inventory
const InvProducts = lazy(() => import('./pages/inventory/Products'));
const InvTanks = lazy(() => import('./pages/inventory/Tanks'));
const InvReconciliation = lazy(() => import('./pages/inventory/Reconciliation'));
const InvStock = lazy(() => import('./pages/inventory/Stock'));
const InvAdjustments = lazy(() => import('./pages/inventory/Adjustments'));

// sales
const SalesCustomers = lazy(() => import('./pages/sales/Customers'));
const SalesCustomerDetail = lazy(() => import('./pages/sales/CustomerDetail'));
const SalesContracts = lazy(() => import('./pages/sales/Contracts'));
const SalesPricing = lazy(() => import('./pages/sales/Pricing'));
const SalesOrders = lazy(() => import('./pages/sales/SalesOrders'));
const SalesOrderDetail = lazy(() => import('./pages/sales/SalesOrderDetail'));
const SalesInvoices = lazy(() => import('./pages/sales/SalesInvoices'));
const SalesInvoiceDetail = lazy(() => import('./pages/sales/SalesInvoiceDetail'));
const SalesCreditNotes = lazy(() => import('./pages/sales/CreditNotes'));

// logistics
const LogShipments = lazy(() => import('./pages/logistics/Shipments'));
const LogShipmentDetail = lazy(() => import('./pages/logistics/ShipmentDetail'));
const LogCustoms = lazy(() => import('./pages/logistics/Customs'));
const LogVehicles = lazy(() => import('./pages/logistics/Vehicles'));
const LogDrivers = lazy(() => import('./pages/logistics/Drivers'));
const LogMaintenance = lazy(() => import('./pages/logistics/Maintenance'));
const LogTransporters = lazy(() => import('./pages/logistics/Transporters'));
const LogBookings = lazy(() => import('./pages/logistics/Bookings'));
const LogTransporterInvoices = lazy(() => import('./pages/logistics/TransporterInvoices'));

// finance
const FinExpenses = lazy(() => import('./pages/finance/Expenses'));
const FinPayments = lazy(() => import('./pages/finance/Payments'));
const FinBank = lazy(() => import('./pages/finance/Bank'));
const FinAccounts = lazy(() => import('./pages/finance/Accounts'));
const FinJournals = lazy(() => import('./pages/finance/Journals'));
const FinFixedAssets = lazy(() => import('./pages/finance/FixedAssets'));
const FinPayroll = lazy(() => import('./pages/finance/Payroll'));

// group
const GrpIntercompany = lazy(() => import('./pages/group/Intercompany'));
const GrpConsolidation = lazy(() => import('./pages/group/Consolidation'));
const GrpFxRevaluation = lazy(() => import('./pages/group/FxRevaluation'));

// reports & AI
const Reports = lazy(() => import('./pages/reports/Reports'));
const AiAssistant = lazy(() => import('./pages/ai/Assistant'));

// ---------------------------------------------------------------------------
// Small state screens
// ---------------------------------------------------------------------------
const center = { display: 'grid', placeItems: 'center', minHeight: '60vh', padding: 24, textAlign: 'center' };

function Loader({ label = 'Loading…' }) {
  return <div className="state-screen" style={center} role="status" aria-live="polite">{label}</div>;
}

function Forbidden({ perm }) {
  return (
    <div className="state-card" style={center}>
      <div>
        <h2>No access</h2>
        <p>Your role does not include <code>{perm}</code>. Ask a Group Administrator if you need it.</p>
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

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loader label="Restoring your session…" />;
  if (status !== 'authed') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

/** Keeps the browser tab title in step with the current route. */
function TitleSync() {
  const { pathname } = useLocation();
  useEffect(() => { document.title = `${titleFor(pathname)} · PetroERP`; }, [pathname]);
  return null;
}

/**
 * perm  - the server permission string for the page (e.g. 'sales.view').
 *         Omit / null = any signed-in user.
 * Order: permission check -> error boundary (reset on navigation) -> Suspense -> page.
 */
function Guarded({ perm = null, children }) {
  const { can } = useAuth();
  const { pathname } = useLocation();
  if (perm && !can(perm)) return <Forbidden perm={perm} />;
  return (
    <ErrorBoundary key={pathname}>
      <Suspense fallback={<Loader />}>
        <TitleSync />
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function Home() {
  const { can } = useAuth();
  return <Navigate to={firstAllowedPath(can)} replace />;
}

function LoginRoute() {
  const { status, can } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loader label="Restoring your session…" />;
  if (status === 'authed') return <Navigate to={location.state?.from || firstAllowedPath(can)} replace />;
  return (
    <Suspense fallback={<Loader />}>
      <ErrorBoundary><Login /></ErrorBoundary>
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
function AppRoutes() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<LoginRoute />} />

      {/* everything inside the app shell requires a signed-in user */}
      <Route element={<RequireAuth><AppLayout><Outlet /></AppLayout></RequireAuth>}>
        <Route index element={<Home />} />

        {/* ---- personal pages: any signed-in user ---- */}
        <Route path="/approvals" element={<Guarded><Approvals /></Guarded>} />
        <Route path="/notifications" element={<Guarded><Notifications /></Guarded>} />
        <Route path="/profile" element={<Guarded><Profile /></Guarded>} />

        {/* ---- dashboard ---- */}
        <Route path="/dashboard" element={<Guarded perm="reports.view"><Dashboard /></Guarded>} />

        {/* ---- administration ---- */}
        <Route path="/admin/companies" element={<Guarded perm="company.view"><AdminCompanies /></Guarded>} />
        <Route path="/admin/structure" element={<Guarded perm="company.view"><AdminStructure /></Guarded>} />
        <Route path="/admin/fiscal-years" element={<Guarded perm="finance.view"><AdminFiscalYears /></Guarded>} />
        <Route path="/admin/taxes" element={<Guarded perm="company.view"><AdminTaxConfigs /></Guarded>} />
        <Route path="/admin/currencies" element={<Guarded perm="company.view"><AdminCurrencies /></Guarded>} />
        <Route path="/admin/account-mappings" element={<Guarded perm="finance.view"><AdminAccountMappings /></Guarded>} />
        <Route path="/admin/policies" element={<Guarded perm="company.view"><AdminPolicies /></Guarded>} />
        <Route path="/admin/users" element={<Guarded perm="admin.view"><AdminUsers /></Guarded>} />
        <Route path="/admin/audit" element={<Guarded perm="audit.view"><AdminAuditLog /></Guarded>} />

        {/* ---- procurement ---- */}
        <Route path="/procurement/suppliers" element={<Guarded perm="suppliers.view"><ProcSuppliers /></Guarded>} />
        <Route path="/procurement/suppliers/:id" element={<Guarded perm="suppliers.view"><ProcSupplierDetail /></Guarded>} />
        <Route path="/procurement/contracts" element={<Guarded perm="suppliers.view"><ProcContracts /></Guarded>} />
        <Route path="/procurement/requisitions" element={<Guarded perm="procurement.view"><ProcRequisitions /></Guarded>} />
        <Route path="/procurement/purchase-orders" element={<Guarded perm="procurement.view"><ProcPurchaseOrders /></Guarded>} />
        <Route path="/procurement/purchase-orders/:id" element={<Guarded perm="procurement.view"><ProcPurchaseOrderDetail /></Guarded>} />
        <Route path="/procurement/receipts" element={<Guarded perm="inventory.view"><ProcGoodsReceipts /></Guarded>} />
        <Route path="/procurement/invoices" element={<Guarded perm="procurement.view"><ProcPurchaseInvoices /></Guarded>} />
        <Route path="/procurement/returns" element={<Guarded perm="procurement.view"><ProcReturns /></Guarded>} />

        {/* ---- inventory ---- */}
        <Route path="/inventory/products" element={<Guarded perm="inventory.view"><InvProducts /></Guarded>} />
        <Route path="/inventory/tanks" element={<Guarded perm="inventory.view"><InvTanks /></Guarded>} />
        <Route path="/inventory/reconciliation" element={<Guarded perm="inventory.view"><InvReconciliation /></Guarded>} />
        <Route path="/inventory/stock" element={<Guarded perm="inventory.view"><InvStock /></Guarded>} />
        <Route path="/inventory/adjustments" element={<Guarded perm="inventory.view"><InvAdjustments /></Guarded>} />

        {/* ---- sales ---- */}
        <Route path="/sales/customers" element={<Guarded perm="customers.view"><SalesCustomers /></Guarded>} />
        <Route path="/sales/customers/:id" element={<Guarded perm="customers.view"><SalesCustomerDetail /></Guarded>} />
        <Route path="/sales/contracts" element={<Guarded perm="sales.view"><SalesContracts /></Guarded>} />
        <Route path="/sales/pricing" element={<Guarded perm="sales.view"><SalesPricing /></Guarded>} />
        <Route path="/sales/orders" element={<Guarded perm="sales.view"><SalesOrders /></Guarded>} />
        <Route path="/sales/orders/:id" element={<Guarded perm="sales.view"><SalesOrderDetail /></Guarded>} />
        <Route path="/sales/invoices" element={<Guarded perm="sales.view"><SalesInvoices /></Guarded>} />
        <Route path="/sales/invoices/:id" element={<Guarded perm="sales.view"><SalesInvoiceDetail /></Guarded>} />
        <Route path="/sales/credit-notes" element={<Guarded perm="sales.view"><SalesCreditNotes /></Guarded>} />

        {/* ---- logistics ---- */}
        <Route path="/logistics/shipments" element={<Guarded perm="shipments.view"><LogShipments /></Guarded>} />
        <Route path="/logistics/shipments/:id" element={<Guarded perm="shipments.view"><LogShipmentDetail /></Guarded>} />
        <Route path="/logistics/customs" element={<Guarded perm="customs.view"><LogCustoms /></Guarded>} />
        <Route path="/logistics/vehicles" element={<Guarded perm="fleet.view"><LogVehicles /></Guarded>} />
        <Route path="/logistics/drivers" element={<Guarded perm="fleet.view"><LogDrivers /></Guarded>} />
        <Route path="/logistics/maintenance" element={<Guarded perm="fleet.view"><LogMaintenance /></Guarded>} />
        <Route path="/logistics/transporters" element={<Guarded perm="transport.view"><LogTransporters /></Guarded>} />
        <Route path="/logistics/bookings" element={<Guarded perm="transport.view"><LogBookings /></Guarded>} />
        <Route path="/logistics/transporter-invoices" element={<Guarded perm="transport.view"><LogTransporterInvoices /></Guarded>} />

        {/* ---- finance ---- */}
        <Route path="/finance/expenses" element={<Guarded perm="expenses.view"><FinExpenses /></Guarded>} />
        <Route path="/finance/payments" element={<Guarded perm="payments.view"><FinPayments /></Guarded>} />
        <Route path="/finance/bank" element={<Guarded perm="payments.view"><FinBank /></Guarded>} />
        <Route path="/finance/accounts" element={<Guarded perm="finance.view"><FinAccounts /></Guarded>} />
        <Route path="/finance/journals" element={<Guarded perm="finance.view"><FinJournals /></Guarded>} />
        <Route path="/finance/assets" element={<Guarded perm="assets.view"><FinFixedAssets /></Guarded>} />
        <Route path="/finance/payroll" element={<Guarded perm="hr.view"><FinPayroll /></Guarded>} />

        {/* ---- group ---- */}
        <Route path="/group/intercompany" element={<Guarded perm="group.view"><GrpIntercompany /></Guarded>} />
        <Route path="/group/consolidation" element={<Guarded perm="group.view"><GrpConsolidation /></Guarded>} />
        <Route path="/group/fx" element={<Guarded perm="finance.close_period"><GrpFxRevaluation /></Guarded>} />

        {/* ---- reports & AI ---- */}
        <Route path="/reports" element={<Guarded perm="reports.view"><Reports /></Guarded>} />
        <Route path="/ai" element={<Guarded perm="ai.view"><AiAssistant /></Guarded>} />

        {/* unknown path inside the shell: 404 with sidebar/navbar still visible */}
        <Route path="*" element={<Guarded><NotFound /></Guarded>} />
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