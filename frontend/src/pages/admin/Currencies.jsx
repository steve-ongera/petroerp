/**
 * Currencies + exchange rates.
 * - CRUD /currencies/       (scope=None → global)
 * - CRUD /exchange-rates/   (global, unique (from,to,date,source))
 * Two tabs. Rates are what services.get_rate() uses; the current effective rate is
 * the latest rate_date <= on_date.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const TABS = [
  { key: 'currencies', label: 'Currencies' },
  { key: 'rates', label: 'Exchange rates' },
];
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Currencies() {
  const { notify } = useApp();
  const [tab, setTab] = useState('currencies');
  const [currencies, setCurrencies] = useState([]);
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Currencies & rates</h1>
          <p className="page-header__subtitle">ISO currencies and the exchange rates used across the group</p>
        </div>
        <div className="page-header__actions">
          {tab === 'currencies' && (
            <button className="btn btn-primary" onClick={() => setEditing({ kind: 'currency', row: {} })}>
              <i className="bi bi-plus-lg" /> New currency
            </button>
          )}
          {tab === 'rates' && (
            <button className="btn btn-primary" onClick={() => setEditing({ kind: 'rate', row: {} })}>
              <i className="bi bi-plus-lg" /> New rate
            </button>
          )}
        </div>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            <span className="tab__count">{t.key === 'currencies' ? currencies.length : rates.length}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="card"><div className="card__body">
          <p className="field-error" role="alert">{error}</p>
          <button className="btn mt-2" onClick={load}>Try again</button>
        </div></div>
      ) : loading ? (
        <div className="state-screen">Loading…</div>
      ) : tab === 'currencies' ? (
        <div className="table-card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Code</th><th>Name</th><th>Symbol</th><th className="num">Decimals</th><th>Status</th><th className="col-actions" /></tr></thead>
              <tbody>
                {currencies.map((c) => (
                  <tr key={c.code}>
                    <td className="mono">{c.code}</td>
                    <td>{c.name}</td>
                    <td>{c.symbol || '—'}</td>
                    <td className="num">{c.decimal_places}</td>
                    <td><span className={`status ${c.is_active ? 'status-active' : 'status-inactive'}`}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Edit" onClick={() => setEditing({ kind: 'currency', row: c })}><i className="bi bi-pencil" /></button>
                        <button className="row-action row-action--danger" title="Delete" onClick={() => removeCurrency(c)}><i className="bi bi-trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>From</th><th>To</th><th className="num">Rate</th><th>Date</th><th>Source</th><th className="col-actions" /></tr></thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.from_currency}</td>
                    <td className="mono">{r.to_currency}</td>
                    <td className="num">{Number(r.rate).toFixed(8)}</td>
                    <td>{r.rate_date}</td>
                    <td><span className="badge">{r.source}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Edit" onClick={() => setEditing({ kind: 'rate', row: r })}><i className="bi bi-pencil" /></button>
                        <button className="row-action row-action--danger" title="Delete" onClick={() => removeRate(r)}><i className="bi bi-trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && editing.kind === 'currency' && (
        <CurrencyModal row={editing.row} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Currency saved.', 'success'); load(); }} />
      )}
      {editing && editing.kind === 'rate' && (
        <RateModal row={editing.row} currencies={currencies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Rate saved.', 'success'); load(); }} />
      )}
    </div>
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
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New currency' : `Edit ${form.code}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="ISO code" required err={fieldErr.code}>
                <input className="input mono" value={form.code} onChange={set('code')} required maxLength={3} disabled={!isNew} />
              </Field>
              <Field label="Name" required err={fieldErr.name}>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Symbol"><input className="input" value={form.symbol} onChange={set('symbol')} maxLength={6} /></Field>
              <Field label="Decimals">
                <input type="number" min={0} max={6} className="input" value={form.decimal_places} onChange={set('decimal_places')} />
              </Field>
              <Field label="Active" span>
                <label className="check"><input type="checkbox" checked={!!form.is_active} onChange={set('is_active')} /> Active</label>
              </Field>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New exchange rate' : 'Edit exchange rate'}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="From" required>
                <select className="select" value={form.from_currency} onChange={set('from_currency')} required>
                  <option value="">—</option>
                  {activeCurrencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="To" required>
                <select className="select" value={form.to_currency} onChange={set('to_currency')} required>
                  <option value="">—</option>
                  {activeCurrencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Rate" required err={fieldErr.rate}>
                <input type="number" step="0.00000001" className="input num" value={form.rate} onChange={set('rate')} required />
              </Field>
              <Field label="Date" required>
                <input type="date" className="input" value={form.rate_date} onChange={set('rate_date')} required />
              </Field>
              <Field label="Source" span>
                <input className="input" value={form.source} onChange={set('source')} placeholder="MANUAL / CBK / CONTRACT" />
              </Field>
            </div>
            <p className="field-hint mt-3">
              1 unit of <strong>{form.from_currency || '…'}</strong> = <strong>{form.rate || '…'}</strong> {form.to_currency || '…'}.
            </p>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, err, span, children }) {
  return (
    <div className={`field ${span ? 'span-all' : ''} ${err ? 'has-error' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}