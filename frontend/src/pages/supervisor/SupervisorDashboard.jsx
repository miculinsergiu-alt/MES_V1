import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { LayoutDashboard, BarChart2, Users, FileText, Plus, X, ChevronLeft, ChevronRight, Factory } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import GanttTimeline from '../../components/GanttTimeline';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format, addDays, subDays } from 'date-fns';
import { ro } from 'date-fns/locale';

export default function SupervisorDashboard() {
  const [tab, setTab] = useState('gantt');
  const [orders, setOrders] = useState([]);
  const [machines, setMachines] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [machineStatus, setMachineStatus] = useState({});

  const loadData = useCallback(async () => {
    const fetchData = async (url, setter) => {
      try { const r = await api.get(url); setter(r.data); }
      catch (err) { console.error(`Failed to fetch ${url}:`, err); }
    };
    fetchData('/orders/gantt', setOrders);
    fetchData('/machines', setMachines);
    fetchData('/users/shifts/all', setShifts);
    fetchData('/users', setUsers);
    fetchData('/shift-reports', setReports);
  }, []);

  useEffect(() => { 
    loadData(); 
    const i = setInterval(loadData, 15000); 
    return () => clearInterval(i); 
  }, [loadData]);

  const loadMachineStatus = async (machineId) => {
    try { 
      const r = await api.get(`/production/machine/${machineId}/status`); 
      setMachineStatus(p => ({ ...p, [machineId]: r.data })); 
    } catch {}
  };

  useEffect(() => { 
    if (machines.length > 0) machines.forEach(m => loadMachineStatus(m.id)); 
  }, [machines]);

  const location = useLocation();
  useEffect(() => {
    const p = location.pathname.split('/').pop();
    if (['gantt','machines','shifts','reports','shift-reports'].includes(p)) setTab(p);
    else if (location.pathname === '/supervisor' || location.pathname === '/supervisor/') setTab('gantt');
  }, [location]);

  const navItems = [
    { path:'/supervisor/gantt', label:'Gantt Producție', icon:<LayoutDashboard size={16}/> },
    { path:'/supervisor/machines', label:'Status Utilaje', icon:<Factory size={16}/> },
    { path:'/supervisor/reports', label:'Performanță', icon:<BarChart2 size={16}/> },
    { path:'/supervisor/shifts', label:'Gestiune Schimburi', icon:<Users size={16}/> },
    { path:'/supervisor/shift-reports', label:'Istoric Rapoarte', icon:<FileText size={16}/> },
  ];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <h1>Dashboard Area Supervisor</h1>
          <p>Monitorizare producție, rapoarte și gestionare schimburi</p>
        </div>
        <div className="page-content">

          {tab === 'gantt' && (
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <span className="card-title">Plan Producție — {format(viewDate,'EEEE, dd MMMM yyyy',{locale:ro})}</span>
                <div className="flex gap-2 items-center">
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => subDays(d,1))}><ChevronLeft size={14}/></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(new Date())}>Azi</button>
                  <input 
                    type="date" 
                    className="form-input" 
                    style={{ padding: '0 8px', height: '32px', fontSize: '13px', width: 'auto' }} 
                    value={format(viewDate, 'yyyy-MM-dd')} 
                    onChange={e => { if (e.target.value) setViewDate(new Date(e.target.value)); }} 
                  />
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => addDays(d,1))}><ChevronRight size={14}/></button>
                </div>
              </div>
              <GanttTimeline orders={orders} machines={machines} viewDate={viewDate} onBlockClick={setSelectedMachine} />
            </div>
          )}

          {tab === 'machines' && (
            <div className="grid-3">
              {machines.map(m => {
                const st = machineStatus[m.id] || {};
                const hasDelay = st.activeOrder && (st.activeOrder.delays||[]).some(d=>d.applied);
                return (
                  <div key={m.id} className={`machine-card ${st.activeOrder ? (hasDelay?'delayed':'active') : ''}`} onClick={() => loadMachineStatus(m.id)}>
                    <div className="flex justify-between items-center mb-2">
                      <span style={{ fontWeight:600, fontSize:15 }}>{m.name}</span>
                      <span className={`machine-status-dot ${st.activeOrder ? (hasDelay?'delayed':'active') : 'idle'}`} />
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:8 }}>{m.area_name}</div>
                    {st.activeOrder ? (
                      <>
                        <div style={{ fontSize:13, fontWeight:500 }}>{st.activeOrder.product_name}</div>
                        <div style={{ marginTop:8 }}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-muted">Progres</span>
                            <span style={{ color:'var(--green-light)' }}>{st.progress}%</span>
                          </div>
                          <div className="progress-bar"><div className="progress-fill green" style={{ width:`${st.progress}%` }} /></div>
                        </div>
                        <div className="flex gap-3 mt-2">
                          <span style={{ fontSize:11, color:'var(--green-light)' }}>✓ {st.totalOk} OK</span>
                          <span style={{ fontSize:11, color:'var(--red-light)' }}>✗ {st.totalFail} FAIL</span>
                        </div>
                        {st.currentAlloc && <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>Op: {st.currentAlloc.first_name} {st.currentAlloc.last_name}</div>}
                        {hasDelay && <div className="badge badge-red" style={{ marginTop:8 }}>⚠ Delay activ</div>}
                      </>
                    ) : <div style={{ color:'var(--text-muted)', fontSize:13 }}>Utilaj liber</div>}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'shifts' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <span style={{ fontWeight:600 }}>Schimburi Active</span>
                <button className="btn btn-primary btn-sm" onClick={() => setShowShiftModal(true)}><Plus size={14}/> Schimb Nou</button>
              </div>
              <div className="grid-2">
                {shifts.map(s => (
                  <div key={s.id} className="card">
                    <div className="flex justify-between items-center mb-2">
                      <span style={{ fontWeight:700, fontSize:16 }}>{s.name}</span>
                      <span className="badge badge-blue">{s.members?.length || 0} membri</span>
                    </div>
                    {s.responsible && <div style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:12 }}>Responsabil: <strong>{s.responsible.first_name} {s.responsible.last_name}</strong></div>}
                    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                      {(s.members||[]).filter(m => m.role === 'operator').map(m => (
                        <div key={m.id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:'var(--bg-primary)', borderRadius:6, fontSize:13 }}>
                          <span>{m.first_name} {m.last_name}</span>
                          <span style={{ fontSize:11, color:'var(--text-muted)' }}>#{m.badge_number}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'reports' && <PerformanceTab orders={orders} machines={machines} users={users} />}

          {tab === 'shift-reports' && (
            <div>
              {reports.length === 0 && <div className="empty-state">Niciun raport de schimb disponibil</div>}
              {reports.map(r => (
                <div key={r.id} className="card" style={{ marginBottom:12 }}>
                  <div className="flex justify-between items-center mb-2">
                    <span style={{ fontWeight:600 }}>Raport {r.report_date} — Schimb #{r.shift_id}</span>
                    <span className="badge badge-blue">{r.issues?.length || 0} probleme</span>
                  </div>
                  {r.general_notes && <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:8 }}>{r.general_notes}</p>}
                  {(r.issues||[]).map(issue => (
                    <div key={issue.id} style={{ padding:'8px 12px', background:'var(--bg-primary)', borderRadius:6, marginBottom:6, borderLeft:'3px solid var(--red)' }}>
                      <div style={{ fontSize:13, fontWeight:500 }}>{issue.description}</div>
                      {issue.delay_minutes > 0 && <div style={{ fontSize:11, color:'var(--red-light)', marginTop:2 }}>Delay: {issue.delay_minutes} min {issue.delay_already_logged ? '(deja logat)' : ''}</div>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {showShiftModal && <CreateShiftModal users={users} onClose={() => setShowShiftModal(false)} onSave={() => { loadData(); setShowShiftModal(false); }} />}
    </div>
  );
}

function PerformanceTab({ orders, machines, users }) {
  const byMachine = machines.map(m => {
    const mOrders = orders.filter(o => o.machine_id === m.id);
    const done = mOrders.filter(o => o.status === 'done').length;
    const delayed = mOrders.filter(o => (o.delays||[]).some(d=>d.applied)).length;
    return { ...m, total: mOrders.length, done, delayed, onTime: done - delayed };
  });

  return (
    <div>
      <div className="card mb-4">
        <div className="card-title">Performanță pe Utilaj</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Utilaj</th><th>Total Comenzi</th><th>Finalizate</th><th>La Timp</th><th>Cu Delay</th><th>Rată Succes</th></tr></thead>
            <tbody>
              {byMachine.map(m => (
                <tr key={m.id}>
                  <td style={{ fontWeight:500, color:'var(--text-primary)' }}>{m.name}</td>
                  <td>{m.total}</td>
                  <td><span className="badge badge-green">{m.done}</span></td>
                  <td><span className="badge badge-blue">{m.onTime}</span></td>
                  <td><span className="badge badge-red">{m.delayed}</span></td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="progress-bar" style={{ width:80 }}>
                        <div className="progress-fill green" style={{ width: m.total ? `${(m.done/m.total)*100}%` : '0%' }} />
                      </div>
                      <span style={{ fontSize:12 }}>{m.total ? Math.round((m.done/m.total)*100) : 0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid-3">
        {[['Total Comenzi',orders.length,'var(--blue-light)'],['Finalizate',orders.filter(o=>o.status==='done').length,'var(--green-light)'],['Cu Delay',orders.filter(o=>(o.delays||[]).some(d=>d.applied)).length,'var(--red-light)']].map(([l,v,c]) => (
          <div key={l} className="card stat-card"><div style={{ fontSize:36, fontWeight:800, color:c }}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
    </div>
  );
}

function CreateShiftModal({ users, onClose, onSave }) {
  const [form, setForm] = useState({ name:'', shift_responsible_id:'', operator_ids:[] });
  const responsibles = users.filter(u => u.role === 'shift_responsible');
  const operators = users.filter(u => u.role === 'operator');

  const toggleOp = (id) => setForm(p => ({ ...p, operator_ids: p.operator_ids.includes(id) ? p.operator_ids.filter(x=>x!==id) : [...p.operator_ids, id] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try { await api.post('/users/shifts', { ...form, shift_responsible_id: parseInt(form.shift_responsible_id) }); toast.success('Schimb creat'); onSave(); }
    catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3>Creare Schimb Nou</h3><button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Denumire Schimb</label><input className="form-input" placeholder="ex: Sch. A" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required /></div>
          <div className="form-group">
            <label className="form-label">Shift Responsible</label>
            <select className="form-select" value={form.shift_responsible_id} onChange={e=>setForm(p=>({...p,shift_responsible_id:e.target.value}))} required>
              <option value="">Selectați...</option>
              {responsibles.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} #{u.badge_number}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Operatori</label>
            <div style={{ maxHeight:200, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
              {operators.map(u => (
                <label key={u.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background:'var(--bg-primary)', borderRadius:6, cursor:'pointer', fontSize:13 }}>
                  <input type="checkbox" checked={form.operator_ids.includes(u.id)} onChange={() => toggleOp(u.id)} />
                  {u.first_name} {u.last_name} <span style={{ color:'var(--text-muted)', fontSize:11 }}>#{u.badge_number}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary">Creare Schimb</button>
          </div>
        </form>
      </div>
    </div>
  );
}
