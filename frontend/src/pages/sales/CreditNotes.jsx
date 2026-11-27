/**
 * Sales credit notes.
 * - CRUD /sales-credit-notes/ (crud)
 * - POST /sales-credit-notes/:id/post/  ? svc.post_sales_credit_note (optionally restock)
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['DRAFT', 'POSTED'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function CreditNotes() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.salesCreditNotes.list({
        ...companyParams(), ordering: '-id',
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, status]);

  useEffect(() => { load(); }, [load]);

  const post = async (cn) => {
    if (!window.confirm(`Post credit note ${cn.reference}?`)) return;
    try { await api.salesCreditNotes.post(cn.id); notify('Posted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Credit notes</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('sales.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New credit note
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
              placeholder="Search by reference or invoice..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search credit notes"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
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
                Status: {status}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Credit Note List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} credit note{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-receipt"></i>
            <h6>{hasActiveFilters ? 'No credit notes match your search' : 'No credit notes yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New credit note' to add the first one"}
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
                    <th>Invoice</th>
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Total</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '6rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((cn) => (
                    <tr key={cn.id}>
                      <td className="cell-mono text-brand fw-600">{cn.reference}</td>
                      <td>{cn.note_date}</td>
                      <td className="cell-mono">{cn.invoice_label || cn.invoice}</td>
                      <td>{cn.product_label || '—'}</td>
                      <td className="cell-num">{Number(cn.quantity || 0).toLocaleString()}</td>
                      <td className="cell-num">{fmtMoney(cn.total, cn.currency)}</td>
                      <td className="text-truncate" style={{ maxWidth: 240 }}>{cn.reason || '—'}</td>
                      <td>
                        <span className={`status-pill ${cn.status === 'POSTED' ? 'status-pill--info' : 'status-pill--neutral'}`}>{cn.status}</span>
                      </td>
                      <td>
                        {cn.status === 'DRAFT' && can('sales.edit') && (
                          <div className="row-actions">
                            <button className="btn btn-sm btn-primary" onClick={() => post(cn)}>Post</button>
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

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && (
        <CreditNoteModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function CreditNoteModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [invoices, setInvoices] = useState([]);
  const [products, setProducts] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({
    invoice: row.invoice || '', product: row.product || '',
    note_date: row.note_date || todayISO(), quantity: row.quantity ?? '',
    unit_price: row.unit_price ?? '', tax_rate: row.tax_rate ?? '',
    reason: row.reason || '', restock_tank: row.restock_tank || '',
    currency: row.currency || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.salesInvoices.listAll({ ...companyParams(), status: 'POSTED' }).catch(() => []),
      api.products.listAll(),
      api.storageTanks.listAll({ ...companyParams() }),
      api.currencies.listAll(),
    ]).then(([i, p, t, c]) => { setInvoices(i); setProducts(p); setTanks(t); setCurrencies(c); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      ['product', 'restock_tank', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
      isNew ? await api.salesCreditNotes.create(body) : await api.salesCreditNotes.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New credit note' : `Edit ${row.reference}`}
      subtitle="Sales credit notes"
      icon="bi-receipt"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="creditNoteForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="creditNoteForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Credit Note Details</h6>
        <div className="form-grid">
          <Field label="Invoice" required err={fieldErr.invoice}>
            <select className="form-select" value={form.invoice} onChange={set('invoice')} required>
              <option value="">—</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.reference} · {i.customer_label || i.customer} · {fmtMoney(i.total, i.currency)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product">
            <select className="form-select" value={form.product} onChange={set('product')}>
              <option value="">—</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </Field>
          <Field label="Note date" required>
            <input type="date" className="form-control" value={form.note_date} onChange={set('note_date')} required />
          </Field>
          <Field label="Currency">
            <select className="form-select" value={form.currency} onChange={set('currency')}>
              <option value="">Functional</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
          <Field label="Reason" span>
            <textarea className="form-control" rows={2} value={form.reason} onChange={set('reason')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-calculator" aria-hidden="true"></i>Amounts & Restocking</h6>
        <div className="form-grid">
          <Field label="Quantity" required err={fieldErr.quantity}>
            <input type="number" step="0.001" className="form-control num" value={form.quantity} onChange={set('quantity')} required />
          </Field>
          <Field label="Unit price" required err={fieldErr.unit_price}>
            <input type="number" step="0.000001" className="form-control num" value={form.unit_price} onChange={set('unit_price')} required />
          </Field>
          <Field label="Tax rate %">
            <input type="number" step="0.001" className="form-control num" value={form.tax_rate} onChange={set('tax_rate')} />
          </Field>
          <Field label="Restock tank">
            <select className="form-select" value={form.restock_tank} onChange={set('restock_tank')}>
              <option value="">— do not restock —</option>
              {tanks.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-muted-soft mt-3" style={{ fontSize: '0.8125rem' }}>
          Credit note cannot exceed the invoice balance. Restocking creates a stock return at delivered cost.
        </p>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}