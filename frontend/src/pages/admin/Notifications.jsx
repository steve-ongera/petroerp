/**
 * Notifications inbox.
 * - GET  /notifications/           user-scoped list (server filters by request.user)
 * - GET  /notifications/unread/    -> { count } (already polled by AppContext)
 * - POST /notifications/:id/read/  mark one as read
 * - POST /notifications/read-all/  mark all as read
 *
 * After reading, we call refreshUnread() so the navbar bell updates immediately.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const LEVELS = [
  { key: 'ALL', label: 'All' },
  { key: 'INFO', label: 'Info' },
  { key: 'WARNING', label: 'Warning' },
  { key: 'CRITICAL', label: 'Critical' },
];

const LEVEL_BADGE = {
  INFO: 'badge badge--info',
  WARNING: 'badge badge--warning',
  CRITICAL: 'badge badge--danger',
};

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export default function Notifications() {
  const { refreshUnread, notify } = useApp();
  const [tab, setTab] = useState('ALL');
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { ordering: '-id', page };
      const res = await api.notifications.list(params);
      const items = res?.results || res || [];
      setRows(items);
      setCount(res?.count ?? items.length);
      setUnread(items.filter((n) => !n.is_read).length);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const markRead = async (n) => {
    if (n.is_read) return;
    setBusy(true);
    try {
      await api.notifications.read(n.id);
      setRows((rs) => rs.map((r) => (r.id === n.id ? { ...r, is_read: true } : r)));
      setUnread((u) => Math.max(0, u - 1));
      await refreshUnread();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const markAll = async () => {
    setBusy(true);
    try {
      await api.notifications.readAll();
      setRows((rs) => rs.map((r) => ({ ...r, is_read: true })));
      setUnread(0);
      await refreshUnread();
      notify('All notifications marked as read.', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    if (tab === 'ALL') return rows;
    return rows.filter((r) => r.level === tab);
  }, [rows, tab]);

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Notifications</h1>
          <p className="page-header__subtitle">
            {unread > 0 ? `${unread} unread` : 'You are all caught up.'}
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn" onClick={load} disabled={loading}>Refresh</button>
          <button className="btn btn-primary" onClick={markAll} disabled={busy || unread === 0}>
            Mark all as read
          </button>
        </div>
      </header>

      <div className="tabs">
        {LEVELS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === tab && visible.length > 0 && (
              <span className="tab__count">{visible.length}</span>
            )}
          </button>
        ))}
      </div>

      {error ? (
        <div className="card">
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        </div>
      ) : loading && !rows.length ? (
        <div className="state-screen">Loading notifications…</div>
      ) : !visible.length ? (
        <div className="card">
          <div className="card__body">
            <div className="table-empty">
              <div className="table-empty__title">No notifications</div>
              <div>You have no notifications in this category.</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <ul>
            {visible.map((n) => (
              <li
                key={n.id}
                className={`notif-item ${n.is_read ? '' : 'is-unread'}`}
                style={{ borderBottom: '1px solid var(--border)', padding: 16 }}
              >
                <span className="notif-item__icon" aria-hidden="true">
                  <i className={`bi ${n.level === 'CRITICAL' ? 'bi-exclamation-octagon' : n.level === 'WARNING' ? 'bi-exclamation-triangle' : 'bi-info-circle'}`} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="d-flex items-center justify-between gap-2 flex-wrap">
                    <div className="fw-600">{n.title}</div>
                    <span className={LEVEL_BADGE[n.level] || 'badge'}>{n.level}</span>
                  </div>
                  {n.message && <p className="text-sm text-muted mt-1">{n.message}</p>}
                  <div className="text-xs text-faint mt-1">{fmtDateTime(n.created_at)}</div>
                  <div className="mt-2 d-flex items-center gap-2">
                    {n.link && (
                      <Link
                        to={n.link}
                        className="btn btn-xs"
                        onClick={() => markRead(n)}
                      >
                        Open
                      </Link>
                    )}
                    {!n.is_read && (
                      <button className="btn btn-xs" onClick={() => markRead(n)} disabled={busy}>
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} count={count} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

function Pagination({ page, count, onChange, size = 25 }) {
  const pages = Math.max(1, Math.ceil((count || 0) / size));
  if (count <= size) return null;
  return (
    <div className="pagination pagination--bordered">
      <span className="pagination__info">Page <strong>{page}</strong> of <strong>{pages}</strong> · {count} items</span>
      <div className="pagination__list">
        <button className="pagination__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <button className="pagination__btn active">{page}</button>
        <button className="pagination__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}