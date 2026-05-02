import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, CheckCircle2, Trash2, AlertCircle, FileSearch, User } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';

export default function QuarantineDashboard() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    try {
      const res = await api.get('/quality/quarantine');
      setLogs(res.data);
    } catch (err) {
      toast.error('Eroare la încărcarea datelor din carantină');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const handleResolve = async (id, decision) => {
    if (!window.confirm(`Ești sigur că vrei să markezi acest lot ca ${decision === 'released' ? 'CONFORM' : 'REBUT'}?`)) return;
    try {
      await api.put(`/quality/quarantine/${id}/resolve`, {
        decision,
        decision_by: 1, // Demo admin
        notes: `Decizie luată din interfața de carantină: ${decision}`
      });
      toast.success(`Lotul a fost ${decision === 'released' ? 'eliberat în stoc' : 'casat (rebutat)'}`);
      loadLogs();
    } catch (err) {
      toast.error('Eroare la salvarea deciziei');
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h2 className="font-display text-3xl text-foreground flex items-center gap-3">
          <ShieldAlert className="text-orange-500" size={32} /> Controlul Calității & Carantină
        </h2>
        <p className="text-muted-foreground mt-2">Gestionează materialele non-conforme și deciziile de audit.</p>
      </header>

      <div className="grid grid-cols-1 gap-6">
        {logs.map(log => (
          <Card key={log.id} className="p-0 overflow-hidden border-orange-200 shadow-orange-50/50 shadow-lg">
            <div className="bg-orange-50 px-6 py-3 border-b border-orange-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-orange-600" />
                <span className="text-xs font-black uppercase tracking-widest text-orange-700">Așteaptă Decizie</span>
              </div>
              <span className="text-[10px] font-mono font-bold text-orange-400">{log.created_at}</span>
            </div>
            <div className="p-6 grid grid-cols-12 gap-8 items-center">
              <div className="col-span-4 space-y-2">
                <div>
                  <span className="font-mono text-[10px] font-black text-accent tracking-widest">{log.item_code}</span>
                  <h4 className="font-bold text-xl">{log.item_name}</h4>
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-[10px] font-black text-muted-foreground uppercase">Lot</p>
                    <Badge variant="outline" className="font-mono">{log.lot_number}</Badge>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-muted-foreground uppercase">Cantitate</p>
                    <p className="font-bold">{log.quantity} {log.uom}</p>
                  </div>
                </div>
              </div>

              <div className="col-span-5 bg-muted/20 p-4 rounded-2xl border border-border/50">
                <p className="text-[10px] font-black text-muted-foreground uppercase mb-1 flex items-center gap-1">
                  <FileSearch size={12}/> Motiv Carantină
                </p>
                <p className="text-sm italic">"{log.reason}"</p>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <User size={12}/> Raportat de: <span className="font-bold">{log.reporter_name}</span>
                </div>
              </div>

              <div className="col-span-3 flex flex-col gap-2">
                <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => handleResolve(log.id, 'released')}>
                  <CheckCircle2 size={16} className="mr-2" /> Eliberează în Stoc
                </Button>
                <Button variant="ghost" className="w-full text-red-600 hover:bg-red-50" onClick={() => handleResolve(log.id, 'scrapped')}>
                  <Trash2 size={16} className="mr-2" /> Casează (Rebut)
                </Button>
              </div>
            </div>
          </Card>
        ))}

        {logs.length === 0 && !loading && (
          <div className="py-20 text-center bg-green-50/30 border border-dashed border-green-200 rounded-3xl">
            <CheckCircle2 size={48} className="text-green-300 mx-auto mb-4" />
            <p className="text-green-700 font-bold">Nu există materiale în carantină.</p>
            <p className="text-green-600/70 text-sm">Toate recepțiile sunt conforme.</p>
          </div>
        )}
      </div>
    </div>
  );
}
