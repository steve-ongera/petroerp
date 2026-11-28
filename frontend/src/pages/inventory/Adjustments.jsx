/**
 * Stock adjustments (from tank reconciliation) · read-only list.
 * Adjustments are created by /tank-reconciliations/:id/raise-adjustment/ and approved on the Approvals page.
 * - GET /stock-adjustments/     readOnly
 * - GET /stock-transfers/       readOnly (historical transfers)
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const adjPill = (s) =>
  s === 'APPROVED' ? 'status-pill--success' : s === 'REJECTED' ? 'status-pill--danger' : 'status-pill--warning';

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

  const activeRows = tab === 'adjustments' ? adjustments : transfers;
  const { pageRows, paginationProps } = usePagination(activeRows);

  return (
    <div>
      {/* ---------- Page header: icon tile + title ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Adjustments &amp; transfers</h1>
            <p className="page-subtitle">
              Stock adjustments and inter-tank transfers{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      {/* ---------- Tabs sitting on top of the white card ---------- */}
      <div className="page-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'adjustments'}
          className={`page-tab${tab === 'adjustments' ? ' is-active' : ''}`} onClick={() => setTab('adjustments')}>
          <i className="bi bi-sliders"></i> Adjustments <span className="tab__count">{adjustments.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'transfers'}
          className={`page-tab${tab === 'transfers' ? ' is-active' : ''}`} onClick={() => setTab('transfers')}>
          <i className="bi bi-arrow-left-right"></i> Transfers <span className="tab__count">{transfers.length}</span>
        </button>
      </div>

      <section className="page-card">
        <div className="table-wrap__header">
          <span className="panel-title">
            <i className={`bi ${tab === 'adjustments' ? 'bi-sliders' : 'bi-arrow-left-right'} text-brand`}></i>
            {tab === 'adjustments' ? 'Adjustment List' : 'Transfer List'}
          </span>
          <span className="chart-card__subtitle">
            {activeRows.length} {tab === 'adjustments' ? 'adjustment' : 'transfer'}{activeRows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={tab === 'adjustments' ? 9 : 7} />
        ) : activeRows.length === 0 ? (
          <div className="empty-state">
            <i className={`bi ${tab === 'adjustments' ? 'bi-sliders' : 'bi-arrow-left-right'}`}></i>
            <h6>{tab === 'adjustments' ? 'No adjustments' : 'No transfers'}</h6>
            <p className="text-muted-soft">
              {tab === 'adjustments' ? 'Raise one from a tank reconciliation.' : 'Use the Stock page to create a transfer.'}
            </p>
          </div>
        ) : tab === 'adjustments' ? (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th>Tank</th>
                    <th>Product</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Value</th>
                    <th>Reason</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((a) => (
                    <tr key={a.id}>
                      <td className="cell-mono text-brand fw-600">{a.reference}</td>
                      <td>{a.adjustment_date}</td>
                      <td className="cell-mono">{a.tank_label || a.tank}</td>
                      <td>{a.product_label || a.product}</td>
                      <td className="cell-num">{Number(a.quantity).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                      <td className="cell-num">{Number(a.unit_cost).toFixed(6)}</td>
                      <td className="cell-num">{fmtMoney(a.value)}</td>
                      <td className="text-truncate" style={{ maxWidth: 220 }}>{a.reason || '—'}</td>
                      <td><span className={`status-pill ${adjPill(a.status)}`}>{a.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th>From tank</th>
                    <th>To tank</th>
                    <th className="text-right">Quantity</th>
                    <th>Notes</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => (
                    <tr key={t.id}>
                      <td className="cell-mono text-brand fw-600">{t.reference}</td>
                      <td>{t.transfer_date}</td>
                      <td className="cell-mono">{t.from_tank_label || t.from_tank}</td>
                      <td className="cell-mono">{t.to_tank_label || t.to_tank}</td>
                      <td className="cell-num">{Number(t.quantity).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                      <td className="text-truncate" style={{ maxWidth: 240 }}>{t.notes || '—'}</td>
                      <td><span className="status-pill status-pill--success">{t.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && activeRows.length > 0 && <Pagination {...paginationProps} />}
      </section>
    </div>
  );
}