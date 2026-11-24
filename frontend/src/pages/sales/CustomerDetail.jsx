/**
 * Customer detail.
 * - Header: overview + edit / credit status / statement / set credit limit
 * - Tabs: Overview / Statement / Credit / Contracts / Contacts
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import { CustomerModal, Field } from './Customers';

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useApp();
  const [customer, setCustomer] = useState(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setCustomer(await api.customers.get(id)); }
    catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading && !customer) return <div className="app-content"><div className="state-screen">Loading…</div></div>;
  if (error && !customer) return <div className="app-content"><div className="card"><div className="card__body">
    <p className="field-error">{error}</p><button className="btn mt-2" onClick={load}>Try again</button>
  </div></div></div>;
  if (!customer) return null;

  const c = customer;

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <div className="breadcrumb">
            <button className="breadcrumb__back" onClick={() => navigate(-1)}><i className="bi bi-arrow-left" /></button>
            <span className="breadcrumb__item"><a href="/sales/customers">Customers</a></span>
            <span className="breadcrumb__item is-current"><span>{c.code}</span></span>
          </div>
          <h1 className="page-header__title">
            {c.name}
            <span className={`status ${c.status === 'ACTIVE' ? 'status-active' : c.status === 'ON_HOLD' ? 'status-pending' : c.status === 'BLOCKED' ? 'status-rejected' : 'status-inactive'}`}>{c.status.replace('_', ' ')}</span>
          </h1>
          <p className="page-header__subtitle">
            {c.country} · {c.credit_period_days} days · credit limit {fmtMoney(c.credit_limit, c.currency)}
          </p>
        </div>
        <div className="page-header__actions">
          {can('credit.override') && (
            <button className="btn" onClick={() => setCreditOpen(true)}>Set credit limit</button>
          )}
          {can('customers.edit') && (
            <button className="btn" onClick={() => setEditing(true)}><i className="bi bi-pencil" /> Edit</button>
          )}
        </div>
      </header>

      <div className="tabs">
        {['overview', 'credit', 'statement', 'contacts'].map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview c={c} />}
      {tab === 'credit' && <CreditTab id={id} />}
      {tab === 'statement' && <StatementTab id={id} />}
      {tab === 'contacts' && <ContactsTab customer={c} canEdit={can('customers.edit')} />}

      {editing && (
        <CustomerModal row={c} onClose={() => setEditing(false)}
                       onSaved={() => { setEditing(false); notify('Saved.', 'success'); load(); }} />
      )}
      {creditOpen && (
        <SetCreditModal customer={c} onClose={() => setCreditOpen(false)}
                        onSaved={() => { setCreditOpen(false); notify('Credit limit updated.', 'success'); load(); }} />
      )}
    </div>
  );
}

function Overview({ c }) {
  return (
    <div className="card"><div className="card__body">
      <div className="kv">
        <div className="kv__item"><div className="kv__label">Tax registration</div><div className="kv__value mono">{c.tax_registration || '—'}</div></div>
        <div className="kv__item"><div className="kv__label">Contact</div><div className="kv__value">{c.contact_person || '—'}</div></div>
        <div className="kv__item"><div className="kv__label">Phone</div><div className="kv__value">{c.phone || '—'}</div></div>
        <div className="kv__item"><div className="kv__label">Email</div><div className="kv__value">{c.email || '—'}</div></div>
        <div className="kv__item"><div className="kv__label">Currency</div><div className="kv__value">{c.currency || '—'}</div></div>
        <div className="kv__item"><div className="kv__label">Payment terms</div><div className="kv__value">{c.payment_terms || '—'}</div></div>
      </div>
      {c.address && <><hr className="divider" /><p className="text-sm text-muted">{c.address}</p></>}
    </div></div>
  );
}

function CreditTab({ id }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.customers.creditStatus(id).then(setData).catch(() => {}); }, [id]);
  if (!data) return <div className="card"><div className="card__body"><p className="text-muted">Loading…</p></div></div>;
  return (
    <div className="stack">
      <div className="card"><div className="card__header"><h2 className="card__title">Credit</h2></div><div className="card__body">
        <div className="kv">
          <div className="kv__item"><div className="kv__label">Credit limit</div><div className="kv__value">{fmtMoney(data.credit_limit)}</div></div>
          <div className="kv__item"><div className="kv__label">Exposure</div><div className="kv__value">{fmtMoney(data.exposure)}</div></div>
          <div className="kv__item"><div className="kv__label">Available</div><div className="kv__value">{data.available != null ? fmtMoney(data.available) : '—'}</div></div>
        </div>
      </div></div>
      <div className="card"><div className="card__header"><h2 className="card__title">Overdue invoices</h2></div><div className="card__body card__body--flush">
        {!data.overdue_invoices?.length ? <div className="table-empty"><div className="table-empty__title">No overdue invoices</div></div> : (
          <table className="table table--compact">
            <thead><tr><th>Reference</th><th>Due</th><th className="num">Outstanding</th></tr></thead>
            <tbody>
              {data.overdue_invoices.map((i) => (
                <tr key={i.reference}><td className="mono">{i.reference}</td><td>{i.due}</td><td className="num">{fmtMoney(i.outstanding)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div></div>
    </div>
  );
}

function StatementTab({ id }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.customers.statement(id).then(setData).catch(() => {}); }, [id]);
  if (!data) return <div className="card"><div className="card__body"><p className="text-muted">Loading…</p></div></div>;
  const { rows, closing } = data;
  return (
    <div className="stack">
      <div className="card"><div className="card__header"><h2 className="card__title">Closing balance</h2></div><div className="card__body">
        <div className="kv">
          {Object.entries(closing || {}).map(([ccy, bal]) => (
            <div key={ccy} className="kv__item"><div className="kv__label">{ccy}</div><div className={`kv__value ${Number(bal) > 0 ? 'text-danger' : ''}`}>{fmtMoney(bal, ccy)}</div></div>
          ))}
        </div>
      </div></div>
      <div className="card"><div className="card__header"><h2 className="card__title">Statement</h2></div><div className="card__body card__body--flush">
        {!rows.length ? <div className="table-empty"><div className="table-empty__title">No transactions</div></div> : (
          <table className="table table--compact">
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Ccy</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}><td>{r.date}</td><td>{r.type}</td><td className="mono">{r.reference}</td><td>{r.currency}</td>
                  <td className="num">{fmtMoney(r.debit)}</td><td className="num">{fmtMoney(r.credit)}</td><td className="num">{fmtMoney(r.balance)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div></div>
    </div>
  );
}

function ContactsTab({ customer, canEdit }) {
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try { setRows(await api.customerContacts.listAll({ customer: customer.id })); } catch { /* ignore */ }
  }, [customer.id]);
  useEffect(() => { load(); }, [load]);

  const remove = async (c) => {
    if (!window.confirm(`Delete contact ${c.name}?`)) return;
    try { await api.customerContacts.remove(c.id); notify('Deleted.', 'success'); load(); }
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
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td><td>{r.position || '—'}</td><td>{r.phone || '—'}</td><td>{r.email || '—'}</td>
                    <td className="col-actions">
                      {canEdit && (
                        <div className="row-actions">
                          <button className="row-action" title="Edit" onClick={() => setEditing(r)}><i className="bi bi-pencil" /></button>
                          <button className="row-action row-action--danger" title="Delete" onClick={() => remove(r)}><i className="bi bi-trash" /></button>
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
        <ContactModal customer={customer} row={editing} onClose={() => setEditing(null)}
                      onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function ContactModal({ customer, row, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({ name: row.name || '', position: row.position || '', phone: row.phone || '', email: row.email || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      isNew ? await api.customerContacts.create({ ...form, customer: customer.id })
            : await api.customerContacts.update(row.id, form);
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

function SetCreditModal({ customer, onClose, onSaved }) {
  const [form, setForm] = useState({ limit: customer.credit_limit ?? '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.customers.setCreditLimit(customer.id, form.limit, form.reason); onSaved(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">Set credit limit</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <div className="field">
                <label className="label label--required">New limit</label>
                <input type="number" step="0.01" className="input num" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} required />
              </div>
              <div className="field">
                <label className="label">Reason</label>
                <textarea className="textarea" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
            </div>
            <p className="field-hint mt-3">This creates an approved credit-limit history row.</p>
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