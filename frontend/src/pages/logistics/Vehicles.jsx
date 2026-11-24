/**
 * Owned fleet — vehicles.
 * - CRUD /vehicles/
 * - POST /vehicles/:id/log-expense/  (Expense + VehicleExpense in one shot)
 * - GET  /vehicles/:id/metrics/?date_from=&date_to=
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const STATUS = ['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'INACTIVE'];
const OWNERSHIP = ['OWNED', 'LEASED'];
const EXPENSE_TYPES = ['FUEL', 'ALLOWANCE', 'ROAD', 'PARKING', 'REPAIR', 'TYRES', 'OTHER'];
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Vehicles() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [logging, setLogging] = useState(null);
  const [metrics, setMetrics] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.vehicles.list({ ...companyParams(), ordering: 'registration_number', page_size: 500 });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const showMetrics = async (v) => {
    try { setMetrics({ vehicle: v, data: await api.vehicles.metrics(v.id) }); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Vehicles</h1>
          <p className="page-header__subtitle">
            Owned and leased fleet{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('fleet.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New vehicle
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No vehicles</div>
            <div>Add the first vehicle.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Registration</th><th>Make / Model</th><th>Type</th>
                <th className="num">Capacity</th><th>Ownership</th>
                <th>Insurance</th><th>Inspection</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td className="mono">{v.registration_number}</td>
                    <td>{v.make} {v.model}</td>
                    <td>{v.truck_type || '—'}</td>
                    <td className="num">{Number(v.tank_capacity || 0).toLocaleString()}</td>
                    <td><span className="badge">{v.ownership}</span></td>
                    <td className="text-sm">{v.insurance_expiry || '—'}</td>
                    <td className="text-sm">{v.inspection_expiry || '—'}</td>
                    <td><span className={`status ${v.status === 'AVAILABLE' ? 'status-active' : v.status === 'ON_TRIP' ? 'status-in-progress' : v.status === 'MAINTENANCE' ? 'status-pending' : 'status-inactive'}`}>{v.status.replace('_', ' ')}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Metrics" onClick={() => showMetrics(v)}><i className="bi bi-bar-chart" /></button>
                        {can('fleet.edit') && (
                          <>
                            <button className="row-action" title="Log expense" onClick={() => setLogging(v)}><i className="bi bi-receipt" /></button>
                            <button className="row-action" title="Edit" onClick={() => setEditing(v)}><i className="bi bi-pencil" /></button>
                          </>
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
        <VehicleModal row={editing} companyParams={companyParams}
                      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
      {logging && (
        <LogExpenseModal vehicle={logging} companyParams={companyParams}
                         onClose={() => setLogging(null)} onDone={() => { setLogging(null); notify('Expense logged.', 'success'); load(); }} />
      )}
      {metrics && <MetricsModal vehicle={metrics.vehicle} data={metrics.data} onClose={() => setMetrics(null)} />}
    </div>
  );
}

function VehicleModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    registration_number: row.registration_number || '', make: row.make || '', model: row.model || '',
    truck_type: row.truck_type || '', tank_capacity: row.tank_capacity ?? '',
    compartments: JSON.stringify(row.compartments || []),
    ownership: row.ownership || 'OWNED', purchase_value: row.purchase_value ?? '',
    purchase_date: row.purchase_date || '', insurance_expiry: row.insurance_expiry || '',
    inspection_expiry: row.inspection_expiry || '', fuel_norm_km_per_litre: row.fuel_norm_km_per_litre ?? '',
    odometer_km: row.odometer_km ?? '', status: row.status || 'AVAILABLE',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form, company: companyParams().company };
      try { body.compartments = JSON.parse(form.compartments || '[]'); } catch { delete body.compartments; }
      ['purchase_value', 'purchase_date', 'insurance_expiry', 'inspection_expiry', 'fuel_norm_km_per_litre']
        .forEach((k) => { if (!body[k]) body[k] = null; });
      isNew ? await api.vehicles.create(body) : await api.vehicles.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New vehicle' : `Edit ${row.registration_number}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Registration" required><input className="input mono" value={form.registration_number} onChange={set('registration_number')} required /></Field>
              <Field label="Make"><input className="input" value={form.make} onChange={set('make')} /></Field>
              <Field label="Model"><input className="input" value={form.model} onChange={set('model')} /></Field>
              <Field label="Truck type"><input className="input" value={form.truck_type} onChange={set('truck_type')} /></Field>
              <Field label="Capacity (L)"><input type="number" step="0.001" className="input num" value={form.tank_capacity} onChange={set('tank_capacity')} /></Field>
              <Field label="Compartments (JSON array)"><input className="input mono" value={form.compartments} onChange={set('compartments')} /></Field>
              <Field label="Ownership">
                <select className="select" value={form.ownership} onChange={set('ownership')}>
                  {OWNERSHIP.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="select" value={form.status} onChange={set('status')}>
                  {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Purchase value"><input type="number" step="0.01" className="input num" value={form.purchase_value} onChange={set('purchase_value')} /></Field>
              <Field label="Purchase date"><input type="date" className="input" value={form.purchase_date} onChange={set('purchase_date')} /></Field>
              <Field label="Insurance expiry"><input type="date" className="input" value={form.insurance_expiry} onChange={set('insurance_expiry')} /></Field>
              <Field label="Inspection expiry"><input type="date" className="input" value={form.inspection_expiry} onChange={set('inspection_expiry')} /></Field>
              <Field label="Fuel norm (km/L)"><input type="number" step="0.01" className="input num" value={form.fuel_norm_km_per_litre} onChange={set('fuel_norm_km_per_litre')} /></Field>
              <Field label="Odometer (km)"><input type="number" step="0.001" className="input num" value={form.odometer_km} onChange={set('odometer_km')} /></Field>
            </div>
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

function LogExpenseModal({ vehicle, companyParams, onClose, onDone }) {
  const [categories, setCategories] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [form, setForm] = useState({
    category: '', expense_type: 'FUEL', expense_date: todayISO(),
    amount: '', litres: '', odometer_km: '', payment_method: 'CASH',
    bank_account: '', receipt_no: '', description: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.expenseCategories.listAll(),
      api.bankAccounts.listAll({ ...companyParams() }),
    ]).then(([c, b]) => { setCategories(c); setBankAccounts(b); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form };
      ['litres', 'bank_account'].forEach((k) => { if (!body[k]) delete body[k]; });
      await api.vehicles.logExpense(vehicle.id, body);
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Log expense</h2>
            <p className="modal__subtitle">{vehicle.registration_number}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Category" required>
                <select className="select" value={form.category} onChange={set('category')} required>
                  <option value="">—</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Type" required>
                <select className="select" value={form.expense_type} onChange={set('expense_type')}>
                  {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Date" required><input type="date" className="input" value={form.expense_date} onChange={set('expense_date')} required /></Field>
              <Field label="Amount" required><input type="number" step="0.01" className="input num" value={form.amount} onChange={set('amount')} required /></Field>
              <Field label="Litres"><input type="number" step="0.001" className="input num" value={form.litres} onChange={set('litres')} /></Field>
              <Field label="Odometer (km)"><input type="number" step="0.001" className="input num" value={form.odometer_km} onChange={set('odometer_km')} /></Field>
              <Field label="Payment method">
                <select className="select" value={form.payment_method} onChange={set('payment_method')}>
                  {['CASH', 'BANK', 'MPESA', 'CREDIT'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              {form.payment_method !== 'CREDIT' && form.payment_method !== 'CASH' && (
                <Field label="Bank account">
                  <select className="select" value={form.bank_account} onChange={set('bank_account')}>
                    <option value="">—</option>
                    {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Receipt #"><input className="input" value={form.receipt_no} onChange={set('receipt_no')} /></Field>
              <Field label="Description" span><input className="input" value={form.description} onChange={set('description')} /></Field>
            </div>
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

function MetricsModal({ vehicle, data, onClose }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Metrics · {vehicle.registration_number}</h2>
            <p className="modal__subtitle">{vehicle.make} {vehicle.model}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          {!data || !Object.keys(data).length ? <p className="text-muted">No metrics available.</p> : (
            <div className="kv">
              <div className="kv__item"><div className="kv__label">Trips</div><div className="kv__value">{data.trips ?? '—'}</div></div>
              <div className="kv__item"><div className="kv__label">Distance (km)</div><div className="kv__value">{Number(data.km || 0).toLocaleString()}</div></div>
              <div className="kv__item"><div className="kv__label">Operating cost</div><div className="kv__value">{Number(data.operating_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
              <div className="kv__item"><div className="kv__label">Cost / km</div><div className="kv__value">{Number(data.cost_per_km || 0).toFixed(4)}</div></div>
              <div className="kv__item"><div className="kv__label">Cost / trip</div><div className="kv__value">{Number(data.cost_per_trip || 0).toFixed(2)}</div></div>
              <div className="kv__item"><div className="kv__label">Cost / delivered L</div><div className="kv__value">{Number(data.cost_per_delivered_litre || 0).toFixed(6)}</div></div>
              <div className="kv__item"><div className="kv__label">Revenue</div><div className="kv__value">{Number(data.revenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
              <div className="kv__item"><div className="kv__label">Profit</div><div className="kv__value">{Number(data.profit || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
            </div>
          )}
        </div>
        <div className="modal__footer"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function Field({ label, required, span, children }) {
  return (
    <div className={`field ${span ? 'span-all' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
    </div>
  );
}