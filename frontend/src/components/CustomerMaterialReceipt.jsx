/**
 * Receive customer-supplied material (Beistellung): no purchase order, no
 * cost; the lot belongs to the customer and is only used for their orders.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { PackagePlus, X } from 'lucide-react';
import api from '../api/axios';
import { apiError } from '../lib/format';

const cls = 'h-9 w-full rounded-lg border border-border bg-white px-2 text-sm';

export default function CustomerMaterialReceipt() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [f, setF] = useState({ customer_id: '', item_id: '', lot_number: '', quantity: '', document_reference: '' });

  useEffect(() => {
    if (!open) return;
    api.get('/customers').then((r) => setCustomers(r.data)).catch(() => {});
    api.get('/items').then((r) => setItems(r.data || [])).catch(() => {});
  }, [open]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post('/procurement/receipts', {
        customer_id: Number(f.customer_id), document_reference: f.document_reference || undefined,
        items: [{ item_id: Number(f.item_id), lot_number: f.lot_number, quantity_received: f.quantity }],
      });
      toast.success(t('cm.saved'));
      setF({ customer_id: f.customer_id, item_id: '', lot_number: '', quantity: '', document_reference: '' });
      setOpen(false);
    } catch (err) { toast.error(apiError(err, t('cm.error'))); }
  };

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 rounded-xl border border-border bg-white px-3 py-2 text-sm font-semibold hover:bg-muted"><PackagePlus size={16} />{t('cm.button')}</button>;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={save} className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">{t('cm.title')}</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="close"><X size={18} /></button>
        </div>
        <p className="text-xs text-muted-foreground">{t('cm.hint')}</p>
        <label className="block text-xs">{t('cm.customer')}<select required className={cls} value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}><option value="" />{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block text-xs">{t('cm.item')}<select required className={cls} value={f.item_id} onChange={(e) => setF({ ...f, item_id: e.target.value })}><option value="" />{items.map((i) => <option key={i.id} value={i.id}>{i.item_code} · {i.name}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">{t('cm.lot')}<input required className={cls} value={f.lot_number} onChange={(e) => setF({ ...f, lot_number: e.target.value })} /></label>
          <label className="text-xs">{t('cm.quantity')}<input required type="number" min="0" step="any" className={cls} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
        </div>
        <label className="block text-xs">{t('cm.delivery_note')}<input className={cls} value={f.document_reference} onChange={(e) => setF({ ...f, document_reference: e.target.value })} /></label>
        <button type="submit" className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white">{t('cm.save')}</button>
      </form>
    </div>
  );
}
