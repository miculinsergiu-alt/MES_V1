import { useMemo, useRef, useEffect } from 'react';
import { format, addHours, startOfDay, differenceInMinutes, parseISO } from 'date-fns';

const PHASE_COLORS = {
  setup: 'setup',
  working: 'working',
  supervision: 'supervision',
  delay: 'delay',
};

export default function GanttTimeline({ orders = [], machines = [], viewDate = new Date(), hoursToShow = 24, onBlockClick }) {
  const containerRef = useRef(null);
  const dayStart = startOfDay(viewDate);
  const dayEnd = addHours(dayStart, hoursToShow);
  const totalMinutes = hoursToShow * 60;

  const scrollToNow = () => {
    if (containerRef.current) {
      const nowMin = differenceInMinutes(new Date(), dayStart);
      const percent = Math.max(0, Math.min(100, (nowMin / totalMinutes) * 100));
      const scrollPos = (containerRef.current.scrollWidth - 180) * (percent / 100);
      containerRef.current.scrollTo({ left: scrollPos - 300, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    // Auto-scroll to "now" on mount if viewDate is today
    if (format(viewDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')) {
      setTimeout(scrollToNow, 500);
    }
  }, [viewDate]);

  const timeLabels = useMemo(() => {
    const labels = [];
    for (let h = 0; h <= hoursToShow; h += 2) {
      labels.push({ hour: h, label: format(addHours(dayStart, h), 'HH:mm') });
    }
    return labels;
  }, [dayStart, hoursToShow]);

  const nowOffset = useMemo(() => {
    const nowMin = differenceInMinutes(new Date(), dayStart);
    return Math.max(0, Math.min(100, (nowMin / totalMinutes) * 100));
  }, [dayStart, totalMinutes]);

  function toPercent(dateStr) {
    try {
      const d = typeof dateStr === 'string' ? new Date(dateStr.replace(' ', 'T')) : dateStr;
      const minutes = differenceInMinutes(d, dayStart);
      return Math.max(0, Math.min(100, (minutes / totalMinutes) * 100));
    } catch { return 0; }
  }

  function widthPercent(startStr, endStr) {
    try {
      const s = typeof startStr === 'string' ? new Date(startStr.replace(' ', 'T')) : startStr;
      const e = typeof endStr === 'string' ? new Date(endStr.replace(' ', 'T')) : endStr;
      const mins = differenceInMinutes(e, s);
      return Math.max(0.5, (mins / totalMinutes) * 100);
    } catch { return 1; }
  }

  // Group orders by machine
  const ordersByMachine = useMemo(() => {
    const map = {};
    for (const m of machines) map[m.id] = [];
    for (const o of orders) {
      if (!map[o.machine_id]) map[o.machine_id] = [];
      map[o.machine_id].push(o);
    }
    return map;
  }, [orders, machines]);

  if (machines.length === 0) return <div className="empty-state">Niciun utilaj disponibil</div>;

  return (
    <div className="gantt-wrapper-outer">
      <div className="flex justify-end mb-2 no-print">
        <button className="btn btn-ghost btn-sm" onClick={scrollToNow} title="Sari la ora curentă">
          📍 Sari la Acum
        </button>
      </div>
      <div className="gantt-wrap" ref={containerRef}>
        <div className="gantt-container">
          {/* Header with time labels */}
          <div style={{ display:'flex', marginLeft:180, marginBottom:4, position:'relative', height:24 }}>
            {timeLabels.map(({ hour, label }) => (
              <div key={hour} className="gantt-time-label" style={{ position:'absolute', left:`${(hour*60/totalMinutes)*100}%`, transform:'translateX(-50%)', fontSize:11, color:'var(--text-muted)' }}>
                {label}
              </div>
            ))}
          </div>

          {/* Machine rows */}
          {machines.map(machine => {
            const machineOrders = ordersByMachine[machine.id] || [];
            return (
              <div key={machine.id} className="gantt-row">
                <div className="gantt-label" title={machine.name}>{machine.name}</div>
                <div className="gantt-track" style={{ borderLeft:'1px solid var(--border)' }}>
                  {/* Grid lines */}
                  {timeLabels.map(({ hour }) => (
                    <div key={hour} style={{ position:'absolute', left:`${(hour*60/totalMinutes)*100}%`, top:0, bottom:0, width:1, background:'rgba(255,255,255,0.04)' }} />
                  ))}
                  {/* Now line */}
                  <div className="gantt-now-line" style={{ left:`${nowOffset}%` }} />
                  {/* Order blocks */}
                  {machineOrders.map(order => {
                    const delays = order.delays || [];
                    const left = toPercent(order.planned_start);
                    const width = widthPercent(order.planned_start, order.planned_end);
                    const hasDelay = delays.some(d => d.applied);
                    const statusClass = order.status === 'done' ? 'done' : order.status === 'active' ? 'active' : hasDelay ? 'delay' : 'working';

                    return (
                      <div key={order.id}>
                        {/* Main working block */}
                        <div
                          className={`gantt-block ${statusClass}`}
                          style={{ left:`${left}%`, width:`${width}%` }}
                          onClick={() => onBlockClick?.(order)}
                        >
                          <div className="gantt-block-content" title={`${order.product_name} | Qty: ${order.quantity} | Status: ${order.status}`}>
                            {width > 8 ? order.product_name : ''}
                          </div>
                        </div>
                        {/* Delay overlays */}
                        {delays.filter(d => d.applied).map(delay => {
                          const delayLeft = toPercent(order.planned_end);
                          const delayWidth = (delay.delay_minutes / totalMinutes) * 100;
                          return (
                            <div key={delay.id} className="gantt-block delay" style={{ left:`${delayLeft - delayWidth}%`, width:`${delayWidth}%`, opacity:0.85 }}
                              title={`Delay ${delay.delay_minutes} min: ${delay.reason}`}>
                              {delayWidth > 3 ? `+${delay.delay_minutes}m` : ''}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {machineOrders.length === 0 && (
                    <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', fontSize:11, color:'var(--text-muted)' }}>Liber</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Legend */}
      <div style={{ display:'flex', gap:16, marginTop:12, flexWrap:'wrap' }} className="no-print">
        {[
          {cls:'setup',label:'Setup',color:'var(--setup-color)'},
          {cls:'working',label:'Producție',color:'var(--working-color)'},
          {cls:'active',label:'Activ (În lucru)',color:'var(--green)'},
          {cls:'done',label:'Finalizat',color:'var(--blue)'},
          {cls:'delay',label:'Întârziere',color:'var(--delay-color)'}
        ].map(({cls,label,color}) => (
          <div key={cls} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--text-secondary)' }}>
            <div style={{ width:12, height:12, borderRadius:3, background:color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
