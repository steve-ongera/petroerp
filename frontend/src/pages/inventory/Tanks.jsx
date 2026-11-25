/**
 * Storage tanks.
 * - CRUD /storage-tanks/    (crud)
 * - GET  /storage-tanks/:id/position/?date=YYYY-MM-DD  → book balance + daily movements
 * - /depots/ (crud) is shown as a sibling tab so depot data can be managed here too.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const tankPill = (s) =>
  s === 'ACTIVE' ? 'status-pill--success' : s === 'MAINTENANCE' ? 'status-pill--warning' : 'status-pill--neutral';

export default function Tanks() {
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [tab, setTab] = useState('tanks');
  const [tanks, setTanks] = useState([]);
  const [depots, setDepots] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [position, setPosition] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [t, d, p] = await Promise.all([
        api.storageTanks.listAll({ ...companyParams(), ordering: 'code' }),
        api.depots.listAll({ ...companyParams(), ordering: 'code' }),
        api.products.listAll(),
      ]);
      setTanks(t); setDepots(d); setProducts(p);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const remove = async (r, resource) => {
    if (!window.confirm(`Delete ${r.code}?`)) return;
    try { await resource.remove(r.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const showPosition = async (t) => {
    try { setPosition({ tank: t, data: await api.storageTanks.position(t.id, todayISO()) }); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  const activeRows = tab === 'tanks' ? tanks : depots;
  const { pageRows, paginationProps } = usePagination(activeRows);

  return (
    <div>
      {/* ---------- Page header: icon tile + title + actions ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-fuel-pump"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Tanks &amp; depots</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({ kind: tab, row: {} })}>
            <i className="bi bi-plus-lg"></i>
            New {tab === 'tanks' ? 'tank' : 'depot'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      {/* ---------- Tabs sitting on top of the white card ---------- */}
      <div className="page-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'tanks'}
          className={`page-tab${tab === 'tanks' ? ' is-active' : ''}`} onClick={() => setTab('tanks')}>
          <i className="bi bi-fuel-pump"></i> Tanks <span className="tab__count">{tanks.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'depots'}
          className={`page-tab${tab === 'depots' ? ' is-active' : ''}`} onClick={() => setTab('depots')}>
          <i className="bi bi-building"></i> Depots <span className="tab__count">{depots.length}</span>
        </button>
      </div>

      <section className="page-card">
        <div className="table-wrap__header">
          <span className="panel-title">
            <i className={`bi ${tab === 'tanks' ? 'bi-fuel-pump' : 'bi-building'} text-brand`}></i>
            {tab === 'tanks' ? 'Tank List' : 'Depot List'}
          </span>
          <span className="chart-card__subtitle">
            {activeRows.length} {tab === 'tanks' ? 'tank' : 'depot'}{activeRows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={tab === 'tanks' ? 8 : 6} />
        ) : activeRows.length === 0 ? (
          <div className="empty-state">
            <i className={`bi ${tab === 'tanks' ? 'bi-fuel-pump' : 'bi-building'}`}></i>
            <h6>{tab === 'tanks' ? 'No tanks yet' : 'No depots yet'}</h6>
            <p className="text-muted-soft">Click 'New {tab === 'tanks' ? 'tank' : 'depot'}' to add the first one</p>
          </div>
        ) : tab === 'tanks' ? (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Depot</th>
                    <th>Product</th>
                    <th className="text-right">Capacity</th>
                    <th className="text-right">Min level</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => (
                    <tr key={t.id}>
                      <td className="cell-mono text-brand fw-600">{t.code}</td>
                      <td className="cell-name">{t.name}</td>
                      <td>{t.depot_label || '—'}</td>
                      <td>{t.product_label ? <span className="chip">{t.product_label}</span> : '—'}</td>
                      <td className="cell-num">{Number(t.capacity || 0).toLocaleString()}</td>
                      <td className="cell-num">{Number(t.min_level || 0).toLocaleString()}</td>
                      <td><span className={`status-pill ${tankPill(t.status)}`}>{t.status}</span></td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-icon" title="Position" aria-label="Position" onClick={() => showPosition(t)}>
                            <i className="bi bi-bar-chart"></i>
                          </button>
                          <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing({ kind: 'tanks', row: t })}>
                            <i className="bi bi-pencil"></i>
                          </button>
                          <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(t, api.storageTanks)}>
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
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Location</th>
                    <th>Country</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((d) => (
                    <tr key={d.id}>
                      <td className="cell-mono text-brand fw-600">{d.code}</td>
                      <td className="cell-name">{d.name}</td>
                      <td>{d.location || '—'}</td>
                      <td>{d.country}</td>
                      <td>
                        <span className={`status-pill ${d.is_active ? 'status-pill--success' : 'status-pill--neutral'}`}>
                          {d.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing({ kind: 'depots', row: d })}>
                            <i className="bi bi-pencil"></i>
                          </button>
                          <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(d, api.depots)}>
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
        )}

        {!loading && activeRows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && editing.kind === 'tanks' && (
        <TankModal row={editing.row} depots={depots} products={products} companyParams={companyParams}
                   onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
      {editing && editing.kind === 'depots' && (
        <DepotModal row={editing.row} companyParams={companyParams}
                    onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
      {position && (
        <PositionModal tank={position.tank} data={position.data} onClose={() => setPosition(null)} />
      )}
    </div>
  );
}

function TankModal({ row, depots, products, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', depot: row.depot || '',
    product: row.product || '', capacity: row.capacity ?? '', min_level: row.min_level ?? '',
    status: row.status || 'ACTIVE',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.product) delete body.product;
      isNew ? await api.storageTanks.create(body) : await api.storageTanks.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New tank' : `Edit ${row.code}`}
      subtitle="Storage tank details"
      icon="bi-fuel-pump"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="tankForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="tankForm" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Code" required err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} required disabled={!isNew} />
          </Field>
          <Field label="Name" required>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Depot" required>
            <select className="form-select" value={form.depot} onChange={set('depot')} required>
              <option value="">—</option>
              {depots.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
            </select>
          </Field>
          <Field label="Product">
            <select className="form-select" value={form.product} onChange={set('product')}>
              <option value="">— assigned by stock movements —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </Field>
          <Field label="Capacity (L)">
            <input type="number" step="0.001" className="form-control num" value={form.capacity} onChange={set('capacity')} />
          </Field>
          <Field label="Min level (L)">
            <input type="number" step="0.001" className="form-control num" value={form.min_level} onChange={set('min_level')} />
          </Field>
          <Field label="Status">
            <select className="form-select" value={form.status} onChange={set('status')}>
              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function DepotModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', location: row.location || '',
    country: row.country || 'Kenya', is_active: row.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form, company: companyParams().company };
      isNew ? await api.depots.create(body) : await api.depots.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New depot' : `Edit ${row.code}`}
      subtitle="Depot details"
      icon="bi-building"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="depotForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="depotForm" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Code" required>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} required disabled={!isNew} />
          </Field>
          <Field label="Name" required>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Location" span>
            <input className="form-control" value={form.location} onChange={set('location')} />
          </Field>
          <Field label="Country">
            <input className="form-control" value={form.country} onChange={set('country')} />
          </Field>
          <Field label="Active">
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="depotActive" checked={!!form.is_active} onChange={set('is_active')} />
              <label className="form-check-label" htmlFor="depotActive">Active</label>
            </div>
          </Field>
        </div>
        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function PositionModal({ tank, data, onClose }) {
  const L = (v) => `${Number(v || 0).toLocaleString()} L`;
  return (
    <Modal
      show
      onClose={onClose}
      dismissOnBackdrop
      title={`${tank.code} · Position`}
      subtitle={tank.name}
      icon="bi-bar-chart"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      <div className="kv">
        <div className="kv__item"><div className="kv__label">As of</div><div className="kv__value">{data.date}</div></div>
        <div className="kv__item"><div className="kv__label">On hand</div><div className="kv__value">{L(data.on_hand)}</div></div>
        <div className="kv__item"><div className="kv__label">Value</div><div className="kv__value">{fmtMoney(data.value)}</div></div>
        <div className="kv__item"><div className="kv__label">Opening</div><div className="kv__value">{L(data.opening)}</div></div>
        <div className="kv__item"><div className="kv__label">Receipts</div><div className="kv__value">{L(data.receipts)}</div></div>
        <div className="kv__item"><div className="kv__label">Transfers in</div><div className="kv__value">{L(data.transfers_in)}</div></div>
        <div className="kv__item"><div className="kv__label">Issues</div><div className="kv__value">{L(data.issues)}</div></div>
        <div className="kv__item"><div className="kv__label">Transfers out</div><div className="kv__value">{L(data.transfers_out)}</div></div>
        <div className="kv__item"><div className="kv__label">Adjustments</div><div className="kv__value">{L(data.adjustments)}</div></div>
      </div>
    </Modal>
  );
}