/**
 * Approval policies + number sequences.
 * - CRUD /approval-policies/  (company scoped) ? drives svc.required_role(company, doc_type, amount)
 * - CRUD /number-sequences/   (company scoped) ? drives svc.next_reference()
 *
 * doc_type in ApprovalPolicy is the model class name (e.g. "PurchaseOrder", "Payment",
 * "Expense", "StockAdjustment") — matches keys in services.APPROVAL_FLOW.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const TABS = [
  { key: 'policies', label: 'Approval policies', icon: 'bi-shield-check' },
  { key: 'sequences', label: 'Number sequences', icon: 'bi-123' },
];

// Keys of services.APPROVAL_FLOW — these drive the workflow
const DOC_TYPES = [
  'PurchaseRequisition', 'PurchaseOrder', 'SalesOrder', 'Expense',
  'Payment', 'TransportBooking', 'Shipment', 'StockAdjustment', 'ShipmentDelivery',
];

const money = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  const removePolicy = async (r) => {
    if (!window.confirm(`Remove this policy for ${r.doc_type}?`)) return;
    try { await api.approvalPolicies.remove(r.id); notify('Policy removed.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const removeSequence = async (r) => {
    if (!window.confirm(`Delete the sequence for ${r.doc_type}?`)) return;
    try { await api.numberSequences.remove(r.id); notify('Sequence deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const isPolicies = tab === 'policies';
  const count = isPolicies ? policies.length : sequences.length;

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Policies & numbering</h1>
            <p className="page-subtitle">
              Approvals and reference sequences{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({ kind: isPolicies ? 'policy' : 'sequence', row: {} })}>
            <i className="bi bi-plus-lg"></i>
            {isPolicies ? 'New policy' : 'New sequence'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      <section className="page-card">
        <div className="tabs" style={{ padding: '0 1rem' }}>
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              <i className={`bi ${t.icon}`} aria-hidden="true"></i> {t.label}
              <span className="tab__count">{t.key === 'policies' ? policies.length : sequences.length}</span>
            </button>
          ))}
        </div>

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            {isPolicies ? 'Approval Policies' : 'Number Sequences'}
          </span>
          <span className="chart-card__subtitle">
            {count} {isPolicies ? 'polic' : 'sequence'}{isPolicies ? (count !== 1 ? 'ies' : 'y') : (count !== 1 ? 's' : '')}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={6} columns={4} />
        ) : isPolicies ? (
          <PoliciesTable rows={policies} onEdit={(r) => setEditing({ kind: 'policy', row: r })} onDelete={removePolicy} />
        ) : (
          <SequencesTable rows={sequences} onEdit={(r) => setEditing({ kind: 'sequence', row: r })} onDelete={removeSequence} />
        )}
      </section>

      {editing?.kind === 'policy' && (
        <PolicyModal
          row={editing.row} roles={roles} companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Policy saved.', 'success'); load(); }}
        />
      )}
      {editing?.kind === 'sequence' && (
        <SequenceModal
          row={editing.row} companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Sequence saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function PoliciesTable({ rows, onEdit, onDelete }) {
  const { pageRows, paginationProps } = usePagination(rows);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-shield-check"></i>
        <h6>No approval policies yet</h6>
        <p className="text-muted-soft">Documents at or above a policy's minimum amount need that role's approval.</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Document</th>
                <th className="text-right">Min amount</th>
                <th>Approver role</th>
                <th className="text-center" style={{ width: '7rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-mono text-brand fw-600">{r.doc_type}</td>
                  <td className="cell-num">{money(r.min_amount)}</td>
                  <td className="cell-name">{r.approver_role_label || r.approver_role}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => onEdit(r)}>
                        <i className="bi bi-pencil"></i>
                      </button>
                      <button className="btn btn-icon" title="Remove" aria-label="Remove" onClick={() => onDelete(r)}>
                        <i className="bi bi-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination {...paginationProps} />
    </>
  );
}

function SequencesTable({ rows, onEdit, onDelete }) {
  const { pageRows, paginationProps } = usePagination(rows);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-123"></i>
        <h6>No number sequences yet</h6>
        <p className="text-muted-soft">Sequences are created automatically the first time a document type is saved.</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Doc type</th>
                <th>Prefix</th>
                <th className="text-right">Padding</th>
                <th className="text-right">Next #</th>
                <th className="text-center" style={{ width: '7rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-mono text-brand fw-600">{r.doc_type}</td>
                  <td className="cell-mono">{r.prefix}</td>
                  <td className="cell-num">{r.padding}</td>
                  <td className="cell-num">{r.next_number}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => onEdit(r)}>
                        <i className="bi bi-pencil"></i>
                      </button>
                      <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => onDelete(r)}>
                        <i className="bi bi-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination {...paginationProps} />
    </>
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
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New approval policy' : 'Edit approval policy'}
      subtitle="Who must approve documents above an amount"
      icon="bi-shield-check"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="policyForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="policyForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Policy</h6>
        <div className="form-grid">
          <Field label="Document type" required err={fieldErr.doc_type}>
            <input className="form-control font-mono" list="doctypes" value={form.doc_type} onChange={set('doc_type')} required />
            <datalist id="doctypes">{DOC_TYPES.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          <Field label="Min amount" required err={fieldErr.min_amount}>
            <input type="number" step="0.01" className="form-control num" value={form.min_amount} onChange={set('min_amount')} required />
          </Field>
          <Field label="Approver role" required err={fieldErr.approver_role} span>
            <select className="form-select" value={form.approver_role} onChange={set('approver_role')} required>
              <option value="">—</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-muted-soft mt-3">
          For documents with an amount at or above this minimum, only the selected role (or a Group Administrator) can approve.
        </p>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
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

  const preview = `{company}-${form.prefix || 'PREFIX'}-{year}-${String(form.next_number || 1).padStart(Number(form.padding) || 5, '0')}`;

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New number sequence' : `Edit ${row.doc_type}`}
      subtitle="Reference numbering per document type"
      icon="bi-123"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="sequenceForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="sequenceForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Sequence</h6>
        <div className="form-grid">
          <Field label="Doc type" required err={fieldErr.doc_type}>
            <input className="form-control font-mono" value={form.doc_type} onChange={set('doc_type')} required disabled={!isNew} />
          </Field>
          <Field label="Prefix" required err={fieldErr.prefix}>
            <input className="form-control font-mono" value={form.prefix} onChange={set('prefix')} maxLength={10} required />
          </Field>
          <Field label="Padding" required err={fieldErr.padding}>
            <input type="number" min={1} max={10} className="form-control num" value={form.padding} onChange={set('padding')} />
          </Field>
          <Field label="Next number" required err={fieldErr.next_number}>
            <input type="number" min={1} className="form-control num" value={form.next_number} onChange={set('next_number')} />
          </Field>
        </div>
        <p className="text-muted-soft mt-3">Next reference will look like <code>{preview}</code></p>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}