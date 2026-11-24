/**
 * Customs: export declarations + compliance checks.
 * - CRUD /export-declarations/     (withStatus via set-status)
 * - CRUD /compliance-checks/
 * - /compliance-requirements/ and /border-crossings/ used as pickers
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const DECL_STATUS = ['DRAFT', 'SUBMITTED', 'QUERIED', 'CLEARED', 'REJECTED'];
const CHECK_STATUS = ['PENDING', 'PROVIDED', 'WAIVED', 'NOT_APPLICABLE'];
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Customs() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [tab, setTab] = useState('declarations');
  const [declarations, setDeclarations] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [d, c] = await Promise.all([
        api.exportDeclarations.listAll({ ...companyParams(), ordering: '-id' }),
        api.complianceChecks.listAll({ ...companyParams(), ordering: '-id' }),
      ]);
      setDeclarations(d); setChecks(c);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const setDeclStatus = async (decl, status) => {
    try { await api.exportDeclarations.setStatus(decl.id, status); notify(`Status: ${status}`, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Customs</h1>
          <p className="page-header__subtitle">
            Export declarations and compliance{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('customs.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({ kind: tab, row: {} })}>
              <i className="bi bi-plus-lg" /> New {tab === 'declarations' ? 'declaration' : 'check'}
            </button>
          )}
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'declarations' ? 'active' : ''}`} onClick={() => setTab('declarations')}>
          Declarations <span className="tab__count">{declarations.length}</span>
        </button>
        <button className={`tab ${tab === 'checks' ? 'active' : ''}`} onClick={() => setTab('checks')}>
          Compliance checks <span className="tab__count">{checks.length}</span>
        </button>
      </div>

      {error ? (
        <div className="card"><div className="card__body"><p className="field-error" role="alert">{error}</p>
          <button className="btn mt-2" onClick={load}>Try again</button></div></div>
      ) : loading ? (
        <div className="state-screen">Loading…</div>
      ) : tab === 'declarations' ? (
        <div className="table-card">
          {!declarations.length ? (
            <div className="table-empty"><div className="table-empty__title">No declarations</div></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>Reference</th><th>Shipment</th><th>Declaration #</th><th>Customs ref</th>
                  <th>Border</th><th>Export date</th><th>Clearance</th><th>Status</th><th className="col-actions" />
                </tr></thead>
                <tbody>
                  {declarations.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.reference}</td>
                      <td>{d.shipment_label || d.shipment}</td>
                      <td className="mono">{d.declaration_number || '—'}</td>
                      <td className="mono">{d.customs_reference || '—'}</td>
                      <td>{d.border_crossing_label || '—'}</td>
                      <td className="text-sm">{d.export_date || '—'}</td>
                      <td className="text-sm">{d.clearance_date || '—'}</td>
                      <td><span className={`status ${d.status === 'CLEARED' ? 'status-active' : d.status === 'REJECTED' ? 'status-rejected' : d.status === 'SUBMITTED' ? 'status-pending' : 'status-draft'}`}>{d.status}</span></td>
                      <td className="col-actions">
                        {can('customs.edit') && d.status !== 'CLEARED' && d.status !== 'REJECTED' && (
                          <select className="select select-sm" value={d.status} onChange={(e) => setDeclStatus(d, e.target.value)}>
                            {DECL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="table-card">
          {!checks.length ? (
            <div className="table-empty"><div className="table-empty__title">No compliance checks</div></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>Shipment</th><th>Requirement</th><th>Status</th><th>Doc ref</th><th>Checked by</th><th>Checked at</th>
                </tr></thead>
                <tbody>
                  {checks.map((c) => (
                    <tr key={c.id}>
                      <td>{c.shipment_label || c.shipment}</td>
                      <td>{c.requirement_label || c.requirement}</td>
                      <td><span className={`status ${c.status === 'PROVIDED' ? 'status-active' : c.status === 'WAIVED' ? 'status-pending' : 'status-draft'}`}>{c.status}</span></td>
                      <td className="mono">{c.document_ref || '—'}</td>
                      <td>{c.checked_by_label || '—'}</td>
                      <td className="text-sm">{c.checked_at || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}