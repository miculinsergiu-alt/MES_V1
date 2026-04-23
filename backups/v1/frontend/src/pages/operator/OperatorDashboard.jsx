import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Clock, CheckCircle, XCircle, AlertTriangle, X } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';

export default function OperatorDashboard() {
  const { user } = useAuth();
  const [allocations, setAllocations] = useState([]);
  const [selectedAlloc, setSelectedAlloc] = useState(null);
  const [actions, setActions] = useState([]);
  const [results, setResults] = useState(null);
  const [showDelayModal, setShowDelayModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [activePhase, setActivePhase] = useState(null);

  const loadAllocations = useCallback(async () => {
    try {
      const r = await api.get(`/production/operator/${user.id}`);
      setAllocations(r.data);
    } catch {}
  }, [user.id]);

  useEffect(() => { loadAllocations(); }, [loadAllocations]);

  const loadActions = async (allocId) => {
    try {
      const [aRes, rRes] = await Promise.all([
        api.get(`/production/actions/${allocId}`),
        api.get(`/production/results/${selectedAlloc?.order_id || allocId}`),
      ]);
      setActions(aRes.data);
      setResults(rRes.data);
      // Detect active phase from last action
      const last = aRes.data[aRes.data.length - 1];
      if (last) {
        if (last.action_type.includes('start')) setActivePhase(last.action_type.replace('_start',''));
        if (last.action_type.includes('end')) setActivePhase(null);
      }
    } catch {}
  };

  const selectAlloc = async (alloc) => {
    setSelectedAlloc(alloc);
    await loadActions(alloc.id);
  };

  const logAction = async (actionType) => {
    if (!selectedAlloc) return;
    try {
      await api.post('/production/actions', { allocation_id: selectedAlloc.id, action_type: actionType });
      toast.success(ACTION_LABELS[actionType]);
      await loadActions(selectedAlloc.id);
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  const ACTION_LABELS = {
    setup_start:'Setup pornit', setup_end:'Setup finalizat',
    working_start:'Producție pornită', working_end:'Producție finalizată',
    supervision_start:'Supervizare pornită', supervision_end:'Supervizare finalizată',
    delay_start:'Delay raportat', delay_end:'Delay rezolvat'
  };

  const navItems = [{ path:'/operator', label:'Utilajele Mele', icon:<LayoutDashboard size={16}/> }];

  const statusColor = (s) => ({ active:'var(--green-light)', pending:'var(--yellow-light)', done:'var(--text-muted)' })[s] || 'var(--text-muted)';

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <h1>Utilajele Mele</h1>
          <p>Bun venit, {user?.first_name}! Selectați un utilaj pentru a vedea sarcinile.</p>
        </div>
        <div className="page-content">
          {!selectedAlloc ? (
            <div>
              <div style={{ marginBottom:16, fontSize:14, color:'var(--text-muted)' }}>Alocat pe {allocations.length} utilaj{allocations.length !== 1 ? 'e' : ''}</div>
              {allocations.length === 0 && <div className="empty-state">Nu ești alocat pe niciun utilaj momentan.<br/>Contactează Shift Responsibilul tău.</div>}
              <div className="grid-3">
                {allocations.map(alloc => {
                  const totalDelay = 0; // could compute from delays
                  return (
                    <div key={alloc.id} className={`machine-card ${alloc.order_status==='active'?'active':''}`} onClick={() => selectAlloc(alloc)}>
                      <div className="flex justify-between items-center mb-2">
                        <span style={{ fontWeight:700, fontSize:16 }}>Utilaj #{alloc.machine_id}</span>
                        <span className="machine-status-dot" style={{ background: statusColor(alloc.order_status) }} />
                      </div>
                      <div style={{ fontWeight:600, fontSize:15, marginBottom:8, color:'var(--text-primary)' }}>{alloc.product_name}</div>
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:8 }}>
                        {alloc.start_time?.substring(0,16)} → {alloc.end_time?.substring(0,16)}
                      </div>
                      <div className="flex gap-3">
                        <span style={{ fontSize:12, color:'var(--text-secondary)' }}>Qty: <strong>{alloc.quantity}</strong></span>
                        <span className={`badge ${alloc.phase==='setup'?'badge-blue':alloc.phase==='supervision'?'badge-yellow':'badge-green'}`}>{alloc.phase}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="fade-in">
              <div className="flex items-center gap-3 mb-4">
                <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedAlloc(null); setActions([]); setActivePhase(null); }}>← Înapoi</button>
                <h2 style={{ fontSize:20, fontWeight:700 }}>Utilaj #{selectedAlloc.machine_id} — {selectedAlloc.product_name}</h2>
              </div>

              <div className="grid-3 mb-4">
                {[['Cantitate', `${selectedAlloc.quantity} buc`, 'var(--blue-light)'], ['Fază', selectedAlloc.phase, 'var(--yellow-light)'], ['Status', selectedAlloc.order_status, 'var(--green-light)']].map(([l,v,c]) => (
                  <div key={l} className="card stat-card"><div style={{ fontSize:22, fontWeight:700, color:c }}>{v}</div><div className="stat-label">{l}</div></div>
                ))}
              </div>

              {/* Results so far */}
              {results && (results.totals.ok > 0 || results.totals.fail > 0) && (
                <div className="card mb-4">
                  <div className="card-title">Rezultate Curente</div>
                  <div className="flex gap-4">
                    <div style={{ textAlign:'center' }}><div style={{ fontSize:28, fontWeight:800, color:'var(--green-light)' }}>{results.totals.ok}</div><div className="stat-label">OK</div></div>
                    <div style={{ textAlign:'center' }}><div style={{ fontSize:28, fontWeight:800, color:'var(--red-light)' }}>{results.totals.fail}</div><div className="stat-label">FAIL</div></div>
                    <div style={{ flex:1 }}>
                      <div className="flex justify-between text-sm mb-1"><span>Progres</span><span>{Math.round(((results.totals.ok+results.totals.fail)/selectedAlloc.quantity)*100)}%</span></div>
                      <div className="progress-bar"><div className="progress-fill green" style={{ width:`${Math.min(100,((results.totals.ok+results.totals.fail)/selectedAlloc.quantity)*100)}%` }} /></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="card mb-4">
                <div className="card-title">Acțiuni Curente</div>
                <div className="action-grid">
                  <button className={`action-btn setup ${activePhase==='setup'?'active-phase':''}`} onClick={() => logAction(activePhase==='setup'?'setup_end':'setup_start')}>
                    <Clock size={24} style={{ color:'var(--blue-light)' }} />
                    {activePhase==='setup' ? '⏹ Stop Setup Time' : '▶ Start Setup Time'}
                  </button>
                  <button className={`action-btn working ${activePhase==='working'?'active-phase':''}`} onClick={() => logAction(activePhase==='working'?'working_end':'working_start')}>
                    <CheckCircle size={24} style={{ color:'var(--green-light)' }} />
                    {activePhase==='working' ? '⏹ Stop Producție' : '▶ Start Producție'}
                  </button>
                  <button className={`action-btn supervision ${activePhase==='supervision'?'active-phase':''}`} onClick={() => logAction(activePhase==='supervision'?'supervision_end':'supervision_start')}>
                    <Clock size={24} style={{ color:'var(--yellow-light)' }} />
                    {activePhase==='supervision' ? '⏹ Stop Supervizare' : '▶ Start Supervizare'}
                  </button>
                  <button className={`action-btn delay`} onClick={() => setShowDelayModal(true)}>
                    <AlertTriangle size={24} style={{ color:'var(--red-light)' }} />
                    Raportare Delay
                  </button>
                </div>
                <div className="flex gap-2 mt-4">
                  <button className="btn btn-success w-full" onClick={() => setShowResultModal(true)}>
                    <CheckCircle size={16}/> Înregistrare Rezultate Producție
                  </button>
                </div>
              </div>

              {/* Action history */}
              <div className="card">
                <div className="card-title">Istoricul Acțiunilor</div>
                {actions.length === 0 && <div className="text-muted text-sm">Nicio acțiune înregistrată încă</div>}
                {actions.map(a => (
                  <div key={a.id} style={{ display:'flex', justifyContent:'space-between', padding:'8px 12px', background:'var(--bg-primary)', borderRadius:6, marginBottom:4, fontSize:13 }}>
                    <span style={{ color: a.action_type.includes('delay')?'var(--red-light)': a.action_type.includes('working')?'var(--green-light)': a.action_type.includes('setup')?'var(--blue-light)':'var(--yellow-light)' }}>
                      {ACTION_LABELS[a.action_type] || a.action_type}
                    </span>
                    <span style={{ color:'var(--text-muted)', fontSize:11 }}>{a.timestamp?.substring(0,19)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showDelayModal && selectedAlloc && (
        <OperatorDelayModal alloc={selectedAlloc} onClose={() => setShowDelayModal(false)} onSave={async () => { setShowDelayModal(false); await loadActions(selectedAlloc.id); }} />
      )}
      {showResultModal && selectedAlloc && (
        <ResultModal alloc={selectedAlloc} onClose={() => setShowResultModal(false)} onSave={async () => { setShowResultModal(false); await loadActions(selectedAlloc.id); loadAllocations(); }} />
      )}
    </div>
  );
}

function OperatorDelayModal({ alloc, onClose, onSave }) {
  const [form, setForm] = useState({ delay_start:'', delay_end:'', reason:'' });
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Calculate delay minutes
      const start = new Date(form.delay_start);
      const end = new Date(form.delay_end);
      const delayMin = Math.ceil((end - start) / 60000);
      if (delayMin <= 0) return toast.error('Intervalul de delay este invalid');

      await api.post(`/orders/${alloc.order_id}/delay`, { delay_minutes: delayMin, reason: form.reason, source:'operator' });
      await api.post('/production/actions', { allocation_id: alloc.id, action_type:'delay_start', notes:`Delay ${delayMin}m: ${form.reason}` });
      toast.success(`Delay de ${delayMin} minute raportat și aplicat automat`);
      onSave();
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3 style={{ color:'var(--red-light)' }}>Raportare Delay</h3><button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button></div>
        <div className="alert alert-error">Delay-ul va fi aplicat automat pe planul de producție.</div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Ora Start Delay</label><input className="form-input" type="datetime-local" value={form.delay_start} onChange={e=>setForm(p=>({...p,delay_start:e.target.value}))} required /></div>
            <div className="form-group"><label className="form-label">Ora Sfârșit Delay</label><input className="form-input" type="datetime-local" value={form.delay_end} onChange={e=>setForm(p=>({...p,delay_end:e.target.value}))} required /></div>
          </div>
          <div className="form-group"><label className="form-label">Descriere Problemă</label><textarea className="form-textarea" value={form.reason} onChange={e=>setForm(p=>({...p,reason:e.target.value}))} placeholder="Descrieți problema care a cauzat întârzierea..." required /></div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-danger">Raportare Delay</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResultModal({ alloc, onClose, onSave }) {
  const [qtyOk, setQtyOk] = useState(0);
  const [qtyFail, setQtyFail] = useState(0);
  const [reasons, setReasons] = useState([]);
  const [defects, setDefects] = useState([]);

  useEffect(() => {
    api.get('/production/defect-reasons').then(r => setReasons(r.data));
  }, []);

  const addDefect = () => setDefects(p => [...p, { reason_id: '', quantity: 0, notes: '' }]);
  const setDefect = (i, k, v) => setDefects(p => p.map((d, idx) => idx === i ? { ...d, [k]: v } : d));
  const removeDefect = (i) => setDefects(p => p.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const totalDefects = defects.reduce((a, d) => a + parseInt(d.quantity || 0), 0);
    if (qtyFail > 0 && totalDefects !== parseInt(qtyFail)) {
      return toast.error(`Totalul defectelor (${totalDefects}) trebuie să fie egal cu Componente FAIL (${qtyFail})`);
    }

    try {
      await api.post('/production/results', { 
        order_id: alloc.order_id, 
        qty_ok: parseInt(qtyOk), 
        qty_fail: parseInt(qtyFail),
        defects: defects.map(d => ({ ...d, reason_id: parseInt(d.reason_id), quantity: parseInt(d.quantity) }))
      });
      toast.success('Rezultate înregistrate cu succes'); 
      onSave();
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header"><h3>Înregistrare Rezultate Producție</h3><button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button></div>
        <div className="alert alert-info">Introduceți cantitățile produse și specificați cauzele pentru rebuturi (FAIL).</div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" style={{ color:'var(--green-light)' }}>Componente OK</label>
              <input className="form-input" type="number" min={0} value={qtyOk} onChange={e=>setQtyOk(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ color:'var(--red-light)' }}>Componente FAIL (Rebuturi)</label>
              <input className="form-input" type="number" min={0} value={qtyFail} onChange={e=>setQtyFail(e.target.value)} />
            </div>
          </div>

          {parseInt(qtyFail) > 0 && (
            <div style={{ background:'rgba(239,68,68,0.05)', padding:16, borderRadius:'var(--radius)', border:'1px solid rgba(239,68,68,0.2)', marginBottom:16 }}>
              <div className="flex justify-between items-center mb-3">
                <span style={{ fontSize:14, fontWeight:600, color:'var(--red-light)' }}>Detalii Rebuturi</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addDefect}><Plus size={14}/> Adaugă Motiv</button>
              </div>
              {defects.length === 0 && <div className="text-muted text-xs mb-2">Adăugați cel puțin un motiv pentru cele {qtyFail} rebuturi.</div>}
              {defects.map((d, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <select className="form-select" style={{ flex:2 }} value={d.reason_id} onChange={e=>setDefect(i, 'reason_id', e.target.value)} required>
                    <option value="">Motiv...</option>
                    {reasons.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <input className="form-input" style={{ flex:1 }} type="number" placeholder="Cantitate" value={d.quantity} onChange={e=>setDefect(i, 'quantity', e.target.value)} required />
                  <button type="button" className="btn btn-ghost btn-icon" onClick={()=>removeDefect(i)}><X size={14}/></button>
                </div>
              ))}
              <div className="text-right text-xs mt-2" style={{ color: defects.reduce((a, d) => a + parseInt(d.quantity || 0), 0) === parseInt(qtyFail) ? 'var(--green-light)' : 'var(--red-light)' }}>
                Total detaliat: {defects.reduce((a, d) => a + parseInt(d.quantity || 0), 0)} / {qtyFail}
              </div>
            </div>
          )}

          <div style={{ padding:12, background:'var(--bg-primary)', borderRadius:'var(--radius-sm)', fontSize:13 }}>
            <div className="flex justify-between">
              <span className="text-muted">Total produs:</span>
              <span style={{ fontWeight:600 }}>{+qtyOk + +qtyFail} buc</span>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-success">Înregistrare Rezultate</button>
          </div>
        </form>
      </div>
    </div>
  );
}
