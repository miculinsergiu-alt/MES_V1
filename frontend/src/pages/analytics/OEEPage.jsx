import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { LayoutDashboard, TrendingUp, CheckCircle, Clock } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import { useSocket } from '../../contexts/SocketContext';

export default function OEEPage() {
  const [stats, setStats] = useState(null);
  const socket = useSocket();

  const loadStats = async () => {
    try {
      const r = await api.get('/analytics/oee');
      setStats(r.data);
    } catch (e) {}
  };

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('production:results', loadStats);
    socket.on('production:action', loadStats);
    return () => {
      socket.off('production:results');
      socket.off('production:action');
    };
  }, [socket]);

  const navItems = [
    { path: '/supervisor', label: 'Dashboard', icon: <LayoutDashboard size={16}/> },
    { path: '/supervisor/oee', label: 'Analitice OEE', icon: <TrendingUp size={16}/> },
    { path: '/supervisor/maintenance', label: 'Mentenanță', icon: <Clock size={16}/> }
  ];

  if (!stats) return <div className="loading">Se încarcă datele OEE...</div>;

  const globalData = [
    { name: 'Disponibilitate', value: stats.overall_availability, color: '#3b82f6' },
    { name: 'Performanță', value: stats.overall_performance, color: '#10b981' },
    { name: 'Calitate', value: stats.overall_quality, color: '#f59e0b' }
  ];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <h1>Overall Equipment Effectiveness (OEE)</h1>
          <p>Monitorizare în timp real a eficienței fluxului de producție.</p>
        </div>

        <div className="page-content">
          <div className="grid-4 mb-4">
            <div className="card stat-card">
              <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--blue-light)' }}>{stats.overall_oee}%</div>
              <div className="stat-label">OEE GLOBAL</div>
            </div>
            {globalData.map(d => (
              <div key={d.name} className="card stat-card">
                <div style={{ fontSize: 24, fontWeight: 700, color: d.color }}>{d.value}%</div>
                <div className="stat-label">{d.name.toUpperCase()}</div>
              </div>
            ))}
          </div>

          <div className="grid-2 mb-4">
            <div className="card">
              <div className="card-title">Eficiență Componente OEE</div>
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={globalData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} />
                    <YAxis stroke="var(--text-muted)" fontSize={12} domain={[0, 100]} />
                    <Tooltip 
                      contentStyle={{ background: '#1a2235', border: '1px solid rgba(255,255,255,0.1)' }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {globalData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="card-title">OEE per Utilaj</div>
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.by_machine} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis type="number" stroke="var(--text-muted)" fontSize={12} domain={[0, 100]} />
                    <YAxis dataKey="machine_id" type="category" stroke="var(--text-muted)" fontSize={12} tickFormatter={(id) => `Utilaj #${id}`} />
                    <Tooltip 
                      contentStyle={{ background: '#1a2235', border: '1px solid rgba(255,255,255,0.1)' }}
                    />
                    <Bar dataKey="oee" fill="var(--green-light)" radius={[0, 4, 4, 0]} name="OEE %" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Detalii Metrici Utilaje</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Utilaj</th>
                  <th>OEE</th>
                  <th>Disponibilitate</th>
                  <th>Performanță</th>
                  <th>Calitate</th>
                  <th>Produs (OK/FAIL)</th>
                </tr>
              </thead>
              <tbody>
                {stats.by_machine.map(m => (
                  <tr key={m.machine_id}>
                    <td style={{ fontWeight: 600 }}>Utilaj #{m.machine_id}</td>
                    <td><span className={`badge ${m.oee > 75 ? 'badge-green' : m.oee > 50 ? 'badge-yellow' : 'badge-red'}`}>{m.oee}%</span></td>
                    <td>{m.availability}%</td>
                    <td>{m.performance}%</td>
                    <td>{m.quality}%</td>
                    <td>{m.metrics.totalQtyOk} / {m.metrics.totalQtyFail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
