/**
 * General ledger journals.
 * - GET /journals/          readOnly posted journals (with lines)
 * - POST /journals/manual/  { company, date, description, lines: [{account, debit, credit, narration?, shipment?}] }
 * - POST /journals/:id/reverse/ { reason?, date? }
 *
 * Posted journals are immutable — corrections are reversing entries.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Journals() {
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
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, status, from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, from, to]);

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Journals</h1>
          <p className="page-header__subtitle">
            Posted general-ledger entries{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setManual(true)}>
            <i className="bi bi-plus-lg" /> Manual journal
          </button>
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search reference, description…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="POSTED">Posted</option>
            <option value="REVERSED">Reversed</option>
          </select>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{count} entries</span>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No journals</div><div>Change the filters above.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>Description</th><th>Source</th>
                <th className="num">Debit</th><th className="num">Credit</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((j) => (
                  <tr key={j.id} className="is-clickable" onClick={() => setDetail(j)}>
                    <td className="mono">{j.reference}</td>
                    <td>{j.date}</td>
                    <td className="text-truncate" style={{ maxWidth: 300 }}>{j.description}</td>
                    <td className="text-sm text-muted">{j.source_type || '—'}</td>
                    <td className="num">{fmtMoney(j.total_debit)}</td>
                    <td className="num">{fmtMoney(j.total_credit)}</td>
                    <td><span className={`status ${j.status === 'POSTED' ? 'status-posted' : 'status-closed'}`}>{j.status}</span></td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="row-action" title="View" onClick={() => setDetail(j)}><i className="bi bi-eye" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} count={count} onChange={setPage} />
      </div>

      {detail && (
        <JournalDetail
          journal={detail}
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

function JournalDetail({ journal, onClose, onReversed }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lines = journal.lines || [];

  const reverse = async () => {
    if (!window.confirm(`Reverse ${journal.reference}? This posts a mirror journal.`)) return;
    setBusy(true); setError('');
    try { await api.journals.reverse(journal.id, { reason }); onReversed(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__dialog modal__dialog--xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">{journal.reference}</h2>
            <p className="modal__subtitle">{journal.description}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          <div className="kv">
            <div className="kv__item"><div className="kv__label">Date</div><div className="kv__value">{journal.date}</div></div>
            <div className="kv__item"><div className="kv__label">Period</div><div className="kv__value">{journal.period_label || journal.period}</div></div>
            <div className="kv__item"><div className="kv__label">Source</div><div className="kv__value">{journal.source_type || '—'}</div></div>
            <div className="kv__item"><div className="kv__label">Posted by</div><div className="kv__value">{journal.posted_by_label || '—'}</div></div>
          </div>
          <hr className="divider" />
          <div className="table-wrap">
            <table className="table table--compact">
              <thead><tr><th>Account</th><th>Narration</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.account_code || l.account}</td>
                    <td>{l.narration || '—'}</td>
                    <td className="num">{fmtMoney(l.debit)}</td>
                    <td className="num">{fmtMoney(l.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th colSpan={2}>Totals</th>
                  <th className="num">{fmtMoney(journal.total_debit)}</th>
                  <th className="num">{fmtMoney(journal.total_credit)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
          {journal.status === 'POSTED' && (
            <>
              <hr className="divider" />
              <div className="field">
                <label className="label">Reverse reason</label>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong account" />
              </div>
              {error && <p className="field-error mt-2">{error}</p>}
            </>
          )}
        </div>
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>Close</button>
          {journal.status === 'POSTED' && (
            <button className="btn btn-danger-outline" onClick={reverse} disabled={busy}>
              {busy ? 'Reversing…' : 'Post reversal'}
            </button>
          )}
        </div>
      </div>
    </div>
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
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--xl">
        <div className="modal__header">
          <h2 className="modal__title">Manual journal</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <div className="field">
                <label className="label label--required">Date</label>
                <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              </div>
              <div className="field">
                <label className="label label--required">Description</label>
                <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
              </div>
            </div>
            <hr className="divider" />
            <div className="line-items">
              <table>
                <thead><tr><th style={{ width: '40%' }}>Account</th><th>Narration</th><th className="num" style={{ width: 140 }}>Debit</th><th className="num" style={{ width: 140 }}>Credit</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <select className="select" value={l.account} onChange={(e) => setLine(i, 'account', e.target.value)}>
                          <option value="">—</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                        </select>
                      </td>
                      <td><input className="input" value={l.narration} onChange={(e) => setLine(i, 'narration', e.target.value)} /></td>
                      <td><input type="number" step="0.01" className="input num" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} /></td>
                      <td><input type="number" step="0.01" className="input num" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} /></td>
                      <td>
                        {lines.length > 2 && (
                          <button type="button" className="row-action row-action--danger" onClick={() => removeLine(i)}>
                            <i className="bi bi-x-lg" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="line-items__foot">
                <button type="button" className="btn btn-sm" onClick={addLine}>+ Add line</button>
                <div className="totals">
                  <div className="totals__row"><span>Debits</span><span>{fmtMoney(totalD)}</span></div>
                  <div className="totals__row"><span>Credits</span><span>{fmtMoney(totalC)}</span></div>
                  <div className="totals__row totals__row--grand"><span>Difference</span><span>{fmtMoney(totalD - totalC)}</span></div>
                </div>
              </div>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || totalD !== totalC || !totalD}>
              {busy ? 'Posting…' : 'Post journal'}
            </button>
          </div>
        </form>
      </div>
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