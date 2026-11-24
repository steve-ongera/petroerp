/**
 * Third-party transporters.
 * - CRUD /transporters/
 * - GET /transporters/:id/performance/   → bookings, deliveries, on-time, shortage, avg rate
 * - GET /transporters/:id/statement/     → invoices vs payments running balance
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const STATUS = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Transporters() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [statement, setStatement] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.transporters.list({ ...companyParams(), search, ordering: 'code', page_size: 500 });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search]);

  useEffect(() => { load(); }, [load]);

  const showPerformance = async (t) => {
    try { setMetrics({ transporter: t, data: await api.transporters.performance(t.id) }); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const showStatement = async (t) => {
    try { setStatement({ transporter: t, data: await api.transporters.statement(t.id) }); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete transporter ${t.code}?`)) return;
    try { await api.transporters.remove(t.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Transporters</h1>
          <p className="page-header__subtitle">
            Hired truck partners{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('transport.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New transporter
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Name, TIN…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No transporters</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Code</th><th>Name</th><th>Contact</th><th>Phone</th>
                <th className="num">Credit limit</th><th>Terms (days)</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.code}</td>
                    <td>{t.name}</td>
                    <td>{t.contact_person || '—'}</td>
                    <td>{t.phone || '—'}</td>
                    <td className="num">{fmtMoney(t.credit_limit)}</td>
                    <td className="num">{t.payment_terms_days}</td>
                    <td><span className={`status ${t.status === 'ACTIVE' ? 'status-active' : t.status === 'SUSPENDED' ? 'status-pending' : 'status-inactive'}`}>{t.status}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Performance" onClick={() => showPerformance(t)}><i className="bi bi-bar-chart" /></button>
                        <button className="row-action" title="Statement" onClick={() => showStatement(t)}><i className="bi bi-file-text" /></button>
                        {can('transport.edit') && (
                          <>
                            <button className="row-action" title="Edit" onClick={() => setEditing(t)}><i className="bi bi-pencil" /></button>
                            <button className="row-action row-action--danger" title="Delete" onClick={() => remove(t)}><i className="bi bi-trash" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <TransporterModal row={editing} companyParams={companyParams}
                          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
      {metrics && <PerformanceModal data={metrics} onClose={() => setMetrics(null)} />}
      {statement && <StatementModal data={statement} onClose={() => setStatement(null)} />}
    </div>
  );
}

function TransporterModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', registration_number: row.registration_number || '',
    contact_person: row.contact_person || '', phone: row.phone || '', email: row.email || '',
    tax_pin: row.tax_pin || '', bank_name: row.bank_name || '', bank_account: row.bank_account || '',
    payment_terms_days: row.payment_terms_days ?? 30, credit_limit: row.credit_limit ?? '',
    currency: row.currency || '', status: row.status || 'ACTIVE',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => { api.currencies.listAll().then(setCurrencies).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      isNew ? await api.transporters.create(body) : await api.transporters.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New transporter' : `Edit ${row.code}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Code" err={fieldErr.code}>
                <input className="input mono" value={form.code} onChange={set('code')} disabled={!isNew} placeholder="Auto-generated if blank" />
              </Field>
              <Field label="Name" required err={fieldErr.name}>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Registration number"><input className="input mono" value={form.registration_number} onChange={set('registration_number')} /></Field>
              <Field label="Contact person"><input className="input" value={form.contact_person} onChange={set('contact_person')} /></Field>
              <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Email"><input type="email" className="input" value={form.email} onChange={set('email')} /></Field>
              <Field label="Tax PIN"><input className="input mono" value={form.tax_pin} onChange={set('tax_pin')} /></Field>
              <Field label="Payment terms (days)"><input type="number" min={0} className="input num" value={form.payment_terms_days} onChange={set('payment_terms_days')} /></Field>
              <Field label="Credit limit"><input type="number" step="0.01" className="input num" value={form.credit_limit} onChange={set('credit_limit')} /></Field>
              <Field label="Currency">
                <select className="select" value={form.currency} onChange={set('currency')}>
                  <option value="">—</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Bank name"><input className="input" value={form.bank_name} onChange={set('bank_name')} /></Field>
              <Field label="Bank account"><input className="input mono" value={form.bank_account} onChange={set('bank_account')} /></Field>
              <Field label="Status" span>
                <select className="select" value={form.status} onChange={set('status')}>
                  {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
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

function PerformanceModal({ data, onClose }) {
  const { transporter, data: m } = data;
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Performance · {transporter.code}</h2>
            <p className="modal__subtitle">{transporter.name}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          <div className="kv">
            <div className="kv__item"><div className="kv__label">Bookings</div><div className="kv__value">{m.bookings ?? '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Delivered shipments</div><div className="kv__value">{m.delivered_shipments ?? '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Late deliveries</div><div className="kv__value">{m.late_deliveries ?? '—'}</div></div>
            <div className="kv__item"><div className="kv__label">On-time %</div><div className="kv__value">{m.on_time_pct != null ? Number(m.on_time_pct).toFixed(2) : '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Shortage (L)</div><div className="kv__value">{Number(m.shortage_litres || 0).toLocaleString()}</div></div>
            <div className="kv__item"><div className="kv__label">Avg rate / L</div><div className="kv__value">{m.avg_rate_per_litre != null ? Number(m.avg_rate_per_litre).toFixed(6) : '—'}</div></div>
          </div>
        </div>
        <div className="modal__footer"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function StatementModal({ data, onClose }) {
  const { transporter, data: stmt } = data;
  const rows = stmt?.rows || [];
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__dialog modal__dialog--xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Statement · {transporter.code}</h2>
            <p className="modal__subtitle">{transporter.name}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          {!rows.length ? <p className="text-muted">No transactions.</p> : (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Ccy</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.date}</td>
                      <td>{r.type}</td>
                      <td className="mono">{r.reference}</td>
                      <td>{r.currency}</td>
                      <td className="num">{fmtMoney(r.debit)}</td>
                      <td className="num">{fmtMoney(r.credit)}</td>
                      <td className="num">{fmtMoney(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal__footer"><button className="btn" onClick={onClose}>Close</button></div>
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