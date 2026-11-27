/**
 * Owned fleet — vehicles.
 * - CRUD /vehicles/
 * - POST /vehicles/:id/log-expense/  (Expense + VehicleExpense in one shot)
 * - GET  /vehicles/:id/metrics/?date_from=&date_to=
 * - GET  /vehicles/:id/tracking/?shipment=   (map: route, estimated position, trip simulation)
 *
 * Map stack (all open source, no API keys):
 *   tiles    : OpenStreetMap          (fair-use tile server - fine for development / light use)
 *   routing  : OSRM public demo       (road geometry between the two places)
 *   geocoding: built-in Kenya list first, then OpenStreetMap Nominatim (cached in localStorage)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'INACTIVE'];
const OWNERSHIP = ['OWNED', 'LEASED'];
const EXPENSE_TYPES = ['FUEL', 'ALLOWANCE', 'ROAD', 'PARKING', 'REPAIR', 'TYRES', 'OTHER'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const statusPill = (s) => {
  if (s === 'AVAILABLE') return 'status-pill--success';
  if (s === 'ON_TRIP') return 'status-pill--info';
  if (s === 'MAINTENANCE') return 'status-pill--warning';
  return 'status-pill--neutral';
};

const pretty = (s) => (s ? String(s).replace(/_/g, ' ') : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDuration = (sec) => {
  if (!sec && sec !== 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const tripPill = (s) => {
  if (['DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED', 'ARRIVED'].includes(s)) return 'status-pill--success';
  if (['LOADING', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED'].includes(s)) return 'status-pill--info';
  if (['APPROVED', 'AWAITING_LOADING'].includes(s)) return 'status-pill--warning';
  return 'status-pill--neutral';
};

/* ====================================================================================
 * Map helpers
 * ==================================================================================== */

// [name, lat, lng, priority]. Priority 2 (areas/towns) beats 1 (cities), so
// "Mombasa Shanzu" resolves to Shanzu and "Nairobi Embakasi" to Embakasi. Coordinates are approximate.
// Add your own depots / weighbridges / stops here.
const PLACES = [
  ['nairobi', -1.2921, 36.8219, 1], ['mombasa', -4.0435, 39.6682, 1], ['nakuru', -0.3031, 36.0800, 1],
  ['eldoret', 0.5143, 35.2698, 1], ['kisumu', -0.0917, 34.7680, 1], ['naivasha', -0.7172, 36.4310, 1],
  ['kilifi', -3.6305, 39.8499, 1], ['voi', -3.3962, 38.5561, 1], ['busia', 0.4608, 34.1115, 1],
  ['malaba', 0.6333, 34.2833, 1],
  ['embakasi', -1.3167, 36.9000, 2], ['industrial area', -1.3100, 36.8500, 2], ['jkia', -1.3192, 36.9278, 2],
  ['athi river', -1.4500, 36.9833, 2], ['sultan hamud', -2.0167, 37.3667, 2], ['emali', -2.0833, 37.4667, 2],
  ['kibwezi', -2.4167, 37.9667, 2], ['mtito andei', -2.6900, 38.1667, 2], ['mariakani', -3.8667, 39.4667, 2],
  ['mazeras', -3.9667, 39.5500, 2], ['changamwe', -4.0167, 39.6167, 2], ['kipevu', -4.0500, 39.6400, 2],
  ['mtwapa', -3.9506, 39.7456, 2], ['shanzu', -3.9710, 39.7490, 2], ['nyali', -4.0230, 39.7170, 2],
  ['bamburi', -3.9970, 39.7240, 2], ['mtongwe', -4.0830, 39.6500, 2],
];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function lookupPlace(text) {
  const t = ` ${norm(text)} `;
  let best = null;
  PLACES.forEach(([name, lat, lng, p]) => {
    if (!t.includes(` ${name} `)) return;
    if (!best || p > best.p || (p === best.p && name.length > best.name.length)) best = { name, lat, lng, p };
  });
  return best ? { lat: best.lat, lng: best.lng, label: text } : null;
}

const GEO_KEY = 'petroerp.geocache';
const readGeoCache = () => { try { return JSON.parse(localStorage.getItem(GEO_KEY) || '{}'); } catch { return {}; } };

async function geocode(text) {
  const q = (text || '').trim();
  if (!q) return null;
  const local = lookupPlace(q);
  if (local) return local;
  const cache = readGeoCache();
  const key = norm(q);
  if (cache[key]) return cache[key];
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ke,ug,tz,cd,rw,bi,ss&q=${encodeURIComponent(q)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const arr = await res.json();
  if (!arr.length) return null;
  const hit = { lat: Number(arr[0].lat), lng: Number(arr[0].lon), label: arr[0].display_name };
  try { cache[key] = hit; localStorage.setItem(GEO_KEY, JSON.stringify(cache)); } catch { /* storage full or blocked */ }
  return hit;
}

async function osrmRoute(a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Routing service unavailable');
  const j = await res.json();
  const r = j.routes?.[0];
  if (!r) throw new Error('No road route found between these places');
  return { coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: r.distance, duration: r.duration };
}

const haversine = (a, b) => {
  const R = 6371000; const t = Math.PI / 180;
  const dLat = (b[0] - a[0]) * t; const dLng = (b[1] - a[1]) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const buildCum = (coords) => {
  const c = [0];
  for (let i = 1; i < coords.length; i += 1) c.push(c[i - 1] + haversine(coords[i - 1], coords[i]));
  return c;
};

// Point at fraction f (0..1) of the route length.
function pointAt(coords, cum, f) {
  const total = cum[cum.length - 1];
  if (!total) return { pt: coords[0], idx: 0 };
  const d = Math.min(Math.max(f, 0), 1) * total;
  let lo = 0; let hi = cum.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (d - cum[lo]) / seg;
  return { pt: [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t], idx: lo };
}

// Fraction along the route of the vertex closest to pt (and how far away it is, in metres).
function nearestFraction(coords, cum, pt) {
  let best = 0; let bd = Infinity;
  for (let i = 0; i < coords.length; i += 1) {
    const d = haversine(coords[i], pt);
    if (d < bd) { bd = d; best = i; }
  }
  return { f: cum[best] / (cum[cum.length - 1] || 1), dist: bd };
}

const IN_TRANSIT = ['DISPATCHED', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED'];
const DONE = ['ARRIVED', 'DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED'];
const SIM_SECONDS = 40; // whole route takes this long at 1x speed

/** Where is the truck? Not GPS: last matching checkpoint, else dispatch time vs expected delivery. */
function estimateProgress(shipment, timeline, route) {
  if (!shipment) return { f: 0, basis: 'No shipment selected — showing the route preview' };
  const s = shipment.status;
  if (DONE.includes(s)) return { f: 1, basis: 'Trip completed — arrived at destination' };
  if (!IN_TRANSIT.includes(s)) return { f: 0, basis: 'At origin — shipment not dispatched yet' };

  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const loc = timeline[i].location;
    const p = loc && lookupPlace(loc);
    if (p) {
      const n = nearestFraction(route.coords, route.cum, [p.lat, p.lng]);
      if (n.dist < 20000) return { f: n.f, basis: `Last reported: ${loc} · ${fmtDateTime(timeline[i].at)}` };
    }
  }

  const start = shipment.dispatched_at ? new Date(shipment.dispatched_at).getTime() : null;
  if (!start) return { f: 0.05, basis: 'Dispatched — no dispatch time recorded' };
  const exp = shipment.expected_delivery ? new Date(shipment.expected_delivery).getTime() : null;
  const end = exp && exp > start ? exp : start + route.duration * 1000;
  const f = (Date.now() - start) / (end - start);
  return { f: Math.min(Math.max(f, 0.02), 0.97), basis: 'Estimated from dispatch time and expected delivery' };
}

/* ====================================================================================
 * Page
 * ==================================================================================== */
export default function Vehicles() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [logging, setLogging] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [mapping, setMapping] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.vehicles.list({
        ...companyParams(),
        ordering: 'registration_number',
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, status]);

  useEffect(() => { load(); }, [load]);

  const showMetrics = async (v) => {
    try { setMetrics({ vehicle: v, data: await api.vehicles.metrics(v.id) }); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      {/* ---------- Page header: icon tile + title + actions ---------- */}
      <div className="page-header">
        <div className="page-header__lead">

          <div className="page-header__text">
            <h1 className="page-title">Vehicles</h1>
            <p className="page-subtitle">
              Owned and leased fleet{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('fleet.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New vehicle
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      {/* ---------- One white card: search, filters, table, pagination ---------- */}
      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by registration, make or model..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search vehicles"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          {hasActiveFilters && (
            <button className="btn btn-secondary" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="chip-row">
            {search && (
              <span className="filter-chip">
                Search: "{search}"
                <button onClick={() => setSearch('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {status && (
              <span className="filter-chip">
                Status: {status.replace('_', ' ')}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Vehicle List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} vehicle{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-truck"></i>
            <h6>{hasActiveFilters ? 'No vehicles match your search' : 'No vehicles yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New vehicle' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Registration</th>
                    <th>Make / Model</th>
                    <th>Type</th>
                    <th className="text-right">Capacity (L)</th>
                    <th>Ownership</th>
                    <th>Insurance</th>
                    <th>Inspection</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '11rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((v) => (
                    <tr key={v.id}>
                      <td className="cell-mono text-brand fw-600">{v.registration_number}</td>
                      <td className="cell-name">{v.make} {v.model}</td>
                      <td>{v.truck_type || '—'}</td>
                      <td className="cell-num">{Number(v.tank_capacity || 0).toLocaleString()}</td>
                      <td><span className="badge badge-neutral">{v.ownership}</span></td>
                      <td>{v.insurance_expiry || '—'}</td>
                      <td>{v.inspection_expiry || '—'}</td>
                      <td>
                        <span className={`status-pill ${statusPill(v.status)}`}>{v.status.replace('_', ' ')}</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-icon" title="Track on map" aria-label="Track on map" onClick={() => setMapping(v)}>
                            <i className="bi bi-geo-alt"></i>
                          </button>
                          <button className="btn btn-icon" title="Metrics" aria-label="Metrics" onClick={() => showMetrics(v)}>
                            <i className="bi bi-bar-chart"></i>
                          </button>
                          {can('fleet.edit') && (
                            <>
                              <button className="btn btn-icon" title="Log expense" aria-label="Log expense" onClick={() => setLogging(v)}>
                                <i className="bi bi-receipt"></i>
                              </button>
                              <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(v)}>
                                <i className="bi bi-pencil"></i>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && (
        <VehicleModal
          row={editing}
          companyParams={companyParams}
          activeCompanyObj={activeCompanyObj}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
      {logging && (
        <LogExpenseModal
          vehicle={logging}
          companyParams={companyParams}
          onClose={() => setLogging(null)}
          onDone={() => { setLogging(null); notify('Expense logged.', 'success'); load(); }}
        />
      )}
      {metrics && <MetricsModal vehicle={metrics.vehicle} data={metrics.data} onClose={() => setMetrics(null)} />}
      {mapping && <VehicleMapModal vehicle={mapping} onClose={() => setMapping(null)} />}
    </div>
  );
}

/* ====================================================================================
 * Map modal: route, estimated position, trip simulation
 * ==================================================================================== */
const MAP_CSS = `
.vm-overlay{position:fixed;inset:0;z-index:2000;background:rgba(17,22,51,.5);backdrop-filter:blur(3px);
  display:flex;align-items:center;justify-content:center;padding:1rem}
.vm-card{width:100%;max-width:80rem;height:min(48rem,94vh);display:flex;flex-direction:column;overflow:hidden;
  background:var(--surface,#fff);color:var(--ink-900);border-radius:var(--radius-xl);
  box-shadow:var(--shadow-xl);border:1px solid var(--border-color)}
.vm-top{flex:0 0 auto;display:flex;align-items:center;gap:.85rem;padding:1rem 1.3rem;border-bottom:1px solid var(--border-color)}
.vm-top__icon{font-size:1.6rem;color:var(--blue-600);line-height:1;flex-shrink:0}
.vm-top__text{flex:1;min-width:0}
.vm-top__title{margin:0;font-size:var(--fs-lg);font-weight:700;letter-spacing:-.01em;line-height:1.25}
.vm-top__sub{margin:.1rem 0 0;font-size:var(--fs-sm);color:var(--ink-500)}
.vm-close{width:2.1rem;height:2.1rem;border-radius:var(--radius-md);border:0;background:transparent;color:var(--ink-600);
  font-size:1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.vm-close:hover{background:var(--bg-app);color:var(--ink-900)}

.vm-main{flex:1 1 auto;min-height:0;display:flex;gap:1rem;padding:1rem 1.3rem 1.3rem}
.vm-panel{flex:0 0 21rem;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:1rem;padding-right:.25rem}
.vm-block{border:1px solid var(--border-color);border-radius:var(--radius-lg);padding:.85rem .95rem}
.vm-block__t{margin:0 0 .6rem;font-size:var(--fs-sm);font-weight:700;color:var(--ink-900)}
.vm-label{display:block;font-size:var(--fs-xs);color:var(--ink-500);margin-bottom:.2rem}
.vm-row{display:flex;gap:.5rem}
.vm-dl{display:grid;grid-template-columns:7rem minmax(0,1fr);gap:.4rem .75rem;margin:0;font-size:var(--fs-sm)}
.vm-dl dt{color:var(--ink-500);font-weight:400}
.vm-dl dd{margin:0;font-weight:500;overflow-wrap:anywhere}
.vm-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}
.vm-stat{background:var(--bg-app);border-radius:var(--radius-md);padding:.5rem .65rem}
.vm-stat__l{font-size:var(--fs-xs);color:var(--ink-500)}
.vm-stat__v{font-size:var(--fs-md);font-weight:700;line-height:1.3}
.vm-bar{height:.5rem;border-radius:999px;background:var(--bg-app);overflow:hidden;margin:.6rem 0 .3rem}
.vm-bar>span{display:block;height:100%;background:var(--blue-600)}
.vm-note{font-size:var(--fs-xs);color:var(--ink-500);line-height:1.45}
.vm-basis{font-size:var(--fs-xs);color:var(--ink-600);margin:.2rem 0 .6rem}
.vm-range{width:100%;accent-color:var(--blue-600)}

.vm-mapwrap{position:relative;flex:1 1 auto;min-width:0;border:1px solid var(--border-color);border-radius:var(--radius-lg);overflow:hidden}
.vm-map{position:absolute;inset:0;isolation:isolate}
.vm-loading{position:absolute;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;gap:.5rem;
  background:rgba(255,255,255,.65);font-size:var(--fs-sm);font-weight:600}

.vm-truck{width:2.2rem;height:2.2rem;border-radius:50%;background:var(--blue-600,#2563eb);color:#fff;
  display:flex;align-items:center;justify-content:center;font-size:1.05rem;border:3px solid #fff;
  box-shadow:0 2px 8px rgba(0,0,0,.35)}
.vm-truck.is-moving{animation:vm-pulse 1.4s ease-out infinite}
@keyframes vm-pulse{0%{box-shadow:0 0 0 0 rgba(37,99,235,.55)}100%{box-shadow:0 0 0 16px rgba(37,99,235,0)}}
.vm-pin{width:1.7rem;height:1.7rem;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;
  font-size:.85rem;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35)}
.vm-pin--a{background:#16a34a}
.vm-pin--b{background:#dc2626}

@media (max-width:860px){
  .vm-panel{flex-basis:18rem}
}
@media (max-width:700px){
  .vm-overlay{padding:0}
  .vm-card{height:100dvh;max-width:none;border-radius:0;border:0}
  .vm-main{flex-direction:column;overflow-y:auto;padding:.9rem 1rem 1rem}
  .vm-panel{flex:0 0 auto;overflow:visible;padding-right:0}
  .vm-mapwrap{flex:0 0 auto;height:65vh;order:-1}
}
`;

function VehicleMapModal({ vehicle, onClose }) {
  const [track, setTrack] = useState(null);
  const [shipmentId, setShipmentId] = useState(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null); // { type, text }
  const [progress, setProgress] = useState(0);
  const [basis, setBasis] = useState('');
  const [mode, setMode] = useState('estimate'); // estimate | simulation
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState(true);

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const progressRef = useRef(0);
  const followRef = useRef(true);
  followRef.current = follow;

  const focus = track?.shipments.find((s) => s.id === shipmentId) || null;
  const timeline = track?.timeline || [];

  /* ---- map init ---- */
  useEffect(() => {
    const map = L.map(mapEl.current, { zoomControl: true }).setView([-1.5, 37.5], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; layersRef.current = {}; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* ---- route building: geocode both ends, ask OSRM for the road path ---- */
  const buildRoute = useCallback(async (fromT, toT) => {
    setLoading(true); setNotice(null); setPlaying(false);
    try {
      const a = await geocode(fromT);
      if (!a) throw new Error(`Could not find "${fromT || 'origin'}" on the map. Type a nearby town in the From box.`);
      const b = await geocode(toT);
      if (!b) throw new Error(`Could not find "${toT || 'destination'}" on the map. Type a nearby town in the To box.`);

      let r;
      try {
        r = await osrmRoute(a, b);
      } catch (e) {
        const dist = haversine([a.lat, a.lng], [b.lat, b.lng]);
        r = { coords: [[a.lat, a.lng], [b.lat, b.lng]], distance: dist, duration: dist / (60000 / 3600), straight: true };
        setNotice({ type: 'warning', text: `${errorMessage(e)} — showing a straight line instead of the road route.` });
      }
      setRoute({ ...r, cum: buildCum(r.coords), from: a, to: b });
    } catch (e) {
      setRoute(null);
      setNotice({ type: 'danger', text: errorMessage(e) });
    } finally { setLoading(false); }
  }, []);

  /* ---- load the vehicle's shipments, then route the one in focus ---- */
  const fetchTrack = useCallback(async (sid) => {
    setLoading(true); setNotice(null); setPlaying(false);
    try {
      const t = await api.vehicles.tracking(vehicle.id, sid ? { shipment: sid } : {});
      setTrack(t);
      const f = t.shipments.find((s) => s.id === t.focus_id);
      if (!f) {
        setShipmentId(null);
        setNotice({ type: 'info', text: 'This vehicle has no shipments yet. Type a From and To place to preview a route.' });
        setLoading(false);
        return;
      }
      setShipmentId(f.id);
      const from = f.origin || f.depot || '';
      const to = f.destination || f.destination_county || '';
      setFromText(from); setToText(to);
      await buildRoute(from, to);
    } catch (e) {
      setNotice({ type: 'danger', text: errorMessage(e) });
      setLoading(false);
    }
  }, [vehicle.id, buildRoute]);

  useEffect(() => { fetchTrack(); }, [fetchTrack]);

  /* ---- move the truck + the travelled part of the line ---- */
  const paint = useCallback((f, pan = false) => {
    const ly = layersRef.current;
    if (!route || !ly.truck) return;
    const { pt, idx } = pointAt(route.coords, route.cum, f);
    ly.truck.setLatLng(pt);
    ly.done.setLatLngs([...route.coords.slice(0, idx + 1), pt]);
    const map = mapRef.current;
    if (pan && map && !map.getBounds().contains(pt)) map.panTo(pt, { animate: false });
  }, [route]);

  /* ---- draw the route whenever it changes ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.values(layersRef.current).forEach((l) => l && map.removeLayer(l));
    layersRef.current = {};
    if (!route) return;

    const full = L.polyline(route.coords, {
      color: '#94a3b8', weight: 6, opacity: 0.85, dashArray: route.straight ? '8 8' : null,
    }).addTo(map);
    const done = L.polyline([route.coords[0]], { color: '#2563eb', weight: 6 }).addTo(map);

    const pin = (p, cls, icon, label) => L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', html: `<div class="vm-pin ${cls}"><i class="bi ${icon}"></i></div>`, iconSize: [27, 27], iconAnchor: [13, 13] }),
    }).bindTooltip(esc(label)).addTo(map);
    const start = pin(route.from, 'vm-pin--a', 'bi-play-fill', `From: ${route.from.label}`);
    const end = pin(route.to, 'vm-pin--b', 'bi-flag-fill', `To: ${route.to.label}`);

    const cps = L.layerGroup();
    timeline.forEach((h) => {
      const p = h.location && lookupPlace(h.location);
      if (!p) return;
      L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#f59e0b', fillOpacity: 1 })
        .bindTooltip(`${esc(pretty(h.status))} · ${esc(h.location)}<br>${esc(fmtDateTime(h.at))}`).addTo(cps);
    });
    cps.addTo(map);

    const truck = L.marker(route.coords[0], {
      zIndexOffset: 1000,
      icon: L.divIcon({ className: '', html: '<div class="vm-truck"><i class="bi bi-truck"></i></div>', iconSize: [35, 35], iconAnchor: [17, 17] }),
    }).bindTooltip(esc(vehicle.registration_number)).addTo(map);

    layersRef.current = { full, done, start, end, cps, truck };
    map.fitBounds(full.getBounds(), { padding: [40, 40] });

    const est = estimateProgress(focus, timeline, route);
    progressRef.current = est.f;
    setProgress(est.f);
    setBasis(est.basis);
    setMode('estimate');
    paint(est.f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  /* ---- simulation loop ---- */
  useEffect(() => {
    if (!playing || !route) return undefined;
    let raf; let last = performance.now(); let lastUi = 0;
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now;
      const next = progressRef.current + (dt * speed) / SIM_SECONDS;
      if (next >= 1) {
        progressRef.current = 1; paint(1, followRef.current); setProgress(1); setPlaying(false);
        return;
      }
      progressRef.current = next;
      paint(next, followRef.current);
      if (now - lastUi > 120) { setProgress(next); lastUi = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, route, speed, paint]);

  // pulse ring on the truck only while it is moving
  useEffect(() => {
    const el = layersRef.current.truck?.getElement()?.firstChild;
    if (el) el.classList.toggle('is-moving', playing);
  }, [playing, route]);

  const startSim = () => {
    if (!route) return;
    progressRef.current = 0; setProgress(0); paint(0, true);
    setMode('simulation'); setPlaying(true);
    if (followRef.current) mapRef.current?.fitBounds(layersRef.current.full.getBounds(), { padding: [40, 40] });
  };
  const togglePlay = () => {
    if (!route) return;
    if (progressRef.current >= 1) { startSim(); return; }
    setMode('simulation'); setPlaying((p) => !p);
  };
  const backToEstimate = () => {
    if (!route) return;
    setPlaying(false);
    const est = estimateProgress(focus, timeline, route);
    progressRef.current = est.f; setProgress(est.f); setBasis(est.basis); setMode('estimate'); paint(est.f);
  };
  const scrub = (e) => {
    const f = Number(e.target.value);
    setPlaying(false); setMode('simulation');
    progressRef.current = f; setProgress(f); paint(f);
  };

  const km = route ? route.distance / 1000 : 0;
  const pct = Math.round(progress * 100);

  return (
    <div className="vm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{MAP_CSS}</style>
      <div className="vm-card" role="dialog" aria-modal="true" aria-label="Vehicle tracking">
        <div className="vm-top">
          <i className="bi bi-geo-alt vm-top__icon" aria-hidden="true"></i>
          <div className="vm-top__text">
            <h2 className="vm-top__title">Track {vehicle.registration_number}</h2>
            <p className="vm-top__sub">{vehicle.make} {vehicle.model} · route, estimated position and trip simulation</p>
          </div>
          <button className="vm-close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg"></i></button>
        </div>

        <div className="vm-main">
          <aside className="vm-panel">
            {notice && <div className={`alert alert-${notice.type} py-2 mb-0`} style={{ fontSize: 'var(--fs-xs)' }}>{notice.text}</div>}

            {/* Shipment + route inputs */}
            <div className="vm-block">
              <h3 className="vm-block__t">Shipment &amp; route</h3>
              {track?.shipments.length > 0 && (
                <div className="mb-2">
                  <label className="vm-label" htmlFor="vmShipment">Shipment</label>
                  <select
                    id="vmShipment"
                    className="form-select"
                    value={shipmentId || ''}
                    onChange={(e) => fetchTrack(Number(e.target.value))}
                  >
                    {track.shipments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.reference} · {pretty(s.status)}{s.id === track.active_id ? ' (active)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="mb-2">
                <label className="vm-label" htmlFor="vmFrom">From</label>
                <input id="vmFrom" className="form-control" value={fromText} onChange={(e) => setFromText(e.target.value)} placeholder="e.g. Nairobi Embakasi" />
              </div>
              <div className="mb-2">
                <label className="vm-label" htmlFor="vmTo">To</label>
                <input id="vmTo" className="form-control" value={toText} onChange={(e) => setToText(e.target.value)} placeholder="e.g. Mombasa Shanzu" />
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={loading || !fromText.trim() || !toText.trim()}
                onClick={() => buildRoute(fromText, toText)}
              >
                <i className="bi bi-signpost-split"></i> Update route
              </button>
            </div>

            {/* Trip facts */}
            {focus && (
              <div className="vm-block">
                <h3 className="vm-block__t">Trip details</h3>
                <dl className="vm-dl">
                  <dt>Shipment</dt><dd className="cell-mono fw-600">{focus.reference}</dd>
                  <dt>Status</dt><dd><span className={`status-pill ${tripPill(focus.status)}`}>{pretty(focus.status)}</span></dd>
                  <dt>Driver</dt><dd>{focus.driver || '—'}</dd>
                  <dt>Customer</dt><dd>{focus.customer || '—'}</dd>
                  <dt>Product</dt><dd>{focus.product}{focus.litres ? ` · ${Number(focus.litres).toLocaleString()} L` : ''}</dd>
                  {focus.border && (<><dt>Border</dt><dd>{focus.border}</dd></>)}
                  <dt>Dispatched</dt><dd>{fmtDateTime(focus.dispatched_at)}</dd>
                  <dt>Expected</dt><dd>{fmtDateTime(focus.expected_delivery)}</dd>
                  {focus.actual_delivery && (<><dt>Delivered</dt><dd>{fmtDateTime(focus.actual_delivery)}</dd></>)}
                </dl>
              </div>
            )}

            {/* Position + simulation */}
            {route && (
              <div className="vm-block">
                <h3 className="vm-block__t">Position &amp; simulation</h3>
                <div className="vm-stats">
                  <div className="vm-stat"><div className="vm-stat__l">Route distance</div><div className="vm-stat__v">{km.toFixed(0)} km</div></div>
                  <div className="vm-stat"><div className="vm-stat__l">Driving time</div><div className="vm-stat__v">{fmtDuration(route.duration)}</div></div>
                  <div className="vm-stat"><div className="vm-stat__l">Covered</div><div className="vm-stat__v">{(km * progress).toFixed(0)} km</div></div>
                  <div className="vm-stat"><div className="vm-stat__l">Remaining</div><div className="vm-stat__v">{(km * (1 - progress)).toFixed(0)} km</div></div>
                </div>
                <div className="vm-bar"><span style={{ width: `${pct}%` }}></span></div>
                <div className="vm-basis">
                  <strong>{pct}%</strong> ·{' '}
                  {mode === 'estimate' ? `${basis} (not live GPS)` : 'Simulation — not a live position'}
                </div>

                <input type="range" className="vm-range" min="0" max="1" step="0.001" value={progress} onChange={scrub} aria-label="Trip progress" />

                <div className="vm-row mt-2 mb-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={togglePlay}>
                    <i className={`bi ${playing ? 'bi-pause-fill' : 'bi-play-fill'}`}></i> {playing ? 'Pause' : 'Simulate trip'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={startSim}>
                    <i className="bi bi-arrow-counterclockwise"></i> Restart
                  </button>
                  {mode === 'simulation' && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={backToEstimate}>Live estimate</button>
                  )}
                </div>

                <div className="vm-row" style={{ alignItems: 'center' }}>
                  <label className="vm-label mb-0" htmlFor="vmSpeed">Speed</label>
                  <select id="vmSpeed" className="form-select" style={{ maxWidth: '6rem' }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    {[0.5, 1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}x</option>)}
                  </select>
                  <label className="vm-note" style={{ display: 'flex', alignItems: 'center', gap: '.35rem', marginLeft: 'auto' }}>
                    <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow truck
                  </label>
                </div>
              </div>
            )}

            <p className="vm-note">
              No GPS tracker is connected. The truck position is estimated from the latest status-update location that matches a known place,
              otherwise from dispatch time and expected delivery. Orange dots are status-update checkpoints.
            </p>
          </aside>

          <div className="vm-mapwrap">
            <div ref={mapEl} className="vm-map"></div>
            {loading && (
              <div className="vm-loading"><span className="spinner-border spinner-border-sm"></span> Loading map…</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================================
 * Add / edit vehicle
 * ==================================================================================== */
function VehicleModal({ row, companyParams, activeCompanyObj, onClose, onSaved }) {
  const isNew = !row.id;
  const app = useApp();
  const auth = useAuth();

  // Company that this vehicle belongs to: existing row -> active company -> ?company= param.
  const knownCompany = row.company || activeCompanyObj?.id || companyParams()?.company || '';
  // Only when no company can be determined do we ask the user to pick one.
  const companyOptions = app.companies || auth.user?.companies || [];

  const [form, setForm] = useState({
    company: knownCompany ? String(knownCompany) : '',
    code: row.code || '',
    registration_number: row.registration_number || '', make: row.make || '', model: row.model || '',
    truck_type: row.truck_type || '', tank_capacity: row.tank_capacity ?? '',
    compartments: JSON.stringify(row.compartments || []),
    ownership: row.ownership || 'OWNED', purchase_value: row.purchase_value ?? '',
    purchase_date: row.purchase_date || '', insurance_expiry: row.insurance_expiry || '',
    inspection_expiry: row.inspection_expiry || '', fuel_norm_km_per_litre: row.fuel_norm_km_per_litre ?? '',
    odometer_km: row.odometer_km ?? '', status: row.status || 'AVAILABLE',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});

    if (!form.company) {
      setFieldErr({ company: 'Select a company.' });
      setError('Select a company for this vehicle.');
      return;
    }

    setBusy(true);
    try {
      const body = { ...form, company: Number(form.company) };

      // `code` is required by the unique (company, code) rule; blank lets the server auto-generate VEH-xxxxx.
      body.code = (form.code || '').trim();

      try { body.compartments = JSON.parse(form.compartments || '[]'); } catch { delete body.compartments; }

      // Nullable columns -> null when empty
      ['purchase_date', 'insurance_expiry', 'inspection_expiry', 'fuel_norm_km_per_litre']
        .forEach((k) => { if (!body[k]) body[k] = null; });

      // NOT-nullable numeric columns -> 0 when empty
      ['purchase_value', 'tank_capacity', 'odometer_km']
        .forEach((k) => { if (body[k] === '' || body[k] == null) body[k] = 0; });

      isNew ? await api.vehicles.create(body) : await api.vehicles.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New vehicle' : `Edit ${row.registration_number}`}
      subtitle="Owned and leased fleet"
      icon="bi-truck"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="vehicleForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="vehicleForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Vehicle Details</h6>
        <div className="form-grid">
          {/* Shown only when the page has no single active company */}
          {!knownCompany && (
            <Field label="Company" required err={fieldErr.company}>
              <select className="form-select" value={form.company} onChange={set('company')} required>
                <option value="">Select company...</option>
                {companyOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.code ? `${c.code} — ` : ''}{c.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Code" err={fieldErr.code}>
            <input
              className="form-control font-mono"
              value={form.code}
              onChange={set('code')}
              placeholder="Auto-generated if empty"
            />
          </Field>
          <Field label="Registration" required err={fieldErr.registration_number}>
            <input className="form-control font-mono" value={form.registration_number} onChange={set('registration_number')} required />
          </Field>
          <Field label="Make"><input className="form-control" value={form.make} onChange={set('make')} /></Field>
          <Field label="Model"><input className="form-control" value={form.model} onChange={set('model')} /></Field>
          <Field label="Truck type"><input className="form-control" value={form.truck_type} onChange={set('truck_type')} /></Field>
          <Field label="Capacity (L)" err={fieldErr.tank_capacity}>
            <input type="number" step="0.001" className="form-control num" value={form.tank_capacity} onChange={set('tank_capacity')} />
          </Field>
          <Field label="Compartments (JSON array)">
            <input className="form-control font-mono" value={form.compartments} onChange={set('compartments')} />
          </Field>
          <Field label="Ownership">
            <select className="form-select" value={form.ownership} onChange={set('ownership')}>
              {OWNERSHIP.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="form-select" value={form.status} onChange={set('status')}>
              {STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-shield-check" aria-hidden="true"></i>Purchase, Compliance & Usage</h6>
        <div className="form-grid">
          <Field label="Purchase value" err={fieldErr.purchase_value}>
            <input type="number" step="0.01" className="form-control num" value={form.purchase_value} onChange={set('purchase_value')} />
          </Field>
          <Field label="Purchase date">
            <input type="date" className="form-control" value={form.purchase_date} onChange={set('purchase_date')} />
          </Field>
          <Field label="Insurance expiry">
            <input type="date" className="form-control" value={form.insurance_expiry} onChange={set('insurance_expiry')} />
          </Field>
          <Field label="Inspection expiry">
            <input type="date" className="form-control" value={form.inspection_expiry} onChange={set('inspection_expiry')} />
          </Field>
          <Field label="Fuel norm (km/L)" err={fieldErr.fuel_norm_km_per_litre}>
            <input type="number" step="0.01" className="form-control num" value={form.fuel_norm_km_per_litre} onChange={set('fuel_norm_km_per_litre')} />
          </Field>
          <Field label="Odometer (km)" err={fieldErr.odometer_km}>
            <input type="number" step="0.001" className="form-control num" value={form.odometer_km} onChange={set('odometer_km')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function LogExpenseModal({ vehicle, companyParams, onClose, onDone }) {
  const [categories, setCategories] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [form, setForm] = useState({
    category: '', expense_type: 'FUEL', expense_date: todayISO(),
    amount: '', litres: '', odometer_km: '', payment_method: 'CASH',
    bank_account: '', receipt_no: '', description: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.expenseCategories.listAll(),
      api.bankAccounts.listAll({ ...companyParams() }),
    ]).then(([c, b]) => { setCategories(c); setBankAccounts(b); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      ['litres', 'bank_account'].forEach((k) => { if (!body[k]) delete body[k]; });
      if (body.odometer_km === '') delete body.odometer_km;
      await api.vehicles.logExpense(vehicle.id, body);
      onDone();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Log expense"
      subtitle={vehicle.registration_number}
      icon="bi-receipt"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="logExpenseForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="logExpenseForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Expense Details</h6>
        <div className="form-grid">
          <Field label="Category" required err={fieldErr.category}>
            <select className="form-select" value={form.category} onChange={set('category')} required>
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </Field>
          <Field label="Type" required>
            <select className="form-select" value={form.expense_type} onChange={set('expense_type')}>
              {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Date" required>
            <input type="date" className="form-control" value={form.expense_date} onChange={set('expense_date')} required />
          </Field>
          <Field label="Amount" required err={fieldErr.amount}>
            <input type="number" step="0.01" className="form-control num" value={form.amount} onChange={set('amount')} required />
          </Field>
          <Field label="Litres">
            <input type="number" step="0.001" className="form-control num" value={form.litres} onChange={set('litres')} />
          </Field>
          <Field label="Odometer (km)">
            <input type="number" step="0.001" className="form-control num" value={form.odometer_km} onChange={set('odometer_km')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-wallet2" aria-hidden="true"></i>Payment</h6>
        <div className="form-grid">
          <Field label="Payment method">
            <select className="form-select" value={form.payment_method} onChange={set('payment_method')}>
              {['CASH', 'BANK', 'MPESA', 'CREDIT'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          {form.payment_method !== 'CREDIT' && form.payment_method !== 'CASH' && (
            <Field label="Bank account">
              <select className="form-select" value={form.bank_account} onChange={set('bank_account')}>
                <option value="">—</option>
                {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Receipt #">
            <input className="form-control" value={form.receipt_no} onChange={set('receipt_no')} />
          </Field>
          <Field label="Description" span>
            <input className="form-control" value={form.description} onChange={set('description')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function MetricsModal({ vehicle, data, onClose }) {
  const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });
  const items = data && Object.keys(data).length ? [
    ['Trips', data.trips ?? '—'],
    ['Distance (km)', Number(data.km || 0).toLocaleString()],
    ['Operating cost', money(data.operating_cost)],
    ['Cost / km', Number(data.cost_per_km || 0).toFixed(4)],
    ['Cost / trip', Number(data.cost_per_trip || 0).toFixed(2)],
    ['Cost / delivered L', Number(data.cost_per_delivered_litre || 0).toFixed(6)],
    ['Revenue', money(data.revenue)],
    ['Profit', money(data.profit)],
  ] : [];

  return (
    <Modal
      show
      onClose={onClose}
      title={`Metrics — ${vehicle.registration_number}`}
      subtitle={`${vehicle.make} ${vehicle.model}`}
      icon="bi-bar-chart"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      {!items.length ? (
        <div className="empty-state">
          <i className="bi bi-bar-chart"></i>
          <h6>No metrics available</h6>
        </div>
      ) : (
        <div className="kv">
          {items.map(([label, value]) => (
            <div className="kv__item" key={label}>
              <div className="kv__label">{label}</div>
              <div className="kv__value">{value}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}