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
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const TXN_PILL = { MATCHED: 'status-pill--success', IGNORED: 'status-pill--neutral', UNMATCHED: 'status-pill--warning' };
const accountIcon = (t) => (t === 'MPESA' ? 'bi-phone' : t === 'CASH' || t === 'PETTY' ? 'bi-cash' : 'bi-bank');

export default function Bank() {
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [recons, setRecons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('transactions');
  const [importing, setImporting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [matching, setMatching] = useState(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const a = await api.bankAccounts.listAll({ ...companyParams() });
      setAccounts(a);
      setSelected((cur) => (cur && a.some((x) => x.id === cur.id) ? cur : a[0] || null));
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const loadDetail = useCallback(async () => {
    if (!selected) { setBalance(null); setTransactions([]); setRecons([]); return; }
    setDetailLoading(true);
    try {
      const [b, t, r] = await Promise.all([
        api.bankAccounts.balance(selected.id),
        api.bankTransactions.listAll({ bank_account: selected.id, ordering: '-txn_date' }),
        api.bankReconciliations.listAll({ bank_account: selected.id, ordering: '-id' }),
      ]);
      setBalance(b); setTransactions(t); setRecons(r);
    } catch (err) { setError(errorMessage(err)); }
    finally { setDetailLoading(false); }
  }, [selected]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const autoMatch = async () => {
    try {
      const res = await api.bankAccounts.autoMatch(selected.id);
      notify(`Auto-matched ${res.matched} line(s).`, 'success');
      loadDetail();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const ignore = async (t) => {
    try { await api.bankTransactions.ignore(t.id); notify('Ignored.', 'success'); loadDetail(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-bank"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Bank & cash</h1>
            <p className="page-subtitle">
              Accounts, statement import, reconciliation{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {selected && (
            <>
              <button className="btn btn-secondary" onClick={() => setImporting(true)}>
                <i className="bi bi-upload"></i> Import statement
              </button>
              <button className="btn btn-secondary" onClick={autoMatch}>
                <i className="bi bi-magic"></i> Auto-match
              </button>
              <button className="btn btn-primary" onClick={() => setReconciling(true)}>
                <i className="bi bi-check2-square"></i> Reconcile
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={loadAccounts}>Try again</button>
        </div>
      )}

      <div className="split split--wide-right">
        {/* ---------- Accounts list ---------- */}
        <section className="page-card">
          <div className="table-wrap__header">
            <span className="panel-title"><i className="bi bi-wallet2 text-brand"></i> Accounts</span>
            <span className="chart-card__subtitle">{accounts.length}</span>
          </div>
          {loading ? (
            <TableSkeleton rows={4} columns={2} />
          ) : accounts.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-bank"></i>
              <h6>No bank accounts</h6>
              <p className="text-muted-soft">Ask an administrator to set one up</p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {accounts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(a)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '12px 16px', border: 0, borderBottom: '1px solid var(--border-color)', cursor: 'pointer',
                      background: selected?.id === a.id ? 'var(--accent-soft)' : 'transparent', textAlign: 'left',
                    }}
                  >
                    <span className="cell-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <i className={`bi ${accountIcon(a.account_type)} text-brand`}></i>
                      {a.name}
                    </span>
                    <span className="badge badge-neutral">{a.currency}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- Selected account ---------- */}
        <div>
          {selected && (
            <section className="page-card" style={{ marginBottom: 16 }}>
              <div className="table-wrap__header">
                <span className="panel-title"><i className={`bi ${accountIcon(selected.account_type)} text-brand`}></i> {selected.name}</span>
                <span className="badge badge-neutral">{selected.account_type}</span>
              </div>
              <div style={{ padding: 16 }}>
                <div className="kv">
                  <div className="kv__item"><div className="kv__label">Book balance (today)</div><div className="kv__value fw-600">{balance ? fmtMoney(balance.book_balance, balance.currency) : '—'}</div></div>
                  <div className="kv__item"><div className="kv__label">Bank</div><div className="kv__value">{selected.bank_name || '—'}</div></div>
                  <div className="kv__item"><div className="kv__label">Account number</div><div className="kv__value cell-mono">{selected.account_number || '—'}</div></div>
                  <div className="kv__item"><div className="kv__label">GL account</div><div className="kv__value">{selected.gl_account_label || selected.gl_account}</div></div>
                </div>
              </div>
            </section>
          )}

          {selected && (
            <section className="page-card">
              <div className="tabs" style={{ padding: '0 1rem' }}>
                <button className={`tab ${tab === 'transactions' ? 'active' : ''}`} onClick={() => setTab('transactions')}>
                  <i className="bi bi-list-columns-reverse" aria-hidden="true"></i> Statement lines
                  <span className="tab__count">{transactions.length}</span>
                </button>
                <button className={`tab ${tab === 'recons' ? 'active' : ''}`} onClick={() => setTab('recons')}>
                  <i className="bi bi-check2-square" aria-hidden="true"></i> Reconciliations
                  <span className="tab__count">{recons.length}</span>
                </button>
              </div>

              {detailLoading ? (
                <TableSkeleton rows={6} columns={6} />
              ) : tab === 'transactions' ? (
                <TransactionsTable key={selected.id} rows={transactions} onMatch={setMatching} onIgnore={ignore} />
              ) : (
                <ReconsTable key={selected.id} rows={recons} />
              )}
            </section>
          )}
        </div>
      </div>

      {importing && selected && (
        <ImportModal
          account={selected}
          onClose={() => setImporting(false)}
          onDone={(res) => {
            setImporting(false); loadDetail();
            notify(`Imported ${res.imported}${res.duplicates_skipped ? `, skipped ${res.duplicates_skipped} duplicate(s)` : ''}.`, 'success');
          }}
        />
      )}
      {reconciling && selected && (
        <ReconcileModal
          account={selected}
          onClose={() => setReconciling(false)}
          onDone={() => { setReconciling(false); loadDetail(); notify('Reconciliation created.', 'success'); }}
        />
      )}
      {matching && (
        <MatchModal
          txn={matching}
          onClose={() => setMatching(null)}
          onDone={() => { setMatching(null); loadDetail(); notify('Matched.', 'success'); }}
        />
      )}
    </div>
  );
}

function TransactionsTable({ rows, onMatch, onIgnore }) {
  const { pageRows, paginationProps } = usePagination(rows);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-file-earmark-spreadsheet"></i>
        <h6>No statement lines</h6>
        <p className="text-muted-soft">Import a statement to begin</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th className="text-right">In</th>
                <th className="text-right">Out</th>
                <th>Status</th>
                <th className="text-center" style={{ width: '9rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t) => (
                <tr key={t.id}>
                  <td>{t.txn_date}</td>
                  <td className="cell-name" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</td>
                  <td className="cell-mono">{t.reference || '—'}</td>
                  <td className="cell-num">{fmtMoney(t.money_in)}</td>
                  <td className="cell-num">{fmtMoney(t.money_out)}</td>
                  <td><span className={`status-pill ${TXN_PILL[t.status] || 'status-pill--neutral'}`}>{t.status}</span></td>
                  <td>
                    {t.status === 'UNMATCHED' && (
                      <div className="row-actions">
                        <button className="btn btn-sm btn-primary" onClick={() => onMatch(t)}>Match</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => onIgnore(t)}>Ignore</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination {...paginationProps} />
    </>
  );
}

function ReconsTable({ rows }) {
  const { pageRows, paginationProps } = usePagination(rows);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-check2-square"></i>
        <h6>No reconciliations</h6>
        <p className="text-muted-soft">Click Reconcile to add one</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-right">Statement</th>
                <th className="text-right">Book</th>
                <th className="text-right">Difference</th>
                <th className="text-right">Unmatched</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.statement_date}</td>
                  <td className="cell-num">{fmtMoney(r.statement_balance)}</td>
                  <td className="cell-num">{fmtMoney(r.book_balance)}</td>
                  <td className="cell-num">{fmtMoney(r.difference)}</td>
                  <td className="cell-num">{r.unmatched_count}</td>
                  <td>
                    <span className={`status-pill ${r.status === 'RECONCILED' ? 'status-pill--success' : 'status-pill--warning'}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination {...paginationProps} />
    </>
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
    try { onDone(await api.bankAccounts.importStatement(account.id, file)); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Import statement"
      subtitle="CSV columns: date, description, reference, money_in, money_out, balance"
      icon="bi-upload"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="importForm" disabled={busy || !file}>
            <i className="bi bi-upload"></i>
            {busy ? 'Importing...' : 'Import'}
          </button>
        </>
      }
    >
      <form id="importForm" onSubmit={submit}>
        <label className="dropzone">
          <span className="dropzone__icon"><i className="bi bi-upload"></i></span>
          <span className="dropzone__title">Click to choose a CSV file</span>
          <span className="dropzone__hint">Duplicate rows are skipped automatically.</span>
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} hidden />
        </label>
        {file && <p className="text-muted-soft mt-2">Selected: {file.name}</p>}
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function ReconcileModal({ account, onClose, onDone }) {
  const [form, setForm] = useState({ statement_date: new Date().toISOString().slice(0, 10), statement_balance: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try { await api.bankAccounts.reconcile(account.id, form); onDone(); }
    catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="New reconciliation"
      subtitle={account.name}
      icon="bi-check2-square"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="reconcileForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Creating...' : 'Reconcile'}
          </button>
        </>
      }
    >
      <form id="reconcileForm" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Statement date" required err={fieldErr.statement_date}>
            <input type="date" className="form-control" value={form.statement_date} onChange={set('statement_date')} required />
          </Field>
          <Field label="Statement balance" required err={fieldErr.statement_balance}>
            <input type="number" step="0.01" className="form-control num" value={form.statement_balance} onChange={set('statement_balance')} required />
          </Field>
          <Field label="Notes" span>
            <textarea className="form-control" rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function MatchModal({ txn, onClose, onDone }) {
  const [paymentId, setPaymentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.bankTransactions.match(txn.id, parseInt(paymentId, 10)); onDone(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const amount = Number(txn.money_in) ? txn.money_in : txn.money_out;

  return (
    <Modal
      show
      onClose={onClose}
      title="Match statement line"
      subtitle={`${txn.txn_date} · ${fmtMoney(amount)}`}
      icon="bi-link-45deg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="matchForm" disabled={busy || !paymentId}>
            {busy ? 'Matching...' : 'Match'}
          </button>
        </>
      }
    >
      <form id="matchForm" onSubmit={submit}>
        <div className="kv">
          <div className="kv__item"><div className="kv__label">Description</div><div className="kv__value">{txn.description || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Reference</div><div className="kv__value cell-mono">{txn.reference || '—'}</div></div>
        </div>
        <div className="form-grid mt-3">
          <Field label="Posted payment ID" required span>
            <input type="number" min={1} className="form-control num" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} required autoFocus />
          </Field>
        </div>
        <p className="text-muted-soft mt-3">
          The payment must be posted on this bank account and have exactly the same amount as the statement line.
        </p>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}