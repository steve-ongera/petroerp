/**
 * Legal entities (companies).
 * - GET/POST/PATCH/DELETE /companies/   (crud('companies'))
 * - Only the Group Administrator can create (enforced server-side).
 * - Each company is the "legal entity" everything else is scoped to.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const EMPTY = {
  code: '', name: '', country: 'KE', functional_currency: '',
  tax_pin: '', registration_number: '', address: '', phone: '', email: '',
  inventory_valuation: 'WAVG', min_margin_pct: '', match_tolerance_pct: '1',
  delivery_loss_tolerance_pct: '', is_active: true,
};

const COUNTRIES = { KE: 'Kenya', CD: 'DR Congo' };

export default function Companies() {
  const { can, isAdmin } = useAccess();
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [editing, setEditing] = useState(null); // null | {..company} (new if !id)

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.companies.list({
        ordering: 'code', page_size: 200,
        ...(search ? { search } : {}),
        ...(country ? { country } : {}),
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [search, country]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.currencies.listAll().then(setCurrencies).catch(() => {}); }, []);

  const remove = async (c) => {
    if (!window.confirm(`Delete company ${c.code}? This cannot be undone.`)) return;
    try { await api.companies.remove(c.id); notify('Company deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const canEdit = can('company.edit');
  const hasActiveFilters = !!(search || country);
  const clearFilters = () => { setSearch(''); setCountry(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Legal entities</h1>
            <p className="page-subtitle">Companies in the group</p>
          </div>
        </div>
        <div className="page-header__actions">
          {isAdmin && canEdit && (
            <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>
              <i className="bi bi-plus-lg"></i>
              New company
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
              placeholder="Search by code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search companies"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
            <option value="">All countries</option>
            {Object.entries(COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
            {country && (
              <span className="filter-chip">
                Country: {COUNTRIES[country]}
                <button onClick={() => setCountry('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Company List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} entit{rows.length === 1 ? 'y' : 'ies'}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={6} columns={7} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-buildings"></i>
            <h6>{hasActiveFilters ? 'No companies match your search' : 'No companies yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : 'Create the first legal entity to get started'}
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
                    <th>Country</th>
                    <th>Currency</th>
                    <th>Valuation</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => (
                    <tr key={c.id} style={{ cursor: canEdit ? 'pointer' : undefined }} onClick={() => canEdit && setEditing({ ...c })}>
                      <td className="cell-mono text-brand fw-600">{c.code}</td>
                      <td className="cell-name">{c.name}</td>
                      <td>{COUNTRIES[c.country] || c.country}</td>
                      <td>{c.functional_currency_label || c.functional_currency}</td>
                      <td>{c.inventory_valuation}</td>
                      <td>
                        <span className={`status-pill ${c.is_active ? 'status-pill--success' : 'status-pill--neutral'}`}>
                          {c.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {canEdit && (
                          <div className="row-actions">
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing({ ...c })}>
                              <i className="bi bi-pencil"></i>
                            </button>
                            {isAdmin && (
                              <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(c)}>
                                <i className="bi bi-trash"></i>
                              </button>
                            )}
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
        <CompanyModal
          company={editing}
          currencies={currencies}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); notify('Company saved.', 'success'); }}
        />
      )}
    </div>
  );
}

function CompanyModal({ company, currencies, onClose, onSaved }) {
  const isNew = !company.id;
  const [form, setForm] = useState({ ...company });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      if (body.functional_currency && typeof body.functional_currency === 'object') body.functional_currency = body.functional_currency.id;
      ['min_margin_pct', 'delivery_loss_tolerance_pct'].forEach((k) => { if (body[k] === '') body[k] = 0; });
      isNew ? await api.companies.create(body) : await api.companies.update(company.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New company' : `Edit ${company.code}`}
      subtitle="Legal entity details"
      icon="bi-buildings"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="companyForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="companyForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Company Details</h6>
        <div className="form-grid">
          <Field label="Code" required err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} required maxLength={10} disabled={!isNew} />
          </Field>
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Country" err={fieldErr.country}>
            <select className="form-select" value={form.country} onChange={set('country')}>
              {Object.entries(COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Functional currency" required err={fieldErr.functional_currency}>
            <select className="form-select" value={form.functional_currency || ''} onChange={set('functional_currency')} required>
              <option value="">—</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Tax PIN" err={fieldErr.tax_pin}>
            <input className="form-control" value={form.tax_pin} onChange={set('tax_pin')} />
          </Field>
          <Field label="Registration number" err={fieldErr.registration_number}>
            <input className="form-control" value={form.registration_number} onChange={set('registration_number')} />
          </Field>
          <Field label="Phone" err={fieldErr.phone}>
            <input className="form-control" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email" err={fieldErr.email}>
            <input type="email" className="form-control" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Address" span>
            <textarea className="form-control" rows={2} value={form.address} onChange={set('address')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-sliders" aria-hidden="true"></i>Controls & Tolerances</h6>
        <div className="form-grid">
          <Field label="Inventory valuation">
            <select className="form-select" value={form.inventory_valuation} onChange={set('inventory_valuation')}>
              <option value="WAVG">Weighted average</option>
              <option value="FIFO">FIFO</option>
            </select>
          </Field>
          <Field label="Min. margin %" err={fieldErr.min_margin_pct}>
            <input type="number" step="0.001" className="form-control num" value={form.min_margin_pct} onChange={set('min_margin_pct')} />
          </Field>
          <Field label="Match tolerance %" err={fieldErr.match_tolerance_pct}>
            <input type="number" step="0.001" className="form-control num" value={form.match_tolerance_pct} onChange={set('match_tolerance_pct')} />
          </Field>
          <Field label="Delivery loss tolerance %" err={fieldErr.delivery_loss_tolerance_pct}>
            <input type="number" step="0.001" className="form-control num" value={form.delivery_loss_tolerance_pct} onChange={set('delivery_loss_tolerance_pct')} />
          </Field>
          <Field label="Status" span>
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="co-active" checked={!!form.is_active} onChange={set('is_active')} />
              <label className="form-check-label" htmlFor="co-active">Company is active</label>
            </div>
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}