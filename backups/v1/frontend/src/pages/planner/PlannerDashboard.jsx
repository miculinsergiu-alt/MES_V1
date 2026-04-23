import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Calendar, Plus, X, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import GanttTimeline from '../../components/GanttTimeline';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format, addDays, subDays } from 'date-fns';
import { ro } from 'date-fns/locale';

export default function PlannerDashboard() {
  const [tab, setTab] = useState('gantt');
  const [orders, setOrders] = useState([]);
  const [machines, setMachines] = useState([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDelayModal, setShowDelayModal] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [oRes, mRes] = await Promise.all([api.get('/orders/gantt'), api.get('/machines')]);
      setOrders(oRes.data); setMachines(mRes.data);
    } catch {}
  }, []);

  useEffect(() => { loadData(); const i = setInterval(loadData, 15000); return () => clearInterval(i); }, [loadData]);

  const navItems = [
    { path:'/planner', label:'Gantt Producție', icon:<LayoutDashboard size={16}/> },
    { path:'/planner/orders', label:'Comenzi', icon:<Calendar size={16}/> },
  ];

  const statusBadge = (s) => ({ pending:'badge-gray', active:'badge-green', done:'badge-blue', cancelled:'badge-red' })[s] || 'badge-gray';
  const statusRo = { pending:'În așteptare', active:'Activ', done:'Finalizat', cancelled:'Anulat' };

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <div className="flex justify-between items-center">
            <div><h1>Dashboard Planner</h1><p>Planificare și monitorizare comenzi de producție</p></div>
            <button className="btn btn-primary" onClick={() => setShowOrderModal(true)}><Plus size={16}/> Comandă Nouă</button>
          </div>
        </div>
        <div className="page-content">
          <div className="tabs">
            {[['gantt','📊 Gantt Timeline'],['list','📋 Lista Comenzi']].map(([k,l]) => (
              <button key={k} className={`tab-btn ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === 'gantt' && (
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <span className="card-title">Plan Producție — {format(viewDate, 'EEEE, dd MMMM yyyy', { locale: ro })}</span>
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => subDays(d,1))}><ChevronLeft size={14}/></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(new Date())}>Azi</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => addDays(d,1))}><ChevronRight size={14}/></button>
                </div>
              </div>
              <GanttTimeline orders={orders} machines={machines} viewDate={viewDate} onBlockClick={o => setSelectedOrder(o)} />
            </div>
          )}

          {tab === 'list' && (
            <div className="card">
              <div className="card-title">Toate Comenzile</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Produs</th><th>Utilaj</th><th>Start Planificat</th><th>Sfârșit Planificat</th><th>Cantitate</th><th>Status</th><th>Acțiuni</th></tr></thead>
                  <tbody>
                    {orders.length === 0 && <tr><td colSpan={7} className="text-muted" style={{ textAlign:'center', padding:32 }}>Nicio comandă înregistrată</td></tr>}
                    {orders.map(o => {
                      const machine = machines.find(m => m.id === o.machine_id);
                      const totalDelay = (o.delays||[]).filter(d=>d.applied).reduce((a,d)=>a+d.delay_minutes,0);
                      return (
                        <tr key={o.id}>
                          <td style={{ fontWeight:500, color:'var(--text-primary)' }}>{o.product_name}</td>
                          <td>{machine?.name || `#${o.machine_id}`}</td>
                          <td style={{ fontSize:12 }}>{o.planned_start?.substring(0,16)}</td>
                          <td style={{ fontSize:12 }}>
                            {o.planned_end?.substring(0,16)}
                            {totalDelay > 0 && <span className="badge badge-red" style={{ marginLeft:6 }}>+{totalDelay}m</span>}
                          </td>
                          <td>{o.quantity} buc</td>
                          <td><span className={`badge ${statusBadge(o.status)}`}>{statusRo[o.status]}</span></td>
                          <td>
                            <div className="flex gap-2">
                              <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedOrder(o); }}>Detalii</button>
                              {o.status !== 'cancelled' && o.status !== 'done' && (
                                <button className="btn btn-warning btn-sm" onClick={() => { setSelectedOrder(o); setShowDelayModal(true); }}><AlertCircle size={12}/> Delay</button>
                              )}
                              {o.status === 'pending' && (
                                <button className="btn btn-danger btn-sm" onClick={async () => { await api.delete(`/orders/${o.id}`); toast.success('Comandă anulată'); loadData(); }}>Anulare</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {showOrderModal && <CreateOrderModal machines={machines} onClose={() => setShowOrderModal(false)} onSave={() => { loadData(); setShowOrderModal(false); }} />}
      {showDelayModal && selectedOrder && <DelayModal order={selectedOrder} onClose={() => { setShowDelayModal(false); setSelectedOrder(null); }} onSave={() => { loadData(); setShowDelayModal(false); }} />}
      {selectedOrder && !showDelayModal && (
        <OrderDetailModal order={selectedOrder} machines={machines} onClose={() => setSelectedOrder(null)} onDelay={() => setShowDelayModal(true)} />
      )}
    </div>
  );
}

function CreateOrderModal({ machines, onClose, onSave }) {
  const [orders, setOrders] = useState([{ machine_id:'', product_name:'', quantity:1, planned_start:'', planned_end:'' }]);
  const [loading, setLoading] = useState(false);
  const [multiple, setMultiple] = useState(false);

  const addOrder = () => setOrders(p => [...p, { machine_id:'', product_name:'', quantity:1, planned_start:'', planned_end:'' }]);
  const removeOrder = (i) => setOrders(p => p.filter((_,idx) => idx !== i));
  const setField = (i, k, v) => setOrders(p => p.map((o,idx) => idx===i ? {...o,[k]:v} : o));

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const payload = orders.map(o => ({
        ...o, machine_id: parseInt(o.machine_id), quantity: parseInt(o.quantity),
        planned_start: o.planned_start.replace('T',' '), planned_end: o.planned_end.replace('T',' ')
      }));
      await api.post('/orders', { orders: payload });
      toast.success(`${payload.length} comandă/comenzi create`); onSave();
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3>Creare Plan Producție</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <label style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16, fontSize:14, cursor:'pointer' }}>
          <input type="checkbox" checked={multiple} onChange={e => setMultiple(e.target.checked)} />
          Comenzi multiple pe același utilaj
        </label>
        <form onSubmit={handleSubmit}>
          {orders.map((order, i) => (
            <div key={i} style={{ background:'var(--bg-primary)', padding:16, borderRadius:'var(--radius-sm)', marginBottom:12, border:'1px solid var(--border)' }}>
              {multiple && orders.length > 1 && <div className="flex justify-between mb-2"><span style={{ fontSize:13, fontWeight:600, color:'var(--text-muted)' }}>Comanda {i+1}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => removeOrder(i)}><X size={12}/></button></div>}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Utilaj</label>
                  <select className="form-select" value={order.machine_id} onChange={e=>setField(i,'machine_id',e.target.value)} required>
                    <option value="">Selectați utilajul...</option>
                    {machines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.area_name})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Produs</label>
                  <input className="form-input" value={order.product_name} onChange={e=>setField(i,'product_name',e.target.value)} placeholder="Denumire produs" required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Data/Ora Start</label><input className="form-input" type="datetime-local" value={order.planned_start} onChange={e=>setField(i,'planned_start',e.target.value)} required /></div>
                <div className="form-group"><label className="form-label">Data/Ora Sfârșit</label><input className="form-input" type="datetime-local" value={order.planned_end} onChange={e=>setField(i,'planned_end',e.target.value)} required /></div>
              </div>
              <div className="form-group"><label className="form-label">Cantitate (buc)</label><input className="form-input" type="number" min={1} value={order.quantity} onChange={e=>setField(i,'quantity',e.target.value)} required /></div>
            </div>
          ))}
          {multiple && <button type="button" className="btn btn-ghost btn-sm" onClick={addOrder} style={{ marginBottom:16 }}><Plus size={14}/> Adaugă Comandă</button>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Se creează...' : 'Confirmare'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DelayModal({ order, onClose, onSave }) {
  const [mins, setMins] = useState(30);
  const [reason, setReason] = useState('');
  const handleSubmit = async (e) => {
    e.preventDefault();
    try { await api.post(`/orders/${order.id}/delay`, { delay_minutes: parseInt(mins), reason, source:'system' }); toast.success('Delay aplicat și propagat'); onSave(); }
    catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3>Adăugare Delay — {order.product_name}</h3><button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button></div>
        <div className="alert alert-warning">Delay-ul va fi propagat automat la toate comenzile ulterioare pe același utilaj.</div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Delay (minute)</label><input className="form-input" type="number" min={1} value={mins} onChange={e=>setMins(e.target.value)} required /></div>
          <div className="form-group"><label className="form-label">Motiv</label><textarea className="form-textarea" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Descrieți cauza întârzierii..." /></div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-warning">Aplicare Delay</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrderDetailModal({ order, machines, onClose, onDelay }) {
  const machine = machines.find(m => m.id === order.machine_id);
  const totalDelay = (order.delays||[]).filter(d=>d.applied).reduce((a,d)=>a+d.delay_minutes,0);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><h3>Detalii Comandă #{order.id}</h3><button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button></div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {[['Produs',order.product_name],['Utilaj',machine?.name],['Cantitate',`${order.quantity} buc`],['Status',order.status],['Start planificat',order.planned_start?.substring(0,16)],['Sfârșit planificat',order.planned_end?.substring(0,16)]].map(([l,v]) => (
            <div key={l} style={{ padding:12, background:'var(--bg-primary)', borderRadius:'var(--radius-sm)' }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>{l}</div>
              <div style={{ fontWeight:600, fontSize:14 }}>{v || '—'}</div>
            </div>
          ))}
        </div>
        {totalDelay > 0 && <div className="alert alert-error" style={{ marginTop:16 }}>Total delay acumulat: {totalDelay} minute</div>}
        {(order.delays||[]).length > 0 && (
          <div style={{ marginTop:16 }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Istoric Delay-uri</div>
            {order.delays.map(d => (
              <div key={d.id} style={{ fontSize:12, padding:'6px 10px', background:'var(--bg-primary)', borderRadius:6, marginBottom:4, borderLeft:`3px solid ${d.applied?'var(--red-light)':'var(--text-muted)'}` }}>
                {d.applied ? '🔴' : '⚪'} {d.delay_minutes}m — {d.reason || 'Fără motiv'} ({d.source})
              </div>
            ))}
          </div>
        )}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Închidere</button>
          {order.status !== 'cancelled' && order.status !== 'done' && <button className="btn btn-warning" onClick={onDelay}><AlertCircle size={14}/> Adaugă Delay</button>}
        </div>
      </div>
    </div>
  );
}
