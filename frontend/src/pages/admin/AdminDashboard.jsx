import { useState, useEffect } from 'react';
import { Users, Settings, Factory, Plus, Edit2, Trash2, X, ChevronDown, ChevronRight, Box, Award, CheckCircle, Search, Calendar, Clock, UserCheck, ShieldCheck } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';

const ROLES_RO = { administrator:'Administrator', planner:'Planner', area_supervisor:'Supervisor', shift_responsible:'Șef Schimb', operator:'Operator' };

const fadeInUp = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

export default function AdminDashboard() {
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
    { path:'/admin/users', label:'Utilizatori', icon:<Users size={18}/> },
    { path:'/admin/machines', label:'Arii & Utilaje', icon:<Factory size={18}/> },
    { path:'/admin/items', label:'BOM System', icon:<Box size={18}/> },
  ];

  const handleDeleteSchedule = async (id) => {
    if (!window.confirm('Ștergeți programarea?')) return;
    try {
      await api.delete(`/shifts/schedule/${id}`);
      toast.success('Programare ștearsă');
      loadSchedules();
    } catch { toast.error('Eroare la ștergere'); }
  };

  const handleDeleteShift = async (id) => {
    if (!window.confirm('Atenție: Ștergerea schimbului va anula și legăturile cu operatorii. Confirmați?')) return;
    try {
      await api.delete(`/shifts/${id}`);
      toast.success('Schimb șters');
      loadShifts();
    } catch { toast.error('Eroare la ștergere'); }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar items={navItems} />
      
      <main className="flex-1 p-10 overflow-auto">
        <header className="mb-10 flex justify-between items-end">
          <div>
            <Badge className="mb-4">Administrative Suite</Badge>
            <h1 className="font-display text-4xl text-foreground">Panou <span className="gradient-text">Administrator</span></h1>
            <p className="text-muted-foreground mt-2">Gestionare utilizatori, arii de producție și configuraări schimburi.</p>
          </div>
          <div className="flex gap-3">
             {tab === 'users' && (
                <Button size="sm" onClick={() => { setEditUser(null); setShowUserModal(true); }}>
                  <Plus size={16} className="mr-2" /> Utilizator Nou
                </Button>
             )}
             {tab === 'machines' && (
                <Button size="sm" onClick={() => setShowAreaModal(true)}>
                  <Plus size={16} className="mr-2" /> Arie Nouă
                </Button>
             )}
             {tab === 'shifts' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setShowScheduleModal(true)}>
                    <Calendar size={16} className="mr-2" /> Alocare Zilnică
                  </Button>
                  <Button size="sm" onClick={() => { setEditShift(null); setShowShiftModal(true); }}>
                    <Plus size={16} className="mr-2" /> Crează schimb nou
                  </Button>
                </div>
             )}
          </div>
        </header>

        <div className="flex gap-1 mb-8 bg-muted/30 p-1 rounded-xl w-fit border border-border/50">
          {[
            { id: 'users', label: 'Utilizatori', icon: <Users size={14}/> },
            { id: 'machines', label: 'Arii & Utilaje', icon: <Factory size={14}/> },
            { id: 'shifts', label: 'Management Schimburi', icon: <Calendar size={14}/> }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                tab === t.id 
                  ? 'bg-white text-accent shadow-sm ring-1 ring-border/50' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon}
              {t.label}
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
                    Utilizatori Sistem
                  </h3>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <Input className="h-9 py-0 pl-9 w-64 text-sm bg-white" placeholder="Caută utilizator..." />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Nume Complet</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Legitimație</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Rol</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Skills</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Acțiuni</th>
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
                              {ROLES_RO[u.role]}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {u.role === 'operator' && (
                              <button 
                                className="flex items-center gap-1.5 text-xs font-bold text-accent hover:underline"
                                onClick={() => { setSelectedUserForSkills(u); setShowSkillModal(true); }}
                              >
                                <Award size={14}/> Gestionează Skills
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { setEditUser(u); setShowUserModal(true); }}>
                                <Edit2 size={14}/>
                              </Button>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={async () => { if(window.confirm('Dezactivați utilizatorul?')) { await api.delete(`/users/${u.id}`); loadUsers(); } }}>
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
                      <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => { setSelectedArea(area); setEditMachine(null); setShowMachineModal(true); }}>
                        <Plus size={12} className="mr-1"/> Utilaj
                      </Button>
                    </div>
                    <div className="p-2 space-y-1">
                      {(area.machines||[]).length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground text-sm italic">Niciun utilaj configurat.</div>
                      ) : (
                        (area.machines||[]).map(m => (
                          <div key={m.id} className="group flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50">
                             <div className="flex items-center gap-3">
                               <div className="w-1.5 h-1.5 rounded-full bg-accent/40 group-hover:bg-accent transition-colors" />
                               <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">{m.name}</span>
                             </div>
                             <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => { setSelectedArea(area); setEditMachine(m); setShowMachineModal(true); }}>
                               <Settings size={12} className="text-muted-foreground" />
                             </Button>
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
                               <span className="text-[10px] font-black uppercase text-muted-foreground tracking-tighter">Responsabil Schimb</span>
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
                        Programări Zilnice Operatori
                      </h3>
                      <Input className="h-9 py-0 w-48 text-sm bg-white" type="date" value={new Date().toISOString().split('T')[0]} readOnly />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-muted/30 border-b border-border">
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Dată</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Schimb</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Operator</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Utilaj</th>
                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Acțiuni</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {schedules.length === 0 && <tr><td colSpan={5} className="p-10 text-center italic text-muted-foreground">Nicio alocare zilnică activă.</td></tr>}
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
    if (!formData.shift_responsible_id) return toast.error("Selectați un responsabil de schimb");
    try {
      if (shift) await api.put(`/shifts/${shift.id}`, formData);
      else await api.post('/shifts', formData);
      toast.success('Schimb salvat cu succes');
      onSave();
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare la salvare'); }
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
    <ModalWrapper title={shift ? 'Editare Schimb' : 'Creare Schimb Nou'} onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Denumire Schimb</label>
          <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="ex: Schimbul A" required />
        </div>

        <div className="grid grid-cols-2 gap-6">
           <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Ora Start</label>
              <Input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} required />
           </div>
           <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Ora Sfârșit</label>
              <Input type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} required />
           </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
            <ShieldCheck size={14} className="text-accent"/> Responsabil Schimb
          </label>
          <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={formData.shift_responsible_id} onChange={e => setFormData({...formData, shift_responsible_id: e.target.value})} required>
            <option value="">Selectați responsabilul...</option>
            {users.filter(u => u.role === 'shift_responsible').map(u => (
              <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.badge_number})</option>
            ))}
          </select>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-border pb-2">
             <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
               <Users size={14}/> Operatori în Schimb ({formData.members.length})
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
          <Button variant="secondary" onClick={onClose} type="button">Anulare</Button>
          <Button type="submit">Finalizare Schimb</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function ScheduleModal({ users, machines, shifts, onClose, onSave }) {
  const [form, setForm] = useState({ user_id:'', machine_id:'', shift_id:'', work_date: new Date().toISOString().split('T')[0] });
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/shifts/schedule', form);
      toast.success('Programare salvată');
      onSave();
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };
  return (
    <ModalWrapper title="Alocare Zilnică Operator" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Dată Lucru</label>
          <Input type="date" value={form.work_date} onChange={e=>setForm(p=>({...p,work_date:e.target.value}))} required />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Schimb</label>
          <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={form.shift_id} onChange={e=>setForm(p=>({...p,shift_id:e.target.value}))} required>
            <option value="">Selectează schimb...</option>
            {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.start_time}-{s.end_time})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">Utilaj</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={form.machine_id} onChange={e=>setForm(p=>({...p,machine_id:e.target.value}))} required>
              <option value="">Selectează utilaj...</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">Operator</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={form.user_id} onChange={e=>setForm(p=>({...p,user_id:e.target.value}))} required>
              <option value="">Selectează operator...</option>
              {users.filter(u=>u.role==='operator').map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select>
          </div>
        </div>
        <div className="pt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} type="button">Anulare</Button>
          <Button type="submit">Salvare Alocare</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function SkillModal({ user, areas, onClose }) {
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
      toast.success('Skill-uri și calificări actualizate cu succes!');
      onClose();
    } catch (err) { 
      toast.error('Eroare la salvarea skill-urilor'); 
    }
  };

  return (
    <ModalWrapper title={`Skills Operator: ${user.first_name}`} onClose={onClose} maxWidth="max-w-3xl">
      <p className="text-muted-foreground mb-6 text-sm">Selectați utilajele pe care acest operator este autorizat să le deservească.</p>
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
                        <option value="trainee">Începător (Trainee)</option>
                        <option value="independent">Independent</option>
                        <option value="expert">Expert / Trainer</option>
                      </select>
                      <input 
                        type="date" 
                        className="w-full text-[10px] p-2 rounded-md border border-accent/30 bg-white outline-none"
                        value={userSkills[m.id].expiration_date}
                        onChange={(e) => updateSkillAttr(m.id, 'expiration_date', e.target.value)}
                        title="Data expirare calificare (opțional)"
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
        <Button variant="secondary" onClick={onClose}>Anulare</Button>
        <Button onClick={saveSkills}>Salvează Configurarea</Button>
      </div>
    </ModalWrapper>
  );
}

function UserModal({ user, onClose, onSave }) {
  const [form, setForm] = useState({ first_name:user?.first_name||'', last_name:user?.last_name||'', badge_number:user?.badge_number||'', role:user?.role||'operator', password:'' });
  const [loading, setLoading] = useState(false);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (user) await api.put(`/users/${user.id}`, form);
      else await api.post('/users', form);
      toast.success(user ? 'Utilizator actualizat' : 'Utilizator creat');
      onSave();
    } catch(err) { toast.error('Eroare la procesare date'); }
    finally { setLoading(false); }
  };

  return (
    <ModalWrapper title={user ? 'Editare Profil' : 'Utilizator Nou'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">Prenume</label>
            <Input value={form.first_name} onChange={e=>setForm(p=>({...p,first_name:e.target.value}))} required />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">Nume de Familie</label>
            <Input value={form.last_name} onChange={e=>setForm(p=>({...p,last_name:e.target.value}))} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">Număr Legitimație</label>
            <Input value={form.badge_number} onChange={e=>setForm(p=>({...p,badge_number:e.target.value.toUpperCase()}))} required disabled={!!user} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">Rol Sistem</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))}>
              {Object.entries(ROLES_RO).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Parolă {user && '(lăsați gol pentru neschimbată)'}</label>
          <Input type="password" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} required={!user} />
        </div>
        <div className="pt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} type="button">Anulare</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Se salvează...' : 'Salvare Profil'}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function AreaModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name:'', description:'' });
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/machines/areas', form);
      toast.success('Arie creată cu succes');
      onSave();
    } catch(err) { toast.error('Eroare la creare arie'); }
  };
  return (
    <ModalWrapper title="Arie Nouă de Producție" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Denumire Arie</label>
          <Input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required placeholder="ex: Aria Debitari" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Descriere (Optional)</label>
          <Input value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="Configurări speciale..." />
        </div>
        <div className="pt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} type="button">Anulare</Button>
          <Button type="submit">Creare Arie</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function MachineModal({ machine, area, onClose, onSave }) {
  const [form, setForm] = useState({ name:machine?.name||'', setup_time_min:machine?.setup_time_min||30, working_time_min:machine?.working_time_min||480, supervision_time_min:machine?.supervision_time_min||30 });
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (machine) await api.put(`/machines/${machine.id}`, form);
      else await api.post('/machines', { ...form, area_id: area.id });
      toast.success(machine ? 'Utilaj actualizat' : 'Utilaj creat');
      onSave();
    } catch(err) { toast.error('Eroare la configurare utilaj'); }
  };

  return (
    <ModalWrapper title={machine ? 'Editare Utilaj' : `Utilaj Nou — ${area?.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Denumire Utilaj</label>
          <Input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">Timp Setup (min)</label>
            <Input type="number" value={form.setup_time_min} onChange={e=>setForm(p=>({...p,setup_time_min:+e.target.value}))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1">Timp Operare (min)</label>
            <Input type="number" value={form.working_time_min} onChange={e=>setForm(p=>({...p,working_time_min:+e.target.value}))} />
          </div>
        </div>
        <div className="pt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} type="button">Anulare</Button>
          <Button type="submit">Salvează Configurări</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}
