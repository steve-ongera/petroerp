/**
 * Purchase returns.
 * - POST /purchase-returns/  { goods_receipt, quantity, return_date?, reason? }
 * - GET  /goods-receipts/ (picker)  → GRN to return against
 * - GET  /purchase-returns/ (readOnly list)
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import { Field } from './Suppliers';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Returns() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [grns, setGrns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [r, g] = await Promise.all([
        api.purchaseReturns.list({ ...companyParams(), ordering: '-id', page_size: 500 }),
        api.goodsReceipts.listAll({ ...companyParams(), status: 'POSTED', ordering: '-receipt_date' }),
      ]);
      setRows(r?.results || r || []); setGrns(g);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Purchase returns</h1>
          <p className="page-header__subtitle">
            Return goods to supplier{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('inventory.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg" /> New return
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No returns</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>Goods receipt</th>
                <th className="num">Qty</th><th className="num">Value</th>
                <th>Reason</th><th>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.reference}</td>
                    <td>{r.return_date}</td>
                    <td className="mono">{r.goods_receipt_label || r.goods_receipt}</td>
                    <td className="num">{Number(r.quantity).toLocaleString()}</td>
                    <td className="num">{fmtMoney(r.value)}</td>
                    <td className="text-truncate" style={{ maxWidth: 260 }}>{r.reason || '—'}</td>
                    <td><span className="status status-posted">{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <ReturnModal grns={grns} onClose={() => setCreating(false)}
                     onDone={() => { setCreating(false); notify('Return posted.', 'success'); load(); }} />
      )}
    </div>
  );
}

function ReturnModal({ grns, onClose, onDone }) {
  const [form, setForm] = useState({
    goods_receipt: '', quantity: '', return_date: todayISO(), reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const selected = grns.find((g) => String(g.id) === String(form.goods_receipt));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.purchaseReturns.create(form); onDone(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">New purchase return</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <Field label="Goods receipt" required>
                <select className="select" value={form.goods_receipt} onChange={set('goods_receipt')} required>
                  <option value="">—</option>
                  {grns.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.reference} · {Number(g.quantity).toLocaleString()} L · {g.receipt_date}
                    </option>
                  ))}
                </select>
              </Field>
              {selected && (
                <p className="field-hint">Available: {Number(selected.quantity).toLocaleString()} L</p>
              )}
              <div className="form-grid">
                <Field label="Quantity" required>
                  <input type="number" step="0.001" className="input num" value={form.quantity} onChange={set('quantity')} required />
                </Field>
                <Field label="Date" required>
                  <input type="date" className="input" value={form.return_date} onChange={set('return_date')} required />
                </Field>
              </div>
              <Field label="Reason"><textarea className="textarea" rows={2} value={form.reason} onChange={set('reason')} /></Field>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post return'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}