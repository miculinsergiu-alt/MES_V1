import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, Plus, Search, Edit2, Phone, Mail, MapPin, CheckCircle, XCircle } from 'lucide-react';
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
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);

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
    s.contact_person?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
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
              <Button variant="ghost" size="sm" onClick={() => { setEditingSupplier(sup); setShowModal(true); }}>
                <Edit2 size={16} />
              </Button>
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
      </AnimatePresence>
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
