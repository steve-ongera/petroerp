/**
 * Reports.
 * - GET  /reports/                 allowed reports for this user
 * - GET  /reports/<name>/          { title, columns, rows, summary? } (or with ?export=xlsx|pdf)
 * - GET  /reports/<name>/?export=xlsx   download
 *
 * Uses REPORT_GROUPS from services/api.js for the sidebar, falls back to server list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { REPORT_GROUPS, errorMessage } from '../../services/api';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtCell = (v) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return String(v);
};
const prettyName = (n) => n.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function Reports() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj } = useApp();
  const [allowed, setAllowed] = useState([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    date_from: todayISO().slice(0, 8) + '01', date_to: todayISO(),
    country: '', product: '', customer: '', shipment: '', account: '',
  });

  useEffect(() => {
    setLoadingList(true);
    api.reports.list()
      .then((r) => {
        const list = r.map((x) => x.name);
        setAllowed(list);
        if (!selected && list.length) setSelected(list[0]);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = {};
    Object.entries(REPORT_GROUPS).forEach(([group, names]) => {
      const filtered = names.filter((n) => allowed.includes(n));
      if (filtered.length) map[group] = filtered;
    });
    const unmapped = allowed.filter((n) => !Object.values(REPORT_GROUPS).flat().includes(n));
    if (unmapped.length) map['Other'] = unmapped;
    return map;
  }, [allowed]);

  const run = useCallback(async () => {
    if (!selected) return;
    setLoadingRun(true); setError(''); setData(null);
    try {
      const res = await api.reports.run(selected, { ...filters, ...companyParams() });
      setData(res);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoadingRun(false); }
  }, [selected, filters, companyParams]);

  useEffect(() => { if (selected) run(); /* eslint-disable-next-line */ }, [selected]);

  const download = async (fmt) => {
    if (!selected) return;
    try { await api.reports.download(selected, { ...filters, ...companyParams() }, fmt); }
    catch (err) { setError(errorMessage(err)); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Reports</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {allowed.length} report{allowed.length === 1 ? '' : 's'} available
          </p>
        </div>
        <div className="page-header__actions">
          {selected && (
            <>
              <button className="btn" onClick={() => download('xlsx')}>Export xlsx</button>
              <button className="btn" onClick={() => download('pdf')}>Export pdf</button>
              <button className="btn btn-primary" onClick={run} disabled={loadingRun}>{loadingRun ? 'Running…' : 'Refresh'}</button>
            </>
          )}
        </div>
      </header>

      <div className="split split--wide-right">
        <div className="card">
          <div className="card__header"><h2 className="card__title">Available</h2></div>
          <div className="card__body card__body--tight">
            {loadingList ? <p className="text-muted">Loading…</p> :
              !allowed.length ? <p className="text-muted">No reports for your role.</p> : (
              Object.entries(grouped).map(([group, names]) => (
                <div key={group} className="section">
                  <div className="sidebar__heading">{group}</div>
                  <ul className="stack-sm">
                    {names.map((n) => (
                      <li key={n}>
                        <button
                          className={`nav-sub-link ${selected === n ? 'active' : ''}`}
                          onClick={() => setSelected(n)}
                        >
                          {prettyName(n)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__header"><h2 className="card__title">Filters</h2></div>
            <div className="card__body">
              <div className="form-grid form-grid--3">
                <div className="field"><label className="label">Date from</label>
                  <input type="date" className="input" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></div>
                <div className="field"><label className="label">Date to</label>
                  <input type="date" className="input" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></div>
                <div className="field"><label className="label">Country</label>
                  <input className="input" value={filters.country} onChange={(e) => setFilters({ ...filters, country: e.target.value })} placeholder="KE / CD" /></div>
                <div className="field"><label className="label">Product ID</label>
                  <input className="input" value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })} /></div>
                <div className="field"><label className="label">Customer ID</label>
                  <input className="input" value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })} /></div>
                <div className="field"><label className="label">Shipment ID</label>
                  <input className="input" value={filters.shipment} onChange={(e) => setFilters({ ...filters, shipment: e.target.value })} /></div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={run} disabled={loadingRun || !selected}>
                  {loadingRun ? 'Running…' : 'Run report'}
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <h2 className="card__title">{data?.title || (selected ? prettyName(selected) : 'Report output')}</h2>
              {data && <span className="text-sm text-muted">{data.rows?.length || 0} row(s)</span>}
            </div>
            <div className="card__body card__body--flush">
              {error ? (
                <div className="card__body"><p className="field-error">{error}</p></div>
              ) : loadingRun ? (
                <div className="card__body"><p className="text-muted">Running…</p></div>
              ) : !data ? (
                <div className="table-empty"><div className="table-empty__title">No report selected</div>
                  <div>Pick a report on the left.</div></div>
              ) : !data.rows?.length ? (
                <div className="table-empty"><div className="table-empty__title">No data</div>
                  <div>Adjust your filters.</div></div>
              ) : (
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead>
                      <tr>{data.columns?.map((c, i) => <th key={i} className={i > 0 ? 'num' : ''}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r, i) => (
                        <tr key={i}>{r.map((v, j) => <td key={j} className={j > 0 ? 'num' : ''}>{fmtCell(v)}</td>)}</tr>
                      ))}
                    </tbody>
                    {data.summary && Object.keys(data.summary).length > 0 && (
                      <tfoot>
                        {Object.entries(data.summary).map(([k, v], i) => (
                          <tr key={i}><td colSpan={(data.columns?.length || 1) - 1}>{k}</td><td className="num">{fmtCell(v)}</td></tr>
                        ))}
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}