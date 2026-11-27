/**
 * Purchase invoices.
 * - CRUD /purchase-invoices/ (nested lines)
 * - POST /purchase-invoices/:id/match/  (three-way match check)
 * - POST /purchase-invoices/:id/post/   { override }
 * - POST /supplier-credit-notes/:id/post/  via SupplierCreditNotes.jsx (or inline)
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import ServerPagination from '../../components/ServerPagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUSES = ['DRAFT', 'POSTED', 'PART_PAID', 'PAID', 'CANCELLED'];
const MATCH_STATUS = ['UNMATCHED', 'MATCHED', 'QTY_VARIANCE', 'PRICE_VARIANCE', 'NO_RECEIPT'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyLine = () => ({ po_line: '', product: '', quantity: '', unit_price: '', tax_code: '' });

const statusPill = (s) => {
  if (s === 'PAID') return 'status-pill--success';
  if (s === 'POSTED') return 'status-pill--info';
  if (s === 'PART_PAID') return 'status-pill--warning';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral';
};
const matchPill = (s) => {
  if (s === 'MATCHED') return 'status-pill--success';
  if (s === 'UNMATCHED') return 'status-pill--neutral';
  return 'status-pill--warning';
};

export default function PurchaseInvoices() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [matchFilter, setMatchFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.purchaseInvoices.list({
        ...companyParams(), ordering: '-id', page,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(matchFilter ? { match_status: matchFilter } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || res || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, status, matchFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, matchFilter]);

  const match = async (inv) => {
    try {
      const r = await api.purchaseInvoices.match(inv.id);
      notify(`Match: ${r.match_status}`, r.match_status === 'MATCHED' ? 'success' : 'warning');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };
  const post = async (inv) => {
    if (!window.confirm(`Post invoice ${inv.supplier_invoice_no}?`)) return;
    try { await api.purchaseInvoices.post(inv.id, false); notify('Posted.', 'success'); load(); }
    catch (err) {
      const msg = errorMessage(err);
      if (/override/i.test(msg) && can('procurement.override_match')) {
        if (window.confirm(`${msg}\n\nOverride the three-way match and post anyway?`)) {
          try { await api.purchaseInvoices.post(inv.id, true); notify('Posted with override.', 'success'); load(); }
          catch (e) { notify(errorMessage(e), 'error'); }
        }
      } else notify(msg, 'error');
    }
  };

  const hasActiveFilters = !!(search || status || matchFilter);
  const clearFilters = () => { setSearch(''); setStatus(''); setMatchFilter(''); };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-receipt-cutoff"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Purchase invoices</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('procurement.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New invoice
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
              placeholder="Search by reference, supplier or invoice number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search purchase invoices"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select className="form-select" value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)} aria-label="Match status">
            <option value="">Any match</option>
            {MATCH_STATUS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </select>
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
            {status && (
              <span className="filter-chip">
                Status: {status.replace('_', ' ')}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {matchFilter && (
              <span className="filter-chip">
                Match: {matchFilter.replace(/_/g, ' ')}
                <button onClick={() => setMatchFilter('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Invoice List
          </span>
          <span className="chart-card__subtitle">
            {count} invoice{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-receipt-cutoff"></i>
            <h6>{hasActiveFilters ? 'No invoices match your search' : 'No invoices yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New invoice' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Supplier invoice #</th>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th className="text-right">Total</th>
                    <th>Match</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '12rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td className="cell-mono text-brand fw-600">{i.reference}</td>
                      <td className="cell-mono">{i.supplier_invoice_no}</td>
                      <td>{i.invoice_date}</td>
                      <td className="cell-name">{i.supplier_label || i.supplier}</td>
                      <td className="cell-num">{fmtMoney(i.total, i.currency)}</td>
                      <td><span className={`status-pill ${matchPill(i.match_status)}`}>{i.match_status.replace(/_/g, ' ')}</span></td>
                      <td><span className={`status-pill ${statusPill(i.status)}`}>{i.status.replace('_', ' ')}</span></td>
                      <td>
                        {i.status === 'DRAFT' && can('procurement.edit') && (
                          <div className="row-actions">
                            <button className="btn btn-sm btn-secondary" onClick={() => match(i)}>Match</button>
                            <button className="btn btn-sm btn-primary" onClick={() => post(i)}>Post</button>
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(i)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <ServerPagination page={page} count={count} onChange={setPage} />}
      </section>

      {editing && (
        <InvoiceModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function InvoiceModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [suppliers, setSuppliers] = useState([]);
  const [pos, setPos] = useState([]);
  const [poLines, setPoLines] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({
    supplier: row.supplier || '', purchase_order: row.purchase_order || '',
    supplier_invoice_no: row.supplier_invoice_no || '', invoice_date: row.invoice_date || todayISO(),
    due_date: row.due_date || '', currency: row.currency || '',
  });
  const [lines, setLines] = useState(
    row.lines && row.lines.length
      ? row.lines.map((l) => ({
          po_line: l.po_line || '', product: l.product || '',
          quantity: l.quantity || '', unit_price: l.unit_price || '', tax_code: l.tax_code || '',
        }))
      : [emptyLine()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  useEffect(() => {
    Promise.all([
      api.suppliers.listAll({ ...companyParams() }),
      api.currencies.listAll(),
    ]).then(([s, c]) => { setSuppliers(s); setCurrencies(c); }).catch(() => {});
  }, [companyParams]);

  useEffect(() => {
    if (!form.supplier) { setPos([]); return; }
    api.purchaseOrders.listAll({ ...companyParams(), supplier: form.supplier, status: 'APPROVED' })
      .then(setPos).catch(() => {});
  }, [companyParams, form.supplier]);

  // The "PO line" picker offers the lines of the selected purchase order.
  useEffect(() => {
    if (!form.purchase_order) { setPoLines([]); return; }
    api.purchaseOrders.get(form.purchase_order)
      .then((po) => setPoLines(po?.lines || []))
      .catch(() => setPoLines([]));
  }, [form.purchase_order]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = {
        ...form,
        company: companyParams().company,
        lines: lines.filter((l) => (l.po_line || l.product) && l.quantity && l.unit_price).map((l) => ({
          ...(l.po_line ? { po_line: l.po_line } : {}),
          ...(l.product ? { product: l.product } : {}),
          quantity: l.quantity, unit_price: l.unit_price,
          ...(l.tax_code ? { tax_code: l.tax_code } : {}),
        })),
      };
      ['purchase_order', 'due_date', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
      isNew ? await api.purchaseInvoices.create(body) : await api.purchaseInvoices.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New purchase invoice' : `Edit ${row.reference}`}
      subtitle="Supplier invoices and three-way match"
      icon="bi-receipt-cutoff"
      size="xl"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="purchaseInvoiceForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="purchaseInvoiceForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Invoice Details</h6>
        <div className="form-grid">
          <Field label="Supplier" required err={fieldErr.supplier}>
            <select className="form-select" value={form.supplier} onChange={set('supplier')} required>
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </Field>
          <Field label="Purchase order">
            <select className="form-select" value={form.purchase_order} onChange={set('purchase_order')}>
              <option value="">—</option>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.reference}</option>)}
            </select>
          </Field>
          <Field label="Invoice #" required err={fieldErr.supplier_invoice_no}>
            <input className="form-control font-mono" value={form.supplier_invoice_no} onChange={set('supplier_invoice_no')} required />
          </Field>
          <Field label="Invoice date" required>
            <input type="date" className="form-control" value={form.invoice_date} onChange={set('invoice_date')} required />
          </Field>
          <Field label="Due date">
            <input type="date" className="form-control" value={form.due_date} onChange={set('due_date')} />
          </Field>
          <Field label="Currency">
            <select className="form-select" value={form.currency} onChange={set('currency')}>
              <option value="">Functional</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-droplet-half" aria-hidden="true"></i>Lines</h6>
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>PO line</th>
                  <th>Product</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Unit price</th>
                  <th>Tax code</th>
                  <th style={{ width: '3rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select className="form-select" value={l.po_line} onChange={(e) => setLine(i, 'po_line', e.target.value)}>
                        <option value="">—</option>
                        {poLines.map((pl) => (
                          <option key={pl.id} value={pl.id}>{pl.product_label || pl.product} · #{pl.id}</option>
                        ))}
                      </select>
                    </td>
                    <td><input className="form-control" value={l.product} onChange={(e) => setLine(i, 'product', e.target.value)} placeholder="if no PO line" /></td>
                    <td><input type="number" step="0.001" className="form-control num" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
                    <td><input type="number" step="0.000001" className="form-control num" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} /></td>
                    <td><input className="form-control" value={l.tax_code} onChange={(e) => setLine(i, 'tax_code', e.target.value)} /></td>
                    <td>
                      {lines.length > 1 && (
                        <button type="button" className="btn btn-icon" title="Remove line" aria-label="Remove line"
                                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                          <i className="bi bi-x-lg"></i>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-secondary mt-2" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
          <i className="bi bi-plus-lg"></i> Add line
        </button>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}