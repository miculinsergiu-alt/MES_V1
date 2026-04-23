import { useState, useEffect, useCallback } from 'react';
import { Box, Plus, Search, Edit2, Trash2, X, Factory, Clock, DollarSign, List, FileText, ChevronRight, Printer } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function ItemsManager() {
  const [activeTab, setActiveTab] = useState('items'); // 'items' or 'boms'
  const [items, setItems] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
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
      toast.error('Eroare la încărcarea datelor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const navItems = [
    { path:'/planner/gantt', label:'Plan Producție', icon:<Clock size={16}/> },
    { path:'/planner/orders', label:'Gestionare Comenzi', icon:<FileText size={16}/> },
    { path:'/planner/items', label:'Nomenclator & BOM', icon:<Box size={16}/> },
  ];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <div className="flex justify-between items-center w-full">
            <div>
              <h1>Gestiune Nomenclator & BOM</h1>
              <p>Administrare articole, rute de producție și rețete (BOM)</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="search-box" style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-primary)', padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <Search size={18} style={{ marginRight: 8, color: 'var(--text-muted)' }} />
                <input 
                  type="text" 
                  placeholder="Caută cod sau denumire..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ border: 'none', background: 'transparent', outline: 'none', width: '200px' }}
                />
              </div>
              {activeTab === 'items' ? (
                <button className="btn btn-primary" onClick={() => { setEditingItem(null); setShowItemModal(true); }}>
                  <Plus size={16} /> Articol Nou
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => { setEditingBOM(null); setShowBOMModal(true); }}>
                  <Plus size={16} /> BOM Nou
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="page-content">

        <div className="tabs" style={{ marginBottom: 20 }}>
          <button 
            className={`tab-btn ${activeTab === 'items' ? 'active' : ''}`}
            onClick={() => setActiveTab('items')}
          >
            <List size={16} /> Nomenclator Articole
          </button>
          <button 
            className={`tab-btn ${activeTab === 'boms' ? 'active' : ''}`}
            onClick={() => setActiveTab('boms')}
          >
            <Box size={16} /> Bill of Materials (BOM)
          </button>
        </div>

        {activeTab === 'items' ? (
          <ItemsList 
            items={items.filter(i => i.item_code.toLowerCase().includes(searchTerm.toLowerCase()) || i.name.toLowerCase().includes(searchTerm.toLowerCase()))} 
            onEdit={(item) => { setEditingItem(item); setShowItemModal(true); }}
            loading={loading}
          />
        ) : (
          <BOMList 
            searchTerm={searchTerm}
            onEdit={(bom) => { setEditingBOM(bom); setShowBOMModal(true); }}
            onPrint={(bom) => setShowPrintPreview(bom)}
          />
        )}

        </div>

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
      </div>
    </div>
  );
}

function ItemsList({ items, onEdit, loading }) {
  if (loading) return <div className="p-8 text-center">Se încarcă...</div>;
  
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Cod Articol</th>
            <th>Denumire</th>
            <th>Tip</th>
            <th>U.M.</th>
            <th>Cost Achiziție</th>
            <th>Cost Producție</th>
            <th>Timp (min)</th>
            <th>Acțiuni</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id}>
              <td><span className="font-mono font-bold">{item.item_code}</span></td>
              <td>{item.name}</td>
              <td>
                <span className={`badge ${item.type === 'raw_material' ? 'badge-gray' : item.type === 'semi_finished' ? 'badge-blue' : 'badge-green'}`}>
                  {item.type === 'raw_material' ? 'Materie Primă' : item.type === 'semi_finished' ? 'Semifabricat' : 'Produs Finit'}
                </span>
              </td>
              <td>{item.uom}</td>
              <td>{item.acquisition_cost?.toFixed(2)}</td>
              <td>{item.production_cost?.toFixed(2)}</td>
              <td>{item.production_time_min}</td>
              <td>
                <div className="flex gap-2">
                  <button className="btn btn-icon btn-ghost" onClick={() => onEdit(item)}><Edit2 size={14}/></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemModal({ item, machines, onClose, onSave }) {
  const [formData, setFormData] = useState(item || {
    item_code: '',
    name: '',
    type: 'raw_material',
    uom: 'buc',
    acquisition_cost: 0,
    production_cost: 0,
    production_time_min: 0,
    routes: []
  });

  useEffect(() => {
    if (item?.id) {
      api.get(`/items/${item.id}`).then(res => {
        setFormData(res.data);
      });
    }
  }, [item]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (item) await api.put(`/items/${item.id}`, formData);
      else await api.post('/items', formData);
      toast.success('Salvat cu succes');
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Eroare la salvare');
    }
  };

  const addRoute = () => {
    setFormData({ ...formData, routes: [...formData.routes, { machine_id: machines[0]?.id, process_time_min: 0, notes: '' }] });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 800 }}>
        <div className="modal-header">
          <h2>{item ? 'Editare Articol' : 'Articol Nou'}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><X size={18}/></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="grid grid-2">
              <div className="form-group">
                <label>Cod Articol</label>
                <input 
                  type="text" 
                  value={formData.item_code} 
                  disabled={!!item}
                  onChange={e => setFormData({...formData, item_code: e.target.value})} 
                  required 
                />
              </div>
              <div className="form-group">
                <label>Denumire</label>
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  required 
                />
              </div>
              <div className="form-group">
                <label>Tip</label>
                <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                  <option value="raw_material">Materie Primă</option>
                  <option value="semi_finished">Semifabricat</option>
                  <option value="finished_good">Produs Finit</option>
                </select>
              </div>
              <div className="form-group">
                <label>Unitate de Măsură</label>
                <input type="text" value={formData.uom} onChange={e => setFormData({...formData, uom: e.target.value})} />
              </div>
            </div>

            <div className="grid grid-3" style={{ marginTop: 15 }}>
              <div className="form-group">
                <label>Cost Achiziție</label>
                <div className="input-with-icon">
                  <DollarSign size={14} />
                  <input type="number" step="0.01" value={formData.acquisition_cost} onChange={e => setFormData({...formData, acquisition_cost: parseFloat(e.target.value)})} />
                </div>
              </div>
              <div className="form-group">
                <label>Cost Producție</label>
                <div className="input-with-icon">
                  <DollarSign size={14} />
                  <input type="number" step="0.01" value={formData.production_cost} onChange={e => setFormData({...formData, production_cost: parseFloat(e.target.value)})} />
                </div>
              </div>
              <div className="form-group">
                <label>Timp Producție (min)</label>
                <div className="input-with-icon">
                  <Clock size={14} />
                  <input type="number" value={formData.production_time_min} onChange={e => setFormData({...formData, production_time_min: parseInt(e.target.value)})} />
                </div>
              </div>
            </div>

            {formData.type !== 'raw_material' && (
              <div style={{ marginTop: 20 }}>
                <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
                  <label style={{ fontWeight: 'bold' }}>Rută Producție</label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addRoute}><Plus size={14}/> Adaugă Pas</button>
                </div>
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th width="50">Ord.</th>
                      <th>Utilaj</th>
                      <th width="100">Timp (min)</th>
                      <th>Note</th>
                      <th width="40"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.routes.map((r, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>
                          <select 
                            value={r.machine_id} 
                            onChange={e => {
                              const newRoutes = [...formData.routes];
                              newRoutes[i].machine_id = parseInt(e.target.value);
                              setFormData({...formData, routes: newRoutes});
                            }}
                          >
                            {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <input 
                            type="number" 
                            value={r.process_time_min} 
                            onChange={e => {
                              const newRoutes = [...formData.routes];
                              newRoutes[i].process_time_min = parseInt(e.target.value);
                              setFormData({...formData, routes: newRoutes});
                            }}
                          />
                        </td>
                        <td>
                          <input 
                            type="text" 
                            value={r.notes} 
                            onChange={e => {
                              const newRoutes = [...formData.routes];
                              newRoutes[i].notes = e.target.value;
                              setFormData({...formData, routes: newRoutes});
                            }}
                          />
                        </td>
                        <td>
                          <button 
                            type="button" 
                            className="btn btn-icon btn-ghost btn-sm text-red"
                            onClick={() => {
                              const newRoutes = formData.routes.filter((_, idx) => idx !== i);
                              setFormData({...formData, routes: newRoutes});
                            }}
                          >
                            <Trash2 size={14}/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulează</button>
            <button type="submit" className="btn btn-primary">Salvează Articol</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BOMList({ searchTerm, onEdit, onPrint }) {
  const [boms, setBoms] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadBoms = useCallback(async () => {
    try {
      const res = await api.get('/boms');
      setBoms(res.data);
    } catch (err) {
      toast.error('Eroare la încărcarea BOM-urilor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBoms(); }, [loadBoms]);

  const filtered = boms.filter(b => 
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    b.parent_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.parent_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="p-8 text-center">Se încarcă BOM-urile...</div>;

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Nume BOM</th>
            <th>Articol Părinte</th>
            <th>Descriere</th>
            <th>Data Creare</th>
            <th>Acțiuni</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(bom => (
            <tr key={bom.id}>
              <td><strong>{bom.name}</strong></td>
              <td>
                {bom.parent_code ? (
                  <div className="flex flex-col">
                    <span className="font-mono text-sm">{bom.parent_code}</span>
                    <span className="text-xs text-muted">{bom.parent_name}</span>
                  </div>
                ) : 'Nespecificat'}
              </td>
              <td>{bom.description}</td>
              <td>{format(new Date(bom.created_at), 'dd.MM.yyyy HH:mm')}</td>
              <td>
                <div className="flex gap-2">
                  <button className="btn btn-icon btn-ghost" onClick={() => onEdit(bom)} title="Editează"><Edit2 size={14}/></button>
                  <button className="btn btn-icon btn-ghost" onClick={() => onPrint(bom)} title="Printează"><Printer size={14}/></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BOMModal({ bom, items, onClose, onSave }) {
  const [formData, setFormData] = useState({
    name: '',
    parent_item_id: '',
    description: '',
    positions: []
  });
  const [requirements, setRequirements] = useState([]);

  useEffect(() => {
    api.get('/boms/requirements').then(res => setRequirements(res.data));
    if (bom?.id) {
      api.get(`/boms/${bom.id}`).then(res => setFormData(res.data));
    }
  }, [bom]);

  const addPosition = () => {
    setFormData({
      ...formData,
      positions: [...formData.positions, {
        item_id: items[0]?.id,
        position_code: `${(formData.positions.length + 1) * 10}/1`,
        quantity: 1,
        start_date: '',
        finish_date: '',
        location: 'WH1',
        requirement_id: null
      }]
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (bom) await api.put(`/boms/${bom.id}`, formData);
      else await api.post('/boms', formData);
      toast.success('BOM salvat');
      onSave();
    } catch (err) {
      toast.error('Eroare la salvare BOM');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 1000, width: '95%' }}>
        <div className="modal-header">
          <h2>{bom ? 'Editare BOM' : 'Creare BOM Nou'}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><X size={18}/></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="grid grid-2">
              <div className="form-group">
                <label>Nume BOM</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Articol Părinte (opțional)</label>
                <select value={formData.parent_item_id || ''} onChange={e => setFormData({...formData, parent_item_id: e.target.value})}>
                  <option value="">Nespecificat</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.item_code} - {i.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Descriere</label>
              <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} rows="2" />
            </div>

            <div style={{ marginTop: 20 }}>
              <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
                <label style={{ fontWeight: 'bold' }}>Componente (Poziții)</label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addPosition}><Plus size={14}/> Adaugă Poziție</button>
              </div>
              <div className="table-responsive">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th width="80">Poz.</th>
                      <th width="200">Articol</th>
                      <th width="80">Cant.</th>
                      <th width="120">Start</th>
                      <th width="120">Finish</th>
                      <th width="100">Locație</th>
                      <th width="150">Requirement</th>
                      <th width="40"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.positions.map((p, i) => (
                      <tr key={i}>
                        <td>
                          <input type="text" value={p.position_code} onChange={e => {
                            const newPos = [...formData.positions];
                            newPos[i].position_code = e.target.value;
                            setFormData({...formData, positions: newPos});
                          }} />
                        </td>
                        <td>
                          <select value={p.item_id} onChange={e => {
                            const newPos = [...formData.positions];
                            newPos[i].item_id = parseInt(e.target.value);
                            setFormData({...formData, positions: newPos});
                          }}>
                            {items.map(item => <option key={item.id} value={item.id}>{item.item_code} - {item.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <input type="number" step="0.001" value={p.quantity} onChange={e => {
                            const newPos = [...formData.positions];
                            newPos[i].quantity = parseFloat(e.target.value);
                            setFormData({...formData, positions: newPos});
                          }} />
                        </td>
                        <td>
                          <input type="date" value={p.start_date || ''} onChange={e => {
                            const newPos = [...formData.positions];
                            newPos[i].start_date = e.target.value;
                            setFormData({...formData, positions: newPos});
                          }} />
                        </td>
                        <td>
                          <input type="date" value={p.finish_date || ''} onChange={e => {
                            const newPos = [...formData.positions];
                            newPos[i].finish_date = e.target.value;
                            setFormData({...formData, positions: newPos});
                          }} />
                        </td>
                        <td>
                          <input type="text" value={p.location || ''} onChange={e => {
                            const newPos = [...formData.positions];
                            newPos[i].location = e.target.value;
                            setFormData({...formData, positions: newPos});
                          }} />
                        </td>
                        <td>
                          <select value={p.requirement_id || ''} onChange={e => {
                            const newPos = [...formData.positions];
                            newPos[i].requirement_id = e.target.value ? parseInt(e.target.value) : null;
                            setFormData({...formData, positions: newPos});
                          }}>
                            <option value="">Niciunul</option>
                            {requirements.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <button type="button" className="btn btn-icon btn-ghost btn-sm text-red" onClick={() => {
                            const newPos = formData.positions.filter((_, idx) => idx !== i);
                            setFormData({...formData, positions: newPos});
                          }}>
                            <Trash2 size={14}/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulează</button>
            <button type="submit" className="btn btn-primary">Salvează BOM</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PrintPreview({ bom, onClose }) {
  const [details, setDetails] = useState(null);

  useEffect(() => {
    api.get(`/boms/${bom.id}`).then(res => setDetails(res.data));
  }, [bom]);

  if (!details) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-overlay print-overlay">
      <div className="modal-content print-container" style={{ maxWidth: 900 }}>
        <div className="modal-header no-print">
          <h2>Previzualizare BOM</h2>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={handlePrint}><Printer size={18} /> Printează</button>
            <button className="btn btn-icon btn-ghost" onClick={onClose}><X size={18}/></button>
          </div>
        </div>
        <div className="print-content" id="printable-bom">
          <div className="print-header">
            <div className="print-logo">SmartFactory Flow MES</div>
            <div className="print-title">
              <h1>BILL OF MATERIALS (BOM)</h1>
              <p>Raport Generat la: {format(new Date(), 'dd.MM.yyyy HH:mm')}</p>
            </div>
          </div>

          <div className="print-info-grid">
            <div className="info-item">
              <label>Denumire BOM:</label>
              <span>{details.name}</span>
            </div>
            <div className="info-item">
              <label>Articol Părinte:</label>
              <span>{details.parent_code ? `${details.parent_code} - ${details.parent_name}` : 'N/A'}</span>
            </div>
            <div className="info-item">
              <label>Descriere:</label>
              <span>{details.description || '-'}</span>
            </div>
          </div>

          <table className="print-table">
            <thead>
              <tr>
                <th>Poz.</th>
                <th>Cod Articol</th>
                <th>Denumire Componentă</th>
                <th>Cant.</th>
                <th>Start</th>
                <th>Finish</th>
                <th>Locație</th>
                <th>Requirement</th>
              </tr>
            </thead>
            <tbody>
              {details.positions.map((p, i) => (
                <tr key={i}>
                  <td>{p.position_code}</td>
                  <td><span className="font-mono">{p.item_code}</span></td>
                  <td>{p.item_name}</td>
                  <td>{p.quantity}</td>
                  <td>{p.start_date ? format(new Date(p.start_date), 'dd.MM.yyyy') : '-'}</td>
                  <td>{p.finish_date ? format(new Date(p.finish_date), 'dd.MM.yyyy') : '-'}</td>
                  <td>{p.location || 'WH1'}</td>
                  <td>{p.requirement_name || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="print-footer">
            <div className="signature-box">
              <p>Întocmit de:</p>
              <div className="signature-line"></div>
            </div>
            <div className="signature-box">
              <p>Aprobat de:</p>
              <div className="signature-line"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
