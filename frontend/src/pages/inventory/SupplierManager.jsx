import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, Plus, Search, Edit2, Phone, Mail, MapPin, CheckCircle, XCircle, Package, Trash2, Save } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import Sidebar from '../../components/Sidebar';
import { ArrowDownUp, LogOut, Clock, FileText, Box } from 'lucide-react';

export default function SupplierManager() {
  const { t } = useTranslation();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [supplierForItems, setSupplierForItems] = useState(null);

  const loadSuppliers = useCallback(async () => {
    try {
      const res = await api.get('/suppliers');
      setSuppliers(res.data);
    } catch (err) {
      toast.error('Eroare la încărcarea furnizorilor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);

  const filtered = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.contact_person?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.items && s.items.some(i => 
      i.item_code.toLowerCase().includes(searchTerm.toLowerCase()) || 
      i.item_name.toLowerCase().includes(searchTerm.toLowerCase())
    ))
  );

  const { user, logout } = useAuth();

  const plannerNav = [
    { path:'/planner/gantt', labelKey:'sidebar.production_plan', icon:<Clock size={16}/> },
    { path:'/planner/orders', labelKey:'sidebar.manage_orders', icon:<FileText size={16}/> },
    { path:'/planner/items', labelKey:'sidebar.items_bom', icon:<Box size={16}/> },
    { path:'/planner/suppliers', labelKey:'sidebar.suppliers', icon:<Truck size={16}/> },
    { path:'/planner/inventory', labelKey:'sidebar.stocks', icon:<ArrowDownUp size={16}/> },
  ];

  const matPlannerNav = [
    { path: '/inventory', labelKey: 'sidebar.inventory_hub', icon: <Package size={16}/> },
    { path: '/inventory/suppliers', label: 'Furnizori', icon: <Truck size={16}/> },
    { path: '#logout', labelKey: 'common.logout', icon: <LogOut size={16}/>, onClick: logout }
  ];

  const getNav = () => {
    if (user?.role === 'material_planner' || user?.role === 'warehouse_manager') return matPlannerNav;
    return plannerNav;
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar items={getNav()} />
      <main className="flex-1 p-10 overflow-auto space-y-8">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="font-display text-3xl text-foreground flex items-center gap-3">
            <Truck className="text-blue-500" size={32} /> Nomenclator Furnizori
          </h2>
          <p className="text-muted-foreground mt-2">Gestionează partenerii externi și datele lor de contact.</p>
        </div>
        <div className="flex gap-4">
          <div className="relative">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
             <Input 
                className="pl-10 w-64 bg-white" 
                placeholder="Caută furnizor..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
             />
          </div>
          <Button onClick={() => { setEditingSupplier(null); setShowModal(true); }}>
            <Plus size={16} className="mr-2" /> Furnizor Nou
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
                    {sup.active ? 'Activ' : 'Inactiv'}
                  </Badge>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setSupplierForItems(sup)}>
                  <Package size={16} className="mr-2" /> Materiale ({sup.items?.length || 0})
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
               <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Persoană Contact:</span>
               <span className="text-sm font-bold">{sup.contact_person || 'Nespecificat'}</span>
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
  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    email: '',
    phone: '',
    address: '',
    active: 1
  });

  useEffect(() => {
    if (supplier) setFormData(supplier);
  }, [supplier]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (supplier) await api.put(`/suppliers/${supplier.id}`, formData);
      else await api.post('/suppliers', formData);
      toast.success('Furnizor salvat cu succes');
      onSave();
    } catch (err) {
      toast.error('Eroare la salvare');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 w-full max-w-md border border-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl mb-6">{supplier ? 'Editează Furnizor' : 'Furnizor Nou'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">Nume Companie</label>
            <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">Persoană Contact</label>
            <Input value={formData.contact_person} onChange={e => setFormData({...formData, contact_person: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Telefon</label>
              <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Email</label>
              <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">Adresă</label>
            <Input value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={!!formData.active} onChange={e => setFormData({...formData, active: e.target.checked ? 1 : 0})} />
            <label className="text-xs font-bold uppercase text-muted-foreground">Activ</label>
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Anulează</Button>
            <Button type="submit">Salvează</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function SupplierItemsModal({ supplier, onClose, onSave }) {
  const [items, setItems] = useState([]);
  const [formData, setFormData] = useState({
    item_id: '',
    purchase_price: 0,
    currency: 'RON',
    lead_time_days: 0
  });

  useEffect(() => {
    api.get('/items').then(res => setItems(res.data.filter(i => i.type === 'raw_material' || i.type === 'semi_finished')));
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!formData.item_id) return toast.error('Selectează un material');
    try {
      await api.post('/suppliers/item', { ...formData, supplier_id: supplier.id });
      toast.success('Material adăugat la furnizor');
      setFormData({ item_id: '', purchase_price: 0, currency: 'RON', lead_time_days: 0 });
      onSave();
    } catch (err) {
      toast.error('Eroare la asociere material');
    }
  };

  const handleRemove = async (itemId) => {
    if (!window.confirm('Sigur vrei să ștergi asocierea?')) return;
    try {
      await api.delete(`/suppliers/item/${itemId}/${supplier.id}`);
      toast.success('Asociere ștearsă');
      onSave();
    } catch (err) {
      toast.error('Eroare la ștergere');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 w-full max-w-3xl border border-border shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="font-display text-2xl flex items-center gap-2"><Package className="text-blue-600" /> Materiale Furnizor</h3>
            <p className="text-muted-foreground text-sm mt-1">Ce coduri de materiale primim de la <span className="font-bold text-foreground">{supplier.name}</span></p>
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
                      <span className="flex items-center gap-1">Preț achiziție: <strong className="text-foreground">{it.purchase_price} {it.currency}</strong></span>
                      <span className="flex items-center gap-1">Timp livrare: <strong className="text-foreground">{it.lead_time_days} zile</strong></span>
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleRemove(it.item_id)} className="text-red-500 hover:text-red-700 hover:bg-red-50" title="Șterge asociere">
                  <Trash2 size={18} />
                </Button>
              </div>
            ))
          ) : (
            <div className="text-center py-10 text-muted-foreground bg-muted/10 rounded-2xl border border-dashed border-border flex flex-col items-center justify-center gap-2">
              <Package size={32} className="text-muted-foreground/30" />
              <p>Niciun material asociat acestui furnizor.</p>
              <p className="text-xs italic">Adaugă materiale folosind formularul de mai jos.</p>
            </div>
          )}
        </div>

        <form onSubmit={handleAdd} className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex flex-col gap-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-500"></div>
          <h4 className="text-xs font-black uppercase tracking-widest text-blue-800 flex items-center gap-2"><Plus size={14} /> Adaugă Material Nou</h4>
          <div className="grid grid-cols-12 gap-4 items-end">
            <div className="col-span-5 space-y-1">
              <label className="text-[10px] font-bold uppercase text-blue-700">Material Nomenclator</label>
              <select className="w-full h-10 rounded-lg border border-blue-200 px-3 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={formData.item_id} onChange={e => setFormData({...formData, item_id: e.target.value})} required>
                <option value="">Selectează un material...</option>
                {items.filter(i => !(supplier.items || []).find(si => si.item_id === i.id)).map(i => (
                  <option key={i.id} value={i.id}>{i.item_code} - {i.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3 space-y-1">
              <label className="text-[10px] font-bold uppercase text-blue-700">Preț Achiziție</label>
              <div className="flex">
                <input type="number" step="0.01" className="w-full h-10 rounded-l-lg border border-blue-200 border-r-0 px-3 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:z-10 outline-none" value={formData.purchase_price} onChange={e => setFormData({...formData, purchase_price: parseFloat(e.target.value)})} required />
                <select className="h-10 rounded-r-lg border border-blue-200 px-2 text-xs font-bold bg-blue-100/50 text-blue-800 focus:ring-2 focus:ring-blue-500 outline-none" value={formData.currency} onChange={e => setFormData({...formData, currency: e.target.value})}>
                  <option value="RON">RON</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-bold uppercase text-blue-700">Lead Time</label>
              <div className="relative">
                <input type="number" className="w-full h-10 rounded-lg border border-blue-200 px-3 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={formData.lead_time_days} onChange={e => setFormData({...formData, lead_time_days: parseInt(e.target.value) || 0})} required />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">zile</span>
              </div>
            </div>
            <div className="col-span-2">
              <Button type="submit" className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20"><Save size={16} className="mr-1"/> Salvează</Button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
