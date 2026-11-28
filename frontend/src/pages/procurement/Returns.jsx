/**
 * Purchase returns.
 * - POST /purchase-returns/  { goods_receipt, quantity, return_date?, reason? }
 * - GET  /goods-receipts/ (picker)  ? GRN to return against
 * - GET  /purchase-returns/ (readOnly list)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Returns() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [allRows, setAllRows] = useState([]);
  const [grns, setGrns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [r, g] = await Promise.all([
        api.purchaseReturns.list({ ...companyParams(), ordering: '-id', page_size: 500 }),
        api.goodsReceipts.listAll({ ...companyParams(), status: 'POSTED', ordering: '-receipt_date' }),
      ]);
      setAllRows(r?.results || r || []); setGrns(g);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  // The list endpoint is read-only with no search params, so filter in the browser.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) =>
      [r.reference, r.goods_receipt_label, r.goods_receipt, r.reason]
        .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [allRows, search]);

  const hasActiveFilters = !!search;
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Purchase returns</h1>
            <p className="page-subtitle">
              Return goods to supplier{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('inventory.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg"></i>
              New return
            </button>
          )}
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
              placeholder="Search by reference, goods receipt or reason..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search returns"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
        </div>

        {hasActiveFilters && (
          <div className="chip-row">
            <span className="filter-chip">
              Search: "{search}"
              <button onClick={() => setSearch('')}><i className="bi bi-x"></i></button>
            </span>
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Return List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} return{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-arrow-return-left"></i>
            <h6>{hasActiveFilters ? 'No returns match your search' : 'No returns yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search' : "Click 'New return' to add the first one"}
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
                    <th>Goods receipt</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Value</th>
                    <th>Reason</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-mono text-brand fw-600">{r.reference}</td>
                      <td>{r.return_date}</td>
                      <td className="cell-mono">{r.goods_receipt_label || r.goods_receipt}</td>
                      <td className="cell-num">{Number(r.quantity).toLocaleString()}</td>
                      <td className="cell-num">{fmtMoney(r.value)}</td>
                      <td className="text-truncate" style={{ maxWidth: 260 }}>{r.reason || '—'}</td>
                      <td><span className="status-pill status-pill--info">{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {creating && (
        <ReturnModal
          grns={grns}
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); notify('Return posted.', 'success'); load(); }}
        />
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
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const selected = grns.find((g) => String(g.id) === String(form.goods_receipt));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try { await api.purchaseReturns.create(form); onDone(); }
    catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="New purchase return"
      subtitle="Return goods to supplier"
      icon="bi-arrow-return-left"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="returnForm" disabled={busy}>
            <i className="bi bi-check-lg"></i>
            {busy ? 'Posting...' : 'Post return'}
          </button>
        </>
      }
    >
      <form id="returnForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Return Details</h6>
        <div className="form-grid">
          <Field label="Goods receipt" required err={fieldErr.goods_receipt} span>
            <select className="form-select" value={form.goods_receipt} onChange={set('goods_receipt')} required>
              <option value="">—</option>
              {grns.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.reference} · {Number(g.quantity).toLocaleString()} L · {g.receipt_date}
                </option>
              ))}
            </select>
            {selected && (
              <span className="text-muted-soft" style={{ fontSize: '0.75rem' }}>
                Available: {Number(selected.quantity).toLocaleString()} L
              </span>
            )}
          </Field>
          <Field label="Quantity" required err={fieldErr.quantity}>
            <input type="number" step="0.001" className="form-control num" value={form.quantity} onChange={set('quantity')} required />
          </Field>
          <Field label="Date" required>
            <input type="date" className="form-control" value={form.return_date} onChange={set('return_date')} required />
          </Field>
          <Field label="Reason" span>
            <textarea className="form-control" rows={2} value={form.reason} onChange={set('reason')} />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}