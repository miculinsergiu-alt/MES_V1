import { useState, useEffect } from 'react';
import { Users, Settings, Factory, Plus, Edit2, Trash2, X, ChevronDown, ChevronRight, Box, Award, CheckCircle, Search, Calendar, Clock, UserCheck, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';

const fadeInUp = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

export default function AdminDashboard() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [schedules, setSchedules] = useState([]);
  
  // Modals
  const [showUserModal, setShowUserModal] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  
  // Edit State
  const [editUser, setEditUser] = useState(null);
  const [selectedUserForSkills, setSelectedUserForSkills] = useState(null);
  const [editMachine, setEditMachine] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [editShift, setEditShift] = useState(null);

  const loadUsers = async () => { try { const r = await api.get('/users'); setUsers(r.data); } catch {} };
  const loadAreas = async () => { try { const r = await api.get('/machines/areas'); setAreas(r.data); } catch {} };
  const loadShifts = async () => { try { const r = await api.get('/shifts'); setShifts(r.data); } catch {} };
  const loadSchedules = async () => { try { const r = await api.get('/shifts/schedule'); setSchedules(r.data); } catch {} };

  useEffect(() => { loadUsers(); loadAreas(); loadShifts(); loadSchedules(); }, []);

  const navItems = [
    { path:'/admin/users', labelKey:'sidebar.users', icon:<Users size={18}/> },
    { path:'/admin/machines', labelKey:'sidebar.areas_machines', icon:<Factory size={18}/> },
    { path:'/admin/items', labelKey:'sidebar.bom_system', icon:<Box size={18}/> },
  ];

  const handleDeleteSchedule = async (id) => {
    if (!window.confirm(t('admin.delete_schedule_confirm'))) return;
    try {
      await api.delete(`/shifts/schedule/${id}`);
      toast.success(t('messages.delete_success'));
      loadSchedules();
    } catch { toast.error(t('messages.delete_error')); }
  };

  const handleDeleteShift = async (id) => {
    if (!window.confirm(t('admin.delete_shift_warning'))) return;
    try {
      await api.delete(`/shifts/${id}`);
      toast.success(t('messages.delete_success'));
      loadShifts();
    } catch { toast.error(t('messages.delete_error')); }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar items={navItems} />
      
      <main className="flex-1 p-10 overflow-auto">
        <header className="mb-10 flex justify-between items-end">
          <div>
            <Badge className="mb-4">Administrative Suite</Badge>
            <h1 className="font-display text-4xl text-foreground">{t('sidebar.admin')}</h1>
            <p className="text-muted-foreground mt-2">{t('admin.subtitle')}</p>
          </div>
          <div className="flex gap-3">
             {tab === 'users' && (
                <Button size="sm" onClick={() => { setEditUser(null); setShowUserModal(true); }}>
                  <Plus size={16} className="mr-2" /> {t('common.edit')} {t('roles.operator')}
                </Button>
             )}
             {tab === 'machines' && (
                <Button size="sm" onClick={() => setShowAreaModal(true)}>
                  <Plus size={16} className="mr-2" /> {t('admin.new_area')}
                </Button>
             )}
             {tab === 'shifts' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setShowScheduleModal(true)}>
                    <Calendar size={16} className="mr-2" /> {t('admin.daily_allocation')}
                  </Button>
                  <Button size="sm" onClick={() => { setEditShift(null); setShowShiftModal(true); }}>
                    <Plus size={16} className="mr-2" /> {t('admin.new_shift')}
                  </Button>
                </div>
             )}
          </div>
        </header>

        <div className="flex gap-1 mb-8 bg-muted/30 p-1 rounded-xl w-fit border border-border/50">
          {[
            { id: 'users', label: t('sidebar.users'), icon: <Users size={14}/> },
            { id: 'machines', label: t('sidebar.areas_machines'), icon: <Factory size={14}/> },
            { id: 'shifts', label: t('sidebar.manage_shifts'), icon: <Calendar size={14}/> }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                tab === item.id 
                  ? 'bg-white text-accent shadow-sm' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

        </div>

        <AnimatePresence mode="wait">
          {tab === 'users' && (
            <motion.div key="users" initial="hidden" animate="visible" exit="hidden" variants={fadeInUp}>
              <Card className="p-0 overflow-hidden border-border/60">
                <div className="p-6 border-b border-border bg-muted/5 flex justify-between items-center">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Users size={18} className="text-accent" />
                    {t('admin.system_users')}
                  </h3>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <Input className="h-9 py-0 pl-9 w-64 text-sm bg-white" placeholder={t('admin.search_user')} />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('admin.full_name')}</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('admin.badge')}</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('admin.role')}</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('admin.skills')}</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {users.map(u => (
                        <tr key={u.id} className="hover:bg-accent/[0.02] transition-colors group">
                          <td className="px-6 py-4">
                            <div className="font-medium text-foreground">{u.first_name} {u.last_name}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-md bg-accent/10 text-accent border border-accent/20">
                              {u.badge_number}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-muted text-muted-foreground border border-border">
                              {t(`roles.${u.role}`)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {u.role === 'operator' && (
                              <button 
                                className="flex items-center gap-1.5 text-xs font-bold text-accent hover:underline"
                                onClick={() => { setSelectedUserForSkills(u); setShowSkillModal(true); }}
                              >
                                <Award size={14}/> {t('admin.manage_skills')}
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { setEditUser(u); setShowUserModal(true); }}>
                                <Edit2 size={14}/>
                              </Button>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={async () => { if(window.confirm(t('admin.disable_user_confirm'))) { await api.delete(`/users/${u.id}`); loadUsers(); } }}>
                                <Trash2 size={14}/>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </motion.div>
          )}

          {tab === 'machines' && (
            <motion.div key="machines" initial="hidden" animate="visible" exit="hidden" variants={fadeInUp}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {areas.map(area => (
                  <Card key={area.id} className="p-0 overflow-hidden">
                    <div className="p-5 bg-muted/10 border-b border-border flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                          <Factory size={16} />
                        </div>
                        <h4 className="font-bold text-foreground">{area.name}</h4>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={async () => { if(window.confirm(t('admin.delete_area_confirm', { defaultValue: 'Sigur dorești să ștergi această arie și toate utilajele ei?' }))) { await api.delete(`/machines/areas/${area.id}`); loadAreas(); } }}>
                          <Trash2 size={14}/>
                        </Button>
                        <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => { setSelectedArea(area); setEditMachine(null); setShowMachineModal(true); }}>
                          <Plus size={12} className="mr-1"/> Utilaj
                        </Button>
                      </div>
                    </div>
                    <div className="p-2 space-y-1">
                      {(area.machines||[]).length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground text-sm italic">{t('admin.no_machines_config')}</div>
                      ) : (
                        (area.machines||[]).map(m => (
                          <div key={m.id} className="group flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50">
                             <div className="flex items-center gap-3">
                               <div className="w-1.5 h-1.5 rounded-full bg-accent/40 group-hover:bg-accent transition-colors" />
                               <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">{m.name}</span>
                             </div>
                             <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                               <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setSelectedArea(area); setEditMachine(m); setShowMachineModal(true); }}>
                                 <Settings size={12} className="text-muted-foreground" />
                               </Button>
                               <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:bg-red-50" onClick={async () => { if(window.confirm(t('admin.delete_machine_confirm', { defaultValue: 'Sigur dorești să ștergi acest utilaj?' }))) { await api.delete(`/machines/${m.id}`); loadAreas(); } }}>
                                 <Trash2 size={12} />
                               </Button>
                             </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}

          {tab === 'shifts' && (
            <motion.div key="shifts" initial="hidden" animate="visible" exit="hidden" variants={fadeInUp}>
               <div className="grid grid-cols-1 gap-8">
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
                               <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { setEditShift(s); setShowShiftModal(true); }}>
                                  <Edit2 size={14}/>
                               </Button>
                               <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" onClick={() => handleDeleteShift(s.id)}>
                                  <Trash2 size={14}/>
                                </Button>
                            </div>
                         </div>
                         <div className="p-5 space-y-4">
                            <div className="space-y-1">
                               <span className="text-[10px] font-black uppercase text-muted-foreground tracking-tighter">{t('roles.shift_responsible')}</span>
                               <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[10px] text-white font-bold">
                                     {s.first_name?.[0]}{s.last_name?.[0]}
                                  </div>
                                  <span className="text-sm font-bold">{s.first_name} {s.last_name}</span>
                               </div>
                            </div>
                         </div>
                      </Card>
                    ))}
                 </div>

                 <Card className="p-0 overflow-hidden">
                    <div className="p-6 border-b border-border bg-muted/5 flex justify-between items-center">
                      <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <Calendar size={18} className="text-accent" />
                        {t('admin.daily_schedules')}
                      </h3>
                      <Input className="h-9 py-0 w-48 text-sm bg-white" type="date" value={new Date().toISOString().split('T')[0]} readOnly />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-muted/30 border-b border-border">
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('admin.date')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('sidebar.manage_shifts')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('roles.operator')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('sidebar.areas_machines')}</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">{t('common.actions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {schedules.length === 0 && <tr><td colSpan={5} className="p-10 text-center italic text-muted-foreground">{t('admin.no_schedules')}</td></tr>}
                          {schedules.map(sch => (
                            <tr key={sch.id} className="hover:bg-accent/[0.02]">
                              <td className="px-6 py-4 font-medium">{sch.work_date}</td>
                              <td className="px-6 py-4"><Badge variant="outline">{sch.shift_name}</Badge></td>
                              <td className="px-6 py-4 font-bold">{sch.first_name} {sch.last_name}</td>
                              <td className="px-6 py-4 font-bold text-accent">{sch.machine_name}</td>
                              <td className="px-6 py-4 text-right">
                                <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleDeleteSchedule(sch.id)}>
                                  <Trash2 size={14}/>
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showUserModal && <UserModal user={editUser} onClose={() => setShowUserModal(false)} onSave={() => { loadUsers(); setShowUserModal(false); }} />}
        {showSkillModal && <SkillModal user={selectedUserForSkills} areas={areas} onClose={() => setShowSkillModal(false)} />}
        {showAreaModal && <AreaModal onClose={() => setShowAreaModal(false)} onSave={() => { loadAreas(); setShowAreaModal(false); }} />}
        {showMachineModal && <MachineModal machine={editMachine} area={selectedArea} onClose={() => setShowMachineModal(false)} onSave={() => { loadAreas(); setShowMachineModal(false); }} />}
        {showScheduleModal && <ScheduleModal users={users} machines={areas.flatMap(a=>a.machines)} shifts={shifts} onClose={() => setShowScheduleModal(false)} onSave={() => { loadSchedules(); setShowScheduleModal(false); }} />}
        {showShiftModal && <ShiftDefinitionModal shift={editShift} users={users} onClose={() => setShowShiftModal(false)} onSave={() => { loadShifts(); setShowShiftModal(false); }} />}
      </AnimatePresence>
    </div>
  );
}

// Minimalist Modal Wrapper
function ModalWrapper({ title, children, onClose, maxWidth = "max-w-xl" }) {
  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-foreground/10 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
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
          <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={formData.shift_responsible_id} onChange={e => setFormData({...formData, shift_responsible_id: e.target.value})} required>
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
          <Button type="submit">{t('admin.finish_shift')}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function ScheduleModal({ users, machines, shifts, onClose, onSave }) {
  const [form, setForm] = useState({ user_id:'', machine_id:'', shift_id:'', work_date: new Date().toISOString().split('T')[0] });
  const { t } = useTranslation();
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/shifts/schedule', form);
      toast.success(t('messages.save_success'));
      onSave();
    } catch(err) { toast.error(err.response?.data?.error || t('common.error')); }
  };
  return (
    <ModalWrapper title={t('admin.allocation_modal_title')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">{t('admin.work_date')}</label>
          <Input type="date" value={form.work_date} onChange={e=>setForm(p=>({...p,work_date:e.target.value}))} required />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">{t('sidebar.manage_shifts')}</label>
          <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={form.shift_id} onChange={e=>setForm(p=>({...p,shift_id:e.target.value}))} required>
            <option value="">{t('admin.select_shift')}</option>
            {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.start_time}-{s.end_time})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">{t('sidebar.areas_machines')}</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={form.machine_id} onChange={e=>setForm(p=>({...p,machine_id:e.target.value}))} required>
              <option value="">{t('admin.select_machine')}</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">{t('roles.operator')}</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={form.user_id} onChange={e=>setForm(p=>({...p,user_id:e.target.value}))} required>
              <option value="">{t('admin.select_operator')}</option>
              {users.filter(u=>u.role==='operator').map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select>
          </div>
        </div>
        <div className="pt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} type="button">{t('common.cancel')}</Button>
          <Button type="submit">{t('common.save')}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function SkillModal({ user, areas, onClose }) {
  const { t } = useTranslation();
  const [userSkills, setUserSkills] = useState({}); // machine_id -> { skill_level, expiration_date }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/users/${user.id}/skills`).then(r => {
      const skillsMap = {};
      r.data.forEach(s => {
        skillsMap[s.machine_id] = { skill_level: s.skill_level || 'independent', expiration_date: s.expiration_date || '' };
      });
      setUserSkills(skillsMap);
      setLoading(false);
    });
  }, [user.id]);

  const toggleSkill = (machineId) => {
    setUserSkills(prev => {
      const newSkills = { ...prev };
      if (newSkills[machineId]) delete newSkills[machineId];
      else newSkills[machineId] = { skill_level: 'independent', expiration_date: '' };
      return newSkills;
    });
  };

  const updateSkillAttr = (machineId, attr, value) => {
    setUserSkills(prev => ({
      ...prev,
      [machineId]: { ...prev[machineId], [attr]: value }
    }));
  };

  const saveSkills = async () => {
    try {
      const payload = Object.entries(userSkills).map(([machine_id, data]) => ({
        machine_id: parseInt(machine_id),
        skill_level: data.skill_level,
        expiration_date: data.expiration_date
      }));
      await api.post(`/users/${user.id}/skills`, { skills: payload });
      toast.success(t('admin.skills_success'));
      onClose();
    } catch (err) { 
      toast.error(t('admin.skills_error')); 
    }
  };

  return (
    <ModalWrapper title={`${t('admin.skills')} Operator: ${user.first_name}`} onClose={onClose} maxWidth="max-w-3xl">
      <p className="text-muted-foreground mb-6 text-sm">{t('admin.skills_prompt')}</p>
      <div className="max-h-[50vh] overflow-y-auto pr-2 space-y-6">
        {areas.map(area => (
          <div key={area.id}>
            <h5 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">{area.name}</h5>
            <div className="grid grid-cols-3 gap-3">
              {area.machines.map(m => {
                const hasSkill = !!userSkills[m.id];
                return (
                <div 
                  key={m.id} 
                  className={`p-4 rounded-xl border text-left transition-all flex flex-col gap-3 ${
                    hasSkill 
                      ? 'bg-accent/5 border-accent shadow-sm' 
                      : 'bg-white border-border hover:border-accent/30'
                  }`}
                >
                  <div className="flex justify-between items-center cursor-pointer" onClick={() => toggleSkill(m.id)}>
                    <span className={`text-sm font-semibold ${hasSkill ? 'text-accent' : 'text-foreground/80'}`}>{m.name}</span>
                    {hasSkill && <CheckCircle size={14} className="text-accent" />}
                  </div>
                  
                  {hasSkill && (
                    <div className="pt-2 border-t border-accent/20 flex flex-col gap-2">
                      <select 
                        className="w-full text-[10px] p-2 rounded-md border border-accent/30 bg-white outline-none"
                        value={userSkills[m.id].skill_level}
                        onChange={(e) => updateSkillAttr(m.id, 'skill_level', e.target.value)}
                      >
                        <option value="trainee">{t('admin.trainee')}</option>
                        <option value="independent">{t('admin.independent')}</option>
                        <option value="expert">Expert / Trainer</option>
                        </select>
                        <input 
                        type="date"
                        className="w-full text-[10px] p-2 rounded-md border border-accent/30 bg-white outline-none"
                        value={userSkills[m.id].expiration_date || ''}
                        onChange={(e) => updateSkillAttr(m.id, 'expiration_date', e.target.value)}
                        title={t('admin.expiry_date_optional')}
                        />

                    </div>
                  )}
                </div>
              )})}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={saveSkills}>{t('admin.save_config')}</Button>
      </div>
    </ModalWrapper>
  );
}

function UserModal({ user, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ first_name:user?.first_name||'', last_name:user?.last_name||'', badge_number:user?.badge_number||'', role:user?.role||'operator', password:'' });
  const [loading, setLoading] = useState(false);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (user) await api.put(`/users/${user.id}`, form);
      else await api.post('/users', form);
      toast.success(user ? t('admin.user_updated') : t('admin.user_created'));
      onSave();
    } catch(err) { toast.error(t('admin.processing_error')); }
    finally { setLoading(false); }
  };

  return (
    <ModalWrapper title={user ? `${t('common.edit')} ${t('sidebar.users')}` : t('admin.new_shift')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">{t('admin.first_name')}</label>
            <Input value={form.first_name} onChange={e=>setForm(p=>({...p,first_name:e.target.value}))} required />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">{t('admin.last_name')}</label>
            <Input value={form.last_name} onChange={e=>setForm(p=>({...p,last_name:e.target.value}))} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">{t('admin.badge')}</label>
            <Input value={form.badge_number} onChange={e=>setForm(p=>({...p,badge_number:e.target.value.toUpperCase()}))} required disabled={!!user} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">{t('admin.system_role')}</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))}>
              {['administrator', 'planner', 'area_supervisor', 'shift_responsible', 'operator'].map((v) => <option key={v} value={v}>{t(`roles.${v}`)}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">{t('admin.password')} {user && `(${t('admin.password_placeholder')})`}</label>
          <Input type="password" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} required={!user} />
        </div>
        <div className="pt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} type="button">{t('common.cancel')}</Button>
          <Button type="submit" disabled={loading}>{loading ? t('admin.saving') : t('admin.save_profile')}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function AreaModal({ onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name:'', description:'' });
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/machines/areas', form);
      toast.success(t('admin.area_success'));
      onSave();
    } catch(err) { toast.error(err.response?.data?.error || t('messages.save_error')); }
  };
  return (
    <ModalWrapper title={t('admin.new_area_title')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">{t('admin.area_name')}</label>
          <Input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required placeholder="ex: Aria Debitari" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">{t('admin.description_optional')}</label>
          <Input value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder={t('admin.special_configs')} />
        </div>
        <div className="pt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} type="button">{t('common.cancel')}</Button>
          <Button type="submit">{t('admin.create_area')}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function MachineModal({ machine, area, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name:machine?.name||'', setup_time_min:machine?.setup_time_min||30, working_time_min:machine?.working_time_min||480, supervision_time_min:machine?.supervision_time_min||30 });
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (machine) await api.put(`/machines/${machine.id}`, form);
      else await api.post('/machines', { ...form, area_id: area.id });
      toast.success(machine ? t('admin.machine_updated') : t('admin.machine_created'));
      onSave();
    } catch(err) { toast.error(t('messages.save_error')); }
  };

  return (
    <ModalWrapper title={machine ? t('admin.edit_machine') : `${t('admin.new_machine')} — ${area?.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">{t('admin.machine_name')}</label>
          <Input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">{t('admin.setup_time')}</label>
            <Input type="number" value={form.setup_time_min} onChange={e=>setForm(p=>({...p,setup_time_min:+e.target.value}))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">{t('admin.working_time')}</label>
            <Input type="number" value={form.working_time_min} onChange={e=>setForm(p=>({...p,working_time_min:+e.target.value}))} />
          </div>
        </div>
        <div className="pt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} type="button">{t('common.cancel')}</Button>
          <Button type="submit">{t('admin.save_configs')}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}
