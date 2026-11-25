/**
 * Payroll.
 * - CRUD /payroll-runs/            (DRAFT → POSTED via process)
 * - POST /payroll-runs/:id/process/ { overtime: { employeeId: amount } } (needs finance.post)
 * - GET  /payroll-runs/:id/payslips/
 * - /payroll-configs/, /employees/ (crud)
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
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

export default function Payroll() {
  const { can } = useAccess();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [payslips, setPayslips] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.payrollRuns.list({ ...companyParams(), ordering: '-period_end', page_size: 500 });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const processRun = async (r) => {
    if (!window.confirm(`Process payroll ${r.reference}? This posts the payroll journal.`)) return;
    try { await api.payrollRuns.process(r.id, {}); notify('Payroll posted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const viewPayslips = async (r) => {
    try { setPayslips({ run: r, rows: await api.payrollRuns.payslips(r.id) }); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const filtered = rows.filter((r) => !status || r.status === status);
  const { pageRows, paginationProps } = usePagination(filtered);

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-people-fill"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Payroll</h1>
            <p className="page-subtitle">
              {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {rows.length} run{rows.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('finance.post') && (
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
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
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
                          {r.status === 'DRAFT' && can('finance.post') && (
                            <button className="btn btn-sm btn-primary" onClick={() => processRun(r)}>
                              <i className="bi bi-play-fill"></i> Process
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
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Run created.', 'success'); load(); }}
        />
      )}
      {payslips && <PayslipsModal run={payslips.run} rows={payslips.rows} onClose={() => setPayslips(null)} />}
    </div>
  );
}

function NewRunModal({ companyParams, onClose, onSaved }) {
  const [form, setForm] = useState({ period_start: todayISO(), period_end: todayISO() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try { await api.payrollRuns.create({ ...form, company: companyParams().company }); onSaved(); }
    catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="New payroll run"
      subtitle="Choose the pay period, then process it"
      icon="bi-people-fill"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="payrollRunForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Creating...' : 'Create'}
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

function PayslipsModal({ run, rows, onClose }) {
  return (
    <Modal
      show
      onClose={onClose}
      title={`Payslips · ${run.reference}`}
      subtitle={`${rows.length} employee${rows.length !== 1 ? 's' : ''}`}
      icon="bi-file-earmark-text"
      size="xl"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      <div className="table-wrap">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="text-right">Basic</th>
                <th className="text-right">Allowances</th>
                <th className="text-right">Overtime</th>
                <th className="text-right">Gross</th>
                <th className="text-right">Deductions</th>
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i}>
                  <td className="cell-name">{p.employee}</td>
                  <td className="cell-num">{fmtMoney(p.basic)}</td>
                  <td className="cell-num">{fmtMoney(p.allowances)}</td>
                  <td className="cell-num">{fmtMoney(p.overtime)}</td>
                  <td className="cell-num">{fmtMoney(p.gross)}</td>
                  <td className="cell-num">{fmtMoney(p.total_deductions)}</td>
                  <td className="cell-num fw-600">{fmtMoney(p.net_pay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}