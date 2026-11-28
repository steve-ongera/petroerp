/**
 * Transporter invoices.
 * - CRUD /transporter-invoices/ (make_serializer, computed outstanding)
 * - POST /transporter-invoices/:id/post/  ? svc.post_transporter_invoice (creates a linked Expense + journal)
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUSES = ['DRAFT', 'POSTED', 'PART_PAID', 'PAID', 'CANCELLED'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const statusPill = (s) => {
  if (s === 'PAID') return 'status-pill--success';
  if (s === 'POSTED') return 'status-pill--info';
  if (s === 'PART_PAID') return 'status-pill--warning';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral';
};

export default function TransporterInvoices() {
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
      const res = await api.transporterInvoices.list({
        ...companyParams(),
        ordering: '-invoice_date',
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, status]);

  useEffect(() => { load(); }, [load]);

  const post = async (inv) => {
    if (!window.confirm(`Post invoice ${inv.invoice_no}?`)) return;
    try { await api.transporterInvoices.post(inv.id); notify('Posted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      {/* ---------- Page header: icon tile + title + actions ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Transporter invoices</h1>
            <p className="page-subtitle">
              Hire-cost invoices{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('transport.edit') && (
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

      {/* ---------- One white card: search, filters, table, pagination ---------- */}
      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by reference or invoice number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search invoices"
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
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Invoice List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} invoice{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-receipt"></i>
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
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Transporter</th>
                    <th>Booking</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Outstanding</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((i) => (
                    <tr key={i.id}>
                      <td className="cell-mono text-brand fw-600">{i.reference}</td>
                      <td className="cell-mono">{i.invoice_no}</td>
                      <td>{i.invoice_date}</td>
                      <td className="cell-name">{i.transporter_label || i.transporter}</td>
                      <td className="cell-mono">{i.booking_label || i.booking}</td>
                      <td className="cell-num">{fmtMoney(i.total)}</td>
                      <td className="cell-num">{fmtMoney(i.outstanding)}</td>
                      <td>
                        <span className={`status-pill ${statusPill(i.status)}`}>{i.status.replace('_', ' ')}</span>
                      </td>
                      <td>
                        {can('transport.edit') && (
                          <div className="row-actions">
                            {i.status === 'DRAFT' && (
                              <button className="btn btn-sm btn-primary" onClick={() => post(i)}>Post</button>
                            )}
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

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
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
  const [transporters, setTransporters] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({
    transporter: row.transporter || '', booking: row.booking || '',
    invoice_no: row.invoice_no || '', invoice_date: row.invoice_date || todayISO(),
    due_date: row.due_date || '', subtotal: row.subtotal ?? '', tax_total: row.tax_total ?? '',
    currency: row.currency || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.transporters.listAll({ ...companyParams() }),
      api.transportBookings.listAll({ ...companyParams() }),
      api.currencies.listAll(),
    ]).then(([t, b, c]) => { setTransporters(t); setBookings(b); setCurrencies(c); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.due_date) delete body.due_date;
      isNew ? await api.transporterInvoices.create(body) : await api.transporterInvoices.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New transporter invoice' : `Edit ${row.invoice_no}`}
      subtitle="Hire-cost invoices"
      icon="bi-receipt-cutoff"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="invoiceForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="invoiceForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Invoice Details</h6>
        <div className="form-grid">
          <Field label="Transporter" required err={fieldErr.transporter}>
            <select className="form-select" value={form.transporter} onChange={set('transporter')} required>
              <option value="">—</option>
              {transporters.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </select>
          </Field>
          <Field label="Booking" required err={fieldErr.booking}>
            <select className="form-select" value={form.booking} onChange={set('booking')} required>
              <option value="">—</option>
              {bookings
                .filter((b) => !form.transporter || String(b.transporter) === String(form.transporter))
                .map((b) => <option key={b.id} value={b.id}>{b.reference}</option>)}
            </select>
          </Field>
          <Field label="Invoice #" required err={fieldErr.invoice_no}>
            <input className="form-control font-mono" value={form.invoice_no} onChange={set('invoice_no')} required />
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

        <h6 className="modal-section-title"><i className="bi bi-cash-coin" aria-hidden="true"></i>Amounts</h6>
        <div className="form-grid">
          <Field label="Subtotal" required err={fieldErr.subtotal}>
            <input type="number" step="0.01" className="form-control num" value={form.subtotal} onChange={set('subtotal')} required />
          </Field>
          <Field label="Tax total">
            <input type="number" step="0.01" className="form-control num" value={form.tax_total} onChange={set('tax_total')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}