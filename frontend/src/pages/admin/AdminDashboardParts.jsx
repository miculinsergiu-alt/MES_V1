/** Dialogs and sub-views of AdminDashboard (split out to keep the screen file small). */
import { useState, useEffect } from 'react';
import { Users, X, CheckCircle, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { motion } from 'framer-motion';

export function ModalWrapper({ title, children, onClose, maxWidth = "max-w-xl" }) {
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

export function ShiftDefinitionModal({ shift, users, onClose, onSave }) {
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
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('admin.shift_name')}</label>
          <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder={t('admin.shift_placeholder')} required />
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
            {users.filter(u => (u.roles || [u.role]).includes('shift_responsible')).map(u => (
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
             {users.filter(u => (u.roles || [u.role]).includes('operator')).map(u => {
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

export function ScheduleModal({ users, machines, shifts, onClose, onSave }) {
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

export function SkillModal({ user, areas, onClose }) {
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
                        <option value="expert">{t('screens.skills.expert')}</option>
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

const ALL_ROLES = ['administrator', 'planner', 'area_supervisor', 'shift_responsible', 'operator', 'warehouse_manager', 'material_planner', 'sales', 'accounting'];

export function UserModal({ user, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ first_name:user?.first_name||'', last_name:user?.last_name||'', badge_number:user?.badge_number||'', role:user?.role||'operator', roles:user?.roles?.length ? user.roles : [user?.role||'operator'], password:'' });
  const [loading, setLoading] = useState(false);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (!form.roles.length) { toast.error(t('ops.users.pick_role')); return; }
      const body = { ...form, role: form.roles.includes(form.role) ? form.role : form.roles[0] };
      if (user) await api.put(`/users/${user.id}`, body);
      else await api.post('/users', body);
      toast.success(user ? t('admin.user_updated') : t('admin.user_created'));
      onSave();
    } catch(err) { toast.error(err.response?.data?.error || t('admin.processing_error')); }
    finally { setLoading(false); }
  };
  const toggleRole = (r) => setForm((p) => ({ ...p, roles: p.roles.includes(r) ? p.roles.filter((x) => x !== r) : [...p.roles, r] }));

  return (
    <ModalWrapper title={user ? `${t('common.edit')} ${t('sidebar.users')}` : t('ops.users.new_user')} onClose={onClose}>
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
            <label className="text-sm font-medium ml-1">{t('ops.users.primary_role')}</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={form.roles.includes(form.role) ? form.role : form.roles[0] || ''} onChange={e=>setForm(p=>({...p,role:e.target.value}))}>
              {form.roles.map((v) => <option key={v} value={v}>{t(`roles.${v}`)}</option>)}
            </select>
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium ml-1">{t('ops.users.roles')}</legend>
          <p className="text-xs text-muted-foreground ml-1">{t('ops.users.roles_hint')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                <input type="checkbox" checked={form.roles.includes(r)} onChange={() => toggleRole(r)} />
                {t(`roles.${r}`)}
              </label>
            ))}
          </div>
        </fieldset>
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

export function AreaModal({ onClose, onSave }) {
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
          <Input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required placeholder={t('admin.area_placeholder')} />
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

export function MachineModal({ machine, area, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name:machine?.name||'', setup_time_min:machine?.setup_time_min||30, working_time_min:machine?.working_time_min||480, supervision_time_min:machine?.supervision_time_min||30, hourly_rate:machine?.hourly_rate||0, weekly_hours:machine?.weekly_hours??40 });
  
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
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">{t('ops.machines.hourly_rate')}</label>
          <Input type="number" min="0" step="0.01" value={form.hourly_rate} onChange={e=>setForm(p=>({...p,hourly_rate:+e.target.value}))} />
          <p className="text-xs text-muted-foreground ml-1">{t('ops.machines.hourly_rate_hint')}</p>
          <label className="text-sm font-medium ml-1">{t('cap.weekly_hours')}</label>
          <Input type="number" min="0" max="168" step="0.5" value={form.weekly_hours} onChange={e=>setForm(p=>({...p,weekly_hours:+e.target.value}))} />
        </div>
        <div className="pt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} type="button">{t('common.cancel')}</Button>
          <Button type="submit">{t('admin.save_configs')}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}
