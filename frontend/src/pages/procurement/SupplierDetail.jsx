/**
 * Supplier detail.
 * - Header: overview + edit / deactivate
 * - Tabs: Overview / Statement / Prices / Performance / Contacts
 *
 * Endpoints:
 *   /suppliers/:id/statement/
 *   /suppliers/:id/price-history/
 *   /suppliers/:id/performance/
 *   /supplier-contacts/ (crud)   + /supplier-contracts/, /supplier-prices/, /supplier-quotations/
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';
import { SectionHeader, SectionBody, KV, EmptyState } from '../../components/PageSection';
import { SupplierModal, supplierStatusPill } from './Suppliers';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'bi-info-circle' },
  { key: 'statement', label: 'Statement', icon: 'bi-file-text' },
  { key: 'prices', label: 'Prices', icon: 'bi-tag' },
  { key: 'performance', label: 'Performance', icon: 'bi-speedometer2' },
  { key: 'contacts', label: 'Contacts', icon: 'bi-person-lines-fill' },
];

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function SupplierDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { notify } = useApp();
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

  if (loading && !supplier) {
    return <div><section className="page-card"><TableSkeleton rows={6} columns={4} /></section></div>;
  }
  if (error && !supplier) {
    return (
      <div>
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (!supplier) return null;
  const s = supplier;

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-building"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">
              {s.name}{' '}
              <span className={`status-pill ${supplierStatusPill(s.status)}`}>{s.status}</span>
            </h1>
            <p className="page-subtitle">
              {s.code} · {s.country} · {s.payment_terms_days} days · credit limit {fmtMoney(s.credit_limit, s.currency)}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/procurement/suppliers" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Suppliers
          </Link>
          {can('suppliers.edit') && (
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

      {tab === 'overview' && <Overview s={s} />}
      {tab === 'statement' && <StatementTab id={id} />}
      {tab === 'prices' && <PricesTab id={id} />}
      {tab === 'performance' && <PerformanceTab id={id} />}
      {tab === 'contacts' && <ContactsTab supplier={s} canEdit={can('suppliers.edit')} />}

      {editing && (
        <SupplierModal
          row={s}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function Overview({ s }) {
  return (
    <section className="page-card">
      <SectionHeader first icon="bi-info-circle" title="Supplier Details" />
      <SectionBody>
        <KV items={[
          ['Tax PIN', s.tax_pin || '—'],
          ['Registration', s.registration_number || '—'],
          ['Contact person', s.contact_person || '—'],
          ['Phone', s.phone || '—'],
          ['Email', s.email || '—'],
          ['Bank', s.bank_name || '—'],
          ['Bank account', s.bank_account || '—'],
          ['SWIFT', s.bank_swift || '—'],
        ]} />
        {s.address && (
          <p className="text-muted-soft" style={{ marginTop: '1rem', marginBottom: 0 }}>
            <i className="bi bi-geo-alt"></i> {s.address}
          </p>
        )}
      </SectionBody>
    </section>
  );
}

function StatementTab({ id }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    setLoading(true); setError('');
    api.suppliers.statement(id).then(setData).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <section className="page-card"><TableSkeleton rows={6} columns={7} /></section>;
  if (error) return <div className="alert alert-danger" role="alert">{error}</div>;
  if (!data) return null;

  const rows = data.rows || [];
  const closing = Object.entries(data.closing || {});

  return (
    <>
      <section className="page-card">
        <SectionHeader first icon="bi-cash-stack" title="Closing Balances" />
        {!closing.length ? (
          <EmptyState icon="bi-cash-stack" title="No movements" />
        ) : (
          <SectionBody>
            <KV items={closing.map(([ccy, bal]) => [ccy, fmtMoney(bal, ccy), Number(bal) > 0])} />
          </SectionBody>
        )}
      </section>

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

function PricesTab({ id }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.suppliers.priceHistory(id).then(setRows).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  return (
    <section className="page-card">
      <SectionHeader first icon="bi-tag" title="Price History" subtitle={`${rows.length} record${rows.length !== 1 ? 's' : ''}`} />
      {loading ? (
        <TableSkeleton rows={5} columns={5} />
      ) : !rows.length ? (
        <EmptyState icon="bi-tag" title="No price records" />
      ) : (
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr><th>Date</th><th>Product</th><th className="text-right">Price</th><th>Ccy</th><th>Source</th></tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={i}>
                    <td>{p.date}</td>
                    <td className="cell-name">{p.product}</td>
                    <td className="cell-num">{Number(p.price).toFixed(6)}</td>
                    <td>{p.currency}</td>
                    <td><span className="badge badge-neutral">{p.source}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function PerformanceTab({ id }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.suppliers.performance(id).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  return (
    <section className="page-card">
      <SectionHeader first icon="bi-speedometer2" title="Performance" />
      {loading ? (
        <TableSkeleton rows={3} columns={3} />
      ) : !data ? (
        <EmptyState icon="bi-speedometer2" title="Performance data unavailable" />
      ) : (
        <SectionBody>
          <KV items={[
            ['Orders', data.orders ?? 0],
            ['Litres ordered', Number(data.litres_ordered || 0).toLocaleString()],
            ['Litres received', Number(data.litres_received || 0).toLocaleString()],
            ['Fill rate %', data.fill_rate_pct != null ? Number(data.fill_rate_pct).toFixed(2) : '—'],
            ['Invoice match exceptions', data.invoice_match_exceptions ?? 0],
          ]} />
        </SectionBody>
      )}
    </section>
  );
}

function ContactsTab({ supplier, canEdit }) {
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.supplierContacts.listAll({ supplier: supplier.id })); }
    catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, [supplier.id]);
  useEffect(() => { load(); }, [load]);

  const remove = async (c) => {
    if (!window.confirm(`Delete contact ${c.name}?`)) return;
    try { await api.supplierContacts.remove(c.id); notify('Deleted.', 'success'); load(); }
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
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="cell-name">{c.name}</td>
                      <td>{c.position || '—'}</td>
                      <td>{c.phone || '—'}</td>
                      <td>{c.email || '—'}</td>
                      <td>
                        {canEdit && (
                          <div className="row-actions">
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(c)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(c)}>
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
          supplier={supplier}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </>
  );
}

function ContactModal({ supplier, row, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    name: row.name || '', position: row.position || '', phone: row.phone || '', email: row.email || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      isNew ? await api.supplierContacts.create({ ...form, supplier: supplier.id })
            : await api.supplierContacts.update(row.id, form);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New contact' : 'Edit contact'}
      subtitle={supplier.name}
      icon="bi-person-lines-fill"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="supplierContactForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="supplierContactForm" onSubmit={submit}>
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