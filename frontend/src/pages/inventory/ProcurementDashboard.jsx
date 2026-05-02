import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, PackageCheck, Truck, Plus, Search, FileText, CheckCircle, AlertTriangle, QrCode, X, Trash2, Zap } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';

export default function ProcurementDashboard() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('pos'); // 'pos', 'recommendations'
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [showPOModal, setShowPOModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [selectedPO, setSelectedPO] = useState(null);
  const [selectedRec, setSelectedRec] = useState(null);

  const loadPOs = useCallback(async () => {
    try {
      const res = await api.get('/procurement/purchase-orders');
      setPurchaseOrders(res.data);
    } catch (err) {
      toast.error('Eroare la încărcarea comenzilor de achiziție');
    }
  }, []);

  const loadRecommendations = useCallback(async () => {
    try {
      const res = await api.get('/procurement/recommendations');
      setRecommendations(res.data);
    } catch (err) {
      toast.error('Eroare la încărcarea recomandărilor MRP');
    }
  }, []);

  useEffect(() => { 
    setLoading(true);
    Promise.all([loadPOs(), loadRecommendations()]).finally(() => setLoading(false)); 
  }, [loadPOs, loadRecommendations]);

  return (
    <div className="space-y-8">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="font-display text-3xl text-foreground">Aprovizionare & Recepție Marfă</h2>
          <p className="text-muted-foreground">Gestionează comenzile către furnizori și recomandările MRP.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowReceiptModal(true)}>
            <PackageCheck size={16} className="mr-2" /> Recepție Nouă
          </Button>
          <Button onClick={() => setShowPOModal(true)}>
            <Plus size={16} className="mr-2" /> Comandă Achiziție (PO)
          </Button>
        </div>
      </header>

      <div className="flex gap-4 border-b border-border">
        <button 
          className={`pb-4 px-2 font-bold uppercase tracking-widest text-sm transition-all ${activeTab === 'pos' ? 'text-accent border-b-2 border-accent' : 'text-muted-foreground'}`}
          onClick={() => setActiveTab('pos')}
        >
          Comenzi Active (PO)
        </button>
        <button 
          className={`pb-4 px-2 font-bold uppercase tracking-widest text-sm transition-all flex items-center gap-2 ${activeTab === 'recommendations' ? 'text-accent border-b-2 border-accent' : 'text-muted-foreground'}`}
          onClick={() => setActiveTab('recommendations')}
        >
          Recomandări MRP 
          {recommendations.length > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">{recommendations.length}</span>}
        </button>
      </div>

      {activeTab === 'pos' && (
        <div className="grid grid-cols-1 gap-4">
          {purchaseOrders.map(po => (
            <Card key={po.id} className="p-6 flex justify-between items-center group hover:border-accent/50 transition-all">
              <div className="flex items-center gap-6">
                <div className="p-3 bg-muted rounded-2xl group-hover:bg-accent/10 transition-colors">
                  <ShoppingCart size={24} className="text-muted-foreground group-hover:text-accent" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-lg">PO #{po.id.toString().padStart(5, '0')}</h4>
                    <Badge className={
                      po.status === 'received' ? 'bg-green-100 text-green-700' :
                      po.status === 'partial' ? 'bg-orange-100 text-orange-700' :
                      'bg-blue-100 text-blue-700'
                    }>
                      {po.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Furnizor: <span className="font-bold text-foreground">{po.supplier_name}</span></p>
                  <p className="text-[10px] uppercase font-black text-muted-foreground mt-1">Data estimată: {po.expected_date}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="ghost" size="sm" onClick={() => { setSelectedPO(po); setShowReceiptModal(true); }}>
                  <PackageCheck size={16} className="mr-2" /> Procesează Recepție
                </Button>
              </div>
            </Card>
          ))}
          {purchaseOrders.length === 0 && !loading && (
            <div className="py-20 text-center italic text-muted-foreground bg-muted/10 rounded-3xl border border-dashed border-border">
              Nicio comandă de achiziție activă.
            </div>
          )}
        </div>
      )}

      {activeTab === 'recommendations' && (
        <div className="grid grid-cols-1 gap-4">
          {recommendations.map(rec => (
            <Card key={rec.id} className="p-6 flex justify-between items-center border-orange-200 bg-orange-50/30">
              <div className="flex items-center gap-6">
                <div className="p-3 bg-orange-100 text-orange-600 rounded-2xl">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-black text-orange-600 uppercase tracking-widest">{rec.item_code}</span>
                    <h4 className="font-bold text-lg">{rec.item_name}</h4>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Necesar: <span className="font-bold text-foreground">{rec.recommended_qty} {rec.uom}</span></p>
                  <p className="text-[10px] uppercase font-black text-muted-foreground mt-1">Cauzată de: {rec.triggering_order_name || 'Comandă necunoscută'}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button onClick={() => { setSelectedRec(rec); setShowConvertModal(true); }} className="bg-orange-600 hover:bg-orange-700 text-white">
                  <Zap size={16} className="mr-2" /> Transformă în PO
                </Button>
              </div>
            </Card>
          ))}
          {recommendations.length === 0 && !loading && (
            <div className="py-20 text-center text-green-700 bg-green-50 rounded-3xl border border-green-200 flex flex-col items-center justify-center gap-2">
              <CheckCircle size={32} />
              <p className="font-bold">Stoc suficient</p>
              <p className="text-sm italic">Nu există nicio recomandare activă generată de MRP.</p>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {showPOModal && <POModal onClose={() => setShowPOModal(false)} onSave={() => { setShowPOModal(false); loadPOs(); }} />}
        {showReceiptModal && (
          <ReceiptModal 
            po={selectedPO} 
            onClose={() => { setShowReceiptModal(false); setSelectedPO(null); }} 
            onSave={() => { setShowReceiptModal(false); setSelectedPO(null); loadPOs(); }} 
          />
        )}
        {showConvertModal && selectedRec && (
          <ConvertModal 
            rec={selectedRec} 
            onClose={() => { setShowConvertModal(false); setSelectedRec(null); }} 
            onSave={() => { setShowConvertModal(false); setSelectedRec(null); loadRecommendations(); loadPOs(); setActiveTab('pos'); }} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ConvertModal({ rec, onClose, onSave }) {
  const [suppliers, setSuppliers] = useState([]);
  const [formData, setFormData] = useState({
    supplier_id: '',
    expected_date: ''
  });

  useEffect(() => {
    api.get('/suppliers').then(res => setSuppliers(res.data));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/procurement/recommendations/${rec.id}/convert`, formData);
      toast.success('Recomandare convertită cu succes!');
      onSave();
    } catch (err) {
      toast.error('Eroare la conversia recomandării');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 w-full max-w-md border border-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl mb-2">Transformă în PO</h3>
        <p className="text-sm text-muted-foreground mb-6">Comanzi <span className="font-bold text-foreground">{rec.recommended_qty} {rec.uom}</span> de <span className="font-bold text-foreground">{rec.item_name}</span></p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">Selectează Furnizorul</label>
            <select className="w-full h-11 rounded-xl border border-border px-3 bg-white" value={formData.supplier_id} onChange={e => setFormData({...formData, supplier_id: e.target.value})} required>
              <option value="">— Alege Furnizor —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-muted-foreground">Data Estimată a Livrării</label>
            <Input type="date" value={formData.expected_date} onChange={e => setFormData({...formData, expected_date: e.target.value})} required />
          </div>

          <div className="pt-6 flex justify-end gap-3 border-t">
            <Button variant="secondary" onClick={onClose}>Anulează</Button>
            <Button type="submit" className="bg-orange-600 hover:bg-orange-700 text-white">Generează PO</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function POModal({ onClose, onSave }) {
  const [suppliers, setSuppliers] = useState([]);
  const [items, setItems] = useState([]);
  const [formData, setFormData] = useState({
    supplier_id: '',
    expected_date: '',
    items: []
  });

  useEffect(() => {
    api.get('/suppliers').then(res => setSuppliers(res.data));
    api.get('/items').then(res => setItems(res.data.filter(i => i.type === 'raw_material')));
  }, []);

  const addItem = () => {
    setFormData({ ...formData, items: [...formData.items, { item_id: '', quantity_ordered: 0, unit_price: 0 }] });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/procurement/purchase-orders', { ...formData, created_by: 1 }); // Hardcoded for demo
      toast.success('PO creat cu succes');
      onSave();
    } catch (err) {
      toast.error('Eroare la creare PO');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 w-full max-w-4xl border border-border shadow-2xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl mb-6">Comandă Achiziție Nouă</h3>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Furnizor</label>
              <select className="w-full h-11 rounded-xl border border-border px-3 bg-white" value={formData.supplier_id} onChange={e => setFormData({...formData, supplier_id: e.target.value})} required>
                <option value="">Selectează Furnizor</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Data Estimată Recepție</label>
              <Input type="date" value={formData.expected_date} onChange={e => setFormData({...formData, expected_date: e.target.value})} required />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center border-b pb-2">
              <h4 className="font-bold uppercase tracking-widest text-xs">Produse Comandate</h4>
              <Button type="button" variant="secondary" size="sm" onClick={addItem}><Plus size={14} className="mr-1"/> Adaugă Produs</Button>
            </div>
            {formData.items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-3 items-end">
                <div className="col-span-6">
                  <select className="w-full h-10 rounded-lg border border-border px-3 text-sm" value={it.item_id} onChange={e => {
                    const newItems = [...formData.items];
                    newItems[idx].item_id = e.target.value;
                    setFormData({...formData, items: newItems});
                  }}>
                    <option value="">Selectează Material</option>
                    {items.map(i => <option key={i.id} value={i.id}>{i.item_code} - {i.name}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <Input type="number" placeholder="Cantitate" value={it.quantity_ordered} onChange={e => {
                    const newItems = [...formData.items];
                    newItems[idx].quantity_ordered = parseFloat(e.target.value);
                    setFormData({...formData, items: newItems});
                  }} />
                </div>
                <div className="col-span-3">
                  <Input type="number" step="0.01" placeholder="Preț Unitar" value={it.unit_price} onChange={e => {
                    const newItems = [...formData.items];
                    newItems[idx].unit_price = parseFloat(e.target.value);
                    setFormData({...formData, items: newItems});
                  }} />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-6 flex justify-end gap-3 border-t">
            <Button variant="secondary" onClick={onClose}>Anulează</Button>
            <Button type="submit">Creează Comandă</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function ReceiptModal({ po, onClose, onSave }) {
  const [locations, setLocations] = useState([]);
  const [allPos, setAllPos] = useState([]);
  const [formData, setFormData] = useState({
    po_id: po?.id || '',
    document_reference: '',
    notes: '',
    items: [] // This will store { item_id, name, item_code, quantity_ordered, packages: [...] }
  });

  useEffect(() => {
    api.get('/warehousing/warehouses').then(async res => {
      const allLocs = [];
      for (const wh of res.data) {
        const locs = await api.get(`/warehousing/locations/${wh.id}`);
        allLocs.push(...locs.data.map(l => ({ ...l, whName: wh.name })));
      }
      setLocations(allLocs);
    });

    if (!po) {
      api.get('/procurement/purchase-orders').then(res => {
        setAllPos(res.data.filter(p => p.status !== 'received'));
      });
    }
  }, [po]);

  useEffect(() => {
    if (formData.po_id) {
      api.get(`/procurement/purchase-orders/${formData.po_id}/items`).then(res => {
        setFormData(prev => ({
          ...prev,
          items: res.data.map(i => ({
            item_id: i.item_id,
            name: i.name,
            item_code: i.item_code,
            quantity_ordered: i.quantity_ordered,
            remaining_to_receive: i.quantity_ordered - i.quantity_received,
            packages: [
              {
                lot_number: '',
                quantity_received: i.quantity_ordered - i.quantity_received,
                location_id: '',
                quality_status: 'ok'
              }
            ]
          }))
        }));
      });
    }
  }, [formData.po_id]);

  const addPackage = (itemIdx) => {
    const newItems = [...formData.items];
    newItems[itemIdx].packages.push({
      lot_number: '',
      quantity_received: 0,
      location_id: '',
      quality_status: 'ok'
    });
    setFormData({ ...formData, items: newItems });
  };

  const removePackage = (itemIdx, pkgIdx) => {
    const newItems = [...formData.items];
    newItems[itemIdx].packages.splice(pkgIdx, 1);
    setFormData({ ...formData, items: newItems });
  };

  const updatePackage = (itemIdx, pkgIdx, field, value) => {
    const newItems = [...formData.items];
    newItems[itemIdx].packages[pkgIdx][field] = value;
    setFormData({ ...formData, items: newItems });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Flatten packages into a single items array for the backend
    const flattenedItems = [];
    formData.items.forEach(item => {
      item.packages.forEach(pkg => {
        if (pkg.quantity_received > 0) {
          flattenedItems.push({
            item_id: item.item_id,
            lot_number: pkg.lot_number,
            quantity_received: pkg.quantity_received,
            location_id: pkg.location_id,
            quality_status: pkg.quality_status
          });
        }
      });
    });

    if (flattenedItems.length === 0) {
      toast.error('Adăugați cel puțin o cantitate primită validă.');
      return;
    }

    try {
      await api.post('/procurement/receipts', { 
        po_id: formData.po_id,
        document_reference: formData.document_reference,
        notes: formData.notes,
        items: flattenedItems,
        received_by: 1 
      });
      toast.success('Recepție finalizată cu succes. Stocul a fost actualizat.');
      onSave();
    } catch (err) {
      toast.error('Eroare la procesarea recepției');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 w-full max-w-6xl border border-border shadow-2xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-8">
          <div>
            <h3 className="font-display text-2xl uppercase tracking-tighter">Recepție Marfă {po ? `(PO #${po.id})` : ''}</h3>
            <p className="text-muted-foreground italic text-sm">Înregistrează materialele primite, loturile și locațiile de depozitare.</p>
          </div>
          <Button variant="ghost" onClick={onClose}><X size={20}/></Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {!po && (
            <div className="bg-accent/5 p-6 rounded-2xl border border-accent/20">
              <label className="text-xs font-bold uppercase text-accent mb-2 block">Selectează Comandă de Achiziție (PO) pentru recepție</label>
              <select 
                className="w-full h-12 rounded-xl border border-accent/30 px-4 bg-white font-bold text-accent outline-none focus:ring-2 focus:ring-accent"
                value={formData.po_id}
                onChange={e => setFormData({...formData, po_id: e.target.value})}
                required
              >
                <option value="">— Alege un PO Activ —</option>
                {allPos.map(p => <option key={p.id} value={p.id}>PO #{p.id.toString().padStart(5, '0')} - {p.supplier_name}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6 bg-muted/20 p-6 rounded-2xl border border-border/50">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Referință Document (Aviz/Factură)</label>
              <Input value={formData.document_reference} onChange={e => setFormData({...formData, document_reference: e.target.value})} required placeholder="ex: AV-12345" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Note Recepție</label>
              <Input value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="ex: Marfă descărcată în rampa 2" />
            </div>
          </div>

          <div className="space-y-10">
            {formData.items.map((item, itemIdx) => (
              <div key={itemIdx} className="space-y-4">
                <div className="flex justify-between items-end border-b border-border pb-2">
                  <div>
                    <span className="font-mono text-[10px] font-black text-accent uppercase tracking-widest">{item.item_code}</span>
                    <h4 className="font-bold text-lg">{item.name}</h4>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">Comandat</p>
                      <p className="font-bold">{item.quantity_ordered} buc</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">Rest de primit</p>
                      <p className="font-bold text-accent">{item.remaining_to_receive} buc</p>
                    </div>
                    <Button type="button" variant="secondary" size="sm" onClick={() => addPackage(itemIdx)}>
                       <Plus size={14} className="mr-1" /> Adaugă Cutie/Lot
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  {item.packages.map((pkg, pkgIdx) => (
                    <div key={pkgIdx} className="grid grid-cols-12 gap-3 items-end bg-white p-4 rounded-xl border border-border/60 shadow-sm hover:border-accent/30 transition-all">
                      <div className="col-span-3 space-y-1">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground">Număr Lot / Barcode Cutie</label>
                        <div className="relative">
                          <Input 
                            value={pkg.lot_number} 
                            onChange={e => updatePackage(itemIdx, pkgIdx, 'lot_number', e.target.value.toUpperCase())} 
                            required 
                            placeholder="LOT-XXXX sau Scan" 
                            className="pr-10"
                          />
                          <QrCode size={16} className="absolute right-3 top-3 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground">Cantitate</label>
                        <Input 
                          type="number" 
                          value={pkg.quantity_received} 
                          onChange={e => updatePackage(itemIdx, pkgIdx, 'quantity_received', parseFloat(e.target.value))} 
                          required 
                        />
                      </div>
                      <div className="col-span-3 space-y-1">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground">Locație</label>
                        <select 
                          className="w-full h-10 rounded-lg border border-border px-3 text-sm" 
                          value={pkg.location_id} 
                          onChange={e => updatePackage(itemIdx, pkgIdx, 'location_id', e.target.value)} 
                          required
                        >
                          <option value="">— Selectează Locație —</option>
                          {locations.map(l => <option key={l.id} value={l.id}>{l.whName} - {l.barcode}</option>)}
                        </select>
                      </div>
                      <div className="col-span-3 space-y-1">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground">Calitate</label>
                        <select 
                          className={`w-full h-10 rounded-lg border px-3 text-sm font-bold ${pkg.quality_status === 'ok' ? 'border-green-200 text-green-700 bg-green-50' : 'border-orange-200 text-orange-700 bg-orange-50'}`} 
                          value={pkg.quality_status} 
                          onChange={e => updatePackage(itemIdx, pkgIdx, 'quality_status', e.target.value)}
                        >
                          <option value="ok">Conform (OK)</option>
                          <option value="quarantine">Carantină</option>
                        </select>
                      </div>
                      <div className="col-span-1 pb-1">
                        {item.packages.length > 1 && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => removePackage(itemIdx, pkgIdx)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                            <X size={16} />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  <div className="flex justify-end p-2 text-[11px] font-bold text-muted-foreground bg-muted/10 rounded-lg">
                    Total Recepționat pentru {item.item_code}: {item.packages.reduce((sum, p) => sum + (p.quantity_received || 0), 0)} buc
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-6 flex justify-end gap-3 border-t">
            <Button variant="secondary" onClick={onClose}>Anulează</Button>
            <Button type="submit" className="bg-green-600 hover:bg-green-700">
               <PackageCheck size={18} className="mr-2" /> Finalizează Recepție
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
