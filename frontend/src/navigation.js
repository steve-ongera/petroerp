/**
 * Navigation registry.
 *
 * Exports:
 *   visibleNav(can)       → tree for Sidebar.jsx
 *   flatNav(can)          → flat list for Navbar.jsx search
 *   allRoutes()           → [{ path, perm, page }] for App.jsx router
 *   firstAllowedPath(can) → first page the user can open (<Home/>)
 *   titleFor(pathname)    → page title for document.title
 *
 * Pure data + helpers. No JSX.
 */

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
  { label: 'Dashboard', path: '/dashboard', icon: ICON_KEYS.dashboard, perm: 'reports.view', page: 'dashboard/Dashboard' },

  { group: 'Administration', icon: ICON_KEYS.admin, items: [
    { label: 'Companies',        path: '/admin/companies',        perm: 'company.view', page: 'admin/Companies' },
    { label: 'Structure',        path: '/admin/structure',        perm: 'company.view', page: 'admin/Structure' },
    { label: 'Fiscal years',     path: '/admin/fiscal-years',     perm: 'finance.view', page: 'admin/FiscalYears' },
    { label: 'Taxes',            path: '/admin/taxes',            perm: 'company.view', page: 'admin/TaxConfigs' },
    { label: 'Currencies',       path: '/admin/currencies',       perm: 'company.view', page: 'admin/Currencies' },
    { label: 'Account mappings', path: '/admin/account-mappings', perm: 'finance.view', page: 'admin/AccountMappings' },
    { label: 'Policies',         path: '/admin/policies',         perm: 'company.view', page: 'admin/Policies' },
    { label: 'Users',            path: '/admin/users',            perm: 'admin.view',   page: 'admin/Users' },
    { label: 'Audit log',        path: '/admin/audit',            perm: 'audit.view',   page: 'admin/AuditLog' },
  ]},

  { group: 'Procurement', icon: ICON_KEYS.procurement, items: [
    { label: 'Suppliers',         path: '/procurement/suppliers',       perm: 'suppliers.view',   page: 'procurement/Suppliers' },
    { label: 'Contracts',         path: '/procurement/contracts',       perm: 'suppliers.view',   page: 'procurement/Contracts' },
    { label: 'Requisitions',      path: '/procurement/requisitions',    perm: 'procurement.view', page: 'procurement/Requisitions' },
    { label: 'Purchase orders',   path: '/procurement/purchase-orders', perm: 'procurement.view', page: 'procurement/PurchaseOrders' },
    { label: 'Goods receipts',    path: '/procurement/receipts',        perm: 'inventory.view',   page: 'procurement/GoodsReceipts' },
    { label: 'Purchase invoices', path: '/procurement/invoices',        perm: 'procurement.view', page: 'procurement/PurchaseInvoices' },
    { label: 'Returns',           path: '/procurement/returns',         perm: 'procurement.view', page: 'procurement/Returns' },
  ]},

  { group: 'Inventory', icon: ICON_KEYS.inventory, items: [
    { label: 'Products',       path: '/inventory/products',       perm: 'inventory.view', page: 'inventory/Products' },
    { label: 'Tanks & depots', path: '/inventory/tanks',          perm: 'inventory.view', page: 'inventory/Tanks' },
    { label: 'Stock',          path: '/inventory/stock',          perm: 'inventory.view', page: 'inventory/Stock' },
    { label: 'Adjustments',    path: '/inventory/adjustments',    perm: 'inventory.view', page: 'inventory/Adjustments' },
    { label: 'Reconciliation', path: '/inventory/reconciliation', perm: 'inventory.view', page: 'inventory/Reconciliation' },
  ]},

  { group: 'Sales', icon: ICON_KEYS.sales, items: [
    { label: 'Customers',      path: '/sales/customers',    perm: 'customers.view', page: 'sales/Customers' },
    { label: 'Contracts',      path: '/sales/contracts',    perm: 'sales.view',     page: 'sales/Contracts' },
    { label: 'Pricing',        path: '/sales/pricing',      perm: 'sales.view',     page: 'sales/Pricing' },
    { label: 'Sales orders',   path: '/sales/orders',       perm: 'sales.view',     page: 'sales/SalesOrders' },
    { label: 'Sales invoices', path: '/sales/invoices',     perm: 'sales.view',     page: 'sales/SalesInvoices' },
    { label: 'Credit notes',   path: '/sales/credit-notes', perm: 'sales.view',     page: 'sales/CreditNotes' },
  ]},

  { group: 'Logistics', icon: ICON_KEYS.logistics, items: [
    { label: 'Shipments',            path: '/logistics/shipments',            perm: 'shipments.view', page: 'logistics/Shipments' },
    { label: 'Customs',              path: '/logistics/customs',              perm: 'customs.view',   page: 'logistics/Customs' },
    { label: 'Vehicles',             path: '/logistics/vehicles',             perm: 'fleet.view',     page: 'logistics/Vehicles' },
    { label: 'Drivers',              path: '/logistics/drivers',              perm: 'fleet.view',     page: 'logistics/Drivers' },
    { label: 'Maintenance',          path: '/logistics/maintenance',          perm: 'fleet.view',     page: 'logistics/Maintenance' },
    { label: 'Transporters',         path: '/logistics/transporters',         perm: 'transport.view', page: 'logistics/Transporters' },
    { label: 'Bookings',             path: '/logistics/bookings',             perm: 'transport.view', page: 'logistics/Bookings' },
    { label: 'Transporter invoices', path: '/logistics/transporter-invoices', perm: 'transport.view', page: 'logistics/TransporterInvoices' },
  ]},

  { group: 'Finance', icon: ICON_KEYS.finance, items: [
    { label: 'Expenses',     path: '/finance/expenses', perm: 'expenses.view', page: 'finance/Expenses' },
    { label: 'Payments',     path: '/finance/payments', perm: 'payments.view', page: 'finance/Payments' },
    { label: 'Bank',         path: '/finance/bank',     perm: 'payments.view', page: 'finance/Bank' },
    { label: 'Accounts',     path: '/finance/accounts', perm: 'finance.view',  page: 'finance/Accounts' },
    { label: 'Journals',     path: '/finance/journals', perm: 'finance.view',  page: 'finance/Journals' },
    { label: 'Fixed assets', path: '/finance/assets',   perm: 'assets.view',   page: 'finance/FixedAssets' },
    { label: 'Payroll',      path: '/finance/payroll',  perm: 'hr.view',       page: 'finance/Payroll' },
  ]},

  { group: 'Group', icon: ICON_KEYS.group, items: [
    { label: 'Intercompany',   path: '/group/intercompany',  perm: 'group.view', page: 'group/Intercompany' },
    { label: 'Consolidation',  path: '/group/consolidation', perm: 'group.view', page: 'group/Consolidation' },
    { label: 'FX revaluation', path: '/group/fx',            perm: 'finance.close_period', page: 'group/FxRevaluation' },
  ]},

  { group: 'Intelligence', icon: ICON_KEYS.reports, items: [
    { label: 'Reports',      path: '/reports', perm: 'reports.view', page: 'reports/Reports' },
    { label: 'AI assistant', path: '/ai',      perm: 'ai.view',      page: 'ai/Assistant' },
  ]},

  { label: 'Approvals',     path: '/approvals',     icon: 'check', perm: null, page: 'admin/Approvals' },
  { label: 'Notifications', path: '/notifications', icon: 'bell',  perm: null, page: 'admin/Notifications' },
  { label: 'Profile',       path: '/profile',       icon: 'user',  perm: null, page: 'auth/Profile' },
];

/**
 * Detail routes (not in the sidebar, but need a permission + page key).
 * Update these when you add new detail pages in App.jsx / navigation.js.
 */
const DETAIL_ROUTES = [
  { path: '/procurement/suppliers/:id',        perm: 'suppliers.view',   page: 'procurement/SupplierDetail' },
  { path: '/procurement/purchase-orders/:id',  perm: 'procurement.view', page: 'procurement/PurchaseOrderDetail' },
  { path: '/sales/customers/:id',              perm: 'customers.view',   page: 'sales/CustomerDetail' },
  { path: '/sales/orders/:id',                 perm: 'sales.view',       page: 'sales/SalesOrderDetail' },
  { path: '/sales/invoices/:id',               perm: 'sales.view',       page: 'sales/SalesInvoiceDetail' },
  { path: '/logistics/shipments/:id',          perm: 'shipments.view',   page: 'logistics/ShipmentDetail' },
];

/* ------------------------------------------------------------------ helpers */

const can = (canFn, perm) => !perm || (typeof canFn === 'function' && canFn(perm));

export function visibleNav(canFn) {
  const out = [];
  for (const node of NAV) {
    if (node.group) {
      const items = node.items.filter((i) => can(canFn, i.perm));
      if (items.length) out.push({ group: node.group, icon: node.icon, items });
    } else if (can(canFn, node.perm)) {
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
        if (can(canFn, it.perm)) rows.push({ label: it.label, path: it.path, perm: it.perm || null });
      }
    } else if (can(canFn, node.perm)) {
      rows.push({ label: node.label, path: node.path, perm: node.perm || null });
    }
  }
  return rows;
}

/** Route table consumed by App.jsx (<Route> generator). */
export function allRoutes() {
  const rows = [];
  for (const node of NAV) {
    if (node.group) {
      for (const it of node.items) rows.push({ path: it.path, perm: it.perm, page: it.page });
    } else {
      rows.push({ path: node.path, perm: node.perm, page: node.page });
    }
  }
  for (const r of DETAIL_ROUTES) rows.push(r);
  return rows;
}

export function firstAllowedPath(canFn) {
  for (const node of NAV) {
    if (node.group) {
      for (const it of node.items) if (can(canFn, it.perm)) return it.path;
    } else if (can(canFn, node.perm)) {
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
      // Title from path segment, e.g. ".../:id" → "Supplier"
      const base = r.path.replace(/:\w+/g, '').replace(/\/+$/, '').split('/').pop() || '';
      return base.charAt(0).toUpperCase() + base.slice(1);
    }
  }
  return pathname;
}