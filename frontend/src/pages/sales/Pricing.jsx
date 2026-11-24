/**
 * Pricing preview.
 * - POST /pricing/calculate/  { method, cost?, contract_price?, base_price?, premium?,
 *                               profit_per_litre?, markup_pct?, margin_pct? }
 *
 * Mirrors svc.calc_price: FIXED / MARKET / COST_PLUS (exactly one of profit/markup/margin).
 */
import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const METHODS = ['FIXED', 'MARKET', 'COST_PLUS'];
const fmt = (n) => (n == null || n === '' ? '—' : Number(n).toFixed(6));

export default function Pricing() {
  const { notify } = useApp();
  const [form, setForm] = useState({
    method: 'FIXED', cost: '', contract_price: '', base_price: '', premium: '',
    profit_per_litre: '', markup_pct: '', margin_pct: '',
  });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setResult(null);
    try {
      const body = { method: form.method };
      ['cost', 'contract_price', 'base_price', 'premium', 'profit_per_litre', 'markup_pct', 'margin_pct']
        .forEach((k) => { if (form[k] !== '') body[k] = form[k]; });
      setResult(await api.pricing.calculate(body));
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Pricing calculator</h1>
          <p className="page-header__subtitle">Preview selling price, margin and markup without saving anything</p>
        </div>
      </header>

      <div className="split">
        <div className="card">
          <div className="card__header"><h2 className="card__title">Inputs</h2></div>
          <div className="card__body">
            <form onSubmit={submit} className="form">
              <div className="field">
                <label className="label label--required">Method</label>
                <select className="select" value={form.method} onChange={set('method')}>
                  {METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select>
              </div>

              {form.method === 'FIXED' && (
                <div className="field">
                  <label className="label label--required">Contract price</label>
                  <input type="number" step="0.000001" className="input num" value={form.contract_price} onChange={set('contract_price')} required />
                </div>
              )}

              {form.method === 'MARKET' && (
                <>
                  <div className="field">
                    <label className="label label--required">Base market price</label>
                    <input type="number" step="0.000001" className="input num" value={form.base_price} onChange={set('base_price')} required />
                  </div>
                  <div className="field">
                    <label className="label">Premium / discount</label>
                    <input type="number" step="0.000001" className="input num" value={form.premium} onChange={set('premium')} />
                    <span className="field-hint">Negative = discount</span>
                  </div>
                </>
              )}

              {form.method === 'COST_PLUS' && (
                <>
                  <div className="field">
                    <label className="label label--required">Approved cost / litre</label>
                    <input type="number" step="0.000001" className="input num" value={form.cost} onChange={set('cost')} required />
                  </div>
                  <div className="field">
                    <label className="label">Profit per litre</label>
                    <input type="number" step="0.000001" className="input num" value={form.profit_per_litre} onChange={set('profit_per_litre')} />
                  </div>
                  <div className="field">
                    <label className="label">Markup % (on cost)</label>
                    <input type="number" step="0.001" className="input num" value={form.markup_pct} onChange={set('markup_pct')} />
                  </div>
                  <div className="field">
                    <label className="label">Target margin % (on price)</label>
                    <input type="number" step="0.001" className="input num" value={form.margin_pct} onChange={set('margin_pct')} />
                  </div>
                  <p className="field-hint">Provide exactly one of the three; the server rejects zero or multiple.</p>
                </>
              )}

              {error && <p className="field-error" role="alert">{error}</p>}
              <div className="form-actions">
                <button className="btn btn-primary" disabled={busy}>{busy ? 'Calculating…' : 'Calculate'}</button>
              </div>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card__header"><h2 className="card__title">Result</h2></div>
          <div className="card__body">
            {!result ? (
              <div className="table-empty">
                <div className="table-empty__title">No result yet</div>
                <div>Enter values on the left and press Calculate.</div>
              </div>
            ) : (
              <div className="kv">
                <div className="kv__item"><div className="kv__label">Method</div><div className="kv__value">{result.method}</div></div>
                <div className="kv__item"><div className="kv__label">Selling price</div><div className="kv__value">{fmt(result.selling_price)}</div></div>
                <div className="kv__item"><div className="kv__label">Cost per litre</div><div className="kv__value">{fmt(result.cost_per_litre)}</div></div>
                <div className="kv__item"><div className="kv__label">Profit per litre</div><div className="kv__value">{fmt(result.profit_per_litre)}</div></div>
                <div className="kv__item"><div className="kv__label">Markup %</div><div className="kv__value">{result.markup_pct != null ? Number(result.markup_pct).toFixed(3) : '—'}</div></div>
                <div className="kv__item"><div className="kv__label">Margin %</div><div className="kv__value">{result.margin_pct != null ? Number(result.margin_pct).toFixed(3) : '—'}</div></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}