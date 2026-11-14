import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Settings2, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../contexts/AuthContext';
import { hasAnyRole } from '../../lib/roles';
import { dateDE, num, apiError } from '../../lib/format';

const MANAGE_ROLES = ['administrator', 'area_supervisor'];

export default function MaintenancePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManage = hasAnyRole(user, MANAGE_ROLES);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logFor, setLogFor] = useState(null);
  const [configFor, setConfigFor] = useState(null);

  const loadStatus = useCallback(async () => {
    try {
      setMachines((await api.get('/maintenance/status')).data);
    } catch (err) {
      toast.error(apiError(err, t('maintenance.load_error')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-10 overflow-auto">
    <div className="space-y-8">
      <header>
        <h2 className="font-display text-3xl text-foreground">{t('maintenance.title')}</h2>
        <p className="text-muted-foreground">{t('maintenance.subtitle')}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {machines.map((m) => {
          const since = Number(m.hoursSinceLast || 0);
          const hasInterval = Number(m.interval_hours) > 0;
          const progress = hasInterval ? Math.min(100, (since / m.interval_hours) * 100) : 0;
          const state = !hasInterval ? 'none' : m.isDue ? 'due' : m.isWarning ? 'warning' : 'ok';
          const barColor = { due: 'bg-red-500', warning: 'bg-amber-500', ok: 'bg-green-500', none: 'bg-muted-foreground/30' }[state];
          const badge = {
            due: 'bg-red-100 text-red-700', warning: 'bg-amber-100 text-amber-700', ok: 'bg-green-100 text-green-700', none: 'bg-muted text-muted-foreground',
          }[state];

          return (
            <Card key={m.id} className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {state === 'due' ? <AlertTriangle size={18} className="text-red-600 shrink-0" /> : <Wrench size={18} className="text-muted-foreground shrink-0" />}
                  <h3 className="font-bold text-lg truncate">{m.name}</h3>
                </div>
                <Badge className={badge}>{t(`maintenance.state_${state}`)}</Badge>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-muted-foreground">{t('maintenance.usage_since_last')}</span>
                  <span className="font-semibold">
                    {hasInterval
                      ? `${num(since, 0)} / ${num(m.interval_hours, 0)} ${t('maintenance.hours_unit')}`
                      : `${num(since, 0)} ${t('maintenance.hours_unit')}`}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full ${barColor} transition-all`} style={{ width: `${progress}%` }} />
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">{t('maintenance.total_hours')}</dt>
                  <dd className="font-semibold">{num(m.total_running_hours, 0)} {t('maintenance.hours_unit')}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('maintenance.last_done')}</dt>
                  <dd className="font-semibold">{m.last_maintenance_date ? dateDE(m.last_maintenance_date) : t('maintenance.never')}</dd>
                </div>
              </dl>

              {canManage && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={() => setLogFor(m)}>
                    <CheckCircle size={14} className="mr-1.5" /> {t('maintenance.register')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfigFor(m)}>
                    <Settings2 size={14} className="mr-1.5" /> {hasInterval ? t('maintenance.edit_interval') : t('maintenance.set_interval')}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {!loading && machines.length === 0 && (
        <div className="py-20 text-center italic text-muted-foreground bg-muted/10 rounded-3xl border border-dashed border-border">
          {t('maintenance.no_machines')}
        </div>
      )}

      {logFor && <LogModal machine={logFor} onClose={() => setLogFor(null)} onSaved={() => { setLogFor(null); loadStatus(); }} />}
      {configFor && <ConfigModal machine={configFor} onClose={() => setConfigFor(null)} onSaved={() => { setConfigFor(null); loadStatus(); }} />}
    </div>
    </main>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="font-display text-xl">{title}</h3>
        {children}
      </Card>
    </div>
  );
}

function LogModal({ machine, onClose, onSaved }) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/maintenance/log', { machine_id: machine.id, notes });
      toast.success(t('messages.save_success'));
      onSaved();
    } catch (err) {
      toast.error(apiError(err, t('messages.save_error')));
      setSaving(false);
    }
  };

  return (
    <Modal title={`${t('maintenance.register')}: ${machine.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm rounded-xl bg-blue-50 text-blue-800 p-3">{t('maintenance.reset_alert')}</p>
        <label className="block space-y-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('maintenance.notes')}</span>
          <textarea className="w-full rounded-xl border border-border bg-transparent p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('maintenance.placeholder_notes')} required />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>{t('maintenance.confirm_complete')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfigModal({ machine, onClose, onSaved }) {
  const { t } = useTranslation();
  const [interval, setIntervalHours] = useState(machine.interval_hours ?? '');
  const [warning, setWarning] = useState(machine.warning_threshold_hours ?? 50);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/maintenance/config', { machine_id: machine.id, interval_hours: interval, warning_threshold_hours: warning || 0 });
      toast.success(t('messages.save_success'));
      onSaved();
    } catch (err) {
      toast.error(apiError(err, t('messages.save_error')));
      setSaving(false);
    }
  };

  return (
    <Modal title={`${t('maintenance.interval')}: ${machine.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('maintenance.interval_hours')}</span>
          <Input type="number" min="1" step="1" required value={interval} onChange={(e) => setIntervalHours(e.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('maintenance.warning_hours')}</span>
          <Input type="number" min="0" step="1" value={warning} onChange={(e) => setWarning(e.target.value)} />
          <span className="text-xs text-muted-foreground">{t('maintenance.warning_hint')}</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
