/**
 * Fiscal years + accounting periods.
 * - POST /fiscal-years/         create (needs finance.close_period via perm_map)
 * - POST /fiscal-years/:id/close -> svc.close_fiscal_year
 * - POST /accounting-periods/:id/close  / reopen  -> svc.close_period / reopen_period
 *
 * Reading is GET /fiscal-years/ and /accounting-periods/ (readOnly resource).
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const pill = (status) => `status-pill ${status === 'OPEN' ? 'status-pill--success' : 'status-pill--neutral'}`;

export default function FiscalYears() {
  const { can } = useAccess();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [years, setYears] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [selectedYearId, setSelectedYearId] = useState(null);
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
      setSelectedYearId((cur) => (cur && y.some((x) => x.id === cur) ? cur : null));
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const closeYear = async (y) => {
    if (!window.confirm(`Close ${y.name}? This posts the year-end closing entry and closes all its periods.`)) return;
    try { await api.fiscalYears.close(y.id); notify('Fiscal year closed.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const closePeriod = async (p) => {
    try { await api.accountingPeriods.close(p.id); notify('Period closed.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const reopenPeriod = async (p) => {
    try { await api.accountingPeriods.reopen(p.id); notify('Period reopened.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const selectedYear = years.find((y) => y.id === selectedYearId) || null;
  const yearPeriods = selectedYear ? periods.filter((p) => String(p.fiscal_year) === String(selectedYear.id)) : [];

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Fiscal years</h1>
            <p className="page-subtitle">
              Year-end closing and monthly accounting periods{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {canManage && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg"></i>
              New fiscal year
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

      <div className="split split--wide-left">
        {/* ---------- Years ---------- */}
        <section className="page-card">
          <div className="table-wrap__header">
            <span className="panel-title">
              <i className="bi bi-calendar-event text-brand"></i>
              Years
            </span>
            <span className="chart-card__subtitle">{years.length} year{years.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : (
            <YearsTable
              rows={years}
              selectedId={selectedYearId}
              canManage={canManage}
              onSelect={(y) => setSelectedYearId(y.id)}
              onClose={closeYear}
            />
          )}
        </section>

        {/* ---------- Periods ---------- */}
        <section className="page-card">
          <div className="table-wrap__header">
            <span className="panel-title">
              <i className="bi bi-calendar-week text-brand"></i>
              {selectedYear ? `Periods · ${selectedYear.name}` : 'Periods'}
            </span>
            {selectedYear && (
              <span className="chart-card__subtitle">{yearPeriods.length} period{yearPeriods.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {loading ? (
            <TableSkeleton rows={6} columns={5} />
          ) : !selectedYear ? (
            <div className="empty-state">
              <i className="bi bi-hand-index"></i>
              <h6>Select a fiscal year</h6>
              <p className="text-muted-soft">Pick a year on the left to see its accounting periods</p>
            </div>
          ) : (
            <PeriodsTable
              key={selectedYear.id}
              rows={yearPeriods}
              yearClosed={selectedYear.status === 'CLOSED'}
              canManage={canManage}
              onClose={closePeriod}
              onReopen={reopenPeriod}
            />
          )}
        </section>
      </div>

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

function YearsTable({ rows, selectedId, canManage, onSelect, onClose }) {
  const { pageRows, paginationProps } = usePagination(rows);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-calendar3"></i>
        <h6>No fiscal years yet</h6>
        <p className="text-muted-soft">Click 'New fiscal year' to start posting journals</p>
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
                <th>Name</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th className="text-center" style={{ width: '8rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((y) => (
                <tr
                  key={y.id}
                  className={selectedId === y.id ? 'is-selected' : ''}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(y)}
                >
                  <td className="cell-name text-brand fw-600">{y.name}</td>
                  <td>{y.start_date}</td>
                  <td>{y.end_date}</td>
                  <td><span className={pill(y.status)}>{y.status}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {canManage && y.status === 'OPEN' && (
                      <div className="row-actions">
                        <button className="btn btn-sm btn-secondary" onClick={() => onClose(y)}>
                          <i className="bi bi-lock"></i> Close year
                        </button>
                      </div>
                    )}
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

function PeriodsTable({ rows, yearClosed, canManage, onClose, onReopen }) {
  const { pageRows, paginationProps } = usePagination(rows);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-calendar-x"></i>
        <h6>No periods for this year</h6>
        <p className="text-muted-soft">Periods are generated when the fiscal year is created</p>
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
                <th>Period</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th className="text-center" style={{ width: '8rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p) => (
                <tr key={p.id}>
                  <td className="cell-name fw-600">{p.name}</td>
                  <td>{p.start_date}</td>
                  <td>{p.end_date}</td>
                  <td><span className={pill(p.status)}>{p.status}</span></td>
                  <td>
                    <div className="row-actions">
                      {canManage && p.status === 'OPEN' && (
                        <button className="btn btn-sm btn-secondary" onClick={() => onClose(p)}>
                          <i className="bi bi-lock"></i> Close
                        </button>
                      )}
                      {canManage && p.status === 'CLOSED' && !yearClosed && (
                        <button className="btn btn-sm btn-secondary" onClick={() => onReopen(p)}>
                          <i className="bi bi-unlock"></i> Reopen
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
      <Pagination {...paginationProps} />
    </>
  );
}

function NewYearModal({ companyParams, onClose, onSaved }) {
  const yr = new Date().getFullYear();
  const [form, setForm] = useState({ name: `FY ${yr}`, start_date: `${yr}-01-01`, end_date: `${yr}-12-31` });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      await api.fiscalYears.create({ ...form, company: companyParams().company });
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="New fiscal year"
      subtitle="Monthly accounting periods are created automatically"
      icon="bi-calendar3"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="fiscalYearForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Creating...' : 'Create'}
          </button>
        </>
      }
    >
      <form id="fiscalYearForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-calendar-range" aria-hidden="true"></i>Year Details</h6>
        <div className="form-grid">
          <Field label="Name" required err={fieldErr.name} span>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Start date" required err={fieldErr.start_date}>
            <input type="date" className="form-control" value={form.start_date} onChange={set('start_date')} required />
          </Field>
          <Field label="End date" required err={fieldErr.end_date}>
            <input type="date" className="form-control" value={form.end_date} onChange={set('end_date')} required />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}