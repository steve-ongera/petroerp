/**
 * Purchase invoices.
 * - CRUD /purchase-invoices/ (nested lines)
 * - POST /purchase-invoices/:id/match/  (three-way match check)
 * - POST /purchase-invoices/:id/post/   { override }
 *
 * New invoice flow: pick the purchase order -> supplier, currency, due date and one line per PO line are
 * filled in (quantity = received and not yet invoiced, price/tax from the PO). Everything stays editable, and
 * each line shows a live PO / receipt / invoice check before you save. The server repeats the real
 * three-way match when you press Match or Post.
 *
 * Who can post comes from the server (user.purchase_posting, from /auth/login/ and /auth/me/).
 * The server enforces it; this page only explains it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import ServerPagination from '../../components/ServerPagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUSES = ['DRAFT', 'POSTED', 'PART_PAID', 'PAID', 'CANCELLED'];
const MATCH_STATUS = ['UNMATCHED', 'MATCHED', 'QTY_VARIANCE', 'PRICE_VARIANCE', 'NO_RECEIPT'];
// Purchase orders that have goods received against them and can therefore be invoiced.
const INVOICEABLE_PO = ['PARTIALLY_RECEIVED', 'RECEIVED'];
const COUNTED_INVOICE = ['POSTED', 'PART_PAID', 'PAID'];

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtQty = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, days) => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};
const emptyLine = () => ({ po_line: '', product: '', quantity: '', unit_price: '', tax_code: '' });

const statusPill = (s) => {
  if (s === 'PAID') return 'status-pill--success';
  if (s === 'POSTED') return 'status-pill--info';
  if (s === 'PART_PAID') return 'status-pill--warning';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral';
};
const matchPill = (s) => {
  if (s === 'MATCHED') return 'status-pill--success';
  if (s === 'UNMATCHED') return 'status-pill--neutral';
  return 'status-pill--warning';
};

export default function PurchaseInvoices() {
  const { can, user } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [matchFilter, setMatchFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState(null); // { title, message }
  const [busyId, setBusyId] = useState(null);           // invoice being matched / posted

  const posting = user?.purchase_posting;
  const roleLabel = user?.role_label || user?.role_name || user?.role || 'Unknown';
  const canPost = !!posting?.can_post;
  const canEdit = can('procurement.edit');
  const canPay = useAccess().can('payments.edit');
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.purchaseInvoices.list({
        ...companyParams(), ordering: '-id', page,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(matchFilter ? { match_status: matchFilter } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || res || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, status, matchFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, matchFilter]);

  /** Show a failure as a toast AND as a message that stays on the page. */
  const showError = (inv, title, message) => {
    setActionError({ title: `${inv.reference}: ${title}`, message });
    notify(message, 'error');
  };

  const match = async (inv) => {
    setActionError(null); setBusyId(inv.id);
    try {
      const r = await api.purchaseInvoices.match(inv.id);
      notify(`Match: ${r.match_status}${r.notes ? ` — ${r.notes}` : ''}`, r.match_status === 'MATCHED' ? 'success' : 'warning', 9000);
      load();
    } catch (err) { showError(inv, 'match failed', errorMessage(err)); }
    finally { setBusyId(null); }
  };

  const sendPost = async (inv, override) => {
    await api.purchaseInvoices.post(inv.id, override);
    notify(override ? 'Posted with override.' : 'Posted.', 'success');
    load();
  };

  const post = async (inv) => {
    setActionError(null);

    // posting is undefined if the server did not send it; then the server's own check decides.
    if (posting && !posting.can_post) {
      showError(inv, 'permission denied',
        `Your role is "${roleLabel}". You cannot post purchase invoices. Only these can post: ${posting.post_roles}.`);
      return;
    }
    if (!window.confirm(
      `Post invoice ${inv.supplier_invoice_no}?\n\nThis records the amount owed to the supplier in the accounts. You cannot edit the invoice afterwards.`
    )) return;

    setBusyId(inv.id);
    try {
      await sendPost(inv, false);
    } catch (err) {
      const msg = errorMessage(err);
      if (err.status === 403) {
        showError(inv, 'permission denied', msg);
      } else if (!/three-way match failed/i.test(msg)) {
        showError(inv, 'could not be posted', msg);
      } else if (posting && !posting.can_override) {
        showError(inv, 'could not be posted',
          `${msg} Your role is "${roleLabel}", so you cannot override it. Only these can: ${posting.override_roles}.`);
      } else if (window.confirm(`${msg}\n\nOverride the three-way match and post anyway?`)) {
        try { await sendPost(inv, true); }
        catch (e) { showError(inv, 'could not be posted', errorMessage(e)); }
      }
    } finally { setBusyId(null); }
  };

  const hasActiveFilters = !!(search || status || matchFilter);
  const clearFilters = () => { setSearch(''); setStatus(''); setMatchFilter(''); };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Purchase invoices</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New invoice
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
          <span style={{ flex: 1 }}>
            <strong>{actionError.title}.</strong> {actionError.message}
          </span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setActionError(null)}>
            Close
          </button>
        </div>
      )}

      {posting && !posting.can_post && (
        <div className="alert alert-info" role="status">
          <span>
            Your role is <strong>{roleLabel}</strong>. You cannot post purchase invoices.
            Only these can post: {posting.post_roles}.
          </span>
        </div>
      )}

      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by reference, supplier or invoice number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search purchase invoices"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select className="form-select" value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)} aria-label="Match status">
            <option value="">Any match</option>
            {MATCH_STATUS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
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
                Status: {status.replace('_', ' ')}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {matchFilter && (
              <span className="filter-chip">
                Match: {matchFilter.replace(/_/g, ' ')}
                <button onClick={() => setMatchFilter('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Invoice List
          </span>
          <span className="chart-card__subtitle">
            {count} invoice{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-receipt-cutoff"></i>
            <h6>{hasActiveFilters ? 'No invoices match your search' : 'No invoices yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New invoice' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Supplier invoice #</th>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th className="text-right">Total</th>
                    <th>Match</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '12rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td className="cell-mono text-brand fw-600">{i.reference}</td>
                      <td className="cell-mono">{i.supplier_invoice_no}</td>
                      <td>{i.invoice_date}</td>
                      <td className="cell-name">{i.supplier_label || i.supplier}</td>
                      <td className="cell-num">{fmtMoney(i.total, i.currency)}</td>
                      <td><span className={`status-pill ${matchPill(i.match_status)}`}>{i.match_status.replace(/_/g, ' ')}</span></td>
                      <td><span className={`status-pill ${statusPill(i.status)}`}>{i.status.replace('_', ' ')}</span></td>
                      <td>
                        {['POSTED', 'PART_PAID'].includes(i.status) && canPay && Number(i.outstanding) > 0 && (
                          <div className="row-actions">
                            <button className="btn btn-sm btn-primary" onClick={() => navigate(`/finance/payments?invoice=${i.id}`)}>Pay</button>
                          </div>
                        )}
                        {/* Post stays visible to editors who cannot post, so clicking it explains why. */}
                        {i.status === 'DRAFT' && (canEdit || canPost) && (
                          <div className="row-actions">
                            <button className="btn btn-sm btn-secondary" onClick={() => match(i)} disabled={busyId === i.id}>Match</button>
                            <button className="btn btn-sm btn-primary" onClick={() => post(i)} disabled={busyId === i.id}>Post</button>
                            {canEdit && (
                              <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(i)}>
                                <i className="bi bi-pencil"></i>
                              </button>
                            )}
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

        {!loading && rows.length > 0 && <ServerPagination page={page} count={count} onChange={setPage} />}
      </section>

      {editing && (
        <InvoiceModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setActionError(null); notify('Saved. Run Match to check it against the receipts.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ create / edit */

/** Live preview of the three-way check for one invoice line (the server repeats it on Match / Post). */
function lineCheck(line, poLine, invoicedBefore) {
  if (!poLine) return { tone: 'neutral', text: 'Pick a PO line' };
  const received = Number(poLine.received_quantity || 0);
  const qty = Number(line.quantity || 0);
  const before = Number(invoicedBefore[poLine.id] || 0);
  if (received === 0) return { tone: 'danger', text: 'Nothing received' };
  if (qty + before > received) {
    return { tone: 'warning', text: `Over received by ${fmtQty(qty + before - received)} L` };
  }
  const poPrice = Number(poLine.unit_price || 0);
  const price = Number(line.unit_price || 0);
  if (price && poPrice && price !== poPrice) {
    return { tone: 'warning', text: `Price ${price > poPrice ? 'above' : 'below'} PO` };
  }
  return { tone: 'success', text: 'Matches' };
}

function InvoiceModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [suppliers, setSuppliers] = useState([]);
  const [pos, setPos] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [po, setPo] = useState(null);                        // selected purchase order (with lines)
  const [invoicedBefore, setInvoicedBefore] = useState({});  // po_line id -> litres on other posted invoices
  const [loadingPO, setLoadingPO] = useState(false);
  const [dueAuto, setDueAuto] = useState(!row.due_date);
  const [form, setForm] = useState({
    supplier: row.supplier ? String(row.supplier) : '',
    purchase_order: row.purchase_order ? String(row.purchase_order) : '',
    supplier_invoice_no: row.supplier_invoice_no || '', invoice_date: row.invoice_date || todayISO(),
    due_date: row.due_date || '', currency: row.currency || '',
  });
  const [lines, setLines] = useState(
    row.lines && row.lines.length
      ? row.lines.map((l) => ({
        po_line: l.po_line ? String(l.po_line) : '', product: l.product ? String(l.product) : '',
        quantity: l.quantity || '', unit_price: l.unit_price || '', tax_code: l.tax_code || '',
      }))
      : [emptyLine()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const patchLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const poLines = po?.lines || [];

  useEffect(() => {
    Promise.all([
      api.suppliers.listAll({ ...companyParams() }),
      api.currencies.listAll(),
    ]).then(([s, c]) => { setSuppliers(s); setCurrencies(c); }).catch(() => {});
  }, [companyParams]);

  // Purchase orders that have received goods (optionally narrowed to the chosen supplier).
  useEffect(() => {
    api.purchaseOrders.listAll({ ...companyParams(), ...(form.supplier ? { supplier: form.supplier } : {}) })
      .then((all) => setPos(all.filter((p) => INVOICEABLE_PO.includes(p.status) || String(p.id) === String(row.purchase_order))))
      .catch(() => setPos([]));
  }, [companyParams, form.supplier, row.purchase_order]);

  /** Load a PO and what has already been invoiced against it. `fill` = also autofill the form. */
  const loadPO = useCallback(async (id, fill) => {
    setLoadingPO(true); setError('');
    try {
      const order = await api.purchaseOrders.get(id);
      const supplierInvoices = await api.purchaseInvoices.listAll({ supplier: order.supplier }).catch(() => []);
      const before = {};
      supplierInvoices
        .filter((i) => String(i.purchase_order) === String(id) && COUNTED_INVOICE.includes(i.status) && i.id !== row.id)
        .forEach((i) => (i.lines || []).forEach((l) => {
          if (l.po_line) before[l.po_line] = (before[l.po_line] || 0) + Number(l.quantity || 0);
        }));
      setPo(order);
      setInvoicedBefore(before);
      if (!fill) return;

      const withBalance = (order.lines || [])
        .map((pl) => ({ pl, open: Math.max(Number(pl.received_quantity || 0) - (before[pl.id] || 0), 0) }))
        .filter((x) => x.open > 0);
      const source = withBalance.length ? withBalance : (order.lines || []).map((pl) => ({ pl, open: '' }));
      setLines(source.map(({ pl, open }) => ({
        po_line: String(pl.id), product: String(pl.product), quantity: open === '' ? '' : String(open),
        unit_price: pl.unit_price, tax_code: pl.tax_code || '',
      })));
      setForm((f) => ({
        ...f,
        purchase_order: String(id),
        supplier: String(order.supplier),
        currency: order.currency || '',
        due_date: dueAuto ? addDays(f.invoice_date, order.payment_terms_days) : f.due_date,
      }));
      if (!withBalance.length) {
        setError('Nothing is left to invoice on this order: every received litre is already invoiced, or nothing has been received yet.');
      }
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoadingPO(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, dueAuto]);

  // Editing an existing invoice: load the PO for the checks, but keep the saved lines.
  useEffect(() => {
    if (!isNew && row.purchase_order) loadPO(row.purchase_order, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPO = (id) => {
    if (!id) {
      setPo(null); setInvoicedBefore({});
      setForm((f) => ({ ...f, purchase_order: '' }));
      setLines([emptyLine()]);
      return;
    }
    const dirty = lines.some((l) => l.po_line && l.quantity);
    if (dirty && !window.confirm('Replace the current lines with the lines of this purchase order?')) return;
    loadPO(id, true);
  };

  const changeSupplier = (value) => {
    const keep = po && String(po.supplier) === String(value);
    setForm((f) => ({ ...f, supplier: value, ...(keep ? {} : { purchase_order: '' }) }));
    if (!keep) { setPo(null); setInvoicedBefore({}); setLines([emptyLine()]); }
  };

  const changeInvoiceDate = (e) => {
    const v = e.target.value;
    setForm((f) => ({
      ...f, invoice_date: v,
      ...(dueAuto && po ? { due_date: addDays(v, po.payment_terms_days) } : {}),
    }));
  };

  const pickLine = (i, id) => {
    const pl = poLines.find((x) => String(x.id) === String(id));
    if (!pl) { patchLine(i, { po_line: '', product: '' }); return; }
    const open = Math.max(Number(pl.received_quantity || 0) - (invoicedBefore[pl.id] || 0), 0);
    patchLine(i, {
      po_line: String(pl.id), product: String(pl.product), quantity: String(open || ''),
      unit_price: pl.unit_price, tax_code: pl.tax_code || '',
    });
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const supplier = suppliers.find((s) => String(s.id) === String(form.supplier));
      const company = po?.company ?? supplier?.company ?? row.company ?? companyParams().company;
      if (!company) { setError('Select the supplier first so the legal entity can be determined.'); setBusy(false); return; }
      const body = {
        ...form,
        company: Number(company),
        lines: lines.filter((l) => l.po_line && l.product && l.quantity && l.unit_price).map((l) => ({
          po_line: l.po_line, product: l.product, quantity: l.quantity, unit_price: l.unit_price,
          ...(l.tax_code ? { tax_code: l.tax_code } : {}),
        })),
      };
      if (!body.lines.length) { setError('Add at least one line linked to a purchase order line.'); setBusy(false); return; }
      ['due_date', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
      if (isNew) await api.purchaseInvoices.create(body);
      else await api.purchaseInvoices.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  const invTotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New purchase invoice' : `Edit ${row.reference}`}
      subtitle="Supplier invoices and three-way match"
      icon="bi-receipt-cutoff"
      size="xl"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="purchaseInvoiceForm" disabled={busy || loadingPO}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="purchaseInvoiceForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-bag-check" aria-hidden="true"></i>Purchase Order</h6>
        <div className="form-grid">
          <Field label="Purchase order" required err={fieldErr.purchase_order} span>
            <>
              <select className="form-select" value={form.purchase_order} onChange={(e) => pickPO(e.target.value)} required disabled={loadingPO}>
                <option value="">—</option>
                {form.purchase_order && !pos.some((p) => String(p.id) === String(form.purchase_order)) && (
                  <option value={form.purchase_order}>{row.purchase_order_label || po?.reference || form.purchase_order}</option>
                )}
                {pos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference} · {p.supplier_label || p.supplier} · {p.status.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
                {loadingPO
                  ? 'Loading purchase order...'
                  : pos.length
                    ? 'Only orders with goods already received are listed. Picking one fills in the supplier, currency, due date and lines.'
                    : 'No purchase orders with received goods yet. Receive goods against an approved order first.'}
              </p>
            </>
          </Field>
        </div>

        {po && (
          <div className="alert alert-info mt-3 mb-0" role="status">
            <div>
              <strong>{po.reference}</strong> · {po.supplier_label || po.supplier} · {po.currency || 'functional currency'} ·
              payment terms {po.payment_terms_days} days · order total {fmtMoney(po.total, po.currency)}
            </div>
          </div>
        )}

        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Invoice Details</h6>
        <div className="form-grid">
          <Field label="Supplier" required err={fieldErr.supplier}>
            <select className="form-select" value={form.supplier} onChange={(e) => changeSupplier(e.target.value)} required>
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </Field>
          <Field label="Supplier invoice #" required err={fieldErr.supplier_invoice_no}>
            <input className="form-control font-mono" value={form.supplier_invoice_no} onChange={set('supplier_invoice_no')} required />
          </Field>
          <Field label="Invoice date" required err={fieldErr.invoice_date}>
            <input type="date" className="form-control" value={form.invoice_date} onChange={changeInvoiceDate} required />
          </Field>
          <Field label="Due date" err={fieldErr.due_date}>
            <input
              type="date" className="form-control" value={form.due_date}
              onChange={(e) => { setDueAuto(false); set('due_date')(e); }}
            />
          </Field>
          <Field label="Currency" err={fieldErr.currency}>
            <select className="form-select" value={form.currency} onChange={set('currency')}>
              <option value="">Functional</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-droplet-half" aria-hidden="true"></i>Lines</h6>
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>PO line</th>
                  <th className="text-right">Qty invoiced (L)</th>
                  <th className="text-right">Unit price</th>
                  <th>Tax code</th>
                  <th>Check</th>
                  <th style={{ width: '3rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const pl = poLines.find((x) => String(x.id) === String(l.po_line));
                  const chk = lineCheck(l, pl, invoicedBefore);
                  return (
                    <tr key={i}>
                      <td>
                        <select className="form-select" value={l.po_line} onChange={(e) => pickLine(i, e.target.value)} disabled={!po}>
                          <option value="">—</option>
                          {poLines.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.product_label || x.product} · ordered {fmtQty(x.quantity)} · received {fmtQty(x.received_quantity)}
                            </option>
                          ))}
                        </select>
                        {pl && (
                          <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>
                            Already invoiced: {fmtQty(invoicedBefore[pl.id])} L · PO price {Number(pl.unit_price).toFixed(6)}
                          </div>
                        )}
                      </td>
                      <td><input type="number" step="0.001" className="form-control num" value={l.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} /></td>
                      <td><input type="number" step="0.000001" className="form-control num" value={l.unit_price} onChange={(e) => patchLine(i, { unit_price: e.target.value })} /></td>
                      <td><input className="form-control" value={l.tax_code} onChange={(e) => patchLine(i, { tax_code: e.target.value })} /></td>
                      <td><span className={`status-pill status-pill--${chk.tone}`}>{chk.text}</span></td>
                      <td>
                        {lines.length > 1 && (
                          <button type="button" className="btn btn-icon" title="Remove line" aria-label="Remove line"
                                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                            <i className="bi bi-x-lg"></i>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>Net total (before tax)</strong></td>
                  <td className="cell-num" colSpan={4}><strong>{fmtMoney(invTotal, form.currency)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-secondary mt-2" onClick={() => setLines((ls) => [...ls, emptyLine()])} disabled={!po}>
          <i className="bi bi-plus-lg"></i> Add line
        </button>
        <p className="text-muted-soft mt-3 mb-0" style={{ fontSize: '0.8125rem' }}>
          The check column is a preview. After saving, press <strong>Match</strong> for the server's three-way match
          (purchase order, invoice and goods receipts), then <strong>Post</strong>.
        </p>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}