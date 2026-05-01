import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Plus, Search, Edit2, Trash2, X, Clock, DollarSign, List, FileText, TrendingUp, Zap, GitBranch, Printer } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import BOMEditor, { serverToClient, clientToServer } from './BOMEditor';

export default function ItemsManager() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('items'); // 'items' or 'boms'
  const [items, setItems] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchCode, setSearchCode] = useState('');
  const [searchName, setSearchName] = useState('');
  
  // Modals
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showBOMModal, setShowBOMModal] = useState(false);
  const [editingBOM, setEditingBOM] = useState(null);
  const [showPrintPreview, setShowPrintPreview] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [itemsRes, machinesRes] = await Promise.all([
        api.get('/items'),
        api.get('/machines')
      ]);
      setItems(itemsRes.data);
      setMachines(machinesRes.data);
    } catch (err) {
      toast.error(t('items.loading_error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-open BOM editor when navigating back from BOMViewerPage
  useEffect(() => {
    const editBomId = location.state?.editBomId;
    if (editBomId && items.length > 0) {
      setActiveTab('boms');
      setEditingBOM({ id: editBomId });
      setShowBOMModal(true);
      // Clear state to prevent re-opening on refresh
      window.history.replaceState({}, '');
    }
  }, [location.state, items]);

  const navItems = [
    { path:'/planner/gantt', labelKey:'sidebar.production_plan', icon:<Clock size={16}/> },
    { path:'/planner/orders', labelKey:'sidebar.manage_orders', icon:<FileText size={16}/> },
    { path:'/planner/items', labelKey:'sidebar.items_bom', icon:<Box size={16}/> },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar items={navItems} />
      <main className="flex-1 p-10 overflow-auto">
        <header className="mb-10 flex justify-between items-end">
          <div>
            <Badge className="mb-4">Resource Planning</Badge>
            <h1 className="font-display text-4xl text-foreground">{t('items.title')}</h1>
            <p className="text-muted-foreground mt-2">{t('items.subtitle')}</p>
          </div>
          <div className="flex gap-3">
          <div className="flex gap-2">
             <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input 
                  className="pl-10 w-48 bg-white" 
                  placeholder={t('items.search_placeholder')} 
                  value={searchCode}
                  onChange={(e) => setSearchCode(e.target.value)}
                />
             </div>
             <div className="relative mr-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input 
                  className="pl-10 w-64 bg-white" 
                  placeholder={t('items.search_placeholder')} 
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                />
             </div>
          </div>
             {activeTab === 'items' ? (
                <Button onClick={() => { setEditingItem(null); setShowItemModal(true); }}>
                  <Plus size={16} className="mr-2" /> {t('items.new_item')}
                </Button>
              ) : (
                <Button onClick={() => { setEditingBOM(null); setShowBOMModal(true); }}>
                  <Plus size={16} className="mr-2" /> {t('items.new_bom')}
                </Button>
              )}
          </div>
        </header>

        <div className="flex gap-1 mb-8 bg-muted/30 p-1 rounded-xl w-fit border border-border/50">
          {[
            { id: 'items', label: t('items.list_title'), icon: <List size={14}/> },
            { id: 'boms', label: t('items.bom_list_title'), icon: <Box size={14}/> }
          ].map((t_tab) => (
            <button
              key={t_tab.id}
              onClick={() => setActiveTab(t_tab.id)}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === t_tab.id 
                  ? 'bg-white text-accent shadow-sm ring-1 ring-border/50' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t_tab.icon}
              {t_tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'items' ? (
            <motion.div key="items" initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}}>
              <ItemsList 
                items={items.filter(i => 
                  (i.item_code.toLowerCase().includes(searchCode.toLowerCase())) &&
                  (i.name.toLowerCase().includes(searchName.toLowerCase()))
                )} 
                onEdit={(item) => { setEditingItem(item); setShowItemModal(true); }}
                loading={loading}
              />
            </motion.div>
          ) : (
            <motion.div key="boms" initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}}>
              <BOMList 
                searchCode={searchCode}
                searchName={searchName}
                onEdit={(bom) => { setEditingBOM(bom); setShowBOMModal(true); }}
                onPrint={(bom) => setShowPrintPreview(bom)}
                items={items}
                refreshKey={showBOMModal}
                navigate={navigate}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showItemModal && (
          <ItemModal 
            item={editingItem} 
            machines={machines}
            onClose={() => setShowItemModal(false)} 
            onSave={() => { setShowItemModal(false); loadData(); }} 
          />
        )}

        {showBOMModal && (
          <BOMModal 
            bom={editingBOM}
            items={items}
            onClose={() => setShowBOMModal(false)}
            onSave={() => { setShowBOMModal(false); loadData(); }}
          />
        )}

        {showPrintPreview && (
          <PrintPreview 
            bom={showPrintPreview}
            onClose={() => setShowPrintPreview(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ModalWrapper({ title, children, onClose, maxWidth = "max-w-3xl" }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className={`bg-white rounded-3xl shadow-2xl w-full ${maxWidth} overflow-hidden border border-border flex flex-col max-h-[90vh]`}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-8 py-6 border-b border-border flex justify-between items-center bg-white sticky top-0 z-10">
          <h3 className="font-display text-2xl text-foreground">{title}</h3>
          <button className="p-2 hover:bg-muted rounded-full transition-colors" onClick={onClose}><X size={24}/></button>
        </div>
        <div className="p-8 overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}

function ItemsList({ items, onEdit, loading }) {
  const { t } = useTranslation();
  if (loading) return <div className="p-20 text-center italic text-muted-foreground animate-pulse">{t('items.loading')}</div>;
  
  return (
    <Card className="p-0 overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-muted/30 border-b border-border">
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('common.item')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('inventory.type')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('inventory.uom')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('items.purchase_cost')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('items.production_cost')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('items.sale_price')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-center">{t('items.margin')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {items.map(item => {
            const totalCost = (item.acquisition_cost || 0) + (item.production_cost || 0);
            const margin = item.unit_price > 0 ? ((item.unit_price - totalCost) / item.unit_price * 100) : 0;
            return (
              <tr key={item.id} className="hover:bg-accent/[0.02] transition-colors group">
                <td className="px-6 py-4">
                  <div className="font-bold text-foreground">{item.name}</div>
                  <div className="font-mono text-[10px] text-accent font-black tracking-widest">{item.item_code}</div>
                </td>
                <td className="px-6 py-4">
                  <Badge variant="outline" className={item.type === 'finished_good' ? 'border-green-200 text-green-700 bg-green-50' : 'text-muted-foreground'}>
                    {t(`items.${item.type}`)}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-sm font-medium">{item.uom}</td>
                <td className="px-6 py-4 font-mono text-sm">{item.acquisition_cost?.toFixed(2)}</td>
                <td className="px-6 py-4 font-mono text-sm">{item.production_cost?.toFixed(2)}</td>
                <td className="px-6 py-4 font-mono font-bold text-accent">{item.unit_price?.toFixed(2)}</td>
                <td className="px-6 py-4 text-center">
                  {item.unit_price > 0 && (
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${margin > 20 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                      {margin.toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => onEdit(item)}>
                    <Edit2 size={14}/>
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function ItemModal({ item, machines, onClose, onSave }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    item_code: '',
    name: '',
    type: 'raw_material',
    uom: 'buc',
    acquisition_cost: 0,
    production_cost: 0,
    unit_price: 0,
    production_time_min: 0,
    routes: []
  });

  useEffect(() => {
    if (item?.id) {
      api.get(`/items/${item.id}`).then(res => {
        setFormData({
          ...res.data,
          routes: res.data.routes || [] // Ensure routes is always an array to prevent crashes
        });
      }).catch(() => toast.error(t('items.loading_details_error')));
    }
  }, [item, t]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (item) await api.put(`/items/${item.id}`, formData);
      else await api.post('/items', formData);
      toast.success(t('messages.save_success'));
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || t('messages.save_error'));
    }
  };

  const addRoute = () => {
    setFormData({ ...formData, routes: [...formData.routes, { machine_id: machines[0]?.id, process_time_min: 0, notes: '' }] });
  };

  return (
    <ModalWrapper title={item ? t('items.edit_item') : t('items.new_item')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('items.item_code')}</label>
            <Input value={formData.item_code} disabled={!!item} onChange={e => setFormData({...formData, item_code: e.target.value.toUpperCase()})} required />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('items.item_name')}</label>
            <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('items.item_type')}</label>
            <select className="w-full h-12 rounded-xl border border-border bg-white px-4 focus:ring-2 focus:ring-accent outline-none" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
              <option value="raw_material">{t('items.raw_material')}</option>
              <option value="semi_finished">{t('items.semi_finished')}</option>
              <option value="finished_good">{t('items.finished_good')}</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('inventory.uom')}</label>
            <Input value={formData.uom} onChange={e => setFormData({...formData, uom: e.target.value})} />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 bg-muted/20 p-6 rounded-2xl border border-border/50">
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-muted-foreground">{t('items.purchase_cost')}</label>
            <div className="relative">
              <DollarSign size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="number" step="0.01" className="pl-8 h-10" value={formData.acquisition_cost} onChange={e => setFormData({...formData, acquisition_cost: parseFloat(e.target.value)})} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-muted-foreground">{t('items.production_cost')}</label>
            <div className="relative">
              <DollarSign size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="number" step="0.01" className="pl-8 h-10" value={formData.production_cost} onChange={e => setFormData({...formData, production_cost: parseFloat(e.target.value)})} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-accent">{t('items.sale_price')}</label>
            <div className="relative">
              <TrendingUp size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-accent" />
              <Input type="number" step="0.01" className="pl-8 h-10 border-accent/30 text-accent font-bold" value={formData.unit_price} onChange={e => setFormData({...formData, unit_price: parseFloat(e.target.value)})} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-muted-foreground">{t('items.production_time')}</label>
            <div className="relative">
              <Clock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="number" className="pl-8 h-10" value={formData.production_time_min} onChange={e => setFormData({...formData, production_time_min: parseInt(e.target.value)})} />
            </div>
          </div>
        </div>

        {formData.type !== 'raw_material' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <h4 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2"><Zap size={16} className="text-yellow-500"/> {t('items.production_route')}</h4>
              <Button type="button" variant="secondary" size="sm" onClick={addRoute}><Plus size={14} className="mr-1"/> {t('items.add_step')}</Button>
            </div>
            <div className="space-y-3 max-h-48 overflow-y-auto pr-2">
              {formData.routes.map((r, i) => (
                <div key={i} className="flex gap-3 items-end bg-white p-4 rounded-xl border border-border shadow-sm">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">{t('admin.machine_name')}</label>
                    <select className="w-full h-10 rounded-lg border border-border px-3 text-sm outline-none focus:ring-1 ring-accent" value={r.machine_id} onChange={e => {
                      const newRoutes = [...formData.routes];
                      newRoutes[i].machine_id = parseInt(e.target.value);
                      setFormData({...formData, routes: newRoutes});
                    }}>
                      {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="w-24 space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">{t('items.production_time')}</label>
                    <Input type="number" className="h-10" value={r.process_time_min} onChange={e => {
                      const newRoutes = [...formData.routes];
                      newRoutes[i].process_time_min = parseInt(e.target.value);
                      setFormData({...formData, routes: newRoutes});
                    }}/>
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">{t('items.op_notes')}</label>
                    <Input className="h-10" value={r.notes} onChange={e => {
                      const newRoutes = [...formData.routes];
                      newRoutes[i].notes = e.target.value;
                      setFormData({...formData, routes: newRoutes});
                    }}/>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-10 text-red-500 hover:bg-red-50" onClick={() => {
                    const newRoutes = formData.routes.filter((_, idx) => idx !== i);
                    setFormData({...formData, routes: newRoutes});
                  }}>
                    <Trash2 size={16}/>
                  </Button>
                </div>
              ))}
              {formData.routes.length === 0 && <div className="text-center py-4 text-xs text-muted-foreground italic">{t('items.no_route')}</div>}
            </div>
          </div>
        )}

        <div className="pt-4 flex justify-end gap-3 border-t border-border">
          <Button variant="secondary" onClick={onClose} type="button">{t('common.cancel')}</Button>
          <Button type="submit">{t('items.save_item')}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function BOMList({ searchCode, searchName, onEdit, onPrint, items, refreshKey, navigate }) {
  const { t } = useTranslation();
  const [boms, setBoms] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadBoms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/boms');
      setBoms(res.data);
    } catch (err) {
      toast.error(t('items.loading_bom_error'));
    } finally {
      setLoading(false);
    }
  }, [refreshKey, t]);

  useEffect(() => { loadBoms(); }, [loadBoms]);

  const filtered = boms.filter(b =>
    (b.name.toLowerCase().includes(searchName.toLowerCase()) || b.description?.toLowerCase().includes(searchName.toLowerCase())) &&
    (b.parent_code?.toLowerCase().includes(searchCode.toLowerCase()))
  );

  if (loading) return <div className="p-20 text-center italic text-muted-foreground animate-pulse">{t('items.loading_bom')}</div>;

  return (
    <Card className="p-0 overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-muted/30 border-b border-border">
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('items.bom_name')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('items.finished_product')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('items.general_desc')}</th>
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('common.actions')}
              <span className="ml-2 text-[9px] normal-case font-normal opacity-50">({t('items.double_click_open')})</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {filtered.map(bom => (
            <tr
              key={bom.id}
              className="hover:bg-accent/[0.04] group cursor-pointer select-none transition-colors"
              onDoubleClick={() => navigate(`/planner/boms/${bom.id}`)}
              title={t('items.double_click_hint')}
            >
              <td className="px-6 py-4">
                <div className="font-bold text-foreground">{bom.name}</div>
                {bom.max_level > 1 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 mt-1">
                    <GitBranch size={10}/> {bom.max_level} {t('items.levels')} · {bom.total_positions} {t('items.pos')}
                  </span>
                )}
              </td>
              <td className="px-6 py-4">
                {bom.parent_code ? (
                  <div className="flex flex-col">
                    <span className="font-mono text-[10px] font-black text-accent">{bom.parent_code}</span>
                    <span className="text-sm font-medium">{bom.parent_name}</span>
                  </div>
                ) : <span className="text-muted-foreground italic text-xs">{t('items.unspecified')}</span>}
              </td>
              <td className="px-6 py-4 text-sm text-muted-foreground">{bom.description || '-'}</td>
              <td className="px-6 py-4 text-right">
                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(bom)}><Edit2 size={14}/></Button>
                  <Button variant="ghost" size="sm" onClick={() => onPrint(bom)}><Printer size={14}/></Button>
                  <Button variant="ghost" size="sm" className="text-red-500 hover:bg-red-50" onClick={async () => {
                    if (!window.confirm(t('items.delete_bom_confirm', { name: bom.name }))) return;
                    try { await api.delete(`/boms/${bom.id}`); toast.success(t('items.bom_deleted')); loadBoms(); }
                    catch { toast.error(t('messages.delete_error')); }
                  }}><Trash2 size={14}/></Button>
                </div>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={4} className="px-6 py-16 text-center text-muted-foreground italic text-sm">{t('items.no_bom_found')}</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function BOMModal({ bom, items, onClose, onSave }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({ name: '', parent_item_id: '', description: '' });
  const [tree, setTree] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bom?.id) {
      api.get(`/boms/${bom.id}`).then(res => {
        setFormData({ name: res.data.name, parent_item_id: res.data.parent_item_id || '', description: res.data.description || '' });
      });
      api.get(`/boms/${bom.id}/tree`).then(res => {
        setTree(serverToClient(res.data.tree || []));
      });
    }
  }, [bom]);

  const calcCost = (nodes) => nodes.reduce((sum, n) => {
    const item = items.find(i => i.id === n.item_id);
    const self = item ? (item.acquisition_cost || 0) * (n.quantity || 1) : 0;
    return sum + self + calcCost(n.children || []);
  }, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...formData, parent_item_id: formData.parent_item_id || null, tree: clientToServer(tree) };
      if (bom?.id) await api.put(`/boms/${bom.id}`, payload);
      else await api.post('/boms', payload);
      toast.success(t('messages.save_success'));
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || t('messages.save_error'));
    } finally {
      setSaving(false);
    }
  };

  const finishedGoods = items.filter(i => i.type === 'finished_good');

  return (
    <ModalWrapper title={bom ? t('items.edit_bom') : t('items.create_bom')} onClose={onClose} maxWidth="max-w-5xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header fields */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('items.finished_good')}</label>
            <select className="w-full h-11 rounded-xl border border-border bg-white px-3 text-sm focus:ring-2 focus:ring-accent outline-none" value={formData.parent_item_id || ''} onChange={e => setFormData({...formData, parent_item_id: e.target.value})}>
              <option value="">{t('items.select_finished_good')}</option>
              {finishedGoods.map(i => <option key={i.id} value={i.id}>{i.item_code} — {i.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('items.bom_name')}</label>
            <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="ex: BOM CABIN 767 Rev.A"/>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('items.general_desc')}</label>
            <Input value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder={t('common.optional')}/>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[10px] font-bold flex-wrap">
          <span className="text-muted-foreground uppercase tracking-wider">{t('items.legend')}:</span>
          <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">L1 — Phantom / Departament</span>
          <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">L2 — Semifabricat</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">L3 — Materie Primă</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">L4 — Sub-componentă</span>
          <span className="ml-auto px-2 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent font-mono">
            {t('items.cost_std')}: {calcCost(tree).toFixed(2)}
          </span>
        </div>

        {/* Tree editor */}
        <div className="border border-border rounded-2xl p-4 bg-muted/10 max-h-[55vh] overflow-y-auto">
          <BOMEditor tree={tree} onChange={setTree} items={items} />
        </div>

        <div className="pt-4 flex justify-end gap-3 border-t border-border">
          <Button variant="secondary" onClick={onClose} type="button">{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>{saving ? t('admin.saving') : t('items.new_bom')}</Button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function PrintPreview({ bom, onClose }) {
  const { t } = useTranslation();
  const [details, setDetails] = useState(null);

  useEffect(() => {
    api.get(`/boms/${bom.id}`).then(res => setDetails(res.data));
  }, [bom]);

  if (!details) return null;

  return (
    <ModalWrapper title={t('common.preview_bom')} onClose={onClose} maxWidth="max-w-4xl">
      <div className="space-y-8 no-print p-4">
         <div className="flex justify-between items-start bg-slate-50 p-6 rounded-2xl border border-border">
            <div className="space-y-1">
               <h4 className="text-xl font-display text-accent">SmartFactory MES</h4>
               <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('items.tech_doc')}</p>
            </div>
            <Button onClick={() => window.print()}><Printer size={16} className="mr-2"/> {t('items.print_sheet')}</Button>
         </div>
         
         <div className="grid grid-cols-3 gap-6">
            <div className="space-y-1">
               <label className="text-[10px] font-black text-muted-foreground uppercase tracking-tighter">{t('items.recipe_name')}</label>
               <p className="font-bold">{details.name}</p>
            </div>
            <div className="space-y-1">
               <label className="text-[10px] font-black text-muted-foreground uppercase tracking-tighter">{t('items.parent_item')}</label>
               <p className="font-bold text-accent">{details.parent_code} - {details.parent_name}</p>
            </div>
            <div className="space-y-1">
               <label className="text-[10px] font-black text-muted-foreground uppercase tracking-tighter">{t('items.issue_date')}</label>
               <p className="font-bold">{format(new Date(), 'dd.MM.yyyy')}</p>
            </div>
         </div>

         <div className="border border-border rounded-2xl overflow-hidden">
            <table className="w-full text-left text-sm">
               <thead className="bg-muted/50 border-b border-border">
                  <tr>
                     <th className="px-4 py-3 font-bold text-xs">{t('items.poz')}</th>
                     <th className="px-4 py-3 font-bold text-xs">{t('items.item_code')}</th>
                     <th className="px-4 py-3 font-bold text-xs">{t('items.component_name')}</th>
                     <th className="px-4 py-3 font-bold text-xs text-center">{t('inventory.quantity')}</th>
                     <th className="px-4 py-3 font-bold text-xs">{t('items.location')}</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-border">
                  {details.positions.map((p, i) => (
                     <tr key={i}>
                        <td className="px-4 py-3 font-mono text-xs">{p.position_code}</td>
                        <td className="px-4 py-3 font-mono font-bold">{p.item_code}</td>
                        <td className="px-4 py-3">{p.item_name}</td>
                        <td className="px-4 py-3 text-center font-bold">{p.quantity}</td>
                        <td className="px-4 py-3 font-medium text-muted-foreground">{p.location || 'WH1'}</td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
      </div>
      {/* Hidden printable content */}
      <div className="hidden print:block p-10 font-sans" id="printable-bom">
          <div className="flex justify-between items-center mb-8 border-b-2 border-black pb-4">
              <div>
                  <h1 className="text-2xl font-bold">BILL OF MATERIALS</h1>
                  <p className="text-sm font-mono">{details.name}</p>
              </div>
              <div className="text-right text-xs">
                  <p className="font-bold">SmartFactory Flow</p>
                  <p>{t('common.date')}: {format(new Date(), 'dd.MM.yyyy HH:mm')}</p>
              </div>
          </div>
          <table className="w-full border-collapse border border-black mb-10">
              <thead>
                  <tr className="bg-gray-100">
                      <th className="border border-black p-2 text-xs">{t('items.poz')}</th>
                      <th className="border border-black p-2 text-xs">{t('items.item_code')}</th>
                      <th className="border border-black p-2 text-xs">{t('items.component_name')}</th>
                      <th className="border border-black p-2 text-xs">{t('inventory.quantity')}</th>
                      <th className="border border-black p-2 text-xs">{t('items.location')}</th>
                  </tr>
              </thead>
              <tbody>
                  {details.positions.map((p,i) => (
                      <tr key={i}>
                          <td className="border border-black p-2 text-xs font-mono">{p.position_code}</td>
                          <td className="border border-black p-2 text-xs font-mono font-bold">{p.item_code}</td>
                          <td className="border border-black p-2 text-xs">{p.item_name}</td>
                          <td className="border border-black p-2 text-xs text-center">{p.quantity}</td>
                          <td className="border border-black p-2 text-xs">{p.location || 'WH1'}</td>
                      </tr>
                  ))}
              </tbody>
          </table>
          <div className="grid grid-cols-2 gap-20 mt-20">
              <div className="border-t border-black pt-2 text-center text-xs">{t('items.prepared_by')}</div>
              <div className="border-t border-black pt-2 text-center text-xs">{t('items.approved_by')}</div>
          </div>
      </div>
    </ModalWrapper>
  );
}
