import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Plus, Search, List, Trash2 } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { ItemsList, ItemModal, BOMList, BOMModal, PrintPreview } from './ItemsManagerParts';

export default function ItemsManager() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('items'); // 'items' or 'boms'
  const [items, setItems] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [params] = useSearchParams();
  const [searchCode, setSearchCode] = useState(() => params.get('search') || '');
  const [searchName, setSearchName] = useState('');
  
  // Modals
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showBOMModal, setShowBOMModal] = useState(false);
  const [editingBOM, setEditingBOM] = useState(null);
  const [showPrintPreview, setShowPrintPreview] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = (list, on) => setSelected((prev) => {
    const next = new Set(prev);
    for (const i of list) { if (on) next.add(i.id); else next.delete(i.id); }
    return next;
  });

  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length || !window.confirm(t('items.delete_confirm', { count: ids.length }))) return;
    setDeleting(true);
    let deleted = 0; const blocked = [];
    try {
      for (let i = 0; i < ids.length; i += 1000) {
        const r = (await api.post('/items/delete', { ids: ids.slice(i, i + 1000) })).data;
        deleted += r.deleted;
        blocked.push(...r.blocked);
      }
      toast.success(t('items.deleted_count', { count: deleted }));
      if (blocked.length) {
        toast(t('items.delete_blocked', { count: blocked.length, codes: blocked.slice(0, 5).map((b) => b.item_code).join(', ') }), { duration: 8000 });
      }
    } catch (err) {
      toast.error(err.response?.data?.error || t('items.delete_error'));
    } finally {
      setDeleting(false);
      setSelected(new Set());
      loadData();
    }
  };

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

  return (
    <div className="flex flex-col">
      <main className="flex-1 p-4 sm:p-6 lg:p-10 overflow-auto">
        <header className="mb-10 flex justify-between items-end">
          <div>
            <Badge className="mb-4">{t('shell.groups.master_data')}</Badge>
            <h1 className="font-display text-4xl text-foreground">{t('items.title')}</h1>
            <p className="text-muted-foreground mt-2">{t('items.subtitle')}</p>
          </div>
          <div className="flex gap-3">
          <div className="flex gap-2">
             <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input 
                  className="pl-10 w-48 bg-white" 
                  placeholder={t('items.search_code')} 
                  value={searchCode}
                  onChange={(e) => setSearchCode(e.target.value)}
                />
             </div>
             <div className="relative mr-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input 
                  className="pl-10 w-64 bg-white" 
                  placeholder={t('items.search_name')} 
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                />
             </div>
          </div>
             {activeTab === 'items' && selected.size > 0 && (
                <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" disabled={deleting} onClick={deleteSelected}>
                  <Trash2 size={16} className="mr-2" /> {t('items.delete_selected', { count: selected.size })}
                </Button>
              )}
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
                  (i.item_code?.toLowerCase().includes(searchCode.toLowerCase())) &&
                  (i.name?.toLowerCase().includes(searchName.toLowerCase()))
                )} 
                onEdit={(item) => { setEditingItem(item); setShowItemModal(true); }}
                loading={loading}
                selected={selected}
                onToggle={toggleOne}
                onToggleAll={toggleAll}
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
