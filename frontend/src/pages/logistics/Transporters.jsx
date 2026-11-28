/**
 * Third-party transporters.
 * - CRUD /transporters/
 * - GET /transporters/:id/performance/   ? bookings, deliveries, on-time, shortage, avg rate
 * - GET /transporters/:id/statement/     ? invoices vs payments running balance
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const statusPill = (s) => {
  if (s === 'ACTIVE') return 'status-pill--success';
  if (s === 'SUSPENDED') return 'status-pill--warning';
  return 'status-pill--neutral';
};

export default function Transporters() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [statement, setStatement] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.transporters.list({
        ...companyParams(),
        ordering: 'code',
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, status]);

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

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      {/* ---------- Page header: icon tile + title + actions ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Transporters</h1>
            <p className="page-subtitle">
              Hired truck partners{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('transport.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New transporter
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
              placeholder="Search by code, name or TIN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search transporters"
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
            Transporter List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} transporter{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-truck-flatbed"></i>
            <h6>{hasActiveFilters ? 'No transporters match your search' : 'No transporters yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New transporter' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th className="text-right">Credit limit</th>
                    <th className="text-right">Terms (days)</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '10rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => (
                    <tr key={t.id}>
                      <td className="cell-mono text-brand fw-600">{t.code}</td>
                      <td className="cell-name">{t.name}</td>
                      <td>{t.contact_person || '—'}</td>
                      <td>{t.phone || '—'}</td>
                      <td className="cell-num">{fmtMoney(t.credit_limit)}</td>
                      <td className="cell-num">{t.payment_terms_days}</td>
                      <td><span className={`status-pill ${statusPill(t.status)}`}>{t.status}</span></td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-icon" title="Performance" aria-label="Performance" onClick={() => showPerformance(t)}>
                            <i className="bi bi-bar-chart"></i>
                          </button>
                          <button className="btn btn-icon" title="Statement" aria-label="Statement" onClick={() => showStatement(t)}>
                            <i className="bi bi-file-text"></i>
                          </button>
                          {can('transport.edit') && (
                            <>
                              <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(t)}>
                                <i className="bi bi-pencil"></i>
                              </button>
                              <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(t)}>
                                <i className="bi bi-trash"></i>
                              </button>
                            </>
                          )}
                        </div>
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
        <TransporterModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
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
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New transporter' : `Edit ${row.code}`}
      subtitle="Hired truck partners"
      icon="bi-truck-flatbed"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="transporterForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="transporterForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Transporter Details</h6>
        <div className="form-grid">
          <Field label="Code" err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} disabled={!isNew} placeholder="Auto-generated if blank" />
          </Field>
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Registration number">
            <input className="form-control font-mono" value={form.registration_number} onChange={set('registration_number')} />
          </Field>
          <Field label="Tax PIN">
            <input className="form-control font-mono" value={form.tax_pin} onChange={set('tax_pin')} />
          </Field>
          <Field label="Contact person">
            <input className="form-control" value={form.contact_person} onChange={set('contact_person')} />
          </Field>
          <Field label="Phone"><input className="form-control" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input type="email" className="form-control" value={form.email} onChange={set('email')} /></Field>
          <Field label="Status">
            <select className="form-select" value={form.status} onChange={set('status')}>
              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-bank" aria-hidden="true"></i>Banking & Terms</h6>
        <div className="form-grid">
          <Field label="Bank name"><input className="form-control" value={form.bank_name} onChange={set('bank_name')} /></Field>
          <Field label="Bank account">
            <input className="form-control font-mono" value={form.bank_account} onChange={set('bank_account')} />
          </Field>
          <Field label="Payment terms (days)">
            <input type="number" min={0} className="form-control num" value={form.payment_terms_days} onChange={set('payment_terms_days')} />
          </Field>
          <Field label="Credit limit">
            <input type="number" step="0.01" className="form-control num" value={form.credit_limit} onChange={set('credit_limit')} />
          </Field>
          <Field label="Currency">
            <select className="form-select" value={form.currency} onChange={set('currency')}>
              <option value="">—</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function PerformanceModal({ data, onClose }) {
  const { transporter, data: m } = data;
  const items = [
    ['Bookings', m.bookings ?? '—'],
    ['Delivered shipments', m.delivered_shipments ?? '—'],
    ['Late deliveries', m.late_deliveries ?? '—'],
    ['On-time %', m.on_time_pct != null ? Number(m.on_time_pct).toFixed(2) : '—'],
    ['Shortage (L)', Number(m.shortage_litres || 0).toLocaleString()],
    ['Avg rate / L', m.avg_rate_per_litre != null ? Number(m.avg_rate_per_litre).toFixed(6) : '—'],
  ];
  return (
    <Modal
      show
      onClose={onClose}
      title={`Performance · ${transporter.code}`}
      subtitle={transporter.name}
      icon="bi-bar-chart"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      <div className="kv">
        {items.map(([label, value]) => (
          <div className="kv__item" key={label}>
            <div className="kv__label">{label}</div>
            <div className="kv__value">{value}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function StatementModal({ data, onClose }) {
  const { transporter, data: stmt } = data;
  const rows = stmt?.rows || [];
  return (
    <Modal
      show
      onClose={onClose}
      title={`Statement · ${transporter.code}`}
      subtitle={transporter.name}
      icon="bi-file-text"
      size="xl"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      {!rows.length ? (
        <div className="empty-state">
          <i className="bi bi-file-text"></i>
          <h6>No transactions</h6>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th>Reference</th><th>Ccy</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td>
                    <td>{r.type}</td>
                    <td className="cell-mono">{r.reference}</td>
                    <td>{r.currency}</td>
                    <td className="cell-num">{fmtMoney(r.debit)}</td>
                    <td className="cell-num">{fmtMoney(r.credit)}</td>
                    <td className="cell-num">{fmtMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}