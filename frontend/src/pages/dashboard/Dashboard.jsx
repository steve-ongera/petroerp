/**
 * Dashboard.
 * Everything on this page comes from GET /dashboard/ (svc.dashboard_metrics):
 *   - 5 metric cards    <- data.cards                       (unchanged <MetricCard/> row)
 *   - combo chart       <- data.charts.revenue_trend        { labels, revenue, margin_pct }  bars + margin line
 *   - donut chart       <- data.charts.expense_analysis     [{ category, amount }]
 *                          (falls back to data.charts.shipment_status [{ status, count }])
 *   - bar chart         <- data.charts.shipment_profitability [{ shipment, contribution, margin_pct }]
 *   - financial summary <- data.summary                     [{ group, label, kind, value, share_pct }]
 * The server strips financial data for users without finance.view. The page only formats values.
 * Every figure is shown in full (no k / M abbreviations). Charts are dependency-free SVG.
 *
 * Layout (matches the design mock-up):
 *   header  : big title + subtitle | Daily/Weekly/Monthly/Annual pill + month picker
 *   row 1   : metric cards
 *   row 2   : Revenue & Margin (7 cols)      | Expense Breakdown (5 cols)
 *   row 3   : Shipment Profitability (6 cols)| Financial Summary (6 cols)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage } from '../../services/api';
import MetricCard from '../../components/MetricCard';

/* ------------------------------------------------------------------ config */
const PERIODS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'annual', label: 'Annual' },
];

// variant matches the MetricCard / .dm-card--<variant> colours in main.css
const STAT_META = {
  group_revenue: { label: 'Group revenue', kind: 'money', icon: 'bi-graph-up-arrow', variant: 'success' },
  net_profit: { label: 'Net profit', kind: 'money', icon: 'bi-piggy-bank', variant: 'primary' },
  receivables: { label: 'Receivables', kind: 'money', icon: 'bi-arrow-down-left-circle', variant: 'warning' },
  active_shipments: { label: 'Active shipments', kind: 'count', icon: 'bi-box-seam', variant: 'primary' },
  fuel_stock_litres: { label: 'Fuel in stock', kind: 'litres', icon: 'bi-fuel-pump', variant: 'success' },
  // used only to fill the row when finance cards are hidden for the user's role
  delayed_shipments: { label: 'Delayed shipments', kind: 'count', icon: 'bi-exclamation-triangle', variant: 'danger' },
  stock_in_transit_litres: { label: 'Fuel in transit', kind: 'litres', icon: 'bi-truck', variant: 'warning' },
  completed_shipments: { label: 'Completed shipments', kind: 'count', icon: 'bi-check2-circle', variant: 'success' },
  fleet_utilization_pct: { label: 'Fleet utilisation', kind: 'pct', icon: 'bi-speedometer2', variant: 'primary' },
};
const STAT_ORDER = [
  'group_revenue', 'net_profit', 'receivables', 'active_shipments', 'fuel_stock_litres',
  'delayed_shipments', 'stock_in_transit_litres', 'completed_shipments', 'fleet_utilization_pct',
];
const STAT_COUNT = 5;

const PALETTE = ['#2f6fed', '#14a38b', '#f59e0b', '#8a5cf6', '#e0524d', '#06b6d4', '#e86fa3', '#7c8b3a', '#c2703d', '#6b7a90'];
const C_BAR = '#2f6fed';
const C_MARGIN = '#f59e0b';
const C_GOOD = '#10b981';
const C_BAD = '#e0524d';

/* ------------------------------------------------------------------ formatting (full figures only) */
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const cardValue = (v) => {
  if (v == null) return null;
  if (typeof v === 'object' && 'value' in v) return v.value;
  return v;
};
const cardDelta = (v) => (v && typeof v === 'object' && 'delta' in v ? v.delta : null);

/** 1,234,567.89 (with currency prefix when given) */
function fmtMoney(n, currency = '') {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return `${currency ? `${currency} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** 1,234,567 */
function fmtNum(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString();
}
/** whole-number axis / label text: 1,234,567 */
function fmtWhole(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—';
}
function fmtStat(kind, value, currency) {
  if (value == null || value === '') return '—';
  switch (kind) {
    case 'money': return fmtMoney(value, currency);
    case 'litres': return `${fmtNum(value)} L`;
    case 'pct': return `${fmtNum(num(value))}%`;
    default: return fmtNum(value);
  }
}
const sentence = (s) => {
  const t = String(s || '').replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const truncate = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** Round axis bounds and ticks to friendly numbers. */
function niceScale(min, max, count = 4) {
  let lo = min;
  let hi = max;
  if (lo === hi) hi = lo + 1;
  const rough = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const f = rough / pow;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { lo, hi, ticks };
}

/* ------------------------------------------------------------------ month picker helpers */
const pad2 = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
/** Last day of the chosen month, capped at today (the server never reports the future). */
function monthEnd(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0);
  const today = new Date();
  return isoLocal(last > today ? today : last);
}

/* ------------------------------------------------------------------ page */
export default function Dashboard() {
  const { can, isAdmin } = useAccess();
  const { companyParams, activeCompanyObj } = useApp();
  const [period, setPeriod] = useState('monthly');
  const [month, setMonth] = useState(monthKey());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    try {
      const res = await api.dashboard.get({ period, date_to: monthEnd(month), ...companyParams() });
      if (id === reqId.current) setData(res);
    } catch (err) {
      if (id === reqId.current) setError(errorMessage(err));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [period, month, companyParams]);

  useEffect(() => { load(); }, [load]);

  const canFinance = can('finance.view');
  const cards = data?.cards || {};
  const charts = data?.charts || {};
  const currency = data?.currency || activeCompanyObj?.currency || '';
  const periodText = data?.period ? `${data.period.from} to ${data.period.to}` : '';
  const periodLabel = PERIODS.find((p) => p.key === period)?.label.toLowerCase();

  // exactly five cards, in priority order, from whatever the server sent
  const statKeys = useMemo(
    () => STAT_ORDER.filter((k) => cards[k] != null).slice(0, STAT_COUNT),
    [cards],
  );

  // combo chart
  const trend = charts.revenue_trend;
  const trendLabels = trend?.labels || [];
  const revenueSeries = useMemo(() => (trend?.revenue || []).map(num), [trend]);
  const marginSeries = useMemo(() => (trend?.margin_pct || []).map(num), [trend]);

  // donut chart
  const expenseItems = useMemo(
    () => (charts.expense_analysis || [])
      .map((e, i) => ({ label: e.category, value: num(e.amount), color: PALETTE[i % PALETTE.length] }))
      .filter((e) => e.value > 0),
    [charts.expense_analysis],
  );
  const statusItems = useMemo(
    () => (charts.shipment_status || [])
      .map((s, i) => ({ label: sentence(s.status), value: num(s.count), color: PALETTE[i % PALETTE.length] }))
      .filter((s) => s.value > 0),
    [charts.shipment_status],
  );
  const donutIsExpenses = expenseItems.length > 0;
  const donutItems = donutIsExpenses ? expenseItems : statusItems;
  const donutTotal = donutItems.reduce((a, b) => a + b.value, 0);

  // bar chart
  const profitItems = useMemo(
    () => (charts.shipment_profitability || []).map((s) => ({ label: s.shipment, value: num(s.contribution), sub: num(s.margin_pct) })),
    [charts.shipment_profitability],
  );

  // financial summary: flat rows, a thicker divider where the group changes
  const summaryRows = useMemo(() => {
    let prev = null;
    return (data?.summary || []).map((r) => {
      const startsGroup = prev !== null && r.group !== prev;
      prev = r.group;
      return { ...r, startsGroup };
    });
  }, [data]);
  const hasShare = summaryRows.some((r) => r.share_pct != null);

  const links = [
    can('procurement.view') && { to: '/procurement/purchase-orders', icon: 'bi-bag', label: 'Purchase orders' },
    can('sales.view') && { to: '/sales/orders', icon: 'bi-receipt', label: 'Sales orders' },
    can('shipments.view') && { to: '/logistics/shipments', icon: 'bi-truck', label: 'Shipments' },
    can('payments.view') && { to: '/finance/payments', icon: 'bi-cash-coin', label: 'Payments' },
    can('approvals.decide') && { to: '/approvals', icon: 'bi-check2-square', label: 'Approvals' },
    can('reports.view') && { to: '/reports', icon: 'bi-bar-chart', label: 'Reports' },
    can('ai.view') && { to: '/ai', icon: 'bi-stars', label: 'AI assistant' },
    can('audit.view') && { to: '/admin/audit', icon: 'bi-shield-check', label: 'Audit log' },
  ].filter(Boolean);

  return (
    <div className="dx">
      <style>{STYLES}</style>

      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Overview of your petroleum business performance
            {activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions dx-controls">
          <div className="dx-pills" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={period === p.key}
                className={period === p.key ? 'active' : ''}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="dx-month" title={periodText || undefined}>
            <i className="bi bi-calendar3" aria-hidden="true"></i>
            <input
              type="month"
              value={month}
              max={monthKey()}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              aria-label="Reporting month"
            />
          </label>
          <button className="dx-refresh" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh">
            <i className={`bi bi-arrow-clockwise ${loading ? 'dx-spin' : ''}`}></i>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      {data?.fx_missing?.length > 0 && (
        <div className="alert alert-warning" role="alert">
          <i className="bi bi-exclamation-triangle" aria-hidden="true"></i>
          <span style={{ flex: 1 }}>
            Some amounts are shown as zero because no exchange rate exists for: {data.fx_missing.join(', ')}.
            Add the rates under Currencies and rates.
          </span>
        </div>
      )}

      {loading && !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* ---------- Row 1: key metrics (unchanged) ---------- */}
          {statKeys.length === 0 ? (
            <div className="chart-card">
              <div className="empty-state">
                <i className="bi bi-speedometer2"></i>
                <h6>No metrics available</h6>
                <p className="text-muted-soft">The server has not returned any figures for this period</p>
              </div>
            </div>
          ) : (
            <div className="stat-grid">
              {statKeys.map((key) => {
                const meta = STAT_META[key];
                const raw = cards[key];
                const value = cardValue(raw);
                const delta = cardDelta(raw);
                const negative = meta.kind === 'money' && num(value) < 0;
                const warn = key === 'delayed_shipments' && num(value) > 0;
                const sub = delta != null
                  ? `${Number(delta) >= 0 ? '▲' : '▼'} ${Math.abs(Number(delta)).toLocaleString()} vs previous period`
                  : (meta.kind === 'money' ? `For the ${periodLabel} period` : undefined);
                return (
                  <MetricCard
                    key={key}
                    icon={meta.icon}
                    variant={negative ? 'danger' : warn ? 'danger' : meta.variant}
                    label={meta.label}
                    value={fmtStat(meta.kind, value, currency)}
                    sub={sub}
                  />
                );
              })}
            </div>
          )}
          {!canFinance && !isAdmin && (
            <p className="dx-note">Financial figures and charts are hidden for your role.</p>
          )}

          {/* ---------- Row 2: Revenue & Margin | Expense Breakdown ---------- */}
          <div className="row g-3 dx-row">
            <div className="col-12 col-lg-7">
              <ChartCard
                icon="bi-bar-chart-line-fill"
                title="Revenue & Margin"
                legend={revenueSeries.length > 0 ? [
                  { name: 'Revenue', color: C_BAR },
                  ...(marginSeries.length > 0 ? [{ name: 'Gross Margin', color: C_MARGIN }] : []),
                ] : null}
                empty={revenueSeries.length === 0}
                emptyIcon="bi-bar-chart-line"
                emptyText={canFinance ? 'No revenue recorded yet' : 'Visible to roles with finance access'}
              >
                <ComboChart
                  labels={trendLabels}
                  bars={{ name: 'Revenue', values: revenueSeries, color: C_BAR, fmt: (v) => fmtMoney(v, currency) }}
                  line={marginSeries.length > 0
                    ? { name: 'Gross margin', values: marginSeries, color: C_MARGIN, fmt: (v) => `${fmtNum(v)}%` }
                    : null}
                  fmtLeft={fmtWhole}
                  fmtRight={(v) => `${fmtWhole(v)}%`}
                />
              </ChartCard>
            </div>

            <div className="col-12 col-lg-5">
              <ChartCard
                icon={donutIsExpenses ? 'bi-pie-chart-fill' : 'bi-box-seam-fill'}
                title={donutIsExpenses ? 'Expense Breakdown' : 'Shipments by Status'}
                pill={donutItems.length > 0 ? `${donutItems.length} ${donutIsExpenses ? 'Categories' : 'Statuses'}` : null}
                empty={donutItems.length === 0}
                emptyIcon="bi-pie-chart"
                emptyText="Nothing to show for this period"
              >
                <DonutChart
                  items={donutItems}
                  fmt={donutIsExpenses ? (v) => fmtMoney(v, currency) : fmtNum}
                  centerTop="Total"
                  centerMid={donutIsExpenses ? currency : 'Shipments'}
                  centerText={donutIsExpenses ? fmtWhole(donutTotal) : fmtNum(donutTotal)}
                />
              </ChartCard>
            </div>
          </div>

          {/* ---------- Row 3: Shipment Profitability | Financial Summary ---------- */}
          <div className="row g-3 dx-row">
            <div className="col-12 col-lg-6">
              <ChartCard
                icon="bi-graph-up-arrow"
                title="Shipment Profitability"
                subtitle="Best and worst shipments by contribution"
                pill={profitItems.length > 0 ? `${profitItems.length} Shipments` : null}
                empty={profitItems.length === 0}
                emptyIcon="bi-bar-chart"
                emptyText={canFinance ? 'No costed shipments in this period' : 'Visible to roles with finance access'}
              >
                <HBarChart items={profitItems} fmt={fmtWhole} fmtFull={(v) => fmtMoney(v, currency)} />
              </ChartCard>
            </div>

            <div className="col-12 col-lg-6">
              <ChartCard
                icon="bi-calculator-fill"
                title="Financial Summary"
                subtitle="Income and expenses overview"
                empty={summaryRows.length === 0}
                emptyIcon="bi-calculator"
                emptyText={canFinance ? 'No summary for this period' : 'Visible to roles with finance access'}
                flush
              >
                <div className="table-responsive">
                  <table className="dx-summary">
                    <thead>
                      <tr>
                        <th>Measure</th>
                        <th className="dx-r">Value</th>
                        {hasShare && <th className="dx-r">Share of Revenue</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {summaryRows.map((r) => {
                        const neg = r.kind === 'money' && num(r.value) < 0;
                        return (
                          <tr key={`${r.group}-${r.label}`} className={r.startsGroup ? 'dx-gap' : ''}>
                            <td className="dx-measure">{r.label}</td>
                            <td className={`dx-r dx-val ${neg ? 'is-neg' : ''}`}>{fmtStat(r.kind, r.value, currency)}</td>
                            {hasShare && (
                              <td className="dx-r dx-val">{r.share_pct != null ? `${num(r.share_pct).toFixed(1)}%` : '—'}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
            </div>
          </div>

          {/* ---------- Quick links ---------- */}
          {links.length > 0 && (
            <>
              <div className="dx-links-title">Jump to</div>
              <div className="dx-links">
                {links.map((l) => (
                  <Link key={l.to} to={l.to} className="chart-card dx-link">
                    <span className="dx-link__icon" aria-hidden="true"><i className={`bi ${l.icon}`}></i></span>
                    <span className="dx-link__label">{l.label}</span>
                    <i className="bi bi-chevron-right dx-link__chev" aria-hidden="true"></i>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ loading skeleton */
function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="stat-grid">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="dm-card" aria-hidden="true">
            <div className="dm-card__top">
              <div className="skeleton" style={{ width: 90, height: 12 }}></div>
              <div className="skeleton" style={{ width: 30, height: 30 }}></div>
            </div>
            <div className="skeleton" style={{ width: 110, height: 24 }}></div>
          </div>
        ))}
      </div>
      <div className="row g-3 dx-row">
        <div className="col-12 col-lg-7">
          <div className="chart-card h-100">
            <div className="skeleton" style={{ width: 200, height: 18, marginBottom: 16 }}></div>
            <div className="skeleton" style={{ width: '100%', height: 260 }}></div>
          </div>
        </div>
        <div className="col-12 col-lg-5">
          <div className="chart-card h-100">
            <div className="skeleton" style={{ width: 150, height: 18, marginBottom: 16 }}></div>
            <div className="skeleton" style={{ width: '100%', height: 260 }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ chart card shell */
function ChartCard({ icon, title, subtitle, legend, pill, empty, emptyIcon, emptyText, flush, children }) {
  return (
    <div className="chart-card h-100 dx-card">
      <div className="dx-card__head">
        <span className="dx-card__tile" aria-hidden="true"><i className={`bi ${icon}`}></i></span>
        <div className="dx-card__titles">
          <div className="dx-card__title">{title}</div>
          {subtitle && <div className="dx-card__sub">{subtitle}</div>}
        </div>
        {legend && (
          <ul className="dx-legend dx-legend--head">
            {legend.map((l) => (
              <li key={l.name}><span className="dx-dot" style={{ background: l.color }} />{l.name}</li>
            ))}
          </ul>
        )}
        {pill && <span className="dx-pill-tag">{pill}</span>}
      </div>
      <div className={flush ? 'dx-card__body dx-card__body--flush' : 'dx-card__body'}>
        {empty ? (
          <div className="empty-state">
            <i className={`bi ${emptyIcon}`}></i>
            <h6>{emptyText}</h6>
          </div>
        ) : children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ combo chart: revenue bars + margin line */
function ComboChart({ labels, bars, line, fmtLeft, fmtRight }) {
  const [hover, setHover] = useState(null);
  const W = 640;
  const H = 320;
  const pl = 84;                          // room for full (unabbreviated) amounts on the left axis
  const pr = line ? 52 : 16;
  const pt = 14;
  const pb = 32;
  const iw = W - pl - pr;
  const ih = H - pt - pb;
  const n = labels.length;

  if (!n || !bars.values.length) return <div className="dx-empty">No data.</div>;

  const L = niceScale(0, Math.max(0, ...bars.values));
  const R = line ? niceScale(Math.min(0, ...line.values), Math.max(0, ...line.values)) : null;

  const band = iw / n;
  const cx = (i) => pl + band * i + band / 2;
  const yL = (v) => pt + ih - ((v - L.lo) / (L.hi - L.lo || 1)) * ih;
  const yR = (v) => pt + ih - ((v - R.lo) / (R.hi - R.lo || 1)) * ih;
  const barW = Math.min(46, band * 0.5);

  const rows = [{ ...bars, v: (i) => bars.values[i] }];
  if (line) rows.push({ ...line, v: (i) => line.values[i] });

  const tipW = 236;
  const tipH = 24 + rows.length * 17;
  const tipX = hover == null ? 0 : Math.min(Math.max(cx(hover) - tipW / 2, pl), W - pr - tipW);

  const linePts = line ? line.values.map((v, i) => [cx(i), yR(v)]) : [];

  return (
    <div className="dx-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue and gross margin" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="dx-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f6fed" />
            <stop offset="100%" stopColor="#1d4fd8" />
          </linearGradient>
        </defs>

        {L.ticks.map((t) => (
          <g key={`l${t}`}>
            <line x1={pl} x2={W - pr} y1={yL(t)} y2={yL(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.3 : 0.1} />
            <text x={pl - 10} y={yL(t) + 4} textAnchor="end" className="dx-axis">{fmtLeft(t)}</text>
          </g>
        ))}
        {R && R.ticks.map((t) => (
          <text key={`r${t}`} x={W - pr + 10} y={yR(t) + 4} textAnchor="start" className="dx-axis">{fmtRight(t)}</text>
        ))}
        {labels.map((lb, i) => (
          <text key={lb + i} x={cx(i)} y={H - 10} textAnchor="middle" className="dx-axis dx-axis--x">{lb}</text>
        ))}

        {bars.values.map((v, i) => {
          const top = yL(v);
          const h = Math.max(yL(0) - top, 0);
          return (
            <rect
              key={`b${i}`}
              x={cx(i) - barW / 2}
              y={top}
              width={barW}
              height={h}
              rx="3"
              fill="url(#dx-bar)"
              opacity={hover == null || hover === i ? 1 : 0.55}
            />
          );
        })}

        {line && linePts.length > 0 && (
          <>
            <path
              d={linePts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')}
              fill="none" stroke={line.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
            />
            {linePts.map((p, i) => (
              <circle key={`d${i}`} cx={p[0]} cy={p[1]} r={hover === i ? 5.5 : 4} fill="#fff" stroke={line.color} strokeWidth="2.25" />
            ))}
          </>
        )}

        {labels.map((lb, i) => (
          <rect
            key={`h${i}`}
            x={cx(i) - band / 2}
            y={pt}
            width={band}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            tabIndex={0}
            aria-label={`${lb}: ${rows.map((s) => `${s.name} ${s.fmt(s.v(i) ?? 0)}`).join(', ')}`}
          />
        ))}
        {hover != null && (
          <g pointerEvents="none">
            <g transform={`translate(${tipX},${pt + 2})`}>
              <rect width={tipW} height={tipH} rx="6" fill="var(--dx-tip-bg, #14202e)" opacity="0.96" />
              <text x="10" y="17" className="dx-tip-title">{labels[hover]}</text>
              {rows.map((s, k) => (
                <g key={s.name} transform={`translate(10,${36 + k * 17})`}>
                  <circle cx="4" cy="-4" r="3.5" fill={s.color} />
                  <text x="14" y="0" className="dx-tip-text">{s.name}: {s.fmt(s.v(hover) ?? 0)}</text>
                </g>
              ))}
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ donut chart */
function DonutChart({ items, fmt, centerTop, centerMid, centerText }) {
  const [active, setActive] = useState(null);
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total) return <div className="dx-empty">No data.</div>;

  const R = 68;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const a = active != null ? items[active] : null;

  return (
    <div className="dx-donut">
      <svg viewBox="0 0 200 200" role="img" aria-label="Breakdown" className="dx-donut__svg">
        <circle cx="100" cy="100" r={R} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="26" />
        {items.map((it, i) => {
          const len = (it.value / total) * C;
          const off = acc;
          acc += len;
          return (
            <circle
              key={it.label}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={it.color}
              strokeWidth={active === i ? 31 : 26}
              strokeDasharray={`${Math.max(len - (items.length > 1 ? 1.5 : 0), 0)} ${C}`}
              strokeDashoffset={-off}
              transform="rotate(-90 100 100)"
              style={{ transition: 'stroke-width .15s' }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${it.label}: ${fmt(it.value)} (${((it.value / total) * 100).toFixed(1)}%)`}</title>
            </circle>
          );
        })}
        {a ? (
          <>
            <text x="100" y="96" textAnchor="middle" className="dx-donut__mid">{truncate(a.label, 14)}</text>
            <text x="100" y="118" textAnchor="middle" className="dx-donut__value">{((a.value / total) * 100).toFixed(1)}%</text>
          </>
        ) : (
          <>
            <text x="100" y="88" textAnchor="middle" className="dx-donut__mid">{centerTop}</text>
            {centerMid && <text x="100" y="104" textAnchor="middle" className="dx-donut__mid">{centerMid}</text>}
            <text x="100" y="126" textAnchor="middle" className="dx-donut__value">{centerText}</text>
          </>
        )}
      </svg>
      <ul className="dx-donut__legend">
        {items.map((it, i) => (
          <li
            key={it.label}
            className={active === i ? 'is-active' : ''}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="dx-dot" style={{ background: it.color }} />
            <div className="dx-donut__txt">
              <div className="dx-donut__name">{it.label}</div>
              <div className="dx-donut__amt">
                <strong>{fmt(it.value)}</strong>
                <span>{((it.value / total) * 100).toFixed(1)}%</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ horizontal bar chart */
function HBarChart({ items, fmt, fmtFull }) {
  const [hover, setHover] = useState(null);
  const W = 560;
  const rowH = 42;
  const pl = 86;
  const pr = 110;                         // room for the full contribution figure after the bar
  const pt = 6;
  const pb = 6;
  const H = pt + pb + items.length * rowH;
  const vals = items.map((i) => i.value);
  const lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi === lo) hi = lo + 1;
  const iw = W - pl - pr;
  const x = (v) => pl + ((v - lo) / (hi - lo)) * iw;
  const zero = x(0);

  return (
    <div className="dx-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Contribution by shipment" onMouseLeave={() => setHover(null)}>
        <line x1={zero} x2={zero} y1={pt} y2={H - pb} stroke="currentColor" strokeOpacity="0.3" />
        {items.map((it, i) => {
          const cy = pt + i * rowH + rowH / 2;
          const x1 = Math.min(zero, x(it.value));
          const w = Math.max(Math.abs(x(it.value) - zero), 1.5);
          const neg = it.value < 0;
          return (
            <g key={it.label + i} onMouseEnter={() => setHover(i)} opacity={hover == null || hover === i ? 1 : 0.55}>
              <title>{`${it.label}: ${fmtFull(it.value)} (margin ${fmtNum(it.sub)}%)`}</title>
              <rect x="0" y={cy - rowH / 2} width={W} height={rowH} fill="transparent" />
              <text x="0" y={cy + 4} textAnchor="start" className="dx-axis dx-axis--label">{truncate(it.label, 14)}</text>
              <rect x={x1} y={cy - 10} width={w} height="20" rx="3" fill={neg ? C_BAD : C_GOOD} />
              <text x={neg ? zero + 8 : x(it.value) + 8} y={cy + 4} textAnchor="start" className="dx-axis dx-axis--strong">
                {fmt(it.value)}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="dx-legend dx-legend--foot">
        <li><span className="dx-dot" style={{ background: C_GOOD }} />Profit</li>
        <li><span className="dx-dot" style={{ background: C_BAD }} />Loss</li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ scoped styles */
const STYLES = `
.dx { --dx-radius: 14px; }
.dx .is-neg { color: ${C_BAD}; }
.dx .dx-note { margin: -4px 0 16px; font-size: 13px; opacity: .65; }
.dx .dx-empty { padding: 40px 12px; text-align: center; opacity: .65; }
.dx .dx-row { margin-top: 0; }
.dx .stat-grid { margin-bottom: 16px; }

/* ----- header typography ----- */
.dx .page-header { align-items: flex-end; margin-bottom: 20px; }
.dx .page-title { font-size: 2rem; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; margin: 0; }
.dx .page-subtitle { margin: 4px 0 0; font-size: 1rem; opacity: .65; }
.dx .dx-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.dx .dx-pills { display: inline-flex; padding: 4px; border-radius: 999px; background: var(--surface, #fff); box-shadow: 0 1px 3px rgba(15,23,42,.08); }
.dx .dx-pills button { border: 0; background: transparent; padding: 7px 16px; font-size: 13.5px; font-weight: 500; border-radius: 999px; cursor: pointer; color: inherit; transition: background .15s, color .15s; }
.dx .dx-pills button:hover:not(.active) { background: rgba(127,127,127,.1); }
.dx .dx-pills button.active { background: #1d4fd8; color: #fff; font-weight: 600; box-shadow: 0 2px 6px rgba(29,79,216,.35); }

.dx .dx-month { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: var(--surface, #fff); box-shadow: 0 1px 3px rgba(15,23,42,.08); font-size: 13.5px; font-weight: 500; cursor: pointer; }
.dx .dx-month input { border: 0; background: transparent; font: inherit; color: inherit; outline: none; cursor: pointer; padding: 0; }
.dx .dx-refresh { width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--surface, #fff); box-shadow: 0 1px 3px rgba(15,23,42,.08); cursor: pointer; color: inherit; }
.dx .dx-refresh:disabled { opacity: .6; cursor: default; }
.dx .dx-spin { display: inline-block; animation: dx-rot .9s linear infinite; }
@keyframes dx-rot { to { transform: rotate(360deg); } }

/* ----- chart card typography ----- */
.dx .dx-card { padding: 20px 22px; border-radius: var(--dx-radius); }
.dx .dx-card__head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.dx .dx-card__tile { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; flex: none; font-size: 19px; color: #1d4fd8; background: rgba(47,111,237,.12); }
.dx .dx-card__titles { min-width: 0; flex: 1; }
.dx .dx-card__title { font-size: 1.15rem; font-weight: 700; letter-spacing: -.01em; line-height: 1.25; }
.dx .dx-card__sub { font-size: 13px; opacity: .6; margin-top: 2px; }
.dx .dx-pill-tag { padding: 7px 14px; border-radius: 10px; background: rgba(127,127,127,.1); font-size: 13px; font-weight: 500; white-space: nowrap; }
.dx .dx-card__body { min-width: 0; }
.dx .dx-card__body--flush { margin: 0 -22px -20px; }

.dx .dx-legend { list-style: none; margin: 0; padding: 0; display: flex; gap: 16px; font-size: 13px; }
.dx .dx-legend li { display: flex; align-items: center; gap: 7px; }
.dx .dx-legend--head { margin-left: auto; }
.dx .dx-legend--foot { margin-top: 10px; }
.dx .dx-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; display: inline-block; }

/* ----- charts ----- */
.dx .dx-chart svg { width: 100%; height: auto; display: block; overflow: visible; }
.dx .dx-axis { font-size: 11.5px; fill: currentColor; opacity: .7; }
.dx .dx-axis--x { opacity: .8; }
.dx .dx-axis--label { font-size: 13px; font-weight: 600; opacity: 1; }
.dx .dx-axis--strong { opacity: 1; font-weight: 700; font-size: 13px; }
.dx .dx-tip-title { font-size: 12px; font-weight: 600; fill: #fff; }
.dx .dx-tip-text { font-size: 11.5px; fill: #e6edf5; }
.dx .dx-chart rect:focus { outline: none; }

.dx .dx-donut { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: center; }
.dx .dx-donut__svg { width: 190px; max-width: 100%; flex: none; }
.dx .dx-donut__mid { font-size: 12.5px; fill: currentColor; opacity: .7; }
.dx .dx-donut__value { font-size: 17px; font-weight: 700; fill: currentColor; }
.dx .dx-donut__legend { list-style: none; margin: 0; padding: 0; flex: 1; min-width: 190px; display: flex; flex-direction: column; gap: 10px; }
.dx .dx-donut__legend li { display: flex; align-items: flex-start; gap: 10px; padding: 3px 6px; border-radius: 6px; }
.dx .dx-donut__legend li.is-active { background: rgba(127,127,127,.1); }
.dx .dx-donut__legend .dx-dot { margin-top: 5px; }
.dx .dx-donut__name { font-size: 13px; line-height: 1.25; }
.dx .dx-donut__amt { display: flex; align-items: baseline; gap: 8px; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.dx .dx-donut__amt strong { font-weight: 700; }
.dx .dx-donut__amt span { opacity: .55; font-size: 12.5px; }

/* ----- financial summary ----- */
.dx .dx-summary { width: 100%; border-collapse: collapse; font-size: 14px; }
.dx .dx-summary thead th { background: rgba(47,111,237,.07); font-size: 13px; font-weight: 600; padding: 11px 22px; text-align: left; }
.dx .dx-summary td { padding: 13px 22px; border-bottom: 1px solid rgba(127,127,127,.15); }
.dx .dx-summary tbody tr:last-child td { border-bottom: 0; }
.dx .dx-summary .dx-gap td { border-top: 8px solid rgba(127,127,127,.08); }
.dx .dx-summary .dx-r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dx .dx-summary .dx-measure { font-weight: 700; }
.dx .dx-summary .dx-val { font-weight: 500; }

/* ----- quick links ----- */
.dx .dx-links-title { margin: 24px 0 10px; font-size: 13px; font-weight: 600; opacity: .7; text-transform: uppercase; letter-spacing: .04em; }
.dx .dx-links { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
.dx .dx-link { display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: inherit; transition: transform .12s, box-shadow .12s; }
.dx .dx-link:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,.08); }
.dx .dx-link__icon { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; background: rgba(47,111,237,.12); flex: none; }
.dx .dx-link__label { font-weight: 600; font-size: 14px; }
.dx .dx-link__chev { margin-left: auto; opacity: .45; }

@media (max-width: 991px) {
  .dx .page-header { align-items: flex-start; }
  .dx .dx-card__body--flush { margin: 0 -22px -20px; }
}
`;