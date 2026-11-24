/**
 * Account mappings: system key -> account per legal entity.
 * - CRUD /account-mappings/   (company scoped)
 * - Account drop-down uses /accounts/ filtered to the active company.
 *
 * These keys are what services.acct(company, key) looks up on every posting
 * (INVENTORY, GRNI, AP, AR, VAT_INPUT, VAT_OUTPUT, COGS, ...).
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const SUGGESTED_KEYS = [
  'INVENTORY', 'INVENTORY_IN_TRANSIT', 'GRNI', 'AP', 'AR',
  'VAT_INPUT', 'VAT_OUTPUT', 'PURCHASE_VARIANCE', 'STOCK_VARIANCE',
  'SALES_REVENUE', 'SALES_RETURNS', 'COGS', 'FX_GAIN', 'FX_LOSS',
  'RETAINED_EARNINGS', 'OPENING_EQUITY', 'TRANSIT_LOSS',
  'IC_RECEIVABLE', 'IC_PAYABLE', 'IC_REVENUE', 'IC_PURCHASES',
  'SALARIES_EXP', 'PAYROLL_PAYABLE', 'STATUTORY_PAYABLE',
  'DEPRECIATION_EXP', 'ACCUM_DEPRECIATION', 'FIXED_ASSETS', 'DISPOSAL_GAIN_LOSS',
  'FX_UNREALIZED',
];

export default function AccountMappings() {
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [m, a] = await Promise.all([
        api.accountMappings.listAll({ ...companyParams(), ordering: 'key' }),
        api.accounts.listAll({ ...companyParams(), ordering: 'code' }),
      ]);
      setRows(m); setAccounts(a);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const remove = async (r) => {
    if (!window.confirm(`Remove mapping for "${r.key}"?`)) return;
    try { await api.accountMappings.remove(r.id); notify('Mapping removed.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.key.toLowerCase().includes(q) || (r.account_label || '').toLowerCase().includes(q);
  });

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Account mappings</h1>
          <p className="page-header__subtitle">
            System keys → GL accounts{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({ key: '', account: '' })}>
            <i className="bi bi-plus-lg" /> New mapping
          </button>
        </div>
      </header>

      <div className="card mb-4">
        <div className="card__body card__body--tight">
          <p className="text-sm text-muted">
            Every posting looks up its account by key. If a key is not mapped, the server raises
            <code>Account mapping "KEY" is not configured</code> and the whole action is rejected.
          </p>
        </div>
      </div>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search key or account…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{filtered.length} mapping{filtered.length === 1 ? '' : 's'}</span>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !filtered.length && !loading ? (
          <div className="table-empty">
            <div className="table-empty__title">No mappings</div>
            <div>Add at least INVENTORY, AP, AR, GRNI, VAT_INPUT, VAT_OUTPUT, COGS, SALES_REVENUE to start posting.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Key</th><th>Account</th><th>Type</th><th className="col-actions" /></tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.key}</td>
                    <td>
                      <span className="cell-main">{r.account_label || '—'}</span>
                      {r.account_code && <span className="cell-sub mono">{r.account_code}</span>}
                    </td>
                    <td>{r.account_type || '—'}</td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Edit" onClick={() => setEditing(r)}><i className="bi bi-pencil" /></button>
                        <button className="row-action row-action--danger" title="Remove" onClick={() => remove(r)}><i className="bi bi-trash" /></button>
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
        <MappingModal
          row={editing}
          accounts={accounts}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Mapping saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function MappingModal({ row, accounts, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({ key: row.key || '', account: row.account || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      isNew ? await api.accountMappings.create(body) : await api.accountMappings.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New mapping' : `Edit ${row.key}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <Field label="System key" required err={fieldErr.key}>
                <input
                  className="input mono"
                  list="keys"
                  value={form.key}
                  onChange={set('key')}
                  placeholder="INVENTORY, AP, AR …"
                  required
                  disabled={!isNew}
                />
                <datalist id="keys">
                  {SUGGESTED_KEYS.map((k) => <option key={k} value={k} />)}
                </datalist>
              </Field>
              <Field label="Account" required err={fieldErr.account}>
                <select className="select" value={form.account} onChange={set('account')} required>
                  <option value="">—</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name} ({a.account_type}{a.is_postable ? '' : ' – not postable'})
                    </option>
                  ))}
                </select>
              </Field>
              {error && <p className="field-error" role="alert">{error}</p>}
            </div>
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

function Field({ label, required, err, children }) {
  return (
    <div className={`field ${err ? 'has-error' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}