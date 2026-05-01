import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { LayoutDashboard, BarChart2, Users, FileText, Plus, X, ChevronLeft, ChevronRight, Factory, Clock, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Sidebar from '../../components/Sidebar';
import GanttTimeline from '../../components/GanttTimeline';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format, addDays, subDays } from 'date-fns';
import { ro, enUS } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';

export default function SupervisorDashboard() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ro' ? ro : enUS;
  const [tab, setTab] = useState('gantt');
  const [orders, setOrders] = useState([]);
  const [machines, setMachines] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [editShift, setEditShift] = useState(null);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [machineStatus, setMachineStatus] = useState({});

  const loadData = useCallback(async () => {
    try {
      const [oRes, mRes, sRes, uRes, rRes] = await Promise.all([
        api.get('/orders/gantt'),
        api.get('/machines'),
        api.get('/shifts'),
        api.get('/users'),
        api.get('/shift-reports')
      ]);
      setOrders(oRes.data);
      setMachines(mRes.data);
      setShifts(sRes.data);
      setUsers(uRes.data);
      setReports(rRes.data);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    }
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
    { path:'/supervisor/gantt', labelKey:'sidebar.gantt_production', icon:<LayoutDashboard size={16}/> },
    { path:'/supervisor/machines', labelKey:'sidebar.machine_status', icon:<Factory size={16}/> },
    { path:'/supervisor/reports', labelKey:'sidebar.performance', icon:<BarChart2 size={16}/> },
    { path:'/supervisor/shifts', labelKey:'sidebar.manage_shifts', icon:<Users size={16}/> },
    { path:'/supervisor/shift-reports', labelKey:'sidebar.shift_history', icon:<FileText size={16}/> },
  ];

  const handleDeleteShift = async (id) => {
    if (!window.confirm(t('supervisor.delete_shift_confirm'))) return;
    try {
      await api.delete(`/shifts/${id}`);
      toast.success(t('supervisor.shift_deleted'));
      loadData();
    } catch { toast.error(t('messages.delete_error')); }
  };

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <header className="page-header">
           <div className="flex justify-between items-end w-full">
              <div>
                <h1>{t('supervisor.title')}</h1>
                <p>{t('supervisor.subtitle')}</p>
              </div>
              {tab === 'shifts' && (
                <Button onClick={() => { setEditShift(null); setShowShiftModal(true); }}>
                  <Plus size={16} className="mr-2" /> {t('admin.new_shift')}
                </Button>
              )}
           </div>
        </header>
        
        <div className="page-content">

          {tab === 'gantt' && (
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <span className="card-title">{t('supervisor.production_plan', { date: format(viewDate, 'EEEE, dd MMMM yyyy', { locale: dateLocale }) })}</span>
                <div className="flex gap-2 items-center">
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => subDays(d,1))}><ChevronLeft size={14}/></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(new Date())}>{t('common.today')}</button>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {machines.map(m => {
                const st = machineStatus[m.id] || {};
                const hasDelay = st.activeOrder && (st.activeOrder.delays||[]).some(d=>d.applied);
                const isActive = !!st.activeOrder;
                
                return (
                  <div key={m.id} className={`card transition-all ${isActive ? (hasDelay ? 'border-red-300 bg-red-50/10' : 'border-green-300 bg-green-50/10') : 'hover:border-accent/30'}`}>
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{m.area_name}</span>
                        <h4 className="text-xl font-bold text-foreground">{m.name}</h4>
                      </div>
                      <div className={`h-3 w-3 rounded-full shadow-sm ${isActive ? (hasDelay ? 'bg-red-500 animate-pulse' : 'bg-green-500') : 'bg-slate-300'}`} />
                    </div>

                    {isActive ? (
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">{t('supervisor.active_order')}</p>
                          <p className="text-sm font-semibold text-foreground truncate">{st.activeOrder.product_name}</p>
                        </div>
                        
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold uppercase">
                            <span className="text-muted-foreground">{t('supervisor.production_progress')}</span>
                            <span className={hasDelay ? 'text-red-600' : 'text-green-600'}>{st.progress}%</span>
                          </div>
                          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-500 ${hasDelay ? 'bg-red-500' : 'bg-green-500'}`} 
                              style={{ width: `${st.progress}%` }} 
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                          <div className="text-center">
                            <p className="text-lg font-display text-green-600 leading-none">{st.totalOk}</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase">{t('operator.conform')}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-lg font-display text-red-600 leading-none">{st.totalFail}</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase">{t('operator.defect')}</p>
                          </div>
                        </div>

                        {st.currentAlloc && (
                          <div className="pt-3 border-t border-border/50 flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center text-[10px] font-bold text-accent">
                              {st.currentAlloc.first_name[0]}{st.currentAlloc.last_name[0]}
                            </div>
                            <span className="text-[11px] font-medium text-muted-foreground">
                              Op: {st.currentAlloc.first_name} {st.currentAlloc.last_name}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="py-10 text-center">
                        <p className="text-sm italic text-muted-foreground">{t('supervisor.machine_available')}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'shifts' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {shifts.map(s => (
                <Card key={s.id} className="p-0 overflow-hidden group">
                   <div className="p-5 border-b border-border bg-accent/5 flex justify-between items-start">
                      <div>
                         <h4 className="font-bold text-lg text-foreground">{s.name}</h4>
                         <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <Clock size={12}/> {s.start_time} - {s.end_time}
                         </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                         <button className="p-2 hover:bg-white rounded-lg text-accent shadow-sm" onClick={() => { setEditShift(s); setShowShiftModal(true); }}>
                            <ShieldCheck size={16}/>
                         </button>
                         <button className="p-2 hover:bg-red-50 rounded-lg text-red-500 shadow-sm" onClick={() => handleDeleteShift(s.id)}>
                            <X size={16}/>
                          </button>
                      </div>
                   </div>
                   <div className="p-5">
                      <div className="space-y-1">
                         <span className="text-[10px] font-black uppercase text-muted-foreground tracking-tighter">{t('roles.shift_responsible')}</span>
                         <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs text-white font-bold">
                               {s.first_name?.[0]}{s.last_name?.[0]}
                            </div>
                            <span className="text-sm font-bold">{s.first_name} {s.last_name}</span>
                         </div>
                      </div>
                   </div>
                </Card>
              ))}
              {shifts.length === 0 && <div className="card col-span-full py-20 text-center italic text-muted-foreground">{t('sidebar.no_data')}</div>}
            </div>
          )}

          {tab === 'reports' && <PerformanceTab orders={orders} machines={machines} users={users} />}

          {tab === 'shift-reports' && (
            <div className="space-y-4">
              {reports.length === 0 && <div className="card py-20 text-center italic text-muted-foreground">{t('sidebar.no_data')}</div>}
              {reports.map(r => (
                <Card key={r.id} className="p-6">
                  <div className="flex justify-between items-center mb-4 pb-4 border-b border-border">
                    <div>
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{i18n.language === 'ro' ? 'Raport Data:' : 'Report Date:'}</span>
                      <p className="font-bold text-lg">{r.report_date} — {t('sidebar.manage_shifts')} #{r.shift_id}</p>
                    </div>
                    <Badge variant="outline" className="border-accent text-accent bg-accent/5">{r.issues?.length || 0} {i18n.language === 'ro' ? 'Probleme Raportate' : 'Issues Reported'}</Badge>
                  </div>
                  {r.general_notes && <p className="text-sm text-muted-foreground bg-muted/20 p-4 rounded-xl mb-4 italic">"{r.general_notes}"</p>}
                  <div className="space-y-2">
                    {(r.issues||[]).map(issue => (
                      <div key={issue.id} className="p-3 bg-white border border-border rounded-xl flex items-center gap-4">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <div className="flex-1 text-sm font-medium text-foreground">{issue.description}</div>
                        {issue.delay_minutes > 0 && (
                          <div className="text-xs font-black text-red-600 bg-red-50 px-2 py-1 rounded-md">
                            +{issue.delay_minutes} min {issue.delay_already_logged ? '✓' : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
      
      <AnimatePresence>
        {showShiftModal && <ShiftDefinitionModal shift={editShift} users={users} onClose={() => setShowShiftModal(false)} onSave={() => { loadData(); setShowShiftModal(false); }} />}
      </AnimatePresence>
    </div>
  );
}

function ModalWrapper({ title, children, onClose, maxWidth = "max-w-xl" }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className={`bg-white rounded-3xl shadow-2xl w-full ${maxWidth} overflow-hidden border border-border flex flex-col max-h-[90vh]`}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-8 py-6 border-b border-border flex justify-between items-center bg-white sticky top-0 z-10">
          <h3 className="font-display text-2xl text-foreground">{title}</h3>
          <button className="p-2 hover:bg-muted rounded-full transition-colors" onClick={onClose}><X size={24}/></button>
        </div>
        <div className="p-8 overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}

function ShiftDefinitionModal({ shift, users, onClose, onSave }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: shift?.name || '',
    shift_responsible_id: shift?.shift_responsible_id || '',
    start_time: shift?.start_time || '06:00',
    end_time: shift?.end_time || '14:00',
    members: []
  });

  useEffect(() => {
    if (shift?.id) {
      api.get(`/shifts/${shift.id}`).then(res => {
        setFormData({
          ...res.data,
          members: res.data.members.map(m => m.id)
        });
      });
    }
  }, [shift]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.shift_responsible_id) return toast.error(t('admin.select_responsible'));
    try {
      if (shift) await api.put(`/shifts/${shift.id}`, formData);
      else await api.post('/shifts', formData);
      toast.success(t('messages.save_success'));
      onSave();
    } catch(err) { toast.error(err.response?.data?.error || t('messages.save_error')); }
  };

  const toggleMember = (userId) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.includes(userId) 
        ? prev.members.filter(id => id !== userId) 
        : [...prev.members, userId]
    }));
  };

  return (
    <ModalWrapper title={shift ? `${t('common.edit')} ${t('sidebar.manage_shifts')}` : t('admin.new_shift')} onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('sidebar.manage_shifts')}</label>
          <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="ex: Schimbul A" required />
        </div>

        <div className="grid grid-cols-2 gap-6">
           <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('operator.delay.from_hour')}</label>
              <Input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} required />
           </div>
           <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('admin.end_time')}</label>
              <Input type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} required />
           </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
            <ShieldCheck size={14} className="text-accent"/> {t('roles.shift_responsible')}
          </label>
          <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none appearance-none" value={formData.shift_responsible_id} onChange={e => setFormData({...formData, shift_responsible_id: e.target.value})} required>
            <option value="">{t('admin.select_responsible_placeholder')}</option>
            {users.filter(u => u.role === 'shift_responsible').map(u => (
              <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.badge_number})</option>
            ))}
          </select>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-border pb-2">
             <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
               <Users size={14}/> {t('admin.operators_in_shift', { count: formData.members.length })}
             </label>
          </div>
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2">
             {users.filter(u => u.role === 'operator').map(u => {
               const isSelected = formData.members.includes(u.id);
               return (
                 <button 
                   key={u.id} 
                   type="button"
                   onClick={() => toggleMember(u.id)}
                   className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                     isSelected ? 'bg-accent/10 border-accent' : 'bg-white border-border hover:bg-muted/50'
                   }`}
                 >
                   <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-accent' : 'bg-muted'}`} />
                   <div>
                      <div className="text-sm font-bold text-foreground leading-none">{u.first_name} {u.last_name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-1">{u.badge_number}</div>
                   </div>
                 </button>
               );
             })}
          </div>
        </div>

        <div className="pt-4 flex justify-end gap-3 border-t border-border">
          <Button variant="secondary" onClick={onClose} type="button">{t('common.cancel')}</Button>
          <Button type="submit">{t('common.confirm')}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function PerformanceTab({ orders, machines, users }) {
  const { t } = useTranslation();
  const byMachine = machines.map(m => {
    const mOrders = orders.filter(o => o.machine_id === m.id);
    const done = mOrders.filter(o => o.status === 'done').length;
    const delayed = mOrders.filter(o => (o.delays||[]).some(d=>d.applied)).length;
    return { ...m, total: mOrders.length, done, delayed, onTime: done - delayed };
  });

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: t('supervisor.performance.total_orders'), val: orders.length, color: 'text-accent' },
          { label: t('supervisor.performance.finalized'), val: orders.filter(o=>o.status==='done').length, color: 'text-green-600' },
          { label: t('supervisor.performance.with_delay'), val: orders.filter(o=>(o.delays||[]).some(d=>d.applied)).length, color: 'text-red-600' }
        ].map((s, i) => (
          <div key={i} className="card text-center py-10">
            <div className={`text-4xl font-display ${s.color} mb-1`}>{s.val}</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>{t('analytics.machine')}</th>
              <th className="text-center">{t('supervisor.performance.total_orders')}</th>
              <th className="text-center">{t('supervisor.performance.finalized')}</th>
              <th className="text-center">{t('supervisor.performance.on_time')}</th>
              <th className="text-center">{t('supervisor.performance.with_delay')}</th>
              <th>{t('supervisor.performance.success_rate')}</th>
            </tr>
          </thead>
          <tbody>
            {byMachine.map(m => (
              <tr key={m.id}>
                <td className="font-bold text-foreground">{m.name}</td>
                <td className="text-center font-mono">{m.total}</td>
                <td className="text-center"><span className="badge border-green-200 bg-green-50 text-green-700">{m.done}</span></td>
                <td className="text-center"><span className="badge border-blue-200 bg-blue-50 text-blue-700">{m.onTime}</span></td>
                <td className="text-center"><span className="badge border-red-200 bg-red-50 text-red-700">{m.delayed}</span></td>
                <td>
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-24 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: m.total ? `${(m.done/m.total)*100}%` : '0%' }} />
                    </div>
                    <span className="text-xs font-bold text-foreground">{m.total ? Math.round((m.done/m.total)*100) : 0}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
