/**
 * Payroll.
 * - CRUD /payroll-runs/            (DRAFT → POSTED via process)
 * - POST /payroll-runs/:id/process/ { overtime: { employeeId: amount } } (needs finance.post)
 * - GET  /payroll-runs/:id/payslips/
 * - /payroll-configs/, /employees/ (crud)
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Payroll() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [payslips, setPayslips] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.payrollRuns.list({ ...companyParams(), ordering: '-period_end' });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const process = async (r) => {
    if (!window.confirm(`Process payroll ${r.reference}? This posts the payroll journal.`)) return;
    try { await api.payrollRuns.process(r.id, {}); notify('Payroll posted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const viewPayslips = async (r) => {
    try { setPayslips({ run: r, rows: await api.payrollRuns.payslips(r.id) }); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Payroll</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {rows.length} run{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('finance.post') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New payroll run
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No payroll runs</div><div>Create the first payroll run.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Period</th><th className="num">Gross</th>
                <th className="num">Deductions</th><th className="num">Net</th>
                <th className="num">Employer cost</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.reference}</td>
                    <td>{r.period_start} → {r.period_end}</td>
                    <td className="num">{fmtMoney(r.total_gross)}</td>
                    <td className="num">{fmtMoney(r.total_deductions)}</td>
                    <td className="num">{fmtMoney(r.total_net)}</td>
                    <td className="num">{fmtMoney(r.total_employer_cost)}</td>
                    <td><span className={`status ${r.status === 'POSTED' ? 'status-posted' : 'status-draft'}`}>{r.status}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {r.status === 'DRAFT' && can('finance.post') && (
                          <button className="btn btn-xs btn-primary" onClick={() => process(r)}>Process</button>
                        )}
                        {r.status === 'POSTED' && (
                          <button className="btn btn-xs" onClick={() => viewPayslips(r)}>Payslips</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <NewRunModal
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Run created.', 'success'); load(); }}
        />
      )}
      {payslips && (
        <PayslipsModal
          run={payslips.run} rows={payslips.rows}
          onClose={() => setPayslips(null)}
        />
      )}
    </div>
  );
}

function NewRunModal({ companyParams, onClose, onSaved }) {
  const [form, setForm] = useState({ period_start: todayISO(), period_end: todayISO() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.payrollRuns.create({ ...form, company: companyParams().company }); onSaved(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">New payroll run</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <div className="field">
                <label className="label label--required">Period start</label>
                <input type="date" className="input" value={form.period_start} onChange={set('period_start')} required />
              </div>
              <div className="field">
                <label className="label label--required">Period end</label>
                <input type="date" className="input" value={form.period_end} onChange={set('period_end')} required />
              </div>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayslipsModal({ run, rows, onClose }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__dialog modal__dialog--xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Payslips · {run.reference}</h2>
            <p className="modal__subtitle">{rows.length} employee{rows.length === 1 ? '' : 's'}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          <div className="table-wrap">
            <table className="table table--compact">
              <thead><tr>
                <th>Employee</th><th className="num">Basic</th><th className="num">Allowances</th>
                <th className="num">Overtime</th><th className="num">Gross</th>
                <th className="num">Deductions</th><th className="num">Net</th>
              </tr></thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={i}>
                    <td>{p.employee}</td>
                    <td className="num">{fmtMoney(p.basic)}</td>
                    <td className="num">{fmtMoney(p.allowances)}</td>
                    <td className="num">{fmtMoney(p.overtime)}</td>
                    <td className="num">{fmtMoney(p.gross)}</td>
                    <td className="num">{fmtMoney(p.total_deductions)}</td>
                    <td className="num">{fmtMoney(p.net_pay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}