/**
 * Unrealised FX revaluation.
 * - POST /group/revalue/  { company, as_of, post? }   (needs finance.close_period)
 *
 * Returns { as_of, gain_loss, journal, columns, rows } — we render the table_response payload.
 * When post=false it only previews; post=true also posts the adjusting journal.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function FxRevaluation() {
  const { can } = useAuth();
  const { notify } = useApp();
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState({ company: '', as_of: todayISO(), post: false });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.companies.listAll().then(setCompanies).catch(() => {}); }, []);

  const run = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setResult(null);
    try {
      const res = await api.group.revalue(form);
      setResult(res);
      notify(form.post ? 'Journal posted.' : 'Preview ready.', form.post ? 'success' : 'info');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">FX revaluation</h1>
          <p className="page-header__subtitle">
            Unrealised gains/losses on open foreign-currency AR and AP at the closing rate
          </p>
        </div>
      </header>

      <div className="split split--wide-right">
        <div className="card">
          <div className="card__header"><h2 className="card__title">Parameters</h2></div>
          <div className="card__body">
            <form onSubmit={run} className="form">
              <div className="field">
                <label className="label label--required">Company</label>
                <select className="select" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} required>
                  <option value="">—</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label label--required">As of date</label>
                <input type="date" className="input" value={form.as_of} onChange={(e) => setForm({ ...form, as_of: e.target.value })} required />
              </div>
              <div className="field">
                <label className="check">
                  <input type="checkbox" checked={!!form.post} onChange={(e) => setForm({ ...form, post: e.target.checked })} />
                  Post the adjusting journal (otherwise preview only)
                </label>
              </div>
              {error && <p className="field-error" role="alert">{error}</p>}
              <div className="form-actions">
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? 'Working…' : form.post ? 'Revalue & post' : 'Preview'}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="stack">
          {result && (
            <div className="card">
              <div className="card__header">
                <h2 className="card__title">Result</h2>
                {result.journal && <span className="badge badge--success">Posted: {result.journal}</span>}
              </div>
              <div className="card__body">
                <div className="kv mb-3">
                  <div className="kv__item">
                    <div className="kv__label">Net gain / (loss)</div>
                    <div className={`kv__value ${Number(result.gain_loss) < 0 ? 'text-danger' : 'text-success'}`}>
                      {fmtMoney(result.gain_loss)}
                    </div>
                  </div>
                  <div className="kv__item"><div className="kv__label">As of</div><div className="kv__value">{result.as_of}</div></div>
                </div>

                {!result.rows?.length ? (
                  <p className="text-muted">No open foreign-currency balances.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table table--compact">
                      <thead>
                        <tr>{(result.columns || []).map((c, i) => (
                          <th key={i} className={i >= 3 ? 'num' : ''}>{c}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {result.rows.map((r, i) => (
                          <tr key={i}>
                            {r.map((v, j) => (
                              <td key={j} className={j >= 3 ? 'num' : ''}>{typeof v === 'number' ? fmtMoney(v) : v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
          {!result && (
            <div className="card">
              <div className="card__body">
                <div className="table-empty">
                  <div className="table-empty__title">No preview yet</div>
                  <div>Choose a company and run a preview to see the impact.</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}