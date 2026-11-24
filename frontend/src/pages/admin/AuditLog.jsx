/**
 * Audit trail.
 * - GET /audit-logs/          readOnly (filter by company, user, action, model_name; search)
 * - GET /audit-logs/verify/   verify_audit_chain() → { ok, tampered_ids }
 *
 * Audit log entries are immutable and hash-chained: each row hashes the previous hash.
 * Any tampering (or re-ordered rows) shows up in the verify endpoint.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const ACTIONS = [
  '', 'LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'POST_JOURNAL', 'REVERSE_JOURNAL',
  'SUBMIT_APPROVAL', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED',
  'POST_PAYMENT', 'APPROVE_PAYMENT', 'POST_EXPENSE', 'POST_PURCHASE_INVOICE',
  'POST_SALES_INVOICE', 'SHIPMENT_STATUS', 'RECEIVE_GOODS', 'FINAL_COST_SHEET',
];

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export default function AuditLog() {
  const { companyParams, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [model, setModel] = useState('');
  const [details, setDetails] = useState(null);
  const [chain, setChain] = useState(null);
  const [chainBusy, setChainBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.auditLogs.list({
        ...companyParams(), ordering: '-id', page,
        ...(search ? { search } : {}),
        ...(action ? { action } : {}),
        ...(model ? { model_name: model } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, action, model]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, action, model]);

  const verifyChain = async () => {
    setChainBusy(true); setChain(null);
    try {
      const res = await api.auditLogs.verify();
      setChain(res);
      notify(res.ok ? 'Audit chain verified.' : `Tampering detected: ${res.tampered_ids.length} row(s).`, res.ok ? 'success' : 'error');
    } catch (err) { notify(errorMessage(err), 'error'); }
    finally { setChainBusy(false); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Audit log</h1>
          <p className="page-header__subtitle">Append-only, hash-chained history of every change</p>
        </div>
        <div className="page-header__actions">
          <button className="btn" onClick={verifyChain} disabled={chainBusy}>
            {chainBusy ? 'Verifying…' : 'Verify chain'}
          </button>
          <button className="btn" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </header>

      {chain && (
        <div className={`card mb-4`}>
          <div className="card__body">
            <div className="d-flex items-center gap-3">
              <span className={`badge ${chain.ok ? 'badge--success' : 'badge--danger'}`}>
                {chain.ok ? 'OK · untampered' : 'Tampered'}
              </span>
              {!chain.ok && (
                <span className="text-sm text-muted">Rows: {chain.tampered_ids.join(', ')}</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search object, id, action…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => <option key={a} value={a}>{a || 'All actions'}</option>)}
          </select>
          <input className="input" placeholder="Model name (e.g. PurchaseOrder)"
                 value={model} onChange={(e) => setModel(e.target.value)} style={{ width: 220 }} />
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{count} entries</span>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !rows.length && !loading ? (
          <div className="table-empty">
            <div className="table-empty__title">No entries</div>
            <div>Change the filters above.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead><tr>
                <th>When</th><th>User</th><th>Action</th><th>Model</th><th>Object</th><th>IP</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="is-clickable" onClick={() => setDetails(r)}>
                    <td className="text-sm text-muted">{fmtDateTime(r.created_at)}</td>
                    <td>{r.user_label || r.user || '—'}</td>
                    <td><span className="badge">{r.action}</span></td>
                    <td className="mono">{r.model_name}</td>
                    <td className="text-truncate" style={{ maxWidth: 260 }}>{r.object_repr || `#${r.object_id}`}</td>
                    <td className="text-sm text-muted">{r.ip_address || '—'}</td>
                    <td className="col-actions">
                      <button className="row-action" onClick={(e) => { e.stopPropagation(); setDetails(r); }} title="Details">
                        <i className="bi bi-eye" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} count={count} onChange={setPage} />
      </div>

      {details && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setDetails(null)}>
          <div className="modal__dialog modal__dialog--lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div>
                <h2 className="modal__title">{details.action} · {details.model_name}</h2>
                <p className="modal__subtitle">{details.object_repr || `#${details.object_id}`}</p>
              </div>
              <button className="modal__close" onClick={() => setDetails(null)} aria-label="Close"><i className="bi bi-x-lg" /></button>
            </div>
            <div className="modal__body">
              <div className="kv">
                <div className="kv__item"><div className="kv__label">When</div><div className="kv__value">{fmtDateTime(details.created_at)}</div></div>
                <div className="kv__item"><div className="kv__label">User</div><div className="kv__value">{details.user_label || details.user || '—'}</div></div>
                <div className="kv__item"><div className="kv__label">Model</div><div className="kv__value mono">{details.model_name}</div></div>
                <div className="kv__item"><div className="kv__label">Object id</div><div className="kv__value mono">{details.object_id}</div></div>
                <div className="kv__item"><div className="kv__label">IP</div><div className="kv__value">{details.ip_address || '—'}</div></div>
                <div className="kv__item"><div className="kv__label">Hash</div><div className="kv__value mono text-xs text-break">{details.hash}</div></div>
              </div>
              {details.changes && Object.keys(details.changes).length > 0 && (
                <>
                  <hr className="divider" />
                  <h3 className="h5 mb-2">Changes</h3>
                  <pre className="text-sm" style={{ maxHeight: 320, overflow: 'auto' }}>
                    {JSON.stringify(details.changes, null, 2)}
                  </pre>
                </>
              )}
            </div>
            <div className="modal__footer">
              <button className="btn" onClick={() => setDetails(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Pagination({ page, count, onChange, size = 50 }) {
  const pages = Math.max(1, Math.ceil((count || 0) / size));
  if (count <= size) return null;
  return (
    <div className="pagination pagination--bordered">
      <span className="pagination__info">Page <strong>{page}</strong> of <strong>{pages}</strong> · {count} entries</span>
      <div className="pagination__list">
        <button className="pagination__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <button className="pagination__btn active">{page}</button>
        <button className="pagination__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}