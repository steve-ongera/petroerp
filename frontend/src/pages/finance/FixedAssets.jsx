/**
 * Fixed assets.
 * - CRUD /fixed-assets/   (crud with FixedAssetSerializer; net_book_value computed)
 * - POST /fixed-assets/run-depreciation/  { company, period_end }       (needs finance.post)
 * - POST /fixed-assets/:id/dispose/       { proceeds, date, bank_account }
 * - POST /fixed-assets/:id/transfer/      { location }
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const CATEGORIES = ['TRUCK', 'TRAILER', 'DEPOT', 'TANK', 'EQUIPMENT', 'OFFICE', 'OTHER'];
const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function FixedAssets() {
  const { can } = useAccess();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [disposing, setDisposing] = useState(null);
  const [depreciating, setDepreciating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [a, b] = await Promise.all([
        api.fixedAssets.listAll({ ...companyParams(), ordering: 'reference' }),
        api.bankAccounts.listAll({ ...companyParams() }),
      ]);
      setRows(a); setBankAccounts(b);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((a) => (
      (!q || `${a.reference} ${a.name}`.toLowerCase().includes(q)) &&
      (!category || a.category === category) &&
      (!status || a.status === status)
    ));
  }, [rows, search, category, status]);

  const hasActiveFilters = !!(search || category || status);
  const clearFilters = () => { setSearch(''); setCategory(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(filtered);

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Fixed assets</h1>
            <p className="page-subtitle">
              {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {rows.length} asset{rows.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('finance.post') && (
            <button className="btn btn-secondary" onClick={() => setDepreciating(true)}>
              <i className="bi bi-graph-down"></i>
              Run depreciation
            </button>
          )}
          {can('assets.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New asset
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
              aria-label="Search assets"
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
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DISPOSED">Disposed</option>
          </select>
          {hasActiveFilters && (
            <button className="btn btn-secondary" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="chip-row">
            {search && <span className="filter-chip">Search: "{search}"<button onClick={() => setSearch('')}><i className="bi bi-x"></i></button></span>}
            {category && <span className="filter-chip">Category: {category}<button onClick={() => setCategory('')}><i className="bi bi-x"></i></button></span>}
            {status && <span className="filter-chip">Status: {status}<button onClick={() => setStatus('')}><i className="bi bi-x"></i></button></span>}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Asset Register
          </span>
          <span className="chart-card__subtitle">{filtered.length} asset{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-truck-front"></i>
            <h6>{hasActiveFilters ? 'No assets match your filters' : 'No assets yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New asset' to add the first fixed asset"}
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
                    <th>Acquired</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Accum. dep.</th>
                    <th className="text-right">NBV</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((a) => (
                    <tr key={a.id}>
                      <td className="cell-mono text-brand fw-600">{a.reference}</td>
                      <td className="cell-name">{a.name}</td>
                      <td><span className="badge badge-neutral">{a.category}</span></td>
                      <td>{a.acquisition_date}</td>
                      <td className="cell-num">{fmtMoney(a.cost)}</td>
                      <td className="cell-num">{fmtMoney(a.accumulated_depreciation)}</td>
                      <td className="cell-num fw-600">{fmtMoney(a.net_book_value)}</td>
                      <td>
                        <span className={`status-pill ${a.status === 'ACTIVE' ? 'status-pill--success' : 'status-pill--neutral'}`}>{a.status}</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {can('assets.edit') && (
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(a)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                          )}
                          {a.status === 'ACTIVE' && can('finance.post') && (
                            <button className="btn btn-sm btn-secondary" onClick={() => setDisposing(a)}>
                              <i className="bi bi-box-arrow-right"></i> Dispose
                            </button>
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

        {!loading && filtered.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && (
        <AssetModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
      {disposing && (
        <DisposeModal
          asset={disposing}
          bankAccounts={bankAccounts}
          onClose={() => setDisposing(null)}
          onDone={() => { setDisposing(null); notify('Asset disposed.', 'success'); load(); }}
        />
      )}
      {depreciating && (
        <DepreciationModal
          companyParams={companyParams}
          onClose={() => setDepreciating(false)}
          onDone={(n) => { setDepreciating(false); notify(`${n} asset(s) depreciated.`, 'success'); load(); }}
        />
      )}
    </div>
  );
}

function AssetModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    name: row.name || '', category: row.category || 'TRUCK',
    acquisition_date: row.acquisition_date || todayISO(),
    cost: row.cost ?? '', salvage_value: row.salvage_value ?? '',
    useful_life_months: row.useful_life_months ?? 60,
    location: row.location || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (body.salvage_value === '') body.salvage_value = 0;
      isNew ? await api.fixedAssets.create(body) : await api.fixedAssets.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New asset' : `Edit ${row.reference}`}
      subtitle="Fixed asset register"
      icon="bi-truck-front"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="assetForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="assetForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Asset Details</h6>
        <div className="form-grid">
          <Field label="Name" required err={fieldErr.name} span>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Category">
            <select className="form-select" value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Location">
            <input className="form-control" value={form.location} onChange={set('location')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-calculator" aria-hidden="true"></i>Cost & Depreciation</h6>
        <div className="form-grid">
          <Field label="Acquisition date" required err={fieldErr.acquisition_date}>
            <input type="date" className="form-control" value={form.acquisition_date} onChange={set('acquisition_date')} required />
          </Field>
          <Field label="Useful life (months)" err={fieldErr.useful_life_months}>
            <input type="number" min={1} className="form-control num" value={form.useful_life_months} onChange={set('useful_life_months')} />
          </Field>
          <Field label="Cost" required err={fieldErr.cost}>
            <input type="number" step="0.01" className="form-control num" value={form.cost} onChange={set('cost')} required />
          </Field>
          <Field label="Salvage value" err={fieldErr.salvage_value}>
            <input type="number" step="0.01" className="form-control num" value={form.salvage_value} onChange={set('salvage_value')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function DisposeModal({ asset, bankAccounts, onClose, onDone }) {
  const [form, setForm] = useState({ proceeds: asset.net_book_value ?? '', date: todayISO(), bank_account: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.fixedAssets.dispose(asset.id, form); onDone(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={`Dispose ${asset.reference}`}
      subtitle={asset.name}
      icon="bi-box-arrow-right"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" type="submit" form="disposeForm" disabled={busy}>
            {busy ? 'Disposing...' : 'Dispose'}
          </button>
        </>
      }
    >
      <form id="disposeForm" onSubmit={submit}>
        <div className="kv">
          <div className="kv__item"><div className="kv__label">Cost</div><div className="kv__value">{fmtMoney(asset.cost)}</div></div>
          <div className="kv__item"><div className="kv__label">Accumulated depreciation</div><div className="kv__value">{fmtMoney(asset.accumulated_depreciation)}</div></div>
          <div className="kv__item"><div className="kv__label">Net book value</div><div className="kv__value">{fmtMoney(asset.net_book_value)}</div></div>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-cash-coin" aria-hidden="true"></i>Disposal</h6>
        <div className="form-grid">
          <Field label="Proceeds" required>
            <input type="number" step="0.01" className="form-control num" value={form.proceeds} onChange={set('proceeds')} required />
          </Field>
          <Field label="Date" required>
            <input type="date" className="form-control" value={form.date} onChange={set('date')} required />
          </Field>
          <Field label="Bank / cash account" required span>
            <select className="form-select" value={form.bank_account} onChange={set('bank_account')} required>
              <option value="">—</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
            </select>
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function DepreciationModal({ companyParams, onClose, onDone }) {
  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const res = await api.fixedAssets.runDepreciation({ company: companyParams().company, period_end: periodEnd });
      onDone(res.depreciated?.length ?? 0);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Run depreciation"
      subtitle="Straight-line, once per asset per period"
      icon="bi-graph-down"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="depreciationForm" disabled={busy}>
            <i className="bi bi-play-fill"></i>
            {busy ? 'Running...' : 'Run'}
          </button>
        </>
      }
    >
      <form id="depreciationForm" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Period end" required span>
            <input type="date" className="form-control" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
          </Field>
        </div>
        <p className="text-muted-soft mt-3">
          Posts one journal per active asset for this period. Assets already depreciated for the date are skipped.
        </p>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}