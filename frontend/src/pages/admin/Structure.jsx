/**
 * Company structure: branches + departments.
 * - /branches/    crud   (Coded master record, company scoped)
 * - /departments/ crud   (Coded, has optional branch FK)
 * Two tabs; everything scoped to the active legal entity via companyParams().
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const TABS = [
  { key: 'branches', label: 'Branches', icon: 'bi-shop' },
  { key: 'departments', label: 'Departments', icon: 'bi-people' },
];

export default function Structure() {
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [tab, setTab] = useState('branches');
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [b, d] = await Promise.all([
        api.branches.listAll({ ...companyParams() }),
        api.departments.listAll({ ...companyParams() }),
      ]);
      setBranches(b); setDepartments(d);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const remove = async (resource, row) => {
    if (!window.confirm(`Delete ${row.code}?`)) return;
    try { await resource.remove(row.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const source = tab === 'branches' ? branches : departments;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((r) => `${r.code} ${r.name}`.toLowerCase().includes(q));
  }, [source, search]);

  const singular = tab === 'branches' ? 'branch' : 'department';
  const switchTab = (k) => { setTab(k); setSearch(''); };

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-diagram-2"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Structure</h1>
            <p className="page-subtitle">
              Branches and departments{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({ kind: tab, row: {} })}>
            <i className="bi bi-plus-lg"></i>
            New {singular}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      <section className="page-card">
        <div className="tabs" style={{ padding: '0 1rem' }}>
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => switchTab(t.key)}>
              <i className={`bi ${t.icon}`} aria-hidden="true"></i> {t.label}
              <span className="tab__count">{(t.key === 'branches' ? branches : departments).length}</span>
            </button>
          ))}
        </div>

        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder={`Search ${tab} by code or name...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={`Search ${tab}`}
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
            {tab === 'branches' ? 'Branch List' : 'Department List'}
          </span>
          <span className="chart-card__subtitle">
            {rows.length} {singular}{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={6} columns={tab === 'branches' ? 5 : 4} />
        ) : (
          <StructureTable
            kind={tab}
            rows={rows}
            searching={!!search}
            onEdit={(r) => setEditing({ kind: tab, row: r })}
            onDelete={(r) => remove(tab === 'branches' ? api.branches : api.departments, r)}
          />
        )}
      </section>

      {editing && (
        <StructureModal
          kind={editing.kind}
          row={editing.row}
          branches={branches}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

/** Own component so usePagination is called once per table and resets when the tab changes. */
function StructureTable({ kind, rows, searching, onEdit, onDelete }) {
  const { pageRows, paginationProps } = usePagination(rows);
  const isBranch = kind === 'branches';

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className={`bi ${isBranch ? 'bi-shop' : 'bi-people'}`}></i>
        <h6>{searching ? 'Nothing matches your search' : `No ${kind} yet`}</h6>
        <p className="text-muted-soft">
          {searching ? 'Try a different search' : `Click 'New ${isBranch ? 'branch' : 'department'}' to add the first one`}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                {isBranch ? <th>Address</th> : <th>Branch</th>}
                {isBranch && <th>Status</th>}
                <th className="text-center" style={{ width: '7rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-mono text-brand fw-600">{r.code}</td>
                  <td className="cell-name">{r.name}</td>
                  {isBranch ? <td>{r.address || '—'}</td> : <td>{r.branch_label || '—'}</td>}
                  {isBranch && (
                    <td>
                      <span className={`status-pill ${r.is_active ? 'status-pill--success' : 'status-pill--neutral'}`}>
                        {r.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                  )}
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => onEdit(r)}>
                        <i className="bi bi-pencil"></i>
                      </button>
                      <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => onDelete(r)}>
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
      <Pagination {...paginationProps} />
    </>
  );
}

function StructureModal({ kind, row, branches, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const isBranch = kind === 'branches';
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', address: row.address || '',
    branch: row.branch || '', is_active: row.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (isBranch) {
        delete body.branch;
        isNew ? await api.branches.create(body) : await api.branches.update(row.id, body);
      } else {
        delete body.address; delete body.is_active;
        if (!body.branch) delete body.branch;
        isNew ? await api.departments.create(body) : await api.departments.update(row.id, body);
      }
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={`${isNew ? 'New' : 'Edit'} ${isBranch ? 'branch' : 'department'}`}
      subtitle="Company structure"
      icon={isBranch ? 'bi-shop' : 'bi-people'}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="structureForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="structureForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Details</h6>
        <div className="form-grid">
          <Field label="Code" err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} disabled={!isNew}
                   placeholder="Auto-generated if left blank" />
          </Field>
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          {isBranch ? (
            <Field label="Address" span>
              <textarea className="form-control" rows={2} value={form.address} onChange={set('address')} />
            </Field>
          ) : (
            <Field label="Branch" span>
              <select className="form-select" value={form.branch} onChange={set('branch')}>
                <option value="">— none —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </Field>
          )}
          {isBranch && (
            <Field label="Status" span>
              <div className="form-check">
                <input className="form-check-input" type="checkbox" id="branch-active" checked={!!form.is_active} onChange={set('is_active')} />
                <label className="form-check-label" htmlFor="branch-active">Active</label>
              </div>
            </Field>
          )}
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}