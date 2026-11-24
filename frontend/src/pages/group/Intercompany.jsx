/**
 * Intercompany transactions.
 * - GET  /intercompany/            readOnly, filtered to txn where user has access to either company
 * - POST /intercompany/sale/       create_intercompany_sale (posts BOTH entities' journals)
 * - POST /intercompany/:id/settle/ settle_intercompany
 * - POST /intercompany/reconcile/  reconcile_intercompany({ as_of })
 *
 * Everything is dual-entity: the seller gets IC receivable/revenue, the buyer IC payable + inventory.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Intercompany() {
  const { can } = useAuth();
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState(null);
  const [recon, setRecon] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.intercompany.list({ ordering: '-id', page_size: 200 });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reconcile = async () => {
    const as_of = window.prompt('Reconcile as of (YYYY-MM-DD):', todayISO());
    if (!as_of) return;
    try { setRecon(await api.intercompany.reconcile(as_of)); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Intercompany</h1>
          <p className="page-header__subtitle">Cross-entity sales, settlements and reconciliation</p>
        </div>
        <div className="page-header__actions">
          <button className="btn" onClick={reconcile}>Reconcile</button>
          {can('group.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg" /> IC sale
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No intercompany transactions</div>
            <div>Record an intercompany sale to start.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>From</th><th>To</th>
                <th>Product</th><th className="num">Qty</th><th className="num">Amount</th>
                <th className="num">Outstanding</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.reference}</td>
                    <td>{t.txn_date}</td>
                    <td>{t.from_company_label || t.from_company}</td>
                    <td>{t.to_company_label || t.to_company}</td>
                    <td>{t.product_label || '—'}</td>
                    <td className="num">{Number(t.quantity || 0).toLocaleString()}</td>
                    <td className="num">{fmtMoney(t.amount, t.currency)}</td>
                    <td className="num">{fmtMoney(t.outstanding, t.currency)}</td>
                    <td><span className={`status ${t.status === 'SETTLED' ? 'status-closed' : t.status === 'PART_SETTLED' ? 'status-pending' : 'status-active'}`}>{t.status}</span></td>
                    <td className="col-actions">
                      {t.outstanding > 0 && can('group.edit') && (
                        <button className="btn btn-xs" onClick={() => setSettling(t)}>Settle</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <ICSaleModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); notify('IC sale posted.', 'success'); load(); }} />
      )}
      {settling && (
        <SettleModal txn={settling} onClose={() => setSettling(null)} onDone={() => { setSettling(null); notify('Settled.', 'success'); load(); }} />
      )}
      {recon && (
        <ReconModal data={recon} onClose={() => setRecon(null)} />
      )}
    </div>
  );
}

function ICSaleModal({ onClose, onDone }) {
  const [companies, setCompanies] = useState([]);
  const [products, setProducts] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [form, setForm] = useState({
    seller: '', buyer: '', product: '', quantity: '', transfer_price: '',
    currency: '', date: todayISO(), from_tank: '', to_tank: '', shipment: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.companies.listAll(),
      api.products.listAll(),
      api.storageTanks.listAll({ page_size: 500 }),
      api.shipments.listAll({ status: 'DELIVERED' }),
    ]).then(([co, pr, tk, sh]) => { setCompanies(co); setProducts(pr); setTanks(tk); setShipments(sh); }).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      ['from_tank', 'to_tank', 'shipment'].forEach((k) => { if (!body[k]) delete body[k]; });
      await api.intercompany.sale(body);
      onDone();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  const tanksFor = (cid) => tanks.filter((t) => String(t.company) === String(cid));

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">New intercompany sale</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Seller" required err={fieldErr.seller}>
                <select className="select" value={form.seller} onChange={set('seller')} required>
                  <option value="">—</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Buyer" required err={fieldErr.buyer}>
                <select className="select" value={form.buyer} onChange={set('buyer')} required>
                  <option value="">—</option>
                  {companies.filter((c) => String(c.id) !== String(form.seller)).map((c) =>
                    <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Product" required>
                <select className="select" value={form.product} onChange={set('product')} required>
                  <option value="">—</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </Field>
              <Field label="Currency" required>
                <input className="input mono" value={form.currency} onChange={set('currency')} placeholder="USD/KES/CDF" required />
              </Field>
              <Field label="Quantity" required>
                <input type="number" step="0.001" className="input num" value={form.quantity} onChange={set('quantity')} required />
              </Field>
              <Field label="Transfer price" required>
                <input type="number" step="0.000001" className="input num" value={form.transfer_price} onChange={set('transfer_price')} required />
              </Field>
              <Field label="Date" required>
                <input type="date" className="input" value={form.date} onChange={set('date')} required />
              </Field>
              <Field label="From tank (seller)">
                <select className="select" value={form.from_tank} onChange={set('from_tank')}>
                  <option value="">— no stock movement —</option>
                  {tanksFor(form.seller).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </Field>
              <Field label="To tank (buyer)">
                <select className="select" value={form.to_tank} onChange={set('to_tank')}>
                  <option value="">— no stock movement —</option>
                  {tanksFor(form.buyer).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </Field>
              <Field label="Shipment (optional)">
                <select className="select" value={form.shipment} onChange={set('shipment')}>
                  <option value="">—</option>
                  {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference}</option>)}
                </select>
              </Field>
              <Field label="Notes" span>
                <input className="input" value={form.notes} onChange={set('notes')} />
              </Field>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post IC sale'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettleModal({ txn, onClose, onDone }) {
  const [form, setForm] = useState({ amount: txn.outstanding ?? '', date: todayISO(), seller_bank: '', buyer_bank: '' });
  const [banks, setBanks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api.bankAccounts.listAll({ page_size: 500 }).then(setBanks).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.intercompany.settle(txn.id, form); onDone(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Settle {txn.reference}</h2>
            <p className="modal__subtitle">Outstanding: {fmtMoney(txn.outstanding, txn.currency)}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <div className="field">
                <label className="label label--required">Amount</label>
                <input type="number" step="0.01" className="input num" value={form.amount} onChange={set('amount')} required />
              </div>
              <div className="field">
                <label className="label label--required">Date</label>
                <input type="date" className="input" value={form.date} onChange={set('date')} required />
              </div>
              <div className="field">
                <label className="label label--required">Seller bank account</label>
                <select className="select" value={form.seller_bank} onChange={set('seller_bank')} required>
                  <option value="">—</option>
                  {banks.filter((b) => String(b.company) === String(txn.from_company))
                    .map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label label--required">Buyer bank account</label>
                <select className="select" value={form.buyer_bank} onChange={set('buyer_bank')} required>
                  <option value="">—</option>
                  {banks.filter((b) => String(b.company) === String(txn.to_company))
                    .map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
                </select>
              </div>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Settling…' : 'Settle'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReconModal({ data, onClose }) {
  const allOk = data.every((r) => r.reconciled);
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__dialog modal__dialog--xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Intercompany reconciliation</h2>
            <span className={`badge ${allOk ? 'badge--success' : 'badge--warning'}`}>{allOk ? 'All matched' : 'Differences'}</span>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          {!data.length ? <p className="text-muted">No open intercompany pairs.</p> : (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead><tr>
                  <th>Seller</th><th>Buyer</th><th>Ccy</th>
                  <th className="num">Subledger R</th><th className="num">Subledger P</th>
                  <th className="num">GL R</th><th className="num">GL P</th>
                  <th className="num">Difference</th><th>Result</th>
                </tr></thead>
                <tbody>
                  {data.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.seller}</td>
                      <td className="mono">{r.buyer}</td>
                      <td>{r.currency}</td>
                      <td className="num">{fmtMoney(r.subledger_receivable)}</td>
                      <td className="num">{fmtMoney(r.subledger_payable)}</td>
                      <td className="num">{fmtMoney(r.gl_receivable)}</td>
                      <td className="num">{fmtMoney(r.gl_payable)}</td>
                      <td className="num">{fmtMoney(r.difference)}</td>
                      <td><span className={`badge ${r.reconciled ? 'badge--success' : 'badge--danger'}`}>{r.reconciled ? 'OK' : 'Diff'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal__footer"><button className="btn" onClick={onClose}>Close</button></div>
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