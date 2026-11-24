/**
 * AI assistant.
 * - POST /ai/ask/                     { question, ...filters }              (read only)
 * - POST /ai/scan/                    { ...filters }                        → creates Alerts
 * - POST /ai/price-recommendation/    { company, product, target_margin_pct }
 * - GET  /ai/cash-forecast/?days=30
 * - GET  /ai/credit-risk/
 * - GET  /ai/anomalies/
 * - GET  /ai/supplier-prices/?product=
 *
 * The AI layer only reads data and creates Alerts, never approves or posts.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const TABS = [
  { key: 'ask', label: 'Ask' },
  { key: 'scan', label: 'Scan' },
  { key: 'forecast', label: 'Cash forecast' },
  { key: 'risk', label: 'Credit risk' },
  { key: 'anomalies', label: 'Anomalies' },
  { key: 'prices', label: 'Supplier prices' },
  { key: 'price-rec', label: 'Price recommendation' },
];

export default function Assistant() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [tab, setTab] = useState('ask');

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">AI assistant</h1>
          <p className="page-header__subtitle">
            Read-only insights{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ask' && <AskTab companyParams={companyParams} />}
      {tab === 'scan' && can('ai.edit') && <ScanTab companyParams={companyParams} notify={notify} />}
      {tab === 'scan' && !can('ai.edit') && <NoPerm perm="ai.edit" />}
      {tab === 'forecast' && <ForecastTab companyParams={companyParams} />}
      {tab === 'risk' && <RiskTab companyParams={companyParams} />}
      {tab === 'anomalies' && <AnomaliesTab companyParams={companyParams} />}
      {tab === 'prices' && <SupplierPricesTab companyParams={companyParams} />}
      {tab === 'price-rec' && can('ai.view') && <PriceRecTab companyParams={companyParams} notify={notify} />}
    </div>
  );
}

function NoPerm({ perm }) {
  return (
    <div className="card"><div className="card__body">
      <div className="table-empty">
        <div className="table-empty__title">No access</div>
        <div>Your role does not include <code>{perm}</code>.</div>
      </div>
    </div></div>
  );
}

function AskTab({ companyParams }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ask = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setResult(null);
    try { setResult(await api.ai.ask(question, companyParams())); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="card"><div className="card__body">
        <form onSubmit={ask} className="form">
          <div className="field">
            <label className="label label--required">Question</label>
            <textarea className="textarea" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)}
                      placeholder="e.g. what was our gross profit by product last month?" required />
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy || !question}>{busy ? 'Thinking…' : 'Ask'}</button>
          </div>
        </form>
      </div></div>
      {result && (
        <div className="card"><div className="card__header"><h2 className="card__title">Answer</h2></div><div className="card__body">
          <pre className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
        </div></div>
      )}
    </div>
  );
}

function ScanTab({ companyParams, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.ai.scan(companyParams());
      notify(`${r.alerts_created} alert(s) created.`, 'success');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="card"><div className="card__body">
      <p className="text-sm text-muted mb-3">
        Runs anomaly, duplicate, fuel, and credit-risk checks and stores the results as Alerts. It never approves or posts.
      </p>
      {error && <p className="field-error">{error}</p>}
      <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'Scanning…' : 'Run scan'}</button>
    </div></div>
  );
}

function ForecastTab({ companyParams }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');
  useEffect(() => { api.ai.cashForecast({ ...companyParams(), days }).then(setData).catch((e) => setError(errorMessage(e))); }, [companyParams, days]);
  return (
    <div className="card"><div className="card__header">
      <h2 className="card__title">Cash forecast</h2>
      <div className="btn-toolbar">
        {[30, 60, 90].map((d) => (
          <button key={d} className={`btn btn-sm ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d} days</button>
        ))}
      </div>
    </div><div className="card__body card__body--flush">
      {error ? <div className="card__body"><p className="field-error">{error}</p></div> :
        !data ? <div className="card__body"><p className="text-muted">Loading…</p></div> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead><tr>{data.columns?.map((c, i) => <th key={i} className={i > 0 ? 'num' : ''}>{c}</th>)}</tr></thead>
            <tbody>
              {data.rows?.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j} className={j > 0 ? 'num' : ''}>{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div></div>
  );
}

function RiskTab({ companyParams }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.ai.creditRisk(companyParams()).then(setData).catch((e) => setError(errorMessage(e))); }, [companyParams]);
  return (
    <div className="card"><div className="card__header"><h2 className="card__title">Customer credit risk</h2></div><div className="card__body card__body--flush">
      {error ? <div className="card__body"><p className="field-error">{error}</p></div> :
        !data ? <div className="card__body"><p className="text-muted">Loading…</p></div> :
        !data.length ? <div className="table-empty"><div className="table-empty__title">No at-risk customers</div></div> : (
          <table className="table table--compact">
            <thead><tr><th>Customer</th><th className="num">Exposure</th><th className="num">Overdue</th><th className="num">Days overdue</th><th>Note</th></tr></thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i}>
                  <td>{r.customer || r.customer_name || r.name}</td>
                  <td className="num">{r.exposure ?? '—'}</td>
                  <td className="num">{r.overdue ?? '—'}</td>
                  <td className="num">{r.days_overdue ?? '—'}</td>
                  <td className="text-sm text-muted">{r.note || r.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div></div>
  );
}

function AnomaliesTab({ companyParams }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.ai.anomalies(companyParams()).then(setData).catch((e) => setError(errorMessage(e))); }, [companyParams]);

  return (
    <div className="stack">
      {error && <div className="card"><div className="card__body"><p className="field-error">{error}</p></div></div>}
      <div className="card"><div className="card__header"><h2 className="card__title">Expense anomalies</h2></div><div className="card__body card__body--flush">
        {!data?.expense_anomalies?.length ? <div className="table-empty"><div className="table-empty__title">No anomalies</div></div> : (
          <table className="table table--compact">
            <thead><tr><th>Reference</th><th>Category</th><th className="num">Amount</th><th>Reason</th></tr></thead>
            <tbody>
              {data.expense_anomalies.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.reference || r.expense}</td>
                  <td>{r.category || '—'}</td>
                  <td className="num">{r.amount ?? '—'}</td>
                  <td className="text-sm text-muted">{r.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div></div>
      <div className="card"><div className="card__header"><h2 className="card__title">Duplicate invoices</h2></div><div className="card__body card__body--flush">
        {!data?.duplicate_invoices?.length ? <div className="table-empty"><div className="table-empty__title">No duplicates</div></div> : (
          <table className="table table--compact">
            <thead><tr><th>Reference</th><th>Supplier</th><th className="num">Amount</th><th>Matched with</th></tr></thead>
            <tbody>
              {data.duplicate_invoices.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.reference || r.invoice}</td>
                  <td>{r.supplier || '—'}</td>
                  <td className="num">{r.amount ?? '—'}</td>
                  <td className="text-sm text-muted">{r.match || r.matched || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div></div>
    </div>
  );
}

function SupplierPricesTab({ companyParams }) {
  const [product, setProduct] = useState('');
  const [products, setProducts] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api.products.listAll().then(setProducts).catch(() => {}); }, []);
  const load = useCallback(() => {
    api.ai.supplierPrices({ ...companyParams(), product }).then(setData).catch((e) => setError(errorMessage(e)));
  }, [companyParams, product]);

  return (
    <div className="stack">
      <div className="card"><div className="card__body">
        <div className="form-grid">
          <div className="field">
            <label className="label">Product</label>
            <select className="select" value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="">All products</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ alignSelf: 'end' }}>
            <button className="btn btn-primary" onClick={load}>Compare prices</button>
          </div>
        </div>
        {error && <p className="field-error mt-2">{error}</p>}
      </div></div>
      {data && (
        <div className="card"><div className="card__header"><h2 className="card__title">Comparison</h2></div><div className="card__body card__body--flush">
          {!data.length ? <div className="table-empty"><div className="table-empty__title">No data</div></div> : (
            <table className="table table--compact">
              <thead><tr><th>Supplier</th><th>Product</th><th className="num">Best price</th><th className="num">Avg</th><th>Last quote</th></tr></thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={i}>
                    <td>{r.supplier || '—'}</td>
                    <td>{r.product || '—'}</td>
                    <td className="num">{r.best_price ?? '—'}</td>
                    <td className="num">{r.average_price ?? '—'}</td>
                    <td className="text-sm text-muted">{r.last_quote || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div></div>
      )}
    </div>
  );
}

function PriceRecTab({ companyParams, notify }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ product: '', target_margin_pct: '20' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.products.listAll().then(setProducts).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setResult(null);
    try {
      const res = await api.ai.priceRecommendation({
        company: companyParams().company, product: form.product, target_margin_pct: form.target_margin_pct,
      });
      setResult(res);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="split">
      <div className="card"><div className="card__body">
        <form onSubmit={submit} className="form">
          <div className="field">
            <label className="label label--required">Product</label>
            <select className="select" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} required>
              <option value="">—</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label label--required">Target margin %</label>
            <input type="number" step="0.001" className="input num" value={form.target_margin_pct}
                   onChange={(e) => setForm({ ...form, target_margin_pct: e.target.value })} required />
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Calculating…' : 'Recommend'}</button>
          </div>
        </form>
      </div></div>
      <div className="card"><div className="card__header"><h2 className="card__title">Recommendation</h2></div><div className="card__body">
        {!result ? <div className="table-empty"><div className="table-empty__title">No result</div><div>Choose a product and target margin.</div></div> : (
          <pre className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(result, null, 2)}</pre>
        )}
      </div></div>
    </div>
  );
}