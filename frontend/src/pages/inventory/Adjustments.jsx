/**
 * Stock adjustments (from tank reconciliation) — read-only list.
 * Adjustments are created by /tank-reconciliations/:id/raise-adjustment/ and approved on the Approvals page.
 * - GET /stock-adjustments/     readOnly
 * - GET /stock-transfers/       readOnly (historical transfers)
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Adjustments() {
  const { companyParams, activeCompanyObj } = useApp();
  const [tab, setTab] = useState('adjustments');
  const [adjustments, setAdjustments] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [a, t] = await Promise.all([
        api.stockAdjustments.listAll({ ...companyParams(), ordering: '-id' }),
        api.stockTransfers.listAll({ ...companyParams(), ordering: '-id' }),
      ]);
      setAdjustments(a); setTransfers(t);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Adjustments & transfers</h1>
          <p className="page-header__subtitle">
            Stock adjustments and inter-tank transfers{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'adjustments' ? 'active' : ''}`} onClick={() => setTab('adjustments')}>
          Adjustments <span className="tab__count">{adjustments.length}</span>
        </button>
        <button className={`tab ${tab === 'transfers' ? 'active' : ''}`} onClick={() => setTab('transfers')}>
          Transfers <span className="tab__count">{transfers.length}</span>
        </button>
      </div>

      {error ? (
        <div className="card"><div className="card__body">
          <p className="field-error" role="alert">{error}</p>
          <button className="btn mt-2" onClick={load}>Try again</button>
        </div></div>
      ) : loading ? (
        <div className="state-screen">Loading…</div>
      ) : tab === 'adjustments' ? (
        <div className="table-card">
          {!adjustments.length ? (
            <div className="table-empty">
              <div className="table-empty__title">No adjustments</div>
              <div>Raise one from a tank reconciliation.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>Reference</th><th>Date</th><th>Tank</th><th>Product</th>
                  <th className="num">Quantity</th><th className="num">Unit cost</th><th className="num">Value</th>
                  <th>Reason</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{a.reference}</td>
                      <td>{a.adjustment_date}</td>
                      <td className="mono">{a.tank_label || a.tank}</td>
                      <td>{a.product_label || a.product}</td>
                      <td className="num">{Number(a.quantity).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                      <td className="num">{Number(a.unit_cost).toFixed(6)}</td>
                      <td className="num">{fmtMoney(a.value)}</td>
                      <td className="text-truncate" style={{ maxWidth: 220 }}>{a.reason || '—'}</td>
                      <td><span className={`status ${a.status === 'APPROVED' ? 'status-active' : a.status === 'REJECTED' ? 'status-rejected' : 'status-pending'}`}>{a.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="table-card">
          {!transfers.length ? (
            <div className="table-empty">
              <div className="table-empty__title">No transfers</div>
              <div>Use the Stock page to create a transfer.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>Reference</th><th>Date</th><th>From tank</th><th>To tank</th>
                  <th className="num">Quantity</th><th>Notes</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {transfers.map((t) => (
                    <tr key={t.id}>
                      <td className="mono">{t.reference}</td>
                      <td>{t.transfer_date}</td>
                      <td className="mono">{t.from_tank_label || t.from_tank}</td>
                      <td className="mono">{t.to_tank_label || t.to_tank}</td>
                      <td className="num">{Number(t.quantity).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                      <td className="text-truncate" style={{ maxWidth: 240 }}>{t.notes || '—'}</td>
                      <td><span className="status status-posted">{t.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}