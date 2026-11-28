/**
 * Customer contracts.
 * - CRUD /customer-contracts/ (withStatus: DRAFT / ACTIVE / EXPIRED / CANCELLED)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'];
const PRICING = ['FIXED', 'MARKET', 'COST_PLUS'];
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
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [c, cu, p, cc] = await Promise.all([
        api.customerContracts.listAll({ ...companyParams(), ordering: '-id' }),
        api.customers.listAll({ ...companyParams() }),
        api.products.listAll(),
        api.currencies.listAll(),
      ]);
      setAllRows(c); setCustomers(cu); setProducts(p); setCurrencies(cc);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const setStatusFor = async (c, next) => {
    try { await api.customerContracts.setStatus(c.id, next); notify(`Status: ${next}`, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  // listAll returns everything, so search/status filtering is client-side.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (status && r.status !== status) return false;
      if (!q) return true;
      return [r.reference, r.customer_label, r.customer, r.product_label, r.product]
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
            <h1 className="page-title">Customer contracts</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('sales.edit') && (
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
              placeholder="Search by reference, customer or product..."
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
                    <th>Customer</th>
                    <th>Product</th>
                    <th>Pricing</th>
                    <th className="text-right">Price / L</th>
                    <th>Valid from</th>
                    <th>Valid to</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '11rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-mono text-brand fw-600">{r.reference}</td>
                      <td className="cell-name">{r.customer_label || r.customer}</td>
                      <td>{r.product_label || r.product}</td>
                      <td><span className="badge badge-neutral">{r.pricing_method.replace('_', ' ')}</span></td>
                      <td className="cell-num">{Number(r.price_per_litre || 0).toFixed(6)}</td>
                      <td>{r.valid_from}</td>
                      <td>{r.valid_to || '—'}</td>
                      <td><span className={`status-pill ${statusPill(r.status)}`}>{r.status}</span></td>
                      <td>
                        {can('sales.edit') && (
                          <div className="row-actions">
                            <select
                              className="form-select form-select-sm"
                              value={r.status}
                              onChange={(e) => setStatusFor(r, e.target.value)}
                              aria-label="Change status"
                            >
                              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(r)}>
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
          customers={customers}
          products={products}
          currencies={currencies}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function ContractModal({ row, customers, products, currencies, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    customer: row.customer || '', product: row.product || '',
    pricing_method: row.pricing_method || 'FIXED', price_per_litre: row.price_per_litre ?? '',
    currency: row.currency || '', contract_quantity: row.contract_quantity ?? '',
    valid_from: row.valid_from || todayISO(), valid_to: row.valid_to || '',
    delivery_terms: row.delivery_terms || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.valid_to) body.valid_to = null;
      isNew ? await api.customerContracts.create(body) : await api.customerContracts.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New contract' : `Edit ${row.reference}`}
      subtitle="Customer contracts"
      icon="bi-file-earmark-text"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="contractForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="contractForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Contract Details</h6>
        <div className="form-grid">
          <Field label="Customer" required err={fieldErr.customer}>
            <select className="form-select" value={form.customer} onChange={set('customer')} required>
              <option value="">—</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Product" required err={fieldErr.product}>
            <select className="form-select" value={form.product} onChange={set('product')} required>
              <option value="">—</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </Field>
          <Field label="Contract quantity">
            <input type="number" step="0.001" className="form-control num" value={form.contract_quantity} onChange={set('contract_quantity')} />
          </Field>
          <Field label="Valid from" required err={fieldErr.valid_from}>
            <input type="date" className="form-control" value={form.valid_from} onChange={set('valid_from')} required />
          </Field>
          <Field label="Valid to">
            <input type="date" className="form-control" value={form.valid_to} onChange={set('valid_to')} />
          </Field>
          <Field label="Delivery terms" span>
            <input className="form-control" value={form.delivery_terms} onChange={set('delivery_terms')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-cash-coin" aria-hidden="true"></i>Pricing</h6>
        <div className="form-grid">
          <Field label="Pricing method">
            <select className="form-select" value={form.pricing_method} onChange={set('pricing_method')}>
              {PRICING.map((p) => <option key={p} value={p}>{p.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Price per litre" err={fieldErr.price_per_litre}>
            <input type="number" step="0.000001" className="form-control num" value={form.price_per_litre} onChange={set('price_per_litre')} />
          </Field>
          <Field label="Currency">
            <select className="form-select" value={form.currency} onChange={set('currency')}>
              <option value="">—</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}