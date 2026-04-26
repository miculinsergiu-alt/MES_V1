import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Clock, CheckCircle, AlertTriangle, X, FileText, Image as ImageIcon, Play, Square, Settings } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';

export default function OperatorDashboard() {
  const { user } = useAuth();
  const [allocations, setAllocations] = useState([]);
  const [selectedAlloc, setSelectedAlloc] = useState(null);
  const [itemDetails, setItemDetails] = useState(null);
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
      setResults(rRes.data);
      setItemDetails(iRes.data);
      
      const last = aRes.data[aRes.data.length - 1];
      if (last) {
        if (last.action_type.includes('start')) setActivePhase(last.action_type.replace('_start',''));
        if (last.action_type.includes('end')) setActivePhase(null);
      } else {
        setActivePhase(null);
      }
    } catch {}
  };

  const selectAlloc = async (alloc) => {
    setSelectedAlloc(alloc);
    await loadActions(alloc);
  };

  const logAction = async (phase, type) => {
    const actionType = `${phase}_${type}`;
    try {
      await api.post('/production/actions', { allocation_id: selectedAlloc.id, action_type: actionType });
      toast.success(type === 'start' ? `Ați început faza de ${phase}` : `Ați finalizat faza de ${phase}`);
      await loadActions(selectedAlloc);
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  const navItems = [{ path:'/operator', label:'Sarcinile Mele', icon:<LayoutDashboard size={18}/> }];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <header className="page-header">
          <h1>Sistem de Control Operator</h1>
          <p>Bun venit, {user?.first_name}! Gestionează producția în timp real.</p>
        </header>

        <div className="page-content">
          {!selectedAlloc ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {allocations.length === 0 && <div className="card col-span-full py-20 text-center italic text-muted-foreground">Nu aveți nicio comandă alocată în acest moment.</div>}
              {allocations.map(alloc => (
                <div key={alloc.id} className="card hover:border-accent cursor-pointer group transition-all" onClick={() => selectAlloc(alloc)}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="font-mono text-[10px] uppercase font-bold text-accent tracking-widest">Utilaj #{alloc.machine_id}</span>
                      <h3 className="text-xl font-bold text-foreground mt-1">{alloc.product_name}</h3>
                    </div>
                    <div className="p-2 rounded-lg bg-muted group-hover:bg-accent/10 group-hover:text-accent transition-colors">
                      <Settings size={20} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                    <div className="flex items-center gap-1.5"><Clock size={14}/> {alloc.quantity} buc</div>
                    <div className="flex items-center gap-1.5"><CheckCircle size={14}/> {alloc.phase}</div>
                  </div>
                  <button className="btn btn-primary w-full">Deschide Control</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="max-w-4xl">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <button className="btn btn-secondary h-12 w-12 p-0 rounded-2xl" onClick={() => setSelectedAlloc(null)}>←</button>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">{selectedAlloc.product_name}</h2>
                    <p className="text-muted-foreground font-mono text-sm uppercase tracking-wider">Stație de lucru: #{selectedAlloc.machine_id}</p>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  {itemDetails?.sop_url && (
                    <a href={itemDetails.sop_url} target="_blank" rel="noreferrer" className="btn btn-secondary gap-2">
                      <FileText size={18}/> SOP
                    </a>
                  )}
                  {itemDetails?.drawing_url && (
                    <a href={itemDetails.drawing_url} target="_blank" rel="noreferrer" className="btn btn-secondary gap-2">
                      <ImageIcon size={18}/> Desen
                    </a>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="card text-center py-8">
                  <div className="text-3xl font-display text-foreground">{selectedAlloc.quantity}</div>
                  <div className="text-[10px] font-bold uppercase text-muted-foreground mt-1">Target</div>
                </div>
                <div className="card text-center py-8 border-green-200 bg-green-50/30">
                  <div className="text-3xl font-display text-green-600">{results?.totals.ok || 0}</div>
                  <div className="text-[10px] font-bold uppercase text-green-600/70 mt-1">Conform</div>
                </div>
                <div className="card text-center py-8 border-red-200 bg-red-50/30">
                  <div className="text-3xl font-display text-red-600">{results?.totals.fail || 0}</div>
                  <div className="text-[10px] font-bold uppercase text-red-600/70 mt-1">Defect</div>
                </div>
              </div>

              <div className="card p-10">
                <h3 className="text-lg font-bold mb-8 text-center uppercase tracking-widest text-muted-foreground">Panou Execuție</h3>
                <div className="op-action-grid">
                  {/* SETUP */}
                  <button 
                    className={`op-btn op-btn-setup ${activePhase === 'setup' ? 'active' : ''}`}
                    onClick={() => logAction('setup', activePhase === 'setup' ? 'end' : 'start')}
                    disabled={activePhase && activePhase !== 'setup'}
                  >
                    {activePhase === 'setup' ? <Square size={32} /> : <Settings size={32} />}
                    <span className="text-lg">{activePhase === 'setup' ? 'STOP SETUP' : 'START SETUP'}</span>
                  </button>

                  {/* WORKING */}
                  <button 
                    className={`op-btn op-btn-working ${activePhase === 'working' ? 'active' : ''}`}
                    onClick={() => logAction('working', activePhase === 'working' ? 'end' : 'start')}
                    disabled={activePhase && activePhase !== 'working'}
                  >
                    {activePhase === 'working' ? <Square size={32} /> : <Play size={32} />}
                    <span className="text-lg">{activePhase === 'working' ? 'STOP PRODUCȚIE' : 'START PRODUCȚIE'}</span>
                  </button>

                  {/* DELAY */}
                  <button className="op-btn op-btn-delay" onClick={() => setShowDelayModal(true)}>
                    <AlertTriangle size={32} />
                    <span className="text-lg">RAPORTARE DELAY</span>
                  </button>

                  {/* RESULTS */}
                  <button className="op-btn op-btn-done" onClick={() => setShowResultModal(true)}>
                    <CheckCircle size={32} />
                    <span className="text-lg">ÎNREGISTRARE PIESE</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showDelayModal && (
        <OperatorDelayModal 
          alloc={selectedAlloc} 
          onClose={() => setShowDelayModal(false)} 
          onSave={async () => { setShowDelayModal(false); await loadActions(selectedAlloc); }} 
        />
      )}
      {showResultModal && (
        <ResultModal 
          alloc={selectedAlloc} 
          onClose={() => setShowResultModal(false)} 
          onSave={async () => { setShowResultModal(false); await loadActions(selectedAlloc); loadAllocations(); }} 
        />
      )}
    </div>
  );
}

function OperatorDelayModal({ alloc, onClose, onSave }) {
  const [form, setForm] = useState({ delay_start:'', delay_end:'', reason:'' });
  const handleSubmit = async (e) => {
    e.preventDefault();
    const start = new Date(form.delay_start);
    const end = new Date(form.delay_end);
    const delayMin = Math.ceil((end - start) / 60000);
    if (delayMin <= 0) return toast.error('Intervalul orar este invalid.');

    try {
      await api.post(`/orders/${alloc.order_id}/delay`, { delay_minutes: delayMin, reason: form.reason, source:'operator' });
      await api.post('/production/actions', { allocation_id: alloc.id, action_type:'delay_start', notes: form.reason });
      toast.success('Întârzierea a fost raportată.');
      onSave();
    } catch(err) { toast.error('Eroare la trimiterea raportului.'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center">
          <h3 className="font-display text-2xl">Raportare Întârziere</h3>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-muted-foreground uppercase">De la ora</label>
              <input className="w-full h-12 rounded-xl border border-border px-4" type="datetime-local" value={form.delay_start} onChange={e=>setForm(p=>({...p,delay_start:e.target.value}))} required/>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-muted-foreground uppercase">Până la ora</label>
              <input className="w-full h-12 rounded-xl border border-border px-4" type="datetime-local" value={form.delay_end} onChange={e=>setForm(p=>({...p,delay_end:e.target.value}))} required/>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-muted-foreground uppercase">Motivul Întârzierii</label>
            <textarea className="w-full rounded-xl border border-border p-4 min-h-[100px]" value={form.reason} onChange={e=>setForm(p=>({...p,reason:e.target.value}))} placeholder="Descrieți pe scurt cauza..." required/>
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary bg-red-600 flex-1">Raportează</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResultModal({ alloc, onClose, onSave }) {
  const [qtyOk, setQtyOk] = useState(0);
  const [qtyFail, setQtyFail] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/production/results', { order_id: alloc.order_id, qty_ok: parseInt(qtyOk), qty_fail: parseInt(qtyFail) });
      toast.success('Rezultate salvate.');
      onSave();
    } catch(err) { toast.error('Eroare la salvare.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center">
          <h3 className="font-display text-2xl">Înregistrare Producție</h3>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-muted-foreground uppercase">Piese Bune (OK)</label>
            <input className="w-full h-14 text-2xl text-center rounded-xl border-2 border-green-200 bg-green-50/20" type="number" value={qtyOk} onChange={e=>setQtyOk(e.target.value)}/>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-muted-foreground uppercase">Piese Defecte (FAIL)</label>
            <input className="w-full h-14 text-2xl text-center rounded-xl border-2 border-red-200 bg-red-50/20" type="number" value={qtyFail} onChange={e=>setQtyFail(e.target.value)}/>
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={loading}>Salvează</button>
          </div>
        </form>
      </div>
    </div>
  );
}
