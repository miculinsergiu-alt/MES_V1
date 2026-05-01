import { useState, useEffect } from 'react';
import { Package, ArrowDownUp, Edit, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';

export default function InventoryPage() {
  const { t } = useTranslation();
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
    { path: '/planner', labelKey: 'sidebar.dashboard', icon: <Package size={16}/> },
    { path: '/planner/items', labelKey: 'sidebar.articles_bom', icon: <Package size={16}/> },
    { path: '/planner/inventory', labelKey: 'sidebar.stocks', icon: <ArrowDownUp size={16}/> }
  ];

  return (
    <div className="app-layout">
      <Sidebar items={navItems} />
      <div className="main-content">
        <div className="page-header">
          <h1>{t('inventory.title')}</h1>
          <p>{t('sidebar.inventory')}</p>
        </div>

        <div className="page-content">
          <div className="card">
            <div className="card-title flex justify-between">
              <span>{t('inventory.current_levels')}</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('inventory.item_code')}</th>
                  <th>{t('inventory.item_name')}</th>
                  <th>{t('inventory.type')}</th>
                  <th>{t('inventory.quantity')}</th>
                  <th>{t('inventory.uom')}</th>
                  <th>{t('inventory.location')}</th>
                  <th>{t('inventory.last_updated')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {stock.map(s => (
                  <tr key={s.item_id}>
                    <td style={{ fontWeight: 600 }}>{s.item_code}</td>
                    <td>{s.item_name}</td>
                    <td><span className={`badge ${s.type==='raw_material'?'badge-blue':s.type==='finished_good'?'badge-green':'badge-yellow'}`}>{t(`items.${s.type}`)}</span></td>
                    <td style={{ fontWeight: 700, color: s.quantity < 10 ? 'var(--red-light)' : 'inherit' }}>{s.quantity}</td>
                    <td>{s.uom}</td>
                    <td>{s.location || '-'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.last_updated?.substring(0, 16)}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => openAdjust(s)}><Edit size={14}/> {t('inventory.adjust')}</button>
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
  const { t } = useTranslation();
  const [form, setForm] = useState({ quantity: item.quantity, location: item.location || '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/stock/adjust', { item_id: item.item_id, ...form });
      toast.success(t('messages.save_success'));
      onSave();
    } catch (err) { toast.error(t('messages.save_error')); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><h3>{t('inventory.adjust')}: {item.item_code}</h3></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('inventory.quantity')} ({item.uom})</label>
            <input className="form-input" type="number" step="0.01" value={form.quantity} onChange={e=>setForm(p=>({...p, quantity: e.target.value}))} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('inventory.location')}</label>
            <input className="form-input" type="text" value={form.location} onChange={e=>setForm(p=>({...p, location: e.target.value}))} placeholder="ex: Depozit A, Raft 4" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary">{t('common.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
