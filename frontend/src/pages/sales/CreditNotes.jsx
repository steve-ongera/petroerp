/**
 * Sales credit notes.
 * - CRUD /sales-credit-notes/ (crud)
 * - POST /sales-credit-notes/:id/post/  → svc.post_sales_credit_note (optionally restock)
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import { Field } from './Customers';

const STATUS = ['DRAFT', 'POSTED'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function CreditNotes() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.salesCreditNotes.list({ ...companyParams(), ordering: '-id', page_size: 500 });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const post = async (cn) => {
    if (!window.confirm(`Post credit note ${cn.reference}?`)) return;
    try { await api.salesCreditNotes.post(cn.id); notify('Posted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Credit notes</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('sales.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New credit note
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No credit notes</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>Invoice</th><th>Product</th>
                <th className="num">Qty</th><th className="num">Total</th><th>Reason</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((cn) => (
                  <tr key={cn.id}>
                    <td className="mono">{cn.reference}</td>
                    <td>{cn.note_date}</td>
                    <td className="mono">{cn.invoice_label || cn.invoice}</td>
                    <td>{cn.product_label || '—'}</td>
                    <td className="num">{Number(cn.quantity || 0).toLocaleString()}</td>
                    <td className="num">{fmtMoney(cn.total, cn.currency)}</td>
                    <td className="text-truncate" style={{ maxWidth: 240 }}>{cn.reason || '—'}</td>
                    <td><span className={`status ${cn.status === 'POSTED' ? 'status-posted' : 'status-draft'}`}>{cn.status}</span></td>
                    <td className="col-actions">
                      {cn.status === 'DRAFT' && can('sales.edit') && (
                        <button className="btn btn-xs btn-primary" onClick={() => post(cn)}>Post</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <CreditNoteModal row={editing} companyParams={companyParams}
                         onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function CreditNoteModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [invoices, setInvoices] = useState([]);
  const [products, setProducts] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({
    invoice: row.invoice || '', product: row.product || '',
    note_date: row.note_date || todayISO(), quantity: row.quantity ?? '',
    unit_price: row.unit_price ?? '', tax_rate: row.tax_rate ?? '',
    reason: row.reason || '', restock_tank: row.restock_tank || '',
    currency: row.currency || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.salesInvoices.listAll({ ...companyParams(), status: 'POSTED' }).catch(() => []),
      api.products.listAll(),
      api.storageTanks.listAll({ ...companyParams() }),
      api.currencies.listAll(),
    ]).then(([i, p, t, c]) => { setInvoices(i); setProducts(p); setTanks(t); setCurrencies(c); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form, company: companyParams().company };
      ['product', 'restock_tank', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
      isNew ? await api.salesCreditNotes.create(body) : await api.salesCreditNotes.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New credit note' : `Edit ${row.reference}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Invoice" required>
                <select className="select" value={form.invoice} onChange={set('invoice')} required>
                  <option value="">—</option>
                  {invoices.map((i) => <option key={i.id} value={i.id}>{i.reference} · {i.customer_label || i.customer} · {fmtMoney(i.total, i.currency)}</option>)}
                </select>
              </Field>
              <Field label="Product">
                <select className="select" value={form.product} onChange={set('product')}>
                  <option value="">—</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </Field>
              <Field label="Note date" required>
                <input type="date" className="input" value={form.note_date} onChange={set('note_date')} required />
              </Field>
              <Field label="Currency">
                <select className="select" value={form.currency} onChange={set('currency')}>
                  <option value="">Functional</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Quantity" required>
                <input type="number" step="0.001" className="input num" value={form.quantity} onChange={set('quantity')} required />
              </Field>
              <Field label="Unit price" required>
                <input type="number" step="0.000001" className="input num" value={form.unit_price} onChange={set('unit_price')} required />
              </Field>
              <Field label="Tax rate %">
                <input type="number" step="0.001" className="input num" value={form.tax_rate} onChange={set('tax_rate')} />
              </Field>
              <Field label="Restock tank">
                <select className="select" value={form.restock_tank} onChange={set('restock_tank')}>
                  <option value="">— do not restock —</option>
                  {tanks.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </Field>
              <Field label="Reason" span><textarea className="textarea" rows={2} value={form.reason} onChange={set('reason')} /></Field>
            </div>
            <p className="field-hint mt-3">
              Credit note cannot exceed the invoice balance. Restocking creates a stock return at delivered cost.
            </p>
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