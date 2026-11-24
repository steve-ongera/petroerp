/**
 * Transporter invoices.
 * - CRUD /transporter-invoices/ (make_serializer, computed outstanding)
 * - POST /transporter-invoices/:id/post/  → svc.post_transporter_invoice (creates a linked Expense + journal)
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function TransporterInvoices() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.transporterInvoices.list({
        ...companyParams(), ordering: '-invoice_date',
        ...(status ? { status } : {}),
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, status]);

  useEffect(() => { load(); }, [load]);

  const post = async (inv) => {
    if (!window.confirm(`Post invoice ${inv.invoice_no}?`)) return;
    try { await api.transporterInvoices.post(inv.id); notify('Posted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Transporter invoices</h1>
          <p className="page-header__subtitle">
            Hire-cost invoices{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('transport.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New invoice
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['DRAFT', 'POSTED', 'PART_PAID', 'PAID', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No invoices</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Invoice #</th><th>Date</th><th>Transporter</th><th>Booking</th>
                <th className="num">Total</th><th className="num">Outstanding</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="is-clickable" onClick={() => setEditing(i)}>
                    <td className="mono">{i.reference}</td>
                    <td className="mono">{i.invoice_no}</td>
                    <td>{i.invoice_date}</td>
                    <td>{i.transporter_label || i.transporter}</td>
                    <td className="mono">{i.booking_label || i.booking}</td>
                    <td className="num">{fmtMoney(i.total)}</td>
                    <td className="num">{fmtMoney(i.outstanding)}</td>
                    <td><span className={`status ${i.status === 'DRAFT' ? 'status-draft' : i.status === 'POSTED' ? 'status-posted' : i.status === 'PAID' ? 'status-paid' : i.status === 'CANCELLED' ? 'status-rejected' : 'status-pending'}`}>{i.status.replace('_', ' ')}</span></td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      {i.status === 'DRAFT' && can('transport.edit') && (
                        <button className="btn btn-xs btn-primary" onClick={() => post(i)}>Post</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <InvoiceModal row={editing} companyParams={companyParams}
                      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
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
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New transporter invoice' : `Edit ${row.invoice_no}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Transporter" required err={fieldErr.transporter}>
                <select className="select" value={form.transporter} onChange={set('transporter')} required>
                  <option value="">—</option>
                  {transporters.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </Field>
              <Field label="Booking" required err={fieldErr.booking}>
                <select className="select" value={form.booking} onChange={set('booking')} required>
                  <option value="">—</option>
                  {bookings.filter((b) => !form.transporter || String(b.transporter) === String(form.transporter))
                    .map((b) => <option key={b.id} value={b.id}>{b.reference}</option>)}
                </select>
              </Field>
              <Field label="Invoice #" required err={fieldErr.invoice_no}>
                <input className="input mono" value={form.invoice_no} onChange={set('invoice_no')} required />
              </Field>
              <Field label="Invoice date" required>
                <input type="date" className="input" value={form.invoice_date} onChange={set('invoice_date')} required />
              </Field>
              <Field label="Due date">
                <input type="date" className="input" value={form.due_date} onChange={set('due_date')} />
              </Field>
              <Field label="Currency">
                <select className="select" value={form.currency} onChange={set('currency')}>
                  <option value="">Functional</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Subtotal" required><input type="number" step="0.01" className="input num" value={form.subtotal} onChange={set('subtotal')} required /></Field>
              <Field label="Tax total"><input type="number" step="0.01" className="input num" value={form.tax_total} onChange={set('tax_total')} /></Field>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, err, span, children }) {
  return (
    <div className={`field ${span ? 'span-all' : ''} ${err ? 'has-error' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}