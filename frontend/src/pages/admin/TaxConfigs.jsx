/**
 * Tax / levy / duty configuration.
 * - CRUD  /tax-configs/            crud('tax-configs')
 * - POST  /tax-configs/:id/verify  Professional verification (different user, server-enforced)
 *
 * Rule from services.get_tax_rate: only verified + active + effective configs are used when
 * calculating line tax, so we surface verification state prominently.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const TYPES = ['VAT', 'EXCISE', 'DUTY', 'LEVY', 'WHT', 'OTHER'];
const EMPTY = {
  code: '', name: '', tax_type: 'VAT', rate_percent: '',
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: '', is_active: true, notes: '',
};

const verified = (t) => !!t.verified_at;

export default function TaxConfigs() {
  const { user, can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [editing, setEditing] = useState(null);

  const canEdit = can('company.edit');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.taxConfigs.list({
        ...companyParams(), ordering: 'code', page_size: 500,
        ...(search ? { search } : {}),
        ...(typeFilter ? { tax_type: typeFilter } : {}),
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const verify = async (t) => {
    try {
      await api.taxConfigs.verify(t.id);
      notify(`Tax code ${t.code} verified.`, 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete tax code ${t.code}?`)) return;
    try { await api.taxConfigs.remove(t.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Tax configuration</h1>
          <p className="page-header__subtitle">
            Effective-dated, professionally verified rates
            {activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>
              <i className="bi bi-plus-lg" /> New tax code
            </button>
          )}
        </div>
      </header>

      <div className="card mb-4">
        <div className="card__body card__body--tight">
          <p className="text-sm text-muted">
            A tax code can only be used in calculations once it has been verified by a user other than its creator,
            and while today's date is inside its effective range.
          </p>
        </div>
      </div>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{rows.length} code{rows.length === 1 ? '' : 's'}</span>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !rows.length && !loading ? (
          <div className="table-empty">
            <div className="table-empty__title">No tax codes</div>
            <div>Add a VAT, excise, duty or levy configuration to start using taxes.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Type</th><th className="num">Rate %</th>
                  <th>Effective</th><th>Verification</th><th>Status</th><th className="col-actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const isMine = t.created_by === user?.id;
                  return (
                    <tr key={t.id}>
                      <td className="mono">{t.code}</td>
                      <td>{t.name}</td>
                      <td><span className="badge">{t.tax_type}</span></td>
                      <td className="num">{Number(t.rate_percent).toFixed(3)}</td>
                      <td className="text-sm">
                        {t.effective_from}
                        {t.effective_to ? ` → ${t.effective_to}` : ' →'}
                      </td>
                      <td>
                        {verified(t) ? (
                          <span className="badge badge--success" title={`${t.verified_by_label || 'verified'}`}>
                            Verified
                          </span>
                        ) : (
                          <span className="badge badge--warning">Unverified</span>
                        )}
                      </td>
                      <td>
                        <span className={`status ${t.is_active ? 'status-active' : 'status-inactive'}`}>
                          {t.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          {canEdit && !verified(t) && !isMine && (
                            <button className="btn btn-xs btn-soft" onClick={() => verify(t)}>
                              Verify
                            </button>
                          )}
                          {canEdit && (
                            <>
                              <button className="row-action" title="Edit" onClick={() => setEditing(t)}>
                                <i className="bi bi-pencil" />
                              </button>
                              <button className="row-action row-action--danger" title="Delete" onClick={() => remove(t)}>
                                <i className="bi bi-trash" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <TaxModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Tax code saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function TaxModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', tax_type: row.tax_type || 'VAT',
    rate_percent: row.rate_percent ?? '', effective_from: row.effective_from || '', effective_to: row.effective_to || '',
    is_active: row.is_active ?? true, notes: row.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.effective_to) body.effective_to = null;
      isNew ? await api.taxConfigs.create(body) : await api.taxConfigs.update(row.id, body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err)); setFieldErr(fieldErrors(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New tax code' : `Edit ${row.code}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Code" required err={fieldErr.code}>
                <input className="input mono" value={form.code} onChange={set('code')} required disabled={!isNew} />
              </Field>
              <Field label="Name" required err={fieldErr.name}>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Type" required>
                <select className="select" value={form.tax_type} onChange={set('tax_type')} required>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Rate %" required err={fieldErr.rate_percent}>
                <input type="number" step="0.001" className="input num" value={form.rate_percent} onChange={set('rate_percent')} required />
              </Field>
              <Field label="Effective from" required>
                <input type="date" className="input" value={form.effective_from} onChange={set('effective_from')} required />
              </Field>
              <Field label="Effective to">
                <input type="date" className="input" value={form.effective_to} onChange={set('effective_to')} />
              </Field>
              <Field label="Notes" span>
                <textarea className="textarea" rows={2} value={form.notes} onChange={set('notes')} />
              </Field>
              <Field label="Active" span>
                <label className="check"><input type="checkbox" checked={!!form.is_active} onChange={set('is_active')} /> Active</label>
              </Field>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
            <p className="field-hint mt-3">
              A different user must verify this code before it is used in calculations.
            </p>
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