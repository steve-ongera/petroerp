/**
 * Goods receipts — read-only (created by PO receive action).
 * - GET /goods-receipts/   readOnly, filter by purchase_order
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

export default function GoodsReceipts() {
  const { companyParams, activeCompanyObj } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.goodsReceipts.listAll({
        ...companyParams(), ordering: '-receipt_date',
        ...(from ? { date_from: from } : {}),
        ...(to ? { date_to: to } : {}),
      });
      setRows(res);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Goods receipts</h1>
          <p className="page-header__subtitle">
            Received stock{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No receipts</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>PO</th><th>Product</th>
                <th className="num">Qty</th><th>Basis</th><th className="num">Unit cost</th>
                <th className="num">Total</th><th>Vehicle</th><th>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id}>
                    <td className="mono">{g.reference}</td>
                    <td>{g.receipt_date}</td>
                    <td className="mono">{g.purchase_order_label || g.purchase_order}</td>
                    <td>{g.line_label || '—'}</td>
                    <td className="num">{Number(g.quantity).toLocaleString()}</td>
                    <td><span className="badge">{g.volume_basis}</span></td>
                    <td className="num">{Number(g.unit_cost).toFixed(6)}</td>
                    <td className="num">{Number(g.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="mono">{g.vehicle_reg || '—'}</td>
                    <td><span className="status status-posted">{g.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}