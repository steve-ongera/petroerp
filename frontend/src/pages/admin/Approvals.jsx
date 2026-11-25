/**
 * Approvals inbox.
 * - GET  /approvals/            list ApprovalRequest (readOnly resource)
 * - POST /approvals/:id/approve { comment }
 * - POST /approvals/:id/reject  { comment }
 *
 * Server rules that we mirror in the UI:
 *   - you cannot approve your own request
 *   - you cannot decide on a request for a company you don't access
 *   - role / amount policy is enforced server-side, we only surface the error
 * Paging is server-side (25 per page), so this page keeps its own pager.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage } from '../../services/api';
import Modal from '../../components/Modal';
import TableSkeleton from '../../components/TableSkeleton';

const PAGE_SIZE = 25;

const TABS = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'ALL', label: 'All' },
];

const PILL = {
  PENDING: 'status-pill--warning',
  APPROVED: 'status-pill--success',
  REJECTED: 'status-pill--danger',
  SUBMITTED: 'status-pill--neutral',
  CANCELLED: 'status-pill--neutral',
};
const pill = (s) => `status-pill ${PILL[s] || 'status-pill--neutral'}`;

function fmtMoney(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export default function Approvals() {
  const { user, can } = useAccess();
  const { companyParams, notify } = useApp();
  const [tab, setTab] = useState('PENDING');
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const canDecide = can('approvals.decide');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.approvals.list({
        ...companyParams(), ordering: '-id', page,
        ...(tab === 'ALL' ? {} : { status: tab }),
        ...(search ? { search } : {}),
      });
      const items = res?.results || res || [];
      setRows(items);
      setCount(res?.count ?? items.length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [tab, page, search, companyParams]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, search]);

  const decide = async (req, approve, comment) => {
    try {
      await (approve ? api.approvals.approve(req.id, comment) : api.approvals.reject(req.id, comment));
      notify(`Request ${approve ? 'approved' : 'rejected'}.`, 'success');
      setSelected(null);
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const pages = Math.max(1, Math.ceil((count || 0) / PAGE_SIZE));

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-check2-square"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Approvals</h1>
            <p className="page-subtitle">Documents waiting for a decision</p>
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <i className="bi bi-arrow-clockwise"></i>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      <section className="page-card">
        <div className="tabs" style={{ padding: '0 1rem' }}>
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {t.key === tab && count > 0 && <span className="tab__count">{count}</span>}
            </button>
          ))}
        </div>

        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search document, requester..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search approvals"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          {search && (
            <button className="btn btn-secondary" onClick={() => setSearch('')}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Requests
          </span>
          <span className="chart-card__subtitle">{count} request{count !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-check2-all"></i>
            <h6>Nothing here</h6>
            <p className="text-muted-soft">
              {search ? 'No requests match your search' : 'No approval requests in this tab'}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Summary</th>
                    <th className="text-right">Amount</th>
                    <th>Requested by</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const mine = r.created_by === user?.id;
                    return (
                      <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(r)}>
                        <td>
                          <span className="cell-name">{r.doc_type}</span>
                          <div className="cell-mono text-muted-soft" style={{ fontSize: '0.8rem' }}>#{r.object_id}</div>
                        </td>
                        <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.summary}</td>
                        <td className="cell-num">{fmtMoney(r.amount)}</td>
                        <td>{r.created_by_label || '—'}</td>
                        <td>{fmtDateTime(r.created_at)}</td>
                        <td><span className={pill(r.status)}>{r.status}</span></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions">
                            {canDecide && r.status === 'PENDING' && !mine ? (
                              <button className="btn btn-sm btn-primary" onClick={() => setSelected(r)}>Review</button>
                            ) : (
                              <button className="btn btn-sm btn-secondary" onClick={() => setSelected(r)}>View</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {count > PAGE_SIZE && (
          <div className="pagination pagination--bordered">
            <span className="pagination__info">
              Page <strong>{page}</strong> of <strong>{pages}</strong> · {count} items
            </span>
            <div className="pagination__list">
              <button className="pagination__btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <button className="pagination__btn active">{page}</button>
              <button className="pagination__btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <DecisionModal
          req={selected}
          canDecide={canDecide}
          isMine={selected.created_by === user?.id}
          onClose={() => setSelected(null)}
          onDecide={decide}
        />
      )}
    </div>
  );
}

function DecisionModal({ req, canDecide, isMine, onClose, onDecide }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const actionable = req.status === 'PENDING' && canDecide && !isMine;

  const submit = async (ok) => {
    setBusy(true);
    try { await onDecide(req, ok, comment); } finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={req.doc_type}
      subtitle={req.summary}
      icon="bi-check2-square"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          {actionable && (
            <>
              <button className="btn btn-outline-danger" disabled={busy} onClick={() => submit(false)}>
                <i className="bi bi-x-circle"></i> Reject
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => submit(true)}>
                <i className="bi bi-check-circle"></i> {busy ? 'Working...' : 'Approve'}
              </button>
            </>
          )}
        </>
      }
    >
      <h6 className="modal-section-title"><i className="bi bi-info-circle" aria-hidden="true"></i>Request</h6>
      <div className="kv">
        <div className="kv__item"><div className="kv__label">Amount</div><div className="kv__value">{fmtMoney(req.amount)}</div></div>
        <div className="kv__item"><div className="kv__label">Status</div><div className="kv__value"><span className={pill(req.status)}>{req.status}</span></div></div>
        <div className="kv__item"><div className="kv__label">Requested by</div><div className="kv__value">{req.created_by_label || '—'}</div></div>
        <div className="kv__item"><div className="kv__label">Created</div><div className="kv__value">{fmtDateTime(req.created_at)}</div></div>
        <div className="kv__item"><div className="kv__label">Decided by</div><div className="kv__value">{req.decided_by_label || '—'}</div></div>
        <div className="kv__item"><div className="kv__label">Decided at</div><div className="kv__value">{fmtDateTime(req.decided_at)}</div></div>
      </div>

      {req.actions && req.actions.length > 0 && (
        <>
          <h6 className="modal-section-title"><i className="bi bi-clock-history" aria-hidden="true"></i>Action History</h6>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {req.actions.map((a, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                <span className={pill(a.action)}>{a.action}</span>
                <div style={{ flex: 1 }}>
                  <div>{a.actor}</div>
                  {a.comment && <div className="text-muted-soft">{a.comment}</div>}
                  <div className="text-muted-soft" style={{ fontSize: '0.8rem' }}>{fmtDateTime(a.at)}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {isMine && req.status === 'PENDING' && (
        <div className="alert alert-warning mt-3" role="note">
          You cannot approve your own request (segregation of duties).
        </div>
      )}

      {actionable && (
        <>
          <h6 className="modal-section-title"><i className="bi bi-chat-left-text" aria-hidden="true"></i>Decision</h6>
          <label className="form-label" htmlFor="approval-comment">Comment (optional)</label>
          <textarea
            id="approval-comment"
            className="form-control"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Reason for the decision..."
          />
        </>
      )}
    </Modal>
  );
}