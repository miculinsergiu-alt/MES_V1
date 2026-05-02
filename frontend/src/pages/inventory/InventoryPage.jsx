import { useState, useEffect } from 'react';
import { Package, ArrowDownUp, Edit, Plus, Truck, Home, ShoppingCart, ShieldAlert, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';

// Import New Sub-Modules
import WarehouseManager from './WarehouseManager';
import ProcurementDashboard from './ProcurementDashboard';
import QuarantineDashboard from './QuarantineDashboard';
import InventoryTransfers from './InventoryTransfers';

export default function InventoryPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('stock'); // stock, transfers, warehousing, procurement, quality
  const [stock, setStock] = useState([]);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const loadStock = async () => {
    try {
      const r = await api.get('/stock');
      setStock(r.data);
    } catch (e) {}
  };

  useEffect(() => { loadStock(); }, []);

  const openAdjust = (item) => {
    setSelectedItem(item);
    setShowAdjustModal(true);
  };

  const plannerNav = [
    { path: '/planner', labelKey: 'sidebar.dashboard', icon: <Package size={16}/> },
    { path: '/planner/items', labelKey: 'sidebar.articles_bom', icon: <Package size={16}/> },
    { path: '/planner/inventory', labelKey: 'sidebar.stocks', icon: <ArrowDownUp size={16}/> }
  ];

  const whmNav = [
    { path: '/inventory', labelKey: 'sidebar.inventory_hub', icon: <Package size={16}/> },
    { path: '#logout', labelKey: 'common.logout', icon: <LogOut size={16}/>, onClick: logout }
  ];

  const tabs = [
    { id: 'stock', label: 'Niveluri Stoc', icon: <Package size={16}/> },
    { id: 'procurement', label: 'Recepție & PO', icon: <ShoppingCart size={16}/> },
    { id: 'transfers', label: 'Transferuri', icon: <ArrowDownUp size={16}/> },
    { id: 'quality', label: 'Carantină', icon: <ShieldAlert size={16}/> },
    { id: 'warehousing', label: 'Magazii', icon: <Home size={16}/> }
  ];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar items={user?.role === 'warehouse_manager' ? whmNav : plannerNav} />
      <main className="flex-1 p-10 overflow-auto">
        <div className="flex justify-between items-center mb-10">
           <div>
              <h1 className="font-display text-4xl text-foreground">WMS Enterprise</h1>
              <p className="text-muted-foreground mt-2">Gestiune integrată a stocurilor și trasabilitate.</p>
           </div>
           <div className="flex gap-2 bg-muted/30 p-1 rounded-2xl border border-border/50">
             {tabs.map(tab => (
               <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id)}
                 className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${
                   activeTab === tab.id ? 'bg-white text-accent shadow-sm' : 'text-muted-foreground hover:text-foreground'
                 }`}
               >
                 {tab.icon}
                 {tab.label}
               </button>
             ))}
           </div>
        </div>

        <div className="mt-8">
           <AnimatePresence mode="wait">
              {activeTab === 'stock' && (
                <motion.div key="stock" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                   <StockList stock={stock} onAdjust={openAdjust} t={t} />
                </motion.div>
              )}
              {activeTab === 'procurement' && (
                <motion.div key="procurement" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                   <ProcurementDashboard />
                </motion.div>
              )}
              {activeTab === 'transfers' && (
                <motion.div key="transfers" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                   <InventoryTransfers />
                </motion.div>
              )}
              {activeTab === 'quality' && (
                <motion.div key="quality" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                   <QuarantineDashboard />
                </motion.div>
              )}
              {activeTab === 'warehousing' && (
                <motion.div key="warehousing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                   <WarehouseManager />
                </motion.div>
              )}
           </AnimatePresence>
        </div>
      </main>

      {showAdjustModal && selectedItem && (
        <AdjustStockModal item={selectedItem} onClose={() => setShowAdjustModal(false)} onSave={() => { setShowAdjustModal(false); loadStock(); }} />
      )}
    </div>
  );
}

function StockList({ stock, onAdjust, t }) {
  return (
    <div className="bg-white rounded-3xl border border-border overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-muted/30 border-b border-border">
          <tr>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('inventory.item_code')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('inventory.item_name')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('inventory.type')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('inventory.quantity')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('inventory.uom')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('inventory.location')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {stock.map(s => (
            <tr key={s.item_id} className="hover:bg-accent/[0.02] transition-colors">
              <td className="px-6 py-4 font-mono text-[10px] font-black text-accent">{s.item_code}</td>
              <td className="px-6 py-4 font-bold">{s.item_name}</td>
              <td className="px-6 py-4">
                 <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${s.type==='raw_material'?'bg-blue-100 text-blue-700':s.type==='finished_good'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700'}`}>
                    {t(`items.${s.type}`)}
                 </span>
              </td>
              <td className={`px-6 py-4 font-bold ${s.quantity < 10 ? 'text-red-500' : 'text-foreground'}`}>{s.quantity}</td>
              <td className="px-6 py-4 text-sm text-muted-foreground">{s.uom}</td>
              <td className="px-6 py-4 text-sm text-muted-foreground">{s.location || '-'}</td>
              <td className="px-6 py-4 text-right">
                <button className="p-2 hover:bg-accent/10 rounded-lg text-accent transition-colors" onClick={() => onAdjust(s)}><Edit size={16}/></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdjustStockModal({ item, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ quantity: item.quantity, location: item.location || '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/stock/adjust', { item_id: item.item_id, ...form });
      toast.success(t('messages.save_success'));
      onSave();
    } catch (err) { toast.error(t('messages.save_error')); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 w-full max-w-md border border-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl mb-6">{t('inventory.adjust')}: {item.item_code}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('inventory.quantity')} ({item.uom})</label>
            <input className="w-full h-11 rounded-xl border border-border px-4 focus:ring-2 focus:ring-accent outline-none" type="number" step="0.01" value={form.quantity} onChange={e=>setForm(p=>({...p, quantity: e.target.value}))} required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('inventory.location')}</label>
            <input className="w-full h-11 rounded-xl border border-border px-4 focus:ring-2 focus:ring-accent outline-none" type="text" value={form.location} onChange={e=>setForm(p=>({...p, location: e.target.value}))} placeholder="ex: Depozit A, Raft 4" />
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="bg-accent text-white px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-accent/20 hover:shadow-accent/40 transition-all">{t('common.save')}</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
