/**
 * Drivers.
 * - CRUD /drivers/
 * - GET  /drivers/:id/profile/   (licence, current trip, stats, trips, vehicles, advances)
 * - POST /drivers/:id/photo/     (profile photo)
 * Fields: code, full_name, id_number, licence_number, licence_category, licence_expiry, phone, photo, employment_status
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['ACTIVE', 'SUSPENDED', 'TERMINATED'];

const statusPill = (s) => {
  if (s === 'ACTIVE') return 'status-pill--success';
  if (s === 'SUSPENDED') return 'status-pill--warning';
  return 'status-pill--neutral';
};

const tripPill = (s) => {
  if (['DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED'].includes(s)) return 'status-pill--success';
  if (['LOADING', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED', 'ARRIVED'].includes(s)) return 'status-pill--info';
  if (['APPROVED', 'AWAITING_LOADING', 'AWAITING_APPROVAL'].includes(s)) return 'status-pill--warning';
  return 'status-pill--neutral';
};

const pretty = (s) => (s ? String(s).replace(/_/g, ' ') : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const num = (n, dp = 0) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const initialsOf = (name) => (name || '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

// Licence state from the expiry date (used in the list; the profile gets it from the server).
const licenceState = (expiry) => {
  if (!expiry) return { key: 'UNKNOWN', text: '—', cls: '' };
  const days = Math.floor((new Date(expiry) - new Date(new Date().toDateString())) / 86400000);
  if (days < 0) return { key: 'EXPIRED', text: `${fmtDate(expiry)} · expired`, cls: 'text-danger fw-600' };
  if (days <= 30) return { key: 'EXPIRING', text: `${fmtDate(expiry)} · ${days}d left`, cls: 'text-warning fw-600' };
  return { key: 'VALID', text: fmtDate(expiry), cls: '' };
};

function Avatar({ src, name, size = '2rem' }) {
  const style = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--blue-100, #dbeafe)', color: 'var(--blue-600, #2563eb)',
    fontWeight: 700, fontSize: `calc(${size} * 0.38)`,
  };
  return src
    ? <img src={src} alt="" style={style} />
    : <span style={style}>{initialsOf(name) || <i className="bi bi-person"></i>}</span>;
}

export default function Drivers() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.drivers.list({
        ...companyParams(),
        ordering: 'full_name',
        ...(search ? { search } : {}),
        ...(status ? { employment_status: status } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, status]);

  useEffect(() => { load(); }, [load]);

  const remove = async (d) => {
    if (!window.confirm(`Delete driver ${d.full_name}?`)) return;
    try { await api.drivers.remove(d.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">

          <div className="page-header__text">
            <h1 className="page-title">Drivers</h1>
            <p className="page-subtitle">
              Licenced drivers{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('fleet.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New driver
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

      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by name, code, licence or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search drivers"
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
            Driver List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} driver{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-person-badge"></i>
            <h6>{hasActiveFilters ? 'No drivers match your search' : 'No drivers yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New driver' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Code</th>
                    <th>ID number</th>
                    <th>Licence</th>
                    <th>Category</th>
                    <th>Expiry</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((d) => {
                    const lic = licenceState(d.licence_expiry);
                    return (
                      <tr key={d.id}>
                        <td className="cell-name">
                          <button
                            type="button"
                            onClick={() => setViewing(d.id)}
                            style={{ background: 'none', border: 0, padding: 0, display: 'inline-flex', alignItems: 'center', gap: '.6rem', textAlign: 'left', color: 'inherit', cursor: 'pointer' }}
                          >
                            <Avatar src={d.photo} name={d.full_name} />
                            <span>{d.full_name}</span>
                          </button>
                        </td>
                        <td className="cell-mono">{d.code || '—'}</td>
                        <td className="cell-mono">{d.id_number || '—'}</td>
                        <td className="cell-mono text-brand fw-600">{d.licence_number || '—'}</td>
                        <td>{d.licence_category || '—'}</td>
                        <td className={lic.cls}>{lic.text}</td>
                        <td>{d.phone || '—'}</td>
                        <td>
                          <span className={`status-pill ${statusPill(d.employment_status)}`}>{d.employment_status}</span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button className="btn btn-icon" title="View details" aria-label="View details" onClick={() => setViewing(d.id)}>
                              <i className="bi bi-eye"></i>
                            </button>
                            {can('fleet.edit') && (
                              <>
                                <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(d)}>
                                  <i className="bi bi-pencil"></i>
                                </button>
                                <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(d)}>
                                  <i className="bi bi-trash"></i>
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
          </div>
        )}

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && (
        <DriverModal
          row={editing}
          companyParams={companyParams}
          activeCompanyObj={activeCompanyObj}
          onClose={() => setEditing(null)}
          onSaved={(warn) => {
            setEditing(null);
            if (warn) notify(warn, 'error'); else notify('Saved.', 'success');
            load();
          }}
        />
      )}

      {viewing && (
        <DriverProfileModal
          driverId={viewing}
          canEdit={can('fleet.edit')}
          onClose={() => setViewing(null)}
          onChanged={load}
          onEdit={(d) => { setViewing(null); setEditing(d); }}
        />
      )}
    </div>
  );
}

/* ====================================================================================
 * Add / edit driver
 * ==================================================================================== */
function DriverModal({ row, companyParams, activeCompanyObj, onClose, onSaved }) {
  const isNew = !row.id;
  const app = useApp();
  const auth = useAuth();

  // Company: existing row -> active company -> ?company= param. Ask only when none can be determined.
  const knownCompany = row.company || activeCompanyObj?.id || companyParams()?.company || '';
  const companyOptions = app.companies || auth.user?.companies || [];

  const [form, setForm] = useState({
    company: knownCompany ? String(knownCompany) : '',
    code: row.code || '',
    full_name: row.full_name || '', id_number: row.id_number || '',
    licence_number: row.licence_number || '', licence_category: row.licence_category || '',
    licence_expiry: row.licence_expiry || '', phone: row.phone || '',
    employment_status: row.employment_status || 'ACTIVE',
  });
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!photo) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});

    if (!form.company) {
      setFieldErr({ company: 'Select a company.' });
      setError('Select a company for this driver.');
      return;
    }

    setBusy(true);
    try {
      const body = { ...form, company: Number(form.company) };
      // `code` is required by the unique (company, code) rule; blank lets the server auto-generate DRV-xxxxx.
      body.code = (form.code || '').trim();
      if (!body.licence_expiry) body.licence_expiry = null;

      const saved = isNew ? await api.drivers.create(body) : await api.drivers.update(row.id, body);

      let warn = '';
      if (photo) {
        try { await api.drivers.uploadPhoto(saved?.id || row.id, photo); }
        catch (pe) { warn = `Driver saved, but the photo could not be uploaded: ${errorMessage(pe)}`; }
      }
      onSaved(warn);
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New driver' : `Edit ${row.full_name}`}
      subtitle="Licenced drivers"
      icon="bi-person-badge"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="driverForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="driverForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-person" aria-hidden="true"></i>Personal Details</h6>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <Avatar src={preview || row.photo} name={form.full_name} size="4.5rem" />
          <div>
            <label className="btn btn-secondary btn-sm mb-1" style={{ cursor: 'pointer' }}>
              <i className="bi bi-camera"></i> {row.photo || preview ? 'Change photo' : 'Add photo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => setPhoto(e.target.files?.[0] || null)}
              />
            </label>
            <div className="form-text-hint">JPG, PNG or WebP, up to 5 MB.</div>
          </div>
        </div>

        <div className="form-grid">
          {!knownCompany && (
            <Field label="Company" required err={fieldErr.company}>
              <select className="form-select" value={form.company} onChange={set('company')} required>
                <option value="">Select company...</option>
                {companyOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.code ? `${c.code} — ` : ''}{c.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Code" err={fieldErr.code}>
            <input
              className="form-control font-mono"
              value={form.code}
              onChange={set('code')}
              placeholder="Auto-generated if empty"
            />
          </Field>
          <Field label="Full name" required err={fieldErr.full_name} span>
            <input className="form-control" value={form.full_name} onChange={set('full_name')} required />
          </Field>
          <Field label="ID number" err={fieldErr.id_number}>
            <input className="form-control font-mono" value={form.id_number} onChange={set('id_number')} />
          </Field>
          <Field label="Phone"><input className="form-control" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Status">
            <select className="form-select" value={form.employment_status} onChange={set('employment_status')}>
              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-card-heading" aria-hidden="true"></i>Licence</h6>
        <div className="form-grid">
          <Field label="Licence number" err={fieldErr.licence_number}>
            <input className="form-control font-mono" value={form.licence_number} onChange={set('licence_number')} />
          </Field>
          <Field label="Licence category">
            <input className="form-control" value={form.licence_category} onChange={set('licence_category')} />
          </Field>
          <Field label="Licence expiry" err={fieldErr.licence_expiry}>
            <input type="date" className="form-control" value={form.licence_expiry} onChange={set('licence_expiry')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/* ====================================================================================
 * Driver profile (detail) modal
 * Styles are scoped with the dp- prefix and use the app's design tokens.
 * ==================================================================================== */
const PROFILE_CSS = `
.dp-overlay{position:fixed;inset:0;z-index:2000;background:rgba(17,22,51,.5);backdrop-filter:blur(3px);
  display:flex;align-items:center;justify-content:center;padding:1rem}
.dp-card{width:100%;max-width:68rem;height:min(46rem,92vh);display:flex;flex-direction:column;overflow:hidden;
  background:var(--surface,#fff);color:var(--ink-900);border-radius:var(--radius-xl);
  box-shadow:var(--shadow-xl);border:1px solid var(--border-color)}
.dp-drag{cursor:grab;touch-action:none;user-select:none}
.dp-drag:active{cursor:grabbing}
@media (max-width:700px){.dp-drag{cursor:default;touch-action:auto}}
.dp-top{flex:0 0 auto;display:flex;align-items:center;gap:.85rem;padding:1.1rem 1.3rem;border-bottom:1px solid var(--border-color)}
.dp-top__icon{font-size:1.7rem;color:var(--blue-600);line-height:1;flex-shrink:0}
.dp-top__text{flex:1;min-width:0}
.dp-top__title{margin:0;font-size:var(--fs-lg);font-weight:700;letter-spacing:-.01em;line-height:1.25}
.dp-top__sub{margin:.1rem 0 0;font-size:var(--fs-sm);color:var(--ink-500)}
.dp-close{width:2.1rem;height:2.1rem;border-radius:var(--radius-md);border:0;background:transparent;color:var(--ink-600);
  font-size:1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.dp-close:hover{background:var(--bg-app);color:var(--ink-900)}

.dp-main{flex:1 1 auto;min-height:0;display:flex;gap:1.25rem;padding:1.1rem 1.3rem 1.3rem}

.dp-side{position:relative;flex:0 0 16rem;display:flex;flex-direction:column;align-items:stretch;background:var(--blue-50);
  border:1px solid var(--blue-100);border-radius:var(--radius-lg);padding:1.25rem 1.1rem;overflow-y:auto;text-align:center}
.dp-status{position:absolute;top:.8rem;right:.8rem;display:inline-flex;align-items:center;gap:.35rem;padding:.2rem .6rem;
  border-radius:var(--radius-md);font-weight:600;font-size:var(--fs-xs)}
.dp-status--on{background:var(--success-100);color:#15803d}
.dp-status--warn{background:#fef3c7;color:#92400e}
.dp-status--off{background:var(--danger-100);color:#c2272d}
.dp-dot{width:.45rem;height:.45rem;border-radius:50%;background:currentColor}
.dp-avatar-wrap{position:relative;align-self:center;margin:1.4rem 0 .8rem}
.dp-avatar{width:7rem;height:7rem;border-radius:50%;border:4px solid #fff;object-fit:cover;background:var(--blue-100);
  display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:var(--blue-600);box-shadow:var(--shadow-md)}
.dp-camera{position:absolute;right:.1rem;bottom:.2rem;width:1.9rem;height:1.9rem;border-radius:50%;border:2px solid #fff;
  background:var(--blue-600);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:.8rem;padding:0}
.dp-camera:hover{background:var(--blue-700)}
.dp-camera[disabled]{opacity:.6;cursor:wait}
.dp-link{background:none;border:0;padding:0;margin-top:.35rem;font-size:var(--fs-xs);color:var(--danger-600,#c2272d);cursor:pointer}
.dp-link:hover{text-decoration:underline}
.dp-side__name{margin:0;font-size:var(--fs-xl);font-weight:700;letter-spacing:-.02em;line-height:1.2}
.dp-side__code{margin-top:.15rem;color:var(--ink-600);font-size:var(--fs-base)}
.dp-side__list{margin:1rem 0 0;padding:.9rem 0 0;border-top:1px solid var(--blue-100);list-style:none;display:flex;
  flex-direction:column;gap:.7rem;text-align:left}
.dp-side__row{display:flex;gap:.65rem;align-items:flex-start;min-width:0}
.dp-side__row>i{font-size:1rem;color:var(--blue-600);width:1.2rem;text-align:center;margin-top:.1rem}
.dp-side__l{display:block;font-size:var(--fs-xs);color:var(--ink-500);line-height:1.2}
.dp-side__v{display:block;font-size:var(--fs-base);font-weight:500;overflow-wrap:anywhere;line-height:1.3}
.dp-side__actions{margin-top:1.1rem;display:flex;flex-direction:column;gap:.5rem}
.dp-btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border-radius:var(--radius-md);padding:.55rem 1rem;
  font-size:var(--fs-sm);font-weight:600;cursor:pointer;border:1px solid var(--blue-600);background:var(--blue-600);color:#fff;box-shadow:var(--shadow-xs)}
.dp-btn:hover{background:var(--blue-700);border-color:var(--blue-700)}

.dp-content{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column}
.dp-tabs{flex:0 0 auto;display:flex;gap:.2rem;border-bottom:1px solid var(--border-color);overflow-x:auto;scrollbar-width:none;background:var(--surface)}
.dp-tabs::-webkit-scrollbar{display:none}
.dp-tab{display:inline-flex;align-items:center;gap:.45rem;white-space:nowrap;background:none;border:0;padding:.6rem .85rem;
  font-size:var(--fs-sm);font-weight:600;color:var(--ink-500);border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer}
.dp-tab i{font-size:.95rem}
.dp-tab:hover{color:var(--blue-600)}
.dp-tab.is-active{color:var(--blue-600);border-bottom-color:var(--blue-600)}
.dp-count{background:var(--blue-100);color:var(--blue-700);border-radius:999px;padding:0 .45rem;font-size:var(--fs-xs)}
.dp-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:1.1rem .25rem .25rem 0}

.dp-dl{display:grid;grid-template-columns:11rem minmax(0,1fr);gap:.7rem 1rem;margin:0;font-size:var(--fs-base)}
.dp-dl dt{color:var(--ink-500);font-weight:400}
.dp-dl dd{margin:0;color:var(--ink-900);font-weight:500;overflow-wrap:anywhere}
.dp-chip{display:inline-flex;align-items:center;padding:.2rem .6rem;border-radius:var(--radius-md);background:var(--blue-100);
  color:var(--blue-700);font-size:var(--fs-xs);font-weight:600}
.dp-section{margin:1.2rem 0 .7rem;padding-top:1.1rem;border-top:1px solid var(--border-color);font-size:var(--fs-md);font-weight:700;color:var(--ink-900)}
.dp-section:first-child{margin-top:0;padding-top:0;border-top:0}

.dp-now{display:flex;gap:.9rem;align-items:center;padding:.9rem 1rem;border-radius:var(--radius-lg);border:1px solid var(--border-color);background:var(--bg-app)}
.dp-now--busy{background:#eff6ff;border-color:#bfdbfe}
.dp-now>i{font-size:1.6rem;color:var(--blue-600)}
.dp-now__t{font-weight:700}
.dp-now__s{font-size:var(--fs-sm);color:var(--ink-600)}

.dp-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6rem}
.dp-stat{border:1px solid var(--border-color);border-radius:var(--radius-md);padding:.6rem .75rem}
.dp-stat__l{font-size:var(--fs-xs);color:var(--ink-500)}
.dp-stat__v{font-size:var(--fs-lg);font-weight:700;line-height:1.3}

.dp-body .table{font-size:var(--fs-xs)}
.dp-body .table thead th{padding:.5rem .7rem;font-size:var(--fs-xs)}
.dp-body .table tbody td{padding:.45rem .7rem}
.dp-empty{color:var(--ink-500);font-size:var(--fs-sm)}

@media (max-width:860px){
  .dp-side{flex-basis:14rem}
  .dp-dl{grid-template-columns:8.5rem minmax(0,1fr)}
  .dp-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:700px){
  .dp-overlay{padding:0}
  .dp-card{height:100dvh;max-width:none;border-radius:0;border:0}
  .dp-top{padding:.9rem 1rem}
  .dp-main{display:block;overflow-y:auto;padding:.9rem 1rem 1rem}
  .dp-side{padding:1rem}
  .dp-content{display:block;margin-top:1rem}
  .dp-tabs{position:sticky;top:-.9rem;z-index:2}
  .dp-body{overflow:visible;padding:1rem 0 0}
  .dp-dl{grid-template-columns:1fr;gap:.1rem 0}
  .dp-dl dd{margin-bottom:.6rem}
}
`;

const PROFILE_TABS = [
  ['overview', 'Overview', 'bi-person'],
  ['trips', 'Trips', 'bi-truck'],
  ['vehicles', 'Vehicles', 'bi-card-list'],
  ['advances', 'Trip advances', 'bi-cash-coin'],
];

// dt/dd pair
function Dl({ label, children, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? value ?? '—'}</dd>
    </>
  );
}

function DriverProfileModal({ driverId, canEdit, onClose, onChanged, onEdit }) {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef(null);

  // ---- drag to move (grab the title bar) ----
  const cardRef = useRef(null);
  const dragRef = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const onDragStart = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button, input, a')) return;
    if (window.innerWidth <= 700 || !cardRef.current) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, rect: cardRef.current.getBoundingClientRect() };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = Math.min(Math.max(e.clientX - d.sx, -d.rect.left), window.innerWidth - d.rect.right);
    const dy = Math.min(Math.max(e.clientY - d.sy, -d.rect.top), window.innerHeight - 48 - d.rect.top);
    setPos({ x: d.ox + dx, y: d.oy + dy });
  };
  const onDragEnd = () => { dragRef.current = null; };

  const fetchProfile = useCallback(async () => {
    setLoading(true); setErr('');
    try { setData(await api.drivers.profile(driverId)); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setLoading(false); }
  }, [driverId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      await api.drivers.uploadPhoto(driverId, file);
      setFlash({ type: 'success', text: 'Photo updated.' });
      await fetchProfile();
      onChanged?.();
    } catch (ex) { setFlash({ type: 'danger', text: errorMessage(ex) }); }
    finally { setPhotoBusy(false); }
  };

  const removePhoto = async () => {
    if (!window.confirm('Remove this profile photo?')) return;
    setPhotoBusy(true);
    try {
      await api.drivers.removePhoto(driverId);
      setFlash({ type: 'success', text: 'Photo removed.' });
      await fetchProfile();
      onChanged?.();
    } catch (ex) { setFlash({ type: 'danger', text: errorMessage(ex) }); }
    finally { setPhotoBusy(false); }
  };

  const d = data?.driver;
  const cur = data?.current;
  const stats = data?.stats;
  const lic = data?.licence;

  const sideState = !d ? null
    : d.employment_status !== 'ACTIVE' ? { cls: 'dp-status--off', text: pretty(d.employment_status) }
    : cur?.on_trip ? { cls: 'dp-status--warn', text: 'On trip' }
    : { cls: 'dp-status--on', text: 'Available' };

  const licenceText = !lic ? '—'
    : lic.state === 'EXPIRED' ? <span className="text-danger fw-600">{fmtDate(lic.expiry)} · expired {Math.abs(lic.days_left)}d ago</span>
    : lic.state === 'EXPIRING' ? <span className="text-warning fw-600">{fmtDate(lic.expiry)} · {lic.days_left}d left</span>
    : lic.state === 'VALID' ? `${fmtDate(lic.expiry)} · ${lic.days_left}d left`
    : 'No expiry recorded';

  /* ---------------- OVERVIEW ---------------- */
  const renderOverview = () => (
    <>
      <h3 className="dp-section">Current status</h3>
      {cur?.on_trip ? (
        <div className="dp-now dp-now--busy">
          <i className="bi bi-truck"></i>
          <div>
            <div className="dp-now__t">On trip — {cur.shipment.reference}</div>
            <div className="dp-now__s">
              {pretty(cur.shipment.status)}
              {cur.shipment.origin || cur.shipment.destination ? ` · ${cur.shipment.origin || '?'} → ${cur.shipment.destination || '?'}` : ''}
              {cur.shipment.customer ? ` · ${cur.shipment.customer}` : ''}
            </div>
            <div className="dp-now__s">
              Vehicle: <strong>{cur.vehicle?.registration_number || 'not assigned'}</strong>
              {cur.since ? ` · since ${fmtDateTime(cur.since)}` : ''}
            </div>
          </div>
        </div>
      ) : (
        <div className="dp-now">
          <i className="bi bi-check-circle"></i>
          <div>
            <div className="dp-now__t">{d.employment_status === 'ACTIVE' ? 'Available — not on a trip' : `Not available (${pretty(d.employment_status)})`}</div>
            <div className="dp-now__s">
              {stats.upcoming > 0 ? `${stats.upcoming} upcoming trip${stats.upcoming !== 1 ? 's' : ''} planned.` : 'No upcoming trips planned.'}
            </div>
          </div>
        </div>
      )}

      <h3 className="dp-section">Performance</h3>
      <div className="dp-stats">
        <div className="dp-stat"><div className="dp-stat__l">Total trips</div><div className="dp-stat__v">{num(stats.total_trips)}</div></div>
        <div className="dp-stat"><div className="dp-stat__l">Completed</div><div className="dp-stat__v text-success">{num(stats.completed)}</div></div>
        <div className="dp-stat"><div className="dp-stat__l">Active now</div><div className="dp-stat__v">{num(stats.active)}</div></div>
        <div className="dp-stat"><div className="dp-stat__l">Upcoming</div><div className="dp-stat__v">{num(stats.upcoming)}</div></div>
        <div className="dp-stat"><div className="dp-stat__l">Distance (km)</div><div className="dp-stat__v">{num(stats.distance_km)}</div></div>
        <div className="dp-stat"><div className="dp-stat__l">Litres moved</div><div className="dp-stat__v">{num(stats.litres_moved)}</div></div>
        <div className="dp-stat"><div className="dp-stat__l">Fuel used (L)</div><div className="dp-stat__v">{num(stats.fuel_used_litres)}</div></div>
      </div>

      <h3 className="dp-section">Personal information</h3>
      <dl className="dp-dl">
        <Dl label="Full name" value={d.full_name} />
        <Dl label="Driver code" value={d.code} />
        <Dl label="ID number" value={d.id_number || '—'} />
        <Dl label="Phone" value={d.phone || '—'} />
        <Dl label="Employment status">
          <span className={`status-pill ${statusPill(d.employment_status)}`}>{d.employment_status}</span>
        </Dl>
      </dl>

      <h3 className="dp-section">Licence</h3>
      <dl className="dp-dl">
        <Dl label="Licence number" value={d.licence_number || '—'} />
        <Dl label="Category" value={d.licence_category || '—'} />
        <Dl label="Expiry">{licenceText}</Dl>
      </dl>
    </>
  );

  /* ---------------- TRIPS ---------------- */
  const renderTrips = () => (
    data.trips.length === 0 ? <p className="dp-empty">This driver has not been assigned to any shipment yet.</p> : (
      <div className="table-responsive">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Shipment</th><th>Status</th><th>Route</th><th>Customer / Product</th><th>Vehicle</th>
              <th>Loaded</th><th>Delivered</th><th className="text-end">Litres</th><th className="text-end">Km</th>
            </tr>
          </thead>
          <tbody>
            {data.trips.map((t) => (
              <tr key={t.id}>
                <td className="cell-mono text-brand fw-600">{t.reference}</td>
                <td><span className={`status-pill ${tripPill(t.status)}`}>{pretty(t.status)}</span></td>
                <td>{t.origin || '—'} → {t.destination || '—'}</td>
                <td>{t.customer || '—'}<div className="text-muted-soft">{t.product}</div></td>
                <td className="cell-mono">{t.vehicle || '—'}</td>
                <td>{fmtDate(t.loading_date)}</td>
                <td>{fmtDate(t.delivered_at)}</td>
                <td className="text-end">{num(t.litres)}</td>
                <td className="text-end">{num(t.distance_km)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  /* ---------------- VEHICLES ---------------- */
  const renderVehicles = () => (
    <>
      <h3 className="dp-section">Allocated vehicle</h3>
      {cur?.vehicle ? (
        <dl className="dp-dl">
          <Dl label="Registration"><span className="cell-mono fw-600">{cur.vehicle.registration_number}</span></Dl>
          <Dl label="Make / model" value={`${cur.vehicle.make || ''} ${cur.vehicle.model || ''}`.trim() || '—'} />
          <Dl label="On shipment" value={cur.shipment?.reference || '—'} />
        </dl>
      ) : <p className="dp-empty">No vehicle is allocated right now.</p>}

      <h3 className="dp-section">Assignment history</h3>
      {data.assignments.length === 0 ? <p className="dp-empty">No vehicle assignments recorded.</p> : (
        <div className="table-responsive">
          <table className="table table-sm">
            <thead><tr><th>Vehicle</th><th>Trailer</th><th>Shipment</th><th>From</th><th>To</th><th>Status</th></tr></thead>
            <tbody>
              {data.assignments.map((a) => (
                <tr key={a.id}>
                  <td className="cell-mono fw-600">{a.vehicle}</td>
                  <td className="cell-mono">{a.trailer || '—'}</td>
                  <td className="cell-mono">{a.shipment || '—'}</td>
                  <td>{fmtDateTime(a.start_at)}</td>
                  <td>{a.end_at ? fmtDateTime(a.end_at) : '—'}</td>
                  <td>
                    <span className={`status-pill ${a.status === 'ACTIVE' ? 'status-pill--info' : a.status === 'COMPLETED' ? 'status-pill--success' : 'status-pill--neutral'}`}>
                      {pretty(a.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  /* ---------------- TRIP ADVANCES ---------------- */
  const renderAdvances = () => (
    data.advances.length === 0 ? <p className="dp-empty">No trip advances issued to this driver.</p> : (
      <div className="table-responsive">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Advance</th><th>Shipment</th><th>Status</th>
              <th className="text-end">Requested</th><th className="text-end">Paid</th>
              <th className="text-end">Actual spend</th><th className="text-end">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.advances.map((a) => (
              <tr key={a.id}>
                <td className="cell-mono text-brand fw-600">{a.reference}</td>
                <td className="cell-mono">{a.shipment}</td>
                <td><span className="badge badge-neutral">{pretty(a.status)}</span></td>
                <td className="text-end">{num(a.requested, 2)}</td>
                <td className="text-end">{num(a.paid, 2)}</td>
                <td className="text-end">{num(a.actual, 2)}</td>
                <td className={`text-end fw-600 ${Number(a.balance_to_return) > 0 ? 'text-danger' : ''}`}>{num(a.balance_to_return, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  const renderers = { overview: renderOverview, trips: renderTrips, vehicles: renderVehicles, advances: renderAdvances };
  const tabCount = { trips: data?.trips.length, vehicles: data?.assignments.length, advances: data?.advances.length };

  return (
    <div className="dp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{PROFILE_CSS}</style>
      <div
        ref={cardRef}
        className="dp-card"
        role="dialog"
        aria-modal="true"
        aria-label="Driver details"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        {/* Title bar - drag here to move */}
        <div
          className="dp-top dp-drag"
          title="Drag to move"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <i className="bi bi-person-badge dp-top__icon" aria-hidden="true"></i>
          <div className="dp-top__text">
            <h2 className="dp-top__title">Driver Details</h2>
            <p className="dp-top__sub">Licence, trips, vehicles and advances for this driver</p>
          </div>
          <button className="dp-close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg"></i></button>
        </div>

        <div className="dp-main">
          {/* Left: profile card */}
          <aside className="dp-side">
            {sideState && (
              <span className={`dp-status ${sideState.cls}`}>
                <span className="dp-dot"></span>{sideState.text}
              </span>
            )}

            <div className="dp-avatar-wrap">
              {d?.photo
                ? <img className="dp-avatar" src={d.photo} alt="" />
                : <div className="dp-avatar">{initialsOf(d?.full_name) || <i className="bi bi-person"></i>}</div>}
              {canEdit && d && (
                <>
                  <button className="dp-camera" title="Change photo" aria-label="Change photo" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                    {photoBusy ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-camera-fill"></i>}
                  </button>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={uploadPhoto} />
                </>
              )}
            </div>
            {canEdit && d?.photo && (
              <button type="button" className="dp-link" onClick={removePhoto} disabled={photoBusy}>Remove photo</button>
            )}

            <h3 className="dp-side__name">{d?.full_name || 'Loading...'}</h3>
            <div className="dp-side__code">{d?.code || ''}</div>

            {d && (
              <ul className="dp-side__list">
                <li className="dp-side__row">
                  <i className="bi bi-card-heading"></i>
                  <span><span className="dp-side__l">Licence</span><span className="dp-side__v">{d.licence_number || '—'}{d.licence_category ? ` (${d.licence_category})` : ''}</span></span>
                </li>
                <li className="dp-side__row">
                  <i className="bi bi-calendar-check"></i>
                  <span><span className="dp-side__l">Licence expiry</span><span className="dp-side__v">{licenceText}</span></span>
                </li>
                {d.phone && (
                  <li className="dp-side__row">
                    <i className="bi bi-telephone"></i>
                    <span><span className="dp-side__l">Phone</span><span className="dp-side__v">{d.phone}</span></span>
                  </li>
                )}
                {d.id_number && (
                  <li className="dp-side__row">
                    <i className="bi bi-person-vcard"></i>
                    <span><span className="dp-side__l">ID number</span><span className="dp-side__v">{d.id_number}</span></span>
                  </li>
                )}
                <li className="dp-side__row">
                  <i className="bi bi-truck"></i>
                  <span><span className="dp-side__l">Vehicle</span><span className="dp-side__v">{cur?.vehicle?.registration_number || 'None allocated'}</span></span>
                </li>
              </ul>
            )}

            {canEdit && d && (
              <div className="dp-side__actions">
                <button className="dp-btn" onClick={() => onEdit(d)}>
                  <i className="bi bi-pencil-square"></i>Edit Driver
                </button>
              </div>
            )}
          </aside>

          {/* Right: tabs + content */}
          <section className="dp-content">
            <div className="dp-tabs" role="tablist">
              {PROFILE_TABS.map(([key, text, icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`dp-tab ${tab === key ? 'is-active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  <i className={`bi ${icon}`}></i>{text}
                  {tabCount[key] > 0 && <span className="dp-count">{tabCount[key]}</span>}
                </button>
              ))}
            </div>

            <div className="dp-body">
              {flash && (
                <div className={`alert alert-${flash.type} alert-dismissible py-2`}>
                  {flash.text}
                  <button type="button" className="btn-close" onClick={() => setFlash(null)}></button>
                </div>
              )}
              {err && (
                <div className="alert alert-danger py-2">
                  {err} <button type="button" className="btn btn-sm btn-outline-danger ms-2" onClick={fetchProfile}>Try again</button>
                </div>
              )}
              {loading && !data ? (
                <div className="text-center py-4"><span className="spinner-border spinner-border-sm me-2"></span>Loading...</div>
              ) : data ? renderers[tab]() : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}