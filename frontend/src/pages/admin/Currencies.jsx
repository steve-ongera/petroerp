/**
 * Currencies + exchange rates.
 * - CRUD /currencies/       (scope=None ? global)
 * - CRUD /exchange-rates/   (global, unique (from,to,date,source))
 * Two tabs. Rates are what services.get_rate() uses; the current effective rate is
 * the latest rate_date <= on_date.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const TABS = [
  { key: 'currencies', label: 'Currencies', icon: 'bi-currency-exchange' },
  { key: 'rates', label: 'Exchange rates', icon: 'bi-graph-up' },
];
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Currencies() {
  const { notify } = useApp();
  const [tab, setTab] = useState('currencies');
  const [currencies, setCurrencies] = useState([]);
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [c, r] = await Promise.all([
        api.currencies.listAll({ ordering: 'code' }),
        api.exchangeRates.listAll({ ordering: '-rate_date' }),
      ]);
      setCurrencies(c); setRates(r);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const removeCurrency = async (c) => {
    if (!window.confirm(`Delete currency ${c.code}?`)) return;
    try { await api.currencies.remove(c.code); notify('Currency deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const removeRate = async (r) => {
    if (!window.confirm('Delete this rate?')) return;
    try { await api.exchangeRates.remove(r.id); notify('Rate deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const isCurrencies = tab === 'currencies';
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const src = isCurrencies ? currencies : rates;
    if (!q) return src;
    return src.filter((r) => (isCurrencies
      ? `${r.code} ${r.name}`
      : `${r.from_currency} ${r.to_currency} ${r.source}`).toLowerCase().includes(q));
  }, [isCurrencies, currencies, rates, search]);

  const switchTab = (k) => { setTab(k); setSearch(''); };

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Currencies & rates</h1>
            <p className="page-subtitle">ISO currencies and the exchange rates used across the group</p>
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({ kind: isCurrencies ? 'currency' : 'rate', row: {} })}>
            <i className="bi bi-plus-lg"></i>
            {isCurrencies ? 'New currency' : 'New rate'}
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
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => switchTab(t.key)}>
              <i className={`bi ${t.icon}`} aria-hidden="true"></i> {t.label}
              <span className="tab__count">{t.key === 'currencies' ? currencies.length : rates.length}</span>
            </button>
          ))}
        </div>

        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder={isCurrencies ? 'Search by code or name...' : 'Search by currency or source...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search"
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
            {isCurrencies ? 'Currency List' : 'Exchange Rates'}
          </span>
          <span className="chart-card__subtitle">
            {rows.length} {isCurrencies ? 'currenc' : 'rate'}{isCurrencies ? (rows.length !== 1 ? 'ies' : 'y') : (rows.length !== 1 ? 's' : '')}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={6} />
        ) : isCurrencies ? (
          <CurrenciesTable
            rows={rows}
            searching={!!search}
            onEdit={(c) => setEditing({ kind: 'currency', row: c })}
            onDelete={removeCurrency}
          />
        ) : (
          <RatesTable
            rows={rows}
            searching={!!search}
            onEdit={(r) => setEditing({ kind: 'rate', row: r })}
            onDelete={removeRate}
          />
        )}
      </section>

      {editing?.kind === 'currency' && (
        <CurrencyModal
          row={editing.row}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Currency saved.', 'success'); load(); }}
        />
      )}
      {editing?.kind === 'rate' && (
        <RateModal
          row={editing.row}
          currencies={currencies}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Rate saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function CurrenciesTable({ rows, searching, onEdit, onDelete }) {
  const { pageRows, paginationProps } = usePagination(rows);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-currency-exchange"></i>
        <h6>{searching ? 'No currencies match your search' : 'No currencies yet'}</h6>
        <p className="text-muted-soft">{searching ? 'Try a different search' : "Click 'New currency' to add the first one"}</p>
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
                <th>Code</th>
                <th>Name</th>
                <th>Symbol</th>
                <th className="text-right">Decimals</th>
                <th>Status</th>
                <th className="text-center" style={{ width: '7rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr key={c.code}>
                  <td className="cell-mono text-brand fw-600">{c.code}</td>
                  <td className="cell-name">{c.name}</td>
                  <td>{c.symbol || '—'}</td>
                  <td className="cell-num">{c.decimal_places}</td>
                  <td>
                    <span className={`status-pill ${c.is_active ? 'status-pill--success' : 'status-pill--neutral'}`}>
                      {c.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => onEdit(c)}>
                        <i className="bi bi-pencil"></i>
                      </button>
                      <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => onDelete(c)}>
                        <i className="bi bi-trash"></i>
                      </button>
                    </div>
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

function RatesTable({ rows, searching, onEdit, onDelete }) {
  const { pageRows, paginationProps } = usePagination(rows);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-graph-up"></i>
        <h6>{searching ? 'No rates match your search' : 'No exchange rates yet'}</h6>
        <p className="text-muted-soft">{searching ? 'Try a different search' : "Click 'New rate' to add one"}</p>
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
                <th>From</th>
                <th>To</th>
                <th className="text-right">Rate</th>
                <th>Date</th>
                <th>Source</th>
                <th className="text-center" style={{ width: '7rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-mono text-brand fw-600">{r.from_currency}</td>
                  <td className="cell-mono text-brand fw-600">{r.to_currency}</td>
                  <td className="cell-num">{Number(r.rate).toFixed(8)}</td>
                  <td>{r.rate_date}</td>
                  <td><span className="badge badge-neutral">{r.source}</span></td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => onEdit(r)}>
                        <i className="bi bi-pencil"></i>
                      </button>
                      <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => onDelete(r)}>
                        <i className="bi bi-trash"></i>
                      </button>
                    </div>
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

function CurrencyModal({ row, onClose, onSaved }) {
  const isNew = !row.code;
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', symbol: row.symbol || '',
    decimal_places: row.decimal_places ?? 2, is_active: row.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      isNew ? await api.currencies.create(form) : await api.currencies.update(form.code, form);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New currency' : `Edit ${form.code}`}
      subtitle="ISO currency master data"
      icon="bi-currency-exchange"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="currencyForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="currencyForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Currency Details</h6>
        <div className="form-grid">
          <Field label="ISO code" required err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} required maxLength={3} disabled={!isNew} />
          </Field>
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Symbol" err={fieldErr.symbol}>
            <input className="form-control" value={form.symbol} onChange={set('symbol')} maxLength={6} />
          </Field>
          <Field label="Decimals" err={fieldErr.decimal_places}>
            <input type="number" min={0} max={6} className="form-control num" value={form.decimal_places} onChange={set('decimal_places')} />
          </Field>
          <Field label="Status" span>
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="cur-active" checked={!!form.is_active} onChange={set('is_active')} />
              <label className="form-check-label" htmlFor="cur-active">Active</label>
            </div>
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function RateModal({ row, currencies, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    from_currency: row.from_currency || '', to_currency: row.to_currency || '',
    rate: row.rate ?? '', rate_date: row.rate_date || todayISO(), source: row.source || 'MANUAL',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      isNew ? await api.exchangeRates.create(form) : await api.exchangeRates.update(row.id, form);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  const activeCurrencies = useMemo(() => currencies.filter((c) => c.is_active !== false), [currencies]);

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New exchange rate' : 'Edit exchange rate'}
      subtitle="Used by the posting engine to convert amounts"
      icon="bi-graph-up"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="rateForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="rateForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-arrow-left-right" aria-hidden="true"></i>Rate Details</h6>
        <div className="form-grid">
          <Field label="From" required err={fieldErr.from_currency}>
            <select className="form-select" value={form.from_currency} onChange={set('from_currency')} required>
              <option value="">—</option>
              {activeCurrencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
          <Field label="To" required err={fieldErr.to_currency}>
            <select className="form-select" value={form.to_currency} onChange={set('to_currency')} required>
              <option value="">—</option>
              {activeCurrencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
          <Field label="Rate" required err={fieldErr.rate}>
            <input type="number" step="0.00000001" className="form-control num" value={form.rate} onChange={set('rate')} required />
          </Field>
          <Field label="Date" required err={fieldErr.rate_date}>
            <input type="date" className="form-control" value={form.rate_date} onChange={set('rate_date')} required />
          </Field>
          <Field label="Source" span err={fieldErr.source}>
            <input className="form-control" value={form.source} onChange={set('source')} placeholder="MANUAL / CBK / CONTRACT" />
          </Field>
        </div>
        <p className="text-muted-soft mt-3">
          1 unit of <strong>{form.from_currency || '…'}</strong> = <strong>{form.rate || '…'}</strong> {form.to_currency || '…'}.
        </p>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}