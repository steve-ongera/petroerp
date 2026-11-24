/**
 * Bank accounts, statement import, matching and reconciliation.
 * - /bank-accounts/ (crud)
 * - POST /bank-accounts/:id/import-statement/ (file or CSV text)
 * - POST /bank-accounts/:id/auto-match/
 * - POST /bank-accounts/:id/reconcile/   { statement_date, statement_balance }
 * - GET  /bank-accounts/:id/balance/?as_of=
 * - /bank-transactions/ (readOnly) POST /:id/match/ { payment } POST /:id/ignore/
 * - /bank-reconciliations/ (readOnly)
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function Bank() {
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [recons, setRecons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('transactions');
  const [importing, setImporting] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const loadAccounts = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const a = await api.bankAccounts.listAll({ ...companyParams() });
      setAccounts(a);
      if (!selected && a.length) setSelected(a[0]);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, selected]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    try {
      const [b, t, r] = await Promise.all([
        api.bankAccounts.balance(selected.id),
        api.bankTransactions.listAll({ bank_account: selected.id, ordering: '-txn_date' }),
        api.bankReconciliations.listAll({ bank_account: selected.id, ordering: '-id' }),
      ]);
      setBalance(b); setTransactions(t); setRecons(r);
    } catch (err) { setError(errorMessage(err)); }
  }, [selected]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const autoMatch = async () => {
    try { const res = await api.bankAccounts.autoMatch(selected.id); notify(`Auto-matched ${res.matched} line(s).`, 'success'); loadDetail(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const match = async (t) => {
    const pid = window.prompt('Payment ID to match this statement line to:');
    if (!pid) return;
    try { await api.bankTransactions.match(t.id, parseInt(pid, 10)); notify('Matched.', 'success'); loadDetail(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const ignore = async (t) => {
    try { await api.bankTransactions.ignore(t.id); notify('Ignored.', 'success'); loadDetail(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Bank & cash</h1>
          <p className="page-header__subtitle">
            Accounts, statement import, reconciliation{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {selected && (
            <>
              <button className="btn" onClick={() => setImporting(true)}>Import statement</button>
              <button className="btn" onClick={autoMatch}>Auto-match</button>
              <button className="btn btn-primary" onClick={() => setReconciling(true)}>Reconcile</button>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="card mb-4"><div className="card__body">
          <p className="field-error" role="alert">{error}</p>
          <button className="btn mt-2" onClick={loadAccounts}>Try again</button>
        </div></div>
      )}

      <div className="split split--wide-right">
        <div className="card">
          <div className="card__header"><h2 className="card__title">Accounts</h2></div>
          {loading ? (
            <div className="card__body"><p className="text-muted">Loading…</p></div>
          ) : !accounts.length ? (
            <div className="card__body">
              <div className="table-empty">
                <div className="table-empty__title">No bank accounts</div>
                <div>Ask an administrator to set one up.</div>
              </div>
            </div>
          ) : (
            <ul>
              {accounts.map((a) => (
                <li key={a.id}>
                  <button
                    className={`panel-row__head ${selected?.id === a.id ? 'active' : ''}`}
                    style={{ background: selected?.id === a.id ? 'var(--accent-soft)' : '' }}
                    onClick={() => setSelected(a)}
                  >
                    <div className="panel-row__title">
                      <i className={`bi ${a.account_type === 'MPESA' ? 'bi-phone' : a.account_type === 'CASH' ? 'bi-cash' : 'bi-bank'}`} />
                      <span>{a.name}</span>
                    </div>
                    <span className="badge">{a.currency}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="stack">
          {selected && (
            <div className="card">
              <div className="card__header">
                <h2 className="card__title">{selected.name}</h2>
                <span className="badge">{selected.account_type}</span>
              </div>
              <div className="card__body">
                <div className="kv">
                  <div className="kv__item"><div className="kv__label">Book balance (today)</div><div className="kv__value">{balance ? fmtMoney(balance.book_balance, balance.currency) : '—'}</div></div>
                  <div className="kv__item"><div className="kv__label">Bank</div><div className="kv__value">{selected.bank_name || '—'}</div></div>
                  <div className="kv__item"><div className="kv__label">Account number</div><div className="kv__value mono">{selected.account_number || '—'}</div></div>
                  <div className="kv__item"><div className="kv__label">GL account</div><div className="kv__value">{selected.gl_account_label || selected.gl_account}</div></div>
                </div>
              </div>
            </div>
          )}

          {selected && (
            <>
              <div className="tabs">
                <button className={`tab ${tab === 'transactions' ? 'active' : ''}`} onClick={() => setTab('transactions')}>
                  Statement lines <span className="tab__count">{transactions.length}</span>
                </button>
                <button className={`tab ${tab === 'recons' ? 'active' : ''}`} onClick={() => setTab('recons')}>
                  Reconciliations <span className="tab__count">{recons.length}</span>
                </button>
              </div>

              {tab === 'transactions' ? (
                <div className="table-card">
                  {!transactions.length ? (
                    <div className="table-empty"><div className="table-empty__title">No statement lines</div><div>Import a statement to begin.</div></div>
                  ) : (
                    <div className="table-wrap">
                      <table className="table table--compact">
                        <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="num">In</th><th className="num">Out</th><th>Status</th><th className="col-actions" /></tr></thead>
                        <tbody>
                          {transactions.map((t) => (
                            <tr key={t.id}>
                              <td>{t.txn_date}</td>
                              <td className="text-truncate" style={{ maxWidth: 260 }}>{t.description}</td>
                              <td className="mono">{t.reference || '—'}</td>
                              <td className="num">{fmtMoney(t.money_in)}</td>
                              <td className="num">{fmtMoney(t.money_out)}</td>
                              <td><span className={`status ${t.status === 'MATCHED' ? 'status-active' : t.status === 'IGNORED' ? 'status-inactive' : 'status-pending'}`}>{t.status}</span></td>
                              <td className="col-actions">
                                {t.status === 'UNMATCHED' && (
                                  <div className="row-actions">
                                    <button className="btn btn-xs" onClick={() => match(t)}>Match</button>
                                    <button className="btn btn-xs btn-ghost" onClick={() => ignore(t)}>Ignore</button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="table-card">
                  {!recons.length ? (
                    <div className="table-empty"><div className="table-empty__title">No reconciliations</div><div>Click Reconcile to add one.</div></div>
                  ) : (
                    <div className="table-wrap">
                      <table className="table table--compact">
                        <thead><tr><th>Date</th><th className="num">Statement</th><th className="num">Book</th><th className="num">Difference</th><th className="num">Unmatched</th><th>Status</th></tr></thead>
                        <tbody>
                          {recons.map((r) => (
                            <tr key={r.id}>
                              <td>{r.statement_date}</td>
                              <td className="num">{fmtMoney(r.statement_balance)}</td>
                              <td className="num">{fmtMoney(r.book_balance)}</td>
                              <td className="num">{fmtMoney(r.difference)}</td>
                              <td className="num">{r.unmatched_count}</td>
                              <td><span className={`status ${r.status === 'RECONCILED' ? 'status-active' : 'status-pending'}`}>{r.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {importing && selected && (
        <ImportModal account={selected} onClose={() => setImporting(false)} onDone={() => { setImporting(false); loadDetail(); notify('Statement imported.', 'success'); }} />
      )}
      {reconciling && selected && (
        <ReconcileModal account={selected} onClose={() => setReconciling(false)} onDone={() => { setReconciling(false); loadDetail(); notify('Reconciliation created.', 'success'); }} />
      )}
    </div>
  );
}

function ImportModal({ account, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError('');
    try {
      const res = await api.bankAccounts.importStatement(account.id, file);
      if (res.duplicates_skipped > 0) alert(`Imported ${res.imported}, skipped ${res.duplicates_skipped} duplicates.`);
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">Import statement</h2>
            <p className="modal__subtitle">CSV columns: date, description, reference, money_in, money_out, balance</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <label className="dropzone">
              <span className="dropzone__icon"><i className="bi bi-upload" /></span>
              <span className="dropzone__title">Click to choose a CSV file</span>
              <span className="dropzone__hint">Duplicate rows are automatically skipped.</span>
              <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} hidden />
            </label>
            {file && <p className="text-sm text-muted mt-2">Selected: {file.name}</p>}
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !file}>{busy ? 'Importing…' : 'Import'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReconcileModal({ account, onClose, onDone }) {
  const [form, setForm] = useState({ statement_date: new Date().toISOString().slice(0, 10), statement_balance: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.bankAccounts.reconcile(account.id, form); onDone(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">New reconciliation</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <div className="field">
                <label className="label label--required">Statement date</label>
                <input type="date" className="input" value={form.statement_date} onChange={set('statement_date')} required />
              </div>
              <div className="field">
                <label className="label label--required">Statement balance</label>
                <input type="number" step="0.01" className="input num" value={form.statement_balance} onChange={set('statement_balance')} required />
              </div>
              <div className="field">
                <label className="label">Notes</label>
                <textarea className="textarea" rows={2} value={form.notes} onChange={set('notes')} />
              </div>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Reconcile'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}