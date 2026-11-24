/**
 * Stock on hand + movements + operations.
 * - GET  /stock-balances/    readOnly (filter by tank/product)
 * - GET  /stock-movements/   readOnly (date range, filter by tank/product/movement_type)
 * - GET  /stock-reservations/readOnly
 * - POST /stock/transfer/    { company, from_tank, to_tank, quantity, date, notes }
 * - POST /stock/opening/     { tank, product, quantity, unit_cost, date }
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const MOVEMENT_TYPES = ['OPENING', 'RECEIPT', 'TRANSFER_IN', 'RETURN_IN', 'ADJ_IN', 'ISSUE', 'TRANSFER_OUT', 'RETURN_OUT', 'ADJ_OUT'];
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Stock() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [tab, setTab] = useState('balances');
  const [balances, setBalances] = useState([]);
  const [movements, setMovements] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tankFilter, setTankFilter] = useState('');
  const [moving, setMoving] = useState(false);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const common = { ...companyParams(), ...(tankFilter ? { tank: tankFilter } : {}) };
      const [b, m, r, t, p] = await Promise.all([
        api.stockBalances.listAll(common),
        api.stockMovements.listAll({
          ...common,
          ordering: '-movement_date',
          ...(from ? { date_from: from } : {}),
          ...(to ? { date_to: to } : {}),
          page_size: 1000,
        }),
        api.stockReservations.listAll(common),
        api.storageTanks.listAll({ ...companyParams() }),
        api.products.listAll(),
      ]);
      setBalances(b); setMovements(m); setReservations(r); setTanks(t); setProducts(p);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, tankFilter, from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Stock</h1>
          <p className="page-header__subtitle">
            On-hand balances, movements and reservations{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('inventory.edit') && (
            <>
              <button className="btn" onClick={() => setOpening(true)}>Opening stock</button>
              <button className="btn btn-primary" onClick={() => setMoving(true)}>Stock transfer</button>
            </>
          )}
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'balances' ? 'active' : ''}`} onClick={() => setTab('balances')}>
          Balances <span className="tab__count">{balances.length}</span>
        </button>
        <button className={`tab ${tab === 'movements' ? 'active' : ''}`} onClick={() => setTab('movements')}>
          Movements <span className="tab__count">{movements.length}</span>
        </button>
        <button className={`tab ${tab === 'reservations' ? 'active' : ''}`} onClick={() => setTab('reservations')}>
          Reservations <span className="tab__count">{reservations.length}</span>
        </button>
      </div>

      <div className="filters">
        <select className="select" value={tankFilter} onChange={(e) => setTankFilter(e.target.value)}>
          <option value="">All tanks</option>
          {tanks.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
        </select>
        {tab === 'movements' && (
          <>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
      </div>

      {error ? (
        <div className="card"><div className="card__body">
          <p className="field-error" role="alert">{error}</p>
          <button className="btn mt-2" onClick={load}>Try again</button>
        </div></div>
      ) : loading ? (
        <div className="state-screen">Loading…</div>
      ) : tab === 'balances' ? (
        <div className="table-card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Tank</th><th>Product</th><th className="num">Quantity (L)</th><th className="num">Value</th><th className="num">Avg cost / L</th></tr></thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.tank_label || b.tank}</td>
                    <td>{b.product_label || b.product}</td>
                    <td className="num">{Number(b.quantity || 0).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                    <td className="num">{Number(b.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="num">{b.quantity ? Number(b.value / b.quantity).toFixed(6) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'movements' ? (
        <div className="table-card">
          <div className="table-wrap">
            <table className="table table--compact">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>Tank</th><th>Type</th>
                <th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Total</th>
                <th className="num">Balance after</th><th>Shipment</th>
              </tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.reference}</td>
                    <td>{m.movement_date}</td>
                    <td className="mono">{m.tank_label || m.tank}</td>
                    <td><span className={`badge ${['ISSUE', 'TRANSFER_OUT', 'RETURN_OUT', 'ADJ_OUT'].includes(m.movement_type) ? 'badge--warning' : 'badge--success'}`}>{m.movement_type}</span></td>
                    <td className="num">{Number(m.quantity).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                    <td className="num">{Number(m.unit_cost).toFixed(6)}</td>
                    <td className="num">{Number(m.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="num">{Number(m.balance_after).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                    <td className="text-sm">{m.shipment_label || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-wrap">
            <table className="table table--compact">
              <thead><tr><th>Reference</th><th>Depot</th><th>Product</th><th className="num">Qty</th><th>Sales order</th><th>Status</th></tr></thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.reference}</td>
                    <td>{r.depot_label || r.depot}</td>
                    <td>{r.product_label || r.product}</td>
                    <td className="num">{Number(r.quantity).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                    <td>{r.sales_order_label || '—'}</td>
                    <td><span className={`status ${r.status === 'ACTIVE' ? 'status-active' : r.status === 'CONSUMED' ? 'status-posted' : 'status-closed'}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {moving && (
        <TransferModal tanks={tanks} companyParams={companyParams}
                       onClose={() => setMoving(false)} onDone={() => { setMoving(false); notify('Transfer posted.', 'success'); load(); }} />
      )}
      {opening && (
        <OpeningModal tanks={tanks} products={products}
                      onClose={() => setOpening(false)} onDone={() => { setOpening(false); notify('Opening stock posted.', 'success'); load(); }} />
      )}
    </div>
  );
}

function TransferModal({ tanks, companyParams, onClose, onDone }) {
  const [form, setForm] = useState({ from_tank: '', to_tank: '', quantity: '', date: todayISO(), notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.stock.transfer({ ...form, company: companyParams().company }); onDone(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">Stock transfer</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <div className="field">
                <label className="label label--required">From tank</label>
                <select className="select" value={form.from_tank} onChange={set('from_tank')} required>
                  <option value="">—</option>
                  {tanks.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name} · {t.product_label || ''}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label label--required">To tank</label>
                <select className="select" value={form.to_tank} onChange={set('to_tank')} required>
                  <option value="">—</option>
                  {tanks.filter((t) => String(t.id) !== String(form.from_tank)).map((t) =>
                    <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label className="label label--required">Quantity (L)</label>
                  <input type="number" step="0.001" className="input num" value={form.quantity} onChange={set('quantity')} required />
                </div>
                <div className="field">
                  <label className="label label--required">Date</label>
                  <input type="date" className="input" value={form.date} onChange={set('date')} required />
                </div>
              </div>
              <div className="field">
                <label className="label">Notes</label>
                <input className="input" value={form.notes} onChange={set('notes')} />
              </div>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post transfer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OpeningModal({ tanks, products, onClose, onDone }) {
  const [form, setForm] = useState({ tank: '', product: '', quantity: '', unit_cost: '', date: todayISO() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.stock.opening(form); onDone(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">Opening stock</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <div className="field">
                <label className="label label--required">Tank</label>
                <select className="select" value={form.tank} onChange={set('tank')} required>
                  <option value="">—</option>
                  {tanks.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label label--required">Product</label>
                <select className="select" value={form.product} onChange={set('product')} required>
                  <option value="">—</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label className="label label--required">Quantity (L)</label>
                  <input type="number" step="0.001" className="input num" value={form.quantity} onChange={set('quantity')} required />
                </div>
                <div className="field">
                  <label className="label label--required">Unit cost</label>
                  <input type="number" step="0.000001" className="input num" value={form.unit_cost} onChange={set('unit_cost')} required />
                </div>
              </div>
              <div className="field">
                <label className="label label--required">Date</label>
                <input type="date" className="input" value={form.date} onChange={set('date')} required />
              </div>
            </div>
            <p className="field-hint mt-3">Posts Dr Inventory / Cr Opening equity at the entered cost.</p>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post opening'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}