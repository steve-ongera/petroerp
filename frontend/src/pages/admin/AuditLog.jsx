/**
 * Audit trail.
 * - GET /audit-logs/          readOnly (filter by company, user, action, model_name; search)
 * - GET /audit-logs/verify/   verify_audit_chain() ? { ok, tampered_ids }
 *
 * Audit log entries are immutable and hash-chained: each row hashes the previous hash.
 * Any tampering (or re-ordered rows) shows up in the verify endpoint.
 * Paging is server-side (50 per page), so this page keeps its own pager.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import Modal from '../../components/Modal';
import TableSkeleton from '../../components/TableSkeleton';

const PAGE_SIZE = 50;

const ACTIONS = [
  'LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'POST_JOURNAL', 'REVERSE_JOURNAL',
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
      const items = res?.results || res || [];
      setRows(items);
      setCount(res?.count ?? items.length);
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

  const hasActiveFilters = !!(search || action || model);
  const clearFilters = () => { setSearch(''); setAction(''); setModel(''); };
  const pages = Math.max(1, Math.ceil((count || 0) / PAGE_SIZE));

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Audit log</h1>
            <p className="page-subtitle">Append-only, hash-chained history of every change</p>
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <i className="bi bi-arrow-clockwise"></i>
            Refresh
          </button>
          <button className="btn btn-primary" onClick={verifyChain} disabled={chainBusy}>
            <i className="bi bi-shield-check"></i>
            {chainBusy ? 'Verifying...' : 'Verify chain'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      {chain && (
        <div className={`alert ${chain.ok ? 'alert-success' : 'alert-danger'}`} role="status">
          <i className={`bi ${chain.ok ? 'bi-shield-check' : 'bi-exclamation-octagon'}`} aria-hidden="true"></i>
          <span style={{ flex: 1 }}>
            {chain.ok
              ? 'Chain verified: no entries have been altered or re-ordered.'
              : `Tampering detected in row(s): ${chain.tampered_ids.join(', ')}`}
          </span>
        </div>
      )}

      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search object, id, action..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search audit log"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input
            type="text"
            className="form-control"
            style={{ maxWidth: 220 }}
            placeholder="Model (e.g. PurchaseOrder)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model name"
          />
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
            {action && (
              <span className="filter-chip">
                Action: {action}
                <button onClick={() => setAction('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {model && (
              <span className="filter-chip">
                Model: {model}
                <button onClick={() => setModel('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Audit Entries
          </span>
          <span className="chart-card__subtitle">{count} entr{count === 1 ? 'y' : 'ies'}</span>
        </div>

        {loading ? (
          <TableSkeleton rows={10} columns={7} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-journal-x"></i>
            <h6>No entries found</h6>
            <p className="text-muted-soft">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Model</th>
                    <th>Object</th>
                    <th>IP</th>
                    <th className="text-center" style={{ width: '5rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetails(r)}>
                      <td>{fmtDateTime(r.created_at)}</td>
                      <td>{r.user_label || r.user || '—'}</td>
                      <td><span className="badge badge-neutral">{r.action}</span></td>
                      <td className="cell-mono">{r.model_name}</td>
                      <td className="cell-name" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.object_repr || `#${r.object_id}`}
                      </td>
                      <td>{r.ip_address || '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <button className="btn btn-icon" title="Details" aria-label="Details" onClick={() => setDetails(r)}>
                            <i className="bi bi-eye"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {count > PAGE_SIZE && (
          <div className="pagination pagination--bordered">
            <span className="pagination__info">
              Page <strong>{page}</strong> of <strong>{pages}</strong> · {count} entries
            </span>
            <div className="pagination__list">
              <button className="pagination__btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <button className="pagination__btn active">{page}</button>
              <button className="pagination__btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        )}
      </section>

      {details && (
        <Modal
          show
          onClose={() => setDetails(null)}
          title={`${details.action} · ${details.model_name}`}
          subtitle={details.object_repr || `#${details.object_id}`}
          icon="bi-journal-check"
          size="lg"
          footer={<button type="button" className="btn btn-secondary" onClick={() => setDetails(null)}>Close</button>}
        >
          <h6 className="modal-section-title"><i className="bi bi-info-circle" aria-hidden="true"></i>Entry</h6>
          <div className="kv">
            <div className="kv__item"><div className="kv__label">When</div><div className="kv__value">{fmtDateTime(details.created_at)}</div></div>
            <div className="kv__item"><div className="kv__label">User</div><div className="kv__value">{details.user_label || details.user || '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Model</div><div className="kv__value cell-mono">{details.model_name}</div></div>
            <div className="kv__item"><div className="kv__label">Object id</div><div className="kv__value cell-mono">{details.object_id}</div></div>
            <div className="kv__item"><div className="kv__label">IP</div><div className="kv__value">{details.ip_address || '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Hash</div><div className="kv__value cell-mono" style={{ wordBreak: 'break-all', fontSize: '0.75rem' }}>{details.hash}</div></div>
          </div>
          {details.changes && Object.keys(details.changes).length > 0 && (
            <>
              <h6 className="modal-section-title"><i className="bi bi-braces" aria-hidden="true"></i>Changes</h6>
              <pre style={{ maxHeight: 320, overflow: 'auto', fontSize: '0.8rem' }}>
                {JSON.stringify(details.changes, null, 2)}
              </pre>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}