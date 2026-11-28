/**
 * Supplier contracts.
 * - CRUD /supplier-contracts/  (withStatus: status changed via setStatus)
 * - Allowed statuses: DRAFT, ACTIVE, EXPIRED, CANCELLED
 *
 * NOTE: this is the procurement "Contracts.jsx" (the sales one is for customers).
 * Saved here as SupplierContracts.jsx to avoid a name clash · rename to match your folder.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const statusPill = (s) => {
  if (s === 'ACTIVE') return 'status-pill--success';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral'; // DRAFT, EXPIRED
};

export default function Contracts() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [allRows, setAllRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [c, s, p] = await Promise.all([
        api.supplierContracts.listAll({ ...companyParams(), ordering: '-id' }),
        api.suppliers.listAll({ ...companyParams() }),
        api.products.listAll(),
      ]);
      setAllRows(c); setSuppliers(s); setProducts(p);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const setStatusFor = async (c, next) => {
    try { await api.supplierContracts.setStatus(c.id, next); notify(`Status: ${next}`, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  // listAll returns everything, so search/status filtering is client-side.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((c) => {
      if (status && c.status !== status) return false;
      if (!q) return true;
      return [c.reference, c.supplier_label, c.supplier, c.product_label, c.price_basis]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [allRows, search, status]);

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Supplier contracts</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('suppliers.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New contract
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
              placeholder="Search by reference, supplier or product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search contracts"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
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
            {status && (
              <span className="filter-chip">
                Status: {status}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Contract List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} contract{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-file-earmark-text"></i>
            <h6>{hasActiveFilters ? 'No contracts match your search' : 'No contracts yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New contract' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Supplier</th>
                    <th>Product</th>
                    <th>Start</th>
                    <th>End</th>
                    <th className="text-right">Max qty</th>
                    <th>Price basis</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '11rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => (
                    <tr key={c.id}>
                      <td className="cell-mono text-brand fw-600">{c.reference}</td>
                      <td className="cell-name">{c.supplier_label || c.supplier}</td>
                      <td>{c.product_label || '—'}</td>
                      <td>{c.start_date}</td>
                      <td>{c.end_date || '—'}</td>
                      <td className="cell-num">{Number(c.max_quantity || 0).toLocaleString()}</td>
                      <td>{c.price_basis || '—'}</td>
                      <td><span className={`status-pill ${statusPill(c.status)}`}>{c.status}</span></td>
                      <td>
                        {can('suppliers.edit') && (
                          <div className="row-actions">
                            <select
                              className="form-select form-select-sm"
                              value={c.status}
                              onChange={(e) => setStatusFor(c, e.target.value)}
                              aria-label="Change status"
                            >
                              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(c)}>
                              <i className="bi bi-pencil"></i>
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
        <ContractModal
          row={editing}
          suppliers={suppliers}
          products={products}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function ContractModal({ row, suppliers, products, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    supplier: row.supplier || '', product: row.product || '',
    start_date: row.start_date || todayISO(), end_date: row.end_date || '',
    price_basis: row.price_basis || '', max_quantity: row.max_quantity ?? '',
    terms: row.terms || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.product) delete body.product;
      if (!body.end_date) body.end_date = null;
      isNew ? await api.supplierContracts.create(body) : await api.supplierContracts.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New contract' : `Edit ${row.reference}`}
      subtitle="Supplier contracts"
      icon="bi-file-earmark-text"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="supplierContractForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="supplierContractForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Contract Details</h6>
        <div className="form-grid">
          <Field label="Supplier" required err={fieldErr.supplier}>
            <select className="form-select" value={form.supplier} onChange={set('supplier')} required>
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </Field>
          <Field label="Product">
            <select className="form-select" value={form.product} onChange={set('product')}>
              <option value="">—</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </Field>
          <Field label="Start date" required err={fieldErr.start_date}>
            <input type="date" className="form-control" value={form.start_date} onChange={set('start_date')} required />
          </Field>
          <Field label="End date">
            <input type="date" className="form-control" value={form.end_date} onChange={set('end_date')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-cash-coin" aria-hidden="true"></i>Pricing & Terms</h6>
        <div className="form-grid">
          <Field label="Max quantity">
            <input type="number" step="0.001" className="form-control num" value={form.max_quantity} onChange={set('max_quantity')} />
          </Field>
          <Field label="Price basis">
            <input className="form-control" value={form.price_basis} onChange={set('price_basis')} placeholder="e.g. CBK + 2%" />
          </Field>
          <Field label="Terms" span>
            <textarea className="form-control" rows={2} value={form.terms} onChange={set('terms')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}