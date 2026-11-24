/**
 * Fixed assets.
 * - CRUD /fixed-assets/   (crud with FixedAssetSerializer; net_book_value computed)
 * - POST /fixed-assets/run-depreciation/  { company, period_end }       (needs finance.post)
 * - POST /fixed-assets/:id/dispose/       { proceeds, date, bank_account }
 * - POST /fixed-assets/:id/transfer/      { location }
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const CATEGORIES = ['TRUCK', 'TRAILER', 'DEPOT', 'TANK', 'EQUIPMENT', 'OFFICE', 'OTHER'];
const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function FixedAssets() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [disposing, setDisposing] = useState(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [a, b] = await Promise.all([
        api.fixedAssets.listAll({ ...companyParams(), ordering: 'code' }),
        api.bankAccounts.listAll({ ...companyParams() }),
      ]);
      setRows(a); setBankAccounts(b);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const runDep = async () => {
    const period_end = window.prompt('Depreciation period end (YYYY-MM-DD):', todayISO());
    if (!period_end) return;
    setRunning(true);
    try {
      const res = await api.fixedAssets.runDepreciation({ company: companyParams().company, period_end });
      notify(`${res.depreciated.length} asset(s) depreciated.`, 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
    finally { setRunning(false); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Fixed assets</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {rows.length} asset{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('finance.post') && (
            <button className="btn" onClick={runDep} disabled={running}>{running ? 'Running…' : 'Run depreciation'}</button>
          )}
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <i className="bi bi-plus-lg" /> New asset
          </button>
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No assets</div><div>Add the first fixed asset.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Code</th><th>Name</th><th>Category</th><th>Acquired</th>
                <th className="num">Cost</th><th className="num">Accum. dep.</th><th className="num">NBV</th>
                <th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{a.reference}</td>
                    <td>{a.name}</td>
                    <td><span className="badge">{a.category}</span></td>
                    <td>{a.acquisition_date}</td>
                    <td className="num">{fmtMoney(a.cost)}</td>
                    <td className="num">{fmtMoney(a.accumulated_depreciation)}</td>
                    <td className="num">{fmtMoney(a.net_book_value)}</td>
                    <td><span className={`status ${a.status === 'ACTIVE' ? 'status-active' : 'status-closed'}`}>{a.status}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Edit" onClick={() => setEditing(a)}><i className="bi bi-pencil" /></button>
                        {a.status === 'ACTIVE' && can('finance.post') && (
                          <button className="btn btn-xs" onClick={() => setDisposing(a)}>Dispose</button>
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
        <AssetModal row={editing} companyParams={companyParams}
                    onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
      {disposing && (
        <DisposeModal asset={disposing} bankAccounts={bankAccounts}
                      onClose={() => setDisposing(null)} onDone={() => { setDisposing(null); notify('Disposed.', 'success'); load(); }} />
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
      isNew ? await api.fixedAssets.create(body) : await api.fixedAssets.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New asset' : `Edit ${row.reference}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Name" required err={fieldErr.name} span>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Category">
                <select className="select" value={form.category} onChange={set('category')}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Acquisition date" required>
                <input type="date" className="input" value={form.acquisition_date} onChange={set('acquisition_date')} required />
              </Field>
              <Field label="Cost" required>
                <input type="number" step="0.01" className="input num" value={form.cost} onChange={set('cost')} required />
              </Field>
              <Field label="Salvage value">
                <input type="number" step="0.01" className="input num" value={form.salvage_value} onChange={set('salvage_value')} />
              </Field>
              <Field label="Useful life (months)">
                <input type="number" min={1} className="input num" value={form.useful_life_months} onChange={set('useful_life_months')} />
              </Field>
              <Field label="Location"><input className="input" value={form.location} onChange={set('location')} /></Field>
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
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Dispose {asset.reference}</h2>
            <p className="modal__subtitle">{asset.name}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="kv">
              <div className="kv__item"><div className="kv__label">Cost</div><div className="kv__value">{fmtMoney(asset.cost)}</div></div>
              <div className="kv__item"><div className="kv__label">Accumulated depreciation</div><div className="kv__value">{fmtMoney(asset.accumulated_depreciation)}</div></div>
              <div className="kv__item"><div className="kv__label">NBV</div><div className="kv__value">{fmtMoney(asset.net_book_value)}</div></div>
            </div>
            <hr className="divider" />
            <div className="form">
              <div className="field">
                <label className="label label--required">Proceeds</label>
                <input type="number" step="0.01" className="input num" value={form.proceeds} onChange={set('proceeds')} required />
              </div>
              <div className="field">
                <label className="label label--required">Date</label>
                <input type="date" className="input" value={form.date} onChange={set('date')} required />
              </div>
              <div className="field">
                <label className="label label--required">Bank / cash account</label>
                <select className="select" value={form.bank_account} onChange={set('bank_account')} required>
                  <option value="">—</option>
                  {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
                </select>
              </div>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" disabled={busy}>{busy ? 'Disposing…' : 'Dispose'}</button>
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