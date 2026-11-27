/**
 * Chart of accounts (per legal entity).
 * - CRUD /accounts/   (company scoped)
 * Fields: code, name, account_type, subtype, group_code, parent, is_postable, is_intercompany, is_active
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const SUBTYPES = ['CASH', 'BANK', 'MPESA', 'PETTY', 'AR', 'AP', 'INVENTORY', 'TRANSIT', 'COGS', 'OPEX', 'IC_RECEIVABLE', 'IC_PAYABLE'];

export default function Accounts() {
  const { can } = useAccess();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null);

  const canEdit = can('finance.edit');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.accounts.list({
        ...companyParams(), ordering: 'code', page_size: 1000,
        ...(type ? { account_type: type } : {}),
        ...(search ? { search } : {}),
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, type, search]);

  useEffect(() => { load(); }, [load]);

  const remove = async (a) => {
    if (!window.confirm(`Delete account ${a.code}?`)) return;
    try { await api.accounts.remove(a.id); notify('Account deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || type);
  const clearFilters = () => { setSearch(''); setType(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Chart of accounts</h1>
            <p className="page-subtitle">
              {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {rows.length} account{rows.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New account
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
              placeholder="Search by code, name or group..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search accounts"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Account type">
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
            {search && <span className="filter-chip">Search: "{search}"<button onClick={() => setSearch('')}><i className="bi bi-x"></i></button></span>}
            {type && <span className="filter-chip">Type: {type}<button onClick={() => setType('')}><i className="bi bi-x"></i></button></span>}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Account List
          </span>
          <span className="chart-card__subtitle">{rows.length} account{rows.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <TableSkeleton rows={10} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-list-nested"></i>
            <h6>{hasActiveFilters ? 'No accounts match your search' : 'No accounts yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New account' to start your chart of accounts"}
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
                    <th>Subtype</th>
                    <th>Group</th>
                    <th>Postable</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((a) => (
                    <tr key={a.id}>
                      <td className="cell-mono text-brand fw-600">{a.code}</td>
                      <td className="cell-name">{a.name}</td>
                      <td><span className="badge badge-neutral">{a.account_type}</span></td>
                      <td>{a.subtype || '—'}</td>
                      <td className="cell-mono">{a.group_code || '—'}</td>
                      <td>
                        <span className={`status-pill ${a.is_postable ? 'status-pill--success' : 'status-pill--neutral'}`}>
                          {a.is_postable ? 'YES' : 'NO'}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill ${a.is_active ? 'status-pill--success' : 'status-pill--neutral'}`}>
                          {a.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </td>
                      <td>
                        {canEdit && (
                          <div className="row-actions">
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(a)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(a)}>
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
        <AccountModal
          row={editing}
          accounts={rows}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Account saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function AccountModal({ row, accounts, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '',
    account_type: row.account_type || 'ASSET', subtype: row.subtype || '',
    group_code: row.group_code || '', parent: row.parent || '',
    is_postable: row.is_postable ?? true, is_intercompany: row.is_intercompany ?? false,
    is_active: row.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.parent) body.parent = null;
      isNew ? await api.accounts.create(body) : await api.accounts.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  const parents = accounts.filter((a) => !row.id || a.id !== row.id);

  const check = (key, id, label) => (
    <div className="form-check">
      <input className="form-check-input" type="checkbox" id={id} checked={!!form[key]} onChange={set(key)} />
      <label className="form-check-label" htmlFor={id}>{label}</label>
    </div>
  );

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New account' : `Edit ${row.code}`}
      subtitle="Chart of accounts"
      icon="bi-list-nested"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="accountForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="accountForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Account Details</h6>
        <div className="form-grid">
          <Field label="Code" required err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} required disabled={!isNew} />
          </Field>
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Type" required>
            <select className="form-select" value={form.account_type} onChange={set('account_type')}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Subtype">
            <input className="form-control" list="account-subtypes" value={form.subtype} onChange={set('subtype')} />
            <datalist id="account-subtypes">{SUBTYPES.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Group code">
            <input className="form-control font-mono" value={form.group_code} onChange={set('group_code')} placeholder="Consolidated chart" />
          </Field>
          <Field label="Parent account">
            <select className="form-select" value={form.parent || ''} onChange={set('parent')}>
              <option value="">— none —</option>
              {parents.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-toggles" aria-hidden="true"></i>Behaviour</h6>
        <div className="form-grid">
          <Field label="Postable">{check('is_postable', 'acc-postable', 'Can be posted to')}</Field>
          <Field label="Intercompany">{check('is_intercompany', 'acc-ic', 'Intercompany account')}</Field>
          <Field label="Status" span>{check('is_active', 'acc-active', 'Active')}</Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}