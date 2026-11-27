/**
 * PetroERP API client - every backend endpoint in one place.
 *
 *  - No dependencies (fetch based). JWT access token is kept in memory, the refresh token in sessionStorage.
 *  - A 401 triggers ONE silent refresh + retry; if that fails the session is cleared and the app is told
 *    (see setUnauthorizedHandler).
 *  - Business-rule errors from the server arrive as  400 {"detail": "..."}  and are thrown as ApiError;
 *    use errorMessage(err) to show them.
 *  - The server is the only authority for permissions, entity access, calculations and postings.
 *    Nothing here calculates money.
 *
 *  Usage
 *      import api from '../services/api';
 *      const page  = await api.suppliers.list({ company: 1, search: 'kpc', page: 1 });   // {count, results}
 *      const rows  = await api.products.listAll();                                         // every page
 *      await api.purchaseOrders.receive(5, { line: 9, tank: 2, observed_volume: '50000' });
 *      await api.reports.download('trial-balance', { company: 1 }, 'xlsx');
 *
 *  Query params: company, status, <fk>, date_from, date_to, search, ordering, page, page_size, export=xlsx|pdf
 */

const BASE = (import.meta.env?.VITE_API_URL || 'http://localhost:8000/api').replace(/\/+$/, '');
const REFRESH_KEY = 'petroerp.refresh';

// ------------------------------------------------------------------ session
let accessToken = null;
let onUnauthorized = () => {};
let refreshing = null;

export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn || (() => {}); };
const store = () => (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
const getRefresh = () => store()?.getItem(REFRESH_KEY) || null;
const setTokens = ({ access, refresh }) => {
  if (access) accessToken = access;
  if (refresh) store()?.setItem(REFRESH_KEY, refresh);
};
const clearTokens = () => { accessToken = null; store()?.removeItem(REFRESH_KEY); };

export class ApiError extends Error {
  constructor(status, data) {
    super(extractMessage(data) || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function extractMessage(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data.detail) return Array.isArray(data.detail) ? data.detail.join(' ') : String(data.detail);
  if (Array.isArray(data)) return data.join(' ');
  // DRF field errors: {field: ["msg"]}
  return Object.entries(data)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? extractMessage(v) : v}`)
    .join(' | ');
}

/** Human-readable message for any thrown error. */
export const errorMessage = (e) => (e instanceof ApiError ? e.message : e?.message || 'Unexpected error');
/** Field-level errors ({field: "message"}) for forms. */
export const fieldErrors = (e) => {
  if (!(e instanceof ApiError) || !e.data || typeof e.data !== 'object' || e.data.detail) return {};
  return Object.fromEntries(Object.entries(e.data).map(([k, v]) => [k, Array.isArray(v) ? v.join(' ') : String(v)]));
};

// ------------------------------------------------------------------ transport
const qs = (params = {}) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.append(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
};

async function refreshAccess() {
  const refresh = getRefresh();
  if (!refresh) throw new ApiError(401, { detail: 'Session expired.' });
  refreshing ||= fetch(`${BASE}/auth/refresh/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh }),
  }).then(async (r) => {
    if (!r.ok) throw new ApiError(401, { detail: 'Session expired. Please sign in again.' });
    setTokens(await r.json());
  }).finally(() => { refreshing = null; });
  return refreshing;
}

async function request(method, path, { params, body, blob = false, auth = true, _retry = false } = {}) {
  const headers = {};
  let payload;
  if (body instanceof FormData) payload = body;                       // browser sets the multipart boundary
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}${qs(params)}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, { detail: 'Cannot reach the server. Check your connection.' });
  }

  if (res.status === 401 && auth && !_retry && getRefresh()) {
    try { await refreshAccess(); return request(method, path, { params, body, blob, auth, _retry: true }); }
    catch { clearTokens(); onUnauthorized(); throw new ApiError(401, { detail: 'Session expired. Please sign in again.' }); }
  }
  if (res.status === 401 && auth) { clearTokens(); onUnauthorized(); }

  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, data);
  }
  if (blob) {
    const cd = res.headers.get('Content-Disposition') || '';
    const filename = /filename="?([^";]+)"?/i.exec(cd)?.[1] || 'download';
    return { blob: await res.blob(), filename };
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const get = (path, params) => request('GET', path, { params });
const post = (path, body = {}, params) => request('POST', path, { body, params });
const put = (path, body) => request('PUT', path, { body });
const patch = (path, body) => request('PATCH', path, { body });
const del = (path) => request('DELETE', path);

/** Build a FormData from a plain object (files stay File objects, null/undefined are skipped). */
export const toFormData = (obj = {}) => {
  const fd = new FormData();
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Blob))) fd.append(k, JSON.stringify(v));
    else fd.append(k, v);
  });
  return fd;
};

/** Save a {blob, filename} result to disk. */
export function saveBlob({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const download = async (path, params) => saveBlob(await request('GET', path, { params, blob: true }));

// ------------------------------------------------------------------ resource factories
/** Minimal read access: list / get / listAll (resources served by plain read-only views). */
const plain = (name) => ({
  list: (params) => get(`/${name}/`, params),
  get: (id) => get(`/${name}/${id}/`),
  /** Fetch every page (use for dropdowns). */
  async listAll(params = {}) {
    let page = 1; const out = [];
    for (;;) {
      const r = await get(`/${name}/`, { ...params, page, page_size: 500 });
      out.push(...(r.results || r));
      if (!r.next) return out;
      page += 1;
    }
  },
});

/** Standard read-only resource: plain + history / export / attachments. */
const readOnly = (name) => ({
  ...plain(name),
  /** Audit trail for one record. */
  history: (id) => get(`/${name}/${id}/history/`),
  /** Download the current (filtered) list as 'xlsx' or 'pdf'. */
  export: (params, fmt = 'xlsx') => download(`/${name}/`, { ...params, export: fmt }),
  /** Supporting documents attached to a record. */
  attachments: (id) => get(`/${name}/${id}/attachments/`),
  attach: (id, file, description = '') => post(`/${name}/${id}/attachments/`, toFormData({ file, description })),
});

/** Full CRUD resource. */
const crud = (name) => ({
  ...readOnly(name),
  create: (data) => post(`/${name}/`, data),
  update: (id, data) => put(`/${name}/${id}/`, data),
  patch: (id, data) => patch(`/${name}/${id}/`, data),
  remove: (id) => del(`/${name}/${id}/`),
});

/** Documents that go through the approval workflow (server: services.APPROVAL_FLOW). */
const withSubmit = (name, base) => ({
  ...base,
  /** Send to approval, or auto-approve when no approval policy applies to the amount. */
  submit: (id) => post(`/${name}/${id}/submit/`),
});
/** Contracts / quotations / declarations whose status is changed directly (server restricts the allowed values). */
const withStatus = (name, base) => ({
  ...base,
  setStatus: (id, status) => post(`/${name}/${id}/set-status/`, { status }),
});

// ------------------------------------------------------------------ authentication
export const auth = {
  hasSession: () => Boolean(accessToken || getRefresh()),
  /** Returns { access, refresh, user }. Pass `otp` when the account has MFA enabled. */
  async login(username, password, otp) {
    const data = await request('POST', '/auth/login/', { body: { username, password, ...(otp ? { otp } : {}) }, auth: false });
    setTokens(data);
    return data;
  },
  /** Restores the session after a page reload (uses the refresh token). */
  async restore() {
    if (!accessToken) await refreshAccess();
    return get('/auth/me/');
  },
  me: () => get('/auth/me/'),
  logout: () => { clearTokens(); },
  /** Step 1: get a secret + otpauth URI for the authenticator app. Step 2: confirm with a code. */
  mfaSetup: () => post('/auth/mfa/', {}),
  mfaEnable: (otp) => post('/auth/mfa/', { otp }),
  /** Enumerations for the UI: shipment statuses & allowed transitions, cost components, runnable reports. */
  meta: () => get('/meta/'),
};

// ------------------------------------------------------------------ administration & company
const users = {
  ...plain('users'),
  create: (d) => post('/users/', d),
  update: (id, d) => put(`/users/${id}/`, d),
  patch: (id, d) => patch(`/users/${id}/`, d),
  remove: (id) => del(`/users/${id}/`),
};
const roles = plain('roles');
const companies = crud('companies');
const branches = crud('branches');
const departments = crud('departments');
const currencies = crud('currencies');
const exchangeRates = crud('exchange-rates');
const taxConfigs = { ...crud('tax-configs'), /** Professional verification by a DIFFERENT user. */ verify: (id) => post(`/tax-configs/${id}/verify/`) };
const numberSequences = crud('number-sequences');
const approvalPolicies = crud('approval-policies');
const accountMappings = crud('account-mappings');
const borderCrossings = crud('border-crossings');
const complianceRequirements = crud('compliance-requirements');
const fiscalYears = { ...crud('fiscal-years'), /** Year-end closing entry + closes all periods. */ close: (id) => post(`/fiscal-years/${id}/close/`) };
const accountingPeriods = {
  ...readOnly('accounting-periods'),
  close: (id) => post(`/accounting-periods/${id}/close/`),
  reopen: (id) => post(`/accounting-periods/${id}/reopen/`),
};

// ------------------------------------------------------------------ suppliers & procurement
const suppliers = {
  ...crud('suppliers'),
  statement: (id) => get(`/suppliers/${id}/statement/`),
  priceHistory: (id) => get(`/suppliers/${id}/price-history/`),
  performance: (id) => get(`/suppliers/${id}/performance/`),
};
const supplierContacts = crud('supplier-contacts');
const supplierContracts = withStatus('supplier-contracts', crud('supplier-contracts'));
const supplierPrices = crud('supplier-prices');
const supplierQuotations = withStatus('supplier-quotations', crud('supplier-quotations'));
const purchaseRequisitions = withStatus('purchase-requisitions', withSubmit('purchase-requisitions', crud('purchase-requisitions')));
const purchaseOrders = {
  ...withSubmit('purchase-orders', crud('purchase-orders')),
  /** body: { line, tank, observed_volume, standardized_volume?, temperature_c?, density?, receipt_date?, delivery_note?, vehicle_reg? } */
  receive: (id, body) => post(`/purchase-orders/${id}/receive/`, body),
  cancel: (id) => post(`/purchase-orders/${id}/cancel/`),
};
const goodsReceipts = readOnly('goods-receipts');
/** body: { goods_receipt, quantity, return_date?, reason? } */
const purchaseReturns = { list: readOnly('purchase-returns').list, get: readOnly('purchase-returns').get, create: (b) => post('/purchase-returns/', b) };
const purchaseInvoices = {
  ...crud('purchase-invoices'),
  /** Run the three-way match (PO / invoice / receipts) without posting. */
  match: (id) => post(`/purchase-invoices/${id}/match/`),
  /** override=true needs the procurement.override_match permission. */
  post: (id, override = false) => post(`/purchase-invoices/${id}/post/`, { override }),
};
const supplierCreditNotes = { ...crud('supplier-credit-notes'), post: (id) => post(`/supplier-credit-notes/${id}/post/`) };

// ------------------------------------------------------------------ products, depots, tanks, stock
const products = crud('products');
const depots = crud('depots');
const storageTanks = { ...crud('storage-tanks'), /** Opening, receipts, issues ... and book balance on a date. */ position: (id, date) => get(`/storage-tanks/${id}/position/`, { date }) };
const tankCalibrations = crud('tank-calibrations');
const tankReadings = crud('tank-readings');
const tankReconciliations = {
  ...readOnly('tank-reconciliations'),
  /** body: { tank, date, physical_qty } - records the variance only. */
  create: (b) => post('/tank-reconciliations/', b),
  /** Turns a variance into a PENDING adjustment that must be approved (Approvals page). */
  raiseAdjustment: (id, reason = '') => post(`/tank-reconciliations/${id}/raise-adjustment/`, { reason }),
};
const stockMovements = readOnly('stock-movements');
const stockBalances = readOnly('stock-balances');
const stockReservations = readOnly('stock-reservations');
const stockAdjustments = readOnly('stock-adjustments');
const stockTransfers = readOnly('stock-transfers');
const stock = {
  /** body: { company, from_tank, to_tank, quantity, date, notes? } */
  transfer: (b) => post('/stock/transfer/', b),
  /** body: { tank, product, quantity, unit_cost, date } */
  opening: (b) => post('/stock/opening/', b),
};

// ------------------------------------------------------------------ customers & sales
const customers = {
  ...crud('customers'),
  statement: (id) => get(`/customers/${id}/statement/`),
  creditStatus: (id) => get(`/customers/${id}/credit-status/`),
  /** Needs credit.override. */
  setCreditLimit: (id, limit, reason = '') => post(`/customers/${id}/set-credit-limit/`, { limit, reason }),
};
const customerContacts = crud('customer-contacts');
const customerCreditLimits = readOnly('customer-credit-limits');
const customerContracts = withStatus('customer-contracts', crud('customer-contracts'));
const marketPrices = crud('market-prices');
const salesQuotations = withStatus('sales-quotations', crud('sales-quotations'));
const salesOrders = {
  ...withSubmit('sales-orders', crud('sales-orders')),
  /** body: { depot } - reserves stock for every line. */
  reserve: (id, depot) => post(`/sales-orders/${id}/reserve/`, { depot }),
  cancel: (id) => post(`/sales-orders/${id}/cancel/`),
};
const salesInvoices = {
  ...crud('sales-invoices'),
  /** override=true needs credit.override (credit limit is enforced on the server). */
  post: (id, override = false) => post(`/sales-invoices/${id}/post/`, { override }),
};
const salesCreditNotes = { ...crud('sales-credit-notes'), post: (id) => post(`/sales-credit-notes/${id}/post/`) };
const pricing = {
  /**
   * Preview a price. method: FIXED | MARKET | COST_PLUS
   *   FIXED: { contract_price }          MARKET: { base_price, premium }
   *   COST_PLUS: { cost } + exactly one of { profit_per_litre | markup_pct | margin_pct }
   * Returns selling_price, profit_per_litre, markup_pct (on cost) and margin_pct (on price) separately.
   */
  calculate: (b) => post('/pricing/calculate/', b),
};

// ------------------------------------------------------------------ owned fleet
const vehicles = {
  ...crud('vehicles'),
  /** Creates the Expense (money) + VehicleExpense (litres/odometer) together. */
  logExpense: (id, b) => post(`/vehicles/${id}/log-expense/`, b),
  /** cost/km, cost/trip, cost per delivered litre, revenue, profit. Params: date_from, date_to. */
  metrics: (id, params) => get(`/vehicles/${id}/metrics/`, params),
};
const trailers = crud('trailers');
const drivers = {
  ...crud('drivers'),
  profile: (id) => get(`/drivers/${id}/profile/`),
  uploadPhoto: (id, file) => post(`/drivers/${id}/photo/`, toFormData({ file })),
  removePhoto: (id) => request('DELETE', `/drivers/${id}/photo/`),
};

const vehicleAssignments = readOnly('vehicle-assignments');
const vehicleMaintenance = crud('vehicle-maintenance');
const vehicleExpenses = readOnly('vehicle-expenses');
const vehicleDocuments = crud('vehicle-documents');

// ------------------------------------------------------------------ third-party transport
const transporters = {
  ...crud('transporters'),
  performance: (id) => get(`/transporters/${id}/performance/`),
  statement: (id) => get(`/transporters/${id}/statement/`),
};
const transporterContracts = withStatus('transporter-contracts', crud('transporter-contracts'));
const transporterRates = crud('transporter-rates');
const transporterVehicles = crud('transporter-vehicles');
const transportBookings = {
  ...withSubmit('transport-bookings', crud('transport-bookings')),
  /** params: { transporter, origin, destination, date } -> contracted rate, if any. */
  suggestRate: (params) => get('/transport-bookings/suggest-rate/', params),
};
const transporterInvoices = { ...crud('transporter-invoices'), post: (id) => post(`/transporter-invoices/${id}/post/`) };

// ------------------------------------------------------------------ shipments, customs
const shipments = {
  ...withSubmit('shipments', crud('shipments')),
  /**
   * Manual tracking update. body: { new_status, when?, location?, comments?, confirmation_type?, confirmed_by?, attachment?: File }
   * Sent as multipart so a photo/document can accompany the update.
   */
  updateStatus: (id, b) => post(`/shipments/${id}/update-status/`, toFormData(b)),
  /** body: { lines: [{ id, loaded_quantity, tank?, compartment? }], loading_date? } (status must be LOADING) */
  recordLoading: (id, b) => post(`/shipments/${id}/record-loading/`, b),
  /** body: { distance_km?, fuel_issued_litres?, fuel_used_litres?, expected_delivery? } */
  tripData: (id, b) => post(`/shipments/${id}/trip-data/`, b),
  /**
   * body: { delivered_quantity, delivery_date?, is_final?, received_by?, receiver_contact?, delivery_note_no?, notes?,
   *         pod_file?: File (signed delivery note), receiver_signature?: File }. A shortage needs approval.
   */
  recordDelivery: (id, b) => post(`/shipments/${id}/record-delivery/`, toFormData(b)),
  /** Compute a new cost-sheet version. { finalize?: true, reopen?: true, notes? } (finalize/reopen need costing.finalize). */
  cost: (id, b = {}) => post(`/shipments/${id}/cost/`, b),
  costSheets: (id) => get(`/shipments/${id}/cost-sheets/`),
  exportCostSheet: (id, fmt = 'xlsx') => download(`/shipments/${id}/cost-sheet/export/`, { export: fmt }),
  fuel: (id) => get(`/shipments/${id}/fuel/`),
  /** Vehicle / driver / truck readiness checklist: { ready, checks:[{key,label,ok,detail}], vehicle, driver, ... } */
  compliance: (id) => get(`/shipments/${id}/compliance/`),
  timeline: (id) => get(`/shipments/${id}/timeline/`),
};
const shipmentStatusHistory = readOnly('shipment-status-history');
const shipmentStages = crud('shipment-stages');
const shipmentDocuments = {
  ...crud('shipment-documents'),
  /** data: { company, shipment, doc_type, number?, notes?, file: File } */
  upload: (data) => post('/shipment-documents/', toFormData(data)),
};
const shipmentDeliveries = readOnly('shipment-deliveries');
const shipmentAllocations = readOnly('shipment-allocations');
const costSheets = readOnly('cost-sheets');
const exportDeclarations = withStatus('export-declarations', crud('export-declarations'));
const complianceChecks = crud('compliance-checks');
/**
 * Trip budget -> advance -> reconciliation.
 * create / update body: { shipment, recipient?, recipient_name, recipient_phone, payment_method, notes,
 *                         lines: [{ category, description, budget_amount, requested_amount, legal_basis, issuing_authority }] }
 * Approving / rejecting the advance itself is done through api.approvals (the request shows up on the Approvals page).
 */
const tripAdvances = {
  ...withSubmit('trip-advances', crud('trip-advances')),
  /** Approver reduces approved amounts while awaiting approval. lines: [{ id, approved_amount }] */
  adjust: (id, lines) => post(`/trip-advances/${id}/adjust/`, { lines }),
  /** body: { payment_method: CASH|MPESA|BANK, bank_account?, payment_reference?, recipient?, recipient_name?, recipient_phone? } */
  pay: (id, b) => post(`/trip-advances/${id}/pay/`, b),
  /** body: { lines: [{ id, actual_amount, receipt_no?, legal_basis?, issuing_authority? }], returned_amount?, return_reference?, notes? } */
  submitReconciliation: (id, b) => post(`/trip-advances/${id}/submit-reconciliation/`, b),
  /** A different user approves; draft expenses are created for the actual spend. */
  approveReconciliation: (id) => post(`/trip-advances/${id}/approve-reconciliation/`),
  rejectReconciliation: (id, comment = '') => post(`/trip-advances/${id}/reject-reconciliation/`, { comment }),
};



// ------------------------------------------------------------------ expenses & payments
const expenseCategories = crud('expense-categories');
const expenses = {
  ...withSubmit('expenses', crud('expenses')),
  /** Posts the journal (duplicate postings are rejected). */
  post: (id) => post(`/expenses/${id}/post/`),
  /** body: { method: DIRECT|PERCENT|AMOUNT|LITRES|EQUAL, targets: [{ shipment, percentage?, amount? }], replace? } */
  allocate: (id, b) => post(`/expenses/${id}/allocate/`, b),
};
const payments = {
  ...crud('payments'),
  /** Outgoing payments: send for approval. */
  submit: (id) => post(`/payments/${id}/submit/`),
  approve: (id, comment = '') => post(`/payments/${id}/approve/`, { comment }),
  /** Execute. body: { allocations: [{ sales_invoice | purchase_invoice | transporter_invoice | expense: id, amount }] } */
  post: (id, allocations = []) => post(`/payments/${id}/post/`, { allocations }),
  applyAdvance: (id, allocations) => post(`/payments/${id}/apply-advance/`, { allocations }),
  reverse: (id, reason = '') => post(`/payments/${id}/reverse/`, { reason }),
  /** M-Pesa / bank receipt -> likely customer and invoices (suggestion only). */
  suggestMatches: (id) => get(`/payments/${id}/suggest-matches/`),
};
const bankAccounts = {
  ...crud('bank-accounts'),
  /** Pass a File (CSV) or raw CSV text. Columns: date, description, reference, money_in, money_out, balance. */
  importStatement: (id, fileOrCsv) => post(`/bank-accounts/${id}/import-statement/`,
    typeof fileOrCsv === 'string' ? { csv: fileOrCsv } : toFormData({ file: fileOrCsv })),
  autoMatch: (id) => post(`/bank-accounts/${id}/auto-match/`),
  /** body: { statement_date, statement_balance, notes? } */
  reconcile: (id, b) => post(`/bank-accounts/${id}/reconcile/`, b),
  balance: (id, asOf) => get(`/bank-accounts/${id}/balance/`, { as_of: asOf }),
};
const bankTransactions = {
  ...readOnly('bank-transactions'),
  match: (id, payment) => post(`/bank-transactions/${id}/match/`, { payment }),
  ignore: (id) => post(`/bank-transactions/${id}/ignore/`),
};
const bankReconciliations = readOnly('bank-reconciliations');

// ------------------------------------------------------------------ general ledger, assets, payroll
const accounts = crud('accounts');
const journals = {
  ...plain('journals'),
  /** body: { company, date, description, lines: [{ account, debit, credit, narration?, shipment? }] } - must balance. */
  manual: (b) => post('/journals/manual/', b),
  /** Corrections are reversing entries; posted journals are never edited. body: { reason?, date? } */
  reverse: (id, b = {}) => post(`/journals/${id}/reverse/`, b),
};
const fixedAssets = {
  ...crud('fixed-assets'),
  /** body: { company, period_end } */
  runDepreciation: (b) => post('/fixed-assets/run-depreciation/', b),
  /** body: { proceeds, date, bank_account } */
  dispose: (id, b) => post(`/fixed-assets/${id}/dispose/`, b),
  transfer: (id, location) => post(`/fixed-assets/${id}/transfer/`, { location }),
};
const employees = crud('employees');
const leaveRequests = withStatus('leave-requests', crud('leave-requests'));
const payrollConfigs = crud('payroll-configs');
const payrollRuns = {
  ...crud('payroll-runs'),
  /** body: { overtime: { [employeeId]: amount } } */
  process: (id, overtime = {}) => post(`/payroll-runs/${id}/process/`, { overtime }),
  payslips: (id) => get(`/payroll-runs/${id}/payslips/`),
};

// ------------------------------------------------------------------ group accounting
const intercompany = {
  ...plain('intercompany'),
  /** body: { seller, buyer, product, quantity, transfer_price, currency, date, from_tank?, to_tank?, shipment?, notes? } - posts BOTH entities. */
  sale: (b) => post('/intercompany/sale/', b),
  /** body: { amount, date, seller_bank, buyer_bank } */
  settle: (id, b) => post(`/intercompany/${id}/settle/`, b),
  reconcile: (asOf) => post('/intercompany/reconcile/', { as_of: asOf }),
};
const consolidationRuns = {
  ...plain('consolidation-runs'),
  /** body: { period_start, period_end, reporting_currency? } */
  run: (b) => post('/consolidation-runs/run/', b),
  eliminations: (id) => get(`/consolidation-runs/${id}/eliminations/`),
};
const group = {
  /** Unrealised FX on open foreign-currency AR/AP. body: { company, as_of, post? } */
  revalue: (b) => post('/group/revalue/', b),
};

// ------------------------------------------------------------------ approvals, notifications, audit
const approvals = {
  ...readOnly('approvals'),
  approve: (id, comment = '') => post(`/approvals/${id}/approve/`, { comment }),
  reject: (id, comment = '') => post(`/approvals/${id}/reject/`, { comment }),
};
const notifications = {
  ...plain('notifications'),
  unread: () => get('/notifications/unread/'),
  read: (id) => post(`/notifications/${id}/read/`),
  readAll: () => post('/notifications/read-all/'),
};
const auditLogs = { ...plain('audit-logs'), /** Checks the hash chain for tampering. */ verify: () => get('/audit-logs/verify/') };
const alerts = crud('alerts');

// ------------------------------------------------------------------ dashboard, reports, AI
const dashboard = {
  /** params: { period: daily|weekly|monthly|annual, company, country, product, customer, date_from, date_to } */
  get: (params) => get('/dashboard/', params),
};
export const REPORT_GROUPS = {
  Financial: ['trial-balance', 'general-ledger', 'profit-and-loss', 'financial-position', 'cash-flow', 'equity-changes',
    'ar-aging', 'ap-aging', 'bank-reconciliation', 'vat'],
  Operational: ['daily-operations', 'daily-shipments', 'fuel-purchases', 'fuel-sales', 'tank-reconciliation', 'inventory-movement',
    'stock-valuation', 'shipment-costing', 'fuel-variance'],
  Fleet: ['owned-fleet', 'hired-fleet', 'vehicle-expenses', 'trip-costs', 'driver-expenses', 'vehicle-profitability'],
  Management: ['customer-profitability', 'product-profitability', 'shipment-profitability', 'transporter-profitability',
    'country-profitability', 'entity-profitability', 'group-consolidated'],
};
const reports = {
  /** Reports the current user is allowed to run. */
  list: () => get('/reports/'),
  /** Returns { title, columns, rows, summary }. params: company, country, date_from, date_to, product, customer, shipment, account */
  run: (name, params) => get(`/reports/${name}/`, params),
  /** Download as 'xlsx' or 'pdf'. */
  download: (name, params, fmt = 'xlsx') => download(`/reports/${name}/`, { ...params, export: fmt }),
};
const ai = {
  /** Natural-language question answered from real data. Never approves or posts anything. */
  ask: (question, filters = {}) => post('/ai/ask/', { question, ...filters }),
  /** Run anomaly / duplicate / fuel / credit-risk checks and store them as Alerts. */
  scan: (filters = {}) => post('/ai/scan/', filters),
  cashForecast: (params) => get('/ai/cash-forecast/', params),
  creditRisk: (params) => get('/ai/credit-risk/', params),
  anomalies: (params) => get('/ai/anomalies/', params),
  supplierPrices: (params) => get('/ai/supplier-prices/', params),
  /** body: { company, product, target_margin_pct } */
  priceRecommendation: (b) => post('/ai/price-recommendation/', b),
};

// ------------------------------------------------------------------ public surface

const api = {
  auth,
  // administration & company
  users, roles, companies, branches, departments, currencies, exchangeRates, taxConfigs, numberSequences, approvalPolicies,
  accountMappings, borderCrossings, complianceRequirements, fiscalYears, accountingPeriods,
  // suppliers & procurement
  suppliers, supplierContacts, supplierContracts, supplierPrices, supplierQuotations, purchaseRequisitions, purchaseOrders,
  goodsReceipts, purchaseReturns, purchaseInvoices, supplierCreditNotes,
  // products & inventory
  products, depots, storageTanks, tankCalibrations, tankReadings, tankReconciliations, stockMovements, stockBalances,
  stockReservations, stockAdjustments, stockTransfers, stock,
  // customers & sales
  customers, customerContacts, customerCreditLimits, customerContracts, marketPrices, salesQuotations, salesOrders,
  salesInvoices, salesCreditNotes, pricing,
  // fleet & transport
  vehicles, trailers, drivers, vehicleAssignments, vehicleMaintenance, vehicleExpenses, vehicleDocuments,
  transporters, transporterContracts, transporterRates, transporterVehicles, transportBookings, transporterInvoices,
  // shipments & customs
  shipments, shipmentStatusHistory, shipmentStages, shipmentDocuments, shipmentDeliveries, shipmentAllocations, costSheets,
  exportDeclarations, complianceChecks, tripAdvances,
  // finance
  expenseCategories, expenses, payments, bankAccounts, bankTransactions, bankReconciliations, accounts, journals,
  fixedAssets, employees, leaveRequests, payrollConfigs, payrollRuns,
  // group
  intercompany, consolidationRuns, group,
  // control & intelligence
  approvals, notifications, auditLogs, alerts, dashboard, reports, ai,
};

export default api;
export { BASE as API_BASE_URL };