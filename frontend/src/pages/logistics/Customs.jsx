/**
 * Customs: export declarations + compliance checks.
 * - CRUD /export-declarations/     (withStatus via set-status)
 * - CRUD /compliance-checks/
 * - /compliance-requirements/ and /border-crossings/ used as pickers
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const DECL_STATUS = ['DRAFT', 'SUBMITTED', 'QUERIED', 'CLEARED', 'REJECTED'];
const CHECK_STATUS = ['PENDING', 'PROVIDED', 'WAIVED', 'NOT_APPLICABLE'];
const todayISO = () => new Date().toISOString().slice(0, 10);

const declPill = (s) => {
  if (s === 'CLEARED') return 'status-pill--success';
  if (s === 'REJECTED') return 'status-pill--danger';
  if (s === 'SUBMITTED' || s === 'QUERIED') return 'status-pill--warning';
  return 'status-pill--neutral';
};
const checkPill = (s) => {
  if (s === 'PROVIDED') return 'status-pill--success';
  if (s === 'WAIVED') return 'status-pill--warning';
  return 'status-pill--neutral';
};

export default function Customs() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [tab, setTab] = useState('declarations');
  const [declarations, setDeclarations] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null); // { kind: 'declarations' | 'checks' }

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [d, c] = await Promise.all([
        api.exportDeclarations.listAll({ ...companyParams(), ordering: '-id' }),
        api.complianceChecks.listAll({ ...companyParams(), ordering: '-id' }),
      ]);
      setDeclarations(d); setChecks(c);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSearch(''); setStatus(''); }, [tab]);

  const setDeclStatus = async (decl, next) => {
    try { await api.exportDeclarations.setStatus(decl.id, next); notify(`Status: ${next}`, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const isDecl = tab === 'declarations';
  const statusOptions = isDecl ? DECL_STATUS : CHECK_STATUS;

  // listAll returns everything, so search/status filtering is client-side.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = isDecl ? declarations : checks;
    const fields = isDecl
      ? (r) => [r.reference, r.shipment_label, r.shipment, r.declaration_number, r.customs_reference, r.border_crossing_label]
      : (r) => [r.shipment_label, r.shipment, r.requirement_label, r.document_ref, r.checked_by_label];
    return source.filter((r) => {
      if (status && r.status !== status) return false;
      if (!q) return true;
      return fields(r).some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [isDecl, declarations, checks, search, status]);

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);
  const noun = isDecl ? 'declaration' : 'check';

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Customs</h1>
            <p className="page-subtitle">
              Export declarations and compliance{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('customs.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({ kind: tab })}>
              <i className="bi bi-plus-lg"></i>
              New {noun}
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

      <div className="tabs">
        <button className={`tab ${isDecl ? 'active' : ''}`} onClick={() => setTab('declarations')}>
          Declarations <span className="tab__count">{declarations.length}</span>
        </button>
        <button className={`tab ${!isDecl ? 'active' : ''}`} onClick={() => setTab('checks')}>
          Compliance checks <span className="tab__count">{checks.length}</span>
        </button>
      </div>

      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder={isDecl ? 'Search by reference, shipment or declaration #...' : 'Search by shipment, requirement or document...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={`Search ${noun}s`}
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
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
            {isDecl ? 'Declaration List' : 'Compliance Check List'}
          </span>
          <span className="chart-card__subtitle">
            {rows.length} {noun}{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={isDecl ? 9 : 6} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-shield-check"></i>
            <h6>{hasActiveFilters ? `No ${noun}s match your search` : `No ${noun}s yet`}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : `Click 'New ${noun}' to add the first one`}
            </p>
          </div>
        ) : isDecl ? (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Shipment</th>
                    <th>Declaration #</th>
                    <th>Customs ref</th>
                    <th>Border</th>
                    <th>Export date</th>
                    <th>Clearance</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((d) => (
                    <tr key={d.id}>
                      <td className="cell-mono text-brand fw-600">{d.reference}</td>
                      <td>{d.shipment_label || d.shipment}</td>
                      <td className="cell-mono">{d.declaration_number || '—'}</td>
                      <td className="cell-mono">{d.customs_reference || '—'}</td>
                      <td>{d.border_crossing_label || '—'}</td>
                      <td>{d.export_date || '—'}</td>
                      <td>{d.clearance_date || '—'}</td>
                      <td><span className={`status-pill ${declPill(d.status)}`}>{d.status}</span></td>
                      <td>
                        {can('customs.edit') && d.status !== 'CLEARED' && d.status !== 'REJECTED' && (
                          <select
                            className="form-select form-select-sm"
                            value={d.status}
                            onChange={(e) => setDeclStatus(d, e.target.value)}
                            aria-label="Change status"
                          >
                            {DECL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Shipment</th>
                    <th>Requirement</th>
                    <th>Status</th>
                    <th>Doc ref</th>
                    <th>Checked by</th>
                    <th>Checked at</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => (
                    <tr key={c.id}>
                      <td className="cell-name">{c.shipment_label || c.shipment}</td>
                      <td>{c.requirement_label || c.requirement}</td>
                      <td><span className={`status-pill ${checkPill(c.status)}`}>{c.status.replace('_', ' ')}</span></td>
                      <td className="cell-mono">{c.document_ref || '—'}</td>
                      <td>{c.checked_by_label || '—'}</td>
                      <td>{c.checked_at || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing?.kind === 'declarations' && (
        <DeclarationModal
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
      {editing?.kind === 'checks' && (
        <CheckModal
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------
 * NOTE: the original page opened `editing` for "New declaration/check" but never
 * rendered a modal. These two modals are new; field names come from the list columns,
 * and the picker APIs (shipments, borderCrossings, complianceRequirements) are assumed.
 * ---------------------------------------------------------------- */

function DeclarationModal({ companyParams, onClose, onSaved }) {
  const [shipments, setShipments] = useState([]);
  const [borders, setBorders] = useState([]);
  const [form, setForm] = useState({
    shipment: '', declaration_number: '', customs_reference: '',
    border_crossing: '', export_date: todayISO(), clearance_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.shipments.listAll({ ...companyParams() }),
      api.borderCrossings.listAll(),
    ]).then(([s, b]) => { setShipments(s); setBorders(b); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      ['border_crossing', 'clearance_date'].forEach((k) => { if (!body[k]) delete body[k]; });
      await api.exportDeclarations.create(body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="New declaration"
      subtitle="Export declarations and compliance"
      icon="bi-shield-check"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="declarationForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="declarationForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Declaration Details</h6>
        <div className="form-grid">
          <Field label="Shipment" required err={fieldErr.shipment}>
            <select className="form-select" value={form.shipment} onChange={set('shipment')} required>
              <option value="">—</option>
              {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference}</option>)}
            </select>
          </Field>
          <Field label="Border crossing" err={fieldErr.border_crossing}>
            <select className="form-select" value={form.border_crossing} onChange={set('border_crossing')}>
              <option value="">—</option>
              {borders.map((b) => <option key={b.id} value={b.id}>{b.name || b.code}</option>)}
            </select>
          </Field>
          <Field label="Declaration #" err={fieldErr.declaration_number}>
            <input className="form-control font-mono" value={form.declaration_number} onChange={set('declaration_number')} />
          </Field>
          <Field label="Customs reference" err={fieldErr.customs_reference}>
            <input className="form-control font-mono" value={form.customs_reference} onChange={set('customs_reference')} />
          </Field>
          <Field label="Export date">
            <input type="date" className="form-control" value={form.export_date} onChange={set('export_date')} />
          </Field>
          <Field label="Clearance date">
            <input type="date" className="form-control" value={form.clearance_date} onChange={set('clearance_date')} />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function CheckModal({ companyParams, onClose, onSaved }) {
  const [shipments, setShipments] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [form, setForm] = useState({ shipment: '', requirement: '', status: 'PENDING', document_ref: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.shipments.listAll({ ...companyParams() }),
      api.complianceRequirements.listAll(),
    ]).then(([s, r]) => { setShipments(s); setRequirements(r); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      await api.complianceChecks.create({ ...form, company: companyParams().company });
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="New compliance check"
      subtitle="Export declarations and compliance"
      icon="bi-shield-check"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="checkForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="checkForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Check Details</h6>
        <div className="form-grid">
          <Field label="Shipment" required err={fieldErr.shipment}>
            <select className="form-select" value={form.shipment} onChange={set('shipment')} required>
              <option value="">—</option>
              {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference}</option>)}
            </select>
          </Field>
          <Field label="Requirement" required err={fieldErr.requirement}>
            <select className="form-select" value={form.requirement} onChange={set('requirement')} required>
              <option value="">—</option>
              {requirements.map((r) => <option key={r.id} value={r.id}>{r.name || r.code}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="form-select" value={form.status} onChange={set('status')}>
              {CHECK_STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Document ref">
            <input className="form-control font-mono" value={form.document_ref} onChange={set('document_ref')} />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}