/**
 * Vehicle maintenance.
 * - CRUD /vehicle-maintenance/
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

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
  const [allRows, setAllRows] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [m, v] = await Promise.all([
        api.vehicleMaintenance.listAll({ ...companyParams(), ordering: '-maintenance_date' }),
        api.vehicles.listAll({ ...companyParams() }),
      ]);
      setAllRows(m); setVehicles(v);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const remove = async (m) => {
    if (!window.confirm('Delete this maintenance record?')) return;
    try { await api.vehicleMaintenance.remove(m.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  // listAll returns everything, so search/type filtering is done client-side.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((m) => {
      if (type && m.maintenance_type !== type) return false;
      if (!q) return true;
      return [m.vehicle_label, m.vehicle, m.description, m.vendor]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [allRows, search, type]);

  const hasActiveFilters = !!(search || type);
  const clearFilters = () => { setSearch(''); setType(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-tools"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Maintenance</h1>
            <p className="page-subtitle">
              Service, repairs and inspections{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('fleet.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New record
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

      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by vehicle, description or vendor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search maintenance records"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
            {type && (
              <span className="filter-chip">
                Type: {type}
                <button onClick={() => setType('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Maintenance Records
          </span>
          <span className="chart-card__subtitle">
            {rows.length} record{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-tools"></i>
            <h6>{hasActiveFilters ? 'No records match your search' : 'No maintenance records yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New record' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Vehicle</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Odometer</th>
                    <th>Next due</th>
                    <th>Vendor</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((m) => (
                    <tr key={m.id}>
                      <td>{m.maintenance_date}</td>
                      <td className="cell-mono text-brand fw-600">{m.vehicle_label || m.vehicle}</td>
                      <td><span className="badge badge-neutral">{m.maintenance_type}</span></td>
                      <td className="text-truncate" style={{ maxWidth: 260 }}>{m.description || '—'}</td>
                      <td className="cell-num">{fmtMoney(m.cost)}</td>
                      <td className="cell-num">{Number(m.odometer_km || 0).toLocaleString()}</td>
                      <td>{m.next_due_date || '—'}</td>
                      <td>{m.vendor || '—'}</td>
                      <td>
                        {can('fleet.edit') && (
                          <div className="row-actions">
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(m)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(m)}>
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                        )}
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
        <MaintenanceModal
          row={editing}
          vehicles={vehicles}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
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
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.next_due_date) body.next_due_date = null;
      isNew ? await api.vehicleMaintenance.create(body) : await api.vehicleMaintenance.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New maintenance record' : 'Edit record'}
      subtitle="Service, repairs and inspections"
      icon="bi-tools"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="maintenanceForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="maintenanceForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Record Details</h6>
        <div className="form-grid">
          <Field label="Vehicle" required err={fieldErr.vehicle}>
            <select className="form-select" value={form.vehicle} onChange={set('vehicle')} required>
              <option value="">—</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_number}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className="form-select" value={form.maintenance_type} onChange={set('maintenance_type')}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Date" required err={fieldErr.maintenance_date}>
            <input type="date" className="form-control" value={form.maintenance_date} onChange={set('maintenance_date')} required />
          </Field>
          <Field label="Vendor">
            <input className="form-control" value={form.vendor} onChange={set('vendor')} />
          </Field>
          <Field label="Description" span>
            <textarea className="form-control" rows={2} value={form.description} onChange={set('description')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-speedometer2" aria-hidden="true"></i>Cost & Scheduling</h6>
        <div className="form-grid">
          <Field label="Cost">
            <input type="number" step="0.01" className="form-control num" value={form.cost} onChange={set('cost')} />
          </Field>
          <Field label="Odometer (km)">
            <input type="number" step="0.001" className="form-control num" value={form.odometer_km} onChange={set('odometer_km')} />
          </Field>
          <Field label="Next due">
            <input type="date" className="form-control" value={form.next_due_date} onChange={set('next_due_date')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}