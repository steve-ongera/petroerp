/**
 * Payments & receipts.
 * - CRUD /payments/ (PaymentSerializer with allocations)
 * - POST /payments/:id/submit/            (outgoing only; needs approval)
 * - POST /payments/:id/approve/           { comment }      (needs approvals.decide)
 * - POST /payments/:id/post/              { allocations:[{sales_invoice|purchase_invoice|transporter_invoice|expense, amount}] }
 * - POST /payments/:id/apply-advance/     allocate an existing unallocated advance
 * - POST /payments/:id/reverse/           { reason }
 * - GET  /payments/:id/suggest-matches/   M-Pesa/bank receipt → likely invoices
 *
 * Segregation of duties enforced server-side: approver ≠ creator ≠ executor.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const DIRECTIONS = ['RECEIPT', 'PAYMENT'];
const PARTY_TYPES = ['CUSTOMER', 'SUPPLIER', 'TRANSPORTER', 'OTHER'];
const METHODS = ['BANK', 'CASH', 'MPESA'];
const PURPOSES = ['INVOICE', 'ADVANCE', 'BANK_CHARGE', 'OTHER'];
const STATUSES = ['', 'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'POSTED', 'REVERSED', 'REJECTED'];

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const statusCls = (s) => ({
  DRAFT: 'status status-draft',
  AWAITING_APPROVAL: 'status status-pending',
  APPROVED: 'status status-active',
  POSTED: 'status status-posted',
  REVERSED: 'status status-closed',
  REJECTED: 'status status-rejected',
}[s] || 'status status-draft');

export default function Payments() {
  const { can, user } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [posting, setPosting] = useState(null);
  const [suggest, setSuggest] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.payments.list({
        ...companyParams(), ordering: '-id', page,
        ...(status ? { status } : {}),
        ...(direction ? { direction } : {}),
        ...(search ? { search } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, status, direction, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, direction, search]);

  const act = async (p, fn, success) => {
    try { await fn(); notify(success, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Payments</h1>
          <p className="page-header__subtitle">
            Receipts and outgoing payments{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('payments.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New payment
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search reference, M-Pesa…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="">All directions</option>
            {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{count} record{count === 1 ? '' : 's'}</span>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !rows.length && !loading ? (
          <div className="table-empty">
            <div className="table-empty__title">No payments</div>
            <div>Record a receipt or a payment to get started.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>Direction</th><th>Party</th>
                <th className="num">Amount</th><th className="num">Unallocated</th>
                <th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="is-clickable" onClick={() => setEditing(r)}>
                    <td className="mono">{r.reference}</td>
                    <td>{r.payment_date}</td>
                    <td><span className={`badge ${r.direction === 'RECEIPT' ? 'badge--success' : 'badge--info'}`}>{r.direction}</span></td>
                    <td>
                      {r.customer_label || r.supplier_label || r.transporter_label || r.payee || '—'}
                      <span className="cell-sub">{r.party_type}</span>
                    </td>
                    <td className="num">{fmtMoney(r.amount, r.currency)}</td>
                    <td className="num">{fmtMoney(r.unallocated_amount)}</td>
                    <td><span className={statusCls(r.status)}>{r.status.replace('_', ' ')}</span></td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        {r.status === 'DRAFT' && r.direction === 'PAYMENT' && can('payments.edit') && (
                          <button className="btn btn-xs" onClick={() => act(r, () => api.payments.submit(r.id), 'Sent for approval.')}>Submit</button>
                        )}
                        {r.status === 'AWAITING_APPROVAL' && can('approvals.decide') && r.created_by !== user?.id && (
                          <button className="btn btn-xs btn-primary" onClick={() => act(r, () => api.payments.approve(r.id), 'Payment approved.')}>Approve</button>
                        )}
                        {r.status === 'APPROVED' && can('payments.execute') && r.approved_by !== user?.id && (
                          <button className="btn btn-xs btn-primary" onClick={() => setPosting(r)}>Execute</button>
                        )}
                        {r.status === 'DRAFT' && r.direction === 'RECEIPT' && can('payments.edit') && (
                          <button className="btn btn-xs btn-primary" onClick={() => setPosting(r)}>Post</button>
                        )}
                        {r.status === 'POSTED' && r.unallocated_amount > 0 && can('payments.edit') && (
                          <button className="btn btn-xs" onClick={() => setPosting(r)}>Apply</button>
                        )}
                        {r.status === 'POSTED' && can('finance.post') && (
                          <button className="btn btn-xs btn-danger-outline" onClick={() => act(r, () => api.payments.reverse(r.id, ''), 'Payment reversed.')}>Reverse</button>
                        )}
                        {r.direction === 'RECEIPT' && r.status === 'DRAFT' && (
                          <button className="btn btn-xs" onClick={async () => {
                            try { setSuggest(await api.payments.suggestMatches(r.id)); } catch (err) { notify(errorMessage(err), 'error'); }
                          }}>Suggest</button>
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
        <PaymentModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
      {posting && (
        <PostPaymentModal
          payment={posting}
          onClose={() => setPosting(null)}
          onSaved={() => { setPosting(null); notify('Posted.', 'success'); load(); }}
        />
      )}
      {suggest && (
        <SuggestModal data={suggest} onClose={() => setSuggest(null)} />
      )}
    </div>
  );
}

function PaymentModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    direction: row.direction || 'RECEIPT',
    party_type: row.party_type || 'CUSTOMER',
    customer: row.customer || '', supplier: row.supplier || '', transporter: row.transporter || '',
    payee: row.payee || '', method: row.method || 'BANK', bank_account: row.bank_account || '',
    payment_date: row.payment_date || new Date().toISOString().slice(0, 10),
    amount: row.amount ?? '', purpose: row.purpose || 'INVOICE',
    mpesa_reference: row.mpesa_reference || '', bank_reference: row.bank_reference || '',
    narration: row.narration || '',
  });
  const [bankAccounts, setBankAccounts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [transporters, setTransporters] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.bankAccounts.listAll({ ...companyParams() }),
      api.customers.listAll({ ...companyParams() }),
      api.suppliers.listAll({ ...companyParams() }),
      api.transporters.listAll({ ...companyParams() }),
    ]).then(([b, c, s, t]) => { setBankAccounts(b); setCustomers(c); setSuppliers(s); setTransporters(t); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      ['customer', 'supplier', 'transporter'].forEach((k) => { if (!body[k]) delete body[k]; });
      isNew ? await api.payments.create(body) : await api.payments.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New payment' : `Edit ${row.reference}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Direction" required>
                <select className="select" value={form.direction} onChange={set('direction')}>
                  {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Party type" required>
                <select className="select" value={form.party_type} onChange={set('party_type')}>
                  {PARTY_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>

              {form.party_type === 'CUSTOMER' && (
                <Field label="Customer" required>
                  <select className="select" value={form.customer} onChange={set('customer')} required>
                    <option value="">—</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                  </select>
                </Field>
              )}
              {form.party_type === 'SUPPLIER' && (
                <Field label="Supplier" required>
                  <select className="select" value={form.supplier} onChange={set('supplier')} required>
                    <option value="">—</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                  </select>
                </Field>
              )}
              {form.party_type === 'TRANSPORTER' && (
                <Field label="Transporter" required>
                  <select className="select" value={form.transporter} onChange={set('transporter')} required>
                    <option value="">—</option>
                    {transporters.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                  </select>
                </Field>
              )}
              {form.party_type === 'OTHER' && (
                <Field label="Payee"><input className="input" value={form.payee} onChange={set('payee')} /></Field>
              )}

              <Field label="Method" required>
                <select className="select" value={form.method} onChange={set('method')}>
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Bank / cash account" required err={fieldErr.bank_account}>
                <select className="select" value={form.bank_account} onChange={set('bank_account')} required>
                  <option value="">—</option>
                  {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
                </select>
              </Field>
              <Field label="Date" required>
                <input type="date" className="input" value={form.payment_date} onChange={set('payment_date')} required />
              </Field>
              <Field label="Amount" required err={fieldErr.amount}>
                <input type="number" step="0.01" className="input num" value={form.amount} onChange={set('amount')} required />
              </Field>
              <Field label="Purpose">
                <select className="select" value={form.purpose} onChange={set('purpose')}>
                  {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              {form.method === 'MPESA' && (
                <Field label="M-Pesa reference" err={fieldErr.mpesa_reference}>
                  <input className="input mono" value={form.mpesa_reference} onChange={set('mpesa_reference')} />
                </Field>
              )}
              {form.method === 'BANK' && (
                <Field label="Bank reference">
                  <input className="input mono" value={form.bank_reference} onChange={set('bank_reference')} />
                </Field>
              )}
              <Field label="Narration" span>
                <input className="input" value={form.narration} onChange={set('narration')} />
              </Field>
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

function PostPaymentModal({ payment, onClose, onSaved }) {
  const [allocations, setAllocations] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Load the matching open invoices for this party
    const load = async () => {
      try {
        if (payment.direction === 'RECEIPT' && payment.customer) {
          const inv = await api.salesInvoices.listAll({ company: payment.company, customer: payment.customer, status: 'POSTED' });
          setCandidates(inv.map((i) => ({ kind: 'sales_invoice', id: i.id, ref: i.reference, outstanding: i.outstanding })));
        } else if (payment.direction === 'PAYMENT') {
          if (payment.supplier) {
            const inv = await api.purchaseInvoices.listAll({ company: payment.company, supplier: payment.supplier, status: 'POSTED' });
            setCandidates(inv.map((i) => ({ kind: 'purchase_invoice', id: i.id, ref: i.reference, outstanding: i.outstanding })));
          } else if (payment.transporter) {
            const inv = await api.transporterInvoices.listAll({ company: payment.company, transporter: payment.transporter, status: 'POSTED' });
            setCandidates(inv.map((i) => ({ kind: 'transporter_invoice', id: i.id, ref: i.reference, outstanding: i.outstanding })));
          }
        }
      } catch { /* non-fatal */ }
    };
    load();
  }, [payment]);

  const toggle = (c) => {
    setAllocations((as) => {
      const exists = as.find((a) => a.kind === c.kind && a.id === c.id);
      if (exists) return as.filter((a) => a !== exists);
      return [...as, { kind: c.kind, id: c.id, ref: c.ref, amount: c.outstanding }];
    });
  };

  const setAmt = (c, v) => setAllocations((as) => as.map((a) => (a.kind === c.kind && a.id === c.id ? { ...a, amount: v } : a)));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const payload = allocations.map((a) => ({ [a.kind]: a.id, amount: a.amount }));
      await api.payments.post(payment.id, payload);
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Post {payment.reference}</h2>
            <p className="modal__subtitle">Allocate to open invoices (leave blank to hold as advance)</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <p className="text-sm text-muted mb-3">
              Payment amount: <strong>{fmtMoney(payment.amount, payment.currency)}</strong>
              {payment.unallocated_amount > 0 && ` · unallocated ${fmtMoney(payment.unallocated_amount)}`}
            </p>
            {!candidates.length ? (
              <p className="text-muted">No open invoices found for this party.</p>
            ) : (
              <div className="table-wrap">
                <table className="table table--compact">
                  <thead><tr><th /><th>Invoice</th><th className="num">Outstanding</th><th>Allocate</th></tr></thead>
                  <tbody>
                    {candidates.map((c) => {
                      const a = allocations.find((x) => x.kind === c.kind && x.id === c.id);
                      return (
                        <tr key={`${c.kind}-${c.id}`}>
                          <td><input type="checkbox" checked={!!a} onChange={() => toggle(c)} /></td>
                          <td className="mono">{c.ref}</td>
                          <td className="num">{fmtMoney(c.outstanding)}</td>
                          <td>
                            {a && (
                              <input type="number" step="0.01" className="input input-sm num" style={{ width: 140 }}
                                     value={a.amount} onChange={(e) => setAmt(c, e.target.value)} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SuggestModal({ data, onClose }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Suggested matches</h2>
            <p className="modal__subtitle">{data.customer_name || 'No customer identified'}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          {!data.invoices?.length ? (
            <p className="text-muted">No open invoices.</p>
          ) : (
            <div className="rank-list">
              {data.invoices.map((i) => (
                <div key={i.invoice} className="rank-item">
                  <div className="rank-item__main">
                    <div className="rank-item__name mono">{i.reference}</div>
                    {i.exact_match && <span className="badge badge--success">Exact match</span>}
                  </div>
                  <div className="rank-item__value">{fmtMoney(i.outstanding)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
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