/**
 * Tax / levy / duty configuration.
 * - CRUD  /tax-configs/            crud('tax-configs')
 * - POST  /tax-configs/:id/verify  Professional verification (different user, server-enforced)
 *
 * Rule from services.get_tax_rate: only verified + active + effective configs are used when
 * calculating line tax, so verification state is surfaced prominently.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const TYPES = ['VAT', 'EXCISE', 'DUTY', 'LEVY', 'WHT', 'OTHER'];
const EMPTY = {
  code: '', name: '', tax_type: 'VAT', rate_percent: '',
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: '', is_active: true, notes: '',
};

const verified = (t) => !!t.verified_at;

export default function TaxConfigs() {
  const { user, can } = useAccess();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [editing, setEditing] = useState(null);

  const canEdit = can('company.edit');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.taxConfigs.list({
        ...companyParams(), ordering: 'code', page_size: 500,
        ...(search ? { search } : {}),
        ...(typeFilter ? { tax_type: typeFilter } : {}),
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const verify = async (t) => {
    try {
      await api.taxConfigs.verify(t.id);
      notify(`Tax code ${t.code} verified.`, 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete tax code ${t.code}?`)) return;
    try { await api.taxConfigs.remove(t.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || typeFilter);
  const clearFilters = () => { setSearch(''); setTypeFilter(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Tax configuration</h1>
            <p className="page-subtitle">
              Effective-dated, professionally verified rates{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>
              <i className="bi bi-plus-lg"></i>
              New tax code
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

      <div className="alert alert-info" role="note">
        <i className="bi bi-info-circle" aria-hidden="true"></i>
        <span style={{ flex: 1 }}>
          A tax code is only used in calculations once a user other than its creator has verified it,
          and while today's date is inside its effective range.
        </span>
      </div>

      {/* ---------- One white card ---------- */}
      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tax codes"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Tax type">
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
            {typeFilter && (
              <span className="filter-chip">
                Type: {typeFilter}
                <button onClick={() => setTypeFilter('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Tax Codes
          </span>
          <span className="chart-card__subtitle">
            {rows.length} code{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-percent"></i>
            <h6>{hasActiveFilters ? 'No tax codes match your search' : 'No tax codes yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New tax code' to add a VAT, excise, duty or levy rate"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="text-right">Rate %</th>
                    <th>Effective</th>
                    <th>Verification</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '10rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => {
                    const isMine = t.created_by === user?.id;
                    return (
                      <tr key={t.id}>
                        <td className="cell-mono text-brand fw-600">{t.code}</td>
                        <td className="cell-name">{t.name}</td>
                        <td><span className="badge badge-neutral">{t.tax_type}</span></td>
                        <td className="cell-num">{Number(t.rate_percent).toFixed(3)}</td>
                        <td>{t.effective_from}{t.effective_to ? ` ? ${t.effective_to}` : ' ?'}</td>
                        <td>
                          <span
                            className={`status-pill ${verified(t) ? 'status-pill--success' : 'status-pill--warning'}`}
                            title={verified(t) ? (t.verified_by_label || 'Verified') : 'Awaiting verification'}
                          >
                            {verified(t) ? 'VERIFIED' : 'UNVERIFIED'}
                          </span>
                        </td>
                        <td>
                          <span className={`status-pill ${t.is_active ? 'status-pill--success' : 'status-pill--neutral'}`}>
                            {t.is_active ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>
                        <td>
                          {canEdit && (
                            <div className="row-actions">
                              {!verified(t) && !isMine && (
                                <button className="btn btn-icon" title="Verify" aria-label="Verify" onClick={() => verify(t)}>
                                  <i className="bi bi-patch-check"></i>
                                </button>
                              )}
                              <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(t)}>
                                <i className="bi bi-pencil"></i>
                              </button>
                              <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(t)}>
                                <i className="bi bi-trash"></i>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && (
        <TaxModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Tax code saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function TaxModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', tax_type: row.tax_type || 'VAT',
    rate_percent: row.rate_percent ?? '', effective_from: row.effective_from || '', effective_to: row.effective_to || '',
    is_active: row.is_active ?? true, notes: row.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.effective_to) body.effective_to = null;
      isNew ? await api.taxConfigs.create(body) : await api.taxConfigs.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New tax code' : `Edit ${row.code}`}
      subtitle="A different user must verify it before use"
      icon="bi-percent"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="taxForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="taxForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Tax Details</h6>
        <div className="form-grid">
          <Field label="Code" required err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} required disabled={!isNew} />
          </Field>
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Type" required>
            <select className="form-select" value={form.tax_type} onChange={set('tax_type')} required>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Rate %" required err={fieldErr.rate_percent}>
            <input type="number" step="0.001" className="form-control num" value={form.rate_percent} onChange={set('rate_percent')} required />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-calendar-range" aria-hidden="true"></i>Validity</h6>
        <div className="form-grid">
          <Field label="Effective from" required err={fieldErr.effective_from}>
            <input type="date" className="form-control" value={form.effective_from} onChange={set('effective_from')} required />
          </Field>
          <Field label="Effective to" err={fieldErr.effective_to}>
            <input type="date" className="form-control" value={form.effective_to} onChange={set('effective_to')} />
          </Field>
          <Field label="Notes" span>
            <textarea className="form-control" rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
          <Field label="Status" span>
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="tax-active" checked={!!form.is_active} onChange={set('is_active')} />
              <label className="form-check-label" htmlFor="tax-active">Active</label>
            </div>
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}