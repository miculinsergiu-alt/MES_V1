import { useMemo, useRef, useEffect } from 'react';
import { format, addHours, startOfDay, differenceInMinutes } from 'date-fns';
import { useTranslation } from 'react-i18next';

export default function GanttTimeline({ orders = [], machines = [], viewDate = new Date(), hoursToShow = 24, onBlockClick }) {
  const containerRef = useRef(null);
  const dayStart = startOfDay(viewDate);
  const totalMinutes = hoursToShow * 60;
  const { t } = useTranslation();

  const scrollToNow = () => {
    if (containerRef.current) {
      const nowMin = differenceInMinutes(new Date(), dayStart);
      const percent = Math.max(0, Math.min(100, (nowMin / totalMinutes) * 100));
      const scrollPos = (containerRef.current.scrollWidth - 220) * (percent / 100);
      containerRef.current.scrollTo({ left: scrollPos - 300, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (format(viewDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')) {
      setTimeout(scrollToNow, 500);
    }
  }, [viewDate]);

  const timeLabels = useMemo(() => {
    const labels = [];
    for (let h = 0; h <= hoursToShow; h += 2) {
      const d = addHours(dayStart, h);
      labels.push({ hour: h, label: format(d, 'HH:mm') });
    }
    return labels;
  }, [dayStart, hoursToShow]);

  const nowOffset = useMemo(() => {
    const nowMin = differenceInMinutes(new Date(), dayStart);
    return Math.max(0, Math.min(100, (nowMin / totalMinutes) * 100));
  }, [dayStart, totalMinutes]);

  const toPercent = (dateStr) => {
    try {
      const d = typeof dateStr === 'string' ? new Date(dateStr.replace(' ', 'T')) : dateStr;
      const minutes = differenceInMinutes(d, dayStart);
      return (minutes / totalMinutes) * 100;
    } catch { return 0; }
  };

  const widthPercent = (startStr, endStr) => {
    try {
      const s = typeof startStr === 'string' ? new Date(startStr.replace(' ', 'T')) : startStr;
      const e = typeof endStr === 'string' ? new Date(endStr.replace(' ', 'T')) : endStr;
      const mins = differenceInMinutes(e, s);
      return Math.max(0.2, (mins / totalMinutes) * 100);
    } catch { return 1; }
  };

  const ordersByMachine = useMemo(() => {
    const map = {};
    for (const m of machines) map[m.id] = [];
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      if (!map[o.machine_id]) map[o.machine_id] = [];
      map[o.machine_id].push(o);
    }
    return map;
  }, [orders, machines]);

  if (machines.length === 0) return <div className="card py-20 text-center italic text-muted-foreground">{t('gantt.no_machines')}</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end no-print">
        <button className="btn btn-secondary btn-sm gap-2 shadow-sm" onClick={scrollToNow}>
          <span className="text-red-500 font-black">📍</span> {t('gantt.jump_to_now')}
        </button>
      </div>

      <div className="gantt-wrap border border-border rounded-xl shadow-sm bg-white overflow-x-auto" ref={containerRef}>
        <div className="min-w-[1400px]">
          {/* Header */}
          <div className="gantt-time-header">
            <div className="w-[220px] border-r border-border flex items-center px-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{t('gantt.header_label')}</span>
            </div>
            <div className="flex-1 relative">
              {timeLabels.map(({ hour, label }) => (
                <div key={hour} className="gantt-time-label" style={{ left:`${(hour*60/totalMinutes)*100}%` }}>
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Machine Rows */}
          <div className="divide-y divide-border">
            {machines.map(machine => {
              const machineOrders = ordersByMachine[machine.id] || [];
              return (
                <div key={machine.id} className="gantt-row">
                  {/* Left Label Column */}
                  <div className="gantt-label-col">
                    <div className="gantt-machine-name">{machine.name}</div>
                    <div className="gantt-row-markers">
                      <div className="gantt-marker">{t('gantt.marker_plan')}</div>
                      <div className="gantt-marker">{t('gantt.marker_exec')}</div>
                    </div>
                  </div>

                  {/* Main Track area */}
                  <div className="gantt-track">
                    {/* Background Grid */}
                    {timeLabels.map(({ hour }) => (
                      <div key={hour} className="gantt-grid-line" style={{ left:`${(hour*60/totalMinutes)*100}%` }} />
                    ))}
                    
                    {/* Now Line */}
                    <div className="gantt-now-line" style={{ left:`${nowOffset}%` }} />
                    
                    {/* LAYER 1: PLAN (Top) */}
                    <div className="gantt-layer">
                      {machineOrders.map(order => {
                        const left = toPercent(order.planned_start);
                        const width = widthPercent(order.planned_start, order.planned_end);
                        const delays = (order.delays || []).filter(d => d.applied);
                        const isMaintenance = order.order_type === 'maintenance';
                        
                        return (
                          <div key={`p-${order.id}`}>
                            <div 
                              className={`gantt-segment planner cursor-pointer ${isMaintenance ? 'maintenance-block' : ''}`}
                              style={{ 
                                left:`${left}%`, 
                                width:`${width}%`,
                                backgroundColor: isMaintenance ? '#f97316' : 'var(--planner-color)',
                                backgroundImage: isMaintenance ? 'linear-gradient(45deg, rgba(255,255,255,.1) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.1) 50%, rgba(255,255,255,.1) 75%, transparent 75%, transparent)' : 'none',
                                backgroundSize: '10px 10px'
                              }}
                              onClick={() => onBlockClick?.(order)}
                            />
                            {/* Product Name as simple text */}
                            <div className={`gantt-block-tag ${isMaintenance ? 'text-orange-950 font-black' : ''}`} style={{ left: `${left}%`, width: `${width}%` }}>
                              {order.product_name}
                            </div>
                            {delays.map(d => {
                              const dWidth = (d.delay_minutes / totalMinutes) * 100;
                              const dLeft = toPercent(order.planned_end);
                              return (
                                <div key={`dp-${d.id}`} className="gantt-segment bg-red-500/80 z-10" 
                                  style={{ left:`${dLeft - dWidth}%`, width:`${dWidth}%` }} 
                                />
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>

                    {/* LAYER 2: EXEC (Bottom) */}
                    <div className="gantt-layer">
                      {machineOrders.map(order => {
                        const actualSegments = [];
                        let cPhase = null, cStart = null;
                        for (const act of (order.actions || [])) {
                          if (act.action_type.includes('_start')) {
                            cPhase = act.action_type.replace('_start', '');
                            cStart = act.timestamp;
                          } else if (act.action_type.includes('_end')) {
                            if (cPhase && cStart) {
                              actualSegments.push({ phase: cPhase, left: toPercent(cStart), width: widthPercent(cStart, act.timestamp) });
                            }
                            cPhase = null; cStart = null;
                          }
                        }
                        if (cPhase && cStart) {
                          actualSegments.push({ phase: cPhase, left: toPercent(cStart), width: widthPercent(cStart, new Date()) });
                        }

                        return (
                          <div key={`a-${order.id}`}>
                            {actualSegments.map((seg, i) => (
                              <div key={`s-${i}`} className="gantt-segment shadow-md z-10" 
                                style={{ 
                                  left: `${seg.left}%`, 
                                  width: `${seg.width}%`,
                                  backgroundColor: seg.phase === 'setup' ? 'var(--setup-color)' : seg.phase === 'working' ? 'var(--working-color)' : 'var(--blue)'
                                }} 
                              />
                            ))}
                            {(order.delays || []).filter(d => d.applied).map(d => {
                              const dWidth = (d.delay_minutes / totalMinutes) * 100;
                              const dLeft = toPercent(order.planned_end);
                              return (
                                <div key={`da-${d.id}`} className="gantt-segment bg-red-600 z-10" 
                                  style={{ left:`${dLeft - dWidth}%`, width:`${dWidth}%` }} 
                                />
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>

                    {machineOrders.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground">{t('gantt.available')}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-8 px-6 py-3 no-print bg-white border border-border rounded-2xl w-fit shadow-sm">
        {[
          { label: t('gantt.legend_planned'), color:'bg-slate-300 opacity-40 border border-dashed border-slate-500' },
          { label: t('gantt.legend_maintenance'), color:'bg-orange-500' },
          { label: t('gantt.legend_setup'), color:'bg-blue-500 shadow-blue-200' },
          { label: t('gantt.legend_production'), color:'bg-green-500 shadow-green-200' },
          { label: t('gantt.legend_delay'), color:'bg-red-500 animate-pulse shadow-red-200' }
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className={`w-4 h-4 rounded-md shadow-sm ${item.color}`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
