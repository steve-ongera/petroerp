/**
 * Owned fleet — vehicles.
 * - CRUD /vehicles/
 * - POST /vehicles/:id/log-expense/  (Expense + VehicleExpense in one shot)
 * - GET  /vehicles/:id/metrics/?date_from=&date_to=
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'INACTIVE'];
const OWNERSHIP = ['OWNED', 'LEASED'];
const EXPENSE_TYPES = ['FUEL', 'ALLOWANCE', 'ROAD', 'PARKING', 'REPAIR', 'TYRES', 'OTHER'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const statusPill = (s) => {
  if (s === 'AVAILABLE') return 'status-pill--success';
  if (s === 'ON_TRIP') return 'status-pill--info';
  if (s === 'MAINTENANCE') return 'status-pill--warning';
  return 'status-pill--neutral';
};

export default function Vehicles() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [logging, setLogging] = useState(null);
  const [metrics, setMetrics] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.vehicles.list({
        ...companyParams(),
        ordering: 'registration_number',
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, status]);

  useEffect(() => { load(); }, [load]);

  const showMetrics = async (v) => {
    try { setMetrics({ vehicle: v, data: await api.vehicles.metrics(v.id) }); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      {/* ---------- Page header: icon tile + title + actions ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-truck"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Vehicles</h1>
            <p className="page-subtitle">
              Owned and leased fleet{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('fleet.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New vehicle
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

      {/* ---------- One white card: search, filters, table, pagination ---------- */}
      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by registration, make or model..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search vehicles"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          {hasActiveFilters && (
            <button className="btn btn-secondary" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="chip-row">
            {search && (
              <span className="filter-chip">
                Search: "{search}"
                <button onClick={() => setSearch('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {status && (
              <span className="filter-chip">
                Status: {status.replace('_', ' ')}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Vehicle List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} vehicle{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-truck"></i>
            <h6>{hasActiveFilters ? 'No vehicles match your search' : 'No vehicles yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New vehicle' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Registration</th>
                    <th>Make / Model</th>
                    <th>Type</th>
                    <th className="text-right">Capacity (L)</th>
                    <th>Ownership</th>
                    <th>Insurance</th>
                    <th>Inspection</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((v) => (
                    <tr key={v.id}>
                      <td className="cell-mono text-brand fw-600">{v.registration_number}</td>
                      <td className="cell-name">{v.make} {v.model}</td>
                      <td>{v.truck_type || '—'}</td>
                      <td className="cell-num">{Number(v.tank_capacity || 0).toLocaleString()}</td>
                      <td><span className="badge badge-neutral">{v.ownership}</span></td>
                      <td>{v.insurance_expiry || '—'}</td>
                      <td>{v.inspection_expiry || '—'}</td>
                      <td>
                        <span className={`status-pill ${statusPill(v.status)}`}>{v.status.replace('_', ' ')}</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-icon" title="Metrics" aria-label="Metrics" onClick={() => showMetrics(v)}>
                            <i className="bi bi-bar-chart"></i>
                          </button>
                          {can('fleet.edit') && (
                            <>
                              <button className="btn btn-icon" title="Log expense" aria-label="Log expense" onClick={() => setLogging(v)}>
                                <i className="bi bi-receipt"></i>
                              </button>
                              <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(v)}>
                                <i className="bi bi-pencil"></i>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && (
        <VehicleModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
      {logging && (
        <LogExpenseModal
          vehicle={logging}
          companyParams={companyParams}
          onClose={() => setLogging(null)}
          onDone={() => { setLogging(null); notify('Expense logged.', 'success'); load(); }}
        />
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
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      try { body.compartments = JSON.parse(form.compartments || '[]'); } catch { delete body.compartments; }
      ['purchase_value', 'purchase_date', 'insurance_expiry', 'inspection_expiry', 'fuel_norm_km_per_litre']
        .forEach((k) => { if (!body[k]) body[k] = null; });
      isNew ? await api.vehicles.create(body) : await api.vehicles.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New vehicle' : `Edit ${row.registration_number}`}
      subtitle="Owned and leased fleet"
      icon="bi-truck"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="vehicleForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="vehicleForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Vehicle Details</h6>
        <div className="form-grid">
          <Field label="Registration" required err={fieldErr.registration_number}>
            <input className="form-control font-mono" value={form.registration_number} onChange={set('registration_number')} required />
          </Field>
          <Field label="Make"><input className="form-control" value={form.make} onChange={set('make')} /></Field>
          <Field label="Model"><input className="form-control" value={form.model} onChange={set('model')} /></Field>
          <Field label="Truck type"><input className="form-control" value={form.truck_type} onChange={set('truck_type')} /></Field>
          <Field label="Capacity (L)">
            <input type="number" step="0.001" className="form-control num" value={form.tank_capacity} onChange={set('tank_capacity')} />
          </Field>
          <Field label="Compartments (JSON array)">
            <input className="form-control font-mono" value={form.compartments} onChange={set('compartments')} />
          </Field>
          <Field label="Ownership">
            <select className="form-select" value={form.ownership} onChange={set('ownership')}>
              {OWNERSHIP.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="form-select" value={form.status} onChange={set('status')}>
              {STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-shield-check" aria-hidden="true"></i>Purchase, Compliance & Usage</h6>
        <div className="form-grid">
          <Field label="Purchase value">
            <input type="number" step="0.01" className="form-control num" value={form.purchase_value} onChange={set('purchase_value')} />
          </Field>
          <Field label="Purchase date">
            <input type="date" className="form-control" value={form.purchase_date} onChange={set('purchase_date')} />
          </Field>
          <Field label="Insurance expiry">
            <input type="date" className="form-control" value={form.insurance_expiry} onChange={set('insurance_expiry')} />
          </Field>
          <Field label="Inspection expiry">
            <input type="date" className="form-control" value={form.inspection_expiry} onChange={set('inspection_expiry')} />
          </Field>
          <Field label="Fuel norm (km/L)">
            <input type="number" step="0.01" className="form-control num" value={form.fuel_norm_km_per_litre} onChange={set('fuel_norm_km_per_litre')} />
          </Field>
          <Field label="Odometer (km)">
            <input type="number" step="0.001" className="form-control num" value={form.odometer_km} onChange={set('odometer_km')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
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
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.expenseCategories.listAll(),
      api.bankAccounts.listAll({ ...companyParams() }),
    ]).then(([c, b]) => { setCategories(c); setBankAccounts(b); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      ['litres', 'bank_account'].forEach((k) => { if (!body[k]) delete body[k]; });
      await api.vehicles.logExpense(vehicle.id, body);
      onDone();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Log expense"
      subtitle={vehicle.registration_number}
      icon="bi-receipt"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="logExpenseForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="logExpenseForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Expense Details</h6>
        <div className="form-grid">
          <Field label="Category" required err={fieldErr.category}>
            <select className="form-select" value={form.category} onChange={set('category')} required>
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Type" required>
            <select className="form-select" value={form.expense_type} onChange={set('expense_type')}>
              {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Date" required>
            <input type="date" className="form-control" value={form.expense_date} onChange={set('expense_date')} required />
          </Field>
          <Field label="Amount" required err={fieldErr.amount}>
            <input type="number" step="0.01" className="form-control num" value={form.amount} onChange={set('amount')} required />
          </Field>
          <Field label="Litres">
            <input type="number" step="0.001" className="form-control num" value={form.litres} onChange={set('litres')} />
          </Field>
          <Field label="Odometer (km)">
            <input type="number" step="0.001" className="form-control num" value={form.odometer_km} onChange={set('odometer_km')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-wallet2" aria-hidden="true"></i>Payment</h6>
        <div className="form-grid">
          <Field label="Payment method">
            <select className="form-select" value={form.payment_method} onChange={set('payment_method')}>
              {['CASH', 'BANK', 'MPESA', 'CREDIT'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          {form.payment_method !== 'CREDIT' && form.payment_method !== 'CASH' && (
            <Field label="Bank account">
              <select className="form-select" value={form.bank_account} onChange={set('bank_account')}>
                <option value="">—</option>
                {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Receipt #">
            <input className="form-control" value={form.receipt_no} onChange={set('receipt_no')} />
          </Field>
          <Field label="Description" span>
            <input className="form-control" value={form.description} onChange={set('description')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function MetricsModal({ vehicle, data, onClose }) {
  const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });
  const items = data && Object.keys(data).length ? [
    ['Trips', data.trips ?? '—'],
    ['Distance (km)', Number(data.km || 0).toLocaleString()],
    ['Operating cost', money(data.operating_cost)],
    ['Cost / km', Number(data.cost_per_km || 0).toFixed(4)],
    ['Cost / trip', Number(data.cost_per_trip || 0).toFixed(2)],
    ['Cost / delivered L', Number(data.cost_per_delivered_litre || 0).toFixed(6)],
    ['Revenue', money(data.revenue)],
    ['Profit', money(data.profit)],
  ] : [];

  return (
    <Modal
      show
      onClose={onClose}
      title={`Metrics · ${vehicle.registration_number}`}
      subtitle={`${vehicle.make} ${vehicle.model}`}
      icon="bi-bar-chart"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      {!items.length ? (
        <div className="empty-state">
          <i className="bi bi-bar-chart"></i>
          <h6>No metrics available</h6>
        </div>
      ) : (
        <div className="kv">
          {items.map(([label, value]) => (
            <div className="kv__item" key={label}>
              <div className="kv__label">{label}</div>
              <div className="kv__value">{value}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}