/**
 * Dashboard.
 * - Pulls everything from GET /dashboard/ (svc.dashboard_metrics).
 * - The server strips financial cards/charts for users without finance.view,
 *   so we only gate the UI (period selector, empty-state copy).
 * - Cards: { group_revenue, revenue_by_country, total_purchases, operating_expenses,
 *            gross_profit, net_profit, cash_balance, bank_balance, mpesa_balance,
 *            receivables, payables, ... } — value may be { value, delta?, currency? }.
 * - charts: { revenue_by_month: [{ label, value }], ... }
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const PERIODS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'annual', label: 'Annual' },
];

const CARD_META = {
  group_revenue: { label: 'Group revenue', money: true, icon: 'bi-graph-up-arrow' },
  revenue_by_country: { label: 'Revenue by country', money: true, icon: 'bi-globe2' },
  total_purchases: { label: 'Total purchases', money: true, icon: 'bi-bag-check' },
  operating_expenses: { label: 'Operating expenses', money: true, icon: 'bi-receipt' },
  gross_profit: { label: 'Gross profit', money: true, icon: 'bi-cash-stack' },
  net_profit: { label: 'Net profit', money: true, icon: 'bi-piggy-bank' },
  cash_balance: { label: 'Cash balance', money: true, icon: 'bi-wallet2' },
  bank_balance: { label: 'Bank balance', money: true, icon: 'bi-bank' },
  mpesa_balance: { label: 'M-Pesa balance', money: true, icon: 'bi-phone' },
  receivables: { label: 'Receivables', money: true, icon: 'bi-arrow-down-left-circle' },
  payables: { label: 'Payables', money: true, icon: 'bi-arrow-up-right-circle' },
};

const cardValue = (v) => {
  if (v == null) return null;
  if (typeof v === 'object' && 'value' in v) return v.value;
  return v;
};
const cardDelta = (v) => (v && typeof v === 'object' && 'delta' in v ? v.delta : null);

function fmtMoney(n, currency = '') {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return `${currency ? `${currency} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtNum(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString();
}

export default function Dashboard() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj } = useApp();
  const [period, setPeriod] = useState('monthly');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.dashboard.get({ period, ...companyParams() });
      setData(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [period, companyParams]);

  useEffect(() => { load(); }, [load]);

  const cards = data?.cards || {};
  const charts = data?.charts || {};
  const currencies = activeCompanyObj?.currency || '';

  // Keep card order stable; drop any we don't know about
  const orderedKeys = useMemo(
    () => Object.keys(CARD_META).filter((k) => cards[k] != null),
    [cards],
  );

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Dashboard</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? `${activeCompanyObj.name} · ${activeCompanyObj.code}` : 'All authorised legal entities'}
          </p>
        </div>
        <div className="page-header__actions">
          <div className="segmented" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={period === p.key}
                className={`segmented__btn ${period === p.key ? 'active' : ''}`}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div className="card mb-4">
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="state-screen">Loading dashboard…</div>
      ) : (
        <>
          {/* KPI cards */}
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Key figures</h2>
              <span className="section__hint">
                {can('finance.view')
                  ? 'Financial figures are shown because your role includes finance.view.'
                  : 'Financial figures are hidden for your role.'}
              </span>
            </div>
            {orderedKeys.length === 0 ? (
              <div className="card">
                <div className="card__body">
                  <div className="table-empty">
                    <div className="table-empty__title">No metrics available</div>
                    <div>The server has not returned any cards for this period.</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card-grid card-grid--4">
                {orderedKeys.map((key) => {
                  const meta = CARD_META[key];
                  const raw = cards[key];
                  const delta = cardDelta(raw);
                  const value = cardValue(raw);
                  const isMoney = meta.money;
                  return (
                    <div key={key} className="stat-card">
                      <div className="stat-card__head">
                        <div className="stat-card__label">
                          <i className={`bi ${meta.icon}`} aria-hidden="true" />
                          {meta.label}
                        </div>
                        <div className="stat-card__value-row">
                          <span className="stat-card__value">
                            {isMoney ? fmtMoney(value, currencies) : fmtNum(value)}
                          </span>
                          {delta != null && (
                            <span className={`stat-card__delta ${Number(delta) < 0 ? 'is-down' : ''}`}>
                              {Number(delta) >= 0 ? '▲' : '▼'} {Math.abs(Number(delta)).toLocaleString()}
                              <span className="stat-card__delta-note">vs prev.</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="stat-card__body">
                        <SparkBars value={value} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Charts */}
          {Object.keys(charts).length > 0 && (
            <section className="section">
              <div className="section__head">
                <h2 className="section__title">Trends</h2>
                <span className="section__hint">Charts are hidden if your role cannot see financial data.</span>
              </div>
              <div className="card-grid card-grid--2">
                {charts.revenue_by_month && (
                  <ChartCard title="Revenue by month" series={charts.revenue_by_month} money currency={currencies} />
                )}
                {charts.expenses_by_month && (
                  <ChartCard title="Expenses by month" series={charts.expenses_by_month} money currency={currencies} />
                )}
                {charts.shipments_by_status && (
                  <ChartCard title="Shipments by status" series={charts.shipments_by_status} />
                )}
                {charts.top_customers && (
                  <RankCard title="Top customers" rows={charts.top_customers} money currency={currencies} />
                )}
                {charts.top_products && (
                  <RankCard title="Top products" rows={charts.top_products} />
                )}
              </div>
            </section>
          )}

          {/* Quick links */}
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Jump to</h2>
            </div>
            <div className="card-grid card-grid--4">
              {can('procurement.view') && <QuickLink to="/procurement/purchase-orders" icon="bi-bag" label="Purchase orders" />}
              {can('sales.view') && <QuickLink to="/sales/orders" icon="bi-receipt" label="Sales orders" />}
              {can('shipments.view') && <QuickLink to="/logistics/shipments" icon="bi-truck" label="Shipments" />}
              {can('payments.view') && <QuickLink to="/finance/payments" icon="bi-cash-coin" label="Payments" />}
              {can('approvals.decide') && <QuickLink to="/approvals" icon="bi-check2-square" label="Approvals" />}
              {can('reports.view') && <QuickLink to="/reports" icon="bi-bar-chart" label="Reports" />}
              {can('ai.view') && <QuickLink to="/ai" icon="bi-stars" label="AI assistant" />}
              {can('audit.view') && <QuickLink to="/admin/audit" icon="bi-shield-check" label="Audit log" />}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

/** Very small CSS-only bar sparkline (uses .bars / .bars__bar from main.css). */
function SparkBars({ value }) {
  const n = 12;
  const seed = Math.abs(Number(value) || 1);
  const bars = Array.from({ length: n }, (_, i) => {
    const v = ((seed * (i + 1) * 9301 + 49297) % 233280) / 233280;
    return 10 + Math.round(v * 90);
  });
  return (
    <div className="bars" aria-hidden="true">
      {bars.map((h, i) => (
        <span key={i} className="bars__bar" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function ChartCard({ title, series, money, currency }) {
  const max = Math.max(...series.map((p) => Number(p.value) || 0), 1);
  return (
    <div className="card">
      <div className="card__header">
        <h3 className="card__title">{title}</h3>
      </div>
      <div className="card__body">
        <div className="bars" style={{ height: 160 }}>
          {series.map((p, i) => (
            <span
              key={i}
              className="bars__bar"
              style={{ height: `${Math.max(4, (Number(p.value) / max) * 100)}%` }}
              title={`${p.label}: ${money ? fmtMoney(p.value, currency) : fmtNum(p.value)}`}
            />
          ))}
        </div>
        <div className="chart-legend">
          {series.map((p, i) => (
            <span key={i} className="chart-legend__item">
              <span className="chart-legend__swatch" /> {p.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function RankCard({ title, rows, money, currency }) {
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  return (
    <div className="card">
      <div className="card__header"><h3 className="card__title">{title}</h3></div>
      <div className="card__body">
        <div className="rank-list">
          {rows.map((r, i) => (
            <div key={i} className="rank-item">
              <div className="rank-item__main">
                <div className="rank-item__name">{r.label}</div>
                <div className="progress" style={{ width: 140 }}>
                  <div className="progress__bar" style={{ width: `${(Number(r.value) / max) * 100}%` }} />
                </div>
              </div>
              <div className="rank-item__value">
                {money ? fmtMoney(r.value, currency) : fmtNum(r.value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuickLink({ to, icon, label }) {
  return (
    <Link to={to} className="card card--interactive" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="card__body card__body--tight d-flex items-center gap-3">
        <span className="icon-btn icon-btn--ghost" aria-hidden="true"><i className={`bi ${icon}`} /></span>
        <span className="fw-500">{label}</span>
      </div>
    </Link>
  );
}