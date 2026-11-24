/**
 * Transport bookings.
 * - CRUD /transport-bookings/ (withSubmit)
 * - POST /transport-bookings/:id/submit/
 * - GET  /transport-bookings/suggest-rate/?transporter=&origin=&destination=&date=
 * - GET  /transporters/... (for pickers), /transporter-vehicles/
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const STATUSES = ['', 'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'IN_TRANSIT', 'DELIVERED', 'INVOICED', 'SETTLED', 'CANCELLED'];
const RATE_BASIS = ['PER_LITRE', 'PER_TRIP'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Bookings() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.transportBookings.list({
        ...companyParams(), ordering: '-booking_date',
        ...(status ? { status } : {}),
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, status]);

  useEffect(() => { load(); }, [load]);

  const submit = async (b) => {
    try {
      const res = await api.transportBookings.submit(b.id);
      notify(res.approval_request ? 'Sent for approval.' : 'Auto-approved.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Transport bookings</h1>
          <p className="page-header__subtitle">
            Hired truck bookings{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('transport.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New booking
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace('_', ' ') : 'All statuses'}</option>)}
          </select>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No bookings</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>Transporter</th><th>Truck</th>
                <th className="num">Qty</th><th>Rate basis</th><th className="num">Total</th>
                <th className="num">Balance</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="is-clickable" onClick={() => setEditing(b)}>
                    <td className="mono">{b.reference}</td>
                    <td>{b.booking_date}</td>
                    <td>{b.transporter_label || b.transporter}</td>
                    <td className="mono">{b.truck_label || b.truck}</td>
                    <td className="num">{Number(b.quantity || 0).toLocaleString()}</td>
                    <td><span className="badge">{b.rate_basis}</span></td>
                    <td className="num">{fmtMoney(b.total_charge)}</td>
                    <td className="num">{fmtMoney(b.balance_payable)}</td>
                    <td><span className={`status ${b.status === 'APPROVED' ? 'status-active' : b.status === 'AWAITING_APPROVAL' ? 'status-pending' : b.status === 'SETTLED' ? 'status-closed' : 'status-draft'}`}>{b.status.replace('_', ' ')}</span></td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        {b.status === 'DRAFT' && can('transport.edit') && (
                          <button className="btn btn-xs" onClick={() => submit(b)}>Submit</button>
                        )}
                        {['DRAFT'].includes(b.status) && can('transport.edit') && (
                          <button className="row-action" title="Edit" onClick={() => setEditing(b)}><i className="bi bi-pencil" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <BookingModal row={editing} companyParams={companyParams}
                      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function BookingModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [transporters, setTransporters] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [products, setProducts] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [form, setForm] = useState({
    shipment: row.shipment || '', transporter: row.transporter || '', truck: row.truck || '',
    driver_name: row.driver_name || '', product: row.product || '', quantity: row.quantity ?? '',
    booking_date: row.booking_date || todayISO(), origin: row.origin || '', destination: row.destination || '',
    rate_basis: row.rate_basis || 'PER_LITRE', contracted_rate: row.contracted_rate ?? '',
    expected_delivery: row.expected_delivery || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.transporters.listAll({ ...companyParams() }),
      api.transporterVehicles.listAll({ ...companyParams(), kind: 'TRUCK' }),
      api.products.listAll(),
      api.shipments.listAll({ ...companyParams() }).catch(() => []),
    ]).then(([t, tr, p, s]) => { setTransporters(t); setTrucks(tr); setProducts(p); setShipments(s); }).catch(() => {});
  }, [companyParams]);

  const suggestRate = async () => {
    if (!form.transporter || !form.origin || !form.destination) return;
    try {
      const r = await api.transportBookings.suggestRate({
        transporter: form.transporter, origin: form.origin,
        destination: form.destination, date: form.booking_date,
      });
      if (r.rate_per_litre) setForm((f) => ({ ...f, rate_basis: 'PER_LITRE', contracted_rate: r.rate_per_litre }));
      else if (r.rate_per_trip) setForm((f) => ({ ...f, rate_basis: 'PER_TRIP', contracted_rate: r.rate_per_trip }));
      else alert('No rate found for this route.');
    } catch (err) { alert(errorMessage(err)); }
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      ['shipment', 'expected_delivery'].forEach((k) => { if (!body[k]) delete body[k]; });
      isNew ? await api.transportBookings.create(body) : await api.transportBookings.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New booking' : `Edit ${row.reference}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Transporter" required err={fieldErr.transporter}>
                <select className="select" value={form.transporter} onChange={set('transporter')} required>
                  <option value="">—</option>
                  {transporters.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </Field>
              <Field label="Truck" required>
                <select className="select" value={form.truck} onChange={set('truck')} required>
                  <option value="">—</option>
                  {trucks.filter((t) => !form.transporter || String(t.transporter) === String(form.transporter))
                    .map((t) => <option key={t.id} value={t.id}>{t.registration_number}</option>)}
                </select>
              </Field>
              <Field label="Product" required>
                <select className="select" value={form.product} onChange={set('product')} required>
                  <option value="">—</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </Field>
              <Field label="Quantity (L)" required>
                <input type="number" step="0.001" className="input num" value={form.quantity} onChange={set('quantity')} required />
              </Field>
              <Field label="Booking date" required>
                <input type="date" className="input" value={form.booking_date} onChange={set('booking_date')} required />
              </Field>
              <Field label="Origin"><input className="input" value={form.origin} onChange={set('origin')} /></Field>
              <Field label="Destination"><input className="input" value={form.destination} onChange={set('destination')} /></Field>
              <Field label="Driver name"><input className="input" value={form.driver_name} onChange={set('driver_name')} /></Field>
              <Field label="Rate basis">
                <select className="select" value={form.rate_basis} onChange={set('rate_basis')}>
                  {RATE_BASIS.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                </select>
              </Field>
              <Field label="Contracted rate" required>
                <div className="input-group">
                  <input type="number" step="0.000001" className="input num" value={form.contracted_rate} onChange={set('contracted_rate')} required />
                  <button type="button" className="btn" onClick={suggestRate}>Suggest</button>
                </div>
              </Field>
              <Field label="Shipment (link)">
                <select className="select" value={form.shipment} onChange={set('shipment')}>
                  <option value="">—</option>
                  {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference}</option>)}
                </select>
              </Field>
              <Field label="Expected delivery">
                <input type="date" className="input" value={form.expected_delivery} onChange={set('expected_delivery')} />
              </Field>
            </div>
            <p className="field-hint mt-3">
              Total charge is calculated server-side: {form.rate_basis === 'PER_LITRE' ? 'qty × rate' : 'flat rate'}.
            </p>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, err, span, children }) {
  return (
    <div className={`field ${span ? 'span-all' : ''} ${err ? 'has-error' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}