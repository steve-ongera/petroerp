/**
 * Products (global master — scope=None on the API).
 * - CRUD /products/
 * Fields: code, name, category, unit, density_min/max, valuation_method, reference_temp_c,
 *         expansion_coefficient, min_margin_pct, status.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const CATEGORIES = ['DIESEL', 'PETROL', 'KEROSENE', 'JET_FUEL', 'LPG', 'LUBRICANT', 'OTHER'];
const VALUATION = ['DEFAULT', 'FIFO', 'WAVG'];

export default function Products() {
  const { can } = useAuth();
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.products.list({
        ordering: 'code',
        ...(search ? { search } : {}),
        ...(category ? { category } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [search, category]);

  useEffect(() => { load(); }, [load]);

  const remove = async (p) => {
    if (!window.confirm(`Delete product ${p.code}?`)) return;
    try { await api.products.remove(p.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || category);
  const clearFilters = () => { setSearch(''); setCategory(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      {/* ---------- Page header: icon tile + title + actions ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Products</h1>
            <p className="page-subtitle">Fuel and lubricant master data</p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('inventory.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New product
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
              placeholder="Search by code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search products"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
            {category && (
              <span className="filter-chip">
                Category: {category}
                <button onClick={() => setCategory('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Product List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} product{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-droplet"></i>
            <h6>{hasActiveFilters ? 'No products match your search' : 'No products yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New product' to add the first one"}
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
                    <th>Category</th>
                    <th>Unit</th>
                    <th>Valuation</th>
                    <th className="text-right">Min margin %</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={p.id}>
                      <td className="cell-mono text-brand fw-600">{p.code}</td>
                      <td className="cell-name">{p.name}</td>
                      <td><span className="badge badge-neutral">{p.category}</span></td>
                      <td>{p.unit}</td>
                      <td>{p.valuation_method}</td>
                      <td className="cell-num">{p.min_margin_pct != null ? Number(p.min_margin_pct).toFixed(3) : '—'}</td>
                      <td>
                        <span className={`status-pill ${p.status === 'ACTIVE' ? 'status-pill--success' : 'status-pill--neutral'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td>
                        {can('inventory.edit') && (
                          <div className="row-actions">
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(p)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(p)}>
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
        <ProductModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function ProductModal({ row, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', category: row.category || 'DIESEL',
    unit: row.unit || 'L', density_min: row.density_min ?? '', density_max: row.density_max ?? '',
    specification: row.specification || '', tax_category: row.tax_category || '',
    valuation_method: row.valuation_method || 'DEFAULT',
    reference_temp_c: row.reference_temp_c ?? 15,
    expansion_coefficient: row.expansion_coefficient ?? '',
    min_margin_pct: row.min_margin_pct ?? '',
    status: row.status || 'ACTIVE',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      ['density_min', 'density_max', 'expansion_coefficient', 'min_margin_pct'].forEach((k) => {
        if (body[k] === '') body[k] = null;
      });
      isNew ? await api.products.create(body) : await api.products.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New product' : `Edit ${row.code}`}
      subtitle="Fuel and lubricant master data"
      icon="bi-droplet-half"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="productForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="productForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Product Details</h6>
        <div className="form-grid">
          <Field label="Code" required err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} required disabled={!isNew} />
          </Field>
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Category" required>
            <select className="form-select" value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Unit">
            <input className="form-control" value={form.unit} onChange={set('unit')} maxLength={10} />
          </Field>
          <Field label="Tax category">
            <input className="form-control" value={form.tax_category} onChange={set('tax_category')} />
          </Field>
          <Field label="Status">
            <select className="form-select" value={form.status} onChange={set('status')}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </Field>
          <Field label="Specification" span>
            <textarea className="form-control" rows={2} value={form.specification} onChange={set('specification')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-thermometer-half" aria-hidden="true"></i>Measurement & Valuation</h6>
        <div className="form-grid">
          <Field label="Density min">
            <input type="number" step="0.0001" className="form-control num" value={form.density_min} onChange={set('density_min')} />
          </Field>
          <Field label="Density max">
            <input type="number" step="0.0001" className="form-control num" value={form.density_max} onChange={set('density_max')} />
          </Field>
          <Field label="Reference temp (°C)">
            <input type="number" step="0.01" className="form-control num" value={form.reference_temp_c} onChange={set('reference_temp_c')} />
          </Field>
          <Field label="Expansion coefficient">
            <input type="number" step="0.0000001" className="form-control num" value={form.expansion_coefficient} onChange={set('expansion_coefficient')} />
          </Field>
          <Field label="Valuation method">
            <select className="form-select" value={form.valuation_method} onChange={set('valuation_method')}>
              {VALUATION.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Min margin %">
            <input type="number" step="0.001" className="form-control num" value={form.min_margin_pct} onChange={set('min_margin_pct')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}