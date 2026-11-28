/**
 * General ledger journals.
 * - GET /journals/          readOnly posted journals (with lines)
 * - POST /journals/manual/  { company, date, description, lines: [{account, debit, credit, narration?, shipment?}] }
 * - POST /journals/:id/reverse/ { reason?, date? }
 *
 * Posted journals are immutable · corrections are reversing entries.
 * Paging is server-side (50 per page).
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import ServerPager from '../../components/ServerPager';
import TableSkeleton from '../../components/TableSkeleton';

const PAGE_SIZE = 50;
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const pill = (s) => `status-pill ${s === 'POSTED' ? 'status-pill--success' : 'status-pill--neutral'}`;

export default function Journals() {
  const { can } = useAccess();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState(null);
  const [manual, setManual] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.journals.list({
        ...companyParams(), ordering: '-date', page,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(from ? { date_from: from } : {}),
        ...(to ? { date_to: to } : {}),
      });
      const items = res?.results || res || [];
      setRows(items);
      setCount(res?.count ?? items.length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, status, from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, from, to]);

  const hasActiveFilters = !!(search || status || from || to);
  const clearFilters = () => { setSearch(''); setStatus(''); setFrom(''); setTo(''); };

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Journals</h1>
            <p className="page-subtitle">
              Posted general-ledger entries{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('finance.post') && (
            <button className="btn btn-primary" onClick={() => setManual(true)}>
              <i className="bi bi-plus-lg"></i>
              Manual journal
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

      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search reference or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search journals"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="POSTED">Posted</option>
            <option value="REVERSED">Reversed</option>
          </select>
          <input type="date" className="form-control" style={{ maxWidth: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className="form-control" style={{ maxWidth: 170 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          {hasActiveFilters && (
            <button className="btn btn-secondary" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="chip-row">
            {search && <span className="filter-chip">Search: "{search}"<button onClick={() => setSearch('')}><i className="bi bi-x"></i></button></span>}
            {status && <span className="filter-chip">Status: {status}<button onClick={() => setStatus('')}><i className="bi bi-x"></i></button></span>}
            {from && <span className="filter-chip">From: {from}<button onClick={() => setFrom('')}><i className="bi bi-x"></i></button></span>}
            {to && <span className="filter-chip">To: {to}<button onClick={() => setTo('')}><i className="bi bi-x"></i></button></span>}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Journal Entries
          </span>
          <span className="chart-card__subtitle">{count} entr{count === 1 ? 'y' : 'ies'}</span>
        </div>

        {loading ? (
          <TableSkeleton rows={10} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-journal-x"></i>
            <h6>No journals found</h6>
            <p className="text-muted-soft">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Source</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '5rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((j) => (
                    <tr key={j.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(j)}>
                      <td className="cell-mono text-brand fw-600">{j.reference}</td>
                      <td>{j.date}</td>
                      <td className="cell-name" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.description}</td>
                      <td>{j.source_type || '—'}</td>
                      <td className="cell-num">{fmtMoney(j.total_debit)}</td>
                      <td className="cell-num">{fmtMoney(j.total_credit)}</td>
                      <td><span className={pill(j.status)}>{j.status}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <button className="btn btn-icon" title="View" aria-label="View" onClick={() => setDetail(j)}>
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

        {!loading && <ServerPager page={page} count={count} onChange={setPage} size={PAGE_SIZE} label="entries" />}
      </section>

      {detail && (
        <JournalDetail
          journal={detail}
          canReverse={can('finance.post')}
          onClose={() => setDetail(null)}
          onReversed={() => { setDetail(null); notify('Reversed.', 'success'); load(); }}
        />
      )}
      {manual && (
        <ManualJournalModal
          companyParams={companyParams}
          onClose={() => setManual(false)}
          onSaved={() => { setManual(false); notify('Journal posted.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function JournalDetail({ journal, canReverse, onClose, onReversed }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lines = journal.lines || [];
  const reversible = journal.status === 'POSTED' && canReverse;

  const reverse = async () => {
    if (!window.confirm(`Reverse ${journal.reference}? This posts a mirror journal.`)) return;
    setBusy(true); setError('');
    try { await api.journals.reverse(journal.id, { reason }); onReversed(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={journal.reference}
      subtitle={journal.description}
      icon="bi-journal-text"
      size="xl"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          {reversible && (
            <button className="btn btn-outline-danger" onClick={reverse} disabled={busy}>
              <i className="bi bi-arrow-counterclockwise"></i>
              {busy ? 'Reversing...' : 'Post reversal'}
            </button>
          )}
        </>
      }
    >
      <h6 className="modal-section-title"><i className="bi bi-info-circle" aria-hidden="true"></i>Journal</h6>
      <div className="kv">
        <div className="kv__item"><div className="kv__label">Date</div><div className="kv__value">{journal.date}</div></div>
        <div className="kv__item"><div className="kv__label">Period</div><div className="kv__value">{journal.period_label || journal.period}</div></div>
        <div className="kv__item"><div className="kv__label">Source</div><div className="kv__value">{journal.source_type || '—'}</div></div>
        <div className="kv__item"><div className="kv__label">Posted by</div><div className="kv__value">{journal.posted_by_label || '—'}</div></div>
        <div className="kv__item"><div className="kv__label">Status</div><div className="kv__value"><span className={pill(journal.status)}>{journal.status}</span></div></div>
      </div>

      <h6 className="modal-section-title"><i className="bi bi-list-ol" aria-hidden="true"></i>Lines</h6>
      <div className="table-wrap">
        <div className="table-responsive">
          <table className="table mb-0">
            <thead>
              <tr><th>Account</th><th>Narration</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="cell-mono text-brand fw-600">{l.account_code || l.account_label || l.account}</td>
                  <td>{l.narration || '—'}</td>
                  <td className="cell-num">{fmtMoney(l.debit)}</td>
                  <td className="cell-num">{fmtMoney(l.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>Totals</th>
                <th className="text-right">{fmtMoney(journal.total_debit)}</th>
                <th className="text-right">{fmtMoney(journal.total_credit)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {reversible && (
        <>
          <h6 className="modal-section-title"><i className="bi bi-arrow-counterclockwise" aria-hidden="true"></i>Reversal</h6>
          <Field label="Reason">
            <input className="form-control" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong account" />
          </Field>
        </>
      )}
      {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
    </Modal>
  );
}

function ManualJournalModal({ companyParams, onClose, onSaved }) {
  const [form, setForm] = useState({ date: todayISO(), description: '' });
  const [lines, setLines] = useState([
    { account: '', debit: '', credit: '', narration: '' },
    { account: '', debit: '', credit: '', narration: '' },
  ]);
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.accounts.listAll({ ...companyParams(), is_postable: true }).then(setAccounts).catch(() => {});
  }, [companyParams]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, { account: '', debit: '', credit: '', narration: '' }]);
  const removeLine = (i) => setLines((ls) => ls.filter((_, j) => j !== i));
  const totalD = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalC = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = totalD > 0 && Math.abs(totalD - totalC) < 0.005;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.journals.manual({
        ...form,
        company: companyParams().company,
        lines: lines.filter((l) => l.account && (l.debit || l.credit))
          .map((l) => ({ account: l.account, debit: l.debit || 0, credit: l.credit || 0, narration: l.narration || '' })),
      });
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Manual journal"
      subtitle="Debits must equal credits"
      icon="bi-journal-plus"
      size="xl"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="manualJournalForm" disabled={busy || !balanced}>
            <i className="bi bi-check2-circle"></i>
            {busy ? 'Posting...' : 'Post journal'}
          </button>
        </>
      }
    >
      <form id="manualJournalForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Header</h6>
        <div className="form-grid">
          <Field label="Date" required>
            <input type="date" className="form-control" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Field>
          <Field label="Description" required>
            <input className="form-control" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-list-ol" aria-hidden="true"></i>Lines</h6>
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>Account</th>
                  <th>Narration</th>
                  <th className="text-right" style={{ width: 150 }}>Debit</th>
                  <th className="text-right" style={{ width: 150 }}>Credit</th>
                  <th style={{ width: '3rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select className="form-select" value={l.account} onChange={(e) => setLine(i, 'account', e.target.value)}>
                        <option value="">—</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                      </select>
                    </td>
                    <td><input className="form-control" value={l.narration} onChange={(e) => setLine(i, 'narration', e.target.value)} /></td>
                    <td><input type="number" step="0.01" className="form-control num" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} /></td>
                    <td><input type="number" step="0.01" className="form-control num" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} /></td>
                    <td>
                      {lines.length > 2 && (
                        <button type="button" className="btn btn-icon" aria-label="Remove line" onClick={() => removeLine(i)}>
                          <i className="bi bi-x-lg"></i>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={addLine}>
                      <i className="bi bi-plus-lg"></i> Add line
                    </button>
                  </th>
                  <th className="text-right">{fmtMoney(totalD)}</th>
                  <th className="text-right">{fmtMoney(totalC)}</th>
                  <th></th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className={`alert ${balanced ? 'alert-success' : 'alert-warning'} mt-3`} role="status">
          Difference: <strong>{fmtMoney(totalD - totalC)}</strong>
          {balanced ? ' · balanced' : ' · debits and credits must match'}
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}