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

const DIRECTIONS = ['RECEIPT', 'PAYMENT'];
const PARTY_TYPES = ['CUSTOMER', 'SUPPLIER', 'TRANSPORTER', 'OTHER'];
const METHODS = ['BANK', 'CASH', 'MPESA'];
const PURPOSES = ['INVOICE', 'ADVANCE', 'BANK_CHARGE', 'OTHER'];
const STATUSES = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'POSTED', 'REVERSED', 'REJECTED'];
const PAGE_SIZE = 25;

const PILL = {
  DRAFT: 'status-pill--neutral',
  AWAITING_APPROVAL: 'status-pill--warning',
  APPROVED: 'status-pill--success',
  POSTED: 'status-pill--success',
  REVERSED: 'status-pill--neutral',
  REJECTED: 'status-pill--danger',
};
const pill = (s) => `status-pill ${PILL[s] || 'status-pill--neutral'}`;

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function Payments() {
  const { can, user } = useAccess();
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
      const items = res?.results || res || [];
      setRows(items);
      setCount(res?.count ?? items.length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, status, direction, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, direction, search]);

  const act = async (fn, success) => {
    try { await fn(); notify(success, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status || direction);
  const clearFilters = () => { setSearch(''); setStatus(''); setDirection(''); };

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-cash-coin"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Payments</h1>
            <p className="page-subtitle">
              Receipts and outgoing payments{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('payments.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New payment
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
              placeholder="Search reference, M-Pesa code, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search payments"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction">
            <option value="">All directions</option>
            {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
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
            {search && (
              <span className="filter-chip">Search: "{search}"<button onClick={() => setSearch('')}><i className="bi bi-x"></i></button></span>
            )}
            {direction && (
              <span className="filter-chip">Direction: {direction}<button onClick={() => setDirection('')}><i className="bi bi-x"></i></button></span>
            )}
            {status && (
              <span className="filter-chip">Status: {status.replace(/_/g, ' ')}<button onClick={() => setStatus('')}><i className="bi bi-x"></i></button></span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Payment List
          </span>
          <span className="chart-card__subtitle">{count} record{count !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-cash-coin"></i>
            <h6>{hasActiveFilters ? 'No payments match your filters' : 'No payments yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New payment' to record a receipt or a payment"}
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
                    <th>Direction</th>
                    <th>Party</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Unallocated</th>
                    <th>Status</th>
                    <th className="text-center" style={{ minWidth: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(r)}>
                      <td className="cell-mono text-brand fw-600">{r.reference}</td>
                      <td>{r.payment_date}</td>
                      <td>
                        <span className={`status-pill ${r.direction === 'RECEIPT' ? 'status-pill--success' : 'status-pill--neutral'}`}>
                          {r.direction}
                        </span>
                      </td>
                      <td className="cell-name">
                        {r.customer_label || r.supplier_label || r.transporter_label || r.payee || '—'}
                        <div className="text-muted-soft" style={{ fontSize: '0.8rem' }}>{r.party_type}</div>
                      </td>
                      <td className="cell-num">{fmtMoney(r.amount, r.currency)}</td>
                      <td className="cell-num">{fmtMoney(r.unallocated_amount)}</td>
                      <td><span className={pill(r.status)}>{r.status.replace(/_/g, ' ')}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
                          {r.status === 'DRAFT' && r.direction === 'PAYMENT' && can('payments.edit') && (
                            <button className="btn btn-sm btn-secondary" onClick={() => act(() => api.payments.submit(r.id), 'Sent for approval.')}>Submit</button>
                          )}
                          {r.status === 'AWAITING_APPROVAL' && can('approvals.decide') && r.created_by !== user?.id && (
                            <button className="btn btn-sm btn-primary" onClick={() => act(() => api.payments.approve(r.id), 'Payment approved.')}>Approve</button>
                          )}
                          {r.status === 'APPROVED' && can('payments.execute') && r.approved_by !== user?.id && (
                            <button className="btn btn-sm btn-primary" onClick={() => setPosting(r)}>Execute</button>
                          )}
                          {r.status === 'DRAFT' && r.direction === 'RECEIPT' && can('payments.edit') && (
                            <button className="btn btn-sm btn-primary" onClick={() => setPosting(r)}>Post</button>
                          )}
                          {r.status === 'POSTED' && r.unallocated_amount > 0 && can('payments.edit') && (
                            <button className="btn btn-sm btn-secondary" onClick={() => setPosting(r)}>Apply</button>
                          )}
                          {r.direction === 'RECEIPT' && r.status === 'DRAFT' && (
                            <button className="btn btn-icon" title="Suggest matches" aria-label="Suggest matches" onClick={async () => {
                              try { setSuggest(await api.payments.suggestMatches(r.id)); } catch (err) { notify(errorMessage(err), 'error'); }
                            }}>
                              <i className="bi bi-magic"></i>
                            </button>
                          )}
                          {r.status === 'POSTED' && can('finance.post') && (
                            <button className="btn btn-icon" title="Reverse" aria-label="Reverse" onClick={() => {
                              if (window.confirm(`Reverse ${r.reference}?`)) act(() => api.payments.reverse(r.id, ''), 'Payment reversed.');
                            }}>
                              <i className="bi bi-arrow-counterclockwise"></i>
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
      {suggest && <SuggestModal data={suggest} onClose={() => setSuggest(null)} />}
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
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New payment' : `Edit ${row.reference}`}
      subtitle="Receipt or outgoing payment"
      icon="bi-cash-coin"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="paymentForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="paymentForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-person-lines-fill" aria-hidden="true"></i>Party</h6>
        <div className="form-grid">
          <Field label="Direction" required>
            <select className="form-select" value={form.direction} onChange={set('direction')}>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Party type" required>
            <select className="form-select" value={form.party_type} onChange={set('party_type')}>
              {PARTY_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          {form.party_type === 'CUSTOMER' && (
            <Field label="Customer" required err={fieldErr.customer} span>
              <select className="form-select" value={form.customer} onChange={set('customer')} required>
                <option value="">—</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
          )}
          {form.party_type === 'SUPPLIER' && (
            <Field label="Supplier" required err={fieldErr.supplier} span>
              <select className="form-select" value={form.supplier} onChange={set('supplier')} required>
                <option value="">—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </select>
            </Field>
          )}
          {form.party_type === 'TRANSPORTER' && (
            <Field label="Transporter" required err={fieldErr.transporter} span>
              <select className="form-select" value={form.transporter} onChange={set('transporter')} required>
                <option value="">—</option>
                {transporters.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
              </select>
            </Field>
          )}
          {form.party_type === 'OTHER' && (
            <Field label="Payee" span>
              <input className="form-control" value={form.payee} onChange={set('payee')} />
            </Field>
          )}
        </div>

        <h6 className="modal-section-title"><i className="bi bi-bank" aria-hidden="true"></i>Payment Details</h6>
        <div className="form-grid">
          <Field label="Method" required>
            <select className="form-select" value={form.method} onChange={set('method')}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Bank / cash account" required err={fieldErr.bank_account}>
            <select className="form-select" value={form.bank_account} onChange={set('bank_account')} required>
              <option value="">—</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
            </select>
          </Field>
          <Field label="Date" required err={fieldErr.payment_date}>
            <input type="date" className="form-control" value={form.payment_date} onChange={set('payment_date')} required />
          </Field>
          <Field label="Amount" required err={fieldErr.amount}>
            <input type="number" step="0.01" className="form-control num" value={form.amount} onChange={set('amount')} required />
          </Field>
          <Field label="Purpose">
            <select className="form-select" value={form.purpose} onChange={set('purpose')}>
              {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          {form.method === 'MPESA' && (
            <Field label="M-Pesa reference" err={fieldErr.mpesa_reference}>
              <input className="form-control font-mono" value={form.mpesa_reference} onChange={set('mpesa_reference')} />
            </Field>
          )}
          {form.method === 'BANK' && (
            <Field label="Bank reference">
              <input className="form-control font-mono" value={form.bank_reference} onChange={set('bank_reference')} />
            </Field>
          )}
          <Field label="Narration" span>
            <input className="form-control" value={form.narration} onChange={set('narration')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function PostPaymentModal({ payment, onClose, onSaved }) {
  const [allocations, setAllocations] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isAdvanceApply = payment.status === 'POSTED';

  useEffect(() => {
    const load = async () => {
      try {
        if (payment.direction === 'RECEIPT' && payment.customer) {
          const inv = await api.salesInvoices.listAll({ company: payment.company, customer: payment.customer });
          setCandidates(inv.filter((i) => ['POSTED', 'PART_PAID'].includes(i.status)).map((i) => ({ kind: 'sales_invoice', id: i.id, ref: i.reference, outstanding: i.outstanding })));
        } else if (payment.direction === 'PAYMENT') {
          if (payment.supplier) {
            const inv = await api.purchaseInvoices.listAll({ company: payment.company, supplier: payment.supplier });
            setCandidates(inv.filter((i) => ['POSTED', 'PART_PAID'].includes(i.status)).map((i) => ({ kind: 'purchase_invoice', id: i.id, ref: i.reference, outstanding: i.outstanding })));
          } else if (payment.transporter) {
            const inv = await api.transporterInvoices.listAll({ company: payment.company, transporter: payment.transporter });
            setCandidates(inv.filter((i) => ['POSTED', 'PART_PAID'].includes(i.status)).map((i) => ({ kind: 'transporter_invoice', id: i.id, ref: i.reference, outstanding: i.outstanding })));
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
      isAdvanceApply ? await api.payments.applyAdvance(payment.id, payload) : await api.payments.post(payment.id, payload);
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const verb = isAdvanceApply ? 'Apply' : (payment.direction === 'PAYMENT' ? 'Execute' : 'Post');

  return (
    <Modal
      show
      onClose={onClose}
      title={`${verb} ${payment.reference}`}
      subtitle="Allocate to open invoices (leave empty to hold as an advance)"
      icon="bi-cash-coin"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="postPaymentForm" disabled={busy}>
            <i className="bi bi-check2-circle"></i>
            {busy ? 'Working...' : verb}
          </button>
        </>
      }
    >
      <form id="postPaymentForm" onSubmit={submit}>
        <div className="kv">
          <div className="kv__item"><div className="kv__label">Payment amount</div><div className="kv__value">{fmtMoney(payment.amount, payment.currency)}</div></div>
          <div className="kv__item"><div className="kv__label">Unallocated</div><div className="kv__value">{fmtMoney(payment.unallocated_amount)}</div></div>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-receipt" aria-hidden="true"></i>Open Invoices</h6>
        {!candidates.length ? (
          <p className="text-muted-soft">No open invoices found for this party.</p>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr><th style={{ width: '2.5rem' }}></th><th>Invoice</th><th className="text-right">Outstanding</th><th>Allocate</th></tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const a = allocations.find((x) => x.kind === c.kind && x.id === c.id);
                    return (
                      <tr key={`${c.kind}-${c.id}`}>
                        <td><input type="checkbox" className="form-check-input" checked={!!a} onChange={() => toggle(c)} /></td>
                        <td className="cell-mono text-brand fw-600">{c.ref}</td>
                        <td className="cell-num">{fmtMoney(c.outstanding)}</td>
                        <td>
                          {a && (
                            <input type="number" step="0.01" className="form-control num" style={{ width: 150 }}
                                   value={a.amount} onChange={(e) => setAmt(c, e.target.value)} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function SuggestModal({ data, onClose }) {
  return (
    <Modal
      show
      onClose={onClose}
      title="Suggested matches"
      subtitle={data.customer_name || 'No customer identified'}
      icon="bi-magic"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      {!data.invoices?.length ? (
        <p className="text-muted-soft">No open invoices.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.invoices.map((i) => (
            <li key={i.invoice} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
              <span>
                <span className="cell-mono text-brand fw-600">{i.reference}</span>
                {i.exact_match && <span className="status-pill status-pill--success" style={{ marginLeft: 8 }}>EXACT MATCH</span>}
              </span>
              <span className="cell-num">{fmtMoney(i.outstanding)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}