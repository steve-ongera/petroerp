/**
 * Drivers.
 * - CRUD /drivers/
 * Fields: full_name, id_number, licence_number, licence_category, licence_expiry, phone, employment_status
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['ACTIVE', 'SUSPENDED', 'TERMINATED'];
const statusPill = (s) => {
  if (s === 'ACTIVE') return 'status-pill--success';
  if (s === 'SUSPENDED') return 'status-pill--warning';
  return 'status-pill--neutral';
};

export default function Drivers() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.drivers.list({
        ...companyParams(),
        ordering: 'full_name',
        ...(search ? { search } : {}),
        ...(status ? { employment_status: status } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, status]);

  useEffect(() => { load(); }, [load]);

  const remove = async (d) => {
    if (!window.confirm(`Delete driver ${d.full_name}?`)) return;
    try { await api.drivers.remove(d.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Drivers</h1>
            <p className="page-subtitle">
              Licenced drivers{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('fleet.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New driver
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
              placeholder="Search by name, licence or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search drivers"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
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
                Status: {status}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Driver List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} driver{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-person-badge"></i>
            <h6>{hasActiveFilters ? 'No drivers match your search' : 'No drivers yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New driver' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>ID number</th>
                    <th>Licence</th>
                    <th>Category</th>
                    <th>Expiry</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((d) => (
                    <tr key={d.id}>
                      <td className="cell-name">{d.full_name}</td>
                      <td className="cell-mono">{d.id_number || '—'}</td>
                      <td className="cell-mono text-brand fw-600">{d.licence_number || '—'}</td>
                      <td>{d.licence_category || '—'}</td>
                      <td>{d.licence_expiry || '—'}</td>
                      <td>{d.phone || '—'}</td>
                      <td>
                        <span className={`status-pill ${statusPill(d.employment_status)}`}>{d.employment_status}</span>
                      </td>
                      <td>
                        {can('fleet.edit') && (
                          <div className="row-actions">
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(d)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(d)}>
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
        <DriverModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function DriverModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    full_name: row.full_name || '', id_number: row.id_number || '',
    licence_number: row.licence_number || '', licence_category: row.licence_category || '',
    licence_expiry: row.licence_expiry || '', phone: row.phone || '',
    employment_status: row.employment_status || 'ACTIVE',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.licence_expiry) body.licence_expiry = null;
      isNew ? await api.drivers.create(body) : await api.drivers.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New driver' : `Edit ${row.full_name}`}
      subtitle="Licenced drivers"
      icon="bi-person-badge"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="driverForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="driverForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-person" aria-hidden="true"></i>Personal Details</h6>
        <div className="form-grid">
          <Field label="Full name" required err={fieldErr.full_name} span>
            <input className="form-control" value={form.full_name} onChange={set('full_name')} required />
          </Field>
          <Field label="ID number" err={fieldErr.id_number}>
            <input className="form-control font-mono" value={form.id_number} onChange={set('id_number')} />
          </Field>
          <Field label="Phone"><input className="form-control" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Status">
            <select className="form-select" value={form.employment_status} onChange={set('employment_status')}>
              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-card-heading" aria-hidden="true"></i>Licence</h6>
        <div className="form-grid">
          <Field label="Licence number" err={fieldErr.licence_number}>
            <input className="form-control font-mono" value={form.licence_number} onChange={set('licence_number')} />
          </Field>
          <Field label="Licence category">
            <input className="form-control" value={form.licence_category} onChange={set('licence_category')} />
          </Field>
          <Field label="Licence expiry">
            <input type="date" className="form-control" value={form.licence_expiry} onChange={set('licence_expiry')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}