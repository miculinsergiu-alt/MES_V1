import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Truck, Plus, Search, Edit2, Phone, Mail, MapPin, CheckCircle, XCircle, Package, Trash2, Save } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';

export default function SupplierManager() {
  const { t } = useTranslation();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [params] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(() => params.get('search') || '');
  
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [supplierForItems, setSupplierForItems] = useState(null);

  const loadSuppliers = useCallback(async () => {
    try {
      const res = await api.get('/suppliers');
      setSuppliers(res.data);
    } catch (err) {
      toast.error(t('screens.common.load_error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);

  const filtered = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.contact_person?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.items && s.items.some(i => 
      i.item_code.toLowerCase().includes(searchTerm.toLowerCase()) || 
      i.item_name.toLowerCase().includes(searchTerm.toLowerCase())
    ))
  );

  return (
    <div className="flex flex-col">
      <main className="flex-1 p-4 sm:p-6 lg:p-10 overflow-auto space-y-8">
      <header className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h2 className="font-display text-3xl text-foreground flex items-center gap-3">
            <Truck className="text-blue-500" size={32} /> {t('screens.suppliers.title')}
          </h2>
          <p className="text-muted-foreground mt-2">{t('screens.suppliers.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="relative">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
             <Input 
                className="pl-10 w-full sm:w-64 bg-white" 
                placeholder={t('screens.suppliers.search')} 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
             />
          </div>
          <Button onClick={() => { setEditingSupplier(null); setShowModal(true); }}>
            <Plus size={16} className="mr-2" /> {t('screens.suppliers.new')}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filtered.map(sup => (
          <Card key={sup.id} className="p-6 group hover:border-blue-200 transition-all">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-50 rounded-2xl text-blue-600">
                  <Truck size={24} />
                </div>
                <div>
                  <h4 className="font-bold text-xl">{sup.name}</h4>
                  <Badge className={sup.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                    {sup.active ? t('screens.common.active') : t('screens.common.inactive')}
                  </Badge>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setSupplierForItems(sup)}>
                  <Package size={16} className="mr-2" /> {t('screens.suppliers.materials')} ({sup.items?.length || 0})
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setEditingSupplier(sup); setShowModal(true); }}>
                  <Edit2 size={16} />
                </Button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm mt-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone size={14} /> {sup.phone || '-'}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail size={14} /> {sup.email || '-'}
              </div>
              <div className="col-span-2 flex items-center gap-2 text-muted-foreground">
                <MapPin size={14} /> {sup.address || '-'}
              </div>
            </div>
            
            <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-2">
               <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{t('screens.suppliers.contact')}:</span>
               <span className="text-sm font-bold">{sup.contact_person || '—'}</span>
            </div>
          </Card>
        ))}
      </div>

      <AnimatePresence>
        {showModal && (
          <SupplierModal 
            supplier={editingSupplier} 
            onClose={() => setShowModal(false)} 
            onSave={() => { setShowModal(false); loadSuppliers(); }} 
          />
        )}
        {supplierForItems && (
          <SupplierItemsModal
            supplier={supplierForItems}
            onClose={() => setSupplierForItems(null)}
            onSave={() => { loadSuppliers(); }}
          />
        )}
      </AnimatePresence>
      </main>
    </div>
  );
}

function SupplierModal({ supplier, onClose, onSave }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    email: '',
    phone: '',
    address: '',
    vat_number: '',
    active: 1
  });
  const [vatCheck, setVatCheck] = useState(null); // { status: 'checking' | 'valid' | 'invalid' | 'error', text }

  useEffect(() => {
    if (supplier) setFormData({ ...supplier, vat_number: supplier.vat_number || '' });
  }, [supplier]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (supplier) await api.put(`/suppliers/${supplier.id}`, formData);
      else await api.post('/suppliers', formData);
      toast.success(t('messages.save_success'));
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || t('messages.save_error'));
    }
  };

  // Live check of the EU VAT ID against the official VIES service.
  const checkVat = async () => {
    const vat = (formData.vat_number || '').trim();
    if (!vat) return;
    setVatCheck({ status: 'checking', text: '…' });
    try {
      const res = await api.get(`/suppliers/validate-vat/${encodeURIComponent(vat)}`);
      if (res.data.isValid) {
        setVatCheck({ status: 'valid', text: res.data.name ? `✓ ${res.data.name}` : '✓ VIES' });
        setFormData((prev) => ({
          ...prev,
          vat_number: res.data.vat_number,
          name: prev.name || res.data.name || '',
          address: prev.address || res.data.address || '',
        }));
      } else {
        setVatCheck({ status: 'invalid', text: '✗ VIES' });
      }
    } catch (err) {
      setVatCheck({ status: 'error', text: err.response?.data?.error || 'VIES' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 w-full max-w-md border border-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl mb-6">{supplier ? t('screens.suppliers.edit') : t('screens.suppliers.new')}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.suppliers.company')}</label>
            <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.suppliers.contact')}</label>
            <Input value={formData.contact_person} onChange={e => setFormData({...formData, contact_person: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.common.phone')}</label>
              <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.common.email')}</label>
              <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.common.address')}</label>
            <Input value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground" htmlFor="vat-input">{t('sales.customers.vat_id')}</label>
            <div className="flex gap-2">
              <Input
                id="vat-input"
                placeholder="DE123456789"
                value={formData.vat_number}
                onChange={e => { setFormData({...formData, vat_number: e.target.value}); setVatCheck(null); }}
              />
              <Button type="button" variant="secondary" onClick={checkVat} disabled={!formData.vat_number || vatCheck?.status === 'checking'}>
                VIES
              </Button>
            </div>
            {vatCheck && (
              <p className={`text-xs ${vatCheck.status === 'valid' ? 'text-emerald-600' : vatCheck.status === 'checking' ? 'text-muted-foreground' : 'text-red-600'}`}>
                {vatCheck.text}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={!!formData.active} onChange={e => setFormData({...formData, active: e.target.checked ? 1 : 0})} />
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('screens.common.active')}</label>
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

function SupplierItemsModal({ supplier, onClose, onSave }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [formData, setFormData] = useState({
    item_id: '',
    purchase_price: 0,
    currency: 'EUR',
    lead_time_days: 0
  });

  useEffect(() => {
    api.get('/items').then(res => setItems(res.data.filter(i => i.type === 'raw_material' || i.type === 'semi_finished')));
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!formData.item_id) return toast.error(t('screens.common.choose_material'));
    try {
      await api.post('/suppliers/item', { ...formData, supplier_id: supplier.id });
      toast.success(t('messages.save_success'));
      setFormData({ item_id: '', purchase_price: 0, currency: 'EUR', lead_time_days: 0 });
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || t('messages.save_error'));
    }
  };

  const handleRemove = async (itemId) => {
    if (!window.confirm(t('screens.suppliers.remove_confirm'))) return;
    try {
      await api.delete(`/suppliers/item/${itemId}/${supplier.id}`);
      toast.success(t('messages.delete_success'));
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || t('messages.delete_error'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 w-full max-w-3xl border border-border shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="font-display text-2xl flex items-center gap-2"><Package className="text-blue-600" /> {t('screens.suppliers.materials')}</h3>
            <p className="text-muted-foreground text-sm mt-1">{t('screens.suppliers.materials_from')} <span className="font-bold text-foreground">{supplier.name}</span></p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full bg-muted/20 hover:bg-muted"><XCircle size={20} /></Button>
        </div>

        <div className="flex-1 overflow-y-auto mb-6 pr-2 space-y-3">
          {supplier.items && supplier.items.length > 0 ? (
            supplier.items.map(it => (
              <div key={it.id} className="flex justify-between items-center bg-muted/20 p-4 rounded-xl border border-border/50 hover:border-blue-200 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white rounded-xl shadow-sm border border-border/50 text-blue-600">
                    <Package size={20} />
                  </div>
                  <div>
                    <span className="font-mono text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-0.5 rounded-full">{it.item_code}</span>
                    <h4 className="font-bold text-sm mt-1">{it.item_name}</h4>
                    <div className="text-[11px] text-muted-foreground mt-1 flex gap-4">
                      <span className="flex items-center gap-1">{t('screens.common.purchase_price')}: <strong className="text-foreground">{it.purchase_price} {it.currency}</strong></span>
                      <span className="flex items-center gap-1">{t('screens.suppliers.lead_time')}: <strong className="text-foreground">{t('screens.common.days', { count: it.lead_time_days })}</strong></span>
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleRemove(it.item_id)} className="text-red-500 hover:text-red-700 hover:bg-red-50" title={t('common.delete')}>
                  <Trash2 size={18} />
                </Button>
              </div>
            ))
          ) : (
            <div className="text-center py-10 text-muted-foreground bg-muted/10 rounded-2xl border border-dashed border-border flex flex-col items-center justify-center gap-2">
              <Package size={32} className="text-muted-foreground/30" />
              <p>{t('screens.suppliers.no_materials')}</p>
              <p className="text-xs italic">{t('screens.suppliers.no_materials_hint')}</p>
            </div>
          )}
        </div>

        <form onSubmit={handleAdd} className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex flex-col gap-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-500"></div>
          <h4 className="text-xs font-black uppercase tracking-widest text-blue-800 flex items-center gap-2"><Plus size={14} /> {t('screens.suppliers.add_material')}</h4>
          <div className="grid grid-cols-12 gap-4 items-end">
            <div className="col-span-5 space-y-1">
              <label className="text-[10px] font-bold uppercase text-blue-700">{t('screens.common.material')}</label>
              <select className="w-full h-10 rounded-lg border border-blue-200 px-3 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={formData.item_id} onChange={e => setFormData({...formData, item_id: e.target.value})} required>
                <option value="">{t('screens.common.choose_material')}</option>
                {items.filter(i => !(supplier.items || []).find(si => si.item_id === i.id)).map(i => (
                  <option key={i.id} value={i.id}>{i.item_code} - {i.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3 space-y-1">
              <label className="text-[10px] font-bold uppercase text-blue-700">{t('screens.common.purchase_price')}</label>
              <div className="flex">
                <input type="number" step="0.01" className="w-full h-10 rounded-l-lg border border-blue-200 border-r-0 px-3 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:z-10 outline-none" value={formData.purchase_price} onChange={e => setFormData({...formData, purchase_price: parseFloat(e.target.value)})} required />
                <select className="h-10 rounded-r-lg border border-blue-200 px-2 text-xs font-bold bg-blue-100/50 text-blue-800 focus:ring-2 focus:ring-blue-500 outline-none" value={formData.currency} onChange={e => setFormData({...formData, currency: e.target.value})}>
                  <option value="EUR">EUR</option>
                  <option value="RON">RON</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-bold uppercase text-blue-700">{t('screens.suppliers.lead_time')}</label>
              <div className="relative">
                <input type="number" className="w-full h-10 rounded-lg border border-blue-200 px-3 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={formData.lead_time_days} onChange={e => setFormData({...formData, lead_time_days: parseInt(e.target.value) || 0})} required />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">{t('screens.common.days_short')}</span>
              </div>
            </div>
            <div className="col-span-2">
              <Button type="submit" className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20"><Save size={16} className="mr-1"/> {t('common.save')}</Button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
