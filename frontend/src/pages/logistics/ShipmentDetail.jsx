/**
 * Shipment detail — the operations cockpit.
 * Handles: submit → approve (via Approvals) → record loading → update status (approve/await loading/…) →
 * record delivery → compute cost sheet → fuel variance → close.
 *
 * Endpoints used:
 *   /shipments/:id/ (detail + lines)
 *   /shipments/:id/submit/
 *   /shipments/:id/record-loading/    { lines:[{id, loaded_quantity, tank?, compartment?}], loading_date? }
 *   /shipments/:id/update-status/     { new_status, when?, location?, comments?, confirmation_type?, confirmed_by?, attachment? }
 *   /shipments/:id/trip-data/         { distance_km?, fuel_issued_litres?, fuel_used_litres?, expected_delivery? }
 *   /shipments/:id/record-delivery/   { delivered_quantity, delivery_date?, is_final?, received_by?, notes?, pod_file? }
 *   /shipments/:id/cost/              { finalize?, reopen?, notes? }
 *   /shipments/:id/cost-sheets/
 *   /shipments/:id/cost-sheet/export  → xlsx/pdf
 *   /shipments/:id/fuel/
 *   /shipments/:id/timeline/
 *   /expenses?shipment=...            (to allocate)
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'bi-info-circle' },
  { key: 'loading', label: 'Loading', icon: 'bi-box-arrow-in-down' },
  { key: 'deliveries', label: 'Deliveries', icon: 'bi-geo-alt' },
  { key: 'costing', label: 'Costing', icon: 'bi-calculator' },
  { key: 'expenses', label: 'Expenses', icon: 'bi-receipt' },
  { key: 'timeline', label: 'Timeline', icon: 'bi-clock-history' },
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

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const label = (s) => (s || '').replace(/_/g, ' ');

const statusPill = (s) => {
  if (s === 'DRAFT' || s === 'CLOSED') return 'status-pill--neutral';
  if (['AWAITING_APPROVAL', 'AWAITING_LOADING', 'LOADING', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'RECONCILIATION_PENDING'].includes(s)) return 'status-pill--warning';
  if (['APPROVED', 'LOADED', 'DISPATCHED', 'CLEARED', 'ARRIVED', 'DELIVERED'].includes(s)) return 'status-pill--success';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral';
};
const expensePill = (s) => {
  if (s === 'POSTED' || s === 'PAID') return 'status-pill--info';
  if (s === 'APPROVED') return 'status-pill--success';
  return 'status-pill--neutral';
};

/** Small helper: padded body area inside a .page-card section. */
const Body = ({ children, flush }) => (
  <div style={flush ? undefined : { padding: '1rem 1.25rem' }}>{children}</div>
);

/** Section header inside a .page-card (matches the "Product List" header in Products). */
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

export default function ShipmentDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { notify } = useApp();
  const [s, setS] = useState(null);
  const [lines, setLines] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [fuel, setFuel] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTransition, setShowTransition] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [detail, tl, cs, fu, ex] = await Promise.all([
        api.shipments.get(id),
        api.shipments.timeline(id).catch(() => []),
        api.shipments.costSheets(id).catch(() => []),
        api.shipments.fuel(id).catch(() => null),
        api.expenses.listAll({ shipment: id }).catch(() => []),
      ]);
      setS(detail);
      setLines(detail.lines || []);
      setTimeline(tl || []);
      setSheets(cs || []);
      setFuel(fu);
      setExpenses(ex || []);
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

  const act = async (fn, msg) => {
    try { await fn(); notify(msg, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div>
      {/* ---------- Page header: icon tile + title + actions ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-box-seam"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">
              {s.reference}{' '}
              <span className={`status-pill ${statusPill(s.status)}`}>{label(s.status)}</span>
            </h1>
            <p className="page-subtitle">
              {s.customer_label || s.supplier_label || '—'} · {s.product_label || s.product} · {Number(s.quantity || 0).toLocaleString()} L
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/logistics/shipments" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Shipments
          </Link>
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
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview s={s} lines={lines} fuel={fuel} />}
      {tab === 'loading' && <LoadingTab shipment={s} lines={lines} onChanged={load} canEdit={can('shipments.edit')} />}
      {tab === 'deliveries' && <DeliveriesTab shipment={s} onChanged={load} canEdit={can('shipments.edit')} />}
      {tab === 'costing' && <CostingTab shipment={s} sheets={sheets} onChanged={load} canFinalize={can('costing.finalize')} />}
      {tab === 'expenses' && <ExpensesTab expenses={expenses} />}
      {tab === 'timeline' && <TimelineTab rows={timeline} />}

      {showTransition && (
        <TransitionModal
          shipment={s}
          transitions={forwardTransitions}
          onClose={() => setShowTransition(false)}
          onDone={() => { setShowTransition(false); notify('Status updated.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- tabs */

function Overview({ s, lines, fuel }) {
  return (
    <>
      <section className="page-card">
        <SectionHeader first icon="bi-info-circle" title="Shipment Details" />
        <Body>
          <KV items={[
            ['Customer / supplier', s.customer_label || s.supplier_label || '—'],
            ['Product', s.product_label || s.product],
            ['Quantity', `${Number(s.quantity || 0).toLocaleString()} L`],
            ['Loaded quantity', `${Number(s.loading_quantity || 0).toLocaleString()} L`],
            ['Origin → Destination', `${s.origin || '—'} → ${s.destination || '—'}`],
            ['Expected delivery', s.expected_delivery || '—'],
            ['Vehicle / Driver', `${s.vehicle_label || s.hired_truck_label || '—'} · ${s.driver_label || '—'}`],
            ['Transporter', s.transporter_label || '—'],
          ]} />
        </Body>
      </section>

      <section className="page-card">
        <SectionHeader first icon="bi-list-ul" title="Lines" subtitle={`${lines.length} line${lines.length !== 1 ? 's' : ''}`} />
        {lines.length === 0 ? (
          <EmptyState icon="bi-droplet" title="No lines" />
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Loaded</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="cell-name">{l.product_label || l.product}</td>
                      <td className="cell-num">{Number(l.quantity || 0).toLocaleString()}</td>
                      <td className="cell-num">{Number(l.loaded_quantity || 0).toLocaleString()}</td>
                      <td className="cell-num">{Number(l.unit_cost || 0).toFixed(6)}</td>
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
          <SectionHeader first icon="bi-fuel-pump" title="Fuel Variance">
            {fuel.flag && <span className="status-pill status-pill--warning">Flag</span>}
          </SectionHeader>
          <Body>
            <KV items={[
              ['Expected', `${Number(fuel.expected_litres).toFixed(3)} L`],
              ['Actual', `${Number(fuel.actual_litres).toFixed(3)} L`],
              ['Variance', `${Number(fuel.variance_litres).toFixed(3)} L`],
              ['Variance %', `${Number(fuel.variance_pct).toFixed(3)} %`],
            ]} />
          </Body>
        </section>
      )}
    </>
  );
}

function LoadingTab({ shipment, lines, onChanged, canEdit }) {
  const [tanks, setTanks] = useState([]);
  const [rows, setRows] = useState(() => lines.map((l) => ({
    id: l.id, loaded_quantity: l.loaded_quantity || '', tank: l.tank || '', compartment: l.compartment || '',
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.storageTanks.listAll({ company: shipment.company }).then(setTanks).catch(() => {}); }, [shipment.company]);

  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

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
          text="Move the shipment to AWAITING LOADING → LOADING first."
        />
      </section>
    );
  }

  return (
    <section className="page-card">
      <SectionHeader first icon="bi-box-arrow-in-down" title="Record Loading" subtitle={`${rows.length} line${rows.length !== 1 ? 's' : ''}`} />
      <form onSubmit={save}>
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Product</th>
                  <th className="text-right">Ordered</th>
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
                      <td className="cell-name">{l?.product_label || '—'}</td>
                      <td className="cell-num">{Number(l?.quantity || 0).toLocaleString()}</td>
                      <td>
                        <input type="number" step="0.001" className="form-control num" value={r.loaded_quantity}
                               disabled={!canEdit} onChange={(e) => setRow(i, 'loaded_quantity', e.target.value)} />
                      </td>
                      <td>
                        <select className="form-select" value={r.tank} disabled={!canEdit} onChange={(e) => setRow(i, 'tank', e.target.value)}>
                          <option value="">—</option>
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
          </Body>
        )}
      </form>
    </section>
  );
}

function DeliveriesTab({ shipment, onChanged, canEdit }) {
  const [rows, setRows] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRows(await api.shipmentDeliveries.listAll({ shipment: shipment.id })); }
    catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [shipment.id]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <section className="page-card">
        <SectionHeader first icon="bi-geo-alt" title="Deliveries" subtitle={`${rows.length} deliver${rows.length !== 1 ? 'ies' : 'y'}`}>
          {canEdit && shipment.status === 'ARRIVED' && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowNew(true)}>
              <i className="bi bi-plus-lg"></i> Record delivery
            </button>
          )}
        </SectionHeader>

        {loading ? (
          <TableSkeleton rows={4} columns={9} />
        ) : rows.length === 0 ? (
          <EmptyState icon="bi-geo-alt" title="No deliveries yet" />
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Shortage</th>
                    <th className="text-right">Shortage %</th>
                    <th className="text-right">COGS</th>
                    <th className="text-right">Loss</th>
                    <th>Final</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      <td className="cell-mono text-brand fw-600">{d.reference}</td>
                      <td>{d.delivery_date}</td>
                      <td className="cell-num">{Number(d.delivered_quantity).toLocaleString()}</td>
                      <td className="cell-num">{Number(d.shortage_litres || 0).toLocaleString()}</td>
                      <td className="cell-num">{Number(d.shortage_pct || 0).toFixed(3)}%</td>
                      <td className="cell-num">{fmtMoney(d.cogs_value)}</td>
                      <td className="cell-num">{fmtMoney(d.loss_value)}</td>
                      <td>{d.is_final ? <span className="status-pill status-pill--success">Final</span> : '—'}</td>
                      <td>
                        <span className={`status-pill ${d.status === 'APPROVED' ? 'status-pill--success' : d.status === 'REJECTED' ? 'status-pill--danger' : 'status-pill--warning'}`}>
                          {d.status}
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
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); load(); onChanged(); }}
        />
      )}
    </>
  );
}

function NewDeliveryModal({ shipment, onClose, onDone }) {
  const [form, setForm] = useState({
    delivered_quantity: '', delivery_date: todayISO(), is_final: false,
    received_by: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try { await api.shipments.recordDelivery(shipment.id, form); onDone(); }
    catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Record delivery"
      subtitle={shipment.reference}
      icon="bi-geo-alt"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="deliveryForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Recording...' : 'Record'}
          </button>
        </>
      }
    >
      <form id="deliveryForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Delivery Details</h6>
        <div className="form-grid">
          <Field label="Delivered quantity (L)" required err={fieldErr.delivered_quantity}>
            <input type="number" step="0.001" className="form-control num" value={form.delivered_quantity}
                   onChange={set('delivered_quantity')} required />
          </Field>
          <Field label="Date" required err={fieldErr.delivery_date}>
            <input type="date" className="form-control" value={form.delivery_date} onChange={set('delivery_date')} required />
          </Field>
          <Field label="Received by">
            <input className="form-control" value={form.received_by} onChange={set('received_by')} />
          </Field>
          <Field label="Final delivery" span>
            <label className="form-check">
              <input type="checkbox" checked={!!form.is_final} onChange={set('is_final')} />{' '}
              This is the final delivery (shortage over tolerance needs approval)
            </label>
          </Field>
          <Field label="Notes" span>
            <textarea className="form-control" rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function CostingTab({ shipment, sheets, onChanged, canFinalize }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');

  const compute = async (opts = {}) => {
    setBusy(true); setError('');
    try {
      await api.shipments.cost(shipment.id, { ...opts, notes });
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
        <SectionHeader first icon="bi-calculator" title="Cost Sheet" subtitle={latest ? `v${latest.version}${latest.is_final ? ' · final' : ''}` : undefined}>
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
              ['Version', `v${latest.version}${latest.is_final ? ' · final' : ''}`],
              ['Purchase cost', fmtMoney(latest.purchase_cost)],
              ['Direct expenses', fmtMoney(latest.total_direct_expenses)],
              ['Total cost', fmtMoney(latest.total_shipment_cost)],
              ['Loaded', `${Number(latest.loaded_litres || 0).toLocaleString()} L`],
              ['Delivered', `${Number(latest.delivered_litres || 0).toLocaleString()} L`],
              ['Delivered cost / L', Number(latest.delivered_cost_per_litre || 0).toFixed(6)],
              ['Revenue', fmtMoney(latest.revenue)],
              ['COGS', fmtMoney(latest.cogs)],
              ['Gross profit', fmtMoney(latest.gross_profit)],
              ['Contribution', fmtMoney(latest.contribution)],
              ['Margin %', `${Number(latest.margin_pct || 0).toFixed(2)}%`],
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
                      <tr key={k}><td className="cell-name">{k}</td><td className="cell-num">{fmtMoney(v)}</td></tr>
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
                      <td>{sh.is_final ? <span className="status-pill status-pill--success">Final</span> : '—'}</td>
                      <td className="cell-num">{fmtMoney(sh.total_shipment_cost)}</td>
                      <td className="cell-num">{Number(sh.delivered_litres || 0).toLocaleString()}</td>
                      <td className="cell-num">{Number(sh.delivered_cost_per_litre || 0).toFixed(6)}</td>
                      <td className="cell-num">{fmtMoney(sh.contribution)}</td>
                      <td>{sh.created_at}</td>
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
        <EmptyState icon="bi-receipt" title="No expenses yet" text="Allocate expenses from the Expenses page." />
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

function TimelineTab({ rows }) {
  return (
    <section className="page-card">
      <SectionHeader first icon="bi-clock-history" title="Status History" subtitle={`${rows.length} update${rows.length !== 1 ? 's' : ''}`} />
      {!rows.length ? (
        <EmptyState icon="bi-clock-history" title="No status updates yet" />
      ) : (
        <Body>
          <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((h) => (
              <li key={h.id} className="d-flex items-start gap-3" style={{ padding: '0.5rem 0' }}>
                <span className={`status-pill ${statusPill(h.to)}`}>{label(h.to)}</span>
                <div className="flex-1">
                  <div className="cell-name">{h.location || '—'}</div>
                  <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>{h.by || ''} · {h.at}</div>
                  {h.comments && <div style={{ fontSize: '0.8125rem' }}>{h.comments}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Body>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- status transition modal */

function TransitionModal({ shipment, transitions, onClose, onDone }) {
  const [status, setStatus] = useState(transitions[0] || '');
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 16));
  const [location, setLocation] = useState('');
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
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
      subtitle={`${shipment.reference} · currently ${label(shipment.status)}`}
      icon="bi-arrow-repeat"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="transitionForm" disabled={busy}>
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
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}