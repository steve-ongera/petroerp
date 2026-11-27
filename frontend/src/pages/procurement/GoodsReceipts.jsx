/**
 * Goods receipts — read-only (created by PO receive action).
 * - GET /goods-receipts/   readOnly, filter by purchase_order
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

export default function GoodsReceipts() {
  const { companyParams, activeCompanyObj } = useApp();
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
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
      setAllRows(res);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, from, to]);

  useEffect(() => { load(); }, [load]);

  // Date range is applied by the server; text search is done in the browser.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((g) =>
      [g.reference, g.purchase_order_label, g.purchase_order, g.line_label, g.vehicle_reg]
        .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [allRows, search]);

  const hasActiveFilters = !!(search || from || to);
  const clearFilters = () => { setSearch(''); setFrom(''); setTo(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-box-arrow-in-down"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Goods receipts</h1>
            <p className="page-subtitle">
              Received stock{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
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

      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by reference, PO, product or vehicle..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search goods receipts"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <input type="date" className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" title="From date" />
          <input type="date" className="form-control" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" title="To date" />
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
            {from && (
              <span className="filter-chip">
                From: {from}
                <button onClick={() => setFrom('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {to && (
              <span className="filter-chip">
                To: {to}
                <button onClick={() => setTo('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Goods Receipt List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} receipt{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={10} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-box-seam"></i>
            <h6>{hasActiveFilters ? 'No receipts match your search' : 'No receipts yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or dates' : 'Receipts are created when goods are received against a purchase order'}
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
                    <th>PO</th>
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th>Basis</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Total</th>
                    <th>Vehicle</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((g) => (
                    <tr key={g.id}>
                      <td className="cell-mono text-brand fw-600">{g.reference}</td>
                      <td>{g.receipt_date}</td>
                      <td className="cell-mono">{g.purchase_order_label || g.purchase_order}</td>
                      <td className="cell-name">{g.line_label || '—'}</td>
                      <td className="cell-num">{Number(g.quantity).toLocaleString()}</td>
                      <td><span className="badge badge-neutral">{g.volume_basis}</span></td>
                      <td className="cell-num">{Number(g.unit_cost).toFixed(6)}</td>
                      <td className="cell-num">{Number(g.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="cell-mono">{g.vehicle_reg || '—'}</td>
                      <td><span className="status-pill status-pill--info">{g.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>
    </div>
  );
}