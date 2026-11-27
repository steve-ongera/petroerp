/**
 * Pricing preview.
 * - POST /pricing/calculate/  { method, cost?, contract_price?, base_price?, premium?,
 *                               profit_per_litre?, markup_pct?, margin_pct? }
 *
 * Mirrors svc.calc_price: FIXED / MARKET / COST_PLUS (exactly one of profit/markup/margin).
 */
import { useState } from 'react';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Field from '../../components/Field';
import { SectionHeader, SectionBody, KV, EmptyState } from '../../components/PageSection';

const METHODS = ['FIXED', 'MARKET', 'COST_PLUS'];
const fmt = (n) => (n == null || n === '' ? '—' : Number(n).toFixed(6));
const pct = (n) => (n != null ? Number(n).toFixed(3) : '—');

export default function Pricing() {
  const [form, setForm] = useState({
    method: 'FIXED', cost: '', contract_price: '', base_price: '', premium: '',
    profit_per_litre: '', markup_pct: '', margin_pct: '',
  });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({}); setResult(null);
    try {
      const body = { method: form.method };
      ['cost', 'contract_price', 'base_price', 'premium', 'profit_per_litre', 'markup_pct', 'margin_pct']
        .forEach((k) => { if (form[k] !== '') body[k] = form[k]; });
      setResult(await api.pricing.calculate(body));
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Pricing calculator</h1>
            <p className="page-subtitle">Preview selling price, margin and markup without saving anything</p>
          </div>
        </div>
      </div>

      <div className="split">
        <section className="page-card">
          <SectionHeader first icon="bi-sliders" title="Inputs" />
          <SectionBody>
            <form onSubmit={submit}>
              <div className="form-grid">
                <Field label="Method" required span>
                  <select className="form-select" value={form.method} onChange={set('method')}>
                    {METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                  </select>
                </Field>

                {form.method === 'FIXED' && (
                  <Field label="Contract price" required err={fieldErr.contract_price} span>
                    <input type="number" step="0.000001" className="form-control num" value={form.contract_price}
                           onChange={set('contract_price')} required />
                  </Field>
                )}

                {form.method === 'MARKET' && (
                  <>
                    <Field label="Base market price" required err={fieldErr.base_price} span>
                      <input type="number" step="0.000001" className="form-control num" value={form.base_price}
                             onChange={set('base_price')} required />
                    </Field>
                    <Field label="Premium / discount" err={fieldErr.premium} span>
                      <input type="number" step="0.000001" className="form-control num" value={form.premium}
                             onChange={set('premium')} />
                      <span className="text-muted-soft" style={{ fontSize: '0.75rem' }}>Negative = discount</span>
                    </Field>
                  </>
                )}

                {form.method === 'COST_PLUS' && (
                  <>
                    <Field label="Approved cost / litre" required err={fieldErr.cost} span>
                      <input type="number" step="0.000001" className="form-control num" value={form.cost}
                             onChange={set('cost')} required />
                    </Field>
                    <Field label="Profit per litre">
                      <input type="number" step="0.000001" className="form-control num" value={form.profit_per_litre}
                             onChange={set('profit_per_litre')} />
                    </Field>
                    <Field label="Markup % (on cost)">
                      <input type="number" step="0.001" className="form-control num" value={form.markup_pct}
                             onChange={set('markup_pct')} />
                    </Field>
                    <Field label="Target margin % (on price)">
                      <input type="number" step="0.001" className="form-control num" value={form.margin_pct}
                             onChange={set('margin_pct')} />
                    </Field>
                  </>
                )}
              </div>

              {form.method === 'COST_PLUS' && (
                <p className="text-muted-soft mt-3" style={{ fontSize: '0.8125rem' }}>
                  Provide exactly one of the three; the server rejects zero or multiple.
                </p>
              )}

              {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}

              <div className="mt-3">
                <button className="btn btn-primary" disabled={busy}>
                  <i className="bi bi-calculator"></i>
                  {busy ? 'Calculating...' : 'Calculate'}
                </button>
              </div>
            </form>
          </SectionBody>
        </section>

        <section className="page-card">
          <SectionHeader first icon="bi-graph-up" title="Result" />
          {!result ? (
            <EmptyState icon="bi-calculator" title="No result yet" text="Enter values on the left and press Calculate." />
          ) : (
            <SectionBody>
              <KV items={[
                ['Method', String(result.method).replace('_', ' ')],
                ['Selling price', fmt(result.selling_price)],
                ['Cost per litre', fmt(result.cost_per_litre)],
                ['Profit per litre', fmt(result.profit_per_litre)],
                ['Markup %', pct(result.markup_pct)],
                ['Margin %', pct(result.margin_pct)],
              ]} />
            </SectionBody>
          )}
        </section>
      </div>
    </div>
  );
}