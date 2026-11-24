/**
 * Purchase invoices.
 * - CRUD /purchase-invoices/ (nested lines)
 * - POST /purchase-invoices/:id/match/  (three-way match check)
 * - POST /purchase-invoices/:id/post/   { override }
 * - POST /supplier-credit-notes/:id/post/  via SupplierCreditNotes.jsx (or inline)
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import { Field, Pagination } from './Suppliers';

const STATUSES = ['', 'DRAFT', 'POSTED', 'PART_PAID', 'PAID', 'CANCELLED'];
const MATCH_STATUS = ['', 'UNMATCHED', 'MATCHED', 'QTY_VARIANCE', 'PRICE_VARIANCE', 'NO_RECEIPT'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function PurchaseInvoices() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [matchFilter, setMatchFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.purchaseInvoices.list({
        ...companyParams(), ordering: '-id', page,
        ...(status ? { status } : {}),
        ...(matchFilter ? { match_status: matchFilter } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, status, matchFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, matchFilter]);

  const match = async (inv) => {
    try { const r = await api.purchaseInvoices.match(inv.id); notify(`Match: ${r.match_status}`, r.match_status === 'MATCHED' ? 'success' : 'warning'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const post = async (inv) => {
    if (!window.confirm(`Post invoice ${inv.supplier_invoice_no}?`)) return;
    try { await api.purchaseInvoices.post(inv.id, false); notify('Posted.', 'success'); load(); }
    catch (err) {
      const msg = errorMessage(err);
      if (/override/i.test(msg) && can('procurement.override_match')) {
        if (window.confirm(`${msg}\n\nOverride the three-way match and post anyway?`)) {
          try { await api.purchaseInvoices.post(inv.id, true); notify('Posted with override.', 'success'); load(); }
          catch (e) { notify(errorMessage(e), 'error'); }
        }
      } else notify(msg, 'error');
    }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Purchase invoices</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('procurement.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New invoice
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
          <select className="select" value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)}>
            {MATCH_STATUS.map((m) => <option key={m} value={m}>{m || 'Any match'}</option>)}
          </select>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No invoices</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Supplier invoice #</th><th>Date</th><th>Supplier</th>
                <th className="num">Total</th><th>Match</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.reference}</td>
                    <td className="mono">{i.supplier_invoice_no}</td>
                    <td>{i.invoice_date}</td>
                    <td>{i.supplier_label || i.supplier}</td>
                    <td className="num">{fmtMoney(i.total, i.currency)}</td>
                    <td><span className={`badge ${i.match_status === 'MATCHED' ? 'badge--success' : i.match_status === 'UNMATCHED' ? 'badge--neutral' : 'badge--warning'}`}>{i.match_status.replace(/_/g, ' ')}</span></td>
                    <td><span className={`status ${i.status === 'POSTED' ? 'status-posted' : i.status === 'PAID' ? 'status-paid' : i.status === 'PART_PAID' ? 'status-pending' : i.status === 'CANCELLED' ? 'status-rejected' : 'status-draft'}`}>{i.status}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {i.status === 'DRAFT' && can('procurement.edit') && (
                          <>
                            <button className="btn btn-xs" onClick={() => match(i)}>Match</button>
                            <button className="btn btn-xs btn-primary" onClick={() => post(i)}>Post</button>
                            <button className="row-action" title="Edit" onClick={() => setEditing(i)}><i className="bi bi-pencil" /></button>
                          </>
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
        <InvoiceModal row={editing} companyParams={companyParams}
                      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function InvoiceModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [suppliers, setSuppliers] = useState([]);
  const [pos, setPos] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({
    supplier: row.supplier || '', purchase_order: row.purchase_order || '',
    supplier_invoice_no: row.supplier_invoice_no || '', invoice_date: row.invoice_date || todayISO(),
    due_date: row.due_date || '', currency: row.currency || '',
  });
  const [lines, setLines] = useState(
    row.lines && row.lines.length
      ? row.lines.map((l) => ({
          po_line: l.po_line || '', product: l.product || '',
          quantity: l.quantity || '', unit_price: l.unit_price || '', tax_code: l.tax_code || '',
        }))
      : [{ po_line: '', product: '', quantity: '', unit_price: '', tax_code: '' }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  useEffect(() => {
    Promise.all([
      api.suppliers.listAll({ ...companyParams() }),
      api.currencies.listAll(),
    ]).then(([s, c]) => { setSuppliers(s); setCurrencies(c); }).catch(() => {});
  }, [companyParams]);

  useEffect(() => {
    if (!form.supplier) { setPos([]); return; }
    api.purchaseOrders.listAll({ ...companyParams(), supplier: form.supplier, status: 'APPROVED' })
      .then(setPos).catch(() => {});
  }, [companyParams, form.supplier]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = {
        ...form,
        company: companyParams().company,
        lines: lines.filter((l) => (l.po_line || l.product) && l.quantity && l.unit_price).map((l) => ({
          ...(l.po_line ? { po_line: l.po_line } : {}),
          ...(l.product ? { product: l.product } : {}),
          quantity: l.quantity, unit_price: l.unit_price,
          ...(l.tax_code ? { tax_code: l.tax_code } : {}),
        })),
      };
      ['purchase_order', 'due_date', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
      isNew ? await api.purchaseInvoices.create(body) : await api.purchaseInvoices.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--xl">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New purchase invoice' : `Edit ${row.reference}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid form-grid--3">
              <Field label="Supplier" required err={fieldErr.supplier}>
                <select className="select" value={form.supplier} onChange={set('supplier')} required>
                  <option value="">—</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                </select>
              </Field>
              <Field label="Purchase order">
                <select className="select" value={form.purchase_order} onChange={set('purchase_order')}>
                  <option value="">—</option>
                  {pos.map((p) => <option key={p.id} value={p.id}>{p.reference}</option>)}
                </select>
              </Field>
              <Field label="Invoice #" required err={fieldErr.supplier_invoice_no}>
                <input className="input mono" value={form.supplier_invoice_no} onChange={set('supplier_invoice_no')} required />
              </Field>
              <Field label="Invoice date" required>
                <input type="date" className="input" value={form.invoice_date} onChange={set('invoice_date')} required />
              </Field>
              <Field label="Due date"><input type="date" className="input" value={form.due_date} onChange={set('due_date')} /></Field>
              <Field label="Currency">
                <select className="select" value={form.currency} onChange={set('currency')}>
                  <option value="">Functional</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
            </div>
            <hr className="divider" />
            <div className="line-items">
              <table>
                <thead><tr>
                  <th>PO line</th><th>Product</th><th className="num">Qty</th>
                  <th className="num">Unit price</th><th>Tax code</th><th />
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <select className="select" value={l.po_line} onChange={(e) => setLine(i, 'po_line', e.target.value)}>
                          <option value="">—</option>
                          {row.lines?.map?.((rl) => (
                            <option key={rl.id} value={rl.id}>{rl.product_label || rl.product} · #{rl.id}</option>
                          ))}
                        </select>
                      </td>
                      <td><input className="input" value={l.product} onChange={(e) => setLine(i, 'product', e.target.value)} placeholder="if no PO line" /></td>
                      <td><input type="number" step="0.001" className="input num" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
                      <td><input type="number" step="0.000001" className="input num" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} /></td>
                      <td><input className="input" value={l.tax_code} onChange={(e) => setLine(i, 'tax_code', e.target.value)} /></td>
                      <td>
                        {lines.length > 1 && (
                          <button type="button" className="row-action row-action--danger"
                                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                            <i className="bi bi-x-lg" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="line-items__foot">
                <button type="button" className="btn btn-sm"
                        onClick={() => setLines((ls) => [...ls, { po_line: '', product: '', quantity: '', unit_price: '', tax_code: '' }])}>
                  + Add line
                </button>
              </div>
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