import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCompare, ArrowRightLeft, MoveRight, Plus, Box, MapPin, CheckCircle } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';

export default function InventoryTransfers() {
  const { t } = useTranslation();
  const [warehouses, setWarehouses] = useState([]);
  const [items, setItems] = useState([]);
  const [showTransferModal, setShowTransferModal] = useState(false);

  useEffect(() => {
    api.get('/warehousing/warehouses').then(res => setWarehouses(res.data));
    api.get('/items').then(res => setItems(res.data));
  }, []);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h2 className="font-display text-3xl text-foreground flex items-center gap-3">
            <ArrowRightLeft className="text-accent" size={32} /> {t('screens.transfers.title')}
          </h2>
          <p className="text-muted-foreground mt-2">{t('screens.transfers.subtitle')}</p>
        </div>
        <Button onClick={() => setShowTransferModal(true)}>
          <Plus size={16} className="mr-2" /> {t('screens.transfers.new')}
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="p-6 border-dashed border-2 flex flex-col items-center justify-center text-center py-12">
          <div className="p-4 bg-accent/10 rounded-full text-accent mb-4">
            <Box size={32} />
          </div>
          <h4 className="font-bold">{t('screens.transfers.see_stock')}</h4>
          <p className="text-sm text-muted-foreground mt-1">{t('screens.transfers.see_stock_hint')}</p>
          <Button variant="ghost" className="mt-4" onClick={() => window.location.assign('/inventory')}>{t('screens.transfers.go_inventory')}</Button>
        </Card>
      </div>

      <AnimatePresence>
        {showTransferModal && (
          <TransferModal 
            warehouses={warehouses} 
            items={items}
            onClose={() => setShowTransferModal(false)} 
            onSave={() => { setShowTransferModal(false); }} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TransferModal({ warehouses, items, onClose, onSave }) {
  const { t } = useTranslation();
  const [locations, setLocations] = useState([]);
  const [formData, setFormData] = useState({
    from_warehouse_id: '',
    to_warehouse_id: '',
    items: []
  });

  useEffect(() => {
    // Pre-load all locations for convenience
    const loadAllLocs = async () => {
      const all = [];
      for (const wh of warehouses) {
        const res = await api.get(`/warehousing/locations/${wh.id}`);
        all.push(...res.data.map(l => ({ ...l, whName: wh.name })));
      }
      setLocations(all);
    };
    if (warehouses.length > 0) loadAllLocs();
  }, [warehouses]);

  const addTransferItem = () => {
    setFormData({ ...formData, items: [...formData.items, { item_id: '', lot_number: '', quantity: 0, from_location_id: '', to_location_id: '' }] });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/inventory/transfers', formData);
      toast.success(t('screens.transfers.done'));
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || t('screens.common.error'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-5 sm:p-8 w-full max-w-5xl border border-border shadow-2xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl mb-8">{t('screens.transfers.new')}</h3>
        
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-4 sm:gap-8 items-center bg-muted/20 p-4 sm:p-6 rounded-2xl border border-border/50">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-muted-foreground">{t('screens.transfers.from_warehouse')}</label>
              <select className="w-full h-11 rounded-xl border border-border px-3 bg-white" value={formData.from_warehouse_id} onChange={e => setFormData({...formData, from_warehouse_id: e.target.value})} required>
                <option value="">{t('screens.transfers.choose_warehouse')}</option>
                {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
              </select>
            </div>
            <div className="hidden sm:flex justify-center text-muted-foreground">
               <MoveRight size={24} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-muted-foreground">{t('screens.transfers.to_warehouse')}</label>
              <select className="w-full h-11 rounded-xl border border-border px-3 bg-white" value={formData.to_warehouse_id} onChange={e => setFormData({...formData, to_warehouse_id: e.target.value})} required>
                <option value="">{t('screens.transfers.choose_warehouse')}</option>
                {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-4">
             <div className="flex justify-between items-center border-b pb-2">
                <h4 className="text-sm font-bold uppercase tracking-widest">{t('screens.transfers.items')}</h4>
                <Button type="button" variant="secondary" size="sm" onClick={addTransferItem}><Plus size={14} className="mr-1"/> {t('screens.common.add_item')}</Button>
             </div>
             {formData.items.map((it, idx) => (
                <Card key={idx} className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                   <div className="sm:col-span-4 space-y-1">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">{t('screens.common.material')}</label>
                      <select className="w-full h-10 rounded-lg border border-border px-3 text-sm" value={it.item_id} onChange={e => {
                         const newItems = [...formData.items];
                         newItems[idx].item_id = e.target.value;
                         setFormData({...formData, items: newItems});
                      }}>
                         <option value="">{t('screens.common.choose_material')}</option>
                         {items.map(i => <option key={i.id} value={i.id}>{i.item_code} - {i.name}</option>)}
                      </select>
                   </div>
                   <div className="sm:col-span-2 space-y-1">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">{t('screens.common.lot')}</label>
                      <Input value={it.lot_number} onChange={e => {
                         const newItems = [...formData.items];
                         newItems[idx].lot_number = e.target.value.toUpperCase();
                         setFormData({...formData, items: newItems});
                      }} placeholder="LOT-..." />
                   </div>
                   <div className="sm:col-span-2 space-y-1">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">{t('screens.common.quantity')}</label>
                      <Input type="number" value={it.quantity} onChange={e => {
                         const newItems = [...formData.items];
                         newItems[idx].quantity = parseFloat(e.target.value);
                         setFormData({...formData, items: newItems});
                      }} />
                   </div>
                   <div className="sm:col-span-2 space-y-1">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">{t('screens.transfers.from_location')}</label>
                      <select className="w-full h-10 rounded-lg border border-border px-3 text-sm" value={it.from_location_id} onChange={e => {
                         const newItems = [...formData.items];
                         newItems[idx].from_location_id = e.target.value;
                         setFormData({...formData, items: newItems});
                      }}>
                         <option value="">—</option>
                         {locations.filter(l => l.warehouse_id == formData.from_warehouse_id).map(l => <option key={l.id} value={l.id}>{l.barcode}</option>)}
                      </select>
                   </div>
                   <div className="sm:col-span-2 space-y-1">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground">{t('screens.transfers.to_location')}</label>
                      <select className="w-full h-10 rounded-lg border border-border px-3 text-sm" value={it.to_location_id} onChange={e => {
                         const newItems = [...formData.items];
                         newItems[idx].to_location_id = e.target.value;
                         setFormData({...formData, items: newItems});
                      }}>
                         <option value="">—</option>
                         {locations.filter(l => l.warehouse_id == formData.to_warehouse_id).map(l => <option key={l.id} value={l.id}>{l.barcode}</option>)}
                      </select>
                   </div>
                </Card>
             ))}
          </div>

          <div className="pt-6 flex justify-end gap-3 border-t">
            <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" className="px-8">{t('screens.transfers.finish')}</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
