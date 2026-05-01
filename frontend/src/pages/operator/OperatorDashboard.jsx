import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Clock, CheckCircle, AlertTriangle, X, FileText, Image as ImageIcon, Play, Square, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Sidebar from '../../components/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';

export default function OperatorDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [allocations, setAllocations] = useState([]);
  const [selectedAlloc, setSelectedAlloc] = useState(null);
  const [itemDetails, setItemDetails] = useState(null);
  const [results, setResults] = useState(null);
  const [showDelayModal, setShowDelayModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showLotModal, setShowLotModal] = useState(false);
  const [activePhase, setActivePhase] = useState(null);
  const [shifts, setShifts] = useState([]);

  const loadAllocations = useCallback(async () => {
    try {
      const [allocRes, shiftsRes] = await Promise.all([
        api.get(`/production/operator/${user.id}`),
        api.get('/shifts')
      ]);
      setAllocations(allocRes.data);
      setShifts(shiftsRes.data);
    } catch {}
  }, [user.id]);

  useEffect(() => { loadAllocations(); }, [loadAllocations]);

  const getCurrentShift = () => {
    const now = new Date();
    const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    return shifts.find(s => {
      if (s.start_time < s.end_time) {
        return time >= s.start_time && time < s.end_time;
      } else {
        // Night shift
        return time >= s.start_time || time < s.end_time;
      }
    });
  };

  const currentShift = getCurrentShift();

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

  const logAction = async (phase, type, extraData = {}) => {
    const actionType = `${phase}_${type}`;
    try {
      await api.post('/production/actions', { allocation_id: selectedAlloc.id, action_type: actionType, ...extraData });
      toast.success(t(`operator.phase_${type === 'start' ? 'start' : 'end'}`, { phase }));
      await loadActions(selectedAlloc);
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  const handleSetupClick = () => {
    if (activePhase === 'setup') {
      logAction('setup', 'end');
    } else {
      setShowLotModal(true); // Open Lot scanner instead of direct start
    }
  };

  const navItems = [{ path:'/operator', labelKey:'sidebar.my_tasks', icon:<LayoutDashboard size={18}/> }];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <header className="page-header">
          <div className="flex justify-between items-center w-full">
            <div>
              <h1>{t('operator.title')}</h1>
              <p>{t('operator.welcome', { name: user?.first_name })}</p>
            </div>
            {currentShift && (
              <div className="flex items-center gap-3 bg-accent/10 px-4 py-2 rounded-2xl border border-accent/20">
                <Clock size={20} className="text-accent"/>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase text-accent leading-none">{t('operator.current_shift')}</div>
                  <div className="text-sm font-bold text-foreground">{currentShift.name} ({currentShift.start_time} - {currentShift.end_time})</div>
                </div>
              </div>
            )}
          </div>
        </header>

        <div className="page-content">
          {!selectedAlloc ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {allocations.length === 0 && <div className="card col-span-full py-20 text-center italic text-muted-foreground">{t('operator.no_allocations')}</div>}
              {allocations.map(alloc => (
                <div key={alloc.id} className="card hover:border-accent cursor-pointer group transition-all" onClick={() => selectAlloc(alloc)}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="font-mono text-[10px] uppercase font-bold text-accent tracking-widest">{t('operator.machine_hash')}{alloc.machine_id}</span>
                      <h3 className="text-xl font-bold text-foreground mt-1">{alloc.product_name}</h3>
                    </div>
                    <div className="p-2 rounded-lg bg-muted group-hover:bg-accent/10 group-hover:text-accent transition-colors">
                      <Settings size={20} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <div className="flex items-center gap-1.5"><Clock size={14}/> {alloc.quantity} {t('inventory.uom')}</div>
                  <div className="flex items-center gap-1.5"><CheckCircle size={14}/> {t(`status.${alloc.status}`)}</div>
                  </div>                  <button className="btn btn-primary w-full">{t('operator.open_control')}</button>
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
                    <p className="text-muted-foreground font-mono text-sm uppercase tracking-wider">{t('operator.workstation_hash')}{selectedAlloc.machine_id}</p>
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
                      <ImageIcon size={18}/> {t('common.edit')}
                    </a>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="card text-center py-8">
                  <div className="text-3xl font-display text-foreground">{selectedAlloc.quantity}</div>
                  <div className="text-[10px] font-bold uppercase text-muted-foreground mt-1">{t('operator.target')}</div>
                </div>
                <div className="card text-center py-8 border-green-200 bg-green-50/30">
                  <div className="text-3xl font-display text-green-600">{results?.totals.ok || 0}</div>
                  <div className="text-[10px] font-bold uppercase text-green-600/70 mt-1">{t('operator.conform')}</div>
                </div>
                <div className="card text-center py-8 border-red-200 bg-red-50/30">
                  <div className="text-3xl font-display text-red-600">{results?.totals.fail || 0}</div>
                  <div className="text-[10px] font-bold uppercase text-red-600/70 mt-1">{t('operator.defect')}</div>
                </div>
              </div>

              <div className="card p-10">
                <h3 className="text-lg font-bold mb-8 text-center uppercase tracking-widest text-muted-foreground">{t('operator.execution_panel')}</h3>
                <div className="op-action-grid">
                  {/* SETUP */}
                  <button 
                    className={`op-btn op-btn-setup ${activePhase === 'setup' ? 'active' : ''}`}
                    onClick={handleSetupClick}
                    disabled={activePhase && activePhase !== 'setup'}
                  >
                    {activePhase === 'setup' ? <Square size={32} /> : <Settings size={32} />}
                    <span className="text-lg">{activePhase === 'setup' ? t('operator.stop_setup') : t('operator.start_setup')}</span>
                  </button>

                  {/* WORKING */}
                  <button 
                    className={`op-btn op-btn-working ${activePhase === 'working' ? 'active' : ''}`}
                    onClick={() => logAction('working', activePhase === 'working' ? 'end' : 'start')}
                    disabled={activePhase && activePhase !== 'working'}
                  >
                    {activePhase === 'working' ? <Square size={32} /> : <Play size={32} />}
                    <span className="text-lg">{activePhase === 'working' ? t('operator.stop_production') : t('operator.start_production')}</span>
                  </button>

                  {/* DELAY */}
                  <button className="op-btn op-btn-delay" onClick={() => setShowDelayModal(true)}>
                    <AlertTriangle size={32} />
                    <span className="text-lg">{t('operator.report_delay')}</span>
                  </button>

                  {/* RESULTS */}
                  <button className="op-btn op-btn-done" onClick={() => setShowResultModal(true)}>
                    <CheckCircle size={32} />
                    <span className="text-lg">{t('operator.log_results')}</span>
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
      {showLotModal && (
        <LotScanModal 
          alloc={selectedAlloc} 
          onClose={() => setShowLotModal(false)} 
          onSave={(lotNumber) => { setShowLotModal(false); logAction('setup', 'start', { notes: `Scanare Lot: ${lotNumber}` }); }} 
        />
      )}
    </div>
  );
}

function OperatorDelayModal({ alloc, onClose, onSave }) {
  const [form, setForm] = useState({ delay_start:'', delay_end:'', reason:'', delay_reason_id:'', corrective_action:'' });
  const [reasons, setReasons] = useState([]);
  const { t } = useTranslation();

  useEffect(() => {
    api.get('/orders/delay-reasons').then(r => setReasons(r.data));
    // Pre-fill delay_start with current time
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localNow = new Date(now - offset).toISOString().slice(0, 16);
    setForm(p => ({ ...p, delay_start: localNow, delay_end: localNow }));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const start = new Date(form.delay_start);
    const end = new Date(form.delay_end);
    const delayMin = Math.ceil((end - start) / 60000);
    if (delayMin <= 0) return toast.error(t('operator.delay.invalid_interval'));

    try {
      await api.post(`/orders/${alloc.order_id}/delay`, { 
        delay_minutes: delayMin, 
        reason: form.reason,
        delay_reason_id: form.delay_reason_id,
        corrective_action: form.corrective_action,
        source:'operator' 
      });
      await api.post('/production/actions', { allocation_id: alloc.id, action_type:'delay_start', notes: form.reason });
      toast.success(t('operator.delay.success'));
      onSave();
    } catch(err) { toast.error(t('operator.delay.error')); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center">
          <h3 className="font-display text-2xl text-red-600">{t('operator.delay.title')}</h3>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('operator.delay.from_hour')}</label>
              <input className="w-full h-12 rounded-xl border border-border px-4 focus:ring-2 ring-red-100 outline-none" type="datetime-local" value={form.delay_start} onChange={e=>setForm(p=>({...p,delay_start:e.target.value}))} required/>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('operator.delay.to_hour')}</label>
              <input className="w-full h-12 rounded-xl border border-border px-4 focus:ring-2 ring-red-100 outline-none" type="datetime-local" value={form.delay_end} onChange={e=>setForm(p=>({...p,delay_end:e.target.value}))} required/>
            </div>
          </div>
          
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('operator.delay.cause')}</label>
            <select 
              className="w-full h-12 rounded-xl border border-border px-4 focus:ring-2 ring-red-100 outline-none appearance-none bg-slate-50"
              value={form.delay_reason_id}
              onChange={e=>setForm(p=>({...p,delay_reason_id:e.target.value}))}
              required
            >
              <option value="">{t('operator.delay.select_cause')}</option>
              {reasons.map(r => <option key={r.id} value={r.id}>{r.name} ({r.category})</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('operator.delay.description')}</label>
            <textarea className="w-full rounded-xl border border-border p-4 min-h-[80px] focus:ring-2 ring-red-100 outline-none" value={form.reason} onChange={e=>setForm(p=>({...p,reason:e.target.value}))} placeholder={t('operator.delay.placeholder_desc')} required/>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('operator.delay.corrective_actions')}</label>
            <textarea className="w-full rounded-xl border border-border p-4 min-h-[80px] focus:ring-2 ring-green-100 outline-none bg-green-50/20" value={form.corrective_action} onChange={e=>setForm(p=>({...p,corrective_action:e.target.value}))} placeholder={t('operator.delay.placeholder_corrective')} required/>
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" className="btn btn-secondary flex-1 h-14" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary bg-red-600 flex-1 h-14">{t('operator.delay.report')}</button>
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
  const { t } = useTranslation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/production/results', { order_id: alloc.order_id, qty_ok: parseInt(qtyOk), qty_fail: parseInt(qtyFail) });
      toast.success(t('operator.results.success'));
      onSave();
    } catch(err) { toast.error(t('operator.results.error')); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-lg overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center">
          <h3 className="font-display text-2xl">{t('operator.results.title')}</h3>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-muted-foreground uppercase">{t('operator.results.ok')}</label>
            <input className="w-full h-14 text-2xl text-center rounded-xl border-2 border-green-200 bg-green-50/20" type="number" value={qtyOk} onChange={e=>setQtyOk(e.target.value)}/>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-muted-foreground uppercase">{t('operator.results.fail')}</label>
            <input className="w-full h-14 text-2xl text-center rounded-xl border-2 border-red-200 bg-red-50/20" type="number" value={qtyFail} onChange={e=>setQtyFail(e.target.value)}/>
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={loading}>{t('common.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LotScanModal({ alloc, onClose, onSave }) {
  const [lot, setLot] = useState('');
  const { t } = useTranslation();
  
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!lot.trim()) return toast.error(t('operator.lot.error_scan'));
    onSave(lot);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center bg-accent/5">
          <div>
            <h3 className="font-display text-xl text-accent">{t('operator.lot.title')}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t('operator.lot.subtitle')}</p>
          </div>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6 text-center">
          <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 border-4 border-dashed border-accent animate-spin-slow rounded-full"></div>
          </div>
          <p className="text-sm font-bold text-foreground">{t('operator.lot.prompt')}</p>
          <input 
            autoFocus
            className="w-full h-14 text-2xl text-center font-mono rounded-xl border-2 border-accent/30 bg-accent/5 focus:border-accent outline-none" 
            type="text" 
            value={lot} 
            onChange={e=>setLot(e.target.value)} 
            placeholder={t('operator.lot.placeholder')}
          />
          <div className="flex gap-3 pt-4">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>{t('operator.lot.skip')}</button>
            <button type="submit" className="btn btn-primary flex-1">{t('operator.lot.confirm')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
