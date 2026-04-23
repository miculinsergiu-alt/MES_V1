import { useState, useEffect } from 'react';
import { Package, ArrowDownUp, Edit, Plus } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';

export default function InventoryPage() {
  const [stock, setStock] = useState([]);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const loadStock = async () => {
    try {
      const r = await api.get('/stock');
      setStock(r.data);
    } catch (e) {}
  };

  useEffect(() => { loadStock(); }, []);

  const openAdjust = (item) => {
    setSelectedItem(item);
    setShowAdjustModal(true);
  };

  const navItems = [
    { path: '/planner', label: 'Dashboard', icon: <Package size={16}/> },
    { path: '/planner/items', label: 'Articole & BOM', icon: <Package size={16}/> },
    { path: '/planner/inventory', label: 'Stocuri', icon: <ArrowDownUp size={16}/> }
  ];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <h1>Gestionare Stocuri</h1>
          <p>Monitorizarea materiilor prime și a produselor finite.</p>
        </div>

        <div className="page-content">
          <div className="card">
            <div className="card-title flex justify-between">
              <span>Niveluri Stoc Curente</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cod Articol</th>
                  <th>Nume</th>
                  <th>Tip</th>
                  <th>Cantitate</th>
                  <th>UOM</th>
                  <th>Locație</th>
                  <th>Ultima Actualizare</th>
                  <th>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {stock.map(s => (
                  <tr key={s.item_id}>
                    <td style={{ fontWeight: 600 }}>{s.item_code}</td>
                    <td>{s.item_name}</td>
                    <td><span className={`badge ${s.type==='raw_material'?'badge-blue':s.type==='finished_good'?'badge-green':'badge-yellow'}`}>{s.type}</span></td>
                    <td style={{ fontWeight: 700, color: s.quantity < 10 ? 'var(--red-light)' : 'inherit' }}>{s.quantity}</td>
                    <td>{s.uom}</td>
                    <td>{s.location || '-'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.last_updated?.substring(0, 16)}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => openAdjust(s)}><Edit size={14}/> Ajustează</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAdjustModal && selectedItem && (
        <AdjustStockModal item={selectedItem} onClose={() => setShowAdjustModal(false)} onSave={() => { setShowAdjustModal(false); loadStock(); }} />
      )}
    </div>
  );
}

function AdjustStockModal({ item, onClose, onSave }) {
  const [form, setForm] = useState({ quantity: item.quantity, location: item.location || '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/stock/adjust', { item_id: item.item_id, ...form });
      toast.success('Stoc actualizat cu succes');
      onSave();
    } catch (err) { toast.error('Eroare la actualizarea stocului'); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3>Ajustare Stoc: {item.item_code}</h3></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Cantitate Nouă ({item.uom})</label>
            <input className="form-input" type="number" step="0.01" value={form.quantity} onChange={e=>setForm(p=>({...p, quantity: e.target.value}))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Locație</label>
            <input className="form-input" type="text" value={form.location} onChange={e=>setForm(p=>({...p, location: e.target.value}))} placeholder="ex: Depozit A, Raft 4" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Anulare</button>
            <button type="submit" className="btn btn-primary">Salvează Modificările</button>
          </div>
        </form>
      </div>
    </div>
  );
}
