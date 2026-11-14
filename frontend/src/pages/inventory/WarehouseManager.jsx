import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Plus, Package, Layers, QrCode, Trash2, X, Home } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';

export default function WarehouseManager() {
  const { t } = useTranslation();
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [showWHModal, setShowWHModal] = useState(false);
  const [showLocModal, setShowLocModal] = useState(false);

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await api.get('/warehousing/warehouses');
      setWarehouses(res.data);
      if (res.data.length > 0 && !selectedWarehouse) {
        setSelectedWarehouse(res.data[0]);
      }
    } catch (err) {
      toast.error(t('screens.common.load_error'));
    } finally {
      setLoading(false);
    }
  }, [selectedWarehouse, t]);

  const loadLocations = useCallback(async () => {
    if (!selectedWarehouse) return;
    try {
      const res = await api.get(`/warehousing/locations/${selectedWarehouse.id}`);
      setLocations(res.data);
    } catch (err) {
      toast.error(t('screens.common.load_error'));
    }
  }, [selectedWarehouse, t]);

  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);
  useEffect(() => { loadLocations(); }, [loadLocations]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h2 className="font-display text-3xl text-foreground">{t('screens.warehouse.title')}</h2>
          <p className="text-muted-foreground">{t('screens.warehouse.subtitle')}</p>
        </div>
        <Button onClick={() => setShowWHModal(true)}>
          <Plus size={16} className="mr-2" /> {t('screens.warehouse.new_warehouse')}
        </Button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
        {/* Warehouse List */}
        <aside className="lg:col-span-4 space-y-3">
          {warehouses.map(wh => (
            <Card 
              key={wh.id} 
              className={`p-4 cursor-pointer transition-all border-2 ${selectedWarehouse?.id === wh.id ? 'border-accent bg-accent/5' : 'border-transparent hover:border-border'}`}
              onClick={() => setSelectedWarehouse(wh)}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedWarehouse?.id === wh.id ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'}`}>
                    <Home size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-lg">{wh.name}</h4>
                    <Badge variant="outline" className="capitalize text-[10px]">{t(`screens.warehouse.types.${wh.type}`)}</Badge>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </aside>

        {/* Locations Grid */}
        <main className="lg:col-span-8 space-y-6">
          {selectedWarehouse ? (
            <Card className="p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="font-display text-xl">{t('screens.warehouse.locations_in', { name: selectedWarehouse.name })}</h3>
                  <p className="text-sm text-muted-foreground">{t('screens.warehouse.location_count', { count: locations.length })}</p>
                </div>
                <Button variant="secondary" onClick={() => setShowLocModal(true)}>
                  <Plus size={16} className="mr-2" /> {t('screens.warehouse.new_location')}
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {locations.map(loc => (
                  <div key={loc.id} className="p-4 bg-muted/20 border border-border rounded-xl flex flex-col gap-2 group hover:bg-white hover:shadow-md transition-all">
                    <div className="flex justify-between items-start">
                      <div className="bg-white p-2 rounded-lg border border-border">
                        <MapPin size={16} className="text-accent" />
                      </div>
                      <Badge variant="secondary" className="font-mono text-[10px]">{loc.barcode}</Badge>
                    </div>
                    <div>
                      <div className="text-xs font-black text-muted-foreground uppercase tracking-tighter">{t('screens.warehouse.zone_shelf_bin')}</div>
                      <div className="font-bold text-lg">{loc.zone || '-'} / {loc.shelf || '-'} / {loc.bin || '-'}</div>
                    </div>
                  </div>
                ))}
                {locations.length === 0 && (
                  <div className="col-span-full py-12 text-center text-muted-foreground italic">
                    {t('screens.warehouse.no_locations')}
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground italic">
              {t('screens.warehouse.pick_warehouse')}
            </div>
          )}
        </main>
      </div>

      <AnimatePresence>
        {showWHModal && (
          <WarehouseModal 
            onClose={() => setShowWHModal(false)} 
            onSave={() => { setShowWHModal(false); loadWarehouses(); }} 
          />
        )}
        {showLocModal && (
          <LocationModal 
            warehouseId={selectedWarehouse?.id}
            onClose={() => setShowLocModal(false)} 
            onSave={() => { setShowLocModal(false); loadLocations(); }} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function WarehouseModal({ onClose, onSave }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({ name: '', type: 'central', description: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/warehousing/warehouses', formData);
      toast.success(t('screens.warehouse.warehouse_created'));
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || t('screens.common.error'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-5 sm:p-8 w-full max-w-md max-h-[92vh] overflow-y-auto border border-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl mb-6">{t('screens.warehouse.new_warehouse')}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.warehouse.name')}</label>
            <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.warehouse.type')}</label>
            <select className="w-full h-11 rounded-xl border border-border px-3 bg-white" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
              <option value="central">{t('screens.warehouse.types.central')}</option>
              <option value="production">{t('screens.warehouse.types.production')}</option>
              <option value="quarantine">{t('screens.warehouse.types.quarantine')}</option>
              <option value="shipping">{t('screens.warehouse.types.shipping')}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.common.description')}</label>
            <Input value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit">{t('common.save')}</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function LocationModal({ warehouseId, onClose, onSave }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({ zone: '', shelf: '', bin: '', barcode: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/warehousing/locations', { ...formData, warehouse_id: warehouseId });
      toast.success(t('screens.warehouse.location_created'));
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || t('screens.warehouse.barcode_error'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-5 sm:p-8 w-full max-w-md max-h-[92vh] overflow-y-auto border border-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl mb-6">{t('screens.warehouse.new_location')}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.warehouse.zone')}</label>
              <Input value={formData.zone} onChange={e => setFormData({...formData, zone: e.target.value})} placeholder="A1" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.warehouse.shelf')}</label>
              <Input value={formData.shelf} onChange={e => setFormData({...formData, shelf: e.target.value})} placeholder="04" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.warehouse.bin')}</label>
              <Input value={formData.bin} onChange={e => setFormData({...formData, bin: e.target.value})} placeholder="02" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.warehouse.barcode')}</label>
            <Input value={formData.barcode} onChange={e => setFormData({...formData, barcode: e.target.value.toUpperCase()})} required placeholder="LOC-WH1-A10402" />
            <p className="text-[10px] text-muted-foreground mt-1 italic">{t('screens.warehouse.barcode_hint')}</p>
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit">{t('common.save')}</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
