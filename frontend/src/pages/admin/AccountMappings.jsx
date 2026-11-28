/**
 * Account mappings: system key -> account per legal entity.
 * - CRUD /account-mappings/   (company scoped)
 * - Account drop-down uses /accounts/ filtered to the active company (postable accounts only).
 *
 * These keys are what services.acct(company, key) looks up on every posting
 * (INVENTORY, GRNI, AP, AR, VAT_INPUT, VAT_OUTPUT, COGS, SALARIES_EXP, ...).
 * The checklist at the top shows every key the system needs, grouped by the feature that uses it,
 * and which ones are still missing for the selected company. Click a missing key to map it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

// Keys the server looks up, grouped by the feature that fails when one is missing.
const REQUIRED = [
  { group: 'Procurement', keys: ['INVENTORY', 'GRNI', 'AP', 'VAT_INPUT', 'PURCHASE_VARIANCE'] },
  { group: 'Sales', keys: ['AR', 'VAT_OUTPUT', 'SALES_REVENUE', 'SALES_RETURNS', 'COGS'] },
  { group: 'Stock and shipments', keys: ['INVENTORY_IN_TRANSIT', 'TRANSIT_LOSS', 'STOCK_VARIANCE', 'OPENING_EQUITY'] },
  { group: 'Payments', keys: ['CUSTOMER_ADVANCES', 'SUPPLIER_ADVANCES', 'FX_GAIN', 'FX_LOSS'] },
  { group: 'Payroll', keys: ['SALARIES_EXP', 'PAYROLL_PAYABLE', 'STATUTORY_PAYABLE'] },
  { group: 'Fixed assets', keys: ['FIXED_ASSETS', 'ACCUM_DEPRECIATION', 'DEPRECIATION_EXP', 'DISPOSAL_GAIN_LOSS'] },
  { group: 'Year end and FX', keys: ['RETAINED_EARNINGS', 'FX_UNREALIZED'] },
  { group: 'Intercompany', keys: ['IC_RECEIVABLE', 'IC_PAYABLE', 'IC_REVENUE', 'IC_PURCHASES'] },
];

// What kind of account each key normally points to (shown as a hint in the form).
const HINT = {
  INVENTORY: 'ASSET', INVENTORY_IN_TRANSIT: 'ASSET', GRNI: 'LIABILITY', AP: 'LIABILITY', AR: 'ASSET',
  VAT_INPUT: 'ASSET', VAT_OUTPUT: 'LIABILITY', PURCHASE_VARIANCE: 'EXPENSE', STOCK_VARIANCE: 'EXPENSE',
  SALES_REVENUE: 'REVENUE', SALES_RETURNS: 'REVENUE (contra)', COGS: 'EXPENSE', FX_GAIN: 'REVENUE', FX_LOSS: 'EXPENSE',
  RETAINED_EARNINGS: 'EQUITY', OPENING_EQUITY: 'EQUITY', TRANSIT_LOSS: 'EXPENSE',
  IC_RECEIVABLE: 'ASSET', IC_PAYABLE: 'LIABILITY', IC_REVENUE: 'REVENUE', IC_PURCHASES: 'EXPENSE',
  SALARIES_EXP: 'EXPENSE', PAYROLL_PAYABLE: 'LIABILITY', STATUTORY_PAYABLE: 'LIABILITY',
  DEPRECIATION_EXP: 'EXPENSE', ACCUM_DEPRECIATION: 'ASSET (contra)', FIXED_ASSETS: 'ASSET',
  DISPOSAL_GAIN_LOSS: 'EXPENSE or REVENUE', FX_UNREALIZED: 'REVENUE or EXPENSE',
  CUSTOMER_ADVANCES: 'LIABILITY', SUPPLIER_ADVANCES: 'ASSET',
};

const SUGGESTED_KEYS = REQUIRED.flatMap((g) => g.keys);

export default function AccountMappings() {
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [showList, setShowList] = useState(true);

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

  const accById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const mapped = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  const missing = useMemo(
    () => REQUIRED.flatMap((g) => g.keys).filter((k) => !mapped.has(k)),
    [mapped],
  );
  const total = SUGGESTED_KEYS.length;

  const remove = async (r) => {
    if (!window.confirm(`Remove mapping for "${r.key}"?`)) return;
    try { await api.accountMappings.remove(r.id); notify('Mapping removed.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.key.toLowerCase().includes(q) || (r.account_label || '').toLowerCase().includes(q));
  }, [rows, search]);

  const { pageRows, paginationProps } = usePagination(filtered);

  const chip = (k) => {
    const ok = mapped.has(k);
    return (
      <button
        key={k}
        type="button"
        disabled={ok}
        onClick={() => setEditing({ key: k, account: '' })}
        title={ok ? 'Mapped' : `Click to map ${k}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '.3rem', margin: '0 .4rem .4rem 0',
          padding: '.2rem .6rem', borderRadius: 'var(--radius-md)', border: 0, fontSize: 'var(--fs-xs)', fontWeight: 600,
          fontFamily: 'monospace', cursor: ok ? 'default' : 'pointer',
          background: ok ? 'var(--success-100)' : 'var(--danger-100)', color: ok ? '#15803d' : '#c2272d',
        }}
      >
        <i className={`bi ${ok ? 'bi-check-circle-fill' : 'bi-plus-circle'}`} aria-hidden="true"></i>{k}
      </button>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <div className="page-header__text">
            <h1 className="page-title">Account mappings</h1>
            <p className="page-subtitle">
              System keys → GL accounts{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({ key: '', account: '' })}>
            <i className="bi bi-plus-lg"></i>
            New mapping
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      {!companyParams()?.company && (
        <div className="alert alert-warning" role="alert">
          Select a company in the top bar. Mappings are saved per company.
        </div>
      )}

      <div className="alert alert-info" role="note">
        <i className="bi bi-info-circle" aria-hidden="true"></i>
        <span style={{ flex: 1 }}>
          Every posting looks up its account by key. If a key is not mapped, the server rejects the whole action with
          {' '}<code>Account mapping "KEY" is not configured</code>. Map the account to the company named in that message.
        </span>
      </div>

      {!loading && (
        <section className="page-card" style={{ marginBottom: '1rem' }}>
          <div className="table-wrap__header" style={{ cursor: 'pointer' }} onClick={() => setShowList((v) => !v)}>
            <span className="panel-title">
              <i className={`bi ${missing.length ? 'bi-exclamation-triangle text-danger' : 'bi-check-circle text-success'}`}></i>
              Setup checklist
            </span>
            <span className="chart-card__subtitle">
              {total - missing.length} of {total} required keys mapped
              {missing.length > 0 ? ` · ${missing.length} missing` : ''}
              <i className={`bi ${showList ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ marginLeft: '.5rem' }}></i>
            </span>
          </div>
          {showList && (
            <div style={{ padding: '1rem 1.25rem' }}>
              {REQUIRED.map((g) => (
                <div key={g.group} style={{ display: 'flex', gap: '1rem', padding: '.35rem 0', alignItems: 'flex-start' }}>
                  <div style={{ flex: '0 0 11rem', fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{g.group}</div>
                  <div style={{ flex: 1 }}>{g.keys.map(chip)}</div>
                </div>
              ))}
              <p className="form-text-hint" style={{ marginTop: '.6rem' }}>
                Red keys are missing for this company. Click one to map it. Expense postings also use optional
                {' '}<code>EXP_&lt;category code&gt;</code> / <code>EXP_&lt;group&gt;</code> keys when an expense has no account of its own.
              </p>
            </div>
          )}
        </section>
      )}

      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by key or account..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search mappings"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          {search && (
            <button className="btn btn-secondary" onClick={() => setSearch('')}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Mapping List
          </span>
          <span className="chart-card__subtitle">
            {filtered.length} mapping{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={4} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-diagram-3"></i>
            <h6>{search ? 'No mappings match your search' : 'No mappings yet'}</h6>
            <p className="text-muted-soft">
              {search ? 'Try a different search' : 'Use the checklist above to add the keys your company needs'}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const a = accById[r.account];
                    return (
                      <tr key={r.id}>
                        <td className="cell-mono text-brand fw-600">{r.key}</td>
                        <td className="cell-name">
                          {r.account_label || '—'}
                          {a && !a.is_postable && (
                            <div className="text-danger" style={{ fontSize: '0.8rem' }}>Not postable: postings to this key will fail</div>
                          )}
                        </td>
                        <td>{a?.account_type ? <span className="badge badge-neutral">{a.account_type}</span> : '—'}</td>
                        <td>
                          <div className="row-actions">
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(r)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button className="btn btn-icon" title="Remove" aria-label="Remove" onClick={() => remove(r)}>
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && filtered.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && (
        <MappingModal
          row={editing}
          accounts={accounts}
          companyId={companyParams()?.company || activeCompanyObj?.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Mapping saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function MappingModal({ row, accounts, companyId, onClose, onSaved }) {
  const isNew = !row.id;
  const keyLocked = !isNew || !!row.key;          // key chosen from the checklist or being edited
  const [form, setForm] = useState({ key: row.key || '', account: row.account || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Only postable, active accounts can receive a posting; keep the current choice visible when editing.
  const options = accounts.filter((a) => (a.is_postable && a.is_active) || String(a.id) === String(row.account));
  const hint = HINT[form.key.trim().toUpperCase()];

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});
    if (!companyId) { setError('Select a company in the top bar first.'); return; }
    setBusy(true);
    try {
      const body = { key: form.key.trim().toUpperCase(), account: Number(form.account), company: Number(companyId) };
      if (isNew) await api.accountMappings.create(body); else await api.accountMappings.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? (row.key ? `Map ${row.key}` : 'New mapping') : `Edit ${row.key}`}
      subtitle="Link a system key to a GL account"
      icon="bi-diagram-3"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="mappingForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="mappingForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-link-45deg" aria-hidden="true"></i>Mapping</h6>
        <div className="form-grid">
          <Field label="System key" required err={fieldErr.key} span>
            <input
              className="form-control font-mono"
              list="mapping-keys"
              value={form.key}
              onChange={set('key')}
              placeholder="INVENTORY, AP, AR ..."
              required
              disabled={keyLocked}
            />
            <datalist id="mapping-keys">
              {SUGGESTED_KEYS.map((k) => <option key={k} value={k} />)}
            </datalist>
            {hint && <div className="form-text-hint">Usually points to a {hint} account.</div>}
          </Field>
          <Field label="Account" required err={fieldErr.account} span>
            <select className="form-select" value={form.account} onChange={set('account')} required>
              <option value="">Select account...</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name} ({a.account_type}{a.is_postable ? '' : ', not postable'})
                </option>
              ))}
            </select>
            <div className="form-text-hint">Only postable, active accounts of this company are listed.</div>
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}