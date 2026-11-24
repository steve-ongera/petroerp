/**
 * Fiscal years + accounting periods.
 * - POST /fiscal-years/         create (needs finance.close_period via perm_map)
 * - POST /fiscal-years/:id/close -> svc.close_fiscal_year
 * - POST /accounting-periods/:id/close  / reopen  -> svc.close_period / reopen_period
 *
 * Reading is GET /fiscal-years/ and /accounting-periods/ (readOnly resource).
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function FiscalYears() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [years, setYears] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [selectedYear, setSelectedYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const canManage = can('finance.close_period');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [y, p] = await Promise.all([
        api.fiscalYears.listAll({ ...companyParams() }),
        api.accountingPeriods.listAll({ ...companyParams() }),
      ]);
      setYears(y); setPeriods(p);
      if (selectedYear && !y.some((x) => x.id === selectedYear.id)) setSelectedYear(null);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, selectedYear]);

  useEffect(() => { load(); }, [load]);

  const closeYear = async (y) => {
    if (!window.confirm(`Close ${y.name}? This posts the year-end closing entry and closes all its periods.`)) return;
    try {
      await api.fiscalYears.close(y.id);
      notify('Fiscal year closed.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const closePeriod = async (p) => {
    try { await api.accountingPeriods.close(p.id); notify('Period closed.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const reopenPeriod = async (p) => {
    try { await api.accountingPeriods.reopen(p.id); notify('Period reopened.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const periodsFor = (y) => periods.filter((p) => String(p.fiscal_year) === String(y.id));

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Fiscal years</h1>
          <p className="page-header__subtitle">
            Year-end closing and monthly accounting periods
            {activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {canManage && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg" /> New fiscal year
            </button>
          )}
        </div>
      </header>

      {error ? (
        <div className="card"><div className="card__body">
          <p className="field-error" role="alert">{error}</p>
          <button className="btn mt-2" onClick={load}>Try again</button>
        </div></div>
      ) : loading ? (
        <div className="state-screen">Loading…</div>
      ) : (
        <div className="split split--wide-left">
          {/* years */}
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">Years</h2>
            </div>
            {!years.length ? (
              <div className="card__body">
                <div className="table-empty">
                  <div className="table-empty__title">No fiscal years</div>
                  <div>Create one to start posting journals.</div>
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Name</th><th>Start</th><th>End</th><th>Status</th><th className="col-actions" /></tr>
                  </thead>
                  <tbody>
                    {years.map((y) => (
                      <tr key={y.id} className={`is-clickable ${selectedYear?.id === y.id ? 'is-selected' : ''}`}
                          onClick={() => setSelectedYear(y)}>
                        <td className="fw-500">{y.name}</td>
                        <td>{y.start_date}</td>
                        <td>{y.end_date}</td>
                        <td><span className={`status ${y.status === 'OPEN' ? 'status-active' : 'status-closed'}`}>{y.status}</span></td>
                        <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                          {canManage && y.status === 'OPEN' && (
                            <button className="btn btn-sm" onClick={() => closeYear(y)}>Close year</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* periods */}
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">
                {selectedYear ? `Periods · ${selectedYear.name}` : 'Periods'}
              </h2>
            </div>
            {!selectedYear ? (
              <div className="card__body"><p className="text-muted">Select a fiscal year to see its periods.</p></div>
            ) : !periodsFor(selectedYear).length ? (
              <div className="card__body">
                <p className="text-muted">No periods generated for this year.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table table--compact">
                  <thead>
                    <tr><th>Period</th><th>Start</th><th>End</th><th>Status</th><th className="col-actions" /></tr>
                  </thead>
                  <tbody>
                    {periodsFor(selectedYear).map((p) => (
                      <tr key={p.id}>
                        <td className="fw-500">{p.name}</td>
                        <td>{p.start_date}</td>
                        <td>{p.end_date}</td>
                        <td><span className={`status ${p.status === 'OPEN' ? 'status-active' : 'status-closed'}`}>{p.status}</span></td>
                        <td className="col-actions">
                          {canManage && p.status === 'OPEN' && (
                            <button className="btn btn-xs" onClick={() => closePeriod(p)}>Close</button>
                          )}
                          {canManage && p.status === 'CLOSED' && selectedYear.status !== 'CLOSED' && (
                            <button className="btn btn-xs" onClick={() => reopenPeriod(p)}>Reopen</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {creating && (
        <NewYearModal
          companyParams={companyParams}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); notify('Fiscal year created.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function NewYearModal({ companyParams, onClose, onSaved }) {
  const [form, setForm] = useState({ name: `FY ${new Date().getFullYear()}`, start_date: `${new Date().getFullYear()}-01-01`, end_date: `${new Date().getFullYear()}-12-31` });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      await api.fiscalYears.create({ ...form, company: companyParams().company });
      onSaved();
    } catch (err) {
      setError(errorMessage(err)); setFieldErr(fieldErrors(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">New fiscal year</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <div className={`field ${fieldErr.name ? 'has-error' : ''}`}>
                <label className="label label--required">Name</label>
                <input className="input" value={form.name} onChange={set('name')} required />
              </div>
              <div className="form-grid">
                <div className={`field ${fieldErr.start_date ? 'has-error' : ''}`}>
                  <label className="label label--required">Start date</label>
                  <input type="date" className="input" value={form.start_date} onChange={set('start_date')} required />
                </div>
                <div className={`field ${fieldErr.end_date ? 'has-error' : ''}`}>
                  <label className="label label--required">End date</label>
                  <input type="date" className="input" value={form.end_date} onChange={set('end_date')} required />
                </div>
              </div>
              <p className="field-hint">Monthly accounting periods are created automatically.</p>
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