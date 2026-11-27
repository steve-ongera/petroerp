/**
 * Shipment detail - the operations cockpit.
 *
 * Tabs: Overview | Loading | Documents | Trip Expenses | Delivery | Financial Summary | Activity Log
 *
 * Endpoints used:
 *   /shipments/:id/ (detail + lines)         PUT = edit header + replace lines (DRAFT only) | DELETE = delete a DRAFT
 *   /shipments/:id/submit/  update-status/  record-loading/  record-delivery/  cost/  cost-sheets/  fuel/
 *   /shipments/:id/compliance/               vehicle / driver / truck readiness checklist
 *   /shipments/:id/timeline/  history/       status history and audit trail
 *   /shipment-documents/                     documents (list / upload / delete)
 *   /shipment-deliveries/?shipment=          deliveries
 *   /trip-advances/                          trip budget -> advance -> reconciliation
 *   /expenses/?shipment=  /vehicle-maintenance/?vehicle=  /sales-orders/:id/
 *
 * Loading rule: LOADING -> LOADED needs a loaded quantity (and a source tank) on at least one line. That is
 * recorded on the Loading tab, so the status dialog checks it first and links to the tab.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'bi-info-circle' },
  { key: 'loading', label: 'Loading', icon: 'bi-box-arrow-in-down' },
  { key: 'documents', label: 'Documents', icon: 'bi-paperclip' },
  { key: 'trip', label: 'Trip Expenses', icon: 'bi-wallet2' },
  { key: 'delivery', label: 'Delivery', icon: 'bi-geo-alt' },
  { key: 'financial', label: 'Financial Summary', icon: 'bi-calculator' },
  { key: 'activity', label: 'Activity Log', icon: 'bi-clock-history' },
];

const TRANSITIONS = {
  DRAFT: ['CANCELLED'],
  AWAITING_APPROVAL: ['CANCELLED'],
  APPROVED: ['AWAITING_LOADING', 'CANCELLED'],
  AWAITING_LOADING: ['LOADING', 'CANCELLED'],
  LOADING: ['LOADED', 'CANCELLED'],
  LOADED: ['DISPATCHED', 'LOADING'],
  DISPATCHED: ['IN_TRANSIT', 'AT_BORDER'],
  IN_TRANSIT: ['AT_BORDER', 'ARRIVED'],
  AT_BORDER: ['UNDER_CUSTOMS', 'CLEARED'],
  UNDER_CUSTOMS: ['CLEARED'],
  CLEARED: ['IN_TRANSIT', 'ARRIVED'],
  ARRIVED: ['DELIVERED'],
  DELIVERED: ['RECONCILIATION_PENDING'],
  RECONCILIATION_PENDING: ['CLOSED'],
};

const TYPES = [['CUSTOMER_DELIVERY', 'Customer delivery'], ['DEPOT_TRANSFER', 'Depot transfer'], ['EXPORT', 'Export']];
const PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'];
const DOC_TYPES = [
  ['SALES_ORDER', 'Sales order'],
  ['STOCK_REFERENCE', 'Purchase / stock reference'],
  ['DELIVERY_NOTE', 'Delivery note'],
  ['INVOICE', 'Invoice'],
  ['VEHICLE_COMPLIANCE', 'Vehicle compliance document'],
  ['DRIVER_DOCUMENT', 'Driver document'],
  ['COMMERCIAL_INVOICE', 'Commercial invoice (export)'],
  ['CERTIFICATE_OF_ORIGIN', 'Certificate of origin (export)'],
  ['TRANSIT_DOC', 'Transit document (export)'],
  ['EXPORT_DECLARATION', 'Export declaration'],
  ['IMPORT_DOC', 'Import document'],
  ['POD', 'Proof of delivery'],
  ['PHOTO', 'Photo'],
  ['OTHER', 'Other supporting document'],
];
const REQUIRED_DOCS = ['SALES_ORDER', 'STOCK_REFERENCE', 'DELIVERY_NOTE', 'INVOICE', 'VEHICLE_COMPLIANCE', 'DRIVER_DOCUMENT'];
const EXPORT_DOCS = ['EXPORT_DECLARATION', 'COMMERCIAL_INVOICE', 'CERTIFICATE_OF_ORIGIN', 'TRANSIT_DOC'];

const FLOW = ['Draft', 'Pending approval', 'Approved', 'Ready for dispatch', 'Dispatched', 'In transit', 'Delivered', 'Reconciled'];
const flowIndex = (s) => ({
  DRAFT: 0, AWAITING_APPROVAL: 1, APPROVED: 2, AWAITING_LOADING: 3, LOADING: 3, LOADED: 3, DISPATCHED: 4,
  IN_TRANSIT: 5, AT_BORDER: 5, UNDER_CUSTOMS: 5, CLEARED: 5, ARRIVED: 5, DELIVERED: 6, RECONCILIATION_PENDING: 7, CLOSED: 7,
}[s] ?? 0);

const DASH = '\u2014';
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return DASH;
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtL = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} L`;
const fmtDT = (v) => (v ? new Date(v).toLocaleString() : DASH);
const todayISO = () => new Date().toISOString().slice(0, 10);
const label = (s) => (s || '').replace(/_/g, ' ');
const idStr = (v) => (v == null ? '' : String(v));
const orNull = (v) => (v === '' || v == null ? null : v);
const num = (v) => Number(v || 0);
const typeLabel = (t) => (TYPES.find(([v]) => v === t) || [t, label(t)])[1];
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const statusPill = (s) => {
  if (s === 'DRAFT' || s === 'CLOSED') return 'status-pill--neutral';
  if (['AWAITING_APPROVAL', 'AWAITING_LOADING', 'LOADING', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'RECONCILIATION_PENDING'].includes(s)) return 'status-pill--warning';
  if (['APPROVED', 'LOADED', 'DISPATCHED', 'CLEARED', 'ARRIVED', 'DELIVERED'].includes(s)) return 'status-pill--success';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral';
};
const priorityPill = (p) => (p === 'URGENT' ? 'status-pill--danger' : p === 'HIGH' ? 'status-pill--warning' : 'status-pill--neutral');
const expensePill = (s) => {
  if (s === 'POSTED' || s === 'PAID') return 'status-pill--info';
  if (s === 'APPROVED') return 'status-pill--success';
  return 'status-pill--neutral';
};
const advancePill = (s) => {
  if (['AWAITING_APPROVAL', 'RECONCILIATION_PENDING'].includes(s)) return 'status-pill--warning';
  if (['APPROVED', 'RECONCILED'].includes(s)) return 'status-pill--success';
  if (s === 'PAID') return 'status-pill--info';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral';
};

/** Small helper: padded body area inside a .page-card section. */
const Body = ({ children, flush }) => (
  <div style={flush ? undefined : { padding: '1rem 1.25rem' }}>{children}</div>
);

const SectionHeader = ({ icon, title, subtitle, children, first }) => (
  <div className="table-wrap__header" style={first ? undefined : { borderTop: '1px solid var(--border-color)' }}>
    <span className="panel-title">
      <i className={`bi ${icon} text-brand`}></i>
      {title}
    </span>
    {subtitle && <span className="chart-card__subtitle">{subtitle}</span>}
    {children}
  </div>
);

const KV = ({ items }) => (
  <div className="kv">
    {items.map(([k, v]) => (
      <div className="kv__item" key={k}>
        <div className="kv__label">{k}</div>
        <div className="kv__value">{v}</div>
      </div>
    ))}
  </div>
);

const EmptyState = ({ icon, title, text }) => (
  <div className="empty-state">
    <i className={`bi ${icon}`}></i>
    <h6>{title}</h6>
    {text && <p className="text-muted-soft">{text}</p>}
  </div>
);

/** Widens whichever dialog wrapper the Modal component renders, only for the form with this id. */
const WideModalStyle = ({ formId }) => (
  <style>{`
    .modal-dialog:has(#${formId}), .modal__dialog:has(#${formId}), .modal-box:has(#${formId}), .modal-panel:has(#${formId}) {
      width: min(1100px, 95vw); max-width: min(1100px, 95vw);
    }
    .modal-body:has(#${formId}), .modal__body:has(#${formId}) { max-height: 75vh; overflow-y: auto; }
  `}</style>
);

export default function ShipmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const { notify } = useApp();
  const [s, setS] = useState(null);
  const [lines, setLines] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [audit, setAudit] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [fuel, setFuel] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [compliance, setCompliance] = useState(null);
  const [order, setOrder] = useState(null);
  const [maintenance, setMaintenance] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTransition, setShowTransition] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const detail = await api.shipments.get(id);
      const [tl, hist, cs, fu, ex, dl, dc, ta, co, so, mt] = await Promise.all([
        api.shipments.timeline(id).catch(() => []),
        api.shipments.history(id).catch(() => []),
        api.shipments.costSheets(id).catch(() => []),
        api.shipments.fuel(id).catch(() => null),
        api.expenses.listAll({ shipment: id }).catch(() => []),
        api.shipmentDeliveries.listAll({ shipment: id }).catch(() => []),
        api.shipmentDocuments.listAll({ shipment: id }).catch(() => []),
        api.tripAdvances.listAll({ shipment: id }).catch(() => []),
        api.shipments.compliance(id).catch(() => null),
        detail.sales_order ? api.salesOrders.get(detail.sales_order).catch(() => null) : Promise.resolve(null),
        detail.vehicle ? api.vehicleMaintenance.listAll({ vehicle: detail.vehicle, ordering: '-maintenance_date' }).catch(() => []) : Promise.resolve([]),
      ]);
      setS(detail);
      setLines(detail.lines || []);
      setTimeline(tl || []);
      setAudit(hist || []);
      setSheets(cs || []);
      setFuel(fu);
      setExpenses(ex || []);
      setDeliveries(dl || []);
      setDocuments(dc || []);
      setAdvances(ta || []);
      setCompliance(co);
      setOrder(so);
      setMaintenance(mt || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading && !s) {
    return (
      <div>
        <section className="page-card"><TableSkeleton rows={8} columns={6} /></section>
      </div>
    );
  }
  if (error && !s) {
    return (
      <div>
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (!s) return null;

  const transitions = TRANSITIONS[s.status] || [];
  const forwardTransitions = transitions.filter((t) => t !== 'CANCELLED');
  const canCancel = can('shipments.edit') && s.status !== 'CLOSED' && s.status !== 'CANCELLED' && transitions.includes('CANCELLED');
  // The server only allows header/line edits while the shipment is a draft.
  const canEditShipment = s.status === 'DRAFT' && can('shipments.edit');
  const canWork = can('shipments.edit') && !['CLOSED', 'CANCELLED'].includes(s.status);

  const act = async (fn, msg) => {
    try { await fn(); notify(msg, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete draft shipment ${s.reference}? This cannot be undone.`)) return;
    try {
      await api.shipments.remove(s.id);
      notify('Draft deleted.', 'success');
      navigate('/logistics/shipments', { replace: true });
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const tabCount = { documents: documents.length, trip: advances.length, delivery: deliveries.length };

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">

          <div className="page-header__text">
            <h1 className="page-title">
              {s.reference}{' '}
              <span className={`status-pill ${statusPill(s.status)}`}>{label(s.status)}</span>{' '}
              {s.priority && s.priority !== 'NORMAL' && (
                <span className={`status-pill ${priorityPill(s.priority)}`}>{label(s.priority)}</span>
              )}
            </h1>
            <p className="page-subtitle">
              {typeLabel(s.shipment_type)} &middot; {s.customer_label || s.supplier_label || DASH} &middot; {s.product_label || s.product} &middot; {fmtL(s.quantity)}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/logistics/shipments" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Shipments
          </Link>
          {canEditShipment && (
            <button className="btn btn-secondary" onClick={() => setShowEdit(true)}>
              <i className="bi bi-pencil"></i>
              Edit
            </button>
          )}
          {s.status === 'DRAFT' && can('shipments.edit') && (
            <button className="btn btn-primary" onClick={() => act(() => api.shipments.submit(s.id), 'Submitted.')}>
              <i className="bi bi-send"></i>
              Submit
            </button>
          )}
          {forwardTransitions.length > 0 && can('shipments.edit') && (
            <button className="btn btn-primary" onClick={() => setShowTransition(true)}>
              <i className="bi bi-arrow-repeat"></i>
              Update status
            </button>
          )}
          {canCancel && (
            <button
              className="btn btn-outline-danger"
              onClick={() => {
                if (!window.confirm(`Cancel shipment ${s.reference}?`)) return;
                act(() => api.shipments.updateStatus(s.id, { new_status: 'CANCELLED' }), 'Cancelled.');
              }}
            >
              <i className="bi bi-x-circle"></i>
              Cancel
            </button>
          )}
          {canEditShipment && (
            <button className="btn btn-outline-danger" onClick={remove}>
              <i className="bi bi-trash"></i>
              Delete
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      {/* ---------- Tabs ---------- */}
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <i className={`bi ${t.icon}`} aria-hidden="true"></i> {t.label}
            {tabCount[t.key] > 0 && <span className="badge badge-neutral" style={{ marginLeft: '0.4rem' }}>{tabCount[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <Overview s={s} lines={lines} fuel={fuel} order={order} deliveries={deliveries} compliance={compliance} maintenance={maintenance} />
      )}
      {tab === 'loading' && <LoadingTab shipment={s} lines={lines} onChanged={load} canEdit={can('shipments.edit')} />}
      {tab === 'documents' && <DocumentsTab shipment={s} documents={documents} onChanged={load} canEdit={canWork} />}
      {tab === 'trip' && (
        <TripExpensesTab shipment={s} advances={advances} expenses={expenses} onChanged={load} canEdit={canWork} user={user} />
      )}
      {tab === 'delivery' && (
        <DeliveryTab shipment={s} order={order} deliveries={deliveries} onChanged={load} canEdit={can('shipments.edit')} />
      )}
      {tab === 'financial' && (
        <FinancialTab shipment={s} sheets={sheets} advances={advances} expenses={expenses} onChanged={load} canFinalize={can('costing.finalize')} />
      )}
      {tab === 'activity' && <ActivityTab timeline={timeline} audit={audit} />}

      {showTransition && (
        <TransitionModal
          shipment={s}
          lines={lines}
          transitions={forwardTransitions}
          onGoToLoading={() => { setShowTransition(false); setTab('loading'); }}
          onClose={() => setShowTransition(false)}
          onDone={() => { setShowTransition(false); notify('Status updated.', 'success'); load(); }}
        />
      )}

      {showEdit && (
        <EditShipmentModal
          shipment={s}
          lines={lines}
          onClose={() => setShowEdit(false)}
          onDone={() => { setShowEdit(false); notify('Shipment updated.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

/* ================================================================================================
 * Edit modal (DRAFT only)
 * ============================================================================================== */
const emptyShipLine = () => ({ product: '', tank: '', compartment: '', quantity: '', purchase_price: '', selling_price: '' });
const zeroToBlank = (v) => (v == null || v === '' || Number(v) === 0 ? '' : String(v));

function EditShipmentModal({ shipment, lines, onClose, onDone }) {
  const company = shipment.company;
  const [refs, setRefs] = useState({
    customers: [], suppliers: [], products: [], depots: [], tanks: [],
    vehicles: [], trailers: [], drivers: [], transporters: [], crossings: [],
  });
  const [hiredTrucks, setHiredTrucks] = useState([]);
  const [form, setForm] = useState(() => ({
    shipment_type: shipment.shipment_type || 'CUSTOMER_DELIVERY',
    priority: shipment.priority || 'NORMAL',
    remarks: shipment.remarks || '',
    customer: idStr(shipment.customer),
    supplier: idStr(shipment.supplier),
    product: idStr(shipment.product),
    quantity: shipment.quantity != null ? String(shipment.quantity) : '',
    purchase_price: zeroToBlank(shipment.purchase_price),
    selling_price: zeroToBlank(shipment.selling_price),
    depot: idStr(shipment.depot),
    loading_tank: idStr(shipment.loading_tank),
    planned_dispatch_date: shipment.planned_dispatch_date || shipment.loading_date || '',
    origin: shipment.origin || '',
    destination: shipment.destination || '',
    destination_county: shipment.destination_county || '',
    delivery_address: shipment.delivery_address || '',
    destination_country: shipment.destination_country || '',
    consignee: shipment.consignee || '',
    border_crossing: idStr(shipment.border_crossing),
    expected_delivery: toLocalInput(shipment.expected_delivery),
    distance_km: zeroToBlank(shipment.distance_km),
    truck_ownership: shipment.truck_ownership || 'OWNED',
    vehicle: idStr(shipment.vehicle),
    trailer: idStr(shipment.trailer),
    driver: idStr(shipment.driver),
    transporter: idStr(shipment.transporter),
    hired_truck: idStr(shipment.hired_truck),
  }));
  const [rows, setRows] = useState(() => (lines.length ? lines.map((l) => ({
    product: idStr(l.product),
    tank: idStr(l.tank),
    compartment: l.compartment || '',
    quantity: l.quantity != null ? String(l.quantity) : '',
    purchase_price: zeroToBlank(l.purchase_price),
    selling_price: zeroToBlank(l.selling_price),
  })) : [emptyShipLine()]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const owned = form.truck_ownership === 'OWNED';
  const isExport = form.shipment_type === 'EXPORT';

  useEffect(() => {
    const safe = (p) => p.catch(() => []);
    Promise.all([
      safe(api.customers.listAll({ company })),
      safe(api.suppliers.listAll({ company })),
      safe(api.products.listAll()),
      safe(api.depots.listAll({ company })),
      safe(api.storageTanks.listAll({ company })),
      safe(api.vehicles.listAll({ company })),
      safe(api.trailers.listAll({ company })),
      safe(api.drivers.listAll({ company })),
      safe(api.transporters.listAll({ company })),
      safe(api.borderCrossings.listAll()),
    ]).then(([customers, suppliers, products, depots, tanks, vehicles, trailers, drivers, transporters, crossings]) => {
      setRefs({ customers, suppliers, products, depots, tanks, vehicles, trailers, drivers, transporters, crossings });
    });
  }, [company]);

  // Hired trucks belong to the chosen transporter.
  useEffect(() => {
    setHiredTrucks([]);
    if (!form.transporter) return undefined;
    let alive = true;
    api.transporterVehicles.listAll({ company, transporter: form.transporter, kind: 'TRUCK' })
      .then((v) => { if (alive) setHiredTrucks(v); })
      .catch(() => {});
    return () => { alive = false; };
  }, [company, form.transporter]);

  const changeTransporter = (e) => setForm((f) => ({ ...f, transporter: e.target.value, hired_truck: '' }));

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});
    if (!form.product) { setError('Select the product.'); return; }
    if (!(num(form.quantity) > 0)) { setError('Enter a quantity above zero.'); return; }
    const used = rows.filter((r) => r.product || r.quantity);
    if (used.some((r) => !r.product || !(num(r.quantity) > 0))) {
      setError('Every line needs a product and a quantity above zero.'); return;
    }
    setBusy(true);
    try {
      const body = {
        company,
        shipment_type: form.shipment_type,
        priority: form.priority,
        remarks: form.remarks,
        customer: orNull(form.customer),
        supplier: orNull(form.supplier),
        product: form.product,
        quantity: form.quantity,
        purchase_price: form.purchase_price || 0,
        selling_price: form.selling_price || 0,
        depot: orNull(form.depot),
        loading_tank: orNull(form.loading_tank),
        // the loading date drives the exchange-rate date, so it follows the planned dispatch date
        planned_dispatch_date: orNull(form.planned_dispatch_date),
        loading_date: orNull(form.planned_dispatch_date),
        origin: form.origin,
        destination: form.destination,
        destination_county: form.destination_county,
        delivery_address: form.delivery_address,
        destination_country: isExport ? form.destination_country : '',
        consignee: isExport ? form.consignee : '',
        border_crossing: orNull(form.border_crossing),
        expected_delivery: orNull(form.expected_delivery),
        distance_km: form.distance_km || 0,
        truck_ownership: form.truck_ownership,
        // clear the fields of the other ownership type so nothing stale is left behind
        vehicle: owned ? orNull(form.vehicle) : null,
        trailer: owned ? orNull(form.trailer) : null,
        driver: owned ? orNull(form.driver) : null,
        transporter: owned ? null : orNull(form.transporter),
        hired_truck: owned ? null : orNull(form.hired_truck),
        // the server replaces the lines, so the full list is always sent
        lines: used.map((r) => ({
          product: r.product,
          quantity: r.quantity,
          compartment: r.compartment,
          purchase_price: r.purchase_price || 0,
          selling_price: r.selling_price || 0,
          ...(r.tank ? { tank: r.tank } : {}),
        })),
      };
      await api.shipments.update(shipment.id, body);
      onDone();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  const opts = (list, text) => list.map((x) => <option key={x.id} value={x.id}>{text(x)}</option>);

  return (
    <Modal
      show
      onClose={onClose}
      title="Edit shipment"
      subtitle={`${shipment.reference} \u00b7 draft`}
      icon="bi-pencil-square"
      size="xl"
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="editShipmentForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </>
      }
    >
      <WideModalStyle formId="editShipmentForm" />
      <form id="editShipmentForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>General Information</h6>
        <div className="form-grid">
          <Field label="Shipment type" err={fieldErr.shipment_type}>
            <select className="form-select" value={form.shipment_type} onChange={set('shipment_type')}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Priority" err={fieldErr.priority}>
            <select className="form-select" value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}
            </select>
          </Field>
          <Field label="Sales order">
            <input className="form-control" value={shipment.sales_order_label || DASH} disabled />
          </Field>
          <Field label="Customer" err={fieldErr.customer}>
            <select className="form-select" value={form.customer} onChange={set('customer')}>
              <option value="">{DASH}</option>
              {opts(refs.customers, (c) => `${c.code} \u00b7 ${c.name}`)}
            </select>
          </Field>
          <Field label="Supplier" err={fieldErr.supplier}>
            <select className="form-select" value={form.supplier} onChange={set('supplier')}>
              <option value="">{DASH}</option>
              {opts(refs.suppliers, (c) => `${c.code} \u00b7 ${c.name}`)}
            </select>
          </Field>
          <Field label="Remarks" span err={fieldErr.remarks}>
            <textarea className="form-control" rows={2} value={form.remarks} onChange={set('remarks')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-droplet-half" aria-hidden="true"></i>Product and Quantity</h6>
        <div className="form-grid">
          <Field label="Product" required err={fieldErr.product}>
            <select className="form-select" value={form.product} onChange={set('product')} required>
              <option value="">{DASH}</option>
              {opts(refs.products, (p) => `${p.code} \u00b7 ${p.name}`)}
            </select>
          </Field>
          <Field label="Quantity allocated (L)" required err={fieldErr.quantity}>
            <input type="number" step="0.001" className="form-control num" value={form.quantity} onChange={set('quantity')} required />
          </Field>
          <Field label="Purchase price / L" err={fieldErr.purchase_price}>
            <input type="number" step="0.000001" className="form-control num" value={form.purchase_price} onChange={set('purchase_price')} />
          </Field>
          <Field label="Selling price / L" err={fieldErr.selling_price}>
            <input type="number" step="0.000001" className="form-control num" value={form.selling_price} onChange={set('selling_price')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-signpost-split" aria-hidden="true"></i>Route and Location</h6>
        <div className="form-grid">
          <Field label="Origin depot" err={fieldErr.depot}>
            <select className="form-select" value={form.depot} onChange={set('depot')}>
              <option value="">{DASH}</option>
              {opts(refs.depots, (d) => `${d.code} \u00b7 ${d.name}`)}
            </select>
          </Field>
          <Field label="Origin tank" err={fieldErr.loading_tank}>
            <select className="form-select" value={form.loading_tank} onChange={set('loading_tank')}>
              <option value="">{DASH}</option>
              {opts(refs.tanks, (t) => t.code)}
            </select>
          </Field>
          <Field label="Planned dispatch date" err={fieldErr.planned_dispatch_date}>
            <input type="date" className="form-control" value={form.planned_dispatch_date} onChange={set('planned_dispatch_date')} />
          </Field>
          <Field label="Expected delivery" err={fieldErr.expected_delivery}>
            <input type="datetime-local" className="form-control" value={form.expected_delivery} onChange={set('expected_delivery')} />
          </Field>
          <Field label="Dispatch location" err={fieldErr.origin}>
            <input className="form-control" value={form.origin} onChange={set('origin')} />
          </Field>
          <Field label="Destination" err={fieldErr.destination}>
            <input className="form-control" value={form.destination} onChange={set('destination')} />
          </Field>
          <Field label="Destination county" err={fieldErr.destination_county}>
            <input className="form-control" value={form.destination_county} onChange={set('destination_county')} />
          </Field>
          <Field label="Delivery address" err={fieldErr.delivery_address}>
            <input className="form-control" value={form.delivery_address} onChange={set('delivery_address')} />
          </Field>
          <Field label="Distance (km)" err={fieldErr.distance_km}>
            <input type="number" step="0.001" className="form-control num" value={form.distance_km} onChange={set('distance_km')} />
          </Field>
          {isExport && (
            <>
              <Field label="Destination country" err={fieldErr.destination_country}>
                <input className="form-control" value={form.destination_country} onChange={set('destination_country')} />
              </Field>
              <Field label="Consignee" err={fieldErr.consignee}>
                <input className="form-control" value={form.consignee} onChange={set('consignee')} />
              </Field>
              <Field label="Border crossing" err={fieldErr.border_crossing}>
                <select className="form-select" value={form.border_crossing} onChange={set('border_crossing')}>
                  <option value="">{DASH}</option>
                  {opts(refs.crossings, (b) => b.name)}
                </select>
              </Field>
            </>
          )}
        </div>

        <h6 className="modal-section-title"><i className="bi bi-truck" aria-hidden="true"></i>Fleet and Driver</h6>
        <div className="form-grid">
          <Field label="Truck ownership" required err={fieldErr.truck_ownership}>
            <select className="form-select" value={form.truck_ownership} onChange={set('truck_ownership')}>
              <option value="OWNED">Owned</option>
              <option value="HIRED">Hired</option>
            </select>
          </Field>
          {owned ? (
            <>
              <Field label="Vehicle" err={fieldErr.vehicle}>
                <select className="form-select" value={form.vehicle} onChange={set('vehicle')}>
                  <option value="">{DASH}</option>
                  {opts(refs.vehicles, (v) => v.registration_number)}
                </select>
              </Field>
              <Field label="Trailer" err={fieldErr.trailer}>
                <select className="form-select" value={form.trailer} onChange={set('trailer')}>
                  <option value="">{DASH}</option>
                  {opts(refs.trailers, (t) => t.registration_number)}
                </select>
              </Field>
              <Field label="Driver" err={fieldErr.driver}>
                <select className="form-select" value={form.driver} onChange={set('driver')}>
                  <option value="">{DASH}</option>
                  {opts(refs.drivers, (d) => d.full_name)}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Transporter" err={fieldErr.transporter}>
                <select className="form-select" value={form.transporter} onChange={changeTransporter}>
                  <option value="">{DASH}</option>
                  {opts(refs.transporters, (t) => `${t.code} \u00b7 ${t.name}`)}
                </select>
              </Field>
              <Field label="Hired truck" err={fieldErr.hired_truck}>
                <select className="form-select" value={form.hired_truck} onChange={set('hired_truck')} disabled={!form.transporter}>
                  <option value="">{form.transporter ? DASH : 'Select the transporter first'}</option>
                  {form.hired_truck && !hiredTrucks.some((t) => String(t.id) === form.hired_truck) && (
                    <option value={form.hired_truck}>{shipment.hired_truck_label || `Truck #${form.hired_truck}`}</option>
                  )}
                  {opts(hiredTrucks, (t) => t.registration_number)}
                </select>
              </Field>
            </>
          )}
        </div>

        <h6 className="modal-section-title d-flex justify-content-between align-items-center">
          <span><i className="bi bi-list-ul" aria-hidden="true"></i>Compartments</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setRows((rs) => [...rs, emptyShipLine()])}>
            <i className="bi bi-plus-lg"></i> Add line
          </button>
        </h6>
        <div className="table-responsive">
          <table className="table mb-0">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right">Qty (L)</th>
                <th>Tank</th>
                <th>Compartment</th>
                <th className="text-right">Purchase / L</th>
                <th className="text-right">Selling / L</th>
                <th style={{ width: '3rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <select className="form-select" value={r.product} onChange={(e) => setRow(i, 'product', e.target.value)}>
                      <option value="">{DASH}</option>
                      {opts(refs.products, (p) => `${p.code} \u00b7 ${p.name}`)}
                    </select>
                  </td>
                  <td><input type="number" step="0.001" className="form-control num" value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} /></td>
                  <td>
                    <select className="form-select" value={r.tank} onChange={(e) => setRow(i, 'tank', e.target.value)}>
                      <option value="">{DASH}</option>
                      {opts(refs.tanks, (t) => t.code)}
                    </select>
                  </td>
                  <td><input className="form-control" value={r.compartment} onChange={(e) => setRow(i, 'compartment', e.target.value)} /></td>
                  <td><input type="number" step="0.000001" className="form-control num" value={r.purchase_price} onChange={(e) => setRow(i, 'purchase_price', e.target.value)} /></td>
                  <td><input type="number" step="0.000001" className="form-control num" value={r.selling_price} onChange={(e) => setRow(i, 'selling_price', e.target.value)} /></td>
                  <td>
                    {rows.length > 1 && (
                      <button type="button" className="btn btn-icon" title="Remove line" aria-label="Remove line"
                              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                        <i className="bi bi-x-lg"></i>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-soft" style={{ fontSize: '0.8125rem', margin: '0.75rem 0 0' }}>
          Saving replaces all lines. Loaded quantities are recorded later on the Loading tab, once the shipment is in LOADING.
        </p>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/* ================================================================================================
 * Overview
 * ============================================================================================== */
function WorkflowStepper({ status }) {
  if (status === 'CANCELLED') {
    return <div className="alert alert-danger" role="status" style={{ margin: '1rem 1.25rem' }}>This shipment was cancelled.</div>;
  }
  const idx = flowIndex(status);
  const closed = status === 'CLOSED';
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: '1rem 1.25rem' }}>
      {FLOW.map((name, i) => {
        const done = closed || i < idx;
        const current = !closed && i === idx;
        return (
          <div key={name} style={{ flex: '1 1 6.5rem', minWidth: '6rem' }}>
            <div style={{ height: 4, borderRadius: 2, background: done || current ? '#0B1F3A' : 'var(--border-color)', opacity: done ? 0.55 : 1 }}></div>
            <div style={{ fontSize: '0.75rem', marginTop: '0.35rem', fontWeight: current ? 600 : 400, opacity: done || current ? 1 : 0.6 }}>
              {done && <i className="bi bi-check-lg" style={{ marginRight: 2 }}></i>}{name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Overview({ s, lines, fuel, order, deliveries, compliance, maintenance }) {
  const orderLine = order?.lines?.find((l) => String(l.product) === String(s.product));
  const deliveredTotal = deliveries.filter((d) => d.status === 'APPROVED').reduce((t, d) => t + num(d.delivered_quantity), 0);
  const dispatched = s.stock_issued ? num(s.loading_quantity) : 0;
  const owned = s.truck_ownership === 'OWNED';
  const v = compliance?.vehicle;
  const d = compliance?.driver;
  const ht = compliance?.hired_truck;

  return (
    <>
      <section className="page-card">
        <SectionHeader first icon="bi-diagram-3" title="Shipment Progress" />
        <WorkflowStepper status={s.status} />
      </section>

      <section className="page-card">
        <SectionHeader first icon="bi-info-circle" title="General Information" />
        <Body>
          <KV items={[
            ['Shipment number', s.reference],
            ['Shipment type', typeLabel(s.shipment_type)],
            ['Priority', <span className={`status-pill ${priorityPill(s.priority)}`} key="p">{label(s.priority)}</span>],
            ['Sales order', s.sales_order_label || DASH],
            ['Customer', s.customer_label || DASH],
            ['Supplier', s.supplier_label || DASH],
            ['Created', fmtDT(s.created_at)],
            ['Remarks', s.remarks || DASH],
          ]} />
        </Body>
      </section>

      <section className="page-card">
        <SectionHeader first icon="bi-signpost-split" title="Route and Location" />
        <Body>
          <KV items={[
            ['Dispatch location', s.origin || DASH],
            ['Origin depot / tank', `${s.depot_label || DASH} \u00b7 ${s.loading_tank_label || DASH}`],
            ['Destination', s.destination || DASH],
            ['Destination county', s.destination_county || DASH],
            ['Delivery address', s.delivery_address || DASH],
            ['Planned dispatch', s.planned_dispatch_date || s.loading_date || DASH],
            ['Expected delivery', fmtDT(s.expected_delivery)],
            ['Actual delivery', fmtDT(s.actual_delivery)],
            ...(s.shipment_type === 'EXPORT' ? [
              ['Destination country', s.destination_country || DASH],
              ['Consignee', s.consignee || DASH],
              ['Border crossing', s.border_crossing_label || DASH],
            ] : []),
          ]} />
        </Body>
      </section>

      <section className="page-card">
        <SectionHeader first icon="bi-droplet-half" title="Fuel / Product Details" />
        <Body>
          <KV items={[
            ['Product', s.product_label || s.product],
            ['Unit of measurement', 'Litres'],
            ['Quantity ordered', orderLine ? fmtL(orderLine.quantity) : DASH],
            ['Quantity allocated', fmtL(s.quantity)],
            ['Quantity loaded', fmtL(s.loading_quantity)],
            ['Quantity dispatched', s.stock_issued ? fmtL(dispatched) : 'Not dispatched yet'],
            ['Quantity delivered', fmtL(deliveredTotal)],
            ['Unit selling price', fmtMoney(s.selling_price)],
            ['Total sales value', fmtMoney(s.total_sales_value, s.currency)],
          ]} />
          <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
            Allocation reserves fuel for this shipment. The stock movement out of the tank is only recorded when the shipment is dispatched.
          </p>
        </Body>
      </section>

      <section className="page-card">
        <SectionHeader first icon="bi-truck" title="Fleet and Driver"
                       subtitle={compliance ? (compliance.ready ? 'Ready' : 'Needs attention') : undefined}>
          {compliance && (
            <span className={`status-pill ${compliance.ready ? 'status-pill--success' : 'status-pill--warning'}`}>
              {compliance.ready ? 'All checks passed' : 'Checks failing'}
            </span>
          )}
        </SectionHeader>
        <Body>
          <KV items={owned ? [
            ['Ownership', 'Owned fleet'],
            ['Vehicle registration', v?.registration_number || DASH],
            ['Vehicle type', v ? `${v.truck_type || DASH}${v.make ? ` \u00b7 ${v.make} ${v.model || ''}` : ''}` : DASH],
            ['Tank capacity', v ? fmtL(v.tank_capacity) : DASH],
            ['Driver', d?.full_name || DASH],
            ['Driver contact', d?.phone || DASH],
            ['Licence', d ? `${d.licence_number || DASH}${d.licence_expiry ? ` \u00b7 expires ${d.licence_expiry}` : ''}` : DASH],
          ] : [
            ['Ownership', 'Hired truck'],
            ['Transporter', compliance?.transporter?.name || s.transporter_label || DASH],
            ['Truck registration', ht?.registration_number || DASH],
            ['Truck capacity', ht ? fmtL(ht.capacity) : DASH],
            ['Driver', ht?.driver_name || DASH],
            ['Driver contact', ht?.driver_phone || DASH],
          ]} />
        </Body>
        {compliance?.checks?.length > 0 && (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table mb-0">
                <thead><tr><th>Compliance check</th><th>Result</th><th>Detail</th></tr></thead>
                <tbody>
                  {compliance.checks.map((c) => (
                    <tr key={c.key}>
                      <td className="cell-name">{c.label}</td>
                      <td><span className={`status-pill ${c.ok ? 'status-pill--success' : 'status-pill--danger'}`}>{c.ok ? 'OK' : 'Failed'}</span></td>
                      <td className="text-muted-soft">{c.detail || DASH}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {owned && s.vehicle && (
          <>
            <SectionHeader icon="bi-tools" title="Vehicle Maintenance" subtitle={`${maintenance.length} record${maintenance.length !== 1 ? 's' : ''}`} />
            {maintenance.length === 0 ? (
              <EmptyState icon="bi-tools" title="No maintenance records for this vehicle" />
            ) : (
              <div className="table-wrap">
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr><th>Date</th><th>Type</th><th>Description</th><th>Provider</th><th className="text-right">Cost</th><th>Next due</th></tr>
                    </thead>
                    <tbody>
                      {maintenance.slice(0, 5).map((m) => (
                        <tr key={m.id}>
                          <td>{m.maintenance_date}</td>
                          <td>{label(m.maintenance_type)}</td>
                          <td className="text-truncate" style={{ maxWidth: 240 }}>{m.description || DASH}</td>
                          <td>{m.vendor || DASH}</td>
                          <td className="cell-num">{fmtMoney(m.cost)}</td>
                          <td>{m.next_due_date || DASH}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="page-card">
        <SectionHeader first icon="bi-list-ul" title="Compartments" subtitle={`${lines.length} line${lines.length !== 1 ? 's' : ''}`} />
        {lines.length === 0 ? (
          <EmptyState icon="bi-droplet" title="No lines" />
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Compartment</th>
                    <th>Source tank</th>
                    <th className="text-right">Allocated</th>
                    <th className="text-right">Loaded</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="cell-name">{l.product_label || l.product}</td>
                      <td>{l.compartment || DASH}</td>
                      <td>{l.tank_label || DASH}</td>
                      <td className="cell-num">{num(l.quantity).toLocaleString()}</td>
                      <td className="cell-num">{num(l.loaded_quantity).toLocaleString()}</td>
                      <td className="cell-num">{num(l.unit_cost).toFixed(6)}</td>
                      <td className="cell-num">{fmtMoney(l.cost_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {fuel && fuel.expected_litres != null && (
        <section className="page-card">
          <SectionHeader first icon="bi-fuel-pump" title="Truck Fuel Variance">
            {fuel.flag && <span className="status-pill status-pill--warning">Flag</span>}
          </SectionHeader>
          <Body>
            <KV items={[
              ['Expected', `${num(fuel.expected_litres).toFixed(3)} L`],
              ['Actual', `${num(fuel.actual_litres).toFixed(3)} L`],
              ['Variance', `${num(fuel.variance_litres).toFixed(3)} L`],
              ['Variance %', `${num(fuel.variance_pct).toFixed(3)} %`],
            ]} />
          </Body>
        </section>
      )}
    </>
  );
}

/* ================================================================================================
 * Loading tab
 * ============================================================================================== */
function LoadingTab({ shipment, lines, onChanged, canEdit }) {
  const [tanks, setTanks] = useState([]);
  const [rows, setRows] = useState(() => lines.map((l) => ({
    id: l.id, loaded_quantity: l.loaded_quantity || '', tank: l.tank || '', compartment: l.compartment || '',
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.storageTanks.listAll({ company: shipment.company }).then(setTanks).catch(() => {}); }, [shipment.company]);

  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  // Copies the allocated litres into every empty "Loaded" box and defaults the tank to the line's planned
  // tank, or the shipment's origin tank. The person still adjusts anything that differs from the real load.
  const fillFromAllocated = () => setRows((rs) => rs.map((r) => {
    const l = lines.find((x) => x.id === r.id);
    return {
      ...r,
      loaded_quantity: r.loaded_quantity || (l?.quantity ? String(l.quantity) : ''),
      tank: r.tank || l?.tank || shipment.loading_tank || '',
    };
  }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.shipments.recordLoading(shipment.id, {
        lines: rows.map((r) => ({
          id: r.id, loaded_quantity: r.loaded_quantity || 0,
          ...(r.tank ? { tank: r.tank } : {}),
          ...(r.compartment ? { compartment: r.compartment } : {}),
        })),
      });
      onChanged();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  if (shipment.status !== 'LOADING') {
    return (
      <section className="page-card">
        <SectionHeader first icon="bi-box-arrow-in-down" title="Record Loading" />
        <EmptyState
          icon="bi-lock"
          title="Loading is only editable while status is LOADING"
          text={'Move the shipment to AWAITING LOADING \u2192 LOADING first.'}
        />
      </section>
    );
  }

  const totalLoaded = rows.reduce((t, r) => t + num(r.loaded_quantity), 0);

  return (
    <section className="page-card">
      <SectionHeader first icon="bi-box-arrow-in-down" title="Record Loading" subtitle={`${rows.length} line${rows.length !== 1 ? 's' : ''}`} />
      <Body>
        <p className="text-muted-soft mb-0" style={{ fontSize: '0.8125rem' }}>
          Enter the litres actually loaded and the source tank on each line, then press Save loading. After that, use
          Update status to mark the shipment as LOADED.
        </p>
      </Body>
      <form onSubmit={save}>
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Product</th>
                  <th className="text-right">Allocated</th>
                  <th className="text-right">Loaded</th>
                  <th>Tank</th>
                  <th>Compartment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const l = lines.find((x) => x.id === r.id);
                  return (
                    <tr key={r.id}>
                      <td className="cell-mono">#{r.id}</td>
                      <td className="cell-name">{l?.product_label || DASH}</td>
                      <td className="cell-num">{num(l?.quantity).toLocaleString()}</td>
                      <td>
                        <input type="number" step="0.001" className="form-control num" value={r.loaded_quantity}
                               disabled={!canEdit} onChange={(e) => setRow(i, 'loaded_quantity', e.target.value)} />
                      </td>
                      <td>
                        <select className="form-select" value={r.tank} disabled={!canEdit} onChange={(e) => setRow(i, 'tank', e.target.value)}>
                          <option value="">{DASH}</option>
                          {tanks.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="form-control" value={r.compartment} disabled={!canEdit}
                               onChange={(e) => setRow(i, 'compartment', e.target.value)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>Total</strong></td>
                  <td className="cell-num"><strong>{num(shipment.quantity).toLocaleString()}</strong></td>
                  <td className="cell-num"><strong>{totalLoaded.toLocaleString()}</strong></td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        {error && <div className="alert alert-danger" role="alert" style={{ margin: '1rem 1.25rem 0' }}>{error}</div>}
        {canEdit && (
          <Body>
            <button className="btn btn-primary" disabled={busy}>
              <i className="bi bi-save"></i>
              {busy ? 'Saving...' : 'Save loading'}
            </button>
            <button type="button" className="btn btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={fillFromAllocated} disabled={busy}>
              <i className="bi bi-magic"></i> Fill from allocated
            </button>
          </Body>
        )}
      </form>
    </section>
  );
}

/* ================================================================================================
 * Documents tab
 * ============================================================================================== */
function DocumentsTab({ shipment, documents, onChanged, canEdit }) {
  const { notify } = useApp();
  const [showNew, setShowNew] = useState(false);
  const has = (t) => documents.some((d) => d.doc_type === t);
  const required = shipment.shipment_type === 'EXPORT' ? [...REQUIRED_DOCS, ...EXPORT_DOCS] : REQUIRED_DOCS;
  const docLabel = (t) => (DOC_TYPES.find(([v]) => v === t) || [t, label(t)])[1];

  const remove = async (d) => {
    if (!window.confirm(`Delete ${docLabel(d.doc_type)}${d.number ? ` ${d.number}` : ''}?`)) return;
    try { await api.shipmentDocuments.remove(d.id); notify('Document deleted.', 'success'); onChanged(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <>
      <section className="page-card">
        <SectionHeader first icon="bi-check2-square" title="Document Checklist"
                       subtitle={`${required.filter(has).length} of ${required.length} provided`} />
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table mb-0">
              <thead><tr><th>Document</th><th>Purpose</th><th>Status</th></tr></thead>
              <tbody>
                {required.map((t) => (
                  <tr key={t}>
                    <td className="cell-name">{docLabel(t)}</td>
                    <td className="text-muted-soft">
                      {{
                        SALES_ORDER: 'Confirms the customer order',
                        STOCK_REFERENCE: 'Establishes the stock source',
                        DELIVERY_NOTE: 'Documents the delivery',
                        INVOICE: 'Customer billing',
                        VEHICLE_COMPLIANCE: 'Fleet compliance',
                        DRIVER_DOCUMENT: 'Driver compliance',
                        EXPORT_DECLARATION: 'Customs / export',
                        COMMERCIAL_INVOICE: 'Customs / export',
                        CERTIFICATE_OF_ORIGIN: 'Customs / export',
                        TRANSIT_DOC: 'Customs / export',
                      }[t] || DASH}
                    </td>
                    <td>
                      <span className={`status-pill ${has(t) ? 'status-pill--success' : 'status-pill--warning'}`}>
                        {has(t) ? 'Provided' : 'Missing'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="page-card">
        <SectionHeader first icon="bi-paperclip" title="Attached Documents" subtitle={`${documents.length} file${documents.length !== 1 ? 's' : ''}`}>
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowNew(true)}>
              <i className="bi bi-plus-lg"></i> Attach document
            </button>
          )}
        </SectionHeader>
        {documents.length === 0 ? (
          <EmptyState icon="bi-paperclip" title="No documents attached yet" />
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr><th>Type</th><th>Reference</th><th>File</th><th>Notes</th><th>Added</th><th style={{ width: '4rem' }}></th></tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td className="cell-name">{docLabel(d.doc_type)}</td>
                      <td className="cell-mono">{d.number || DASH}</td>
                      <td>
                        {d.file ? <a href={d.file} target="_blank" rel="noreferrer" className="text-brand"><i className="bi bi-download"></i> Open</a> : DASH}
                      </td>
                      <td className="text-truncate" style={{ maxWidth: 240 }}>{d.notes || DASH}</td>
                      <td>{fmtDT(d.created_at)}</td>
                      <td>
                        {canEdit && (
                          <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(d)}>
                            <i className="bi bi-trash"></i>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {showNew && (
        <DocumentModal
          shipment={shipment}
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); notify('Document attached.', 'success'); onChanged(); }}
        />
      )}
    </>
  );
}

function DocumentModal({ shipment, onClose, onDone }) {
  const [form, setForm] = useState({ doc_type: 'SALES_ORDER', number: '', notes: '', file: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (!form.file) { setError('Choose the file to attach.'); return; }
    setBusy(true);
    try {
      await api.shipmentDocuments.upload({ company: shipment.company, shipment: shipment.id, ...form });
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Attach document"
      subtitle={shipment.reference}
      icon="bi-paperclip"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="documentForm" disabled={busy}>
            <i className="bi bi-upload"></i> {busy ? 'Uploading...' : 'Attach'}
          </button>
        </>
      }
    >
      <form id="documentForm" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Document type" required>
            <select className="form-select" value={form.doc_type} onChange={set('doc_type')}>
              {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Reference number">
            <input className="form-control" value={form.number} onChange={set('number')} />
          </Field>
          <Field label="File" required span>
            <input type="file" className="form-control" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] || null }))} />
          </Field>
          <Field label="Notes" span>
            <input className="form-control" value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/* ================================================================================================
 * Trip expenses tab: trip budget -> advance -> reconciliation
 * ============================================================================================== */
function TripExpensesTab({ shipment, advances, expenses, onChanged, canEdit, user }) {
  const [editing, setEditing] = useState(null);   // 'new' or an advance
  const active = advances.filter((a) => a.status !== 'CANCELLED');

  return (
    <>
      <section className="page-card">
        <SectionHeader first icon="bi-wallet2" title="Trip Budget and Driver Expenses"
                       subtitle={`${active.length} advance${active.length !== 1 ? 's' : ''}`}>
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>
              <i className="bi bi-plus-lg"></i> New trip advance
            </button>
          )}
        </SectionHeader>
        <Body>
          <p className="text-muted-soft mb-0" style={{ fontSize: '0.8125rem' }}>
            Flow: request &rarr; approval (Approvals page) &rarr; payment &rarr; actual expenses submitted &rarr; reconciliation approved by
            a different user. Approving the reconciliation creates draft expenses for the actual spend, which are then approved and posted
            in Expenses so they reach the shipment costing.
          </p>
        </Body>
      </section>

      {advances.length === 0 && (
        <section className="page-card">
          <EmptyState icon="bi-wallet2" title="No trip advance for this shipment"
                      text="Create one to budget the driver's meals, accommodation, route charges and other approved trip expenses." />
        </section>
      )}

      {advances.map((a) => (
        <TripAdvanceCard key={a.id} advance={a} shipment={shipment} expenses={expenses} canEdit={canEdit}
                         user={user} onChanged={onChanged} onEdit={() => setEditing(a)} />
      ))}

      {editing && (
        <AdvanceFormModal
          shipment={shipment}
          advance={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); onChanged(); }}
        />
      )}
    </>
  );
}

function TripAdvanceCard({ advance: a, shipment, expenses, canEdit, user, onChanged, onEdit }) {
  const { notify } = useApp();
  const [attachments, setAttachments] = useState([]);
  const [modal, setModal] = useState('');   // adjust | pay | reconcile
  const [busy, setBusy] = useState(false);
  const lines = a.lines || [];

  const loadAttachments = useCallback(() => {
    api.tripAdvances.attachments(a.id).then(setAttachments).catch(() => setAttachments([]));
  }, [a.id]);
  useEffect(() => { loadAttachments(); }, [loadAttachments]);

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); notify(msg, 'success'); onChanged(); }
    catch (err) { notify(errorMessage(err), 'error'); }
    finally { setBusy(false); }
  };

  const attach = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const description = window.prompt('Describe this receipt / document (optional):') || '';
    await act(() => api.tripAdvances.attach(a.id, file, description), 'File attached.');
    loadAttachments();
  };

  const remove = () => {
    if (!window.confirm(`Delete draft trip advance ${a.reference}?`)) return;
    act(() => api.tripAdvances.remove(a.id), 'Trip advance deleted.');
  };

  const paidStage = ['PAID', 'RECONCILIATION_PENDING', 'RECONCILED'].includes(a.status);
  const sodBlocked = a.status === 'RECONCILIATION_PENDING' && a.reconciled_by === user?.id;
  const expenseRef = (id) => expenses.find((e) => e.id === id)?.reference;
  const hasStatutory = lines.some((l) => l.legal_basis || l.issuing_authority);

  return (
    <section className="page-card">
      <SectionHeader first icon="bi-cash-coin" title={a.reference}>
        <span className={`status-pill ${advancePill(a.status)}`}>{label(a.status)}</span>
        <span className="row-actions">
          {canEdit && a.status === 'DRAFT' && (
            <>
              <button className="btn btn-sm btn-secondary" onClick={onEdit} disabled={busy}><i className="bi bi-pencil"></i> Edit</button>
              <button className="btn btn-sm btn-primary" disabled={busy}
                      onClick={() => act(() => api.tripAdvances.submit(a.id), 'Sent for approval.')}>
                <i className="bi bi-send"></i> Submit for approval
              </button>
              <button className="btn btn-sm btn-outline-danger" onClick={remove} disabled={busy}><i className="bi bi-trash"></i></button>
            </>
          )}
          {canEdit && a.status === 'AWAITING_APPROVAL' && (
            <button className="btn btn-sm btn-secondary" onClick={() => setModal('adjust')} disabled={busy}>
              <i className="bi bi-sliders"></i> Adjust approved amounts
            </button>
          )}
          {canEdit && a.status === 'APPROVED' && (
            <button className="btn btn-sm btn-primary" onClick={() => setModal('pay')} disabled={busy}>
              <i className="bi bi-cash"></i> Record payment
            </button>
          )}
          {canEdit && a.status === 'PAID' && (
            <button className="btn btn-sm btn-primary" onClick={() => setModal('reconcile')} disabled={busy}>
              <i className="bi bi-clipboard-check"></i> Submit actual expenses
            </button>
          )}
          {canEdit && a.status === 'RECONCILIATION_PENDING' && (
            <>
              <button className="btn btn-sm btn-secondary" onClick={() => setModal('reconcile')} disabled={busy}>
                <i className="bi bi-pencil"></i> Revise
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy || sodBlocked}
                      title={sodBlocked ? 'You submitted this reconciliation, so another user must approve it.' : undefined}
                      onClick={() => {
                        if (!window.confirm(`Approve the reconciliation of ${a.reference}? Draft expenses will be created for the actual spend.`)) return;
                        act(() => api.tripAdvances.approveReconciliation(a.id), 'Reconciliation approved. Draft expenses created.');
                      }}>
                <i className="bi bi-check-lg"></i> Approve
              </button>
              <button className="btn btn-sm btn-outline-danger" disabled={busy || sodBlocked}
                      title={sodBlocked ? 'You submitted this reconciliation, so another user must decide it.' : undefined}
                      onClick={() => {
                        const reason = window.prompt('Why is the reconciliation being rejected?');
                        if (reason === null) return;
                        act(() => api.tripAdvances.rejectReconciliation(a.id, reason), 'Reconciliation sent back.');
                      }}>
                <i className="bi bi-x-lg"></i> Reject
              </button>
            </>
          )}
        </span>
      </SectionHeader>

      <Body>
        <KV items={[
          ['Person receiving the advance', `${a.recipient_name || DASH}${a.recipient_phone ? ` \u00b7 ${a.recipient_phone}` : ''}`],
          ['Payment method', label(a.payment_method)],
          ['Payment reference', a.payment_reference || DASH],
          ['Paid on', fmtDT(a.paid_at)],
          ['Total requested', fmtMoney(a.total)],
          ['Total approved', a.status === 'DRAFT' || a.status === 'AWAITING_APPROVAL' ? DASH : fmtMoney(a.approved_total)],
          ...(a.notes ? [['Notes', a.notes]] : []),
        ]} />
        {a.status === 'AWAITING_APPROVAL' && (
          <div className="alert alert-info mt-3 mb-0" role="status">
            Awaiting approval. The approver decides on the <Link to="/approvals" className="text-brand">Approvals page</Link>.
          </div>
        )}
      </Body>

      <div className="table-wrap">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Expense category</th>
                <th>Description</th>
                <th className="text-right">Budget</th>
                <th className="text-right">Requested</th>
                <th className="text-right">Approved</th>
                <th className="text-right">Actual</th>
                <th>Receipt</th>
                {hasStatutory && <th>Legal basis / authority</th>}
                {a.status === 'RECONCILED' && <th>Expense</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="cell-name">{l.category_label || l.category}</td>
                  <td>{l.description || DASH}</td>
                  <td className="cell-num">{fmtMoney(l.budget_amount)}</td>
                  <td className="cell-num">{fmtMoney(l.requested_amount)}</td>
                  <td className="cell-num">{['DRAFT', 'AWAITING_APPROVAL'].includes(a.status) && !num(l.approved_amount) ? DASH : fmtMoney(l.approved_amount)}</td>
                  <td className="cell-num">{paidStage && a.status !== 'PAID' ? fmtMoney(l.actual_amount) : DASH}</td>
                  <td className="cell-mono">{l.receipt_no || DASH}</td>
                  {hasStatutory && <td>{[l.legal_basis, l.issuing_authority].filter(Boolean).join(' \u00b7 ') || DASH}</td>}
                  {a.status === 'RECONCILED' && <td className="cell-mono">{l.expense ? (expenseRef(l.expense) || `#${l.expense}`) : DASH}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><strong>Total</strong></td>
                <td className="cell-num"><strong>{fmtMoney(lines.reduce((t, l) => t + num(l.budget_amount), 0))}</strong></td>
                <td className="cell-num"><strong>{fmtMoney(a.total)}</strong></td>
                <td className="cell-num"><strong>{fmtMoney(a.approved_total)}</strong></td>
                <td className="cell-num"><strong>{paidStage && a.status !== 'PAID' ? fmtMoney(a.actual_total) : DASH}</strong></td>
                <td colSpan={1 + (hasStatutory ? 1 : 0) + (a.status === 'RECONCILED' ? 1 : 0)}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {paidStage && (
        <>
          <SectionHeader icon="bi-arrow-left-right" title="Trip Advance Reconciliation"
                         subtitle={a.status === 'RECONCILIATION_PENDING' ? 'Awaiting reconciliation approval' : undefined} />
          <Body>
            <KV items={[
              ['Advance issued', fmtMoney(a.paid_amount)],
              ['Actual approved expenses', a.status === 'PAID' ? DASH : fmtMoney(a.actual_total)],
              [num(a.balance_to_return) >= 0 ? 'Amount to return' : 'Owed to the employee',
                a.status === 'PAID' ? DASH : fmtMoney(Math.abs(num(a.balance_to_return)))],
              ['Returned so far', a.status === 'PAID' ? DASH : `${fmtMoney(a.returned_amount)}${a.return_reference ? ` \u00b7 ${a.return_reference}` : ''}`],
              ...(a.reconciliation_notes ? [['Reconciliation notes', a.reconciliation_notes]] : []),
            ]} />
          </Body>
        </>
      )}

      <SectionHeader icon="bi-paperclip" title="Receipts and Supporting Documents" subtitle={`${attachments.length} file${attachments.length !== 1 ? 's' : ''}`}>
        {canEdit && a.status !== 'RECONCILED' && (
          <label className="btn btn-sm btn-secondary" style={{ margin: 0, cursor: 'pointer' }}>
            <i className="bi bi-upload"></i> Attach receipt
            <input type="file" hidden onChange={attach} />
          </label>
        )}
      </SectionHeader>
      {attachments.length === 0 ? (
        <Body><span className="text-muted-soft">Keep receipts for the expenses, including receipts for statutory charges.</span></Body>
      ) : (
        <Body>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {attachments.map((f) => (
              <li key={f.id}>
                <a href={f.file} target="_blank" rel="noreferrer" className="text-brand">{f.description || `Document ${f.id}`}</a>
                <span className="text-muted-soft"> &middot; {fmtDT(f.at)}</span>
              </li>
            ))}
          </ul>
        </Body>
      )}

      {modal === 'adjust' && (
        <AdjustModal advance={a} onClose={() => setModal('')} onDone={() => { setModal(''); onChanged(); }} />
      )}
      {modal === 'pay' && (
        <PayModal advance={a} shipment={shipment} onClose={() => setModal('')} onDone={() => { setModal(''); onChanged(); }} />
      )}
      {modal === 'reconcile' && (
        <ReconcileModal advance={a} onClose={() => setModal('')} onDone={() => { setModal(''); onChanged(); }} />
      )}
    </section>
  );
}

const emptyAdvLine = () => ({ category: '', description: '', budget_amount: '', requested_amount: '', legal_basis: '', issuing_authority: '' });

function AdvanceFormModal({ shipment, advance, onClose, onDone }) {
  const [cats, setCats] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [form, setForm] = useState(() => ({
    recipient: idStr(advance ? advance.recipient : shipment.driver),
    recipient_name: advance?.recipient_name || '',
    recipient_phone: advance?.recipient_phone || '',
    payment_method: advance?.payment_method || 'CASH',
    notes: advance?.notes || '',
  }));
  const [lines, setLines] = useState(() => (advance?.lines?.length ? advance.lines.map((l) => ({
    category: idStr(l.category), description: l.description || '', budget_amount: zeroToBlank(l.budget_amount),
    requested_amount: zeroToBlank(l.requested_amount), legal_basis: l.legal_basis || '', issuing_authority: l.issuing_authority || '',
  })) : [emptyAdvLine()]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  useEffect(() => {
    api.expenseCategories.listAll().then(setCats).catch(() => {});
    api.drivers.listAll({ company: shipment.company }).then((d) => {
      setDrivers(d);
      // new advance: default the recipient to the assigned driver
      if (!advance && shipment.driver) {
        const drv = d.find((x) => x.id === shipment.driver);
        if (drv) setForm((f) => ({ ...f, recipient_name: f.recipient_name || drv.full_name, recipient_phone: f.recipient_phone || drv.phone || '' }));
      }
    }).catch(() => {});
  }, [shipment.company, shipment.driver, advance]);

  const pickRecipient = (e) => {
    const drv = drivers.find((x) => String(x.id) === e.target.value);
    setForm((f) => ({
      ...f, recipient: e.target.value,
      recipient_name: drv ? drv.full_name : f.recipient_name,
      recipient_phone: drv ? (drv.phone || '') : f.recipient_phone,
    }));
  };

  const totalReq = lines.reduce((t, l) => t + num(l.requested_amount), 0);
  const totalBud = lines.reduce((t, l) => t + num(l.budget_amount), 0);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (!form.recipient_name.trim()) { setError('Enter the person receiving the advance.'); return; }
    const used = lines.filter((l) => l.category || l.requested_amount || l.budget_amount);
    if (!used.length) { setError('Add at least one budget line.'); return; }
    if (used.some((l) => !l.category || !(num(l.requested_amount) > 0))) {
      setError('Every line needs an expense category and a requested amount above zero.'); return;
    }
    setBusy(true);
    try {
      const body = {
        shipment: shipment.id,
        recipient: orNull(form.recipient),
        recipient_name: form.recipient_name,
        recipient_phone: form.recipient_phone,
        payment_method: form.payment_method,
        notes: form.notes,
        lines: used.map((l) => ({
          category: l.category, description: l.description, budget_amount: l.budget_amount || 0,
          requested_amount: l.requested_amount || 0, legal_basis: l.legal_basis, issuing_authority: l.issuing_authority,
        })),
      };
      if (advance) await api.tripAdvances.update(advance.id, body);
      else await api.tripAdvances.create(body);
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={advance ? `Edit ${advance.reference}` : 'New trip advance'}
      subtitle={shipment.reference}
      icon="bi-wallet2"
      size="xl"
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="advanceForm" disabled={busy}>
            <i className="bi bi-save"></i> {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <WideModalStyle formId="advanceForm" />
      <form id="advanceForm" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Driver (optional)">
            <select className="form-select" value={form.recipient} onChange={pickRecipient}>
              <option value="">{DASH}</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </Field>
          <Field label="Person receiving the advance" required>
            <input className="form-control" value={form.recipient_name} onChange={set('recipient_name')} />
          </Field>
          <Field label="Phone">
            <input className="form-control" value={form.recipient_phone} onChange={set('recipient_phone')} />
          </Field>
          <Field label="Payment method">
            <select className="form-select" value={form.payment_method} onChange={set('payment_method')}>
              <option value="CASH">Cash</option>
              <option value="MPESA">M-Pesa</option>
              <option value="BANK">Bank transfer</option>
            </select>
          </Field>
          <Field label="Notes" span>
            <input className="form-control" value={form.notes} onChange={set('notes')} />
          </Field>
        </div>

        <h6 className="modal-section-title d-flex justify-content-between align-items-center">
          <span><i className="bi bi-list-ul" aria-hidden="true"></i>Budget lines</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setLines((ls) => [...ls, emptyAdvLine()])}>
            <i className="bi bi-plus-lg"></i> Add line
          </button>
        </h6>
        <div className="table-responsive">
          <table className="table mb-0">
            <thead>
              <tr>
                <th>Expense category</th>
                <th>Description</th>
                <th className="text-right">Budget</th>
                <th className="text-right">Requested</th>
                <th>Legal basis</th>
                <th>Issuing authority</th>
                <th style={{ width: '3rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select className="form-select" value={l.category} onChange={(e) => setLine(i, 'category', e.target.value)}>
                      <option value="">{DASH}</option>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td><input className="form-control" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></td>
                  <td><input type="number" min="0" step="0.01" className="form-control num" value={l.budget_amount} onChange={(e) => setLine(i, 'budget_amount', e.target.value)} /></td>
                  <td><input type="number" min="0" step="0.01" className="form-control num" value={l.requested_amount} onChange={(e) => setLine(i, 'requested_amount', e.target.value)} /></td>
                  <td><input className="form-control" placeholder="Statutory charges only" value={l.legal_basis} onChange={(e) => setLine(i, 'legal_basis', e.target.value)} /></td>
                  <td><input className="form-control" value={l.issuing_authority} onChange={(e) => setLine(i, 'issuing_authority', e.target.value)} /></td>
                  <td>
                    {lines.length > 1 && (
                      <button type="button" className="btn btn-icon" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                        <i className="bi bi-x-lg"></i>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><strong>Total</strong></td>
                <td className="cell-num"><strong>{fmtMoney(totalBud)}</strong></td>
                <td className="cell-num"><strong>{fmtMoney(totalReq)}</strong></td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function AdjustModal({ advance, onClose, onDone }) {
  const [vals, setVals] = useState(() => Object.fromEntries((advance.lines || []).map((l) => [l.id, String(num(l.approved_amount) || num(l.requested_amount))])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api.tripAdvances.adjust(advance.id, (advance.lines || []).map((l) => ({ id: l.id, approved_amount: vals[l.id] || 0 })));
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Adjust approved amounts"
      subtitle={`${advance.reference} \u00b7 amounts can be reduced, not increased`}
      icon="bi-sliders"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="adjustForm" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
        </>
      }
    >
      <form id="adjustForm" onSubmit={submit}>
        <div className="table-responsive">
          <table className="table mb-0">
            <thead><tr><th>Expense category</th><th className="text-right">Requested</th><th className="text-right">Approved</th></tr></thead>
            <tbody>
              {(advance.lines || []).map((l) => (
                <tr key={l.id}>
                  <td className="cell-name">{l.category_label || l.category}</td>
                  <td className="cell-num">{fmtMoney(l.requested_amount)}</td>
                  <td>
                    <input type="number" min="0" max={l.requested_amount} step="0.01" className="form-control num"
                           value={vals[l.id]} onChange={(e) => setVals((v) => ({ ...v, [l.id]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
          Saving does not approve the advance. Approve it on the Approvals page after adjusting.
        </p>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function PayModal({ advance, shipment, onClose, onDone }) {
  const [banks, setBanks] = useState([]);
  const [form, setForm] = useState({
    payment_method: advance.payment_method || 'CASH', bank_account: '', payment_reference: '',
    recipient_name: advance.recipient_name || '', recipient_phone: advance.recipient_phone || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  useEffect(() => { api.bankAccounts.listAll({ company: shipment.company }).then(setBanks).catch(() => {}); }, [shipment.company]);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (form.payment_method !== 'CASH' && !form.payment_reference.trim()) { setError('Enter the M-Pesa / bank payment reference.'); return; }
    setBusy(true);
    try {
      await api.tripAdvances.pay(advance.id, { ...form, bank_account: orNull(form.bank_account) });
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Record advance payment"
      subtitle={`${advance.reference} \u00b7 ${fmtMoney(advance.approved_total)}`}
      icon="bi-cash"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="payForm" disabled={busy}>
            <i className="bi bi-check-lg"></i> {busy ? 'Saving...' : 'Record payment'}
          </button>
        </>
      }
    >
      <form id="payForm" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Person receiving the advance" required>
            <input className="form-control" value={form.recipient_name} onChange={set('recipient_name')} />
          </Field>
          <Field label="Phone">
            <input className="form-control" value={form.recipient_phone} onChange={set('recipient_phone')} />
          </Field>
          <Field label="Payment method" required>
            <select className="form-select" value={form.payment_method} onChange={set('payment_method')}>
              <option value="CASH">Cash</option>
              <option value="MPESA">M-Pesa</option>
              <option value="BANK">Bank transfer</option>
            </select>
          </Field>
          <Field label="Paid from account">
            <select className="form-select" value={form.bank_account} onChange={set('bank_account')}>
              <option value="">{DASH}</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Payment reference" required={form.payment_method !== 'CASH'} span>
            <input className="form-control" value={form.payment_reference} onChange={set('payment_reference')} />
          </Field>
        </div>
        <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
          This records who was paid, how and when. The ledger entry is created later, when the actual expenses are posted.
        </p>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function ReconcileModal({ advance, onClose, onDone }) {
  const [rows, setRows] = useState(() => (advance.lines || []).map((l) => ({
    id: l.id, label: l.category_label || l.category, approved: l.approved_amount,
    actual_amount: String(num(l.actual_amount) || ''), receipt_no: l.receipt_no || '',
    legal_basis: l.legal_basis || '', issuing_authority: l.issuing_authority || '',
  })));
  const [returned, setReturned] = useState(String(num(advance.returned_amount) || ''));
  const [returnRef, setReturnRef] = useState(advance.return_reference || '');
  const [notes, setNotes] = useState(advance.status === 'RECONCILIATION_PENDING' ? (advance.reconciliation_notes || '') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const actualTotal = rows.reduce((t, r) => t + num(r.actual_amount), 0);
  const balance = num(advance.paid_amount) - actualTotal;

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api.tripAdvances.submitReconciliation(advance.id, {
        lines: rows.map((r) => ({
          id: r.id, actual_amount: r.actual_amount || 0, receipt_no: r.receipt_no,
          legal_basis: r.legal_basis, issuing_authority: r.issuing_authority,
        })),
        returned_amount: returned || 0,
        return_reference: returnRef,
        notes,
      });
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Trip expense reconciliation"
      subtitle={`${advance.reference} \u00b7 advance issued ${fmtMoney(advance.paid_amount)}`}
      icon="bi-clipboard-check"
      size="xl"
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="reconcileForm" disabled={busy}>
            <i className="bi bi-send"></i> {busy ? 'Submitting...' : 'Submit for approval'}
          </button>
        </>
      }
    >
      <WideModalStyle formId="reconcileForm" />
      <form id="reconcileForm" onSubmit={submit}>
        <div className="table-responsive">
          <table className="table mb-0">
            <thead>
              <tr>
                <th>Expense</th>
                <th className="text-right">Advance (approved)</th>
                <th className="text-right">Actual</th>
                <th>Receipt no.</th>
                <th>Legal basis</th>
                <th>Issuing authority</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="cell-name">{r.label}</td>
                  <td className="cell-num">{fmtMoney(r.approved)}</td>
                  <td><input type="number" min="0" step="0.01" className="form-control num" value={r.actual_amount} onChange={(e) => setRow(i, 'actual_amount', e.target.value)} /></td>
                  <td><input className="form-control" value={r.receipt_no} onChange={(e) => setRow(i, 'receipt_no', e.target.value)} /></td>
                  <td><input className="form-control" value={r.legal_basis} onChange={(e) => setRow(i, 'legal_basis', e.target.value)} /></td>
                  <td><input className="form-control" value={r.issuing_authority} onChange={(e) => setRow(i, 'issuing_authority', e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td className="cell-num"><strong>{fmtMoney(advance.paid_amount)}</strong></td>
                <td className="cell-num"><strong>{fmtMoney(actualTotal)}</strong></td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className={`alert ${balance < 0 ? 'alert-danger' : 'alert-info'} mt-3`} role="status">
          {balance >= 0
            ? `Amount to return: ${fmtMoney(balance)}`
            : `The actual expenses are ${fmtMoney(Math.abs(balance))} more than the advance (owed to the employee).`}
        </div>

        <div className="form-grid">
          <Field label="Cash returned so far">
            <input type="number" min="0" step="0.01" className="form-control num" value={returned} onChange={(e) => setReturned(e.target.value)} />
          </Field>
          <Field label="Return reference (M-Pesa / receipt)">
            <input className="form-control" value={returnRef} onChange={(e) => setReturnRef(e.target.value)} />
          </Field>
          <Field label="Notes" span>
            <input className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
          Attach the receipts on the advance after submitting. Another user approves the reconciliation.
        </p>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/* ================================================================================================
 * Delivery tab (delivery confirmation)
 * ============================================================================================== */
function DeliveryTab({ shipment, order, deliveries, onChanged, canEdit }) {
  const [showNew, setShowNew] = useState(false);
  const orderLine = order?.lines?.find((l) => String(l.product) === String(shipment.product));
  const dispatched = shipment.stock_issued ? num(shipment.loading_quantity) : 0;
  const active = deliveries.filter((d) => ['APPROVED', 'PENDING_APPROVAL'].includes(d.status));
  const received = active.reduce((t, d) => t + num(d.delivered_quantity), 0);
  const approved = deliveries.filter((d) => d.status === 'APPROVED').reduce((t, d) => t + num(d.delivered_quantity), 0);
  const discrepancy = dispatched - received;
  const hasFinal = deliveries.some((d) => d.is_final && d.status === 'APPROVED');
  const pending = deliveries.some((d) => d.status === 'PENDING_APPROVAL');

  return (
    <>
      <section className="page-card">
        <SectionHeader first icon="bi-clipboard2-check" title="Delivery Confirmation">
          {canEdit && shipment.status === 'ARRIVED' && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowNew(true)}>
              <i className="bi bi-plus-lg"></i> Record delivery
            </button>
          )}
        </SectionHeader>
        <Body>
          <KV items={[
            ['Shipment reference', shipment.reference],
            ['Ordered quantity', orderLine ? fmtL(orderLine.quantity) : DASH],
            ['Allocated quantity', fmtL(shipment.quantity)],
            ['Dispatched quantity', shipment.stock_issued ? fmtL(dispatched) : 'Not dispatched yet'],
            ['Received quantity (confirmed)', fmtL(approved)],
            ['Delivery discrepancy', shipment.stock_issued ? fmtL(discrepancy) : DASH],
            ['Final delivery', hasFinal ? 'Recorded' : 'Not yet'],
          ]} />
          {shipment.stock_issued && Math.abs(discrepancy) > 0.0005 && (
            <div className="alert alert-warning mt-3 mb-0" role="status">
              {discrepancy > 0
                ? `${fmtL(discrepancy)} of the dispatched quantity is not yet confirmed as received.`
                : 'More was received than was dispatched. Check the quantities.'}
              {' '}The shipment cannot be marked delivered until the final delivery is recorded
              {pending ? ' and the variance awaiting approval is decided.' : '.'}
            </div>
          )}
          {shipment.status !== 'ARRIVED' && !hasFinal && (
            <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
              Deliveries are recorded once the shipment has ARRIVED at the destination.
            </p>
          )}
        </Body>

        <SectionHeader icon="bi-geo-alt" title="Deliveries" subtitle={`${deliveries.length} deliver${deliveries.length !== 1 ? 'ies' : 'y'}`} />
        {deliveries.length === 0 ? (
          <EmptyState icon="bi-geo-alt" title="No deliveries yet" />
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th>Received by</th>
                    <th>Delivery note</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Shortage</th>
                    <th className="text-right">Shortage %</th>
                    <th>Documents</th>
                    <th>Final</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="cell-mono text-brand fw-600">{d.reference}</td>
                      <td>{d.delivery_date}</td>
                      <td>
                        {d.received_by || DASH}
                        {d.receiver_contact && <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>{d.receiver_contact}</div>}
                      </td>
                      <td className="cell-mono">{d.delivery_note_no || DASH}</td>
                      <td className="cell-num">{num(d.delivered_quantity).toLocaleString()}</td>
                      <td className="cell-num">{num(d.shortage_litres).toLocaleString()}</td>
                      <td className="cell-num">{num(d.shortage_pct).toFixed(3)}%</td>
                      <td>
                        {d.pod_file && <a href={d.pod_file} target="_blank" rel="noreferrer" className="text-brand">Signed note</a>}
                        {d.pod_file && d.receiver_signature && ' \u00b7 '}
                        {d.receiver_signature && <a href={d.receiver_signature} target="_blank" rel="noreferrer" className="text-brand">Signature</a>}
                        {!d.pod_file && !d.receiver_signature && DASH}
                      </td>
                      <td>{d.is_final ? <span className="status-pill status-pill--success">Final</span> : DASH}</td>
                      <td>
                        <span className={`status-pill ${d.status === 'APPROVED' ? 'status-pill--success' : d.status === 'REJECTED' ? 'status-pill--danger' : 'status-pill--warning'}`}>
                          {label(d.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {showNew && (
        <NewDeliveryModal
          shipment={shipment}
          dispatched={dispatched}
          received={received}
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); onChanged(); }}
        />
      )}
    </>
  );
}

function NewDeliveryModal({ shipment, dispatched, received, onClose, onDone }) {
  const { notify } = useApp();
  const [form, setForm] = useState({
    delivered_quantity: '', delivery_date: todayISO(), is_final: false,
    received_by: '', receiver_contact: '', delivery_note_no: '', notes: '',
    pod_file: null, receiver_signature: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setFile = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.files?.[0] || null }));

  const remaining = dispatched - received;
  const entered = num(form.delivered_quantity);
  const shortage = form.is_final ? Math.max(remaining - entered, 0) : 0;
  const shortagePct = dispatched ? (shortage / dispatched) * 100 : 0;

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});
    if (!form.received_by.trim()) { setError('Enter the name of the customer representative who received the fuel.'); return; }
    setBusy(true);
    try {
      const dv = await api.shipments.recordDelivery(shipment.id, form);
      if (dv?.status === 'PENDING_APPROVAL') notify('Delivery recorded. The shortage needs approval before it is confirmed.', 'success');
      onDone();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Delivery confirmation"
      subtitle={shipment.reference}
      icon="bi-geo-alt"
      size="xl"
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="deliveryForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Recording...' : 'Record delivery'}
          </button>
        </>
      }
    >
      <WideModalStyle formId="deliveryForm" />
      <form id="deliveryForm" onSubmit={submit}>
        <KV items={[
          ['Dispatched quantity', fmtL(dispatched)],
          ['Already confirmed', fmtL(received)],
          ['Still in transit', fmtL(remaining)],
        ]} />

        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Delivery Details</h6>
        <div className="form-grid">
          <Field label="Received quantity (L)" required err={fieldErr.delivered_quantity}>
            <input type="number" step="0.001" className="form-control num" value={form.delivered_quantity}
                   onChange={set('delivered_quantity')} required />
          </Field>
          <Field label="Actual delivery date" required err={fieldErr.delivery_date}>
            <input type="date" className="form-control" value={form.delivery_date} onChange={set('delivery_date')} required />
          </Field>
          <Field label="Receiver name (customer representative)" required err={fieldErr.received_by}>
            <input className="form-control" value={form.received_by} onChange={set('received_by')} />
          </Field>
          <Field label="Receiver contact" err={fieldErr.receiver_contact}>
            <input className="form-control" value={form.receiver_contact} onChange={set('receiver_contact')} />
          </Field>
          <Field label="Delivery note number" err={fieldErr.delivery_note_no}>
            <input className="form-control" value={form.delivery_note_no} onChange={set('delivery_note_no')} />
          </Field>
          <Field label="Signed delivery note" err={fieldErr.pod_file}>
            <input type="file" className="form-control" onChange={setFile('pod_file')} />
          </Field>
          <Field label="Receiver signature (image)" err={fieldErr.receiver_signature}>
            <input type="file" accept="image/*" className="form-control" onChange={setFile('receiver_signature')} />
          </Field>
          <Field label="Final delivery">
            <label className="form-check">
              <input type="checkbox" checked={!!form.is_final} onChange={set('is_final')} />{' '}
              This is the final delivery for the shipment
            </label>
          </Field>
          <Field label="Remarks" span>
            <textarea className="form-control" rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>

        {form.delivered_quantity !== '' && (
          <div className={`alert ${shortage > 0 ? 'alert-warning' : 'alert-info'} mt-3 mb-0`} role="status">
            {form.is_final
              ? (shortage > 0
                ? `Delivery discrepancy: ${fmtL(shortage)} (${shortagePct.toFixed(3)}%). A shortage above the company tolerance needs approval and the shipment will not be marked delivered until it is decided.`
                : 'No discrepancy against the dispatched quantity.')
              : `${fmtL(Math.max(remaining - entered, 0))} would still be in transit after this partial delivery.`}
          </div>
        )}
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/* ================================================================================================
 * Financial summary tab
 * ============================================================================================== */
function FinancialTab({ shipment, sheets, advances, expenses, onChanged, canFinalize }) {
  const latest = sheets[0];
  const live = advances.filter((a) => a.status !== 'CANCELLED');
  const sum = (key) => live.reduce((t, a) => t + num(a[key]), 0);
  const requested = sum('total');
  const approved = live.filter((a) => !['DRAFT', 'AWAITING_APPROVAL'].includes(a.status)).reduce((t, a) => t + num(a.approved_total), 0);
  const paid = sum('paid_amount');
  const actual = live.filter((a) => ['RECONCILIATION_PENDING', 'RECONCILED'].includes(a.status)).reduce((t, a) => t + num(a.actual_total), 0);

  return (
    <>
      <section className="page-card">
        <SectionHeader first icon="bi-graph-up" title="Shipment Profitability"
                       subtitle={latest ? `Cost sheet v${latest.version}${latest.is_final ? ' \u00b7 final' : ' \u00b7 provisional'}` : 'No cost sheet yet'} />
        <Body>
          <KV items={[
            ['Expected sales value', fmtMoney(shipment.total_sales_value, shipment.currency)],
            ['Revenue (invoiced)', latest ? fmtMoney(latest.revenue) : DASH],
            ['Total shipment cost', latest ? fmtMoney(latest.total_shipment_cost) : DASH],
            ['Gross profit', latest ? fmtMoney(latest.gross_profit) : DASH],
            ['Contribution', latest ? fmtMoney(latest.contribution) : DASH],
            ['Margin %', latest ? `${num(latest.margin_pct).toFixed(2)}%` : DASH],
          ]} />
        </Body>
        <SectionHeader icon="bi-wallet2" title="Trip Budget vs Actual" subtitle={`${live.length} advance${live.length !== 1 ? 's' : ''}`} />
        <Body>
          <KV items={[
            ['Trip budget requested', fmtMoney(requested)],
            ['Approved', fmtMoney(approved)],
            ['Advance paid', fmtMoney(paid)],
            ['Actual spend (submitted)', fmtMoney(actual)],
          ]} />
        </Body>
      </section>

      <CostingTab shipment={shipment} sheets={sheets} onChanged={onChanged} canFinalize={canFinalize} />
      <ExpensesTab expenses={expenses} />
    </>
  );
}

function CostingTab({ shipment, sheets, onChanged, canFinalize }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const compute = async (opts = {}) => {
    setBusy(true); setError('');
    try {
      await api.shipments.cost(shipment.id, { ...opts, notes: '' });
      onChanged();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const exportSheet = async () => {
    try { await api.shipments.exportCostSheet(shipment.id, 'xlsx'); }
    catch (err) { setError(errorMessage(err)); }
  };

  const latest = sheets[0];
  const components = Object.entries(latest?.components || {});

  return (
    <>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <section className="page-card">
        <SectionHeader first icon="bi-calculator" title="Cost Sheet" subtitle={latest ? `v${latest.version}${latest.is_final ? ' \u00b7 final' : ''}` : undefined}>
          <span className="row-actions">
            {latest && (
              <>
                <button className="btn btn-sm btn-secondary" onClick={exportSheet}>
                  <i className="bi bi-download"></i> Export
                </button>
                {canFinalize && !latest.is_final && (
                  <button className="btn btn-sm btn-primary" onClick={() => compute({ finalize: true })} disabled={busy}>Finalise</button>
                )}
                {canFinalize && latest.is_final && (
                  <button className="btn btn-sm btn-secondary" onClick={() => compute({ reopen: true })} disabled={busy}>Reopen</button>
                )}
                <button className="btn btn-sm btn-secondary" onClick={() => compute({})} disabled={busy}>
                  <i className="bi bi-arrow-clockwise"></i> {busy ? 'Computing...' : 'Recompute'}
                </button>
              </>
            )}
            {!latest && (
              <button className="btn btn-sm btn-primary" onClick={() => compute({})} disabled={busy}>
                {busy ? 'Computing...' : 'Compute first version'}
              </button>
            )}
          </span>
        </SectionHeader>

        {!latest ? (
          <EmptyState icon="bi-calculator" title="No cost sheet yet" text="Compute a provisional version after expenses are posted." />
        ) : (
          <Body>
            <KV items={[
              ['Version', `v${latest.version}${latest.is_final ? ' \u00b7 final' : ''}`],
              ['Purchase cost', fmtMoney(latest.purchase_cost)],
              ['Direct expenses', fmtMoney(latest.total_direct_expenses)],
              ['Total cost', fmtMoney(latest.total_shipment_cost)],
              ['Loaded', fmtL(latest.loaded_litres)],
              ['Delivered', fmtL(latest.delivered_litres)],
              ['Delivered cost / L', num(latest.delivered_cost_per_litre).toFixed(6)],
              ['Revenue', fmtMoney(latest.revenue)],
              ['COGS', fmtMoney(latest.cogs)],
              ['Gross profit', fmtMoney(latest.gross_profit)],
              ['Contribution', fmtMoney(latest.contribution)],
              ['Margin %', `${num(latest.margin_pct).toFixed(2)}%`],
            ]} />
          </Body>
        )}

        {latest && components.length > 0 && (
          <>
            <SectionHeader icon="bi-diagram-3" title="Components" subtitle={`${components.length} item${components.length !== 1 ? 's' : ''}`} />
            <div className="table-wrap">
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr><th>Component</th><th className="text-right">Amount</th></tr>
                  </thead>
                  <tbody>
                    {components.map(([k, v]) => (
                      <tr key={k}><td className="cell-name">{label(k)}</td><td className="cell-num">{fmtMoney(v)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      {sheets.length > 1 && (
        <section className="page-card">
          <SectionHeader first icon="bi-clock-history" title="Version History" subtitle={`${sheets.length} versions`} />
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Final</th>
                    <th className="text-right">Total cost</th>
                    <th className="text-right">Delivered L</th>
                    <th className="text-right">Cost / L</th>
                    <th className="text-right">Contribution</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map((sh) => (
                    <tr key={sh.id}>
                      <td className="cell-mono fw-600">v{sh.version}</td>
                      <td>{sh.is_final ? <span className="status-pill status-pill--success">Final</span> : DASH}</td>
                      <td className="cell-num">{fmtMoney(sh.total_shipment_cost)}</td>
                      <td className="cell-num">{num(sh.delivered_litres).toLocaleString()}</td>
                      <td className="cell-num">{num(sh.delivered_cost_per_litre).toFixed(6)}</td>
                      <td className="cell-num">{fmtMoney(sh.contribution)}</td>
                      <td>{fmtDT(sh.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function ExpensesTab({ expenses }) {
  return (
    <section className="page-card">
      <SectionHeader first icon="bi-receipt" title="Expenses on this shipment" subtitle={`${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`} />
      {!expenses.length ? (
        <EmptyState icon="bi-receipt" title="No expenses yet" text="Approved trip reconciliations create draft expenses here. Allocate other expenses from the Expenses page." />
      ) : (
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Outstanding</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-mono text-brand fw-600">{e.reference}</td>
                    <td>{e.expense_date}</td>
                    <td>{e.category_label || e.category}</td>
                    <td className="text-truncate" style={{ maxWidth: 260 }}>{e.description}</td>
                    <td className="cell-num">{fmtMoney(e.total, e.currency)}</td>
                    <td className="cell-num">{fmtMoney(e.outstanding)}</td>
                    <td><span className={`status-pill ${expensePill(e.status)}`}>{label(e.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

/* ================================================================================================
 * Activity log: status history + audit trail, newest first
 * ============================================================================================== */
function ActivityTab({ timeline, audit }) {
  const items = [
    ...timeline.map((h) => ({
      key: `s${h.id}`, at: h.at, kind: 'status', title: label(h.to), pill: statusPill(h.to),
      meta: [h.location, h.by].filter(Boolean).join(' \u00b7 '), text: h.comments,
    })),
    ...audit.map((a) => ({
      key: `a${a.id}`, at: a.created_at, kind: 'audit', title: label(a.action), pill: 'status-pill--neutral',
      meta: a.user_label || '', text: '',
    })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at));

  return (
    <section className="page-card">
      <SectionHeader first icon="bi-clock-history" title="Activity Log" subtitle={`${items.length} event${items.length !== 1 ? 's' : ''}`} />
      {!items.length ? (
        <EmptyState icon="bi-clock-history" title="No activity yet" />
      ) : (
        <Body>
          <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((it) => (
              <li key={it.key} className="d-flex items-start gap-3" style={{ padding: '0.5rem 0' }}>
                <span className={`status-pill ${it.pill}`}>{it.title}</span>
                <div className="flex-1">
                  <div className="cell-name">{it.kind === 'status' ? 'Status change' : 'Record activity'}</div>
                  <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>{it.meta ? `${it.meta} \u00b7 ` : ''}{fmtDT(it.at)}</div>
                  {it.text && <div style={{ fontSize: '0.8125rem' }}>{it.text}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Body>
      )}
    </section>
  );
}

/* ================================================================================================
 * Status transition modal
 * ============================================================================================== */
function TransitionModal({ shipment, lines = [], transitions, onGoToLoading, onClose, onDone }) {
  const [status, setStatus] = useState(transitions[0] || '');
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 16));
  const [location, setLocation] = useState('');
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});

  // LOADING -> LOADED needs litres loaded (and a source tank) on at least one line. They are recorded on the
  // Loading tab, so stop here instead of sending a request the server will refuse.
  const toLoaded = status === 'LOADED';
  const loadedLines = lines.filter((l) => num(l.loaded_quantity) > 0);
  const noLoading = toLoaded && loadedLines.length === 0;
  const noTank = toLoaded && !noLoading && loadedLines.some((l) => !l.tank);
  const blocked = noLoading || noTank;

  const submit = async (e) => {
    e.preventDefault();
    if (blocked) return;
    setBusy(true); setError(''); setFieldErr({});
    try {
      await api.shipments.updateStatus(shipment.id, { new_status: status, when, location, comments });
      onDone();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Update status"
      subtitle={`${shipment.reference} \u00b7 currently ${label(shipment.status)}`}
      icon="bi-arrow-repeat"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="transitionForm" disabled={busy || blocked}>
            <i className="bi bi-check-lg"></i>
            {busy ? 'Updating...' : 'Update'}
          </button>
        </>
      }
    >
      <form id="transitionForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Status Change</h6>
        <div className="form-grid">
          <Field label="Next status" required err={fieldErr.new_status}>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {transitions.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </Field>
          <Field label="When">
            <input type="datetime-local" className="form-control" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Location" span>
            <input className="form-control" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="Comments" span>
            <textarea className="form-control" rows={2} value={comments} onChange={(e) => setComments(e.target.value)} />
          </Field>
        </div>

        {blocked && (
          <div className="alert alert-warning mt-3" role="status">
            {noLoading
              ? 'Record the loaded quantity on at least one line before marking the shipment as loaded.'
              : 'Every loaded line needs a source tank. Set the tank on the Loading tab.'}{' '}
            {onGoToLoading && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={onGoToLoading}>
                Go to Loading tab
              </button>
            )}
          </div>
        )}
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}