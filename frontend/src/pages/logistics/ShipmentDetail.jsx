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
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const statusCls = (s) => {
  if (s === 'DRAFT') return 'status status-draft';
  if (['AWAITING_APPROVAL', 'AWAITING_LOADING', 'LOADING', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'RECONCILIATION_PENDING'].includes(s)) return 'status status-pending';
  if (['APPROVED', 'LOADED', 'DISPATCHED', 'CLEARED', 'DELIVERED', 'ARRIVED'].includes(s)) return 'status status-active';
  if (['CLOSED'].includes(s)) return 'status status-closed';
  if (['CANCELLED'].includes(s)) return 'status status-rejected';
  return 'status';
};

export default function ShipmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
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

  if (loading && !s) return <div className="app-content"><div className="state-screen">Loading shipment…</div></div>;
  if (error && !s) return (
    <div className="app-content"><div className="card"><div className="card__body">
      <p className="field-error" role="alert">{error}</p>
      <button className="btn mt-2" onClick={load}>Try again</button>
    </div></div></div>
  );
  if (!s) return null;

  const transitions = {
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
  }[s.status] || [];

  const act = async (fn, msg) => {
    try { await fn(); notify(msg, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <div className="breadcrumb">
            <button className="breadcrumb__back" onClick={() => navigate(-1)}><i className="bi bi-arrow-left" /></button>
            <span className="breadcrumb__item"><a href="/logistics/shipments">Shipments</a></span>
            <span className="breadcrumb__item is-current"><span>{s.reference}</span></span>
          </div>
          <h1 className="page-header__title">
            {s.reference} <span className={statusCls(s.status)}>{s.status.replace(/_/g, ' ')}</span>
          </h1>
          <p className="page-header__subtitle">
            {s.customer_label || s.supplier_label || '—'} · {s.product_label || s.product} · {Number(s.quantity || 0).toLocaleString()} L
          </p>
        </div>
        <div className="page-header__actions">
          {s.status === 'DRAFT' && can('shipments.edit') && (
            <button className="btn btn-primary" onClick={() => act(() => api.shipments.submit(s.id), 'Submitted.')}>Submit</button>
          )}
          {s.status === 'APPROVED' && can('shipments.edit') && (
            <button className="btn" onClick={() => act(() => api.shipments.updateStatus(s.id, { new_status: 'AWAITING_LOADING' }), 'Moved to awaiting loading.')}>
              Awaiting loading
            </button>
          )}
          {transitions.length > 0 && can('shipments.edit') && (
            <TransitionMenu shipment={s} transitions={transitions.filter((t) => t !== 'CANCELLED')}
                            onDone={() => { notify('Status updated.', 'success'); load(); }} />
          )}
          {s.status !== 'CLOSED' && s.status !== 'CANCELLED' && can('shipments.edit') && transitions.includes('CANCELLED') && (
            <button className="btn btn-danger-outline" onClick={() => act(() => api.shipments.updateStatus(s.id, { new_status: 'CANCELLED' }), 'Cancelled.')}>
              Cancel
            </button>
          )}
        </div>
      </header>

      <div className="tabs">
        {['overview', 'loading', 'deliveries', 'costing', 'expenses', 'timeline'].map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview s={s} lines={lines} fuel={fuel} />}
      {tab === 'loading' && (
        <LoadingTab shipment={s} lines={lines} onChanged={load} canEdit={can('shipments.edit')} />
      )}
      {tab === 'deliveries' && (
        <DeliveriesTab shipment={s} onChanged={load} canEdit={can('shipments.edit')} />
      )}
      {tab === 'costing' && (
        <CostingTab shipment={s} sheets={sheets} onChanged={load} canFinalize={can('costing.finalize')} />
      )}
      {tab === 'expenses' && <ExpensesTab shipment={s} expenses={expenses} canAllocate={can('costing.edit')} onChanged={load} />}
      {tab === 'timeline' && <TimelineTab rows={timeline} />}
    </div>
  );
}

/* ---------------------------------------------------------------- tabs */

function Overview({ s, lines, fuel }) {
  return (
    <div className="split">
      <div className="card">
        <div className="card__header"><h2 className="card__title">Header</h2></div>
        <div className="card__body">
          <div className="kv">
            <div className="kv__item"><div className="kv__label">Customer / supplier</div><div className="kv__value">{s.customer_label || s.supplier_label || '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Product</div><div className="kv__value">{s.product_label || s.product}</div></div>
            <div className="kv__item"><div className="kv__label">Quantity</div><div className="kv__value">{Number(s.quantity || 0).toLocaleString()} L</div></div>
            <div className="kv__item"><div className="kv__label">Loaded quantity</div><div className="kv__value">{Number(s.loading_quantity || 0).toLocaleString()} L</div></div>
            <div className="kv__item"><div className="kv__label">Origin → Destination</div><div className="kv__value">{s.origin || '—'} → {s.destination || '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Expected delivery</div><div className="kv__value">{s.expected_delivery || '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Vehicle / Driver</div><div className="kv__value">{s.vehicle_label || s.hired_truck_label || '—'} · {s.driver_label || '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Transporter</div><div className="kv__value">{s.transporter_label || '—'}</div></div>
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card__header"><h2 className="card__title">Lines</h2></div>
          <div className="card__body card__body--flush">
            <table className="table table--compact">
              <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Loaded</th><th className="num">Unit cost</th><th className="num">Cost</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.product_label || l.product}</td>
                    <td className="num">{Number(l.quantity || 0).toLocaleString()}</td>
                    <td className="num">{Number(l.loaded_quantity || 0).toLocaleString()}</td>
                    <td className="num">{Number(l.unit_cost || 0).toFixed(6)}</td>
                    <td className="num">{fmtMoney(l.cost_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {fuel && fuel.expected_litres != null && (
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">Fuel variance</h2>
              {fuel.flag && <span className="badge badge--warning">Flag</span>}
            </div>
            <div className="card__body">
              <div className="kv">
                <div className="kv__item"><div className="kv__label">Expected</div><div className="kv__value">{Number(fuel.expected_litres).toFixed(3)} L</div></div>
                <div className="kv__item"><div className="kv__label">Actual</div><div className="kv__value">{Number(fuel.actual_litres).toFixed(3)} L</div></div>
                <div className="kv__item"><div className="kv__label">Variance</div><div className="kv__value">{Number(fuel.variance_litres).toFixed(3)} L</div></div>
                <div className="kv__item"><div className="kv__label">Variance %</div><div className="kv__value">{Number(fuel.variance_pct).toFixed(3)} %</div></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingTab({ shipment, lines, onChanged, canEdit }) {
  const [tanks, setTanks] = useState([]);
  const [rows, setRows] = useState(() => lines.map((l) => ({
    id: l.id, loaded_quantity: l.loaded_quantity || '', tank: l.tank || '', compartment: l.compartment || '',
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canRecord = canEdit && shipment.status === 'LOADING';

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
      <div className="card"><div className="card__body">
        <div className="table-empty">
          <div className="table-empty__title">Loading is only editable while status is LOADING</div>
          <div>Move the shipment to AWAITING_LOADING → LOADING first.</div>
        </div>
      </div></div>
    );
  }

  return (
    <div className="card">
      <div className="card__header"><h2 className="card__title">Record loading</h2></div>
      <div className="card__body">
        <form onSubmit={save}>
          <div className="line-items">
            <table>
              <thead><tr><th>Line</th><th>Product</th><th className="num">Ordered</th><th className="num">Loaded</th><th>Tank</th><th>Compartment</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const l = lines.find((x) => x.id === r.id);
                  return (
                    <tr key={r.id}>
                      <td>#{r.id}</td>
                      <td>{l?.product_label || '—'}</td>
                      <td className="num">{Number(l?.quantity || 0).toLocaleString()}</td>
                      <td><input type="number" step="0.001" className="input num" value={r.loaded_quantity} onChange={(e) => setRow(i, 'loaded_quantity', e.target.value)} /></td>
                      <td>
                        <select className="select" value={r.tank} onChange={(e) => setRow(i, 'tank', e.target.value)}>
                          <option value="">—</option>
                          {tanks.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
                        </select>
                      </td>
                      <td><input className="input" value={r.compartment} onChange={(e) => setRow(i, 'compartment', e.target.value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error && <p className="field-error mt-3" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save loading'}</button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="stack">
      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Deliveries</h2>
          {canEdit && shipment.status === 'ARRIVED' && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>+ Record delivery</button>
          )}
        </div>
        <div className="card__body card__body--flush">
          {error ? (
            <div className="card__body"><p className="field-error" role="alert">{error}</p></div>
          ) : loading ? (
            <div className="card__body"><p className="text-muted">Loading…</p></div>
          ) : !rows.length ? (
            <div className="table-empty"><div className="table-empty__title">No deliveries</div></div>
          ) : (
            <table className="table table--compact">
              <thead><tr>
                <th>Reference</th><th>Date</th><th className="num">Delivered</th><th className="num">Shortage</th>
                <th className="num">Shortage %</th><th className="num">COGS</th><th className="num">Loss</th>
                <th>Final</th><th>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.reference}</td>
                    <td>{d.delivery_date}</td>
                    <td className="num">{Number(d.delivered_quantity).toLocaleString()}</td>
                    <td className="num">{Number(d.shortage_litres || 0).toLocaleString()}</td>
                    <td className="num">{Number(d.shortage_pct || 0).toFixed(3)}%</td>
                    <td className="num">{fmtMoney(d.cogs_value)}</td>
                    <td className="num">{fmtMoney(d.loss_value)}</td>
                    <td>{d.is_final ? <span className="badge badge--success">Final</span> : '—'}</td>
                    <td><span className={`status ${d.status === 'APPROVED' ? 'status-active' : d.status === 'REJECTED' ? 'status-rejected' : 'status-pending'}`}>{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showNew && (
        <NewDeliveryModal shipment={shipment}
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); load(); onChanged(); }} />
      )}
    </div>
  );
}

function NewDeliveryModal({ shipment, onClose, onDone }) {
  const [form, setForm] = useState({
    delivered_quantity: '', delivery_date: todayISO(), is_final: false,
    received_by: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.shipments.recordDelivery(shipment.id, form); onDone(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">Record delivery</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <div className="form-grid">
                <div className="field">
                  <label className="label label--required">Delivered quantity (L)</label>
                  <input type="number" step="0.001" className="input num" value={form.delivered_quantity} onChange={set('delivered_quantity')} required />
                </div>
                <div className="field">
                  <label className="label label--required">Date</label>
                  <input type="date" className="input" value={form.delivery_date} onChange={set('delivery_date')} required />
                </div>
              </div>
              <div className="field">
                <label className="check">
                  <input type="checkbox" checked={!!form.is_final} onChange={set('is_final')} />
                  This is the final delivery (shortage over tolerance needs approval)
                </label>
              </div>
              <div className="field">
                <label className="label">Received by</label>
                <input className="input" value={form.received_by} onChange={set('received_by')} />
              </div>
              <div className="field">
                <label className="label">Notes</label>
                <textarea className="textarea" rows={2} value={form.notes} onChange={set('notes')} />
              </div>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Record'}</button>
          </div>
        </form>
      </div>
    </div>
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

  return (
    <div className="stack">
      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Cost sheet</h2>
          {latest && (
            <div className="btn-toolbar">
              <button className="btn btn-sm" onClick={exportSheet}>Export</button>
              {canFinalize && !latest.is_final && (
                <button className="btn btn-sm btn-primary" onClick={() => compute({ finalize: true })} disabled={busy}>Finalise</button>
              )}
              {canFinalize && latest.is_final && (
                <button className="btn btn-sm" onClick={() => compute({ reopen: true })} disabled={busy}>Reopen</button>
              )}
              <button className="btn btn-sm" onClick={() => compute({})} disabled={busy}>
                {busy ? 'Computing…' : 'Recompute'}
              </button>
            </div>
          )}
          {!latest && (
            <button className="btn btn-primary btn-sm" onClick={() => compute({})} disabled={busy}>
              {busy ? 'Computing…' : 'Compute first version'}
            </button>
          )}
        </div>
        {!sheets.length ? (
          <div className="card__body">
            <div className="table-empty"><div className="table-empty__title">No cost sheet yet</div>
              <div>Compute a provisional version after expenses are posted.</div></div>
          </div>
        ) : (
          <div className="card__body">
            {latest && (
              <>
                <div className="kv">
                  <div className="kv__item"><div className="kv__label">Version</div><div className="kv__value">v{latest.version}{latest.is_final && ' · final'}</div></div>
                  <div className="kv__item"><div className="kv__label">Purchase cost</div><div className="kv__value">{fmtMoney(latest.purchase_cost)}</div></div>
                  <div className="kv__item"><div className="kv__label">Direct expenses</div><div className="kv__value">{fmtMoney(latest.total_direct_expenses)}</div></div>
                  <div className="kv__item"><div className="kv__label">Total cost</div><div className="kv__value">{fmtMoney(latest.total_shipment_cost)}</div></div>
                  <div className="kv__item"><div className="kv__label">Loaded</div><div className="kv__value">{Number(latest.loaded_litres || 0).toLocaleString()} L</div></div>
                  <div className="kv__item"><div className="kv__label">Delivered</div><div className="kv__value">{Number(latest.delivered_litres || 0).toLocaleString()} L</div></div>
                  <div className="kv__item"><div className="kv__label">Delivered cost / L</div><div className="kv__value">{Number(latest.delivered_cost_per_litre || 0).toFixed(6)}</div></div>
                  <div className="kv__item"><div className="kv__label">Revenue</div><div className="kv__value">{fmtMoney(latest.revenue)}</div></div>
                  <div className="kv__item"><div className="kv__label">COGS</div><div className="kv__value">{fmtMoney(latest.cogs)}</div></div>
                  <div className="kv__item"><div className="kv__label">Gross profit</div><div className="kv__value">{fmtMoney(latest.gross_profit)}</div></div>
                  <div className="kv__item"><div className="kv__label">Contribution</div><div className="kv__value">{fmtMoney(latest.contribution)}</div></div>
                  <div className="kv__item"><div className="kv__label">Margin %</div><div className="kv__value">{Number(latest.margin_pct || 0).toFixed(2)}%</div></div>
                </div>
                <hr className="divider" />
                <h3 className="h5 mb-2">Components</h3>
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead><tr><th>Component</th><th className="num">Amount</th></tr></thead>
                    <tbody>
                      {Object.entries(latest.components || {}).map(([k, v]) => (
                        <tr key={k}><td>{k}</td><td className="num">{fmtMoney(v)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
        {error && <div className="card__body"><p className="field-error">{error}</p></div>}
      </div>

      {sheets.length > 1 && (
        <div className="card">
          <div className="card__header"><h2 className="card__title">Version history</h2></div>
          <div className="card__body card__body--flush">
            <table className="table table--compact">
              <thead><tr>
                <th>Version</th><th>Final</th><th>Total cost</th><th>Delivered L</th><th className="num">Cost / L</th><th className="num">Contribution</th><th>Created</th>
              </tr></thead>
              <tbody>
                {sheets.map((sh) => (
                  <tr key={sh.id}>
                    <td>v{sh.version}</td>
                    <td>{sh.is_final ? <span className="badge badge--success">Final</span> : '—'}</td>
                    <td>{fmtMoney(sh.total_shipment_cost)}</td>
                    <td>{Number(sh.delivered_litres || 0).toLocaleString()}</td>
                    <td className="num">{Number(sh.delivered_cost_per_litre || 0).toFixed(6)}</td>
                    <td className="num">{fmtMoney(sh.contribution)}</td>
                    <td className="text-sm text-muted">{sh.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ExpensesTab({ shipment, expenses, canAllocate, onChanged }) {
  return (
    <div className="card">
      <div className="card__header"><h2 className="card__title">Expenses on this shipment</h2></div>
      <div className="card__body card__body--flush">
        {!expenses.length ? (
          <div className="table-empty"><div className="table-empty__title">No expenses</div>
            <div>Allocate expenses from the Expenses page.</div></div>
        ) : (
          <table className="table table--compact">
            <thead><tr>
              <th>Reference</th><th>Date</th><th>Category</th><th>Description</th>
              <th className="num">Total</th><th className="num">Outstanding</th><th>Status</th>
            </tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.reference}</td>
                  <td>{e.expense_date}</td>
                  <td>{e.category_label || e.category}</td>
                  <td className="text-truncate" style={{ maxWidth: 260 }}>{e.description}</td>
                  <td className="num">{fmtMoney(e.total, e.currency)}</td>
                  <td className="num">{fmtMoney(e.outstanding)}</td>
                  <td><span className={`status ${e.status === 'POSTED' || e.status === 'PAID' ? 'status-posted' : e.status === 'APPROVED' ? 'status-active' : 'status-draft'}`}>{e.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TimelineTab({ rows }) {
  return (
    <div className="card">
      <div className="card__header"><h2 className="card__title">Status history</h2></div>
      <div className="card__body">
        {!rows.length ? (
          <div className="table-empty"><div className="table-empty__title">No status updates yet</div></div>
        ) : (
          <ul className="stack-sm">
            {rows.map((h) => (
              <li key={h.id} className="d-flex items-start gap-3">
                <span className={statusCls(h.to)}>{h.to.replace(/_/g, ' ')}</span>
                <div className="flex-1">
                  <div className="text-sm">{h.location || '—'}</div>
                  <div className="text-xs text-muted">{h.by || ''} · {h.at}</div>
                  {h.comments && <div className="text-xs">{h.comments}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- transition menu */

function TransitionMenu({ shipment, transitions, onDone }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(transitions[0] || '');
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 16));
  const [location, setLocation] = useState('');
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await api.shipments.updateStatus(shipment.id, { new_status: status, when, location, comments });
      setOpen(false); onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="dropdown">
      <button className="btn btn-primary" onClick={() => setOpen((o) => !o)}>Update status</button>
      {open && (
        <div className="dropdown__menu dropdown__menu--wide">
          <div className="dropdown__header">Next status</div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {transitions.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <div className="field mt-2">
            <label className="label">When</label>
            <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="field mt-2">
            <label className="label">Location</label>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="field mt-2">
            <label className="label">Comments</label>
            <textarea className="textarea" rows={2} value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          {error && <p className="field-error mt-2">{error}</p>}
          <div className="modal__footer" style={{ padding: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : 'Update'}</button>
          </div>
        </div>
      )}
    </div>
  );
}