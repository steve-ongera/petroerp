/**
 * Group consolidation.
 * - GET  /consolidation-runs/             readOnly list
 * - POST /consolidation-runs/run/         { period_start, period_end, reporting_currency? }
 * - GET  /consolidation-runs/:id/eliminations/
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Consolidation() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.consolidationRuns.list({ ordering: '-id' });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = () => setRunning(true);

  const view = async (r) => {
    try { setDetail({ run: r, eliminations: await api.consolidationRuns.eliminations(r.id) }); }
    catch (err) { setError(errorMessage(err)); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Consolidation</h1>
          <p className="page-header__subtitle">Group-level translation and elimination runs</p>
        </div>
        <div className="page-header__actions">
          {can('group.edit') && (
            <button className="btn btn-primary" onClick={run}>
              <i className="bi bi-play-circle" /> Run consolidation
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No consolidation runs</div>
            <div>Run one to combine the group's results.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Period</th><th>Reporting ccy</th>
                <th>Status</th><th>Created</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="is-clickable" onClick={() => view(r)}>
                    <td className="mono">{r.reference}</td>
                    <td>{r.period_start} → {r.period_end}</td>
                    <td className="mono">{r.reporting_currency}</td>
                    <td><span className={`status ${r.status === 'COMPLETED' ? 'status-active' : 'status-draft'}`}>{r.status}</span></td>
                    <td className="text-sm text-muted">{r.created_at}</td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="row-action" title="Eliminations" onClick={() => view(r)}><i className="bi bi-eye" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {running && (
        <RunModal onClose={() => setRunning(false)} onDone={() => { setRunning(false); load(); }} />
      )}
      {detail && (
        <DetailModal data={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

function RunModal({ onClose, onDone }) {
  const [form, setForm] = useState({
    period_start: todayISO().slice(0, 8) + '01',
    period_end: todayISO(),
    reporting_currency: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      if (!body.reporting_currency) delete body.reporting_currency;
      await api.consolidationRuns.run(body);
      onDone();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">Run consolidation</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
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
              <div className="field">
                <label className="label">Reporting currency</label>
                <input className="input mono" value={form.reporting_currency} onChange={set('reporting_currency')} placeholder="Defaults to server setting (USD)" />
              </div>
            </div>
            <p className="field-hint mt-3">
              You need access to every active entity, or Group Administrator rights.
            </p>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Running…' : 'Run'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DetailModal({ data, onClose }) {
  const { run, eliminations } = data;
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__dialog modal__dialog--xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">{run.reference}</h2>
            <p className="modal__subtitle">{run.period_start} → {run.period_end} · {run.reporting_currency}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          {!eliminations.length ? <p className="text-muted">No elimination entries recorded.</p> : (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead><tr><th>Entry</th><th>Description</th><th>Group account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
                <tbody>
                  {eliminations.map((e, i) => (
                    <tr key={i}>
                      <td>{e.entry}</td>
                      <td>{e.description}</td>
                      <td className="mono">{e.account}</td>
                      <td className="num">{fmtMoney(e.debit)}</td>
                      <td className="num">{fmtMoney(e.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal__footer"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}