/**
 * Goods receipts — read-only (created by PO receive action).
 * - GET /goods-receipts/   readOnly, filter by purchase_order
 * - "View" opens the receipt details (measurements, tank, cost) with a link back to the purchase order.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import Modal from '../../components/Modal';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';
import { KV } from '../../components/PageSection';

const num = (v, d = 0) => (v == null || v === '' ? '—'
  : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));

export default function GoodsReceipts() {
  const { companyParams, activeCompanyObj } = useApp();
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewing, setViewing] = useState(null);

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
          <TableSkeleton rows={8} columns={11} />
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
                    <th style={{ width: '4rem' }}>Actions</th>
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
                      <td>
                        <button
                          type="button"
                          className="btn btn-icon"
                          title="View GRN details"
                          aria-label={`View ${g.reference}`}
                          onClick={() => setViewing(g)}
                        >
                          <i className="bi bi-eye"></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {viewing && <GrnModal grn={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ details */

function GrnModal({ grn: g, onClose }) {
  const basisStandardized = g.volume_basis === 'STANDARDIZED';

  return (
    <Modal
      show
      onClose={onClose}
      title="Goods receipt"
      subtitle={g.reference}
      icon="bi-box-arrow-in-down"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <Link to={`/procurement/purchase-orders/${g.purchase_order}`} className="btn btn-primary" onClick={onClose}>
            <i className="bi bi-bag-check"></i>
            View purchase order
          </Link>
        </>
      }
    >
      <h6 className="modal-section-title">
        <i className="bi bi-card-text" aria-hidden="true"></i>Receipt Details
      </h6>
      <KV items={[
        ['Reference', g.reference],
        ['Status', g.status],
        ['Receipt date', g.receipt_date],
        ['Purchase order', g.purchase_order_label || g.purchase_order],
        ['Product / line', g.line_label || '—'],
        ['Depot', g.depot_label || '—'],
        ['Tank', g.tank_label || '—'],
        ['Delivery note', g.delivery_note || '—'],
        ['Vehicle reg', g.vehicle_reg || '—'],
      ]} />

      <h6 className="modal-section-title">
        <i className="bi bi-thermometer-half" aria-hidden="true"></i>Volume & Measurement
      </h6>
      <KV items={[
        ['Observed volume (L)', num(g.observed_volume, 3)],
        ['Standardized volume (L)', num(g.standardized_volume, 3)],
        ['Temperature (°C)', num(g.temperature_c, 2)],
        ['Density', num(g.density, 4)],
        ['Quantity basis', g.volume_basis],
        ['Quantity booked (L)', num(g.quantity, 3)],
      ]} />
      <p className="text-muted-soft mt-2" style={{ fontSize: '0.8125rem' }}>
        {basisStandardized
          ? 'Stock was booked on the standardized volume.'
          : 'Stock was booked on the observed volume (no standardized volume was entered).'}
      </p>

      <h6 className="modal-section-title">
        <i className="bi bi-cash-coin" aria-hidden="true"></i>Cost
      </h6>
      <KV items={[
        ['Unit cost (functional)', num(g.unit_cost, 6)],
        ['Total cost (functional)', num(g.total_cost, 2)],
      ]} />
      <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
        Posted as Dr Inventory / Cr GRNI. The supplier invoice clears GRNI when it is posted.
      </p>
    </Modal>
  );
}