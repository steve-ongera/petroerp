/**
 * Navigation registry (role based).
 *
 * Each entry carries `roles`:
 *   undefined / null -> any signed-in user
 *   [..]             -> only those roles
 *   []               -> Group Administrator only
 * The Group Administrator / super user always passes (see utils/access.js).
 *
 * Every role set is built with `allow(...)`, which adds FULL_ACCESS_ROLES on top
 * (same idea as `allow()` in the HMIS App.jsx). Edit FULL_ACCESS_ROLES to change
 * who gets blanket access.
 *
 * Exports: visibleNav(can), flatNav(can), allRoutes(), firstAllowedPath(can), titleFor(pathname),
 *          EMPLOYEES_EDIT, EMPLOYEES_LINK, EMPLOYEES_PAYSLIPS (used inside the Employees page)
 * Pure data + helpers. No JSX.
 */
import { ROLES } from './utils/roles';

const {
  MD, KE_FINANCE_MANAGER: KFM, DRC_FINANCE_MANAGER: DFM, ACCOUNTANT: ACC,
  PROCUREMENT_MANAGER: PM, PROCUREMENT_OFFICER: PO, SALES_MANAGER: SM, SALES_OFFICER: SO,
  FLEET_MANAGER: FLM, LOGISTICS_MANAGER: LM, STORE_MANAGER: STM, CASHIER: CSH,
  INTERNAL_AUDITOR: AUD, READONLY_MANAGER: RO,
} = ROLES;

// Roles that can open every page. Each set below only adds the roles it was originally limited to.
const FULL_ACCESS_ROLES = [MD, KFM, DFM, ACC];
const allow = (...roles) => [...new Set([...roles, ...FULL_ACCESS_ROLES])];

// ---- role sets (edit here to change who sees what) ----
const COMPANY      = allow(MD, KFM, AUD);
const FINANCE      = allow(MD, KFM, DFM, ACC, CSH, AUD);
const CLOSE_PERIOD = allow(KFM, DFM);
const REQUISITIONS = allow(MD, KFM, PM, PO, LM);
const SUPPLIERS    = allow(MD, KFM, ACC, PM, PO, RO, AUD);
const PROCUREMENT  = allow(MD, KFM, ACC, PM, PO, LM, RO, AUD);
const RECEIPTS     = allow(MD, KFM, PM, PO, STM, LM);
const INVENTORY    = allow(MD, KFM, DFM, ACC, PM, PO, SM, SO, FLM, LM, STM, RO, AUD);
const CUSTOMERS    = allow(MD, DFM, ACC, SM, SO, CSH, RO, AUD);
const SALES        = allow(MD, DFM, ACC, SM, SO, LM, RO, AUD);
const SHIPMENTS    = allow(MD, KFM, DFM, ACC, PM, SM, SO, FLM, LM, STM, RO, AUD);
const CUSTOMS      = allow(MD, LM, AUD);
const FLEET        = allow(MD, KFM, FLM, LM, RO, AUD);
const TRANSPORT    = FLEET;
const EXPENSES     = allow(MD, KFM, DFM, ACC, FLM, LM, AUD);
const PAYMENTS     = allow(MD, KFM, DFM, ACC, CSH, AUD);
const ASSETS       = allow(MD, KFM, DFM, AUD);
const PAYROLL      = allow(MD, KFM, DFM, AUD);
const GROUP        = allow(MD, KFM, DFM, AUD);
const REPORTS      = allow(MD, KFM, DFM, ACC, PM, SM, FLM, LM, RO, AUD);
const AI           = allow(MD, KFM, DFM, AUD);
const AUDIT        = allow(MD, AUD);
const USERS        = allow(MD, AUD);

// Employees: salary and bank data are sensitive, so the page follows the payroll roles.
const EMPLOYEES = PAYROLL;                       // can open the page and see the list
export const EMPLOYEES_EDIT = allow(MD, KFM, DFM);   // add / edit / delete employees
export const EMPLOYEES_LINK = allow(MD);             // link / unlink a user account
export const EMPLOYEES_PAYSLIPS = PAYROLL;           // see salary, bank details and payslips

// Payroll: who may create, review-and-process and delete draft runs (matches the server's finance posting roles).
export const PAYROLL_PROCESS = allow(KFM, DFM, ACC);

export const ICON_KEYS = {
  dashboard: 'dashboard',
  admin: 'settings',
  procurement: 'cart',
  inventory: 'tank',
  sales: 'sales',
  logistics: 'truck',
  finance: 'finance',
  group: 'group',
  reports: 'report',
  ai: 'ai',
};

const NAV = [
  { label: 'Dashboard', path: '/dashboard', icon: ICON_KEYS.dashboard, roles: REPORTS, page: 'dashboard/Dashboard' },

  { group: 'Administration', icon: ICON_KEYS.admin, items: [
    { label: 'Companies',        path: '/admin/companies',        roles: COMPANY, page: 'admin/Companies' },
    { label: 'Structure',        path: '/admin/structure',        roles: COMPANY, page: 'admin/Structure' },
    { label: 'Fiscal years',     path: '/admin/fiscal-years',     roles: FINANCE, page: 'admin/FiscalYears' },
    { label: 'Taxes',            path: '/admin/taxes',            roles: COMPANY, page: 'admin/TaxConfigs' },
    { label: 'Currencies',       path: '/admin/currencies',       roles: COMPANY, page: 'admin/Currencies' },
    { label: 'Account mappings', path: '/admin/account-mappings', roles: FINANCE, page: 'admin/AccountMappings' },
    { label: 'Policies',         path: '/admin/policies',         roles: COMPANY, page: 'admin/Policies' },
    { label: 'Users',            path: '/admin/users',            roles: USERS,   page: 'admin/Users' },
    { label: 'Audit log',        path: '/admin/audit',            roles: AUDIT,   page: 'admin/AuditLog' },
  ]},

  { group: 'Procurement', icon: ICON_KEYS.procurement, items: [
    // Order follows the buying flow: need -> source -> order -> receive -> bill.
    { label: 'Requisitions',      path: '/procurement/requisitions',    roles: REQUISITIONS, page: 'procurement/Requisitions' },
    { label: 'Suppliers',         path: '/procurement/suppliers',       roles: SUPPLIERS,    page: 'procurement/Suppliers' },
    { label: 'Contracts',         path: '/procurement/contracts',       roles: SUPPLIERS,    page: 'procurement/Contracts' },
    { label: 'Purchase orders',   path: '/procurement/purchase-orders', roles: PROCUREMENT,  page: 'procurement/PurchaseOrders' },
    { label: 'Goods receipts',    path: '/procurement/receipts',        roles: RECEIPTS,     page: 'procurement/GoodsReceipts' },
    { label: 'Purchase invoices', path: '/procurement/invoices',        roles: PROCUREMENT,  page: 'procurement/PurchaseInvoices' },
    { label: 'Returns',           path: '/procurement/returns',         roles: PROCUREMENT,  page: 'procurement/Returns' },
  ]},

  { group: 'Inventory', icon: ICON_KEYS.inventory, items: [
    { label: 'Products',       path: '/inventory/products',       roles: INVENTORY, page: 'inventory/Products' },
    { label: 'Tanks & depots', path: '/inventory/tanks',          roles: INVENTORY, page: 'inventory/Tanks' },
    { label: 'Stock',          path: '/inventory/stock',          roles: INVENTORY, page: 'inventory/Stock' },
    { label: 'Adjustments',    path: '/inventory/adjustments',    roles: INVENTORY, page: 'inventory/Adjustments' },
    { label: 'Reconciliation', path: '/inventory/reconciliation', roles: INVENTORY, page: 'inventory/Reconciliation' },
  ]},

  { group: 'Sales', icon: ICON_KEYS.sales, items: [
    { label: 'Customers',      path: '/sales/customers',    roles: CUSTOMERS, page: 'sales/Customers' },
    { label: 'Contracts',      path: '/sales/contracts',    roles: SALES,     page: 'sales/Contracts' },
    { label: 'Pricing',        path: '/sales/pricing',      roles: SALES,     page: 'sales/Pricing' },
    { label: 'Sales orders',   path: '/sales/orders',       roles: SALES,     page: 'sales/SalesOrders' },
    { label: 'Sales invoices', path: '/sales/invoices',     roles: SALES,     page: 'sales/SalesInvoices' },
    { label: 'Credit notes',   path: '/sales/credit-notes', roles: SALES,     page: 'sales/CreditNotes' },
  ]},

  { group: 'Logistics', icon: ICON_KEYS.logistics, items: [
    { label: 'Shipments',            path: '/logistics/shipments',            roles: SHIPMENTS, page: 'logistics/Shipments' },
    { label: 'Customs',              path: '/logistics/customs',              roles: CUSTOMS,   page: 'logistics/Customs' },
    { label: 'Vehicles',             path: '/logistics/vehicles',             roles: FLEET,     page: 'logistics/Vehicles' },
    { label: 'Drivers',              path: '/logistics/drivers',              roles: FLEET,     page: 'logistics/Drivers' },
    { label: 'Maintenance',          path: '/logistics/maintenance',          roles: FLEET,     page: 'logistics/Maintenance' },
    { label: 'Transporters',         path: '/logistics/transporters',         roles: TRANSPORT, page: 'logistics/Transporters' },
    { label: 'Bookings',             path: '/logistics/bookings',             roles: TRANSPORT, page: 'logistics/Bookings' },
    { label: 'Transporter invoices', path: '/logistics/transporter-invoices', roles: TRANSPORT, page: 'logistics/TransporterInvoices' },
  ]},

  { group: 'Finance', icon: ICON_KEYS.finance, items: [
    { label: 'Expenses',     path: '/finance/expenses',  roles: EXPENSES,  page: 'finance/Expenses' },
    { label: 'Payments',     path: '/finance/payments',  roles: PAYMENTS,  page: 'finance/Payments' },
    { label: 'Bank',         path: '/finance/bank',      roles: PAYMENTS,  page: 'finance/Bank' },
    { label: 'Accounts',     path: '/finance/accounts',  roles: FINANCE,   page: 'finance/Accounts' },
    { label: 'Journals',     path: '/finance/journals',  roles: FINANCE,   page: 'finance/Journals' },
    { label: 'Fixed assets', path: '/finance/assets',    roles: ASSETS,    page: 'finance/FixedAssets' },
    { label: 'Employees',    path: '/finance/employees', roles: EMPLOYEES, page: 'finance/Employees' },
    { label: 'Payroll',      path: '/finance/payroll',   roles: PAYROLL,   page: 'finance/Payroll' },
  ]},

  { group: 'Group', icon: ICON_KEYS.group, items: [
    { label: 'Intercompany',   path: '/group/intercompany',  roles: GROUP,        page: 'group/Intercompany' },
    { label: 'Consolidation',  path: '/group/consolidation', roles: GROUP,        page: 'group/Consolidation' },
    { label: 'FX revaluation', path: '/group/fx',            roles: CLOSE_PERIOD, page: 'group/FxRevaluation' },
  ]},

  { group: 'Intelligence', icon: ICON_KEYS.reports, items: [
    { label: 'Reports',      path: '/reports', roles: REPORTS, page: 'reports/Reports' },
    { label: 'AI assistant', path: '/ai',      roles: AI,      page: 'ai/Assistant' },
  ]},

  { label: 'Approvals',     path: '/approvals',     icon: 'check', roles: null, page: 'admin/Approvals' },
  { label: 'Notifications', path: '/notifications', icon: 'bell',  roles: null, page: 'admin/Notifications' },
  { label: 'Profile',       path: '/profile',       icon: 'user',  roles: null, page: 'auth/Profile' },
];

/** Detail routes (not in the sidebar, but need roles + a page key). */
const DETAIL_ROUTES = [
  { path: '/procurement/requisitions/:id',    roles: REQUISITIONS, page: 'procurement/RequisitionDetail' },
  { path: '/procurement/suppliers/:id',       roles: SUPPLIERS,    page: 'procurement/SupplierDetail' },
  { path: '/procurement/purchase-orders/:id', roles: PROCUREMENT,  page: 'procurement/PurchaseOrderDetail' },
  { path: '/sales/customers/:id',             roles: CUSTOMERS,    page: 'sales/CustomerDetail' },
  { path: '/sales/orders/:id',                roles: SALES,        page: 'sales/SalesOrderDetail' },
  { path: '/sales/invoices/:id',              roles: SALES,        page: 'sales/SalesInvoiceDetail' },
  { path: '/logistics/shipments/:id',         roles: SHIPMENTS,    page: 'logistics/ShipmentDetail' },
];

/* ------------------------------------------------------------------ helpers */

const can = (canFn, roles) => roles == null || (typeof canFn === 'function' && canFn(roles));

export function visibleNav(canFn) {
  const out = [];
  for (const node of NAV) {
    if (node.group) {
      const items = node.items.filter((i) => can(canFn, i.roles));
      if (items.length) out.push({ group: node.group, icon: node.icon, items });
    } else if (can(canFn, node.roles)) {
      out.push({ label: node.label, path: node.path, icon: node.icon });
    }
  }
  return out;
}

export function flatNav(canFn) {
  const rows = [];
  for (const node of NAV) {
    if (node.group) {
      for (const it of node.items) {
        if (can(canFn, it.roles)) rows.push({ label: it.label, path: it.path, roles: it.roles ?? null });
      }
    } else if (can(canFn, node.roles)) {
      rows.push({ label: node.label, path: node.path, roles: node.roles ?? null });
    }
  }
  return rows;
}

/** Route table consumed by App.jsx (<Route> generator). */
export function allRoutes() {
  const rows = [];
  for (const node of NAV) {
    if (node.group) {
      for (const it of node.items) rows.push({ path: it.path, roles: it.roles, page: it.page });
    } else {
      rows.push({ path: node.path, roles: node.roles, page: node.page });
    }
  }
  for (const r of DETAIL_ROUTES) rows.push(r);
  return rows;
}

export function firstAllowedPath(canFn) {
  for (const node of NAV) {
    if (node.group) {
      for (const it of node.items) if (can(canFn, it.roles)) return it.path;
    } else if (can(canFn, node.roles)) {
      return node.path;
    }
  }
  return '/profile';
}

export function titleFor(pathname) {
  for (const node of NAV) {
    if (node.group) {
      const hit = node.items.find((i) => i.path === pathname);
      if (hit) return hit.label;
    } else if (node.path === pathname) {
      return node.label;
    }
  }
  for (const r of DETAIL_ROUTES) {
    const re = new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+') + '$');
    if (re.test(pathname)) {
      const base = r.path.replace(/:\w+/g, '').replace(/\/+$/, '').split('/').pop() || '';
      return base.charAt(0).toUpperCase() + base.slice(1);
    }
  }
  return pathname;
}