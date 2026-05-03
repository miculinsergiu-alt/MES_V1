import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, FileText, Plus, X, Search, ChevronLeft, ChevronRight, Box, AlertCircle, Trash2, Edit2, Wrench, Settings, Zap, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Sidebar from '../../components/Sidebar';
import GanttTimeline from '../../components/GanttTimeline';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format, addDays, subDays } from 'date-fns';
import { ro, enUS } from 'date-fns/locale';

export default function PlannerDashboard() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ro' ? ro : enUS;
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
      const endRange = addDays(viewDate, 7);
      const [oRes, mRes] = await Promise.all([
        api.get('/orders/gantt', { 
          params: { 
            date_from: format(viewDate, 'yyyy-MM-dd 00:00:00'),
            date_to: format(endRange, 'yyyy-MM-dd 23:59:59')
          } 
        }), 
        api.get('/machines')
      ]);
      setOrders(oRes.data); setMachines(mRes.data);
    } catch {}
  }, [viewDate]);

  const handleDeleteOrder = async (orderId) => {
    if (!window.confirm(t('planner.delete_confirm'))) return;
    try {
      await api.delete(`/orders/${orderId}`);
      toast.success(t('messages.delete_success'));
      setSelectedOrder(null);
      loadData();
    } catch (err) {
      toast.error(t('messages.delete_error'));
    }
  };

  useEffect(() => { loadData(); const i = setInterval(loadData, 15000); return () => clearInterval(i); }, [loadData]);

  const navItems = [
    { path:'/planner/gantt', labelKey:'sidebar.production_plan', icon:<LayoutDashboard size={16}/> },
    { path:'/planner/orders', labelKey:'sidebar.manage_orders', icon:<FileText size={16}/> },
    { path:'/planner/items', labelKey:'sidebar.items_bom', icon:<Box size={16}/> },
  ];

  const statusBadge = (s) => ({ pending:'badge-gray', active:'badge-green', done:'badge-blue', cancelled:'badge-red' })[s] || 'badge-gray';

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <div className="flex justify-between items-center">
            <div><h1>{t('planner.title')}</h1><p>{t('planner.subtitle')}</p></div>
            <button className="btn btn-primary" onClick={() => setShowOrderModal(true)}><Plus size={16}/> {t('planner.new_order')}</button>
          </div>
        </div>
        <div className="page-content">
          <div className="tabs">
            {[['gantt', t('planner.gantt_view')],['list', t('planner.list_view')]].map(([k,l]) => (
              <button key={k} className={`tab-btn ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === 'gantt' && (
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <span className="card-title">{t('supervisor.production_plan', { date: format(viewDate, 'EEEE, dd MMMM yyyy', { locale: dateLocale }) })}</span>
                <div className="flex gap-2 items-center">
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(d => subDays(d,1))}><ChevronLeft size={14}/></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(new Date())}>{i18n.language === 'ro' ? 'Azi' : 'Today'}</button>
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
                    <th>{t('inventory.type')}</th>
                    <th>{t('planner.product_activity')}</th>
                    <th>{t('analytics.machine')}</th>
                    <th>{t('planner.planned_start')}</th>
                    <th>{t('planner.planned_end')}</th>
                    <th>{t('planner.qty')}</th>
                    <th>{t('admin.role')}</th>
                    <th className="text-center">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 && <tr><td colSpan={8} className="text-center py-12 italic">{t('planner.no_orders')}</td></tr>}
                  {orders.map(o => {
                    const machine = machines.find(m => m.id === o.machine_id);
                    const totalDelay = (o.delays||[]).filter(d=>d.applied).reduce((a,d)=>a+d.delay_minutes,0);
                    return (
                      <tr key={o.id} className={o.order_type === 'maintenance' ? 'bg-orange-50/30' : ''}>
                        <td className="w-10">
                          {o.order_type === 'maintenance' 
                            ? <Wrench size={16} className="text-orange-600" /> 
                            : <Settings size={16} className="text-accent" />}
                        </td>
                        <td className="font-bold text-foreground">
                          {o.product_name}
                          {o.order_type === 'maintenance' && <span className="ml-2 text-[10px] font-black uppercase text-orange-600">{t('planner.maintenance')}</span>}
                        </td>
                        <td>{machine?.name || `#${o.machine_id}`}</td>
                        <td>{o.planned_start?.substring(0,16)}</td>
                        <td>
                          {o.planned_end?.substring(0,16)}
                          {totalDelay > 0 && <span className="text-red font-bold ml-2">+{totalDelay}m</span>}
                        </td>
                        <td className="font-mono">{o.order_type === 'production' ? `${o.quantity} ${t('inventory.uom')}` : '-'}</td>
                        <td><span className={`badge ${statusBadge(o.status)}`}>{t(`status.${o.status}`)}</span></td>
                        <td>
                          <div className="flex justify-center gap-2">
                            <button className="btn btn-secondary btn-sm" onClick={() => setSelectedOrder(o)}>{t('common.details')}</button>
                            {o.status !== 'cancelled' && o.status !== 'done' && (
                              <button className="btn btn-secondary btn-sm text-yellow-600 border-yellow-200 bg-yellow-50" onClick={() => { setSelectedOrder(o); setShowDelayModal(true); }}>{t('planner.apply_delay_short')}</button>
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
  const { t } = useTranslation();
  const [orders, setOrders] = useState([{ machine_id:'', item_id:'', bom_id:'', product_name:'', quantity:1, planned_start:'', planned_end:'', order_type:'production' }]);
  const [loading, setLoading] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [items, setItems] = useState([]);
  const [boms, setBoms] = useState([]);
  const [itemRoutes, setItemRoutes] = useState({}); // { itemId: [routes] }

  useEffect(() => {
    Promise.all([api.get('/items'), api.get('/boms')]).then(([iRes, bRes]) => {
      setItems(iRes.data);
      setBoms(bRes.data);
    }).catch(err => console.error(err));
  }, []);

  const fetchRoute = async (itemId) => {
    if (!itemId || itemRoutes[itemId]) return;
    try {
      const res = await api.get(`/items/${itemId}`);
      if (res.data.routes) {
        setItemRoutes(prev => ({ ...prev, [itemId]: res.data.routes }));
      }
    } catch {}
  };

  const addOrder = () => setOrders(p => [...p, { machine_id:'', item_id:'', bom_id:'', product_name:'', quantity:1, planned_start:'', planned_end:'', order_type:'production' }]);
  const removeOrder = (i) => setOrders(p => p.filter((_,idx) => idx !== i));
  
  const setField = (i, k, v) => setOrders(p => p.map((o,idx) => {
    if (idx !== i) return o;
    const newO = {...o, [k]:v};
    if (k === 'item_id' && v) {
      const selectedItem = items.find(it => it.id === parseInt(v));
      newO.product_name = selectedItem ? selectedItem.name : '';
      newO.bom_id = '';
      fetchRoute(v);
    }
    if (k === 'order_type' && v === 'maintenance') {
      newO.product_name = t('planner.maintenance_desc');
      newO.quantity = 0;
      newO.item_id = '';
      newO.bom_id = '';
    }
    return newO;
  }));

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const payload = orders.map(o => {
        const pStart = o.planned_start || format(new Date(), 'yyyy-MM-dd HH:mm:ss');
        let pEnd = o.planned_end;
        
        // Auto-calculate end time if not provided
        if (!pEnd && pStart && o.item_id && o.order_type === 'production') {
          const routes = itemRoutes[o.item_id] || [];
          const totalMin = routes.reduce((sum, r) => sum + (r.process_time_min * o.quantity), 0);
          if (totalMin > 0) {
            const startDate = new Date(pStart.replace(' ', 'T'));
            const endDate = new Date(startDate.getTime() + totalMin * 60000);
            pEnd = format(endDate, 'yyyy-MM-dd HH:mm:ss');
          }
        }

        // Fallback if still no end date
        if (!pEnd) pEnd = pStart;

        return {
          ...o, 
          machine_id: parseInt(o.machine_id), 
          quantity: parseInt(o.quantity),
          item_id: o.item_id ? parseInt(o.item_id) : null,
          bom_id: o.bom_id ? parseInt(o.bom_id) : null,
          planned_start: pStart.replace('T',' '), 
          planned_end: pEnd.replace('T',' ')
        };
      });
      await api.post('/orders', { orders: payload });
      toast.success(t('planner.orders_created', { count: payload.length })); onSave();
    } catch(err) { toast.error(err.response?.data?.error || t('common.error')); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden border border-border flex flex-col max-h-[90vh]">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center bg-white sticky top-0 z-10">
          <div>
            <h3 className="font-display text-2xl text-foreground">{t('planner.create_planning')}</h3>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mt-1">{t('planner.launch_subtitle')}</p>
          </div>
          <button className="p-2 hover:bg-muted rounded-full transition-colors" onClick={onClose}><X size={24}/></button>
        </div>

        <div className="p-8 overflow-y-auto">
          <form id="create-order-form" onSubmit={handleSubmit} className="space-y-8">
            {orders.map((order, i) => (
              <div key={i} className="relative p-6 rounded-2xl border border-border bg-slate-50/50 space-y-6">
                <div className="flex justify-between items-center">
                  <div className="flex gap-2 p-1 bg-white border border-border rounded-xl">
                    <button type="button" onClick={()=>setField(i,'order_type','production')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${order.order_type==='production'?'bg-accent text-white shadow-md shadow-accent/20':'text-muted-foreground'}`}>{t('planner.production')}</button>
                    <button type="button" onClick={()=>setField(i,'order_type','maintenance')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${order.order_type==='maintenance'?'bg-orange-500 text-white shadow-md shadow-orange-500/20':'text-muted-foreground'}`}>{t('planner.maintenance')}</button>
                  </div>
                  {multiple && orders.length > 1 && (
                    <button type="button" className="text-red-500 hover:text-red-700 p-1" onClick={() => removeOrder(i)}><Trash2 size={16}/></button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.production_machine')}</label>
                    <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm font-medium" value={order.machine_id} onChange={e=>setField(i,'machine_id',e.target.value)} required>
                      <option value="">{t('planner.select_machine')}</option>
                      {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  {order.order_type === 'production' ? (
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.product_nomenclature')}</label>
                      <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm font-medium" value={order.item_id} onChange={e=>setField(i,'item_id',e.target.value)} required>
                        <option value="">{t('planner.select_product')}</option>
                        {items.filter(it=>it.type!=='raw_material').map(it => <option key={it.id} value={it.id}>{it.item_code} - {it.name}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.maintenance_desc')}</label>
                      <input className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-orange-500 outline-none text-sm" type="text" value={order.product_name} onChange={e=>setField(i,'product_name',e.target.value)} required />
                    </div>
                  )}
                </div>

                {order.order_type === 'production' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.bom_recipe_optional')}</label>
                      <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm font-medium disabled:opacity-50" value={order.bom_id} onChange={e=>setField(i,'bom_id',e.target.value)} disabled={!order.item_id}>
                        <option value="">{t('planner.no_specific_bom')}</option>
                        {boms.filter(b => b.parent_item_id === parseInt(order.item_id)).map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.quantity_buc')}</label>
                      <input className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none font-mono" type="number" min={1} value={order.quantity} onChange={e=>setField(i,'quantity',e.target.value)} required />
                    </div>
                  </div>
                )}

                {order.order_type === 'production' && itemRoutes[order.item_id]?.length > 0 && (
                  <div className="p-4 rounded-xl bg-accent/5 border border-accent/20 space-y-3">
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-accent" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-accent">{t('items.production_route')}</span>
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-2">
                      {itemRoutes[order.item_id].map((r, ridx) => {
                        const m = machines.find(mach => mach.id === r.machine_id);
                        return (
                          <div key={ridx} className="flex items-center gap-2 flex-shrink-0">
                            <div className="px-3 py-2 rounded-lg bg-white border border-accent/20 shadow-sm text-center min-w-[100px]">
                              <p className="text-[9px] font-bold text-muted-foreground uppercase">{m?.name || '?'}</p>
                              <p className="text-[11px] font-black text-accent">{r.process_time_min * order.quantity} min</p>
                            </div>
                            {ridx < itemRoutes[order.item_id].length - 1 && <ChevronRight size={14} className="text-muted-foreground/30" />}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[9px] italic text-muted-foreground/70">
                      * {t('planner.route_explosion_info', { defaultValue: 'Comanda va fi explodată automat în sub-comenzi pe fiecare utilaj din rută.' })}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.planned_start_label')}</label>
                    <input className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm" type="datetime-local" value={order.planned_start} onChange={e=>setField(i,'planned_start',e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.planned_end_label')}</label>
                    <input className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm" type="datetime-local" value={order.planned_end} onChange={e=>setField(i,'planned_end',e.target.value)} />
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center gap-4">
              <input type="checkbox" id="multiple-check" className="w-5 h-5 rounded-md border-border text-accent focus:ring-accent" checked={multiple} onChange={e => setMultiple(e.target.checked)} />
              <label htmlFor="multiple-check" className="text-sm font-bold text-muted-foreground cursor-pointer uppercase tracking-widest">{t('planner.plan_multiple')}</label>
            </div>

            {multiple && (
              <button type="button" className="w-full py-4 border-2 border-dashed border-border rounded-2xl text-muted-foreground hover:text-accent hover:border-accent hover:bg-accent/5 transition-all font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2" onClick={addOrder}>
                <Plus size={20}/> {t('planner.add_another')}
              </button>
            )}
          </form>
        </div>

        <div className="px-8 py-6 border-t border-border bg-slate-50 flex justify-end gap-3 sticky bottom-0">
          <button type="button" className="btn btn-secondary px-8" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" form="create-order-form" className="btn btn-primary px-10 shadow-lg shadow-accent/20" disabled={loading}>
            {loading ? t('planner.processing') : t('planner.confirm_launch')}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditOrderModal({ order, machines, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    machine_id: order.machine_id,
    planned_start: order.planned_start.replace(' ', 'T'),
    planned_end: order.planned_end.replace(' ', 'T'),
    quantity: order.quantity,
    order_type: order.order_type || 'production'
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
      toast.success(t('messages.save_success'));
      onSave();
    } catch (err) {
      toast.error(t('messages.save_error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center">
          <div>
            <h3 className="font-display text-2xl">{t('planner.edit_order', { type: form.order_type === 'maintenance' ? t('planner.maintenance') : t('planner.production'), id: order.id })}</h3>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mt-1">{order.product_name}</p>
          </div>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('analytics.machine')}</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm font-medium" value={form.machine_id} onChange={e=>setForm({...form, machine_id: e.target.value})} required>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.new_start')}</label>
              <input className="w-full h-12 rounded-xl border border-border bg-white px-4 outline-none focus:ring-2 focus:ring-accent text-sm" type="datetime-local" value={form.planned_start} onChange={e=>setForm({...form, planned_start: e.target.value})} required />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.new_end')}</label>
              <input className="w-full h-12 rounded-xl border border-border bg-white px-4 outline-none focus:ring-2 focus:ring-accent text-sm" type="datetime-local" value={form.planned_end} onChange={e=>setForm({...form, planned_end: e.target.value})} required />
            </div>
          </div>
          {form.order_type === 'production' && (
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.quantity_buc')}</label>
              <input className="w-full h-12 rounded-xl border border-border bg-white px-4 outline-none focus:ring-2 focus:ring-accent font-mono" type="number" min={1} value={form.quantity} onChange={e=>setForm({...form, quantity: e.target.value})} required />
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={loading}>{loading ? t('admin.saving') : t('common.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DelayModal({ order, onClose, onSave }) {
  const { t } = useTranslation();
  const [mins, setMins] = useState(30);
  const [reason, setReason] = useState('');
  const [delayReasonId, setDelayReasonId] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [reasons, setReasons] = useState([]);

  useEffect(() => {
    api.get('/orders/delay-reasons').then(r => setReasons(r.data));
  }, []);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    try { 
      await api.post(`/orders/${order.id}/delay`, { 
        delay_minutes: parseInt(mins), 
        reason, 
        delay_reason_id: delayReasonId,
        corrective_action: correctiveAction,
        source:'system' 
      }); 
      toast.success(t('messages.save_success')); 
      onSave(); 
    } catch(err) { toast.error(err.response?.data?.error || t('common.error')); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-border">
        <div className="px-8 py-6 border-b border-border flex justify-between items-center">
          <div>
            <h3 className="font-display text-2xl">{t('planner.apply_delay')}</h3>
            <p className="text-xs text-red-500 uppercase font-bold tracking-widest mt-1">{order.product_name}</p>
          </div>
          <button className="p-2 hover:bg-muted rounded-full" onClick={onClose}><X size={24}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">Minute</label>
              <input className="w-full h-12 rounded-xl border border-border bg-white px-4 outline-none focus:ring-2 focus:ring-accent font-mono text-xl" type="number" min={1} value={mins} onChange={e=>setMins(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('operator.delay.cause')}</label>
              <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none text-sm" value={delayReasonId} onChange={e=>setDelayReasonId(e.target.value)} required>
                <option value="">{t('operator.delay.select_cause')}</option>
                {reasons.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.observations')}</label>
            <textarea className="w-full rounded-xl border border-border bg-white p-3 outline-none focus:ring-2 focus:ring-accent min-h-[60px] text-sm" value={reason} onChange={e=>setReason(e.target.value)} placeholder={t('operator.delay.placeholder_desc')} required />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-muted-foreground uppercase ml-1">{t('planner.corrective_measures')}</label>
            <textarea className="w-full rounded-xl border border-border bg-white p-3 outline-none focus:ring-2 focus:ring-green-500 min-h-[60px] text-sm bg-green-50/20" value={correctiveAction} onChange={e=>setCorrectiveAction(e.target.value)} placeholder={t('operator.delay.placeholder_corrective')} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary bg-red-600 flex-1">{t('planner.apply_delay')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrderDetailModal({ order, machines, onClose, onDelay, onEdit, onDelete }) {
  const [materials, setMaterials] = useState([]);
  const [chain, setChain] = useState([]);
  const { t } = useTranslation();
  
  useEffect(() => {
    if (order.bom_id) {
      api.get(`/orders/${order.id}/materials`).then(r => setMaterials(r.data)).catch(console.error);
    }
    // Fetch routing chain
    api.get(`/orders/${order.id}/chain`).then(r => setChain(r.data)).catch(console.error);
  }, [order.id, order.bom_id]);

  const machine = machines.find(m => m.id === order.machine_id);
  const totalDelay = (order.delays||[]).filter(d=>d.applied).reduce((a,d)=>a+d.delay_minutes,0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-border flex flex-col max-h-[90vh]" onClick={e=>e.stopPropagation()}>
        <div className="px-8 py-6 border-b border-border flex justify-between items-center bg-white sticky top-0 z-10">
          <div>
            <h3 className="font-display text-2xl">{t('planner.order_details', { type: order.order_type==='maintenance'?t('planner.maintenance'):t('planner.production'), id: order.id })}</h3>
            <span className={`badge mt-1 ${order.status==='active'?'badge-green':order.status==='done'?'badge-blue':'badge-gray'}`}>{t(`status.${order.status}`)}</span>
          </div>
          <button className="p-2 hover:bg-muted rounded-full transition-colors" onClick={onClose}><X size={24}/></button>
        </div>

        <div className="p-8 overflow-y-auto space-y-8">
          <div className="grid grid-cols-2 gap-x-12 gap-y-6">
            {[
              [t('planner.planning_type'), order.order_type === 'maintenance' ? `🔧 ${t('planner.maintenance')}` : `📦 ${t('planner.production')}`],
              [t('planner.product_activity'), order.product_name],
              [t('analytics.machine'), machine?.name || '-'],
              [t('inventory.quantity'), order.order_type === 'production' ? `${order.quantity} ${t('inventory.uom')}` : '-'],
              [t('planner.total_delay'), totalDelay > 0 ? `+${totalDelay} min` : t('planner.no_delays')],
              [t('planner.planned_start'), order.planned_start?.substring(0,16)],
              [t('planner.planned_end'), order.planned_end?.substring(0,16)]
            ].map(([l, v]) => (
              <div key={l}>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{l}</p>
                <p className="text-base font-bold text-foreground">{v}</p>
              </div>
            ))}
          </div>

          {chain.length > 1 && (
            <div className="space-y-4">
              <h4 className="text-sm font-black uppercase tracking-tighter text-accent border-b border-accent/10 pb-2 flex items-center gap-2">
                <GitBranch size={14} /> {t('items.production_route')}
              </h4>
              <div className="flex items-center gap-2 overflow-x-auto pb-4 pt-2">
                {chain.map((step, idx) => (
                  <div key={step.id} className="flex items-center gap-2 flex-shrink-0">
                    <div className={`p-3 rounded-2xl border-2 transition-all min-w-[140px] ${step.id === order.id ? 'border-accent bg-accent/5 shadow-md scale-105' : 'border-border bg-white shadow-sm opacity-70'}`}>
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${step.status === 'done' ? 'bg-blue-100 text-blue-700' : step.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {t(`status.${step.status}`)}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground">#{step.routing_sequence || (idx+1)*10}</span>
                      </div>
                      <p className="text-[10px] font-black text-foreground truncate">{step.machine_name}</p>
                      <p className="text-[9px] text-muted-foreground">{step.planned_start?.substring(11,16)} - {step.planned_end?.substring(11,16)}</p>
                    </div>
                    {idx < chain.length - 1 && <ChevronRight size={14} className="text-muted-foreground/40" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {order.delays && order.delays.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-black uppercase tracking-tighter text-red-600 border-b border-red-100 pb-2 flex items-center gap-2">
                <AlertCircle size={14} /> {t('planner.history_delays')}
              </h4>
              <div className="space-y-3">
                {order.delays.map((d, idx) => (
                  <div key={idx} className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-black uppercase tracking-widest text-red-600">+{d.delay_minutes} min | {d.reason_name || 'General'}</span>
                      <span className="text-[10px] text-muted-foreground">{d.created_at?.substring(0,16)}</span>
                    </div>
                    <p className="text-sm text-foreground mb-2 italic">"{d.reason}"</p>
                    {d.corrective_action && (
                      <div className="mt-2 p-2 rounded-lg bg-green-50 border border-green-100 text-xs text-green-700">
                        <strong>{t('planner.corrective_measure_label')}:</strong> {d.corrective_action}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {materials.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-black uppercase tracking-tighter text-foreground border-b border-border pb-2 flex items-center gap-2">
                <Box size={14} className="text-accent" /> {t('items.components')} (BOM)
              </h4>
              <div className="table-container shadow-none border-border/50">
                <table className="text-xs">
                  <thead>
                    <tr>
                      <th className="py-2 px-4">{t('items.poz')}</th>
                      <th className="py-2 px-4">{t('items.component_name')}</th>
                      <th className="py-2 px-4 text-center">{t('inventory.quantity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m, i) => (
                      <tr key={i} className={m.node_type === 'department' ? 'bg-orange-50/50' : ''}>
                        <td className="py-2 px-4 font-mono text-muted-foreground">{m.position_code}</td>
                        <td className="py-2 px-4">
                          {m.node_type === 'department' ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">DEPT</span>
                              <span className="font-bold text-orange-800 uppercase tracking-tight">{m.department || t('items.unspecified')}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col">
                              <span className="font-bold text-foreground">{m.item_code}</span>
                              <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">{m.item_name}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-4 text-center font-black">
                          {m.node_type === 'component' ? (
                            <span className="text-accent">{m.required_quantity} {m.uom}</span>
                          ) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-border flex flex-wrap gap-3">
            <button className="btn btn-secondary gap-2" onClick={onEdit} disabled={order.status === 'done'}>
              <Edit2 size={16} /> {t('common.edit')}
            </button>
            <button className="btn btn-secondary text-red-600 border-red-100 bg-red-50 hover:bg-red-100 gap-2" onClick={onDelete}>
              <Trash2 size={16} /> {t('common.delete')}
            </button>
            <button className="btn btn-primary ml-auto gap-2" onClick={onDelay} disabled={order.status === 'done' || order.status === 'cancelled'}>
              <AlertCircle size={16} /> {t('planner.apply_delay')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
