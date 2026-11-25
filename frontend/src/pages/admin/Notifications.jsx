/**
 * Notifications inbox.
 * - GET  /notifications/           user-scoped list (server filters by request.user)
 * - GET  /notifications/unread/    -> { count } (already polled by AppContext)
 * - POST /notifications/:id/read/  mark one as read
 * - POST /notifications/read-all/  mark all as read
 *
 * After reading, refreshUnread() is called so the navbar bell updates immediately.
 * Paging is server-side (25 per page), so this page uses its own pager instead of usePagination.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import TableSkeleton from '../../components/TableSkeleton';

const PAGE_SIZE = 25;

const LEVELS = [
  { key: 'ALL', label: 'All' },
  { key: 'INFO', label: 'Info' },
  { key: 'WARNING', label: 'Warning' },
  { key: 'CRITICAL', label: 'Critical' },
];

const LEVEL_PILL = {
  INFO: 'status-pill--neutral',
  WARNING: 'status-pill--warning',
  CRITICAL: 'status-pill--danger',
};

const LEVEL_ICON = {
  CRITICAL: 'bi-exclamation-octagon',
  WARNING: 'bi-exclamation-triangle',
  INFO: 'bi-info-circle',
};

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export default function Notifications() {
  const { refreshUnread, notify } = useApp();
  const [level, setLevel] = useState('ALL');
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.notifications.list({ ordering: '-id', page });
      const items = res?.results || res || [];
      setRows(items);
      setCount(res?.count ?? items.length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const unread = useMemo(() => rows.filter((n) => !n.is_read).length, [rows]);

  const markRead = async (n) => {
    if (n.is_read) return;
    setBusy(true);
    try {
      await api.notifications.read(n.id);
      setRows((rs) => rs.map((r) => (r.id === n.id ? { ...r, is_read: true } : r)));
      await refreshUnread();
    } catch (err) { notify(errorMessage(err), 'error'); }
    finally { setBusy(false); }
  };

  const markAll = async () => {
    setBusy(true);
    try {
      await api.notifications.readAll();
      setRows((rs) => rs.map((r) => ({ ...r, is_read: true })));
      await refreshUnread();
      notify('All notifications marked as read.', 'success');
    } catch (err) { notify(errorMessage(err), 'error'); }
    finally { setBusy(false); }
  };

  const visible = useMemo(() => (level === 'ALL' ? rows : rows.filter((r) => r.level === level)), [rows, level]);
  const pages = Math.max(1, Math.ceil((count || 0) / PAGE_SIZE));

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-bell"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Notifications</h1>
            <p className="page-subtitle">{unread > 0 ? `${unread} unread on this page` : 'You are all caught up'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <i className="bi bi-arrow-clockwise"></i>
            Refresh
          </button>
          <button className="btn btn-primary" onClick={markAll} disabled={busy || unread === 0}>
            <i className="bi bi-check2-all"></i>
            Mark all as read
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
          {LEVELS.map((t) => (
            <button key={t.key} className={`tab ${level === t.key ? 'active' : ''}`} onClick={() => setLevel(t.key)}>
              {t.label}
              {t.key === level && visible.length > 0 && <span className="tab__count">{visible.length}</span>}
            </button>
          ))}
        </div>

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Inbox
          </span>
          <span className="chart-card__subtitle">
            {count} notification{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading && !rows.length ? (
          <TableSkeleton rows={6} columns={3} />
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-bell-slash"></i>
            <h6>No notifications</h6>
            <p className="text-muted-soft">
              {level === 'ALL' ? 'Nothing here yet' : 'You have no notifications in this category'}
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {visible.map((n) => (
              <li
                key={n.id}
                className={`notif-item ${n.is_read ? '' : 'is-unread'}`}
                style={{ borderBottom: '1px solid var(--border-color)', padding: 16, display: 'flex', gap: 12 }}
              >
                <span className="notif-item__icon" aria-hidden="true">
                  <i className={`bi ${LEVEL_ICON[n.level] || LEVEL_ICON.INFO}`}></i>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <span className="fw-600">{n.title}</span>
                    <span className={`status-pill ${LEVEL_PILL[n.level] || 'status-pill--neutral'}`}>{n.level}</span>
                  </div>
                  {n.message && <p className="text-muted-soft" style={{ margin: '4px 0 0' }}>{n.message}</p>}
                  <div className="text-muted-soft" style={{ fontSize: '0.8rem', marginTop: 4 }}>{fmtDateTime(n.created_at)}</div>
                  <div className="row-actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                    {n.link && (
                      <Link to={n.link} className="btn btn-sm btn-secondary" onClick={() => markRead(n)}>
                        <i className="bi bi-box-arrow-up-right"></i> Open
                      </Link>
                    )}
                    {!n.is_read && (
                      <button className="btn btn-sm btn-secondary" onClick={() => markRead(n)} disabled={busy}>
                        <i className="bi bi-check2"></i> Mark read
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
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
    </div>
  );
}