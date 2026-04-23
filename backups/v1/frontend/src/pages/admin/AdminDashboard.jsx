import { useState, useEffect } from 'react';
import { Users, Settings, Factory, LayoutDashboard, Plus, Edit2, Trash2, Eye, EyeOff, X, ChevronDown, ChevronRight } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';

const ROLES_RO = { administrator:'Administrator', planner:'Planner', area_supervisor:'Area Supervisor', shift_responsible:'Shift Responsible', operator:'Operator' };

export default function AdminDashboard() {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editMachine, setEditMachine] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [expandedAreas, setExpandedAreas] = useState({});

  const loadUsers = async () => { try { const r = await api.get('/users'); setUsers(r.data); } catch {} };
  const loadAreas = async () => { try { const r = await api.get('/machines/areas'); setAreas(r.data); } catch {} };

  useEffect(() => { loadUsers(); loadAreas(); const i = setInterval(() => { loadUsers(); loadAreas(); }, 30000); return () => clearInterval(i); }, []);

  const navItems = [
    { path:'/admin', label:'Dashboard', icon:<LayoutDashboard size={16}/> },
    { path:'/admin/users', label:'Utilizatori', icon:<Users size={16}/> },
    { path:'/admin/machines', label:'Arii & Utilaje', icon:<Factory size={16}/> },
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
          {/* Stats */}
          <div className="grid-4 mb-4">
            {[
              { label:'Total Utilizatori', value:users.length, color:'var(--blue-light)' },
              { label:'Utilizatori Activi', value:users.filter(u=>u.active).length, color:'var(--green-light)' },
              { label:'Arii Producție', value:areas.length, color:'var(--purple)' },
              { label:'Utilaje Total', value:areas.reduce((a,ar)=>a+(ar.machines?.length||0),0), color:'var(--yellow-light)' },
            ].map(s => (
              <div key={s.label} className="card stat-card">
                <div style={{ fontSize:32, fontWeight:800, color:s.color }}>{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>

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
                  <thead><tr><th>Nume</th><th>Legitimație</th><th>Rol</th><th>Status</th><th>Acțiuni</th></tr></thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td style={{ fontWeight:500, color:'var(--text-primary)' }}>{u.first_name} {u.last_name}</td>
                        <td><span className="badge badge-blue">{u.badge_number}</span></td>
                        <td><span className="badge badge-purple">{ROLES_RO[u.role]}</span></td>
                        <td><span className={`badge ${u.active ? 'badge-green' : 'badge-gray'}`}>{u.active ? 'Activ' : 'Inactiv'}</span></td>
                        <td>
                          <div className="flex gap-2">
                            <button className="btn btn-ghost btn-sm" onClick={() => { setEditUser(u); setShowUserModal(true); }}><Edit2 size={13}/></button>
                            <button className="btn btn-danger btn-sm" onClick={async () => { await api.delete(`/users/${u.id}`); toast.success('Utilizator dezactivat'); loadUsers(); }}><Trash2 size={13}/></button>
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
            <div className="grid-2">
              {/* Areas tree */}
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <span className="card-title">Arii de Producție</span>
                  <button className="btn btn-primary btn-sm" onClick={() => setShowAreaModal(true)}><Plus size={14}/> Arie Nouă</button>
                </div>
                {areas.map(area => (
                  <div key={area.id} style={{ marginBottom:8 }}>
                    <div
                      className="flex items-center justify-between"
                      style={{ padding:'10px 12px', background:'var(--bg-primary)', borderRadius:'var(--radius-sm)', cursor:'pointer', border:'1px solid var(--border)' }}
                      onClick={() => setExpandedAreas(p => ({ ...p, [area.id]: !p[area.id] }))}
                    >
                      <div className="flex items-center gap-2">
                        {expandedAreas[area.id] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                        <span style={{ fontWeight:600, fontSize:14 }}>{area.name}</span>
                        <span className="badge badge-gray">{area.machines?.length || 0} utilaje</span>
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); setSelectedArea(area); setEditMachine(null); setShowMachineModal(true); }}><Plus size={12}/></button>
                    </div>
                    {expandedAreas[area.id] && (area.machines||[]).map(m => (
                      <div key={m.id} style={{ marginLeft:20, marginTop:4, padding:'8px 12px', background:'var(--glass)', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)', fontSize:13 }}>
                        <div className="flex justify-between items-center">
                          <span style={{ fontWeight:500 }}>{m.name}</span>
                          <div className="flex gap-2">
                            <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedArea(area); setEditMachine(m); setShowMachineModal(true); }}><Settings size={12}/></button>
                          </div>
                        </div>
                        <div className="flex gap-3 mt-1">
                          <span style={{ fontSize:11, color:'var(--blue-light)' }}>Setup: {m.setup_time_min}m</span>
                          <span style={{ fontSize:11, color:'var(--green-light)' }}>Working: {m.working_time_min}m</span>
                          <span style={{ fontSize:11, color:'var(--yellow-light)' }}>Supervision: {m.supervision_time_min}m</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {/* Time defaults info */}
              <div className="card">
                <div className="card-title">Legenda Timpi</div>
                {[['Setup Time','var(--setup-color)','Timp de pregătire înainte de producție'],['Working Time','var(--working-color)','Timp efectiv de producție'],['Supervision Time','var(--supervision-color)','Timp de supervizare post-producție']].map(([name,color,desc]) => (
                  <div key={name} style={{ display:'flex', gap:12, padding:'12px 0', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ width:16, height:16, borderRadius:4, background:color, marginTop:2, flexShrink:0 }} />
                    <div>
                      <div style={{ fontWeight:600, fontSize:14 }}>{name}</div>
                      <div style={{ fontSize:12, color:'var(--text-muted)' }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User Modal */}
      {showUserModal && <UserModal user={editUser} onClose={() => setShowUserModal(false)} onSave={() => { loadUsers(); setShowUserModal(false); }} />}
      {showAreaModal && <AreaModal onClose={() => setShowAreaModal(false)} onSave={() => { loadAreas(); setShowAreaModal(false); }} />}
      {showMachineModal && <MachineModal machine={editMachine} area={selectedArea} onClose={() => setShowMachineModal(false)} onSave={() => { loadAreas(); setShowMachineModal(false); }} />}
    </div>
  );
}

function UserModal({ user, onClose, onSave }) {
  const [form, setForm] = useState({ first_name:user?.first_name||'', last_name:user?.last_name||'', badge_number:user?.badge_number||'', role:user?.role||'operator', password:'' });
  const [loading, setLoading] = useState(false);
  const set = (k,v) => setForm(p => ({ ...p, [k]:v }));

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      if (user) await api.put(`/users/${user.id}`, form);
      else await api.post('/users', form);
      toast.success(user ? 'Utilizator actualizat' : 'Utilizator creat');
      onSave();
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); } finally { setLoading(false); }
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
            <div className="form-group"><label className="form-label">Prenume</label><input className="form-input" value={form.first_name} onChange={e=>set('first_name',e.target.value)} required /></div>
            <div className="form-group"><label className="form-label">Nume</label><input className="form-input" value={form.last_name} onChange={e=>set('last_name',e.target.value)} required /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Nr. Legitimație</label><input className="form-input" value={form.badge_number} onChange={e=>set('badge_number',e.target.value.toUpperCase())} required disabled={!!user} /></div>
            <div className="form-group"><label className="form-label">Nivel</label>
              <select className="form-select" value={form.role} onChange={e=>set('role',e.target.value)}>
                {Object.entries(ROLES_RO).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label className="form-label">Parolă {user && '(lăsați gol pentru a păstra)'}</label><input className="form-input" type="password" value={form.password} onChange={e=>set('password',e.target.value)} required={!user} /></div>
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
    try { await api.post('/machines/areas', form); toast.success('Arie creată'); onSave(); }
    catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3>Arie Nouă de Producție</h3><button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Denumire Arie</label><input className="form-input" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required /></div>
          <div className="form-group"><label className="form-label">Descriere</label><input className="form-input" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} /></div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary">Creare</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MachineModal({ machine, area, onClose, onSave }) {
  const [form, setForm] = useState({ name:machine?.name||'', setup_time_min:machine?.setup_time_min||30, working_time_min:machine?.working_time_min||480, supervision_time_min:machine?.supervision_time_min||30 });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
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
        <div className="modal-header"><h3>{machine ? 'Editare Utilaj' : `Utilaj Nou — ${area?.name}`}</h3><button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Denumire Utilaj</label><input className="form-input" value={form.name} onChange={e=>set('name',e.target.value)} required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label" style={{ color:'var(--blue-light)' }}>Setup Time (min)</label><input className="form-input" type="number" value={form.setup_time_min} onChange={e=>set('setup_time_min',+e.target.value)} min={0} /></div>
            <div className="form-group"><label className="form-label" style={{ color:'var(--green-light)' }}>Working Time (min)</label><input className="form-input" type="number" value={form.working_time_min} onChange={e=>set('working_time_min',+e.target.value)} min={1} /></div>
          </div>
          <div className="form-group"><label className="form-label" style={{ color:'var(--yellow-light)' }}>Supervision Time (min)</label><input className="form-input" type="number" value={form.supervision_time_min} onChange={e=>set('supervision_time_min',+e.target.value)} min={0} /></div>
          <div style={{ display:'flex', gap:8, marginBottom:16 }}>
            {[['Setup','var(--setup-color)',form.setup_time_min],['Working','var(--working-color)',form.working_time_min],['Supervision','var(--supervision-color)',form.supervision_time_min]].map(([l,c,v]) => (
              <div key={l} style={{ flex:v/(form.setup_time_min+form.working_time_min+form.supervision_time_min||1), height:20, background:c, borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:l==='supervision'?'#000':'#fff', fontWeight:600, transition:'all 0.3s' }}>{l}</div>
            ))}
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
