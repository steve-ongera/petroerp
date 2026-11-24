/**
 * Supplier detail.
 * - Header: overview + edit / deactivate
 * - Tabs: Statement / Price history / Performance / Contacts
 *
 * Endpoints:
 *   /suppliers/:id/statement/
 *   /suppliers/:id/price-history/
 *   /suppliers/:id/performance/
 *   /supplier-contacts/ (crud)   + /supplier-contracts/, /supplier-prices/, /supplier-quotations/
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import { SupplierModal, Field } from './Suppliers';

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function SupplierDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { companyParams, notify } = useApp();
  const [supplier, setSupplier] = useState(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setSupplier(await api.suppliers.get(id)); }
    catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading && !supplier) return <div className="app-content"><div className="state-screen">Loading…</div></div>;
  if (error && !supplier) return (
    <div className="app-content"><div className="card"><div className="card__body">
      <p className="field-error" role="alert">{error}</p>
      <button className="btn mt-2" onClick={load}>Try again</button>
    </div></div></div>
  );
  if (!supplier) return null;

  const s = supplier;

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <div className="breadcrumb">
            <button className="breadcrumb__back" onClick={() => navigate(-1)}><i className="bi bi-arrow-left" /></button>
            <span className="breadcrumb__item"><a href="/procurement/suppliers">Suppliers</a></span>
            <span className="breadcrumb__item is-current"><span>{s.code}</span></span>
          </div>
          <h1 className="page-header__title">
            {s.name}
            <span className={`status ${s.status === 'ACTIVE' ? 'status-active' : s.status === 'SUSPENDED' ? 'status-pending' : s.status === 'ONBOARDING' ? 'status-draft' : 'status-inactive'}`}>{s.status}</span>
          </h1>
          <p className="page-header__subtitle">
            {s.country} · {s.payment_terms_days} days · credit limit {fmtMoney(s.credit_limit, s.currency)}
          </p>
        </div>
        <div className="page-header__actions">
          {can('suppliers.edit') && (
            <button className="btn" onClick={() => setEditing(true)}><i className="bi bi-pencil" /> Edit</button>
          )}
        </div>
      </header>

      <div className="tabs">
        {['overview', 'statement', 'prices', 'performance', 'contacts'].map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview s={s} />}
      {tab === 'statement' && <StatementTab id={id} />}
      {tab === 'prices' && <PricesTab id={id} />}
      {tab === 'performance' && <PerformanceTab id={id} />}
      {tab === 'contacts' && <ContactsTab supplier={s} companyParams={companyParams} canEdit={can('suppliers.edit')} />}

      {editing && (
        <SupplierModal row={s} onClose={() => setEditing(false)}
                       onSaved={() => { setEditing(false); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function Overview({ s }) {
  return (
    <div className="card">
      <div className="card__body">
        <div className="kv">
          <div className="kv__item"><div className="kv__label">Tax PIN</div><div className="kv__value mono">{s.tax_pin || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Registration</div><div className="kv__value mono">{s.registration_number || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Contact person</div><div className="kv__value">{s.contact_person || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Phone</div><div className="kv__value">{s.phone || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Email</div><div className="kv__value">{s.email || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Bank</div><div className="kv__value">{s.bank_name || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Bank account</div><div className="kv__value mono">{s.bank_account || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">SWIFT</div><div className="kv__value mono">{s.bank_swift || '—'}</div></div>
        </div>
        {s.address && <><hr className="divider" /><p className="text-sm text-muted">{s.address}</p></>}
      </div>
    </div>
  );
}

function StatementTab({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.suppliers.statement(id).then(setData).catch((e) => setError(errorMessage(e))); }, [id]);

  if (error) return <div className="card"><div className="card__body"><p className="field-error">{error}</p></div></div>;
  if (!data) return <div className="card"><div className="card__body"><p className="text-muted">Loading…</p></div></div>;
  const { rows, closing } = data;

  return (
    <div className="stack">
      <div className="card">
        <div className="card__header"><h2 className="card__title">Closing balances</h2></div>
        <div className="card__body">
          {!Object.keys(closing || {}).length ? <p className="text-muted">No movements.</p> : (
            <div className="kv">
              {Object.entries(closing).map(([ccy, bal]) => (
                <div key={ccy} className="kv__item">
                  <div className="kv__label">{ccy}</div>
                  <div className={`kv__value ${Number(bal) > 0 ? 'text-danger' : ''}`}>{fmtMoney(bal, ccy)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card__header"><h2 className="card__title">Statement</h2></div>
        <div className="card__body card__body--flush">
          {!rows.length ? <div className="table-empty"><div className="table-empty__title">No transactions</div></div> : (
            <table className="table table--compact">
              <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Ccy</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td><td>{r.type}</td><td className="mono">{r.reference}</td>
                    <td>{r.currency}</td>
                    <td className="num">{fmtMoney(r.debit)}</td>
                    <td className="num">{fmtMoney(r.credit)}</td>
                    <td className="num">{fmtMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function PricesTab({ id }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.suppliers.priceHistory(id).then(setRows).catch(() => {}); }, [id]);
  return (
    <div className="card">
      <div className="card__header"><h2 className="card__title">Price history</h2></div>
      <div className="card__body card__body--flush">
        {!rows.length ? <div className="table-empty"><div className="table-empty__title">No price records</div></div> : (
          <table className="table table--compact">
            <thead><tr><th>Date</th><th>Product</th><th className="num">Price</th><th>Ccy</th><th>Source</th></tr></thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i}>
                  <td>{p.date}</td><td>{p.product}</td>
                  <td className="num">{Number(p.price).toFixed(6)}</td>
                  <td>{p.currency}</td><td><span className="badge">{p.source}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PerformanceTab({ id }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.suppliers.performance(id).then(setData).catch(() => {}); }, [id]);
  return (
    <div className="card">
      <div className="card__header"><h2 className="card__title">Performance</h2></div>
      <div className="card__body">
        {!data ? <p className="text-muted">Loading…</p> : (
          <div className="kv">
            <div className="kv__item"><div className="kv__label">Orders</div><div className="kv__value">{data.orders ?? 0}</div></div>
            <div className="kv__item"><div className="kv__label">Litres ordered</div><div className="kv__value">{Number(data.litres_ordered || 0).toLocaleString()}</div></div>
            <div className="kv__item"><div className="kv__label">Litres received</div><div className="kv__value">{Number(data.litres_received || 0).toLocaleString()}</div></div>
            <div className="kv__item"><div className="kv__label">Fill rate %</div><div className="kv__value">{data.fill_rate_pct != null ? Number(data.fill_rate_pct).toFixed(2) : '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Invoice match exceptions</div><div className="kv__value">{data.invoice_match_exceptions ?? 0}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContactsTab({ supplier, companyParams, canEdit }) {
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try { setRows(await api.supplierContacts.listAll({ supplier: supplier.id })); }
    catch { /* non-fatal */ }
  }, [supplier.id]);
  useEffect(() => { load(); }, [load]);

  const remove = async (c) => {
    if (!window.confirm(`Delete contact ${c.name}?`)) return;
    try { await api.supplierContacts.remove(c.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Contacts</h2>
          {canEdit && <button className="btn btn-sm btn-primary" onClick={() => setEditing({})}>+ Add</button>}
        </div>
        <div className="card__body card__body--flush">
          {!rows.length ? <div className="table-empty"><div className="table-empty__title">No contacts</div></div> : (
            <table className="table table--compact">
              <thead><tr><th>Name</th><th>Position</th><th>Phone</th><th>Email</th><th className="col-actions" /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td><td>{c.position || '—'}</td><td>{c.phone || '—'}</td><td>{c.email || '—'}</td>
                    <td className="col-actions">
                      {canEdit && (
                        <div className="row-actions">
                          <button className="row-action" title="Edit" onClick={() => setEditing(c)}><i className="bi bi-pencil" /></button>
                          <button className="row-action row-action--danger" title="Delete" onClick={() => remove(c)}><i className="bi bi-trash" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing && (
        <ContactModal supplier={supplier} row={editing}
                      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function ContactModal({ supplier, row, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    name: row.name || '', position: row.position || '', phone: row.phone || '', email: row.email || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      isNew ? await api.supplierContacts.create({ ...form, supplier: supplier.id })
            : await api.supplierContacts.update(row.id, form);
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New contact' : 'Edit contact'}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <Field label="Name" required><input className="input" value={form.name} onChange={set('name')} required /></Field>
              <Field label="Position"><input className="input" value={form.position} onChange={set('position')} /></Field>
              <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Email"><input type="email" className="input" value={form.email} onChange={set('email')} /></Field>
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