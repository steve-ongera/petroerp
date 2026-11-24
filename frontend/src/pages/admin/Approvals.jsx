/**
 * Approvals inbox.
 * - GET  /approvals/            list ApprovalRequest (readOnly resource)
 * - POST /approvals/:id/approve { comment }
 * - POST /approvals/:id/reject  { comment }
 * - GET  /approvals/:id/history audit trail (from readOnly factory)
 *
 * Server rules that we mirror in the UI:
 *   - you cannot approve your own request
 *   - you cannot decide on a request for a company you don't access
 *   - role / amount policy is enforced server-side, we only surface the error
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const TABS = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'ALL', label: 'All' },
];

function fmtMoney(n, currency = '') {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return `${currency ? `${currency} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

const statusBadge = (s) => {
  const map = {
    PENDING: 'status status-pending',
    APPROVED: 'status status-approved',
    REJECTED: 'status status-rejected',
    CANCELLED: 'status status-inactive',
  };
  return map[s] || 'status status-draft';
};

export default function Approvals() {
  const { user, can } = useAuth();
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
      const params = {
        ...companyParams(),
        ordering: '-id',
        page,
        ...(tab === 'ALL' ? {} : { status: tab }),
        ...(search ? { search } : {}),
      };
      const res = await api.approvals.list(params);
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || res || []).length);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, page, search, companyParams]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, search]);

  const decide = async (req, approve, comment) => {
    try {
      await (approve ? api.approvals.approve(req.id, comment) : api.approvals.reject(req.id, comment));
      notify(`Request ${approve ? 'approved' : 'rejected'}.`, 'success');
      setSelected(null);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Approvals</h1>
          <p className="page-header__subtitle">Documents waiting for a decision</p>
        </div>
        <div className="page-header__actions">
          <button className="btn" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === tab && count > 0 && <span className="tab__count">{count}</span>}
          </button>
        ))}
      </div>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input
              className="input"
              placeholder="Search document, requester…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{count} request{count === 1 ? '' : 's'}</span>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !rows.length && !loading ? (
          <div className="table-empty">
            <div className="table-empty__title">Nothing here</div>
            <div>No approval requests in this tab.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Summary</th>
                  <th className="num">Amount</th>
                  <th>Requested by</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th className="col-actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mine = r.created_by === user?.id;
                  return (
                    <tr key={r.id} className="is-clickable" onClick={() => setSelected(r)}>
                      <td>
                        <span className="cell-main">{r.doc_type}</span>
                        <span className="cell-sub mono">#{r.object_id}</span>
                      </td>
                      <td className="text-truncate" style={{ maxWidth: 320 }}>{r.summary}</td>
                      <td className="num">{fmtMoney(r.amount)}</td>
                      <td>{r.created_by_label || '—'}</td>
                      <td className="text-sm text-muted">{fmtDateTime(r.created_at)}</td>
                      <td><span className={statusBadge(r.status)}>{r.status}</span></td>
                      <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                        {canDecide && r.status === 'PENDING' && !mine ? (
                          <button className="btn btn-sm btn-primary" onClick={() => setSelected(r)}>Review</button>
                        ) : (
                          <button className="btn btn-sm" onClick={() => setSelected(r)}>View</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} count={count} onChange={setPage} />
      </div>

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

/* ------------------------------------------------------------------ pieces */

function Pagination({ page, count, onChange, size = 25 }) {
  const pages = Math.max(1, Math.ceil((count || 0) / size));
  if (count <= size) return null;
  return (
    <div className="pagination pagination--bordered">
      <span className="pagination__info">
        Page <strong>{page}</strong> of <strong>{pages}</strong> · {count} items
      </span>
      <div className="pagination__list">
        <button className="pagination__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <button className="pagination__btn active">{page}</button>
        <button className="pagination__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function DecisionModal({ req, canDecide, isMine, onClose, onDecide }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const disabled = !canDecide || isMine || req.status !== 'PENDING' || busy;

  const submit = async (ok) => {
    setBusy(true);
    try { await onDecide(req, ok, comment); } finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">{req.doc_type}</h2>
            <p className="modal__subtitle">{req.summary}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="modal__body">
          <div className="kv">
            <div className="kv__item"><div className="kv__label">Amount</div><div className="kv__value">{fmtMoney(req.amount)}</div></div>
            <div className="kv__item"><div className="kv__label">Status</div><div className="kv__value"><span className={statusBadge(req.status)}>{req.status}</span></div></div>
            <div className="kv__item"><div className="kv__label">Requested by</div><div className="kv__value">{req.created_by_label || '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Created</div><div className="kv__value">{fmtDateTime(req.created_at)}</div></div>
            <div className="kv__item"><div className="kv__label">Decided by</div><div className="kv__value">{req.decided_by_label || '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Decided at</div><div className="kv__value">{fmtDateTime(req.decided_at)}</div></div>
          </div>

          {req.actions && req.actions.length > 0 && (
            <>
              <hr className="divider" />
              <h3 className="h5 mb-2">Action history</h3>
              <ul className="stack-sm">
                {req.actions.map((a, i) => (
                  <li key={i} className="d-flex items-start gap-2">
                    <span className={statusBadge(a.action)}>{a.action}</span>
                    <div className="flex-1">
                      <div className="text-sm">{a.actor}</div>
                      {a.comment && <div className="text-xs text-muted">{a.comment}</div>}
                      <div className="text-xs text-faint">{fmtDateTime(a.at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {isMine && (
            <p className="field-error mt-3">
              You cannot approve your own request (segregation of duties).
            </p>
          )}

          {req.status === 'PENDING' && canDecide && !isMine && (
            <div className="field mt-4">
              <label className="label">Comment (optional)</label>
              <textarea
                className="textarea"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Reason for the decision…"
              />
            </div>
          )}
        </div>

        <div className="modal__footer modal__footer--between">
          <button className="btn" onClick={onClose}>Close</button>
          {req.status === 'PENDING' && canDecide && !isMine && (
            <div className="btn-toolbar">
              <button className="btn btn-danger-outline" disabled={disabled} onClick={() => submit(false)}>
                Reject
              </button>
              <button className="btn btn-primary" disabled={disabled} onClick={() => submit(true)}>
                {busy ? 'Working…' : 'Approve'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}