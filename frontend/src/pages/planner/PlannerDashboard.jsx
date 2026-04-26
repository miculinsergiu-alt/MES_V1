import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, FileText, Plus, X, Search, ChevronLeft, ChevronRight, Box, AlertCircle, Trash2, Edit2 } from 'lucide-react';
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
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDelayModal, setShowDelayModal] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [oRes, mRes] = await Promise.all([api.get('/orders/gantt'), api.get('/machines')]);
      setOrders(oRes.data); setMachines(mRes.data);
    } catch {}
  }, []);

  const handleDeleteOrder = async (orderId) => {
    if (!window.confirm('Sunteți sigur că doriți să ștergeți această comandă? Această acțiune este ireversibilă.')) return;
    try {
      await api.delete(`/orders/${orderId}`);
      toast.success('Comanda a fost ștearsă.');
      setSelectedOrder(null);
      loadData();
    } catch (err) {
      toast.error('Eroare la ștergerea comenzii.');
    }
  };

  useEffect(() => { loadData(); const i = setInterval(loadData, 15000); return () => clearInterval(i); }, [loadData]);

  const navItems = [
    { path:'/planner/gantt', label:'Plan Producție', icon:<LayoutDashboard size={16}/> },
    { path:'/planner/orders', label:'Gestionare Comenzi', icon:<FileText size={16}/> },
    { path:'/planner/items', label:'Nomenclator & BOM', icon:<Box size={16}/> },
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
                <div className="flex gap-2 items-center">
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => subDays(d,1))}><ChevronLeft size={14}/></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(new Date())}>Azi</button>
                  <input 
                    type="date" 
                    className="form-input" 
                    style={{ padding: '0 8px', height: '32px', fontSize: '13px', width: 'auto' }} 
                    value={format(viewDate, 'yyyy-MM-dd')} 
                    onChange={e => { if (e.target.value) setViewDate(new Date(e.target.value)); }} 
                  />
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => addDays(d,1))}><ChevronRight size={14}/></button>
                </div>
              </div>
              <GanttTimeline orders={orders} machines={machines} viewDate={viewDate} onBlockClick={o => setSelectedOrder(o)} />
            </div>
          )}

          {tab === 'list' && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Produs</th>
                    <th>Utilaj</th>
                    <th>Start Planificat</th>
                    <th>Sfârșit Planificat</th>
                    <th>Cantitate</th>
                    <th>Status</th>
                    <th className="text-center">Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 && <tr><td colSpan={7} className="text-center py-12 italic">Nicio comandă înregistrată</td></tr>}
                  {orders.map(o => {
                    const machine = machines.find(m => m.id === o.machine_id);
                    const totalDelay = (o.delays||[]).filter(d=>d.applied).reduce((a,d)=>a+d.delay_minutes,0);
                    return (
                      <tr key={o.id}>
                        <td className="font-bold text-foreground">{o.product_name}</td>
                        <td>{machine?.name || `#${o.machine_id}`}</td>
                        <td>{o.planned_start?.substring(0,16)}</td>
                        <td>
                          {o.planned_end?.substring(0,16)}
                          {totalDelay > 0 && <span className="text-red font-bold ml-2">+{totalDelay}m</span>}
                        </td>
                        <td className="font-mono">{o.quantity} buc</td>
                        <td><span className={`badge ${statusBadge(o.status)}`}>{statusRo[o.status]}</span></td>
                        <td>
                          <div className="flex justify-center gap-2">
                            <button className="btn btn-secondary btn-sm" onClick={() => setSelectedOrder(o)}>Detalii</button>
                            {o.status !== 'cancelled' && o.status !== 'done' && (
                              <button className="btn btn-secondary btn-sm text-yellow-600 border-yellow-200 bg-yellow-50" onClick={() => { setSelectedOrder(o); setShowDelayModal(true); }}>Delay</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showOrderModal && <CreateOrderModal machines={machines} onClose={() => setShowOrderModal(false)} onSave={() => { loadData(); setShowOrderModal(false); }} />}
      {showEditModal && selectedOrder && <EditOrderModal order={selectedOrder} machines={machines} onClose={() => setShowEditModal(false)} onSave={() => { loadData(); setShowEditModal(false); setSelectedOrder(null); }} />}
      {showDelayModal && selectedOrder && <DelayModal order={selectedOrder} onClose={() => { setShowDelayModal(false); setSelectedOrder(null); }} onSave={() => { loadData(); setShowDelayModal(false); }} />}
      {selectedOrder && !showDelayModal && !showEditModal && (
        <OrderDetailModal 
          order={selectedOrder} 
          machines={machines} 
          onClose={() => setSelectedOrder(null)} 
          onDelay={() => setShowDelayModal(true)} 
          onEdit={() => setShowEditModal(true)}
          onDelete={() => handleDeleteOrder(selectedOrder.id)}
        />
      )}
    </div>
  );
}

function CreateOrderModal({ machines, onClose, onSave }) {
  const [orders, setOrders] = useState([{ machine_id:'', item_id:'', bom_id:'', product_name:'', quantity:1, planned_start:'', planned_end:'' }]);
  const [loading, setLoading] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [items, setItems] = useState([]);
  const [boms, setBoms] = useState([]);

  useEffect(() => {
    Promise.all([api.get('/items'), api.get('/boms')]).then(([iRes, bRes]) => {
      setItems(iRes.data.filter(i => i.type !== 'raw_material'));
      setBoms(bRes.data);
    }).catch(err => console.error(err));
  }, []);

  const addOrder = () => setOrders(p => [...p, { machine_id:'', item_id:'', bom_id:'', product_name:'', quantity:1, planned_start:'', planned_end:'' }]);
  const removeOrder = (i) => setOrders(p => p.filter((_,idx) => idx !== i));
  
  const setField = (i, k, v) => setOrders(p => p.map((o,idx) => {
    if (idx !== i) return o;
    const newO = {...o, [k]:v};
    if (k === 'item_id') {
      const selectedItem = items.find(it => it.id === parseInt(v));
      newO.product_name = selectedItem ? selectedItem.name : '';
      newO.bom_id = '';
    }
    return newO;
  }));

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const payload = orders.map(o => ({
        ...o, 
        machine_id: parseInt(o.machine_id), 
        quantity: parseInt(o.quantity),
        item_id: o.item_id ? parseInt(o.item_id) : null,
        bom_id: o.bom_id ? parseInt(o.bom_id) : null,
        planned_start: o.planned_start.replace('T',' '), 
        planned_end: o.planned_end.replace('T',' ')
      }));
      await api.post('/orders', { orders: payload });
      toast.success(`${payload.length} comandă/comenzi create`); onSave();
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden border border-border flex flex-col max-h-[90vh]">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center bg-white sticky top-0 z-10">
          <div>
            <h3 className="font-display text-2xl text-foreground">Creare Plan Producție</h3>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mt-1">Lansare comenzi noi în flux</p>
          </div>
          <button className="p-2 hover:bg-muted rounded-full transition-colors" onClick={onClose}><X size={24}/></button>
        </div>

        <div className="p-8 overflow-y-auto">
          <div className="mb-8 flex items-center gap-3 p-4 bg-accent/5 border border-accent/20 rounded-2xl">
            <input 
              type="checkbox" 
              id="multiple-check"
              className="w-5 h-5 rounded-md border-border text-accent focus:ring-accent" 
              checked={multiple} 
              onChange={e => setMultiple(e.target.checked)} 
            />
            <label htmlFor="multiple-check" className="text-sm font-bold text-accent cursor-pointer">Permite comenzi multiple pe același utilaj</label>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {orders.map((order, i) => (
              <div key={i} className="relative p-6 rounded-2xl border border-border bg-slate-50/50 space-y-6">
                {multiple && orders.length > 1 && (
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground bg-white px-2 py-1 rounded-md border border-border">Comanda {i+1}</span>
                    <button type="button" className="text-red-500 hover:text-red-700 p-1" onClick={() => removeOrder(i)}><Trash2 size={16}/></button>
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Utilaj Producție</label>
                    <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm font-medium" value={order.machine_id} onChange={e=>setField(i,'machine_id',e.target.value)} required>
                      <option value="">Selectați utilajul...</option>
                      {machines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.area_name})</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Produs (Nomenclator)</label>
                    <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm font-medium" value={order.item_id} onChange={e=>setField(i,'item_id',e.target.value)} required>
                      <option value="">Selectați un produs...</option>
                      {items.map(it => <option key={it.id} value={it.id}>{it.item_code} - {it.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Rețetă BOM (Opțional)</label>
                    <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm font-medium disabled:opacity-50" value={order.bom_id} onChange={e=>setField(i,'bom_id',e.target.value)} disabled={!order.item_id}>
                      <option value="">Fără BOM specific</option>
                      {boms.filter(b => b.parent_item_id === parseInt(order.item_id)).map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Cantitate (BUC)</label>
                    <input className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none font-mono" type="number" min={1} value={order.quantity} onChange={e=>setField(i,'quantity',e.target.value)} required />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Data/Ora Start</label>
                    <input className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm" type="datetime-local" value={order.planned_start} onChange={e=>setField(i,'planned_start',e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Data/Ora Sfârșit</label>
                    <input className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm" type="datetime-local" value={order.planned_end} onChange={e=>setField(i,'planned_end',e.target.value)} required />
                  </div>
                </div>
              </div>
            ))}

            {multiple && (
              <button type="button" className="w-full py-4 border-2 border-dashed border-border rounded-2xl text-muted-foreground hover:text-accent hover:border-accent hover:bg-accent/5 transition-all font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2" onClick={addOrder}>
                <Plus size={20}/> Adaugă altă comandă
              </button>
            )}
          </form>
        </div>

        <div className="px-8 py-6 border-t border-border bg-slate-50 flex justify-end gap-3 sticky bottom-0">
          <button type="button" className="btn btn-secondary px-8" onClick={onClose}>Anulare</button>
          <button type="submit" className="btn btn-primary px-10 shadow-lg shadow-accent/20" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Se procesează...' : 'Confirmare Lansare'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditOrderModal({ order, machines, onClose, onSave }) {
  const [form, setForm] = useState({
    machine_id: order.machine_id,
    planned_start: order.planned_start.replace(' ', 'T'),
    planned_end: order.planned_end.replace(' ', 'T'),
    quantity: order.quantity
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put(`/orders/${order.id}`, {
        ...form,
        machine_id: parseInt(form.machine_id),
        planned_start: form.planned_start.replace('T', ' '),
        planned_end: form.planned_end.replace('T', ' ')
      });
      toast.success('Comandă actualizată cu succes');
      onSave();
    } catch (err) {
      toast.error('Eroare la actualizare');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center">
          <div>
            <h3 className="font-display text-2xl">Editare Comandă #{order.id}</h3>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mt-1">{order.product_name}</p>
          </div>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Mută pe Utilajul</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm font-medium" value={form.machine_id} onChange={e=>setForm({...form, machine_id: e.target.value})} required>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.area_name})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Nou Start</label>
              <input className="w-full h-12 rounded-xl border border-border bg-white px-4 outline-none focus:ring-2 focus:ring-accent text-sm" type="datetime-local" value={form.planned_start} onChange={e=>setForm({...form, planned_start: e.target.value})} required />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Nou Sfârșit</label>
              <input className="w-full h-12 rounded-xl border border-border bg-white px-4 outline-none focus:ring-2 focus:ring-accent text-sm" type="datetime-local" value={form.planned_end} onChange={e=>setForm({...form, planned_end: e.target.value})} required />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Cantitate (BUC)</label>
            <input className="w-full h-12 rounded-xl border border-border bg-white px-4 outline-none focus:ring-2 focus:ring-accent font-mono" type="number" min={1} value={form.quantity} onChange={e=>setForm({...form, quantity: e.target.value})} required />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={loading}>{loading ? 'Se salvează...' : 'Salvează Modificările'}</button>
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
    try { 
      await api.post(`/orders/${order.id}/delay`, { delay_minutes: parseInt(mins), reason, source:'system' }); 
      toast.success('Delay aplicat și propagat'); 
      onSave(); 
    } catch(err) { toast.error(err.response?.data?.error || 'Eroare'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center">
          <div>
            <h3 className="font-display text-2xl">Adăugare Delay</h3>
            <p className="text-xs text-red-500 uppercase font-bold tracking-widest mt-1">{order.product_name}</p>
          </div>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-700 text-xs font-medium leading-relaxed">
            Atenție: Acest delay va fi propagat automat la toate comenzile ulterioare pe același utilaj.
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Minute Întârziere</label>
            <input className="w-full h-12 rounded-xl border border-border bg-white px-4 outline-none focus:ring-2 focus:ring-accent font-mono text-xl" type="number" min={1} value={mins} onChange={e=>setMins(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Cauza / Observații</label>
            <textarea className="w-full rounded-xl border border-border bg-white p-4 outline-none focus:ring-2 focus:ring-accent min-h-[100px] text-sm" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Descrieți motivul întârzierii..." required />
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary bg-red-600 flex-1">Aplicare Delay</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrderDetailModal({ order, machines, onClose, onDelay, onEdit, onDelete }) {
  const [materials, setMaterials] = useState([]);
  
  useEffect(() => {
    if (order.bom_id) {
      api.get(`/orders/${order.id}/materials`).then(r => setMaterials(r.data)).catch(console.error);
    }
  }, [order.id, order.bom_id]);

  const machine = machines.find(m => m.id === order.machine_id);
  const totalDelay = (order.delays||[]).filter(d=>d.applied).reduce((a,d)=>a+d.delay_minutes,0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-border flex flex-col max-h-[90vh]" onClick={e=>e.stopPropagation()}>
        <div className="px-8 py-6 border-b border-border flex justify-between items-center bg-white sticky top-0 z-10">
          <div>
            <h3 className="font-display text-2xl">Detalii Comandă #{order.id}</h3>
            <span className={`badge mt-1 ${order.status==='active'?'badge-green':order.status==='done'?'badge-blue':'badge-gray'}`}>{order.status}</span>
          </div>
          <button className="p-2 hover:bg-muted rounded-full transition-colors" onClick={onClose}><X size={24}/></button>
        </div>

        <div className="p-8 overflow-y-auto space-y-8">
          <div className="grid grid-cols-2 gap-x-12 gap-y-6">
            {[
              ['Produs', order.product_name],
              ['Utilaj', machine?.name || '-'],
              ['Cantitate', `${order.quantity} BUC`],
              ['Total Delay', totalDelay > 0 ? `+${totalDelay} min` : 'Fără întârzieri'],
              ['Start Planificat', order.planned_start?.substring(0,16)],
              ['Sfârșit Planificat', order.planned_end?.substring(0,16)]
            ].map(([l, v]) => (
              <div key={l}>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{l}</p>
                <p className="text-base font-bold text-foreground">{v}</p>
              </div>
            ))}
          </div>

          {materials.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-black uppercase tracking-tighter text-foreground border-b border-border pb-2 flex items-center gap-2">
                <Box size={14} className="text-accent" /> Necesar Materiale (BOM)
              </h4>
              <div className="table-container shadow-none border-border/50">
                <table className="text-xs">
                  <thead>
                    <tr>
                      <th className="py-2 px-4">Poz.</th>
                      <th className="py-2 px-4">Articol</th>
                      <th className="py-2 px-4 text-center">Cant.</th>
                      <th className="py-2 px-4">Locație</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m, i) => (
                      <tr key={i}>
                        <td className="py-2 px-4 font-mono">{m.position_code}</td>
                        <td className="py-2 px-4 font-bold">{m.item_code} - {m.item_name}</td>
                        <td className="py-2 px-4 text-center font-black">{m.required_quantity} {m.uom}</td>
                        <td className="py-2 px-4">{m.location || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-border flex flex-wrap gap-3">
            <button className="btn btn-secondary gap-2" onClick={onEdit} disabled={order.status === 'done'}>
              <Edit2 size={16} /> Modifică Detalii
            </button>
            <button className="btn btn-secondary text-red-600 border-red-100 bg-red-50 hover:bg-red-100 gap-2" onClick={onDelete}>
              <Trash2 size={16} /> Șterge Comanda
            </button>
            <button className="btn btn-primary ml-auto gap-2" onClick={onDelay} disabled={order.status === 'done' || order.status === 'cancelled'}>
              <AlertCircle size={16} /> Adaugă Delay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
