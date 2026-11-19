import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Plus, Search, List } from 'lucide-react';
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
