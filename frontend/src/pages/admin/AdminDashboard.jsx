import { useState, useEffect } from 'react';
import { Users, Settings, Factory, LayoutDashboard, Plus, Edit2, Trash2, X, ChevronDown, ChevronRight, Box, Award, CheckCircle } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';

const ROLES_RO = { administrator:'Administrator', planner:'Planner', area_supervisor:'Area Supervisor', shift_responsible:'Shift Responsible', operator:'Operator' };

export default function AdminDashboard() {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [selectedUserForSkills, setSelectedUserForSkills] = useState(null);
  const [editMachine, setEditMachine] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [expandedAreas, setExpandedAreas] = useState({});

  const loadUsers = async () => { try { const r = await api.get('/users'); setUsers(r.data); } catch {} };
  const loadAreas = async () => { try { const r = await api.get('/machines/areas'); setAreas(r.data); } catch {} };

  useEffect(() => { loadUsers(); loadAreas(); }, []);

  const navItems = [
    { path:'/admin/users', label:'Utilizatori', icon:<Users size={16}/> },
    { path:'/admin/machines', label:'Arii & Utilaje', icon:<Factory size={16}/> },
    { path:'/admin/items', label:'Nomenclator & BOM', icon:<Box size={16}/> },
  ];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <h1>Panou Administrator</h1>
          <p>Gestionare utilizatori, arii și utilaje de producție</p>
        </div>
        <div className="page-content">
          <div className="tabs">
            {[['users','👤 Utilizatori'],['machines','🏭 Arii & Utilaje']].map(([key,label]) => (
              <button key={key} className={`tab-btn ${tab===key?'active':''}`} onClick={()=>setTab(key)}>{label}</button>
            ))}
          </div>

          {tab === 'users' && (
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <span className="card-title">Utilizatori Sistem</span>
                <button className="btn btn-primary btn-sm" onClick={() => { setEditUser(null); setShowUserModal(true); }}>
                  <Plus size={14} /> Utilizator Nou
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Nume</th><th>Legitimație</th><th>Rol</th><th>Skills</th><th>Acțiuni</th></tr></thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td style={{ fontWeight:500 }}>{u.first_name} {u.last_name}</td>
                        <td><span className="badge badge-blue">{u.badge_number}</span></td>
                        <td><span className="badge badge-purple">{ROLES_RO[u.role]}</span></td>
                        <td>
                          {u.role === 'operator' && (
                            <button className="btn btn-ghost btn-xs" onClick={() => { setSelectedUserForSkills(u); setShowSkillModal(true); }} style={{ color:'var(--yellow-light)' }}>
                              <Award size={12}/> Gestionează Skills
                            </button>
                          )}
                        </td>
                        <td>
                          <div className="flex gap-2">
                            <button className="btn btn-ghost btn-sm" onClick={() => { setEditUser(u); setShowUserModal(true); }}><Edit2 size={13}/></button>
                            <button className="btn btn-danger btn-sm" onClick={async () => { if(window.confirm('Dezactivați utilizatorul?')) { await api.delete(`/users/${u.id}`); loadUsers(); } }}><Trash2 size={13}/></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'machines' && (
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <span className="card-title">Arii & Utilaje</span>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAreaModal(true)}><Plus size={14}/> Arie Nouă</button>
              </div>
              {areas.map(area => (
                <div key={area.id} className="mb-4">
                   <div className="flex items-center justify-between p-3 bg-primary rounded border" onClick={() => setExpandedAreas(p => ({ ...p, [area.id]: !p[area.id] }))} style={{ cursor:'pointer' }}>
                      <div className="flex items-center gap-2">
                        {expandedAreas[area.id] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                        <span className="font-bold">{area.name}</span>
                      </div>
                      <button className="btn btn-primary btn-xs" onClick={(e) => { e.stopPropagation(); setSelectedArea(area); setEditMachine(null); setShowMachineModal(true); }}><Plus size={12}/> Utilaj</button>
                   </div>
                   {expandedAreas[area.id] && (area.machines||[]).map(m => (
                     <div key={m.id} className="ml-5 mt-1 p-2 bg-glass rounded border text-sm flex justify-between">
                        <span>{m.name}</span>
                        <div className="flex gap-2">
                          <button className="btn btn-ghost btn-xs" onClick={() => { setSelectedArea(area); setEditMachine(m); setShowMachineModal(true); }}><Settings size={12}/></button>
                        </div>
                     </div>
                   ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showUserModal && <UserModal user={editUser} onClose={() => setShowUserModal(false)} onSave={() => { loadUsers(); setShowUserModal(false); }} />}
      {showSkillModal && <SkillModal user={selectedUserForSkills} areas={areas} onClose={() => setShowSkillModal(false)} />}
      {showAreaModal && <AreaModal onClose={() => setShowAreaModal(false)} onSave={() => { loadAreas(); setShowAreaModal(false); }} />}
      {showMachineModal && <MachineModal machine={editMachine} area={selectedArea} onClose={() => setShowMachineModal(false)} onSave={() => { loadAreas(); setShowMachineModal(false); }} />}
    </div>
  );
}

function SkillModal({ user, areas, onClose }) {
  const [userSkills, setUserSkills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/users/${user.id}/skills`).then(r => {
      setUserSkills(r.data.map(s => s.machine_id));
      setLoading(false);
    });
  }, [user.id]);

  const toggleSkill = (machineId) => {
    setUserSkills(prev => prev.includes(machineId) ? prev.filter(id => id !== machineId) : [...prev, machineId]);
  };

  const saveSkills = async () => {
    try {
      await api.post(`/users/${user.id}/skills`, { machine_ids: userSkills });
      toast.success('Skill-uri actualizate cu succes!');
      onClose();
    } catch (err) { 
      const errorMsg = err.response?.data?.error || 'Eroare necunoscută la salvare';
      toast.error(`Eroare: ${errorMsg}`); 
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3>Skills Operator: {user.first_name} {user.last_name}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="alert alert-info">Selectați utilajele pe care acest operator este instruit să lucreze.</div>
        <div className="page-content" style={{ maxHeight:'60vh', overflowY:'auto' }}>
          {areas.map(area => (
            <div key={area.id} className="mb-4">
              <div style={{ fontWeight:700, fontSize:14, marginBottom:8, color:'var(--text-secondary)' }}>{area.name}</div>
              <div className="grid-3">
                {area.machines.map(m => (
                  <div key={m.id} 
                    className={`card skill-card ${userSkills.includes(m.id)?'active':''}`} 
                    onClick={() => toggleSkill(m.id)}
                    style={{ cursor:'pointer', padding:'10px 12px', border: userSkills.includes(m.id) ? '1px solid var(--green-light)' : '1px solid var(--border)' }}
                  >
                    <div className="flex justify-between items-center">
                      <span style={{ fontSize:13 }}>{m.name}</span>
                      {userSkills.includes(m.id) && <CheckCircle size={14} color="var(--green-light)" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Anulare</button>
          <button className="btn btn-primary" onClick={saveSkills}>Salvează Skill-uri</button>
        </div>
      </div>
    </div>
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
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{user ? 'Editare Utilizator' : 'Utilizator Nou'}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Prenume</label><input className="form-input" value={form.first_name} onChange={e=>setForm(p=>({...p,first_name:e.target.value}))} required /></div>
            <div className="form-group"><label className="form-label">Nume</label><input className="form-input" value={form.last_name} onChange={e=>setForm(p=>({...p,last_name:e.target.value}))} required /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Nr. Legitimație</label><input className="form-input" value={form.badge_number} onChange={e=>setForm(p=>({...p,badge_number:e.target.value.toUpperCase()}))} required disabled={!!user} /></div>
            <div className="form-group"><label className="form-label">Nivel</label>
              <select className="form-select" value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))}>
                {Object.entries(ROLES_RO).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label className="form-label">Parolă {user && '(lăsați gol pentru a păstra)'}</label><input className="form-input" type="password" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} required={!user} /></div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Se salvează...' : 'Salvare'}</button>
          </div>
        </form>
      </div>
    </div>
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
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Arie Nouă de Producție</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Denumire Arie</label><input className="form-input" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required placeholder="ex: Aria Debitari" /></div>
          <div className="form-group"><label className="form-label">Descriere</label><input className="form-input" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="Optional..." /></div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary">Creare Arie</button>
          </div>
        </form>
      </div>
    </div>
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
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{machine ? 'Editare Utilaj' : `Utilaj Nou — ${area?.name}`}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Denumire Utilaj</label><input className="form-input" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Setup (min)</label><input className="form-input" type="number" value={form.setup_time_min} onChange={e=>setForm(p=>({...p,setup_time_min:+e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">Working (min)</label><input className="form-input" type="number" value={form.working_time_min} onChange={e=>setForm(p=>({...p,working_time_min:+e.target.value}))} /></div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary">Salvare</button>
          </div>
        </form>
      </div>
    </div>
  );
}
