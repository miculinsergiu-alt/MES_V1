import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Clock, CheckCircle, AlertTriangle, X, Plus, FileText, Image as ImageIcon } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';

export default function OperatorDashboard() {
  const { user } = useAuth();
  const [allocations, setAllocations] = useState([]);
  const [selectedAlloc, setSelectedAlloc] = useState(null);
  const [itemDetails, setItemDetails] = useState(null);
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

  const loadActions = async (alloc) => {
    try {
      const [aRes, rRes, iRes] = await Promise.all([
        api.get(`/production/actions/${alloc.id}`),
        api.get(`/production/results/${alloc.order_id}`),
        alloc.item_id ? api.get(`/items/${alloc.item_id}`) : Promise.resolve({ data: null })
      ]);
      setActions(aRes.data);
      setResults(rRes.data);
      setItemDetails(iRes.data);
      
      const last = aRes.data[aRes.data.length - 1];
      if (last) {
        if (last.action_type.includes('start')) setActivePhase(last.action_type.replace('_start',''));
        if (last.action_type.includes('end')) setActivePhase(null);
      }
    } catch {}
  };

  const selectAlloc = async (alloc) => {
    setSelectedAlloc(alloc);
    await loadActions(alloc);
  };

  const logAction = async (actionType) => {
    if (!selectedAlloc) return;
    try {
      await api.post('/production/actions', { allocation_id: selectedAlloc.id, action_type: actionType });
      toast.success(ACTION_LABELS[actionType]);
      await loadActions(selectedAlloc);
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  const ACTION_LABELS = {
    setup_start:'Setup pornit', setup_end:'Setup finalizat',
    working_start:'Producție pornită', working_end:'Producție finalizată',
    supervision_start:'Supervizare pornită', supervision_end:'Supervizare finalizată',
    delay_start:'Delay raportat', delay_end:'Delay rezolvat'
  };

  const navItems = [{ path:'/operator', label:'Utilajele Mele', icon:<LayoutDashboard size={16}/> }];

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
            <div className="grid-3">
              {allocations.map(alloc => (
                <div key={alloc.id} className="machine-card" onClick={() => selectAlloc(alloc)}>
                  <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Utilaj #{alloc.machine_id}</div>
                  <div style={{ fontWeight:600, color:'var(--text-primary)' }}>{alloc.product_name}</div>
                  <div className="badge badge-blue mt-2">{alloc.phase}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="fade-in">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedAlloc(null)}>← Înapoi</button>
                  <h2 style={{ fontSize:20, fontWeight:700 }}>Utilaj #{selectedAlloc.machine_id} — {selectedAlloc.product_name}</h2>
                </div>
                
                {/* Documents / SOPs */}
                <div className="flex gap-2">
                  {itemDetails?.sop_url && (
                    <a href={itemDetails.sop_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ color: 'var(--blue-light)' }}>
                      <FileText size={16}/> Vezi SOP
                    </a>
                  )}
                  {itemDetails?.drawing_url && (
                    <a href={itemDetails.drawing_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ color: 'var(--yellow-light)' }}>
                      <ImageIcon size={16}/> Desen Tehnic
                    </a>
                  )}
                </div>
              </div>

              <div className="grid-3 mb-4">
                <div className="card stat-card"><div style={{ fontSize:22, fontWeight:700 }}>{selectedAlloc.quantity}</div><div className="stat-label">CANTITATE PLĂNUITĂ</div></div>
                <div className="card stat-card"><div style={{ fontSize:22, fontWeight:700, color:'var(--green-light)' }}>{results?.totals.ok || 0}</div><div className="stat-label">OK</div></div>
                <div className="card stat-card"><div style={{ fontSize:22, fontWeight:700, color:'var(--red-light)' }}>{results?.totals.fail || 0}</div><div className="stat-label">FAIL</div></div>
              </div>

              <div className="card mb-4">
                <div className="card-title">Control Producție</div>
                <div className="action-grid">
                  <button className={`action-btn setup ${activePhase==='setup'?'active-phase':''}`} onClick={() => logAction(activePhase==='setup'?'setup_end':'setup_start')}>
                    <Clock size={24} /> {activePhase==='setup' ? 'Stop Setup' : 'Start Setup'}
                  </button>
                  <button className={`action-btn working ${activePhase==='working'?'active-phase':''}`} onClick={() => logAction(activePhase==='working'?'working_end':'working_start')}>
                    <CheckCircle size={24} /> {activePhase==='working' ? 'Stop Producție' : 'Start Producție'}
                  </button>
                  <button className="action-btn delay" onClick={() => setShowDelayModal(true)}>
                    <AlertTriangle size={24} /> Raportare Delay
                  </button>
                </div>
                <div className="flex gap-2 mt-4">
                  <button className="btn btn-success" style={{ flex: 1 }} onClick={() => setShowResultModal(true)}>Înregistrare Rezultate</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showDelayModal && selectedAlloc && (
        <OperatorDelayModal alloc={selectedAlloc} onClose={() => setShowDelayModal(false)} onSave={async () => { setShowDelayModal(false); await loadActions(selectedAlloc); }} />
      )}
      {showResultModal && selectedAlloc && (
        <ResultModal alloc={selectedAlloc} onClose={() => setShowResultModal(false)} onSave={async () => { setShowResultModal(false); await loadActions(selectedAlloc); loadAllocations(); }} />
      )}
    </div>
  );
}

// (Modals implementation remains similar but updated to use simplified structure)
function OperatorDelayModal({ alloc, onClose, onSave }) {
  const [form, setForm] = useState({ delay_start:'', delay_end:'', reason:'' });
  const handleSubmit = async (e) => {
    e.preventDefault();
    const start = new Date(form.delay_start);
    const end = new Date(form.delay_end);
    const delayMin = Math.ceil((end - start) / 60000);
    if (delayMin <= 0) return toast.error('Interval invalid');

    await api.post(`/orders/${alloc.order_id}/delay`, { delay_minutes: delayMin, reason: form.reason, source:'operator' });
    await api.post('/production/actions', { allocation_id: alloc.id, action_type:'delay_start', notes: form.reason });
    onSave();
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3>Raportare Delay</h3><button onClick={onClose}><X size={16}/></button></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label>Start</label><input className="form-input" type="datetime-local" value={form.delay_start} onChange={e=>setForm(p=>({...p,delay_start:e.target.value}))} required/></div>
          <div className="form-group"><label>Sfârșit</label><input className="form-input" type="datetime-local" value={form.delay_end} onChange={e=>setForm(p=>({...p,delay_end:e.target.value}))} required/></div>
          <div className="form-group"><label>Motiv</label><textarea className="form-textarea" value={form.reason} onChange={e=>setForm(p=>({...p,reason:e.target.value}))} required/></div>
          <div className="modal-footer"><button type="submit" className="btn btn-danger">Raportează</button></div>
        </form>
      </div>
    </div>
  );
}

function ResultModal({ alloc, onClose, onSave }) {
  const [qtyOk, setQtyOk] = useState(0);
  const [qtyFail, setQtyFail] = useState(0);
  const handleSubmit = async (e) => {
    e.preventDefault();
    await api.post('/production/results', { order_id: alloc.order_id, qty_ok: parseInt(qtyOk), qty_fail: parseInt(qtyFail) });
    onSave();
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3>Înregistrare Rezultate</h3><button onClick={onClose}><X size={16}/></button></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label>Cantitate OK</label><input className="form-input" type="number" value={qtyOk} onChange={e=>setQtyOk(e.target.value)}/></div>
          <div className="form-group"><label>Cantitate FAIL</label><input className="form-input" type="number" value={qtyFail} onChange={e=>setQtyFail(e.target.value)}/></div>
          <div className="modal-footer"><button type="submit" className="btn btn-success">Salvează</button></div>
        </form>
      </div>
    </div>
  );
}
