import { useState, useEffect } from 'react';
import { Clock, LayoutDashboard, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';

export default function MaintenancePage() {
  const [machines, setMachines] = useState([]);
  const [showLogModal, setShowLogModal] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState(null);

  const loadStatus = async () => {
    try {
      const r = await api.get('/maintenance/status');
      setMachines(r.data);
    } catch (e) {}
  };

  useEffect(() => { loadStatus(); }, []);

  const openLog = (m) => {
    setSelectedMachine(m);
    setShowLogModal(true);
  };

  const navItems = [
    { path: '/supervisor', labelKey: 'sidebar.dashboard', icon: <LayoutDashboard size={16}/> },
    { path: '/supervisor/oee', labelKey: 'sidebar.oee_analytics', icon: <TrendingUp size={16}/> },
    { path: '/supervisor/maintenance', labelKey: 'sidebar.maintenance', icon: <Clock size={16}/> }
  ];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <h1>Planificare Mentenanță</h1>
          <p>Urmărirea orelor de funcționare și a intervențiilor tehnice.</p>
        </div>

        <div className="page-content">
          <div className="grid-3 mb-4">
            {machines.map(m => {
              const progress = m.interval_hours ? (m.hoursSinceLast / m.interval_hours) * 100 : 0;
              const color = m.isDue ? 'var(--red-light)' : m.isWarning ? 'var(--yellow-light)' : 'var(--green-light)';
              
              return (
                <div key={m.id} className="card">
                  <div className="flex justify-between items-center mb-4">
                    <span style={{ fontWeight: 700, fontSize: 18 }}>{m.name}</span>
                    {m.isDue && <AlertTriangle color="var(--red-light)" size={20} />}
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted">Utilizare de la ultima mentenanță</span>
                      <span style={{ fontWeight: 600, color }}>{Math.round(m.hoursSinceLast)} / {m.interval_hours || '∞'} ore</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${Math.min(100, progress)}%`, background: color }} />
                    </div>
                  </div>

                  <div className="flex justify-between text-xs text-muted mb-4">
                    <span>Total Ore Funcționare: <strong>{Math.round(m.total_running_hours)}h</strong></span>
                    <span>Interval: <strong>{m.interval_hours}h</strong></span>
                  </div>

                  <button className="btn btn-primary btn-block" onClick={() => openLog(m)}>
                    <CheckCircle size={14}/> Înregistrează Mentenanță
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showLogModal && selectedMachine && (
        <MaintenanceLogModal machine={selectedMachine} onClose={() => setShowLogModal(false)} onSave={() => { setShowLogModal(false); loadStatus(); }} />
      )}
    </div>
  );
}

function MaintenanceLogModal({ machine, onClose, onSave }) {
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/maintenance/log', { machine_id: machine.id, notes });
      toast.success('Mentenanță înregistrată cu succes');
      onSave();
    } catch (err) { toast.error('Eroare la salvarea log-ului'); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3>Log Mentenanță: {machine.name}</h3></div>
        <form onSubmit={handleSubmit}>
          <div className="alert alert-info">Înregistrarea mentenanței va reseta contorul de ore pentru acest utilaj la zero (relativ la ora curentă).</div>
          <div className="form-group">
            <label className="form-label">Note Intervenție</label>
            <textarea className="form-textarea" rows={4} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Descrieți lucrările efectuate (ex: schimbat filtre, gresat axe)..." required />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-success">Confirmă Finalizare Mentenanță</button>
          </div>
        </form>
      </div>
    </div>
  );
}
