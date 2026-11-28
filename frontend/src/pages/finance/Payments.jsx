/**
 * Payments & receipts.
 * - CRUD /payments/ (PaymentSerializer with allocations)
 * - POST /payments/:id/submit/            (outgoing only; needs approval)
 * - POST /payments/:id/approve/           { comment }      (needs approvals.decide)
 * - POST /payments/:id/post/              { allocations:[{sales_invoice|purchase_invoice|transporter_invoice|expense, amount}] }
 * - POST /payments/:id/apply-advance/     allocate an existing unallocated advance
 * - POST /payments/:id/reverse/           { reason }
 * - GET  /payments/:id/suggest-matches/   M-Pesa/bank receipt ? likely invoices
 *
 * Segregation of duties enforced server-side: approver ? submitter, executor ? approver.
 *
 * Paying a purchase invoice: "Pay purchase invoice" here, or "Pay" on Purchase invoices
 * (/finance/payments?invoice=ID). Picking the invoice autofills the form. A payment has no invoice field:
 * the invoice reference is kept in the narration, and Execute uses it to pre-select the invoice.
 * Paging is server-side (25 per page).
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
const OPEN_INVOICE = ['POSTED', 'PART_PAID'];
const PENDING_PAYMENT = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED'];
// bank account type -> payment method
const METHOD_FOR = { BANK: 'BANK', CASH: 'CASH', PETTY: 'CASH', MPESA: 'MPESA' };

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

/** True when the narration names this invoice reference (whole reference only). */
const mentions = (text, ref) => !!ref && String(text || '').split(/[^A-Za-z0-9-]+/).includes(ref);
const isOpen = (i) => OPEN_INVOICE.includes(i.status) && Number(i.outstanding) > 0;
const money2 = (n) => Number(n || 0).toFixed(2);

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
  const [actionError, setActionError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Arriving from the "Pay" button on Purchase invoices: open a prefilled payment once.
  const invoiceParam = searchParams.get('invoice');
  useEffect(() => {
    if (!invoiceParam) return;
    if (can('payments.edit')) setEditing({ invoiceId: invoiceParam });
    else setActionError('Your role cannot create payments.');
    const next = new URLSearchParams(searchParams);
    next.delete('invoice');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceParam]);

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
    setActionError('');
    try { await fn(); notify(success, 'success'); load(); }
    catch (err) { setActionError(errorMessage(err)); notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status || direction);
  const clearFilters = () => { setSearch(''); setStatus(''); setDirection(''); };

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Payments</h1>
            <p className="page-subtitle">
              Receipts and outgoing payments{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('payments.edit') && (
            <button className="btn btn-secondary" onClick={() => setEditing({ payInvoice: true })}>
              <i className="bi bi-receipt-cutoff"></i>
              Pay purchase invoice
            </button>
          )}
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

      {actionError && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{actionError}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setActionError('')}>Close</button>
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
                    <tr key={r.id} style={{ cursor: r.status === 'DRAFT' ? 'pointer' : 'default' }}
                        onClick={() => { if (r.status === 'DRAFT' && can('payments.edit')) setEditing(r); }}>
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
                          {r.status === 'AWAITING_APPROVAL' && r.created_by === user?.id && (
                            <span className="text-muted-soft" style={{ fontSize: '0.75rem' }}>Another user must approve</span>
                          )}
                          {r.status === 'APPROVED' && r.approved_by === user?.id && (
                            <span className="text-muted-soft" style={{ fontSize: '0.75rem' }}>Another user must execute</span>
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
          onSaved={(direction) => {
            setEditing(null); setActionError('');
            notify(direction === 'PAYMENT' ? 'Saved as draft. Next: press Submit to send it for approval.' : 'Saved.', 'success');
            load();
          }}
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
    direction: row.direction || (row.payInvoice || row.invoiceId ? 'PAYMENT' : 'RECEIPT'),
    party_type: row.party_type || (row.payInvoice || row.invoiceId ? 'SUPPLIER' : 'CUSTOMER'),
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
  const [invoices, setInvoices] = useState([]);      // open purchase invoices
  const [invoice, setInvoice] = useState(null);      // the one being paid
  const [pending, setPending] = useState([]);        // unfinished payments already made for it
  const [loadingData, setLoadingData] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const company = invoice?.company ?? row.company ?? companyParams().company;
  const bank = bankAccounts.find((x) => String(x.id) === String(form.bank_account));
  const sameCompany = (x) => !company || String(x.company) === String(company);
  const bankChoices = bankAccounts.filter((x) => x.is_active !== false && sameCompany(x)
    && (!invoice || x.currency === invoice.currency));
  const outstanding = invoice ? Number(invoice.outstanding) : 0;
  const tooMuch = !!invoice && Number(form.amount) > outstanding;

  useEffect(() => {
    Promise.all([
      api.bankAccounts.listAll({ ...companyParams() }),
      api.customers.listAll({ ...companyParams() }),
      api.suppliers.listAll({ ...companyParams() }),
      api.transporters.listAll({ ...companyParams() }),
    ]).then(([b, c, s, t]) => { setBankAccounts(b); setCustomers(c); setSuppliers(s); setTransporters(t); })
      .catch((err) => setError(errorMessage(err)));
  }, [companyParams]);

  /** Fill the form from a purchase invoice. keep = true leaves a saved draft's values alone. */
  const chooseInvoice = (inv, keep = false) => {
    setInvoice(inv);
    if (!inv || keep) return;
    setForm((f) => ({
      ...f,
      direction: 'PAYMENT', party_type: 'SUPPLIER', purpose: 'INVOICE',
      supplier: inv.supplier, customer: '', transporter: '', payee: '',
      amount: money2(inv.outstanding), bank_account: '',
      narration: `Payment for ${inv.reference} (supplier invoice ${inv.supplier_invoice_no})`,
    }));
  };

  // Load open purchase invoices, then select the one asked for (or the one the draft names).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const open = (await api.purchaseInvoices.listAll({ ...companyParams() })).filter(isOpen);
        let wanted = null;
        if (row.invoiceId) {
          wanted = open.find((i) => String(i.id) === String(row.invoiceId));
          if (!wanted) {
            const one = await api.purchaseInvoices.get(row.invoiceId);
            if (isOpen(one)) { wanted = one; open.unshift(one); }
            else if (alive) setError(`${one.reference} is ${one.status.replace(/_/g, ' ')} and has nothing open to pay.`);
          }
        } else if (row.id && row.direction === 'PAYMENT') {
          wanted = open.find((i) => mentions(row.narration, i.reference));
        }
        if (!alive) return;
        setInvoices(open);
        if (wanted) chooseInvoice(wanted, !!row.id);
      } catch (err) { if (alive) setError(errorMessage(err)); }
      finally { if (alive) setLoadingData(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warn about other unfinished payments for the same invoice (avoids paying twice).
  useEffect(() => {
    setPending([]);
    if (!invoice) return undefined;
    let alive = true;
    api.payments.listAll({ company: invoice.company, supplier: invoice.supplier, direction: 'PAYMENT' })
      .then((all) => {
        if (alive) setPending(all.filter((p) => p.id !== row.id && PENDING_PAYMENT.includes(p.status)
          && mentions(p.narration, invoice.reference)));
      }).catch(() => {});
    return () => { alive = false; };
  }, [invoice, row.id]);

  // If only one account has the invoice currency, select it.
  useEffect(() => {
    if (!invoice || form.bank_account || bankChoices.length !== 1) return;
    pickBank(String(bankChoices[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice, bankAccounts, form.bank_account]);

  function pickBank(id) {
    const b = bankAccounts.find((x) => String(x.id) === String(id));
    setForm((f) => ({ ...f, bank_account: id, method: METHOD_FOR[b?.account_type] || f.method }));
  }

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});
    if (row.payInvoice && !invoice) { setError('Select the purchase invoice to pay.'); return; }
    if (tooMuch) { setError(`The amount is more than the ${money2(outstanding)} outstanding on ${invoice.reference}.`); return; }
    if (invoice && bank && bank.currency !== invoice.currency) {
      setError(`Pick an account in ${invoice.currency}, the invoice currency.`); return;
    }
    if (pending.length && !window.confirm(
      `${pending.map((p) => p.reference).join(', ')} already pays ${invoice.reference} and is not finished. Save another payment anyway?`
    )) return;
    setBusy(true);
    try {
      const body = { ...form, company: company || bank?.company };
      // The payment currency is always the currency of the account the money moves through.
      if (bank) {
        body.currency = bank.currency;
        if (!isNew && row.currency !== bank.currency) Object.assign(body, { exchange_rate: null, rate_date: null, rate_source: '' });
      } else if (row.currency) body.currency = row.currency;
      // Keep the invoice reference in the narration so Execute can find it.
      if (invoice && !mentions(body.narration, invoice.reference)) {
        body.narration = `${invoice.reference} ${body.narration}`.trim();
      }
      ['customer', 'supplier', 'transporter'].forEach((k) => { if (!body[k]) delete body[k]; });
      if (isNew) await api.payments.create(body);
      else await api.payments.update(row.id, body);
      onSaved(body.direction);
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
          <button className="btn btn-primary" type="submit" form="paymentForm" disabled={busy || loadingData}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="paymentForm" onSubmit={submit}>
        {(row.payInvoice || row.invoiceId || form.direction === 'PAYMENT') && (
          <>
            <h6 className="modal-section-title"><i className="bi bi-receipt-cutoff" aria-hidden="true"></i>Purchase Invoice</h6>
            <div className="form-grid">
              <Field label="Invoice to pay" required={!!row.payInvoice} span>
                <select
                  className="form-select" value={invoice ? String(invoice.id) : ''} disabled={loadingData}
                  onChange={(e) => chooseInvoice(invoices.find((i) => String(i.id) === e.target.value) || null)}
                >
                  <option value="">{loadingData ? 'Loading...' : '� none �'}</option>
                  {invoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.reference} · {i.supplier_label || i.supplier} · {i.supplier_invoice_no} · owes {fmtMoney(i.outstanding, i.currency)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {!loadingData && !invoices.length && (
              <p className="text-muted-soft">No posted purchase invoices have a balance to pay.</p>
            )}
            {invoice && (
              <div className="alert alert-info mt-3 mb-0" role="status">
                <div>
                  <strong>{invoice.reference}</strong> · due {invoice.due_date || '—'} · total {fmtMoney(invoice.total, invoice.currency)} �
                  paid {fmtMoney(invoice.amount_paid, invoice.currency)} · outstanding <strong>{fmtMoney(invoice.outstanding, invoice.currency)}</strong>
                </div>
              </div>
            )}
            {pending.length > 0 && (
              <div className="alert alert-danger mt-3 mb-0" role="alert">
                <span>
                  Already being paid by {pending.map((p) => `${p.reference} (${fmtMoney(p.amount, p.currency)}, ${p.status.replace(/_/g, ' ')})`).join(', ')}.
                  Check before saving so you do not pay twice.
                </span>
              </div>
            )}
          </>
        )}

        <h6 className="modal-section-title"><i className="bi bi-person-lines-fill" aria-hidden="true"></i>Party</h6>
        <div className="form-grid">
          <Field label="Direction" required>
            <select className="form-select" value={form.direction} disabled={!!invoice}
                    onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, direction: v })); }}>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Party type" required>
            <select className="form-select" value={form.party_type} onChange={set('party_type')} disabled={!!invoice}>
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
              <select className="form-select" value={form.supplier} onChange={set('supplier')} required disabled={!!invoice}>
                {invoice && !suppliers.some((x) => String(x.id) === String(invoice.supplier)) && (
                  <option value={invoice.supplier}>{invoice.supplier_label || invoice.supplier}</option>
                )}
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
              <>
                <select className="form-select" value={form.bank_account} onChange={(e) => pickBank(e.target.value)} required>
                  <option value="">—</option>
                  {bankChoices.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
                </select>
                {invoice && !loadingData && !bankChoices.length && (
                  <p className="text-muted-soft mt-2 mb-0">No {invoice.currency} account for this company. Add one under Bank.</p>
                )}
              </>
          </Field>
          <Field label="Date" required err={fieldErr.payment_date}>
            <input type="date" className="form-control" value={form.payment_date} onChange={set('payment_date')} required />
          </Field>
          <Field label="Amount" required err={fieldErr.amount}>
            <>
              <input type="number" step="0.01" min="0.01" className="form-control num" value={form.amount} onChange={set('amount')} required />
              {invoice && (
                <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
                  {tooMuch ? 'More than the outstanding amount.' : 'You can enter less to part-pay.'}
                </p>
              )}
            </>
          </Field>
          <Field label="Purpose">
            <select className="form-select" value={form.purpose} onChange={set('purpose')} disabled={!!invoice}>
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
  const available = Number(isAdvanceApply ? payment.unallocated_amount : payment.amount);
  const allocated = allocations.reduce((t, a) => t + Number(a.amount || 0), 0);
  const left = Math.round((available - allocated) * 100) / 100;

  useEffect(() => {
    const SOURCES = [
      ['sales_invoice', api.salesInvoices, 'customer', 'RECEIPT'],
      ['purchase_invoice', api.purchaseInvoices, 'supplier', 'PAYMENT'],
      ['transporter_invoice', api.transporterInvoices, 'transporter', 'PAYMENT'],
    ];
    const load = async () => {
      const source = SOURCES.find(([, , party, direction]) => direction === payment.direction && payment[party]);
      if (!source) return;
      const [kind, resource, party] = source;
      try {
        const inv = await resource.listAll({ company: payment.company, [party]: payment[party] });
        const list = inv.filter((i) => isOpen(i) && i.currency === payment.currency).map((i) => ({
          kind, id: i.id, ref: i.reference, extra: i.supplier_invoice_no || i.invoice_no || '', outstanding: i.outstanding,
        }));
        setCandidates(list);
        // Pre-select the purchase invoice named in the narration.
        const named = kind === 'purchase_invoice' && list.find((c) => mentions(payment.narration, c.ref));
        if (named) {
          setAllocations([{ kind, id: named.id, ref: named.ref, amount: money2(Math.min(Number(named.outstanding), available)) }]);
        }
      } catch (err) { setError(errorMessage(err)); }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment]);

  const toggle = (c) => {
    setAllocations((as) => {
      const exists = as.find((a) => a.kind === c.kind && a.id === c.id);
      if (exists) return as.filter((a) => a !== exists);
      const free = available - as.reduce((t, a) => t + Number(a.amount || 0), 0);
      return [...as, { kind: c.kind, id: c.id, ref: c.ref, amount: money2(Math.max(Math.min(Number(c.outstanding), free), 0)) }];
    });
  };
  const setAmt = (c, v) => setAllocations((as) => as.map((a) => (a.kind === c.kind && a.id === c.id ? { ...a, amount: v } : a)));

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (left < 0) { setError('You have allocated more than the payment amount.'); return; }
    if (!isAdvanceApply && ['INVOICE', 'ADVANCE'].includes(payment.purpose) && left > 0 && !window.confirm(
      `${money2(left)} is not allocated to any invoice and will be held as an advance. Continue?`
    )) return;
    setBusy(true);
    try {
      const payload = allocations.map((a) => ({ [a.kind]: a.id, amount: a.amount }));
      if (isAdvanceApply) await api.payments.applyAdvance(payment.id, payload);
      else await api.payments.post(payment.id, payload);
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
                        <td className="cell-mono text-brand fw-600">
                          {c.ref}
                          {c.extra && <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>{c.extra}</div>}
                        </td>
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
        <p className="text-muted-soft mt-3 mb-0">Not allocated: {fmtMoney(left, payment.currency)}</p>
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