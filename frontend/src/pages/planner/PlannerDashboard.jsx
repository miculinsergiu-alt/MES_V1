import { useState, useEffect, useCallback } from 'react';
import { Plus, ChevronLeft, ChevronRight, Wrench, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import GanttTimeline from '../../components/GanttTimeline';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format, addDays, subDays } from 'date-fns';
import { dateLocaleFor } from '../../lib/dateLocale';
import { CreateOrderModal, EditOrderModal, DelayModal, OrderDetailModal } from './PlannerDashboardParts';

export default function PlannerDashboard() {
  const { t, i18n } = useTranslation();
  const dateLocale = dateLocaleFor(i18n.language);
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

  const statusBadge = (s) => ({ pending:'badge-gray', active:'badge-green', done:'badge-blue', cancelled:'badge-red' })[s] || 'badge-gray';

  return (
    <div className="app-layout">
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
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(new Date())}>{t('common.today')}</button>
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
                        <td className="font-mono">{o.order_type === 'production' ? `${o.quantity} ${t('inventory.pcs')}` : '-'}</td>
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
