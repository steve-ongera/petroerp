/**
 * Expenses.
 * - CRUD /expenses/ (withSubmit)         → ExpenseSerializer (total, outstanding computed)
 * - POST /expenses/:id/submit/           → request approval / auto-approve below policy
 * - POST /expenses/:id/post/             → svc.post_expense (journal + optional direct allocation)
 * - POST /expenses/:id/allocate/         → svc.allocate_expense (DIRECT/PERCENT/AMOUNT/LITRES/EQUAL)
 *
 * Expense.duplicate_key is set server-side; posting is rejected if status != APPROVED.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const PAY_METHODS = ['CREDIT', 'CASH', 'BANK', 'MPESA'];
const STATUS = ['', 'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'POSTED', 'PAID', 'REJECTED'];

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const statusCls = (s) => {
  const m = {
    DRAFT: 'status status-draft',
    AWAITING_APPROVAL: 'status status-pending',
    APPROVED: 'status status-active',
    POSTED: 'status status-posted',
    PAID: 'status status-paid',
    REJECTED: 'status status-rejected',
  };
  return m[s] || 'status status-draft';
};

export default function Expenses() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [cats, setCats] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
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
        ...(status ? { status } : {}), ...(search ? { search } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, status, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, search]);

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

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Expenses</h1>
          <p className="page-header__subtitle">
            Operating costs, shipment costs and payments{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('expenses.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New expense
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search description, payee…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{count} expense{count === 1 ? '' : 's'}</span>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !rows.length && !loading ? (
          <div className="table-empty">
            <div className="table-empty__title">No expenses</div>
            <div>Create the first expense.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>Category</th><th>Description</th>
                <th className="num">Total</th><th className="num">Outstanding</th>
                <th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="is-clickable" onClick={() => setEditing(r)}>
                    <td className="mono">{r.reference}</td>
                    <td>{r.expense_date}</td>
                    <td>{r.category_label || r.category}</td>
                    <td className="text-truncate" style={{ maxWidth: 240 }}>{r.description}</td>
                    <td className="num">{fmtMoney(r.total, r.currency)}</td>
                    <td className="num">{fmtMoney(r.outstanding)}</td>
                    <td><span className={statusCls(r.status)}>{r.status.replace('_', ' ')}</span></td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        {r.status === 'DRAFT' && can('expenses.edit') && (
                          <button className="btn btn-xs" onClick={() => submit(r)}>Submit</button>
                        )}
                        {r.status === 'APPROVED' && can('expenses.edit') && (
                          <button className="btn btn-xs btn-primary" onClick={() => post(r)}>Post</button>
                        )}
                        {(r.status === 'POSTED' || r.status === 'PAID') && r.category && can('costing.edit') && (
                          <button className="btn btn-xs" onClick={() => setAllocating(r)}>Allocate</button>
                        )}
                        {['DRAFT', 'AWAITING_APPROVAL'].includes(r.status) && can('expenses.edit') && (
                          <button className="row-action" title="Edit" onClick={() => setEditing(r)}><i className="bi bi-pencil" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} count={count} onChange={setPage} />
      </div>

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

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      ['supplier', 'bank_account', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
      isNew ? await api.expenses.create(body) : await api.expenses.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New expense' : `Edit ${row.reference}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Date" required>
                <input type="date" className="input" value={form.expense_date} onChange={set('expense_date')} required />
              </Field>
              <Field label="Category" required err={fieldErr.category}>
                <select className="select" value={form.category} onChange={set('category')} required>
                  <option value="">—</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Description" required err={fieldErr.description} span>
                <input className="input" value={form.description} onChange={set('description')} required />
              </Field>
              <Field label="Supplier">
                <select className="select" value={form.supplier} onChange={set('supplier')}>
                  <option value="">— none —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                </select>
              </Field>
              <Field label="Payee"><input className="input" value={form.payee} onChange={set('payee')} /></Field>
              <Field label="Net amount" required err={fieldErr.amount}>
                <input type="number" step="0.01" className="input num" value={form.amount} onChange={set('amount')} required />
              </Field>
              <Field label="Tax amount">
                <input type="number" step="0.01" className="input num" value={form.tax_amount} onChange={set('tax_amount')} />
              </Field>
              <Field label="Currency">
                <select className="select" value={form.currency} onChange={set('currency')}>
                  <option value="">Functional</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Payment method">
                <select className="select" value={form.payment_method} onChange={set('payment_method')}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              {form.payment_method !== 'CREDIT' && (
                <Field label="Bank / cash account" required err={fieldErr.bank_account}>
                  <select className="select" value={form.bank_account} onChange={set('bank_account')} required>
                    <option value="">—</option>
                    {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Receipt #"><input className="input" value={form.receipt_no} onChange={set('receipt_no')} /></Field>
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
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Allocate {expense.reference}</h2>
            <p className="modal__subtitle">Distribute the net cost across shipments</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Method">
                <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {['DIRECT', 'PERCENT', 'AMOUNT', 'LITRES', 'EQUAL'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Replace existing">
                <label className="check">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                  Re-allocate if already allocated
                </label>
              </Field>
            </div>
            <hr className="divider" />
            <div className="stack-sm">
              {targets.map((t, i) => (
                <div key={i} className="d-flex items-end gap-2">
                  <div className="field flex-1">
                    <label className="label">Shipment</label>
                    <select className="select" value={t.shipment} onChange={(e) => setTarget(i, 'shipment', e.target.value)} required>
                      <option value="">—</option>
                      {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference} · {s.product_label || ''}</option>)}
                    </select>
                  </div>
                  {method === 'PERCENT' && (
                    <div className="field" style={{ width: 140 }}>
                      <label className="label">Percent %</label>
                      <input type="number" step="0.001" className="input num" value={t.percentage} onChange={(e) => setTarget(i, 'percentage', e.target.value)} />
                    </div>
                  )}
                  {method === 'AMOUNT' && (
                    <div className="field" style={{ width: 160 }}>
                      <label className="label">Amount</label>
                      <input type="number" step="0.01" className="input num" value={t.amount} onChange={(e) => setTarget(i, 'amount', e.target.value)} />
                    </div>
                  )}
                  {['PERCENT', 'AMOUNT', 'EQUAL', 'LITRES'].includes(method) && targets.length > 1 && (
                    <button type="button" className="btn btn-xs" onClick={() => removeTarget(i)}>Remove</button>
                  )}
                </div>
              ))}
              {method !== 'DIRECT' && (
                <button type="button" className="btn btn-sm" onClick={addTarget}>+ Add shipment</button>
              )}
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Allocating…' : 'Allocate'}</button>
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

function Pagination({ page, count, onChange, size = 25 }) {
  const pages = Math.max(1, Math.ceil((count || 0) / size));
  if (count <= size) return null;
  return (
    <div className="pagination pagination--bordered">
      <span className="pagination__info">Page <strong>{page}</strong> of <strong>{pages}</strong> · {count} items</span>
      <div className="pagination__list">
        <button className="pagination__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <button className="pagination__btn active">{page}</button>
        <button className="pagination__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}