/**
 * Employees.
 * - CRUD /employees/
 * - GET  /employees/:id/profile/          (employee, linked user, payslip stats, payslips, leave)
 * - GET  /employees/:id/available-users/  (users that can be linked)
 * - POST /employees/:id/link-user/        ({ user: id | null })
 * Fields: code, full_name, national_id, job_title, department, hire_date, basic_salary, currency,
 *         allowances [{name, amount}], bank_name, bank_account, tax_number, is_driver, status
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import { EMPLOYEES_EDIT, EMPLOYEES_LINK, EMPLOYEES_PAYSLIPS } from '../../navigation';
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

const pretty = (s) => (s ? String(s).replace(/_/g, ' ') : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const num = (n, dp = 0) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const money = (n) => num(n, 2);
const initialsOf = (name) => (name || '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const periodLabel = (s) => (s?.period_end ? new Date(s.period_end).toLocaleDateString('en-KE', { month: 'short', year: 'numeric' }) : '—');

function Avatar({ name, size = '2rem' }) {
  const style = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--blue-100, #dbeafe)', color: 'var(--blue-600, #2563eb)',
    fontWeight: 700, fontSize: `calc(${size} * 0.38)`,
  };
  return <span style={style}>{initialsOf(name) || <i className="bi bi-person"></i>}</span>;
}

/** Opens a printable payslip in a new window. */
function printPayslip(emp, slip, currency, companyName) {
  const rows = (obj) => Object.entries(obj || {})
    .map(([k, v]) => `<tr><td>${esc(pretty(k))}</td><td class="r">${esc(money(v))}</td></tr>`).join('');
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Payslip ${esc(emp.full_name)} ${esc(periodLabel(slip))}</title>
<style>
body{font-family:Arial,sans-serif;color:#111;padding:32px;max-width:720px;margin:auto}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:13px}td{padding:5px 0}.r{text-align:right}
.meta td{padding:2px 0}.tot td{font-weight:700;border-top:1px solid #999;padding-top:8px}
.net{font-size:16px;background:#f3f4f6;padding:10px;margin-top:18px;display:flex;justify-content:space-between;font-weight:700}
</style></head><body>
<h1>${esc(companyName || 'Payslip')}</h1>
<div>Payslip for ${esc(periodLabel(slip))} (${esc(fmtDate(slip.period_start))} – ${esc(fmtDate(slip.period_end))})</div>
<h2>Employee</h2>
<table class="meta">
<tr><td>Name</td><td class="r">${esc(emp.full_name)}</td></tr>
<tr><td>Code</td><td class="r">${esc(emp.code)}</td></tr>
<tr><td>Job title</td><td class="r">${esc(emp.job_title || '—')}</td></tr>
<tr><td>National ID</td><td class="r">${esc(emp.national_id || '—')}</td></tr>
<tr><td>Tax number</td><td class="r">${esc(emp.tax_number || '—')}</td></tr>
</table>
<h2>Earnings (${esc(currency)})</h2>
<table>
<tr><td>Basic salary</td><td class="r">${esc(money(slip.basic))}</td></tr>
<tr><td>Allowances</td><td class="r">${esc(money(slip.allowances))}</td></tr>
<tr><td>Overtime</td><td class="r">${esc(money(slip.overtime))}</td></tr>
<tr class="tot"><td>Gross pay</td><td class="r">${esc(money(slip.gross))}</td></tr>
</table>
<h2>Deductions</h2>
<table>${rows(slip.deductions) || '<tr><td>None</td><td></td></tr>'}
<tr class="tot"><td>Total deductions</td><td class="r">${esc(money(slip.total_deductions))}</td></tr></table>
<div class="net"><span>Net pay</span><span>${esc(currency)} ${esc(money(slip.net_pay))}</span></div>
<script>window.onload=function(){window.print()}</script>
</body></html>`);
  w.document.close();
}

export default function Employees() {
  const { can } = useAccess();
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
      const res = await api.employees.list({
        ...companyParams(),
        ordering: 'full_name',
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, status]);

  useEffect(() => { load(); }, [load]);

  const remove = async (e) => {
    if (!window.confirm(`Delete employee ${e.full_name}?`)) return;
    try { await api.employees.remove(e.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);
  const canEdit = can(EMPLOYEES_EDIT);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <div className="page-header__text">
            <h1 className="page-title">Employees</h1>
            <p className="page-subtitle">
              Staff records, user accounts and payslips{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New employee
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
              placeholder="Search by name, code, ID or job title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search employees"
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
            Employee List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} employee{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>{hasActiveFilters ? 'No employees match your search' : 'No employees yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New employee' to add the first one"}
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
                    <th>Job title</th>
                    <th>Department</th>
                    <th>Hired</th>
                    <th className="text-end">Basic salary</th>
                    <th>User account</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((e) => (
                    <tr key={e.id}>
                      <td className="cell-name">
                        <button
                          type="button"
                          onClick={() => setViewing(e.id)}
                          style={{ background: 'none', border: 0, padding: 0, display: 'inline-flex', alignItems: 'center', gap: '.6rem', textAlign: 'left', color: 'inherit', cursor: 'pointer' }}
                        >
                          <Avatar name={e.full_name} />
                          <span>{e.full_name}</span>
                        </button>
                      </td>
                      <td className="cell-mono">{e.code || '—'}</td>
                      <td>{e.job_title || '—'}</td>
                      <td>{e.department_label || '—'}</td>
                      <td>{fmtDate(e.hire_date)}</td>
                      <td className="text-end">{e.currency} {money(e.basic_salary)}</td>
                      <td>
                        {e.user
                          ? <span className="status-pill status-pill--info">{e.user_label}</span>
                          : <span className="text-muted-soft">Not linked</span>}
                      </td>
                      <td><span className={`status-pill ${statusPill(e.status)}`}>{e.status}</span></td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-icon" title="View details" aria-label="View details" onClick={() => setViewing(e.id)}>
                            <i className="bi bi-eye"></i>
                          </button>
                          {canEdit && (
                            <>
                              <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(e)}>
                                <i className="bi bi-pencil"></i>
                              </button>
                              <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(e)}>
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
        <EmployeeModal
          row={editing}
          companyParams={companyParams}
          activeCompanyObj={activeCompanyObj}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}

      {viewing && (
        <EmployeeProfileModal
          employeeId={viewing}
          canEdit={canEdit}
          canLink={can(EMPLOYEES_LINK)}
          canPayslips={can(EMPLOYEES_PAYSLIPS)}
          onClose={() => setViewing(null)}
          onChanged={load}
          onEdit={(e) => { setViewing(null); setEditing(e); }}
        />
      )}
    </div>
  );
}

/* ====================================================================================
 * Add / edit employee
 * ==================================================================================== */
function EmployeeModal({ row, companyParams, activeCompanyObj, onClose, onSaved }) {
  const isNew = !row.id;
  const app = useApp();
  const auth = useAuth();

  const knownCompany = row.company || activeCompanyObj?.id || companyParams()?.company || '';
  const companyOptions = app.companies || auth.user?.companies || [];

  const [form, setForm] = useState({
    company: knownCompany ? String(knownCompany) : '',
    code: row.code || '',
    full_name: row.full_name || '',
    national_id: row.national_id || '',
    job_title: row.job_title || '',
    department: row.department ? String(row.department) : '',
    hire_date: row.hire_date || '',
    basic_salary: row.basic_salary ?? '',
    currency: row.currency || activeCompanyObj?.currency || '',
    bank_name: row.bank_name || '',
    bank_account: row.bank_account || '',
    tax_number: row.tax_number || '',
    is_driver: !!row.is_driver,
    status: row.status || 'ACTIVE',
  });
  const [allowances, setAllowances] = useState(
    (row.allowances || []).map((a) => ({ name: a.name || '', amount: a.amount ?? '' })),
  );
  const [departments, setDepartments] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api.currencies.listAll().then(setCurrencies).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.company) return;
    api.departments.listAll({ company: form.company }).then(setDepartments).catch(() => {});
  }, [form.company]);

  const setAllowance = (i, k, v) => setAllowances((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addAllowance = () => setAllowances((rows) => [...rows, { name: '', amount: '' }]);
  const removeAllowance = (i) => setAllowances((rows) => rows.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});
    if (!form.company) {
      setFieldErr({ company: 'Select a company.' });
      setError('Select a company for this employee.');
      return;
    }
    if (!form.currency) {
      setFieldErr({ currency: 'Select a currency.' });
      setError('Select the salary currency.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...form,
        company: Number(form.company),
        code: (form.code || '').trim(),
        department: form.department ? Number(form.department) : null,
        hire_date: form.hire_date || null,
        basic_salary: form.basic_salary === '' ? '0' : String(form.basic_salary),
        allowances: allowances
          .filter((a) => a.name.trim() && a.amount !== '')
          .map((a) => ({ name: a.name.trim(), amount: Number(a.amount) })),
      };
      if (isNew) await api.employees.create(body); else await api.employees.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New employee' : `Edit ${row.full_name}`}
      subtitle="Staff records"
      icon="bi-people"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="employeeForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="employeeForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-person" aria-hidden="true"></i>Personal Details</h6>
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
            <input className="form-control font-mono" value={form.code} onChange={set('code')} placeholder="Auto-generated if empty" />
          </Field>
          <Field label="Full name" required err={fieldErr.full_name} span>
            <input className="form-control" value={form.full_name} onChange={set('full_name')} required />
          </Field>
          <Field label="National ID" err={fieldErr.national_id}>
            <input className="form-control font-mono" value={form.national_id} onChange={set('national_id')} />
          </Field>
          <Field label="Tax number" err={fieldErr.tax_number}>
            <input className="form-control font-mono" value={form.tax_number} onChange={set('tax_number')} />
          </Field>
          <Field label="Status">
            <select className="form-select" value={form.status} onChange={set('status')}>
              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Is a driver">
            <select className="form-select" value={form.is_driver ? 'yes' : 'no'}
              onChange={(e) => setForm((f) => ({ ...f, is_driver: e.target.value === 'yes' }))}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-briefcase" aria-hidden="true"></i>Job</h6>
        <div className="form-grid">
          <Field label="Job title" err={fieldErr.job_title}>
            <input className="form-control" value={form.job_title} onChange={set('job_title')} />
          </Field>
          <Field label="Department" err={fieldErr.department}>
            <select className="form-select" value={form.department} onChange={set('department')}>
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Hire date" err={fieldErr.hire_date}>
            <input type="date" className="form-control" value={form.hire_date} onChange={set('hire_date')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-cash-stack" aria-hidden="true"></i>Pay</h6>
        <div className="form-grid">
          <Field label="Currency" required err={fieldErr.currency}>
            <select className="form-select" value={form.currency} onChange={set('currency')} required>
              <option value="">Select currency...</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </select>
          </Field>
          <Field label="Basic salary" err={fieldErr.basic_salary}>
            <input type="number" step="0.01" min="0" className="form-control" value={form.basic_salary} onChange={set('basic_salary')} />
          </Field>
          <Field label="Bank name" err={fieldErr.bank_name}>
            <input className="form-control" value={form.bank_name} onChange={set('bank_name')} />
          </Field>
          <Field label="Bank account" err={fieldErr.bank_account}>
            <input className="form-control font-mono" value={form.bank_account} onChange={set('bank_account')} />
          </Field>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem' }}>
          <h6 className="modal-section-title" style={{ margin: 0 }}>
            <i className="bi bi-plus-circle" aria-hidden="true"></i>Allowances
          </h6>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addAllowance}>
            <i className="bi bi-plus-lg"></i> Add allowance
          </button>
        </div>
        {allowances.length === 0 ? (
          <p className="form-text-hint" style={{ marginTop: '.5rem' }}>No allowances. Add housing, transport and similar monthly amounts here.</p>
        ) : (
          <div style={{ display: 'grid', gap: '.5rem', marginTop: '.6rem' }}>
            {allowances.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: '.5rem' }}>
                <input className="form-control" placeholder="Name (e.g. Housing)" value={a.name}
                  onChange={(e) => setAllowance(i, 'name', e.target.value)} />
                <input type="number" step="0.01" min="0" className="form-control" style={{ maxWidth: '10rem' }}
                  placeholder="Amount" value={a.amount} onChange={(e) => setAllowance(i, 'amount', e.target.value)} />
                <button type="button" className="btn btn-icon" aria-label="Remove allowance" onClick={() => removeAllowance(i)}>
                  <i className="bi bi-trash"></i>
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/* ====================================================================================
 * Employee profile (detail) modal
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
.dp-avatar{width:7rem;height:7rem;border-radius:50%;border:4px solid #fff;background:var(--blue-100);margin:1.4rem auto .8rem;
  display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:var(--blue-600);box-shadow:var(--shadow-md)}
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
.dp-btn--ghost{background:transparent;color:var(--blue-600)}
.dp-btn--ghost:hover{background:var(--blue-100);color:var(--blue-700)}
.dp-btn[disabled]{opacity:.6;cursor:wait}
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
  color:var(--blue-700);font-size:var(--fs-xs);font-weight:600;margin:0 .3rem .3rem 0}
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
.dp-bar{display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap}
.dp-link-row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
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

function Dl({ label, children, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? value ?? '—'}</dd>
    </>
  );
}

function EmployeeProfileModal({ employeeId, canEdit, canLink, canPayslips, onClose, onChanged, onEdit }) {
  const { activeCompanyObj } = useApp();
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(null);
  const [slip, setSlip] = useState(null);

  // user linking
  const [candidates, setCandidates] = useState([]);
  const [pickUser, setPickUser] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);

  // drag to move
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
    try { setData(await api.employees.profile(employeeId)); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setLoading(false); }
  }, [employeeId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const emp = data?.employee;
  const user = data?.user;
  const stats = data?.stats;
  const ccy = emp?.currency || '';

  // load linkable users when the employee has no account
  useEffect(() => {
    if (!canLink || !emp || user) { setCandidates([]); return; }
    api.employees.availableUsers(employeeId).then(setCandidates).catch(() => setCandidates([]));
  }, [canLink, emp, user, employeeId]);

  const linkUser = async (userId) => {
    setLinkBusy(true); setFlash(null);
    try {
      await api.employees.linkUser(employeeId, userId);
      setFlash({ type: 'success', text: userId ? 'User account linked.' : 'User account unlinked.' });
      setPickUser('');
      await fetchProfile();
      onChanged?.();
    } catch (ex) { setFlash({ type: 'danger', text: errorMessage(ex) }); }
    finally { setLinkBusy(false); }
  };

  const unlink = () => {
    if (window.confirm('Unlink this user account from the employee? The user account itself is not deleted.')) linkUser(null);
  };

  const sideState = !emp ? null
    : emp.status !== 'ACTIVE' ? { cls: 'dp-status--off', text: pretty(emp.status) }
    : { cls: 'dp-status--on', text: 'Active' };

  const tabs = [
    ['overview', 'Overview', 'bi-person'],
    ...(canPayslips ? [['payslips', 'Payslips', 'bi-receipt']] : []),
    ['leave', 'Leave', 'bi-calendar-event'],
  ];
  const tabCount = { payslips: data?.payslips?.length, leave: data?.leaves?.length };

  /* ---------------- OVERVIEW ---------------- */
  const renderOverview = () => (
    <>
      <h3 className="dp-section">User account</h3>
      {user ? (
        <div className="dp-now dp-now--busy">
          <i className="bi bi-person-check"></i>
          <div style={{ flex: 1 }}>
            <div className="dp-now__t">{user.username}</div>
            <div className="dp-now__s">
              {user.email || 'No email'}{user.role_name ? ` · ${user.role_name}` : ''}{user.is_active ? '' : ' · inactive'}
            </div>
          </div>
          {canLink && (
            <button type="button" className="dp-btn dp-btn--ghost" disabled={linkBusy} onClick={unlink}>
              <i className="bi bi-link-45deg"></i>Unlink
            </button>
          )}
        </div>
      ) : (
        <div className="dp-now">
          <i className="bi bi-person-x"></i>
          <div style={{ flex: 1 }}>
            <div className="dp-now__t">No user account linked</div>
            {canLink ? (
              <div className="dp-link-row" style={{ marginTop: '.5rem' }}>
                <select className="form-select" style={{ maxWidth: '20rem' }} value={pickUser}
                  onChange={(e) => setPickUser(e.target.value)} aria-label="User account">
                  <option value="">Select a user...</option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}{u.name && u.name !== u.username ? ` (${u.name})` : ''}{u.role_name ? ` — ${u.role_name}` : ''}
                    </option>
                  ))}
                </select>
                <button type="button" className="dp-btn" disabled={!pickUser || linkBusy} onClick={() => linkUser(Number(pickUser))}>
                  <i className="bi bi-link-45deg"></i>{linkBusy ? 'Linking...' : 'Link account'}
                </button>
              </div>
            ) : (
              <div className="dp-now__s">Ask an administrator to link a login to this employee.</div>
            )}
            {canLink && candidates.length === 0 && (
              <div className="dp-now__s" style={{ marginTop: '.4rem' }}>
                No free users for this company. Create one under Users, then link it here.
              </div>
            )}
          </div>
        </div>
      )}

      {canPayslips && stats && (
        <>
          <h3 className="dp-section">Pay summary</h3>
          <div className="dp-stats">
            <div className="dp-stat"><div className="dp-stat__l">Basic salary</div><div className="dp-stat__v">{money(emp.basic_salary)}</div></div>
            <div className="dp-stat"><div className="dp-stat__l">Last net pay</div><div className="dp-stat__v">{stats.last_net == null ? '—' : money(stats.last_net)}</div></div>
            <div className="dp-stat"><div className="dp-stat__l">Gross this year</div><div className="dp-stat__v">{money(stats.ytd_gross)}</div></div>
            <div className="dp-stat"><div className="dp-stat__l">Net this year</div><div className="dp-stat__v text-success">{money(stats.ytd_net)}</div></div>
          </div>
        </>
      )}

      <h3 className="dp-section">Personal information</h3>
      <dl className="dp-dl">
        <Dl label="Full name" value={emp.full_name} />
        <Dl label="Employee code" value={emp.code} />
        <Dl label="National ID" value={emp.national_id || '—'} />
        <Dl label="Tax number" value={emp.tax_number || '—'} />
        <Dl label="Status"><span className={`status-pill ${statusPill(emp.status)}`}>{emp.status}</span></Dl>
        <Dl label="Driver" value={emp.is_driver ? 'Yes' : 'No'} />
      </dl>

      <h3 className="dp-section">Job</h3>
      <dl className="dp-dl">
        <Dl label="Job title" value={emp.job_title || '—'} />
        <Dl label="Department" value={emp.department_label || '—'} />
        <Dl label="Hire date" value={fmtDate(emp.hire_date)} />
      </dl>

      {canPayslips && (
        <>
          <h3 className="dp-section">Pay and bank</h3>
          <dl className="dp-dl">
            <Dl label="Basic salary" value={`${ccy} ${money(emp.basic_salary)}`} />
            <Dl label="Allowances">
              {(emp.allowances || []).length === 0 ? '—' : (emp.allowances || []).map((a, i) => (
                <span key={i} className="dp-chip">{a.name}: {money(a.amount)}</span>
              ))}
            </Dl>
            <Dl label="Bank" value={emp.bank_name || '—'} />
            <Dl label="Account number" value={emp.bank_account || '—'} />
          </dl>
        </>
      )}
    </>
  );

  /* ---------------- PAYSLIPS ---------------- */
  const renderPayslips = () => {
    const list = data.payslips || [];
    if (slip) {
      return (
        <>
          <div className="dp-bar">
            <button type="button" className="dp-btn dp-btn--ghost" onClick={() => setSlip(null)}>
              <i className="bi bi-arrow-left"></i>All payslips
            </button>
            <button type="button" className="dp-btn" onClick={() => printPayslip(emp, slip, ccy, activeCompanyObj?.name)}>
              <i className="bi bi-printer"></i>Print payslip
            </button>
          </div>
          <h3 className="dp-section">Payslip — {periodLabel(slip)}</h3>
          <dl className="dp-dl">
            <Dl label="Payroll run" value={slip.run_reference} />
            <Dl label="Period" value={`${fmtDate(slip.period_start)} – ${fmtDate(slip.period_end)}`} />
          </dl>
          <h3 className="dp-section">Earnings ({ccy})</h3>
          <dl className="dp-dl">
            <Dl label="Basic salary" value={money(slip.basic)} />
            <Dl label="Allowances" value={money(slip.allowances)} />
            <Dl label="Overtime" value={money(slip.overtime)} />
            <Dl label="Gross pay"><strong>{money(slip.gross)}</strong></Dl>
          </dl>
          <h3 className="dp-section">Deductions</h3>
          <dl className="dp-dl">
            {Object.entries(slip.deductions || {}).map(([k, v]) => <Dl key={k} label={pretty(k)} value={money(v)} />)}
            <Dl label="Total deductions"><strong>{money(slip.total_deductions)}</strong></Dl>
          </dl>
          <h3 className="dp-section">Net pay</h3>
          <div className="dp-now dp-now--busy">
            <i className="bi bi-cash-coin"></i>
            <div className="dp-now__t" style={{ fontSize: 'var(--fs-lg)' }}>{ccy} {money(slip.net_pay)}</div>
          </div>
        </>
      );
    }
    return list.length === 0 ? (
      <p className="dp-empty">No payslips yet. They appear here once a payroll run that includes this employee is posted.</p>
    ) : (
      <div className="table-responsive">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Period</th><th>Run</th>
              <th className="text-end">Gross</th><th className="text-end">Deductions</th><th className="text-end">Net pay</th>
              <th style={{ width: '6rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td className="fw-600">{periodLabel(s)}</td>
                <td className="cell-mono">{s.run_reference}</td>
                <td className="text-end">{money(s.gross)}</td>
                <td className="text-end">{money(s.total_deductions)}</td>
                <td className="text-end fw-600">{money(s.net_pay)}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-icon" title="View payslip" aria-label="View payslip" onClick={() => setSlip(s)}>
                      <i className="bi bi-eye"></i>
                    </button>
                    <button className="btn btn-icon" title="Print payslip" aria-label="Print payslip"
                      onClick={() => printPayslip(emp, s, ccy, activeCompanyObj?.name)}>
                      <i className="bi bi-printer"></i>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  /* ---------------- LEAVE ---------------- */
  const renderLeave = () => (
    (data.leaves || []).length === 0 ? <p className="dp-empty">No leave requests for this employee.</p> : (
      <div className="table-responsive">
        <table className="table table-sm">
          <thead><tr><th>Reference</th><th>Type</th><th>From</th><th>To</th><th className="text-end">Days</th><th>Status</th></tr></thead>
          <tbody>
            {data.leaves.map((l) => (
              <tr key={l.id}>
                <td className="cell-mono">{l.reference}</td>
                <td>{pretty(l.leave_type)}</td>
                <td>{fmtDate(l.start_date)}</td>
                <td>{fmtDate(l.end_date)}</td>
                <td className="text-end">{num(l.days, 1)}</td>
                <td>
                  <span className={`status-pill ${l.status === 'APPROVED' ? 'status-pill--success' : l.status === 'REJECTED' ? 'status-pill--neutral' : 'status-pill--warning'}`}>
                    {pretty(l.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  const renderers = { overview: renderOverview, payslips: renderPayslips, leave: renderLeave };

  return (
    <div className="dp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{PROFILE_CSS}</style>
      <div
        ref={cardRef}
        className="dp-card"
        role="dialog"
        aria-modal="true"
        aria-label="Employee details"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        <div
          className="dp-top dp-drag"
          title="Drag to move"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <i className="bi bi-people dp-top__icon" aria-hidden="true"></i>
          <div className="dp-top__text">
            <h2 className="dp-top__title">Employee Details</h2>
            <p className="dp-top__sub">Profile, user account, payslips and leave</p>
          </div>
          <button className="dp-close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg"></i></button>
        </div>

        <div className="dp-main">
          <aside className="dp-side">
            {sideState && (
              <span className={`dp-status ${sideState.cls}`}>
                <span className="dp-dot"></span>{sideState.text}
              </span>
            )}
            <div className="dp-avatar">{initialsOf(emp?.full_name) || <i className="bi bi-person"></i>}</div>
            <h3 className="dp-side__name">{emp?.full_name || 'Loading...'}</h3>
            <div className="dp-side__code">{emp?.code || ''}</div>

            {emp && (
              <ul className="dp-side__list">
                <li className="dp-side__row">
                  <i className="bi bi-briefcase"></i>
                  <span><span className="dp-side__l">Job title</span><span className="dp-side__v">{emp.job_title || '—'}</span></span>
                </li>
                <li className="dp-side__row">
                  <i className="bi bi-diagram-3"></i>
                  <span><span className="dp-side__l">Department</span><span className="dp-side__v">{emp.department_label || '—'}</span></span>
                </li>
                <li className="dp-side__row">
                  <i className="bi bi-calendar-check"></i>
                  <span><span className="dp-side__l">Hired</span><span className="dp-side__v">{fmtDate(emp.hire_date)}</span></span>
                </li>
                {emp.national_id && (
                  <li className="dp-side__row">
                    <i className="bi bi-person-vcard"></i>
                    <span><span className="dp-side__l">National ID</span><span className="dp-side__v">{emp.national_id}</span></span>
                  </li>
                )}
                <li className="dp-side__row">
                  <i className="bi bi-person-circle"></i>
                  <span><span className="dp-side__l">User account</span><span className="dp-side__v">{user?.username || 'Not linked'}</span></span>
                </li>
              </ul>
            )}

            {canEdit && emp && (
              <div className="dp-side__actions">
                <button className="dp-btn" onClick={() => onEdit(emp)}>
                  <i className="bi bi-pencil-square"></i>Edit Employee
                </button>
              </div>
            )}
          </aside>

          <section className="dp-content">
            <div className="dp-tabs" role="tablist">
              {tabs.map(([key, text, icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`dp-tab ${tab === key ? 'is-active' : ''}`}
                  onClick={() => { setTab(key); setSlip(null); }}
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