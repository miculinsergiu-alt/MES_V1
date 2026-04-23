import { useState, useEffect, useCallback, useRef } from 'react';
import { LayoutDashboard, Users, FileText, Printer, Plus, X, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import GanttTimeline from '../../components/GanttTimeline';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format, addDays, subDays } from 'date-fns';
import { ro } from 'date-fns/locale';

export default function ShiftDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [machines, setMachines] = useState([]);
  const [operators, setOperators] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [myShift, setMyShift] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [showAllocModal, setShowAllocModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [conflictData, setConflictData] = useState(null);
  const [pendingAlloc, setPendingAlloc] = useState(null);
  const printRef = useRef();

  const loadData = useCallback(async () => {
    try {
      const [oRes, mRes, sRes, uRes] = await Promise.all([
        api.get('/orders/gantt'), api.get('/machines'),
        api.get('/users/shifts/all'), api.get('/users/operators'),
      ]);
      setOrders(oRes.data); setMachines(mRes.data); setOperators(uRes.data);
      setShifts(sRes.data);
      const mine = sRes.data.find(s => s.shift_responsible_id === user?.id || (s.members||[]).some(m=>m.id===user?.id));
      setMyShift(mine);
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

  const handleConfirmWithDelay = async () => {
    try {
      await api.post('/production/allocations', { ...pendingAlloc, force_with_delay: true });
      toast.success(`Operator alocat cu delay de ${conflictData.delay_minutes} minute`);
      setShowConflictModal(false); setPendingAlloc(null); setConflictData(null); loadData();
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  const handlePrint = () => window.print();

  const navItems = [
    { path:'/shift', label:'Comenzi Schimb', icon:<LayoutDashboard size={16}/> },
    { path:'/shift/gantt', label:'Gantt', icon:<LayoutDashboard size={16}/> },
    { path:'/shift/report', label:'Raport Schimb', icon:<FileText size={16}/> },
  ];

  const myOrders = myShift
    ? orders.filter(o => o.status !== 'cancelled')
    : orders.filter(o => o.status !== 'cancelled');

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <div className="flex justify-between items-center">
            <div><h1>Dashboard Shift Responsible</h1><p>Gestionare operatori și plan de lucru — {myShift?.name || 'Fără schimb asignat'}</p></div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={handlePrint} id="print-btn"><Printer size={16}/> Printare Plan</button>
              <button className="btn btn-primary" onClick={() => setShowAllocModal(true)}><Plus size={16}/> Alocare Operator</button>
            </div>
          </div>
        </div>
        <div className="page-content" ref={printRef}>
          <div className="tabs no-print">
            {[['orders','📋 Comenzi Alocate'],['gantt','📊 Gantt'],['report','📝 Raport Schimb']].map(([k,l]) => (
              <button key={k} className={`tab-btn ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === 'orders' && (
            <div>
              <div className="grid-3" style={{ marginBottom:16 }}>
                {[['Comenzi Active',myOrders.filter(o=>o.status==='active').length,'var(--green-light)'],['În Așteptare',myOrders.filter(o=>o.status==='pending').length,'var(--yellow-light)'],['Cu Delay',myOrders.filter(o=>(o.delays||[]).some(d=>d.applied)).length,'var(--red-light)']].map(([l,v,c]) => (
                  <div key={l} className="card stat-card"><div style={{ fontSize:32, fontWeight:800, color:c }}>{v}</div><div className="stat-label">{l}</div></div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">Comenzi Schimb {myShift?.name}</div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Produs</th><th>Utilaj</th><th>Interval Planificat</th><th>Cantitate</th><th>Status</th><th>Acțiuni</th></tr></thead>
                    <tbody>
                      {myOrders.map(o => {
                        const machine = machines.find(m => m.id === o.machine_id);
                        const hasDelay = (o.delays||[]).some(d=>d.applied);
                        return (
                          <tr key={o.id}>
                            <td style={{ fontWeight:500, color:'var(--text-primary)' }}>{o.product_name}</td>
                            <td>{machine?.name || `#${o.machine_id}`}</td>
                            <td style={{ fontSize:12 }}>
                              {o.planned_start?.substring(0,16)} → {o.planned_end?.substring(0,16)}
                              {hasDelay && <span className="badge badge-red" style={{ marginLeft:6 }}>Delay</span>}
                            </td>
                            <td>{o.quantity} buc</td>
                            <td><span className={`badge ${o.status==='active'?'badge-green':o.status==='done'?'badge-blue':'badge-gray'}`}>{o.status}</span></td>
                            <td><button className="btn btn-primary btn-sm" onClick={() => setShowAllocModal(o)}><Users size={12}/> Alocare</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'gantt' && (
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <span className="card-title">{format(viewDate,'EEEE, dd MMMM yyyy',{locale:ro})}</span>
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => subDays(d,1))}><ChevronLeft size={14}/></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(new Date())}>Azi</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => addDays(d,1))}><ChevronRight size={14}/></button>
                </div>
              </div>
              <GanttTimeline orders={orders} machines={machines} viewDate={viewDate} />
            </div>
          )}

          {tab === 'report' && (
            <ShiftReportForm shift={myShift} orders={myOrders} machines={machines} userId={user?.id} onSave={() => toast.success('Raport salvat')} />
          )}
        </div>
      </div>

      {showAllocModal && (
        <AllocateModal
          order={typeof showAllocModal === 'object' ? showAllocModal : null}
          orders={myOrders}
          machines={machines}
          operators={myShift?.members?.filter(m=>m.role==='operator') || operators}
          onClose={() => setShowAllocModal(false)}
          onAllocate={handleAllocate}
        />
      )}
      {showConflictModal && conflictData && (
        <ConflictModal
          data={conflictData}
          onConfirmDelay={handleConfirmWithDelay}
          onChooseOther={() => { setShowConflictModal(false); setPendingAlloc(null); setConflictData(null); setShowAllocModal(true); }}
          onClose={() => { setShowConflictModal(false); setPendingAlloc(null); setConflictData(null); }}
        />
      )}
    </div>
  );
}

function AllocateModal({ order, orders, machines, operators, onClose, onAllocate }) {
  const [form, setForm] = useState({
    order_id: order?.id || '',
    machine_id: order?.machine_id || '',
    operator_id: '',
    start_time: order?.planned_start?.replace(' ','T') || '',
    end_time: order?.planned_end?.replace(' ','T') || '',
    phase: 'working',
  });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  const handleSubmit = (e) => {
    e.preventDefault();
    onAllocate({ ...form, order_id:parseInt(form.order_id), machine_id:parseInt(form.machine_id), operator_id:parseInt(form.operator_id),
      start_time: form.start_time.replace('T',' '), end_time: form.end_time.replace('T',' ') });
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3>Alocare Operator pe Utilaj</h3><button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Comandă</label>
            <select className="form-select" value={form.order_id} onChange={e=>{const o=orders.find(x=>x.id===+e.target.value);set('order_id',e.target.value);if(o){set('machine_id',o.machine_id);set('start_time',o.planned_start?.replace(' ','T')||'');set('end_time',o.planned_end?.replace(' ','T')||'');}}} required>
              <option value="">Selectați comanda...</option>
              {orders.filter(o=>o.status!=='done'&&o.status!=='cancelled').map(o=><option key={o.id} value={o.id}>{o.product_name} — {machines.find(m=>m.id===o.machine_id)?.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Operator</label>
            <select className="form-select" value={form.operator_id} onChange={e=>set('operator_id',e.target.value)} required>
              <option value="">Selectați operatorul...</option>
              {operators.map(u=><option key={u.id} value={u.id}>{u.first_name} {u.last_name} #{u.badge_number}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Start</label><input className="form-input" type="datetime-local" value={form.start_time} onChange={e=>set('start_time',e.target.value)} required /></div>
            <div className="form-group"><label className="form-label">Sfârșit</label><input className="form-input" type="datetime-local" value={form.end_time} onChange={e=>set('end_time',e.target.value)} required /></div>
          </div>
          <div className="form-group">
            <label className="form-label">Fază</label>
            <select className="form-select" value={form.phase} onChange={e=>set('phase',e.target.value)}>
              <option value="setup">Setup Time</option>
              <option value="working">Working Time</option>
              <option value="supervision">Supervision Time</option>
            </select>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary">Alocare</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConflictModal({ data, onConfirmDelay, onChooseOther, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3 style={{ color:'var(--red-light)' }}><AlertTriangle size={18} style={{ verticalAlign:'middle', marginRight:8 }} />Conflict de Alocare</h3><button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button></div>
        <div className="conflict-box">
          <p style={{ fontSize:14, marginBottom:8 }}>{data.message}</p>
          {data.conflicts.map((c,i) => (
            <div key={i} style={{ fontSize:12, color:'var(--text-muted)' }}>
              • Utilaj #{c.machine_id} — {c.product_name}: {c.start_time?.substring(0,16)} → {c.end_time?.substring(0,16)} ({c.phase})
            </div>
          ))}
        </div>
        <div className="alert alert-warning">
          Confirmând cu delay, se va adăuga un delay de <strong>{data.delay_minutes} minute</strong> la noua alocare, iar planul se va actualiza automat.
        </div>
        <div className="modal-footer" style={{ justifyContent:'space-between' }}>
          <button className="btn btn-ghost" onClick={onClose}>Anulare</button>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={onChooseOther}><Users size={14}/> Alt Operator</button>
            <button className="btn btn-warning" onClick={onConfirmDelay}><AlertTriangle size={14}/> Confirmă cu Delay {data.delay_minutes}m</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShiftReportForm({ shift, orders, machines, userId, onSave }) {
  const [form, setForm] = useState({ shift_id: shift?.id || '', report_date: new Date().toISOString().substring(0,10), general_notes: '', issues: [] });
  const addIssue = () => setForm(p => ({ ...p, issues: [...p.issues, { machine_id:'', order_id:'', description:'', delay_minutes:0 }] }));
  const setIssue = (i,k,v) => setForm(p => ({ ...p, issues: p.issues.map((is,idx) => idx===i ? {...is,[k]:v} : is) }));
  const removeIssue = (i) => setForm(p => ({ ...p, issues: p.issues.filter((_,idx)=>idx!==i) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/shift-reports', {
        ...form, shift_id: shift?.id || form.shift_id,
        issues: form.issues.map(is => ({ ...is, machine_id: is.machine_id ? parseInt(is.machine_id) : null, order_id: is.order_id ? parseInt(is.order_id) : null, delay_minutes: parseInt(is.delay_minutes)||0 }))
      });
      toast.success('Raport de schimb salvat'); onSave();
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  return (
    <div className="card">
      <div className="card-title">Raport Sfârșit de Schimb — {shift?.name || '—'}</div>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Data</label><input className="form-input" type="date" value={form.report_date} onChange={e=>setForm(p=>({...p,report_date:e.target.value}))} required /></div>
        </div>
        <div className="form-group"><label className="form-label">Note Generale</label><textarea className="form-textarea" value={form.general_notes} onChange={e=>setForm(p=>({...p,general_notes:e.target.value}))} placeholder="Observații generale ale schimbului..." /></div>
        <div className="divider" />
        <div className="flex justify-between items-center mb-3">
          <span style={{ fontWeight:600, fontSize:14 }}>Probleme Întâmpinate</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addIssue}><Plus size={14}/> Adaugă Problemă</button>
        </div>
        {form.issues.map((issue,i) => (
          <div key={i} style={{ background:'var(--bg-primary)', padding:16, borderRadius:'var(--radius-sm)', marginBottom:12, border:'1px solid var(--border)' }}>
            <div className="flex justify-between mb-2"><span style={{ fontSize:13, fontWeight:600 }}>Problema {i+1}</span><button type="button" className="btn btn-ghost btn-sm" onClick={()=>removeIssue(i)}><X size={12}/></button></div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Utilaj</label>
                <select className="form-select" value={issue.machine_id} onChange={e=>setIssue(i,'machine_id',e.target.value)}>
                  <option value="">Selectați...</option>
                  {machines.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Comandă</label>
                <select className="form-select" value={issue.order_id} onChange={e=>setIssue(i,'order_id',e.target.value)}>
                  <option value="">Selectați...</option>
                  {orders.filter(o=>!issue.machine_id||o.machine_id===+issue.machine_id).map(o=><option key={o.id} value={o.id}>{o.product_name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group"><label className="form-label">Descriere Problemă</label><textarea className="form-textarea" value={issue.description} onChange={e=>setIssue(i,'description',e.target.value)} required placeholder="Descrieți problema..." /></div>
            <div className="form-group"><label className="form-label">Delay Creat (minute)</label><input className="form-input" type="number" min={0} value={issue.delay_minutes} onChange={e=>setIssue(i,'delay_minutes',e.target.value)} /></div>
          </div>
        ))}
        <div className="modal-footer" style={{ padding:0, border:0, marginTop:16 }}>
          <button type="submit" className="btn btn-primary">Salvare Raport Schimb</button>
        </div>
      </form>
    </div>
  );
}
