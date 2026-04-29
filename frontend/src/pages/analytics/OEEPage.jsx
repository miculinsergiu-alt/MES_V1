import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { LayoutDashboard, TrendingUp, Clock, Activity, CheckCircle, Target, AlertCircle, DollarSign } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import { useSocket } from '../../contexts/SocketContext';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';

const COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#64748b'];

export default function OEEPage() {
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const socket = useSocket();

  const loadStats = async () => {
    try {
      const [oeeRes, summaryRes] = await Promise.all([
        api.get('/oee'),
        api.get('/analytics/summary')
      ]);
      
      const results = oeeRes.data.results || [];
      setSummary(summaryRes.data);
      
      // Calculate global averages
      let totalA = 0, totalP = 0, totalQ = 0, totalO = 0;
      if (results.length > 0) {
        totalA = results.reduce((acc, r) => acc + r.availability, 0) / results.length;
        totalP = results.reduce((acc, r) => acc + r.performance, 0) / results.length;
        totalQ = results.reduce((acc, r) => acc + r.quality, 0) / results.length;
        totalO = totalA * totalP * totalQ;
      }

      setStats({
        overall_availability: Math.round(totalA * 100),
        overall_performance: Math.round(totalP * 100),
        overall_quality: Math.round(totalQ * 100),
        overall_oee: Math.round(totalO * 100),
        by_machine: results.map(r => ({
          machine_id: r.machine_id,
          machine_name: r.machine_name,
          availability: Math.round(r.availability * 100),
          performance: Math.round(r.performance * 100),
          quality: Math.round(r.quality * 100),
          oee: Math.round(r.oee * 100),
          metrics: r.metrics
        }))
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStats(); }, []);

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

  if (loading || !stats) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-accent">
          <div className="w-8 h-8 border-4 border-dashed border-current animate-spin-slow rounded-full"></div>
          <span className="font-mono text-sm tracking-widest uppercase font-bold">Calculare OEE...</span>
        </div>
      </div>
    );
  }

  const globalData = [
    { name: 'Disponibilitate', value: stats.overall_availability, color: '#3b82f6' },
    { name: 'Performanță', value: stats.overall_performance, color: '#10b981' },
    { name: 'Calitate', value: stats.overall_quality, color: '#f59e0b' }
  ];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar items={navItems} />
      <div className="flex-1 p-10 overflow-auto">
        <header className="mb-10">
          <Badge className="mb-4">OEE Engine v2.0</Badge>
          <h1 className="font-display text-4xl text-foreground">Overall Equipment <span className="gradient-text">Effectiveness</span></h1>
          <p className="text-muted-foreground mt-2">Monitorizare în timp real a performanței utilajelor și a abaterilor de proces.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="flex flex-col justify-center items-center py-8 relative overflow-hidden bg-accent/5 border-accent/20">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-accent to-blue-400"></div>
            <Target size={24} className="text-accent mb-4 opacity-50" />
            <div className="text-5xl font-display text-accent mb-2">{stats.overall_oee}%</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">OEE GLOBAL</div>
          </Card>
          
          <Card className="flex flex-col justify-center items-center py-8">
            <Activity size={24} className="text-blue-500 mb-4 opacity-50" />
            <div className="text-4xl font-display text-foreground mb-2">{stats.overall_availability}%</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Disponibilitate</div>
          </Card>
          
          <Card className="flex flex-col justify-center items-center py-8">
            <TrendingUp size={24} className="text-green-500 mb-4 opacity-50" />
            <div className="text-4xl font-display text-foreground mb-2">{stats.overall_performance}%</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Performanță</div>
          </Card>
          
          <Card className="flex flex-col justify-center items-center py-8">
            <CheckCircle size={24} className="text-amber-500 mb-4 opacity-50" />
            <div className="text-4xl font-display text-foreground mb-2">{stats.overall_quality}%</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Calitate</div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <h3 className="font-semibold text-foreground mb-6">Componente OEE (Global)</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer>
                <BarChart data={globalData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} domain={[0, 100]} />
                  <Tooltip cursor={{fill: 'rgba(0,0,0,0.02)'}} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={60}>
                    {globalData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <h3 className="font-semibold text-foreground mb-6">OEE per Utilaj</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer>
                <BarChart data={stats.by_machine} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} domain={[0, 100]} />
                  <YAxis dataKey="machine_name" type="category" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} width={100} />
                  <Tooltip cursor={{fill: 'rgba(0,0,0,0.02)'}} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                  <Bar dataKey="oee" fill="#8b5cf6" radius={[0, 6, 6, 0]} name="OEE %" maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
           <Card>
             <div className="flex justify-between items-center mb-6">
                <h3 className="font-semibold text-foreground flex items-center gap-2"><AlertCircle size={18} className="text-red-500"/> Cauze Întârzieri (Pareto)</h3>
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Top Minute</span>
             </div>
             <div className="h-72 w-full">
               <ResponsiveContainer>
                 <PieChart>
                    <Pie
                      data={summary?.delays || []}
                      dataKey="total_minutes"
                      nameKey="reason"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                    >
                      {(summary?.delays || []).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36}/>
                 </PieChart>
               </ResponsiveContainer>
             </div>
           </Card>

           <Card className="p-0 overflow-hidden">
              <div className="p-6 border-b border-border bg-muted/5 flex justify-between items-center">
                <h3 className="font-semibold text-foreground flex items-center gap-2"><DollarSign size={18} className="text-green-600"/> Abateri de Cost (Real vs Std)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <th className="px-6 py-4 text-[10px] font-bold uppercase text-muted-foreground">Comandă</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase text-muted-foreground">Cost Std.</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase text-muted-foreground">Cost Real</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase text-muted-foreground text-right">Variație</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {summary?.costs.map(c => (
                      <tr key={c.order_id}>
                        <td className="px-6 py-4">
                           <div className="text-sm font-bold">{c.product}</div>
                           <div className="text-[10px] text-muted-foreground">ID: #{c.order_id}</div>
                        </td>
                        <td className="px-6 py-4 font-mono text-sm">{c.standard_cost.toFixed(2)}</td>
                        <td className="px-6 py-4 font-mono text-sm">{c.real_cost.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right">
                           <span className={`text-xs font-black px-2 py-0.5 rounded-full ${c.variance <= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                             {c.variance > 0 ? '+' : ''}{c.variance_percent.toFixed(1)}%
                           </span>
                        </td>
                      </tr>
                    ))}
                    {(!summary || summary.costs.length === 0) && (
                      <tr><td colSpan="4" className="p-8 text-center text-muted-foreground italic">Nicio dată de cost disponibilă.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
           </Card>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="p-6 border-b border-border bg-muted/5">
            <h3 className="font-semibold text-foreground">Analiză Detaliată per Stație</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Utilaj</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Scor OEE</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Disponibilitate</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Performanță</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Calitate</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Piese (OK/FAIL)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {stats.by_machine.map(m => (
                  <tr key={m.machine_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-semibold text-foreground">{m.machine_name}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border ${m.oee > 75 ? 'bg-green-50 text-green-600 border-green-200' : m.oee > 50 ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                        {m.oee}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground/80">{m.availability}%</td>
                    <td className="px-6 py-4 text-sm text-foreground/80">{m.performance}%</td>
                    <td className="px-6 py-4 text-sm text-foreground/80">{m.quality}%</td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-mono text-green-600">{m.metrics.total_ok}</span>
                      <span className="text-sm font-mono text-muted-foreground mx-1">/</span>
                      <span className="text-sm font-mono text-red-600">{m.metrics.total_produced - m.metrics.total_ok}</span>
                    </td>
                  </tr>
                ))}
                {stats.by_machine.length === 0 && (
                  <tr><td colSpan="6" className="p-8 text-center text-muted-foreground italic">Nu există date de producție pentru calcularea OEE.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
