/**
 * Tank reconciliation.
 * - POST /tank-reconciliations/           { tank, date, physical_qty }  → record variance
 * - POST /tank-reconciliations/:id/raise-adjustment/ { reason }         → PENDING adjustment (needs inventory.adjust)
 * - GET  /tank-reconciliations/           readOnly list
 * - /tank-readings/ (crud)                — optional per-tank dip readings.
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

export default function Reconciliation() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [r, t] = await Promise.all([
        api.tankReconciliations.listAll({
          ...companyParams(), ordering: '-recon_date',
          ...(from ? { date_from: from } : {}),
          ...(to ? { date_to: to } : {}),
        }),
        api.storageTanks.listAll({ ...companyParams() }),
      ]);
      setRows(r); setTanks(t);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, from, to]);

  useEffect(() => { load(); }, [load]);

  const raise = async (r) => {
    const reason = window.prompt('Reason for the adjustment?', `Reconciliation ${r.reference}`);
    if (reason == null) return;
    try {
      const adj = await api.tankReconciliations.raiseAdjustment(r.id, reason);
      notify(`Adjustment ${adj.reference} created — approval required.`, 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Tank reconciliation</h1>
          <p className="page-header__subtitle">
            Physical vs book comparison{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('inventory.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg" /> New reconciliation
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{rows.length} record{rows.length === 1 ? '' : 's'}</span>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No reconciliations</div>
            <div>Create one after a physical dip reading.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>Tank</th><th>Product</th>
                <th className="num">Book</th><th className="num">Physical</th>
                <th className="num">Variance</th><th className="num">Value</th>
                <th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.reference}</td>
                    <td>{r.recon_date}</td>
                    <td className="mono">{r.tank_label || r.tank}</td>
                    <td>{r.product_label || r.product}</td>
                    <td className="num">{Number(r.closing_book).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                    <td className="num">{Number(r.physical_qty).toLocaleString(undefined, { minimumFractionDigits: 3 })}</td>
                    <td className="num">
                      <span className={Number(r.variance) < 0 ? 'text-danger' : Number(r.variance) > 0 ? 'text-success' : ''}>
                        {Number(r.variance).toLocaleString(undefined, { minimumFractionDigits: 3 })}
                      </span>
                    </td>
                    <td className="num">{fmtMoney(r.variance_value)}</td>
                    <td><span className={`status ${r.status === 'NO_VARIANCE' ? 'status-active' : r.status === 'PENDING_ADJUSTMENT' ? 'status-pending' : 'status-posted'}`}>{r.status}</span></td>
                    <td className="col-actions">
                      {Number(r.variance) !== 0 && !r.adjustment && can('inventory.adjust') && (
                        <button className="btn btn-xs" onClick={() => raise(r)}>Raise adjustment</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <ReconModal tanks={tanks} onClose={() => setCreating(false)}
                    onDone={() => { setCreating(false); notify('Reconciliation recorded.', 'success'); load(); }} />
      )}
    </div>
  );
}

function ReconModal({ tanks, onClose, onDone }) {
  const [form, setForm] = useState({ tank: '', date: todayISO(), physical_qty: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.tankReconciliations.create(form); onDone(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">New tank reconciliation</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <div className="field">
                <label className="label label--required">Tank</label>
                <select className="select" value={form.tank} onChange={set('tank')} required>
                  <option value="">—</option>
                  {tanks.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name} · {t.product_label || ''}</option>)}
                </select>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label className="label label--required">Date</label>
                  <input type="date" className="input" value={form.date} onChange={set('date')} required />
                </div>
                <div className="field">
                  <label className="label label--required">Physical quantity (L)</label>
                  <input type="number" step="0.001" className="input num" value={form.physical_qty} onChange={set('physical_qty')} required />
                </div>
              </div>
            </div>
            <p className="field-hint mt-3">
              Records the variance only. It becomes a stock adjustment once it is raised and approved.
            </p>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Record'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}