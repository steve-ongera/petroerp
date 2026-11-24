/**
 * Products (global master — scope=None on the API).
 * - CRUD /products/
 * Fields: code, name, category, unit, density_min/max, valuation_method, reference_temp_c,
 *         expansion_coefficient, min_margin_pct, status.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

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

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Products</h1>
          <p className="page-header__subtitle">Fuel and lubricant master data</p>
        </div>
        <div className="page-header__actions">
          {can('inventory.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New product
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{rows.length} product{rows.length === 1 ? '' : 's'}</span>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No products</div>
            <div>Add the first product.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Code</th><th>Name</th><th>Category</th><th>Unit</th>
                <th>Valuation</th><th className="num">Min margin %</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.code}</td>
                    <td>{p.name}</td>
                    <td><span className="badge">{p.category}</span></td>
                    <td>{p.unit}</td>
                    <td>{p.valuation_method}</td>
                    <td className="num">{p.min_margin_pct != null ? Number(p.min_margin_pct).toFixed(3) : '—'}</td>
                    <td><span className={`status ${p.status === 'ACTIVE' ? 'status-active' : 'status-inactive'}`}>{p.status}</span></td>
                    <td className="col-actions">
                      {can('inventory.edit') && (
                        <div className="row-actions">
                          <button className="row-action" title="Edit" onClick={() => setEditing(p)}><i className="bi bi-pencil" /></button>
                          <button className="row-action row-action--danger" title="Delete" onClick={() => remove(p)}><i className="bi bi-trash" /></button>
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
        <ProductModal row={editing} onClose={() => setEditing(null)}
                      onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
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
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New product' : `Edit ${row.code}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Code" required err={fieldErr.code}>
                <input className="input mono" value={form.code} onChange={set('code')} required disabled={!isNew} />
              </Field>
              <Field label="Name" required err={fieldErr.name}>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Category" required>
                <select className="select" value={form.category} onChange={set('category')}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Unit"><input className="input" value={form.unit} onChange={set('unit')} maxLength={10} /></Field>
              <Field label="Density min"><input type="number" step="0.0001" className="input num" value={form.density_min} onChange={set('density_min')} /></Field>
              <Field label="Density max"><input type="number" step="0.0001" className="input num" value={form.density_max} onChange={set('density_max')} /></Field>
              <Field label="Valuation method">
                <select className="select" value={form.valuation_method} onChange={set('valuation_method')}>
                  {VALUATION.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Min margin %"><input type="number" step="0.001" className="input num" value={form.min_margin_pct} onChange={set('min_margin_pct')} /></Field>
              <Field label="Reference temp (°C)"><input type="number" step="0.01" className="input num" value={form.reference_temp_c} onChange={set('reference_temp_c')} /></Field>
              <Field label="Expansion coefficient"><input type="number" step="0.0000001" className="input num" value={form.expansion_coefficient} onChange={set('expansion_coefficient')} /></Field>
              <Field label="Tax category"><input className="input" value={form.tax_category} onChange={set('tax_category')} /></Field>
              <Field label="Status">
                <select className="select" value={form.status} onChange={set('status')}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </Field>
              <Field label="Specification" span>
                <textarea className="textarea" rows={2} value={form.specification} onChange={set('specification')} />
              </Field>
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

function Field({ label, required, err, span, children }) {
  return (
    <div className={`field ${span ? 'span-all' : ''} ${err ? 'has-error' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}