/**
 * Expenses.
 * - CRUD /expenses/ (withSubmit)         ? ExpenseSerializer (total, outstanding computed)
 * - POST /expenses/:id/submit/           ? request approval / auto-approve below policy
 * - POST /expenses/:id/post/             ? svc.post_expense (journal + optional direct allocation)
 * - POST /expenses/:id/allocate/         ? svc.allocate_expense (DIRECT/PERCENT/AMOUNT/LITRES/EQUAL)
 *
 * Expense.duplicate_key is set server-side; posting is rejected if status != APPROVED.
 * Paging is server-side (25 per page).
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import ServerPager from '../../components/ServerPager';
import TableSkeleton from '../../components/TableSkeleton';

const PAY_METHODS = ['CREDIT', 'CASH', 'BANK', 'MPESA'];
const STATUSES = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'POSTED', 'PAID', 'REJECTED'];
const PAGE_SIZE = 25;

const PILL = {
  DRAFT: 'status-pill--neutral',
  AWAITING_APPROVAL: 'status-pill--warning',
  APPROVED: 'status-pill--success',
  POSTED: 'status-pill--success',
  PAID: 'status-pill--success',
  REJECTED: 'status-pill--danger',
};
const pill = (s) => `status-pill ${PILL[s] || 'status-pill--neutral'}`;

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function Expenses() {
  const { can } = useAccess();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [cats, setCats] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [editing, setEditing] = useState(null);
  const [allocating, setAllocating] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.expenses.list({
        ...companyParams(), ordering: '-id', page,
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(search ? { search } : {}),
      });
      const items = res?.results || res || [];
      setRows(items);
      setCount(res?.count ?? items.length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, status, category, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, category, search]);

  useEffect(() => {
    Promise.all([
      api.expenseCategories.listAll(),
      api.suppliers.listAll({ ...companyParams() }),
      api.bankAccounts.listAll({ ...companyParams() }),
      api.currencies.listAll(),
    ]).then(([c, s, b, cur]) => { setCats(c); setSuppliers(s); setBankAccounts(b); setCurrencies(cur); }).catch(() => {});
  }, [companyParams]);

  const post = async (e) => {
    if (!window.confirm(`Post expense ${e.reference}?`)) return;
    try { await api.expenses.post(e.id); notify('Expense posted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const submit = async (e) => {
    try {
      const res = await api.expenses.submit(e.id);
      notify(res.approval_request ? 'Sent for approval.' : 'Auto-approved.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status || category);
  const clearFilters = () => { setSearch(''); setStatus(''); setCategory(''); };
  const catName = (id) => cats.find((c) => String(c.id) === String(id))?.name || id;

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Expenses</h1>
            <p className="page-subtitle">
              Operating costs, shipment costs and payments{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('expenses.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New expense
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
              placeholder="Search reference or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search expenses"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
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
            {category && <span className="filter-chip">Category: {catName(category)}<button onClick={() => setCategory('')}><i className="bi bi-x"></i></button></span>}
            {status && <span className="filter-chip">Status: {status.replace(/_/g, ' ')}<button onClick={() => setStatus('')}><i className="bi bi-x"></i></button></span>}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Expense List
          </span>
          <span className="chart-card__subtitle">{count} expense{count !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-receipt"></i>
            <h6>{hasActiveFilters ? 'No expenses match your filters' : 'No expenses yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New expense' to create the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Outstanding</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(r)}>
                      <td className="cell-mono text-brand fw-600">{r.reference}</td>
                      <td>{r.expense_date}</td>
                      <td>{r.category_label || r.category}</td>
                      <td className="cell-name" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                      <td className="cell-num">{fmtMoney(r.total, r.currency)}</td>
                      <td className="cell-num">{fmtMoney(r.outstanding)}</td>
                      <td><span className={pill(r.status)}>{r.status.replace(/_/g, ' ')}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          {r.status === 'DRAFT' && can('expenses.edit') && (
                            <button className="btn btn-sm btn-secondary" onClick={() => submit(r)}>Submit</button>
                          )}
                          {r.status === 'APPROVED' && can('expenses.edit') && (
                            <button className="btn btn-sm btn-primary" onClick={() => post(r)}>Post</button>
                          )}
                          {['POSTED', 'PAID'].includes(r.status) && can('costing.edit') && (
                            <button className="btn btn-sm btn-secondary" onClick={() => setAllocating(r)}>Allocate</button>
                          )}
                          {['DRAFT', 'AWAITING_APPROVAL'].includes(r.status) && can('expenses.edit') && (
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(r)}>
                              <i className="bi bi-pencil"></i>
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

        {!loading && <ServerPager page={page} count={count} onChange={setPage} size={PAGE_SIZE} />}
      </section>

      {editing && (
        <ExpenseModal
          row={editing}
          cats={cats} suppliers={suppliers} bankAccounts={bankAccounts} currencies={currencies}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Expense saved.', 'success'); load(); }}
        />
      )}
      {allocating && (
        <AllocateModal
          expense={allocating}
          companyParams={companyParams}
          onClose={() => setAllocating(null)}
          onSaved={() => { setAllocating(null); notify('Allocated.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function ExpenseModal({ row, cats, suppliers, bankAccounts, currencies, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    expense_date: row.expense_date || new Date().toISOString().slice(0, 10),
    category: row.category || '', description: row.description || '',
    supplier: row.supplier || '', payee: row.payee || '',
    amount: row.amount ?? '', tax_amount: row.tax_amount ?? '',
    currency: row.currency || '', payment_method: row.payment_method || 'CREDIT',
    bank_account: row.bank_account || '', receipt_no: row.receipt_no || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const locked = !isNew && !['DRAFT', 'AWAITING_APPROVAL'].includes(row.status);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      ['supplier', 'bank_account', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
      if (body.tax_amount === '') body.tax_amount = 0;
      isNew ? await api.expenses.create(body) : await api.expenses.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New expense' : `${locked ? 'View' : 'Edit'} ${row.reference}`}
      subtitle="Operating or shipment cost"
      icon="bi-receipt"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>{locked ? 'Close' : 'Cancel'}</button>
          {!locked && (
            <button className="btn btn-primary" type="submit" form="expenseForm" disabled={busy}>
              <i className="bi bi-save"></i>
              {busy ? 'Saving...' : 'Save'}
            </button>
          )}
        </>
      }
    >
      <form id="expenseForm" onSubmit={submit}>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Expense Details</h6>
          <div className="form-grid">
            <Field label="Date" required err={fieldErr.expense_date}>
              <input type="date" className="form-control" value={form.expense_date} onChange={set('expense_date')} required />
            </Field>
            <Field label="Category" required err={fieldErr.category}>
              <select className="form-select" value={form.category} onChange={set('category')} required>
                <option value="">—</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
            <Field label="Description" required err={fieldErr.description} span>
              <input className="form-control" value={form.description} onChange={set('description')} required />
            </Field>
            <Field label="Supplier">
              <select className="form-select" value={form.supplier} onChange={set('supplier')}>
                <option value="">� none �</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </select>
            </Field>
            <Field label="Payee">
              <input className="form-control" value={form.payee} onChange={set('payee')} />
            </Field>
            <Field label="Receipt #">
              <input className="form-control" value={form.receipt_no} onChange={set('receipt_no')} />
            </Field>
          </div>

          <h6 className="modal-section-title"><i className="bi bi-cash-coin" aria-hidden="true"></i>Amount & Payment</h6>
          <div className="form-grid">
            <Field label="Net amount" required err={fieldErr.amount}>
              <input type="number" step="0.01" className="form-control num" value={form.amount} onChange={set('amount')} required />
            </Field>
            <Field label="Tax amount" err={fieldErr.tax_amount}>
              <input type="number" step="0.01" className="form-control num" value={form.tax_amount} onChange={set('tax_amount')} />
            </Field>
            <Field label="Currency">
              <select className="form-select" value={form.currency} onChange={set('currency')}>
                <option value="">Functional</option>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </Field>
            <Field label="Payment method">
              <select className="form-select" value={form.payment_method} onChange={set('payment_method')}>
                {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            {form.payment_method !== 'CREDIT' && (
              <Field label="Bank / cash account" required err={fieldErr.bank_account} span>
                <select className="form-select" value={form.bank_account} onChange={set('bank_account')} required>
                  <option value="">—</option>
                  {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
                </select>
              </Field>
            )}
          </div>
        </fieldset>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function AllocateModal({ expense, companyParams, onClose, onSaved }) {
  const [method, setMethod] = useState('DIRECT');
  const [targets, setTargets] = useState([{ shipment: '', percentage: '', amount: '' }]);
  const [shipments, setShipments] = useState([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.shipments.listAll({ ...companyParams(), ordering: '-id' }).then(setShipments).catch(() => {});
  }, [companyParams]);

  const setTarget = (i, k, v) => setTargets((ts) => ts.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const addTarget = () => setTargets((ts) => [...ts, { shipment: '', percentage: '', amount: '' }]);
  const removeTarget = (i) => setTargets((ts) => ts.filter((_, j) => j !== i));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const clean = targets.filter((t) => t.shipment).map((t) => ({
        shipment: t.shipment,
        ...(method === 'PERCENT' ? { percentage: t.percentage } : {}),
        ...(method === 'AMOUNT' ? { amount: t.amount } : {}),
      }));
      await api.expenses.allocate(expense.id, { method, targets: clean, replace });
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={`Allocate ${expense.reference}`}
      subtitle="Distribute the net cost across shipments"
      icon="bi-diagram-3"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="allocateForm" disabled={busy}>
            <i className="bi bi-check2-circle"></i>
            {busy ? 'Allocating...' : 'Allocate'}
          </button>
        </>
      }
    >
      <form id="allocateForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-sliders" aria-hidden="true"></i>Method</h6>
        <div className="form-grid">
          <Field label="Method">
            <select className="form-select" value={method} onChange={(e) => setMethod(e.target.value)}>
              {['DIRECT', 'PERCENT', 'AMOUNT', 'LITRES', 'EQUAL'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Re-allocation">
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="alloc-replace" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              <label className="form-check-label" htmlFor="alloc-replace">Replace existing allocation</label>
            </div>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-truck" aria-hidden="true"></i>Shipments</h6>
        <div>
          {targets.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Shipment</label>
                <select className="form-select" value={t.shipment} onChange={(e) => setTarget(i, 'shipment', e.target.value)} required>
                  <option value="">—</option>
                  {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference} · {s.product_label || ''}</option>)}
                </select>
              </div>
              {method === 'PERCENT' && (
                <div style={{ width: 140 }}>
                  <label className="form-label">Percent %</label>
                  <input type="number" step="0.001" className="form-control num" value={t.percentage} onChange={(e) => setTarget(i, 'percentage', e.target.value)} />
                </div>
              )}
              {method === 'AMOUNT' && (
                <div style={{ width: 160 }}>
                  <label className="form-label">Amount</label>
                  <input type="number" step="0.01" className="form-control num" value={t.amount} onChange={(e) => setTarget(i, 'amount', e.target.value)} />
                </div>
              )}
              {method !== 'DIRECT' && targets.length > 1 && (
                <button type="button" className="btn btn-icon" aria-label="Remove shipment" onClick={() => removeTarget(i)}>
                  <i className="bi bi-x-lg"></i>
                </button>
              )}
            </div>
          ))}
          {method !== 'DIRECT' && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={addTarget}>
              <i className="bi bi-plus-lg"></i> Add shipment
            </button>
          )}
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}