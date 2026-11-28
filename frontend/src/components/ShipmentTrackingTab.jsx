/**
 * Shipment tracking tab - where is the truck?
 *
 * Map stack (open source, no API keys): OpenStreetMap tiles, OSRM road routing, Nominatim geocoding
 * (built-in place list first, results cached in localStorage).
 *
 * Truck position, in order of preference:
 *   1. the latest position report (typed place, map pick or phone GPS) after dispatch
 *   2. the latest status-update location that matches a known place
 *   3. an estimate from dispatch time and expected delivery
 * It is never presented as live GPS. "Simulate trip" replays the whole route.
 *
 * Uses: /shipment-positions/ (list, create). Everything else comes from the shipment and its timeline.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApp } from '../context/AppContext';
import api, { errorMessage } from '../services/api';

const DASH = '\u2014';
const IN_TRANSIT = ['DISPATCHED', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED'];
const DONE = ['ARRIVED', 'DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED'];
const REPORTABLE = ['LOADING', 'LOADED', ...IN_TRANSIT, 'ARRIVED'];
const SIM_SECONDS = 40; // whole route at 1x speed

const label = (s) => (s || '').replace(/_/g, ' ');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDT = (v) => (v ? new Date(v).toLocaleString() : DASH);
const fmtDuration = (sec) => {
  const h = Math.floor(sec / 3600); const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const rm = (map, layer) => { try { if (layer) map.removeLayer(layer); } catch { /* map already disposed */ } };

/* ---------------------------------------------------------------- places & geocoding */
// [name, lat, lng, priority]. Priority 2 (areas) beats 1 (cities), so "Mombasa Shanzu" resolves to Shanzu.
// Coordinates are approximate. Add your own depots, weighbridges and stops; anything else goes to Nominatim.
const PLACES = [
  ['nairobi', -1.2921, 36.8219, 1], ['mombasa', -4.0435, 39.6682, 1], ['nakuru', -0.3031, 36.0800, 1],
  ['eldoret', 0.5143, 35.2698, 1], ['kisumu', -0.0917, 34.7680, 1], ['naivasha', -0.7172, 36.4310, 1],
  ['kilifi', -3.6305, 39.8499, 1], ['voi', -3.3962, 38.5561, 1], ['kitale', 1.0191, 35.0020, 1],
  ['busia', 0.4608, 34.1115, 1], ['malaba', 0.6333, 34.2833, 1], ['tororo', 0.6928, 34.1810, 1],
  ['mbale', 1.0752, 34.1754, 1], ['jinja', 0.4244, 33.2041, 1], ['kampala', 0.3476, 32.5825, 1],
  ['arua', 3.0201, 30.9110, 1],
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
const missed = new Set();
let lastNet = 0;

async function geocode(text) {
  const q = (text || '').trim();
  if (!q) return null;
  const local = lookupPlace(q);
  if (local) return local;
  const key = norm(q);
  const cache = readGeoCache();
  if (cache[key]) return cache[key];
  if (missed.has(key)) return null;
  const wait = lastNet + 1100 - Date.now(); // Nominatim fair use: at most one request per second
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNet = Date.now();
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ke,ug,tz,cd,rw,bi,ss&q=${encodeURIComponent(q)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const arr = await res.json();
  if (!arr.length) { missed.add(key); return null; }
  const hit = { lat: Number(arr[0].lat), lng: Number(arr[0].lon), label: arr[0].display_name };
  try { cache[key] = hit; localStorage.setItem(GEO_KEY, JSON.stringify(cache)); } catch { /* storage full or blocked */ }
  return hit;
}

// 'simplified' keeps long corridor routes light; switch to 'full' if you self-host OSRM.
async function osrmRoute(points) {
  const path = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${path}?overview=simplified&geometries=geojson`);
  if (!res.ok) throw new Error('Routing service unavailable');
  const j = await res.json();
  const r = j.routes?.[0];
  if (!r) throw new Error('No road route found between these places');
  return { coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: r.distance, duration: r.duration };
}

/* ---------------------------------------------------------------- geometry */
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
function pointAt(coords, cum, f) {
  const total = cum[cum.length - 1];
  if (!total) return { pt: coords[0], idx: 0 };
  const d = Math.min(Math.max(f, 0), 1) * total;
  let lo = 0; let hi = cum.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const t = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return { pt: [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t], idx: lo };
}
function nearestFraction(coords, cum, pt) {
  let best = 0; let bd = Infinity;
  for (let i = 0; i < coords.length; i += 1) {
    const d = haversine(coords[i], pt);
    if (d < bd) { bd = d; best = i; }
  }
  return { f: cum[best] / (cum[cum.length - 1] || 1), dist: bd };
}

/** Where is the truck? `events` = resolved status checkpoints and position reports, oldest first. */
function estimate(shipment, events, route) {
  const s = shipment.status;
  if (DONE.includes(s)) return { f: 1, pt: null, basis: 'Trip completed \u2014 arrived at destination' };
  if (!IN_TRANSIT.includes(s)) return { f: 0, pt: null, basis: 'At origin \u2014 not dispatched yet' };

  const since = shipment.dispatched_at ? new Date(shipment.dispatched_at).getTime() - 3600000 : 0;
  const usable = events.filter((e) => new Date(e.at).getTime() >= since);
  const last = usable[usable.length - 1];
  if (last) {
    const n = nearestFraction(route.coords, route.cum, [last.lat, last.lng]);
    if (last.exact || n.dist < 30000) {
      return {
        f: n.f, pt: last.exact ? [last.lat, last.lng] : null,
        basis: `Last ${last.kind === 'report' ? 'position report' : 'status update'}: ${last.label} \u00b7 ${ago(last.at)}`,
      };
    }
  }
  const start = shipment.dispatched_at ? new Date(shipment.dispatched_at).getTime() : null;
  if (!start) return { f: 0.05, pt: null, basis: 'Dispatched \u2014 no dispatch time recorded' };
  const exp = shipment.expected_delivery ? new Date(shipment.expected_delivery).getTime() : null;
  const end = exp && exp > start ? exp : start + route.duration * 1000;
  return { f: Math.min(Math.max((Date.now() - start) / (end - start), 0.02), 0.97), pt: null, basis: 'Estimated from dispatch time and expected delivery' };
}

/* ---------------------------------------------------------------- styles */
const CSS = `
.st-wrap{display:flex;gap:1rem;padding:1rem 1.25rem 1.25rem}
.st-panel{flex:0 0 21rem;min-width:0;display:flex;flex-direction:column;gap:1rem}
.st-block{border:1px solid var(--border-color);border-radius:var(--radius-lg);padding:.85rem .95rem}
.st-block__t{margin:0 0 .6rem;font-size:var(--fs-sm);font-weight:700}
.st-label{display:block;font-size:var(--fs-xs);color:var(--ink-500);margin-bottom:.2rem}
.st-row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.st-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}
.st-stat{background:var(--bg-app);border-radius:var(--radius-md);padding:.5rem .65rem}
.st-stat__l{font-size:var(--fs-xs);color:var(--ink-500)}
.st-stat__v{font-size:var(--fs-md);font-weight:700;line-height:1.3}
.st-bar{height:.5rem;border-radius:999px;background:var(--bg-app);overflow:hidden;margin:.6rem 0 .3rem}
.st-bar>span{display:block;height:100%;background:var(--blue-600)}
.st-note{font-size:var(--fs-xs);color:var(--ink-500);line-height:1.45}
.st-basis{font-size:var(--fs-xs);color:var(--ink-600);margin:.2rem 0 .6rem}
.st-range{width:100%;accent-color:var(--blue-600)}
.st-mapwrap{position:relative;flex:1 1 auto;min-width:0;height:min(40rem,75vh);border:1px solid var(--border-color);border-radius:var(--radius-lg);overflow:hidden}
.st-map{position:absolute;inset:0;isolation:isolate}
.st-loading{position:absolute;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;gap:.5rem;background:rgba(255,255,255,.65);font-size:var(--fs-sm);font-weight:600}
.st-truck{width:2.2rem;height:2.2rem;border-radius:50%;background:var(--blue-600,#2563eb);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.05rem;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.st-truck.is-moving{animation:st-pulse 1.4s ease-out infinite}
@keyframes st-pulse{0%{box-shadow:0 0 0 0 rgba(37,99,235,.55)}100%{box-shadow:0 0 0 16px rgba(37,99,235,0)}}
.st-pin{width:1.7rem;height:1.7rem;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:.85rem;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35)}
.st-pin--a{background:#16a34a}.st-pin--b{background:#dc2626}.st-pin--v{background:#d97706}
@media (max-width:860px){.st-wrap{flex-direction:column}.st-panel{flex-basis:auto}.st-mapwrap{order:-1;height:60vh}}
`;

/* ---------------------------------------------------------------- component */
export default function ShipmentTrackingTab({ shipment, timeline = [], canEdit = false, onChanged }) {
  const { notify } = useApp();
  const [fromText, setFromText] = useState('');
  const [viaText, setViaText] = useState('');
  const [toText, setToText] = useState('');
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [positions, setPositions] = useState([]);
  const [events, setEvents] = useState([]);
  const [progress, setProgress] = useState(0);
  const [basis, setBasis] = useState('');
  const [mode, setMode] = useState('estimate'); // estimate | simulation
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ location: '', latitude: '', longitude: '', when: nowLocal(), source: 'MANUAL', notes: '' });

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const evRef = useRef(null);
  const progressRef = useRef(0);
  const followRef = useRef(true);
  const pickRef = useRef(false);
  const estRef = useRef({ f: 0, pt: null });
  followRef.current = follow;
  pickRef.current = picking;

  const vehicleName = shipment.vehicle_label || shipment.hired_truck_label || 'Truck';
  const canReport = canEdit && REPORTABLE.includes(shipment.status);
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  /* ---- map init ---- */
  useEffect(() => {
    const map = L.map(mapEl.current).setView([-1.5, 37.5], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.on('click', (e) => {
      if (!pickRef.current) return;
      setForm((f) => ({ ...f, latitude: e.latlng.lat.toFixed(6), longitude: e.latlng.lng.toFixed(6), source: 'MANUAL' }));
    });
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; layersRef.current = {}; evRef.current = null; };
  }, []);

  useEffect(() => { if (mapEl.current) mapEl.current.style.cursor = picking ? 'crosshair' : ''; }, [picking]);

  /* ---- position reports ---- */
  const loadPositions = useCallback(async () => {
    try {
      const rows = await api.shipmentPositions.listAll({ shipment: shipment.id });
      setPositions([...rows].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)));
    } catch (err) { setNotice({ type: 'warning', text: `Could not load position reports: ${errorMessage(err)}` }); }
  }, [shipment.id]);
  useEffect(() => { loadPositions(); }, [loadPositions]);

  /* ---- route: geocode the stops, ask OSRM for the road path ---- */
  const buildRoute = useCallback(async (fromT, viaT, toT) => {
    setLoading(true); setNotice(null); setPlaying(false);
    try {
      const texts = [fromT, viaT, toT].filter((t) => t && t.trim());
      if (texts.length < 2) throw new Error('Enter at least a From and a To place.');
      const pts = [];
      for (const t of texts) {
        const p = await geocode(t);
        if (!p) throw new Error(`Could not find "${t}" on the map. Try a nearby town.`);
        pts.push(p);
      }
      let r;
      try { r = await osrmRoute(pts); } catch (e) {
        let dist = 0;
        for (let i = 1; i < pts.length; i += 1) dist += haversine([pts[i - 1].lat, pts[i - 1].lng], [pts[i].lat, pts[i].lng]);
        r = { coords: pts.map((p) => [p.lat, p.lng]), distance: dist, duration: dist / (60000 / 3600), straight: true };
        setNotice({ type: 'warning', text: `${errorMessage(e)} \u2014 showing straight lines instead of the road route.` });
      }
      setRoute({ ...r, cum: buildCum(r.coords), pts });
    } catch (e) { setRoute(null); setNotice({ type: 'danger', text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const from = shipment.origin || shipment.depot_label || '';
    const via = shipment.border_crossing_label || '';
    const to = [shipment.destination, shipment.destination_county].filter(Boolean).join(', ') || shipment.delivery_address || '';
    setFromText(from); setViaText(via); setToText(to);
    buildRoute(from, via, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment.id]);

  /* ---- resolve status checkpoints and position reports to coordinates ---- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = [];
      for (const h of timeline) {
        if (!h.location) continue;
        const p = await geocode(h.location).catch(() => null);
        if (p) out.push({ key: `t${h.id}`, at: h.at, lat: p.lat, lng: p.lng, label: h.location, what: label(h.to), kind: 'status', exact: false });
      }
      for (const p of positions) {
        let lat = p.latitude != null ? Number(p.latitude) : null;
        let lng = p.longitude != null ? Number(p.longitude) : null;
        let exact = lat != null && lng != null;
        if (!exact && p.location) {
          const g = await geocode(p.location).catch(() => null);
          if (g) { lat = g.lat; lng = g.lng; }
        }
        if (lat != null && lng != null) {
          out.push({ key: `p${p.id}`, at: p.recorded_at, lat, lng, label: p.location || 'GPS position', what: `Position (${label(p.source).toLowerCase()})`, kind: 'report', exact });
        }
      }
      if (alive) setEvents(out.sort((a, b) => new Date(a.at) - new Date(b.at)));
    })();
    return () => { alive = false; };
  }, [timeline, positions]);

  /* ---- move the truck and the travelled part of the line ---- */
  const paint = useCallback((f, pan = false, exact = null) => {
    const ly = layersRef.current;
    if (!route || !ly.truck) return;
    const { pt, idx } = pointAt(route.coords, route.cum, f);
    const at = exact || pt;
    ly.truck.setLatLng(at);
    ly.done.setLatLngs([...route.coords.slice(0, idx + 1), pt]);
    const map = mapRef.current;
    if (pan && map && !map.getBounds().contains(at)) map.panTo(at, { animate: false });
  }, [route]);

  /* ---- draw the route ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.values(layersRef.current).forEach((l) => rm(map, l));
    layersRef.current = {};
    if (!route) return;

    const full = L.polyline(route.coords, { color: '#94a3b8', weight: 6, opacity: 0.85, dashArray: route.straight ? '8 8' : null }).addTo(map);
    const done = L.polyline([route.coords[0]], { color: '#2563eb', weight: 6 }).addTo(map);
    const pin = (p, cls, icon, text) => L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', html: `<div class="st-pin ${cls}"><i class="bi ${icon}"></i></div>`, iconSize: [27, 27], iconAnchor: [13, 13] }),
    }).bindTooltip(esc(text)).addTo(map);
    const last = route.pts.length - 1;
    const pins = route.pts.map((p, i) => (i === 0 ? pin(p, 'st-pin--a', 'bi-play-fill', `From: ${p.label}`)
      : i === last ? pin(p, 'st-pin--b', 'bi-flag-fill', `To: ${p.label}`)
        : pin(p, 'st-pin--v', 'bi-signpost-2-fill', `Via: ${p.label}`)));
    const truck = L.marker(route.coords[0], {
      zIndexOffset: 1000,
      icon: L.divIcon({ className: '', html: '<div class="st-truck"><i class="bi bi-truck"></i></div>', iconSize: [35, 35], iconAnchor: [17, 17] }),
    }).bindTooltip(esc(vehicleName)).addTo(map);

    layersRef.current = { full, done, truck, ...Object.fromEntries(pins.map((p, i) => [`pin${i}`, p])) };
    map.fitBounds(full.getBounds(), { padding: [40, 40] });
  }, [route, vehicleName]);

  /* ---- checkpoints (orange) and position reports (purple, dashed trail) ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    rm(map, evRef.current); evRef.current = null;
    if (!events.length) return;
    const g = L.layerGroup();
    const trail = events.filter((e) => e.exact).map((e) => [e.lat, e.lng]);
    if (trail.length > 1) L.polyline(trail, { color: '#7c3aed', weight: 3, dashArray: '4 6' }).addTo(g);
    events.forEach((e) => L.circleMarker([e.lat, e.lng], {
      radius: 6, color: '#fff', weight: 2, fillColor: e.kind === 'report' ? '#7c3aed' : '#f59e0b', fillOpacity: 1,
    }).bindTooltip(`${esc(e.what)} \u00b7 ${esc(e.label)}<br>${esc(fmtDT(e.at))}`).addTo(g));
    g.addTo(map); evRef.current = g;
  }, [events]);

  /* ---- preview of the position being entered ---- */
  useEffect(() => {
    const map = mapRef.current;
    const lat = Number(form.latitude); const lng = Number(form.longitude);
    if (!map || form.latitude === '' || form.longitude === '' || Number.isNaN(lat) || Number.isNaN(lng)) return undefined;
    const m = L.circleMarker([lat, lng], { radius: 9, color: '#fff', weight: 2, fillColor: '#7c3aed', fillOpacity: 1 }).bindTooltip('New position').addTo(map);
    return () => rm(map, m);
  }, [form.latitude, form.longitude]);

  /* ---- place the truck whenever the route, the reports or the status change ---- */
  useEffect(() => {
    if (!route) return;
    const est = estimate(shipment, events, route);
    estRef.current = est;
    progressRef.current = est.f;
    setProgress(est.f); setBasis(est.basis); setMode('estimate'); setPlaying(false);
    paint(est.f, false, est.pt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, events, shipment.status, shipment.dispatched_at, shipment.expected_delivery]);

  /* ---- simulation loop ---- */
  useEffect(() => {
    if (!playing || !route) return undefined;
    let raf; let last = performance.now(); let lastUi = 0;
    const tick = (now) => {
      const next = progressRef.current + (((now - last) / 1000) * speed) / SIM_SECONDS;
      last = now;
      if (next >= 1) { progressRef.current = 1; paint(1, followRef.current); setProgress(1); setPlaying(false); return; }
      progressRef.current = next;
      paint(next, followRef.current);
      if (now - lastUi > 120) { setProgress(next); lastUi = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, route, speed, paint]);

  useEffect(() => {
    const el = layersRef.current.truck?.getElement()?.firstChild;
    if (el) el.classList.toggle('is-moving', playing);
  }, [playing, route]);

  const startSim = () => {
    if (!route) return;
    progressRef.current = 0; setProgress(0); paint(0, true);
    setMode('simulation'); setPlaying(true);
    if (followRef.current && layersRef.current.full) mapRef.current?.fitBounds(layersRef.current.full.getBounds(), { padding: [40, 40] });
  };
  const togglePlay = () => {
    if (!route) return;
    if (progressRef.current >= 1) { startSim(); return; }
    setMode('simulation'); setPlaying((p) => !p);
  };
  const backToEstimate = () => {
    if (!route) return;
    const est = estRef.current;
    setPlaying(false); progressRef.current = est.f; setProgress(est.f); setMode('estimate'); paint(est.f, true, est.pt);
  };
  const scrub = (e) => {
    const f = Number(e.target.value);
    setPlaying(false); setMode('simulation'); progressRef.current = f; setProgress(f); paint(f);
  };

  /* ---- report a position ---- */
  const useMyLocation = () => {
    setFormError('');
    if (!navigator.geolocation) { setFormError('This browser cannot share its location.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6), source: 'PHONE' })),
      (err) => setFormError(`Could not get your location: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const savePosition = async (e) => {
    e.preventDefault(); setFormError('');
    const hasLat = form.latitude !== ''; const hasLng = form.longitude !== '';
    if (hasLat !== hasLng) { setFormError('Give both latitude and longitude, or neither.'); return; }
    if (hasLat && (Math.abs(Number(form.latitude)) > 90 || Math.abs(Number(form.longitude)) > 180)) { setFormError('Coordinates are out of range.'); return; }
    if (!hasLat && !form.location.trim()) { setFormError('Enter where the truck is, or pick / share its coordinates.'); return; }
    setSaving(true);
    try {
      await api.shipmentPositions.create({
        company: shipment.company, shipment: shipment.id,
        recorded_at: new Date(form.when).toISOString(),
        location: form.location.trim(),
        ...(hasLat ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : {}),
        source: form.source, notes: form.notes,
      });
      notify('Position recorded.', 'success');
      setForm({ location: '', latitude: '', longitude: '', when: nowLocal(), source: 'MANUAL', notes: '' });
      setPicking(false); setReporting(false);
      await loadPositions();
      onChanged?.();
    } catch (err) { setFormError(errorMessage(err)); }
    finally { setSaving(false); }
  };

  const km = route ? route.distance / 1000 : 0;
  const pct = Math.round(progress * 100);
  const history = [
    ...timeline.map((h) => ({ key: `s${h.id}`, at: h.at, kind: 'Status', what: label(h.to), where: h.location, by: h.by, note: h.comments })),
    ...positions.map((p) => ({
      key: `p${p.id}`, at: p.recorded_at, kind: 'Position', what: label(p.source),
      where: p.location || (p.latitude != null ? `${Number(p.latitude).toFixed(4)}, ${Number(p.longitude).toFixed(4)}` : ''),
      by: p.created_by_label, note: p.notes,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <>
      <style>{CSS}</style>
      <section className="page-card">
        <div className="table-wrap__header">
          <span className="panel-title"><i className="bi bi-pin-map text-brand"></i>Vehicle tracking</span>
          <span className="chart-card__subtitle">{vehicleName}{shipment.driver_label ? ` \u00b7 ${shipment.driver_label}` : ''}</span>
        </div>

        <div className="st-wrap">
          <aside className="st-panel">
            {notice && <div className={`alert alert-${notice.type} py-2 mb-0`} style={{ fontSize: 'var(--fs-xs)' }}>{notice.text}</div>}

            <div className="st-block">
              <h3 className="st-block__t">Route</h3>
              <div className="mb-2">
                <label className="st-label" htmlFor="stFrom">From</label>
                <input id="stFrom" className="form-control" value={fromText} onChange={(e) => setFromText(e.target.value)} />
              </div>
              <div className="mb-2">
                <label className="st-label" htmlFor="stVia">Via (border crossing, optional)</label>
                <input id="stVia" className="form-control" value={viaText} onChange={(e) => setViaText(e.target.value)} />
              </div>
              <div className="mb-2">
                <label className="st-label" htmlFor="stTo">To</label>
                <input id="stTo" className="form-control" value={toText} onChange={(e) => setToText(e.target.value)} />
              </div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={loading || !fromText.trim() || !toText.trim()}
                      onClick={() => buildRoute(fromText, viaText, toText)}>
                <i className="bi bi-signpost-split"></i> Update route
              </button>
            </div>

            {route && (
              <div className="st-block">
                <h3 className="st-block__t">Position &amp; simulation</h3>
                <div className="st-stats">
                  <div className="st-stat"><div className="st-stat__l">Route distance</div><div className="st-stat__v">{km.toFixed(0)} km</div></div>
                  <div className="st-stat"><div className="st-stat__l">Driving time</div><div className="st-stat__v">{fmtDuration(route.duration)}</div></div>
                  <div className="st-stat"><div className="st-stat__l">Covered</div><div className="st-stat__v">{(km * progress).toFixed(0)} km</div></div>
                  <div className="st-stat"><div className="st-stat__l">Remaining</div><div className="st-stat__v">{(km * (1 - progress)).toFixed(0)} km</div></div>
                </div>
                <div className="st-bar"><span style={{ width: `${pct}%` }}></span></div>
                <div className="st-basis">
                  <strong>{pct}%</strong> &middot; {mode === 'estimate' ? `${basis} (not live GPS)` : 'Simulation \u2014 not a live position'}
                </div>
                <input type="range" className="st-range" min="0" max="1" step="0.001" value={progress} onChange={scrub} aria-label="Trip progress" />
                <div className="st-row mt-2 mb-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={togglePlay}>
                    <i className={`bi ${playing ? 'bi-pause-fill' : 'bi-play-fill'}`}></i> {playing ? 'Pause' : 'Simulate trip'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={startSim}>
                    <i className="bi bi-arrow-counterclockwise"></i> Restart
                  </button>
                  {mode === 'simulation' && <button type="button" className="btn btn-secondary btn-sm" onClick={backToEstimate}>Current position</button>}
                </div>
                <div className="st-row">
                  <label className="st-label mb-0" htmlFor="stSpeed">Speed</label>
                  <select id="stSpeed" className="form-select" style={{ maxWidth: '6rem' }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    {[0.5, 1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}x</option>)}
                  </select>
                  <label className="st-note" style={{ display: 'flex', alignItems: 'center', gap: '.35rem', marginLeft: 'auto' }}>
                    <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow truck
                  </label>
                </div>
              </div>
            )}

            {canReport && (
              <div className="st-block">
                <h3 className="st-block__t">Report position</h3>
                {!reporting ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => { setReporting(true); setForm((f) => ({ ...f, when: nowLocal() })); }}>
                    <i className="bi bi-geo-alt"></i> Report where the truck is
                  </button>
                ) : (
                  <form onSubmit={savePosition}>
                    <div className="mb-2">
                      <label className="st-label" htmlFor="stLoc">Place (e.g. Mbale fuel stop, Mariakani weighbridge)</label>
                      <input id="stLoc" className="form-control" value={form.location} onChange={setF('location')} />
                    </div>
                    <div className="st-row mb-2">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={useMyLocation}><i className="bi bi-crosshair"></i> Use my phone location</button>
                      <button type="button" className={`btn btn-sm ${picking ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPicking((p) => !p)}>
                        <i className="bi bi-cursor"></i> {picking ? 'Click the map\u2026' : 'Pick on map'}
                      </button>
                    </div>
                    <div className="st-row mb-2">
                      <input className="form-control num" style={{ flex: 1, minWidth: 0 }} placeholder="Latitude" value={form.latitude} onChange={setF('latitude')} aria-label="Latitude" />
                      <input className="form-control num" style={{ flex: 1, minWidth: 0 }} placeholder="Longitude" value={form.longitude} onChange={setF('longitude')} aria-label="Longitude" />
                    </div>
                    <div className="mb-2">
                      <label className="st-label" htmlFor="stWhen">When</label>
                      <input id="stWhen" type="datetime-local" className="form-control" value={form.when} onChange={setF('when')} required />
                    </div>
                    <div className="mb-2">
                      <label className="st-label" htmlFor="stNotes">Notes</label>
                      <input id="stNotes" className="form-control" value={form.notes} onChange={setF('notes')} />
                    </div>
                    {formError && <div className="alert alert-danger py-2" style={{ fontSize: 'var(--fs-xs)' }}>{formError}</div>}
                    <div className="st-row">
                      <button className="btn btn-primary btn-sm" disabled={saving}><i className="bi bi-save"></i> {saving ? 'Saving...' : 'Save position'}</button>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={saving}
                              onClick={() => { setReporting(false); setPicking(false); setFormError(''); }}>Cancel</button>
                    </div>
                  </form>
                )}
              </div>
            )}

            <p className="st-note">
              No GPS tracker is connected. Orange dots are status updates, purple dots are position reports. Reports after dispatch
              place the truck; without one it is estimated from dispatch time and expected delivery.
            </p>
          </aside>

          <div className="st-mapwrap">
            <div ref={mapEl} className="st-map"></div>
            {loading && <div className="st-loading"><span className="spinner-border spinner-border-sm"></span> Loading map&hellip;</div>}
          </div>
        </div>
      </section>

      <section className="page-card">
        <div className="table-wrap__header">
          <span className="panel-title"><i className="bi bi-clock-history text-brand"></i>Movement history</span>
          <span className="chart-card__subtitle">{history.length} event{history.length !== 1 ? 's' : ''}</span>
        </div>
        {history.length === 0 ? (
          <div className="empty-state"><i className="bi bi-geo-alt"></i><h6>No movements recorded yet</h6></div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead><tr><th>Time</th><th>Type</th><th>What</th><th>Where</th><th>By</th><th>Notes</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.key}>
                      <td>{fmtDT(h.at)}</td>
                      <td><span className="badge badge-neutral">{h.kind}</span></td>
                      <td className="cell-name">{h.what}</td>
                      <td>{h.where || DASH}</td>
                      <td>{h.by || DASH}</td>
                      <td className="text-truncate" style={{ maxWidth: 240 }}>{h.note || DASH}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}