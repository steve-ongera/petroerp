/**
 * Payroll.
 * - CRUD /payroll-runs/                  (DRAFT -> POSTED via process)
 * - POST /payroll-runs/:id/preview/      live calculation for every eligible employee, nothing saved (add ?export=xlsx)
 * - POST /payroll-runs/:id/process/      { overtime: { employeeId: amount } } (same maths as the preview)
 * - GET  /payroll-runs/:id/payslips/     (add ?export=xlsx)
 *
 * Flow: create draft -> "Review & process" opens an Excel-style sheet with every eligible employee, each statutory
 * deduction (PAYE, SHA, Housing levy, NSSF ... whatever is set in Payroll configs) and the take-home pay.
 * Employees added after the draft was created are included automatically; active employees that cannot be paid
 * (no salary, hired later, other currency) are listed as skipped with the reason.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import { PAYROLL_PROCESS } from '../../navigation';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const SHEET_CSS = `
.xl-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:.6rem;margin-bottom:.9rem}
.xl-card{border:1px solid var(--border-color);border-radius:var(--radius-md);padding:.55rem .75rem}
.xl-card__l{font-size:var(--fs-xs);color:var(--ink-500)}
.xl-card__v{font-size:var(--fs-lg);font-weight:700;line-height:1.3;font-variant-numeric:tabular-nums}
.xl-card--net{background:var(--success-100);border-color:var(--success-100)}
.xl-card--net .xl-card__v{color:#15803d}
.xl-wrap{overflow:auto;max-height:46vh;border:1px solid var(--border-color);border-radius:var(--radius-md);background:var(--surface,#fff)}
.xl{border-collapse:separate;border-spacing:0;font-size:var(--fs-xs);width:max-content;min-width:100%}
.xl th,.xl td{border-right:1px solid var(--border-color);border-bottom:1px solid var(--border-color);padding:.35rem .6rem;white-space:nowrap;background:var(--surface,#fff)}
.xl thead th{position:sticky;top:0;z-index:3;background:var(--bg-app,#f3f4f6);font-weight:700;text-align:right}
.xl thead th.xl-l{text-align:left}
.xl td.xl-n{text-align:right;font-variant-numeric:tabular-nums}
.xl .xl-sub{display:block;font-weight:400;color:var(--ink-500);font-size:.68rem}
.xl .xl-rn{position:sticky;left:0;z-index:2;width:2.6rem;min-width:2.6rem;text-align:center;background:var(--bg-app,#f3f4f6);color:var(--ink-500)}
.xl .xl-nm{position:sticky;left:2.6rem;z-index:2;min-width:13rem;text-align:left;box-shadow:2px 0 0 var(--border-color)}
.xl thead .xl-rn,.xl thead .xl-nm{z-index:4}
.xl .xl-ded{color:#b42318}
.xl .xl-net{background:var(--success-100);font-weight:700;color:#15803d}
.xl tbody tr:hover td{background:var(--blue-50)}
.xl tbody tr.xl-bad td{background:#fef2f2}
.xl tfoot td{position:sticky;bottom:0;z-index:2;font-weight:700;background:var(--bg-app,#f3f4f6);border-top:2px solid var(--ink-500)}
.xl tfoot .xl-rn{z-index:4}.xl tfoot .xl-nm{z-index:4}
.xl-ot{width:6.5rem;text-align:right;padding:.15rem .4rem}
.xl-new{display:inline-block;margin-left:.4rem;padding:0 .4rem;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:.65rem;font-weight:700}
.xl-skip{border:1px solid #fcd34d;background:#fffbeb;color:#92400e;border-radius:var(--radius-md);padding:.6rem .8rem;margin-bottom:.9rem;font-size:var(--fs-sm)}
.xl-skip ul{margin:.35rem 0 0;padding-left:1.1rem}
.xl-foot{display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;width:100%}
.xl-foot__r{display:flex;gap:.5rem;flex-wrap:wrap}
`;

export default function Payroll() {
  const { can } = useAccess();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [payslips, setPayslips] = useState(null);
  const canProcess = can(PAYROLL_PROCESS);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.payrollRuns.list({ ...companyParams(), ordering: '-period_end', page_size: 500 });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const viewPayslips = async (r) => {
    try { setPayslips({ run: r, rows: await api.payrollRuns.payslips(r.id) }); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const removeDraft = async (r) => {
    if (!window.confirm(`Delete draft payroll run ${r.reference}?`)) return;
    try { await api.payrollRuns.remove(r.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const filtered = rows.filter((r) => !status || r.status === status);
  const { pageRows, paginationProps } = usePagination(filtered);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <div className="page-header__text">
            <h1 className="page-title">Payroll</h1>
            <p className="page-subtitle">
              {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {rows.length} run{rows.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {canProcess && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New payroll run
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
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="POSTED">Posted</option>
          </select>
          {status && (
            <button className="btn btn-secondary" onClick={() => setStatus('')}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Payroll Runs
          </span>
          <span className="chart-card__subtitle">{filtered.length} run{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <TableSkeleton rows={6} columns={8} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>{status ? 'No payroll runs match your filter' : 'No payroll runs yet'}</h6>
            <p className="text-muted-soft">{status ? 'Try a different status' : "Click 'New payroll run' to create the first one"}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Period</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Deductions</th>
                    <th className="text-right">Net</th>
                    <th className="text-right">Employer cost</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '12rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-mono text-brand fw-600">{r.reference}</td>
                      <td>{r.period_start} → {r.period_end}</td>
                      <td className="cell-num">{fmtMoney(r.total_gross)}</td>
                      <td className="cell-num">{fmtMoney(r.total_deductions)}</td>
                      <td className="cell-num">{fmtMoney(r.total_net)}</td>
                      <td className="cell-num">{fmtMoney(r.total_employer_cost)}</td>
                      <td>
                        <span className={`status-pill ${r.status === 'POSTED' ? 'status-pill--success' : 'status-pill--neutral'}`}>{r.status}</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {r.status === 'DRAFT' && (
                            <button className="btn btn-sm btn-primary" onClick={() => setReviewing(r)}>
                              <i className="bi bi-table"></i> Review &amp; process
                            </button>
                          )}
                          {r.status === 'DRAFT' && canProcess && (
                            <button className="btn btn-icon" title="Delete draft" aria-label="Delete draft" onClick={() => removeDraft(r)}>
                              <i className="bi bi-trash"></i>
                            </button>
                          )}
                          {r.status === 'POSTED' && (
                            <button className="btn btn-sm btn-secondary" onClick={() => viewPayslips(r)}>
                              <i className="bi bi-file-earmark-text"></i> Payslips
                            </button>
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

        {!loading && filtered.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && (
        <NewRunModal
          companyId={companyParams()?.company || activeCompanyObj?.id}
          onClose={() => setEditing(null)}
          onSaved={(run) => {
            setEditing(null); notify('Draft created. Review it before processing.', 'success'); load();
            if (run?.id) setReviewing(run);
          }}
        />
      )}
      {reviewing && (
        <PreviewModal
          run={reviewing}
          canProcess={canProcess}
          notify={notify}
          onClose={() => setReviewing(null)}
          onProcessed={() => { setReviewing(null); notify('Payroll posted.', 'success'); load(); }}
        />
      )}
      {payslips && <PayslipsModal run={payslips.run} rows={payslips.rows} onClose={() => setPayslips(null)} />}
    </div>
  );
}

/* ====================================================================================
 * New draft run
 * ==================================================================================== */
function NewRunModal({ companyId, onClose, onSaved }) {
  const [form, setForm] = useState({ period_start: todayISO(), period_end: todayISO() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});
    if (!companyId) { setError('Select a company in the top bar first.'); return; }
    setBusy(true);
    try { onSaved(await api.payrollRuns.create({ ...form, company: Number(companyId) })); }
    catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="New payroll run"
      subtitle="Choose the pay period. You review every employee before anything is posted"
      icon="bi-people-fill"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="payrollRunForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Creating...' : 'Create draft'}
          </button>
        </>
      }
    >
      <form id="payrollRunForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-calendar-range" aria-hidden="true"></i>Pay Period</h6>
        <div className="form-grid">
          <Field label="Period start" required err={fieldErr.period_start}>
            <input type="date" className="form-control" value={form.period_start} onChange={set('period_start')} required />
          </Field>
          <Field label="Period end" required err={fieldErr.period_end}>
            <input type="date" className="form-control" value={form.period_end} onChange={set('period_end')} required />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/* ====================================================================================
 * Review before processing: Excel-style sheet
 * ==================================================================================== */
function PreviewModal({ run, canProcess, notify, onClose, onProcessed }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [overtime, setOvertime] = useState({});     // { employeeId: '1500' }
  const [dirty, setDirty] = useState(false);
  const [showEmployer, setShowEmployer] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const otBody = useCallback(() => Object.fromEntries(
    Object.entries(overtime).filter(([, v]) => v !== '' && Number(v) > 0).map(([k, v]) => [k, String(v)]),
  ), [overtime]);

  const fetchPreview = useCallback(async (ot) => {
    setLoading(true); setErr('');
    try { setData(await api.payrollRuns.preview(run.id, ot || {})); setDirty(false); setConfirmed(false); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setLoading(false); }
  }, [run.id]);

  useEffect(() => { fetchPreview({}); }, [fetchPreview]);

  const setOt = (id, v) => { setOvertime((o) => ({ ...o, [id]: v })); setDirty(true); setConfirmed(false); };

  const download = async () => {
    try { await api.payrollRuns.exportPreview(run.id, otBody()); }
    catch (e) { notify(errorMessage(e), 'error'); }
  };

  const process = async () => {
    if (!window.confirm(`Post payroll ${run.reference} for ${data.totals.employees} employees? This creates the payroll journal.`)) return;
    setBusy(true);
    try { await api.payrollRuns.process(run.id, otBody()); onProcessed(); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const ded = data?.columns.deductions || [];
  const emp = data?.columns.employer || [];
  const t = data?.totals;
  const ccy = data?.run.currency || '';
  const hasBad = !!data?.rows.some((r) => r.warnings.length);
  const newCount = data?.rows.filter((r) => r.is_new).length || 0;
  const missingMaps = data?.missing_mappings || [];
  const canPost = canProcess && data && t.employees > 0 && !dirty && !hasBad && !missingMaps.length && confirmed && !busy;

  return (
    <Modal
      show
      onClose={onClose}
      title={`Review payroll · ${run.reference}`}
      subtitle={`${run.period_start} → ${run.period_end} · amounts in ${ccy || 'company currency'} · nothing is posted until you confirm`}
      icon="bi-table"
      size="xl"
      footer={
        <div className="xl-foot">
          <label style={{ display: 'inline-flex', gap: '.5rem', alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
            <input type="checkbox" checked={confirmed} disabled={!data || dirty || loading}
              onChange={(e) => setConfirmed(e.target.checked)} />
            I have reviewed all employees and amounts
          </label>
          <div className="xl-foot__r">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
            <button type="button" className="btn btn-secondary" onClick={download} disabled={!data || loading || !data.rows.length}>
              <i className="bi bi-file-earmark-excel"></i> Download Excel
            </button>
            {dirty && (
              <button type="button" className="btn btn-primary" onClick={() => fetchPreview(otBody())} disabled={loading}>
                <i className="bi bi-arrow-repeat"></i> Recalculate
              </button>
            )}
            {canProcess && (
              <button type="button" className="btn btn-primary" onClick={process} disabled={!canPost}>
                <i className="bi bi-play-fill"></i> {busy ? 'Posting...' : 'Process & post'}
              </button>
            )}
          </div>
        </div>
      }
    >
      <style>{SHEET_CSS}</style>

      {err && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{err}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => fetchPreview(otBody())}>Try again</button>
        </div>
      )}

      {loading && !data ? (
        <div className="text-center py-4"><span className="spinner-border spinner-border-sm me-2"></span>Calculating...</div>
      ) : data ? (
        <>
          {data.warnings.map((w, i) => <div key={i} className="alert alert-warning py-2">{w}</div>)}
          {missingMaps.length > 0 && (
            <div className="alert alert-danger py-2">
              Processing is blocked until {missingMaps.join(', ')} {missingMaps.length > 1 ? 'are' : 'is'} mapped.{' '}
              <Link to="/admin/account-mappings">Open Account mappings</Link>, select the company, add the key, then reopen this review.
            </div>
          )}

          <div className="xl-summary">
            <div className="xl-card"><div className="xl-card__l">Employees paid</div><div className="xl-card__v">{t.employees}</div></div>
            <div className="xl-card"><div className="xl-card__l">Gross pay</div><div className="xl-card__v">{fmtMoney(t.gross)}</div></div>
            <div className="xl-card"><div className="xl-card__l">Total deductions</div><div className="xl-card__v">{fmtMoney(t.total_deductions)}</div></div>
            <div className="xl-card xl-card--net"><div className="xl-card__l">Net pay (take-home)</div><div className="xl-card__v">{fmtMoney(t.net_pay)}</div></div>
            <div className="xl-card"><div className="xl-card__l">Employer contributions</div><div className="xl-card__v">{fmtMoney(t.total_employer)}</div></div>
          </div>

          {newCount > 0 && (
            <div className="alert alert-info py-2">
              {newCount} employee{newCount !== 1 ? 's were' : ' was'} added after this draft was created and {newCount !== 1 ? 'are' : 'is'} included automatically (marked <span className="xl-new">New</span>).
            </div>
          )}

          {data.skipped.length > 0 && (
            <div className="xl-skip" role="alert">
              <strong>{data.skipped.length} active employee{data.skipped.length !== 1 ? 's are' : ' is'} NOT in this payroll.</strong>{' '}
              Fix the record in <Link to="/finance/employees">Employees</Link>, then reopen this review.
              <ul>
                {data.skipped.map((s) => <li key={s.employee_id}><strong>{s.name}</strong> ({s.code}): {s.reason}</li>)}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
            <span className="form-text-hint">Type overtime in the Overtime column, then Recalculate. Red rows need attention.</span>
            {emp.length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowEmployer((v) => !v)}>
                <i className={`bi ${showEmployer ? 'bi-eye-slash' : 'bi-eye'}`}></i> Employer contributions
              </button>
            )}
          </div>

          {data.rows.length === 0 ? (
            <p className="dp-empty">No employee can be paid in this run.</p>
          ) : (
            <div className="xl-wrap">
              <table className="xl">
                <thead>
                  <tr>
                    <th className="xl-rn">#</th>
                    <th className="xl-nm xl-l">Employee</th>
                    <th>Basic</th>
                    <th>Allowances</th>
                    <th>Overtime</th>
                    <th>Gross</th>
                    {ded.map((c) => <th key={c.code}>{c.name}<span className="xl-sub">{c.code}</span></th>)}
                    <th>Total deductions</th>
                    <th>Net pay</th>
                    {showEmployer && emp.map((c) => <th key={c.code}>{c.name}<span className="xl-sub">employer · {c.code}</span></th>)}
                    {showEmployer && <th>Total employer</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={r.employee_id} className={r.warnings.length ? 'xl-bad' : ''} title={r.warnings.join(', ')}>
                      <td className="xl-rn">{i + 1}</td>
                      <td className="xl-nm">
                        <strong>{r.name}</strong>{r.is_new && <span className="xl-new">New</span>}
                        <span className="xl-sub">{r.code}{r.job_title ? ` · ${r.job_title}` : ''}</span>
                      </td>
                      <td className="xl-n">{fmtMoney(r.basic)}</td>
                      <td className="xl-n">{fmtMoney(r.allowances)}</td>
                      <td className="xl-n">
                        <input type="number" min="0" step="0.01" className="form-control form-control-sm xl-ot"
                          value={overtime[r.employee_id] ?? ''} placeholder={fmtMoney(r.overtime)}
                          onChange={(e) => setOt(r.employee_id, e.target.value)} aria-label={`Overtime for ${r.name}`} />
                      </td>
                      <td className="xl-n fw-600">{fmtMoney(r.gross)}</td>
                      {ded.map((c) => <td key={c.code} className="xl-n xl-ded">{fmtMoney(r.deductions[c.code] ?? 0)}</td>)}
                      <td className="xl-n xl-ded fw-600">{fmtMoney(r.total_deductions)}</td>
                      <td className="xl-n xl-net">{fmtMoney(r.net_pay)}</td>
                      {showEmployer && emp.map((c) => <td key={c.code} className="xl-n">{fmtMoney(r.employer[c.code] ?? 0)}</td>)}
                      {showEmployer && <td className="xl-n">{fmtMoney(r.total_employer)}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="xl-rn"></td>
                    <td className="xl-nm">TOTAL ({t.employees})</td>
                    <td className="xl-n">{fmtMoney(t.basic)}</td>
                    <td className="xl-n">{fmtMoney(t.allowances)}</td>
                    <td className="xl-n">{fmtMoney(t.overtime)}</td>
                    <td className="xl-n">{fmtMoney(t.gross)}</td>
                    {ded.map((c) => <td key={c.code} className="xl-n">{fmtMoney(t.deductions[c.code] ?? 0)}</td>)}
                    <td className="xl-n">{fmtMoney(t.total_deductions)}</td>
                    <td className="xl-n">{fmtMoney(t.net_pay)}</td>
                    {showEmployer && emp.map((c) => <td key={c.code} className="xl-n">{fmtMoney(t.employer[c.code] ?? 0)}</td>)}
                    {showEmployer && <td className="xl-n">{fmtMoney(t.total_employer)}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {dirty && <div className="alert alert-warning py-2 mt-3">Overtime changed. Click Recalculate to refresh the deductions and net pay before processing.</div>}
        </>
      ) : null}
    </Modal>
  );
}

/* ====================================================================================
 * Payslips of a posted run
 * ==================================================================================== */
function PayslipsModal({ run, rows, onClose }) {
  const dk = [...new Set(rows.flatMap((p) => Object.keys(p.deductions || {})))].sort();
  const sum = (f) => rows.reduce((a, p) => a + Number(f(p) || 0), 0);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try { await api.payrollRuns.exportPayslips(run.id); } finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={`Payslips · ${run.reference}`}
      subtitle={`${rows.length} employee${rows.length !== 1 ? 's' : ''}`}
      icon="bi-file-earmark-text"
      size="xl"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={download} disabled={busy}>
            <i className="bi bi-file-earmark-excel"></i> Download Excel
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </>
      }
    >
      <style>{SHEET_CSS}</style>
      <div className="xl-wrap">
        <table className="xl">
          <thead>
            <tr>
              <th className="xl-rn">#</th>
              <th className="xl-nm xl-l">Employee</th>
              <th>Basic</th>
              <th>Allowances</th>
              <th>Overtime</th>
              <th>Gross</th>
              {dk.map((k) => <th key={k}>{k}</th>)}
              <th>Total deductions</th>
              <th>Net pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.id ?? i}>
                <td className="xl-rn">{i + 1}</td>
                <td className="xl-nm"><strong>{p.employee}</strong><span className="xl-sub">{p.code}</span></td>
                <td className="xl-n">{fmtMoney(p.basic)}</td>
                <td className="xl-n">{fmtMoney(p.allowances)}</td>
                <td className="xl-n">{fmtMoney(p.overtime)}</td>
                <td className="xl-n fw-600">{fmtMoney(p.gross)}</td>
                {dk.map((k) => <td key={k} className="xl-n xl-ded">{fmtMoney(p.deductions?.[k] ?? 0)}</td>)}
                <td className="xl-n xl-ded fw-600">{fmtMoney(p.total_deductions)}</td>
                <td className="xl-n xl-net">{fmtMoney(p.net_pay)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="xl-rn"></td>
              <td className="xl-nm">TOTAL ({rows.length})</td>
              <td className="xl-n">{fmtMoney(sum((p) => p.basic))}</td>
              <td className="xl-n">{fmtMoney(sum((p) => p.allowances))}</td>
              <td className="xl-n">{fmtMoney(sum((p) => p.overtime))}</td>
              <td className="xl-n">{fmtMoney(sum((p) => p.gross))}</td>
              {dk.map((k) => <td key={k} className="xl-n">{fmtMoney(sum((p) => p.deductions?.[k]))}</td>)}
              <td className="xl-n">{fmtMoney(sum((p) => p.total_deductions))}</td>
              <td className="xl-n">{fmtMoney(sum((p) => p.net_pay))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Modal>
  );
}