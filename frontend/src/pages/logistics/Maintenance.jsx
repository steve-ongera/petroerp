/**
 * Vehicle maintenance.
 * - CRUD /vehicle-maintenance/
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const TYPES = ['SERVICE', 'REPAIR', 'TYRES', 'INSPECTION', 'INSURANCE', 'OTHER'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Maintenance() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [m, v] = await Promise.all([
        api.vehicleMaintenance.listAll({ ...companyParams(), ordering: '-maintenance_date' }),
        api.vehicles.listAll({ ...companyParams() }),
      ]);
      setRows(m); setVehicles(v);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const remove = async (m) => {
    if (!window.confirm('Delete this maintenance record?')) return;
    try { await api.vehicleMaintenance.remove(m.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Maintenance</h1>
          <p className="page-header__subtitle">
            Service, repairs and inspections{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('fleet.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New record
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No maintenance records</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Date</th><th>Vehicle</th><th>Type</th><th>Description</th>
                <th className="num">Cost</th><th className="num">Odometer</th>
                <th>Next due</th><th>Vendor</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>{m.maintenance_date}</td>
                    <td className="mono">{m.vehicle_label || m.vehicle}</td>
                    <td><span className="badge">{m.maintenance_type}</span></td>
                    <td className="text-truncate" style={{ maxWidth: 260 }}>{m.description || '—'}</td>
                    <td className="num">{fmtMoney(m.cost)}</td>
                    <td className="num">{Number(m.odometer_km || 0).toLocaleString()}</td>
                    <td className="text-sm">{m.next_due_date || '—'}</td>
                    <td>{m.vendor || '—'}</td>
                    <td className="col-actions">
                      {can('fleet.edit') && (
                        <div className="row-actions">
                          <button className="row-action" title="Edit" onClick={() => setEditing(m)}><i className="bi bi-pencil" /></button>
                          <button className="row-action row-action--danger" title="Delete" onClick={() => remove(m)}><i className="bi bi-trash" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <MaintenanceModal row={editing} vehicles={vehicles} companyParams={companyParams}
                          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function MaintenanceModal({ row, vehicles, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    vehicle: row.vehicle || '', maintenance_type: row.maintenance_type || 'SERVICE',
    maintenance_date: row.maintenance_date || todayISO(),
    description: row.description || '', cost: row.cost ?? '',
    odometer_km: row.odometer_km ?? '', next_due_date: row.next_due_date || '',
    vendor: row.vendor || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.next_due_date) body.next_due_date = null;
      isNew ? await api.vehicleMaintenance.create(body) : await api.vehicleMaintenance.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New maintenance record' : 'Edit record'}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Vehicle" required>
                <select className="select" value={form.vehicle} onChange={set('vehicle')} required>
                  <option value="">—</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_number}</option>)}
                </select>
              </Field>
              <Field label="Type">
                <select className="select" value={form.maintenance_type} onChange={set('maintenance_type')}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Date" required>
                <input type="date" className="input" value={form.maintenance_date} onChange={set('maintenance_date')} required />
              </Field>
              <Field label="Cost"><input type="number" step="0.01" className="input num" value={form.cost} onChange={set('cost')} /></Field>
              <Field label="Odometer (km)"><input type="number" step="0.001" className="input num" value={form.odometer_km} onChange={set('odometer_km')} /></Field>
              <Field label="Next due"><input type="date" className="input" value={form.next_due_date} onChange={set('next_due_date')} /></Field>
              <Field label="Vendor" span><input className="input" value={form.vendor} onChange={set('vendor')} /></Field>
              <Field label="Description" span><textarea className="textarea" rows={2} value={form.description} onChange={set('description')} /></Field>
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

function Field({ label, required, span, children }) {
  return (
    <div className={`field ${span ? 'span-all' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
    </div>
  );
}