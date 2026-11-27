/**
 * Purchase requisitions.
 * - CRUD /purchase-requisitions/
 * - POST /purchase-requisitions/:id/submit/  -> approval workflow
 *
 * Permissions: requisitions.view (page), requisitions.create (new / edit / submit).
 * The server enforces the same permissions; this only shapes the UI.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import ServerPagination from '../../components/ServerPagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED'];

const statusPill = (s) => {
  if (s === 'APPROVED') return 'status-pill--success';
  if (s === 'SUBMITTED') return 'status-pill--warning';
  if (s === 'REJECTED') return 'status-pill--danger';
  return 'status-pill--neutral'; // DRAFT, CONVERTED
};

export default function Requisitions() {
  const { can } = useAccess();
  const { companyParams, activeCompanyObj, companies, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [products, setProducts] = useState([]);

  const canCreate = can('requisitions.create');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.purchaseRequisitions.list({
        ...companyParams(), ordering: '-id', page,
        ...(status ? { status } : {}),
      });
      const list = res?.results || res || [];
      setRows(list);
      setCount(res?.count ?? list.length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status]);
  useEffect(() => { api.products.listAll().then(setProducts).catch(() => {}); }, []);

  const submit = async (r) => {
    try {
      const res = await api.purchaseRequisitions.submit(r.id);
      notify(res.approval_request ? 'Sent for approval.' : 'Auto-approved.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Purchase requisitions</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New requisition
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
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {status && (
            <button className="btn btn-secondary" onClick={() => setStatus('')}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Requisition List
          </span>
          <span className="chart-card__subtitle">
            {count} requisition{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-clipboard-check"></i>
            <h6>{status ? 'No requisitions match this status' : 'No requisitions yet'}</h6>
            <p className="text-muted-soft">
              {status ? 'Try another status' : canCreate ? "Click 'New requisition' to raise the first one" : 'Nothing to show yet'}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Product</th>
                    <th className="text-right">Qty (L)</th>
                    <th>Required by</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '8rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-mono fw-600">{r.reference}</td>
                      <td className="cell-name">{r.product_label || r.product}</td>
                      <td className="cell-num">{Number(r.quantity || 0).toLocaleString()}</td>
                      <td>{r.required_date || '—'}</td>
                      <td className="text-truncate" style={{ maxWidth: 300 }}>{r.reason || '—'}</td>
                      <td><span className={`status-pill ${statusPill(r.status)}`}>{r.status}</span></td>
                      <td>
                        <div className="row-actions">
                          {r.status === 'DRAFT' && canCreate && (
                            <>
                              <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(r)}>
                                <i className="bi bi-pencil"></i>
                              </button>
                              <button className="btn btn-sm btn-primary" onClick={() => submit(r)}>Submit</button>
                            </>
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

        {!loading && rows.length > 0 && <ServerPagination page={page} count={count} onChange={setPage} />}
      </section>

      {editing && (
        <RequisitionModal
          row={editing}
          products={products}
          companies={companies}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Requisition saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function RequisitionModal({ row, products, companies = [], companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    // active company if one is selected, else the user's only company, else they pick one
    company: row.company || companyParams().company || (companies.length === 1 ? String(companies[0].id) : ''),
    product: row.product || '',
    quantity: row.quantity ?? '',
    required_date: row.required_date || '',
    reason: row.reason || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      if (!body.required_date) delete body.required_date;
      isNew ? await api.purchaseRequisitions.create(body) : await api.purchaseRequisitions.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New requisition' : `Edit ${row.reference}`}
      subtitle="Fuel need request"
      icon="bi-clipboard-check"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="requisitionForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="requisitionForm" onSubmit={submit}>
        <div className="form-grid">
          {isNew && companies.length > 1 && (
            <Field label="Legal entity" required err={fieldErr.company}>
              <select className="form-select" value={form.company} onChange={set('company')} required>
                <option value="">—</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Product" required err={fieldErr.product}>
            <select className="form-select" value={form.product} onChange={set('product')} required>
              <option value="">—</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </Field>
          <Field label="Quantity (litres)" required err={fieldErr.quantity}>
            <input type="number" step="0.001" min="0" className="form-control num"
                   value={form.quantity} onChange={set('quantity')} required />
          </Field>
          <Field label="Required by" err={fieldErr.required_date}>
            <input type="date" className="form-control" value={form.required_date} onChange={set('required_date')} />
          </Field>
          <Field label="Reason" span err={fieldErr.reason}>
            <textarea className="form-control" rows={2} value={form.reason} onChange={set('reason')} />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}