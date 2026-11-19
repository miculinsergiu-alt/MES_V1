import { useState, useEffect } from 'react';
import { Users, Settings, Factory, Plus, Edit2, Trash2, Award, Search, Calendar, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';
import { ShiftDefinitionModal, ScheduleModal, SkillModal, UserModal, AreaModal, MachineModal } from './AdminDashboardParts';

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
    <div className="flex flex-col">
      
      <main className="flex-1 p-4 sm:p-6 lg:p-10 overflow-auto">
        <header className="mb-10 flex justify-between items-end">
          <div>
            <Badge className="mb-4">{t('shell.groups.admin')}</Badge>
            <h1 className="font-display text-4xl text-foreground">{t('sidebar.admin')}</h1>
            <p className="text-muted-foreground mt-2">{t('admin.subtitle')}</p>
          </div>
          <div className="flex gap-3">
             {tab === 'users' && (
                <Button size="sm" onClick={() => { setEditUser(null); setShowUserModal(true); }}>
                  <Plus size={16} className="mr-2" /> {t('admin.new_user')}
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
                            <div className="flex flex-wrap gap-1">
                              {(u.roles?.length ? u.roles : [u.role]).map((r) => (
                                <span key={r} className="text-xs font-semibold px-2.5 py-1 rounded-md bg-muted text-muted-foreground border border-border">{t(`roles.${r}`)}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {(u.roles || [u.role]).includes('operator') && (
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
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={async () => { if(window.confirm(t('admin.delete_area_confirm'))) { await api.delete(`/machines/areas/${area.id}`); loadAreas(); } }}>
                          <Trash2 size={14}/>
                        </Button>
                        <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => { setSelectedArea(area); setEditMachine(null); setShowMachineModal(true); }}>
                          <Plus size={12} className="mr-1"/> {t('admin.machine_btn')}
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
                               <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:bg-red-50" onClick={async () => { if(window.confirm(t('admin.delete_machine_confirm'))) { await api.delete(`/machines/${m.id}`); loadAreas(); } }}>
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