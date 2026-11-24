/**
 * Approval policies + number sequences.
 * - CRUD /approval-policies/  (company scoped) → drives svc.required_role(company, doc_type, amount)
 * - CRUD /number-sequences/   (company scoped) → drives svc.next_reference()
 *
 * doc_type in ApprovalPolicy is the model class name (e.g. "PurchaseOrder", "Payment",
 * "Expense", "StockAdjustment") — matches keys in services.APPROVAL_FLOW.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const TABS = [
  { key: 'policies', label: 'Approval policies' },
  { key: 'sequences', label: 'Number sequences' },
];

// Keys of services.APPROVAL_FLOW — safe to add others, but these drive the workflow
const DOC_TYPES = [
  'PurchaseRequisition', 'PurchaseOrder', 'SalesOrder', 'Expense',
  'Payment', 'TransportBooking', 'Shipment', 'StockAdjustment', 'ShipmentDelivery',
];

export default function Policies() {
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [tab, setTab] = useState('policies');
  const [policies, setPolicies] = useState([]);
  const [sequences, setSequences] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [p, s, r] = await Promise.all([
        api.approvalPolicies.listAll({ ...companyParams(), ordering: 'doc_type' }),
        api.numberSequences.listAll({ ...companyParams(), ordering: 'doc_type' }),
        api.roles.listAll(),
      ]);
      setPolicies(p); setSequences(s); setRoles(r);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const removeP = async (r) => {
    if (!window.confirm(`Remove this policy for ${r.doc_type}?`)) return;
    try { await api.approvalPolicies.remove(r.id); notify('Policy removed.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const removeS = async (r) => {
    if (!window.confirm(`Delete the sequence for ${r.doc_type}?`)) return;
    try { await api.numberSequences.remove(r.id); notify('Sequence deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Policies & numbering</h1>
          <p className="page-header__subtitle">
            Approvals and reference sequences{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {tab === 'policies' && (
            <button className="btn btn-primary" onClick={() => setEditing({ kind: 'policy', row: {} })}>
              <i className="bi bi-plus-lg" /> New policy
            </button>
          )}
          {tab === 'sequences' && (
            <button className="btn btn-primary" onClick={() => setEditing({ kind: 'sequence', row: {} })}>
              <i className="bi bi-plus-lg" /> New sequence
            </button>
          )}
        </div>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            <span className="tab__count">{t.key === 'policies' ? policies.length : sequences.length}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="card"><div className="card__body">
          <p className="field-error" role="alert">{error}</p>
          <button className="btn mt-2" onClick={load}>Try again</button>
        </div></div>
      ) : loading ? (
        <div className="state-screen">Loading…</div>
      ) : tab === 'policies' ? (
        <div className="table-card">
          {!policies.length ? (
            <div className="table-empty">
              <div className="table-empty__title">No approval policies</div>
              <div>Documents with an amount at or above a policy row require that role's approval.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Document</th><th className="num">Min amount</th><th>Approver role</th><th className="col-actions" /></tr></thead>
                <tbody>
                  {policies.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.doc_type}</td>
                      <td className="num">{Number(r.min_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td>{r.approver_role_label || r.approver_role}</td>
                      <td className="col-actions">
                        <div className="row-actions">
                          <button className="row-action" title="Edit" onClick={() => setEditing({ kind: 'policy', row: r })}><i className="bi bi-pencil" /></button>
                          <button className="row-action row-action--danger" title="Remove" onClick={() => removeP(r)}><i className="bi bi-trash" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="table-card">
          {!sequences.length ? (
            <div className="table-empty">
              <div className="table-empty__title">No sequences yet</div>
              <div>Sequences are auto-created the first time a document type is saved.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Doc type</th><th>Prefix</th><th className="num">Padding</th><th className="num">Next #</th><th className="col-actions" /></tr></thead>
                <tbody>
                  {sequences.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.doc_type}</td>
                      <td className="mono">{r.prefix}</td>
                      <td className="num">{r.padding}</td>
                      <td className="num">{r.next_number}</td>
                      <td className="col-actions">
                        <button className="row-action" title="Edit" onClick={() => setEditing({ kind: 'sequence', row: r })}><i className="bi bi-pencil" /></button>
                        <button className="row-action row-action--danger" title="Delete" onClick={() => removeS(r)}><i className="bi bi-trash" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editing?.kind === 'policy' && (
        <PolicyModal row={editing.row} roles={roles} companyParams={companyParams}
                     onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Policy saved.', 'success'); load(); }} />
      )}
      {editing?.kind === 'sequence' && (
        <SequenceModal row={editing.row} companyParams={companyParams}
                       onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Sequence saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function PolicyModal({ row, roles, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    doc_type: row.doc_type || 'PurchaseOrder', min_amount: row.min_amount ?? '',
    approver_role: row.approver_role || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      isNew ? await api.approvalPolicies.create(body) : await api.approvalPolicies.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New approval policy' : 'Edit policy'}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Document type" required err={fieldErr.doc_type}>
                <input className="input mono" list="doctypes" value={form.doc_type} onChange={set('doc_type')} required />
                <datalist id="doctypes">{DOC_TYPES.map((d) => <option key={d} value={d} />)}</datalist>
              </Field>
              <Field label="Min amount" required err={fieldErr.min_amount}>
                <input type="number" step="0.01" className="input num" value={form.min_amount} onChange={set('min_amount')} required />
              </Field>
              <Field label="Approver role" required err={fieldErr.approver_role} span>
                <select className="select" value={form.approver_role} onChange={set('approver_role')} required>
                  <option value="">—</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                </select>
              </Field>
            </div>
            <p className="field-hint mt-3">
              For documents with amount ≥ this minimum, only the selected role can approve.
            </p>
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

function SequenceModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    doc_type: row.doc_type || '', prefix: row.prefix || '',
    padding: row.padding ?? 5, next_number: row.next_number ?? 1,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      isNew ? await api.numberSequences.create(body) : await api.numberSequences.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New number sequence' : `Edit ${row.doc_type}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Doc type" required err={fieldErr.doc_type}>
                <input className="input mono" value={form.doc_type} onChange={set('doc_type')} required disabled={!isNew} />
              </Field>
              <Field label="Prefix" required err={fieldErr.prefix}>
                <input className="input mono" value={form.prefix} onChange={set('prefix')} maxLength={10} required />
              </Field>
              <Field label="Padding" required>
                <input type="number" min={1} max={10} className="input num" value={form.padding} onChange={set('padding')} />
              </Field>
              <Field label="Next number" required>
                <input type="number" min={1} className="input num" value={form.next_number} onChange={set('next_number')} />
              </Field>
            </div>
            <p className="field-hint mt-3">
              Next reference will be e.g. <code>{companyParams().company ? `{company}-${form.prefix || 'PREFIX'}-{year}-${String(form.next_number || 1).padStart(form.padding || 5, '0')}` : '…'}</code>.
            </p>
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