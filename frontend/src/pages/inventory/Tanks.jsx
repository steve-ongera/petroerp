/**
 * Storage tanks.
 * - CRUD /storage-tanks/    (crud)
 * - GET  /storage-tanks/:id/position/?date=YYYY-MM-DD  → book balance + daily movements
 * - /depots/ (crud) is shown as a sibling tab so depot data can be managed here too.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const STATUS = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

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

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Tanks & depots</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'}
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({ kind: tab, row: {} })}>
            <i className="bi bi-plus-lg" /> New {tab === 'tanks' ? 'tank' : 'depot'}
          </button>
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'tanks' ? 'active' : ''}`} onClick={() => setTab('tanks')}>
          Tanks <span className="tab__count">{tanks.length}</span>
        </button>
        <button className={`tab ${tab === 'depots' ? 'active' : ''}`} onClick={() => setTab('depots')}>
          Depots <span className="tab__count">{depots.length}</span>
        </button>
      </div>

      {error ? (
        <div className="card"><div className="card__body">
          <p className="field-error" role="alert">{error}</p>
          <button className="btn mt-2" onClick={load}>Try again</button>
        </div></div>
      ) : loading ? (
        <div className="state-screen">Loading…</div>
      ) : tab === 'tanks' ? (
        <div className="table-card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Code</th><th>Name</th><th>Depot</th><th>Product</th>
                <th className="num">Capacity</th><th className="num">Min level</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {tanks.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.code}</td>
                    <td>{t.name}</td>
                    <td>{t.depot_label || '—'}</td>
                    <td>{t.product_label || '—'}</td>
                    <td className="num">{Number(t.capacity || 0).toLocaleString()}</td>
                    <td className="num">{Number(t.min_level || 0).toLocaleString()}</td>
                    <td><span className={`status ${t.status === 'ACTIVE' ? 'status-active' : t.status === 'MAINTENANCE' ? 'status-pending' : 'status-inactive'}`}>{t.status}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Position" onClick={() => showPosition(t)}><i className="bi bi-bar-chart" /></button>
                        <button className="row-action" title="Edit" onClick={() => setEditing({ kind: 'tanks', row: t })}><i className="bi bi-pencil" /></button>
                        <button className="row-action row-action--danger" title="Delete" onClick={() => remove(t, api.storageTanks)}><i className="bi bi-trash" /></button>
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
              <thead><tr><th>Code</th><th>Name</th><th>Location</th><th>Country</th><th>Status</th><th className="col-actions" /></tr></thead>
              <tbody>
                {depots.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.code}</td>
                    <td>{d.name}</td>
                    <td>{d.location || '—'}</td>
                    <td>{d.country}</td>
                    <td><span className={`status ${d.is_active ? 'status-active' : 'status-inactive'}`}>{d.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Edit" onClick={() => setEditing({ kind: 'depots', row: d })}><i className="bi bi-pencil" /></button>
                        <button className="row-action row-action--danger" title="Delete" onClick={() => remove(d, api.depots)}><i className="bi bi-trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New tank' : `Edit ${row.code}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Code" required err={fieldErr.code}>
                <input className="input mono" value={form.code} onChange={set('code')} required disabled={!isNew} />
              </Field>
              <Field label="Name" required>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Depot" required>
                <select className="select" value={form.depot} onChange={set('depot')} required>
                  <option value="">—</option>
                  {depots.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
                </select>
              </Field>
              <Field label="Product">
                <select className="select" value={form.product} onChange={set('product')}>
                  <option value="">— assigned by stock movements —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </Field>
              <Field label="Capacity (L)"><input type="number" step="0.001" className="input num" value={form.capacity} onChange={set('capacity')} /></Field>
              <Field label="Min level (L)"><input type="number" step="0.001" className="input num" value={form.min_level} onChange={set('min_level')} /></Field>
              <Field label="Status">
                <select className="select" value={form.status} onChange={set('status')}>
                  {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
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
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New depot' : `Edit ${row.code}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Code" required><input className="input mono" value={form.code} onChange={set('code')} required disabled={!isNew} /></Field>
              <Field label="Name" required><input className="input" value={form.name} onChange={set('name')} required /></Field>
              <Field label="Location" span><input className="input" value={form.location} onChange={set('location')} /></Field>
              <Field label="Country"><input className="input" value={form.country} onChange={set('country')} /></Field>
              <Field label="Active">
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

function PositionModal({ tank, data, onClose }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">{tank.code} · Position</h2>
            <p className="modal__subtitle">{tank.name}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          <div className="kv">
            <div className="kv__item"><div className="kv__label">As of</div><div className="kv__value">{data.date}</div></div>
            <div className="kv__item"><div className="kv__label">On hand</div><div className="kv__value">{Number(data.on_hand || 0).toLocaleString()} L</div></div>
            <div className="kv__item"><div className="kv__label">Value</div><div className="kv__value">{fmtMoney(data.value)}</div></div>
            <div className="kv__item"><div className="kv__label">Opening</div><div className="kv__value">{Number(data.opening || 0).toLocaleString()} L</div></div>
            <div className="kv__item"><div className="kv__label">Receipts</div><div className="kv__value">{Number(data.receipts || 0).toLocaleString()} L</div></div>
            <div className="kv__item"><div className="kv__label">Transfers in</div><div className="kv__value">{Number(data.transfers_in || 0).toLocaleString()} L</div></div>
            <div className="kv__item"><div className="kv__label">Issues</div><div className="kv__value">{Number(data.issues || 0).toLocaleString()} L</div></div>
            <div className="kv__item"><div className="kv__label">Transfers out</div><div className="kv__value">{Number(data.transfers_out || 0).toLocaleString()} L</div></div>
            <div className="kv__item"><div className="kv__label">Adjustments</div><div className="kv__value">{Number(data.adjustments || 0).toLocaleString()} L</div></div>
          </div>
        </div>
        <div className="modal__footer"><button className="btn" onClick={onClose}>Close</button></div>
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