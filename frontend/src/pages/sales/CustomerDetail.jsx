/**
 * Customer detail.
 * - Header: overview + edit / credit status / statement / set credit limit
 * - Tabs: Overview / Credit / Statement / Contacts
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';
import { SectionHeader, SectionBody, KV, EmptyState } from '../../components/PageSection';
import { CustomerModal, customerStatusPill } from './Customers';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'bi-info-circle' },
  { key: 'credit', label: 'Credit', icon: 'bi-credit-card' },
  { key: 'statement', label: 'Statement', icon: 'bi-file-text' },
  { key: 'contacts', label: 'Contacts', icon: 'bi-person-lines-fill' },
];

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function CustomerDetail() {
  const { id } = useParams();
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

  if (loading && !customer) {
    return <div><section className="page-card"><TableSkeleton rows={6} columns={4} /></section></div>;
  }
  if (error && !customer) {
    return (
      <div>
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (!customer) return null;
  const c = customer;

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">
              {c.name}{' '}
              <span className={`status-pill ${customerStatusPill(c.status)}`}>{c.status.replace('_', ' ')}</span>
            </h1>
            <p className="page-subtitle">
              {c.code} · {c.country} · {c.credit_period_days} days · credit limit {fmtMoney(c.credit_limit, c.currency)}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/sales/customers" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Customers
          </Link>
          {can('credit.override') && (
            <button className="btn btn-secondary" onClick={() => setCreditOpen(true)}>
              <i className="bi bi-credit-card"></i>
              Set credit limit
            </button>
          )}
          {can('customers.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              <i className="bi bi-pencil"></i>
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <i className={`bi ${t.icon}`} aria-hidden="true"></i> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview c={c} />}
      {tab === 'credit' && <CreditTab id={id} />}
      {tab === 'statement' && <StatementTab id={id} />}
      {tab === 'contacts' && <ContactsTab customer={c} canEdit={can('customers.edit')} />}

      {editing && (
        <CustomerModal
          row={c}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); notify('Saved.', 'success'); load(); }}
        />
      )}
      {creditOpen && (
        <SetCreditModal
          customer={c}
          onClose={() => setCreditOpen(false)}
          onSaved={() => { setCreditOpen(false); notify('Credit limit updated.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function Overview({ c }) {
  return (
    <section className="page-card">
      <SectionHeader first icon="bi-info-circle" title="Customer Details" />
      <SectionBody>
        <KV items={[
          ['Tax registration', c.tax_registration || '—'],
          ['Contact', c.contact_person || '—'],
          ['Phone', c.phone || '—'],
          ['Email', c.email || '—'],
          ['Currency', c.currency || '—'],
          ['Payment terms', c.payment_terms || '—'],
        ]} />
        {c.address && (
          <p className="text-muted-soft" style={{ marginTop: '1rem', marginBottom: 0 }}>
            <i className="bi bi-geo-alt"></i> {c.address}
          </p>
        )}
      </SectionBody>
    </section>
  );
}

function CreditTab({ id }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.customers.creditStatus(id).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <section className="page-card"><TableSkeleton rows={4} columns={3} /></section>;
  if (!data) return <section className="page-card"><EmptyState icon="bi-credit-card" title="Credit status unavailable" /></section>;

  const overdue = data.overdue_invoices || [];
  return (
    <>
      <section className="page-card">
        <SectionHeader first icon="bi-credit-card" title="Credit" />
        <SectionBody>
          <KV items={[
            ['Credit limit', fmtMoney(data.credit_limit)],
            ['Exposure', fmtMoney(data.exposure)],
            ['Available', data.available != null ? fmtMoney(data.available) : '—'],
          ]} />
        </SectionBody>
      </section>

      <section className="page-card">
        <SectionHeader first icon="bi-exclamation-triangle" title="Overdue Invoices" subtitle={`${overdue.length} invoice${overdue.length !== 1 ? 's' : ''}`} />
        {!overdue.length ? (
          <EmptyState icon="bi-check-circle" title="No overdue invoices" />
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr><th>Reference</th><th>Due</th><th className="text-right">Outstanding</th></tr>
                </thead>
                <tbody>
                  {overdue.map((i) => (
                    <tr key={i.reference}>
                      <td className="cell-mono text-brand fw-600">{i.reference}</td>
                      <td>{i.due}</td>
                      <td className="cell-num">{fmtMoney(i.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function StatementTab({ id }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.customers.statement(id).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <section className="page-card"><TableSkeleton rows={6} columns={7} /></section>;
  if (!data) return <section className="page-card"><EmptyState icon="bi-file-text" title="Statement unavailable" /></section>;

  const rows = data.rows || [];
  const closing = Object.entries(data.closing || {});
  return (
    <>
      {closing.length > 0 && (
        <section className="page-card">
          <SectionHeader first icon="bi-cash-stack" title="Closing Balance" />
          <SectionBody>
            <KV items={closing.map(([ccy, bal]) => [ccy, fmtMoney(bal, ccy), Number(bal) > 0])} />
          </SectionBody>
        </section>
      )}

      <section className="page-card">
        <SectionHeader first icon="bi-file-text" title="Statement" subtitle={`${rows.length} transaction${rows.length !== 1 ? 's' : ''}`} />
        {!rows.length ? (
          <EmptyState icon="bi-file-text" title="No transactions" />
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
      </section>
    </>
  );
}

function ContactsTab({ customer, canEdit }) {
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.customerContacts.listAll({ customer: customer.id })); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [customer.id]);
  useEffect(() => { load(); }, [load]);

  const remove = async (c) => {
    if (!window.confirm(`Delete contact ${c.name}?`)) return;
    try { await api.customerContacts.remove(c.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <>
      <section className="page-card">
        <SectionHeader first icon="bi-person-lines-fill" title="Contacts" subtitle={`${rows.length} contact${rows.length !== 1 ? 's' : ''}`}>
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i> Add contact
            </button>
          )}
        </SectionHeader>

        {loading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : !rows.length ? (
          <EmptyState icon="bi-person-lines-fill" title="No contacts yet" text={canEdit ? "Click 'Add contact' to add the first one" : undefined} />
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Name</th><th>Position</th><th>Phone</th><th>Email</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-name">{r.name}</td>
                      <td>{r.position || '—'}</td>
                      <td>{r.phone || '—'}</td>
                      <td>{r.email || '—'}</td>
                      <td>
                        {canEdit && (
                          <div className="row-actions">
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(r)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(r)}>
                              <i className="bi bi-trash"></i>
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
      </section>

      {editing && (
        <ContactModal
          customer={customer}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </>
  );
}

function ContactModal({ customer, row, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({ name: row.name || '', position: row.position || '', phone: row.phone || '', email: row.email || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      isNew ? await api.customerContacts.create({ ...form, customer: customer.id })
            : await api.customerContacts.update(row.id, form);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New contact' : 'Edit contact'}
      subtitle={customer.name}
      icon="bi-person-lines-fill"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="contactForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="contactForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Contact Details</h6>
        <div className="form-grid">
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Position"><input className="form-control" value={form.position} onChange={set('position')} /></Field>
          <Field label="Phone"><input className="form-control" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Email" err={fieldErr.email}>
            <input type="email" className="form-control" value={form.email} onChange={set('email')} />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
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
    <Modal
      show
      onClose={onClose}
      title="Set credit limit"
      subtitle={customer.name}
      icon="bi-credit-card"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="creditForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="creditForm" onSubmit={submit}>
        <div className="form-grid">
          <Field label="New limit" required>
            <input type="number" step="0.01" className="form-control num" value={form.limit}
                   onChange={(e) => setForm({ ...form, limit: e.target.value })} required />
          </Field>
          <Field label="Reason" span>
            <textarea className="form-control" rows={2} value={form.reason}
                      onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
        </div>
        <p className="text-muted-soft mt-3" style={{ fontSize: '0.8125rem' }}>
          This creates an approved credit-limit history row.
        </p>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}