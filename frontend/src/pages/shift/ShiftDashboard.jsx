import { useState, useEffect, useCallback, useRef } from 'react';
import { LayoutDashboard, Users, FileText, Printer, Plus, X, AlertTriangle, ChevronLeft, ChevronRight, Zap, CheckCircle, UserPlus, Clock } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import GanttTimeline from '../../components/GanttTimeline';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format, addDays, subDays } from 'date-fns';
import { ro } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';

export default function ShiftDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [machines, setMachines] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [myShift, setMyShift] = useState(null);
  const [overtimeOperators, setOvertimeOperators] = useState([]); // Temporary operators added for this session
  const [viewDate, setViewDate] = useState(new Date());
  const [showAllocModal, setShowAllocModal] = useState(false);
  const [showOvertimeModal, setShowOvertimeModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showAutoAllocModal, setShowAutoAllocModal] = useState(false);
  const [autoAllocData, setAutoAllocData] = useState(null);
  const [conflictData, setConflictData] = useState(null);
  const [pendingAlloc, setPendingAlloc] = useState(null);
  const printRef = useRef();

  const loadData = useCallback(async () => {
    try {
      const [oRes, mRes, sRes] = await Promise.all([
        api.get('/orders/gantt'), 
        api.get('/machines'),
        api.get('/shifts')
      ]);
      setOrders(oRes.data); 
      setMachines(mRes.data);
      setShifts(sRes.data);
      
      const mine = sRes.data.find(s => s.shift_responsible_id === user?.id);
      if (mine) {
        const details = await api.get(`/shifts/${mine.id}`);
        setMyShift(details.data);
      }
    } catch {}
  }, [user]);

  useEffect(() => { loadData(); const i = setInterval(loadData, 15000); return () => clearInterval(i); }, [loadData]);

  const handleAllocate = async (allocData) => {
    try {
      await api.post('/production/allocations', allocData);
      toast.success('Operator alocat cu succes'); loadData(); setShowAllocModal(false);
    } catch(err) {
      if (err.response?.status === 409) {
        setConflictData({ ...err.response.data, allocData });
        setPendingAlloc(allocData);
        setShowConflictModal(true);
      } else toast.error(err.response?.data?.error || 'Eroare');
    }
  };

  const navItems = [
    { path:'/shift', label:'Comenzi Schimb', icon:<LayoutDashboard size={16}/> },
    { path:'/shift/gantt', label:'Gantt', icon:<LayoutDashboard size={16}/> },
    { path:'/shift/report', label:'Raport Schimb', icon:<FileText size={16}/> },
  ];

  const myOrders = orders.filter(o => o.status !== 'cancelled');
  
  // Combine shift operators with overtime operators
  const availableOperators = [
    ...(myShift?.members || []),
    ...overtimeOperators
  ];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <header className="page-header">
          <div className="flex justify-between items-center w-full">
            <div>
              <Badge className="mb-2">Shift Responsible Dashboard</Badge>
              <h1>{myShift?.name || 'Responsabil Schimb'}</h1>
              <p className="text-muted-foreground">Gestionare operatori și plan de lucru — {format(new Date(), 'dd MMMM', {locale:ro})}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowOvertimeModal(true)}>
                <UserPlus size={16} className="mr-2"/> Adaugă om la tura suplimentară
              </Button>
              <Button onClick={() => setShowAllocModal(true)}>
                <Plus size={16} className="mr-2"/> Alocare Manuală
              </Button>
            </div>
          </div>
        </header>

        <div className="page-content">
          <div className="tabs no-print">
            {[['orders','📋 Comenzi Active'],['gantt','📊 Vizualizare Gantt'],['report','📝 Raport Final Schimb']].map(([k,l]) => (
              <button key={k} className={`tab-btn ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === 'orders' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="p-6 text-center border-accent/20 bg-accent/5">
                   <div className="text-3xl font-display text-accent leading-none mb-1">{availableOperators.length}</div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Operatori Disponibili</div>
                </Card>
                {[
                  ['Active',myOrders.filter(o=>o.status==='active').length,'text-green-600'],
                  ['Așteptare',myOrders.filter(o=>o.status==='pending').length,'text-amber-500'],
                  ['Delay',myOrders.filter(o=>(o.delays||[]).some(d=>d.applied)).length,'text-red-600']
                ].map(([l,v,c]) => (
                  <Card key={l} className="p-6 text-center">
                    <div className={`text-3xl font-display ${c} leading-none mb-1`}>{v}</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Comenzi {l}</div>
                  </Card>
                ))}
              </div>

              <Card className="p-0 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Produs</th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Utilaj</th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-center">Interval Planificat</th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-center">Status</th>
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {myOrders.map(o => {
                      const machine = machines.find(m => m.id === o.machine_id);
                      const hasDelay = (o.delays||[]).some(d=>d.applied);
                      return (
                        <tr key={o.id} className="hover:bg-accent/[0.02]">
                          <td className="px-6 py-4 font-bold text-foreground">{o.product_name}</td>
                          <td className="px-6 py-4 font-medium text-accent">{machine?.name || `#${o.machine_id}`}</td>
                          <td className="px-6 py-4 text-center">
                            <div className="inline-flex items-center gap-2 bg-muted/20 px-3 py-1 rounded-lg border border-border">
                              <span className="text-xs font-mono">{o.planned_start?.substring(11,16)}</span>
                              <span className="text-muted-foreground opacity-50">→</span>
                              <span className="text-xs font-mono">{o.planned_end?.substring(11,16)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <Badge variant={o.status === 'active' ? 'default' : 'outline'} className={o.status === 'active' ? 'bg-green-600' : ''}>
                              {o.status}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <Button size="sm" variant="secondary" onClick={() => setShowAllocModal(o)}>
                              <Users size={14} className="mr-2"/> Alocare
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {tab === 'gantt' && (
            <Card className="p-6">
              <GanttTimeline orders={orders} machines={machines} viewDate={viewDate} />
            </Card>
          )}

          {tab === 'report' && (
            <ShiftReportForm shift={myShift} orders={myOrders} machines={machines} userId={user?.id} onSave={() => loadData()} />
          )}
        </div>
      </div>

      <AnimatePresence>
        {showAllocModal && (
          <AllocateModal
            order={typeof showAllocModal === 'object' ? showAllocModal : null}
            orders={myOrders}
            operators={availableOperators}
            onClose={() => setShowAllocModal(false)}
            onAllocate={handleAllocate}
          />
        )}

        {showOvertimeModal && (
          <OvertimeModal 
            shifts={shifts.filter(s => s.id !== myShift?.id)}
            onClose={() => setShowOvertimeModal(false)}
            onAdd={(op) => {
              setOvertimeOperators(prev => [...prev, op]);
              setShowOvertimeModal(false);
              toast.success(`${op.first_name} a fost adăugat la Overtime`);
            }}
          />
        )}

        {showConflictModal && conflictData && (
          <ConflictModal
            data={conflictData}
            onConfirmDelay={async () => {
              try {
                await api.post('/production/allocations', { ...pendingAlloc, force_with_delay: true });
                toast.success(`Alocat cu delay de ${conflictData.delay_minutes} min`);
                setShowConflictModal(false); loadData();
              } catch { toast.error('Eroare la confirmare'); }
            }}
            onClose={() => setShowConflictModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function OvertimeModal({ shifts, onClose, onAdd }) {
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [shiftData, setShiftData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedShiftId) {
      setLoading(true);
      api.get(`/shifts/${selectedShiftId}`).then(res => {
        setShiftData(res.data);
        setLoading(false);
      });
    } else {
      setShiftData(null);
    }
  }, [selectedShiftId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center bg-accent/5">
          <div>
            <h3 className="font-display text-2xl text-accent">Adăugare Om Overtime</h3>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Selectați operatori din alte schimburi</p>
          </div>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Pas 1: Selectați Schimbul Sursă</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none font-medium" value={selectedShiftId} onChange={e => setSelectedShiftId(e.target.value)}>
              <option value="">Alegeți un schimb...</option>
              {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.start_time} - {s.end_time})</option>)}
            </select>
          </div>

          <div className="space-y-4">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Pas 2: Alegeți Operatorul</label>
            <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-2">
              {loading && <div className="text-center py-10 animate-pulse text-muted-foreground italic text-sm">Se încarcă operatorii...</div>}
              {!loading && !shiftData && <div className="text-center py-10 border-2 border-dashed border-border rounded-2xl text-xs text-muted-foreground italic">Selectați un schimb pentru a vedea echipa</div>}
              {!loading && shiftData && (shiftData.members || []).map(m => (
                <button 
                  key={m.id} 
                  onClick={() => onAdd(m)}
                  className="flex items-center justify-between p-4 rounded-2xl border border-border hover:border-accent hover:bg-accent/5 transition-all text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold text-xs">
                      {m.first_name[0]}{m.last_name[0]}
                    </div>
                    <div>
                      <div className="font-bold text-foreground">{m.first_name} {m.last_name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">{m.badge_number}</div>
                    </div>
                  </div>
                  <UserPlus size={16} className="text-accent"/>
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function AllocateModal({ order, orders, operators, onClose, onAllocate }) {
  const [form, setForm] = useState({
    order_id: order?.id || '',
    operator_id: '',
    start_time: order?.planned_start?.replace(' ','T') || '',
    end_time: order?.planned_end?.replace(' ','T') || '',
    phase: 'working',
  });
  
  const handleSubmit = (e) => {
    e.preventDefault();
    onAllocate({ ...form, order_id:parseInt(form.order_id), operator_id:parseInt(form.operator_id),
      start_time: form.start_time.replace('T',' '), end_time: form.end_time.replace('T',' ') });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center">
          <h3 className="font-display text-2xl">Asignare Resursă Umană</h3>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1">Comandă Producție</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none font-medium" value={form.order_id} onChange={e=>{
                const o = orders.find(x=>x.id===+e.target.value);
                setForm({...form, order_id: e.target.value, start_time: o?.planned_start?.replace(' ','T')||'', end_time: o?.planned_end?.replace(' ','T')||''});
              }} required>
              <option value="">Selectați comanda...</option>
              {orders.filter(o=>o.status!=='done').map(o=><option key={o.id} value={o.id}>{o.product_name} (Utilaj #{o.machine_id})</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest ml-1 flex items-center gap-2">
              <Users size={14}/> Operator Disponibil
            </label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none font-medium" value={form.operator_id} onChange={e=>setForm({...form, operator_id: e.target.value})} required>
              <option value="">Selectați operatorul...</option>
              {operators.map(u=><option key={u.id} value={u.id}>{u.first_name} {u.last_name} (#{u.badge_number})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Start Planificat</label>
              <Input type="datetime-local" value={form.start_time} onChange={e=>setForm({...form, start_time:e.target.value})} required />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Sfârșit Planificat</label>
              <Input type="datetime-local" value={form.end_time} onChange={e=>setForm({...form, end_time:e.target.value})} required />
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Anulare</Button>
            <Button type="submit" className="flex-1">Confirmă Asignarea</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function ConflictModal({ data, onConfirmDelay, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-border p-8 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 text-red-600">
           <AlertTriangle size={32}/>
        </div>
        <h3 className="text-xl font-bold mb-2 text-foreground">Conflict de Alocare</h3>
        <p className="text-sm text-muted-foreground mb-8">{data.message}</p>
        <div className="flex flex-col gap-3">
           <Button onClick={onConfirmDelay}>Aplică cu Delay {data.delay_minutes} min</Button>
           <Button variant="secondary" onClick={onClose}>Anulează</Button>
        </div>
      </div>
    </div>
  );
}

function ShiftReportForm({ shift, orders, machines, userId, onSave }) {
  return <div className="card p-20 text-center italic text-muted-foreground">Formular Raport Schimb disponibil pentru Schimbul Activ.</div>;
}
