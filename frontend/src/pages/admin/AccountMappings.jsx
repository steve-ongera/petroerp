/**
 * Account mappings: system key -> account per legal entity.
 * - CRUD /account-mappings/   (company scoped)
 * - Account drop-down uses /accounts/ filtered to the active company.
 *
 * These keys are what services.acct(company, key) looks up on every posting
 * (INVENTORY, GRNI, AP, AR, VAT_INPUT, VAT_OUTPUT, COGS, ...).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const SUGGESTED_KEYS = [
  'INVENTORY', 'INVENTORY_IN_TRANSIT', 'GRNI', 'AP', 'AR',
  'VAT_INPUT', 'VAT_OUTPUT', 'PURCHASE_VARIANCE', 'STOCK_VARIANCE',
  'SALES_REVENUE', 'SALES_RETURNS', 'COGS', 'FX_GAIN', 'FX_LOSS',
  'RETAINED_EARNINGS', 'OPENING_EQUITY', 'TRANSIT_LOSS',
  'IC_RECEIVABLE', 'IC_PAYABLE', 'IC_REVENUE', 'IC_PURCHASES',
  'SALARIES_EXP', 'PAYROLL_PAYABLE', 'STATUTORY_PAYABLE',
  'DEPRECIATION_EXP', 'ACCUM_DEPRECIATION', 'FIXED_ASSETS', 'DISPOSAL_GAIN_LOSS',
  'FX_UNREALIZED', 'CUSTOMER_ADVANCES', 'SUPPLIER_ADVANCES',
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.key.toLowerCase().includes(q) || (r.account_label || '').toLowerCase().includes(q));
  }, [rows, search]);

  const { pageRows, paginationProps } = usePagination(filtered);

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-diagram-3"></i></span>
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

      <div className="alert alert-info" role="note">
        <i className="bi bi-info-circle" aria-hidden="true"></i>
        <span style={{ flex: 1 }}>
          Every posting looks up its account by key. If a key is not mapped, the server rejects the whole action with
          {' '}<code>Account mapping "KEY" is not configured</code>.
        </span>
      </div>

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
              {search ? 'Try a different search' : 'Add at least INVENTORY, AP, AR, GRNI, VAT_INPUT, VAT_OUTPUT, COGS and SALES_REVENUE to start posting'}
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
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-mono text-brand fw-600">{r.key}</td>
                      <td className="cell-name">
                        {r.account_label || '—'}
                        {r.account_code && <div className="cell-mono text-muted-soft" style={{ fontSize: '0.8rem' }}>{r.account_code}</div>}
                      </td>
                      <td>{r.account_type ? <span className="badge badge-neutral">{r.account_type}</span> : '—'}</td>
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
                  ))}
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
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New mapping' : `Edit ${row.key}`}
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
              disabled={!isNew}
            />
            <datalist id="mapping-keys">
              {SUGGESTED_KEYS.map((k) => <option key={k} value={k} />)}
            </datalist>
          </Field>
          <Field label="Account" required err={fieldErr.account} span>
            <select className="form-select" value={form.account} onChange={set('account')} required>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name} ({a.account_type}{a.is_postable ? '' : ' – not postable'})
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}