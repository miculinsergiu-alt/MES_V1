import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit2, Printer, ChevronRight, ChevronDown,
  Layers, Package, Zap, GitBranch, DollarSign, Box
} from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';

// ─── Level config ─────────────────────────────────────────────────────────────
const L = {
  1: { bg: 'bg-orange-50',  border: 'border-l-4 border-l-orange-400', badge: 'bg-orange-100 text-orange-700', label: 'Phantom / Dept', icon: <Layers size={14} className="text-orange-500 flex-shrink-0"/> },
  2: { bg: 'bg-yellow-50',  border: 'border-l-4 border-l-yellow-400', badge: 'bg-yellow-100 text-yellow-700', label: 'Semifabricat',   icon: <Package size={14} className="text-yellow-600 flex-shrink-0"/> },
  3: { bg: 'bg-blue-50',    border: 'border-l-4 border-l-blue-400',   badge: 'bg-blue-100   text-blue-700',   label: 'Materie Primă', icon: <Zap size={14} className="text-blue-500 flex-shrink-0"/> },
  4: { bg: 'bg-slate-50',   border: 'border-l-4 border-l-slate-300',  badge: 'bg-slate-100  text-slate-600',  label: 'Sub-comp.',     icon: <Zap size={14} className="text-slate-400 flex-shrink-0"/> },
};

// ─── Recursive cost calculation ───────────────────────────────────────────────
function calcCost(nodes) {
  return nodes.reduce((sum, n) => {
    const self = (n.acquisition_cost || 0) * (n.quantity || 1);
    return sum + self + calcCost(n.children || []);
  }, 0);
}

function countNodes(nodes) {
  return nodes.reduce((sum, n) => 1 + sum + countNodes(n.children || []), 0);
}

// ─── Tree Node ────────────────────────────────────────────────────────────────
function ViewerNode({ node, depth = 0 }) {
  const [open, setOpen] = useState(true);
  const style = L[node.level] || L[4];
  const hasChildren = node.children?.length > 0;
  const indent = depth * 28;

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: depth * 0.04 }}
        className={`flex items-center group rounded-xl mb-1 cursor-default transition-all hover:shadow-md border border-transparent hover:border-border/50 ${style.bg} ${hasChildren ? 'cursor-pointer' : ''}`}
        onClick={() => hasChildren && setOpen(o => !o)}
      >
        {/* Left Side: Indent + Toggle + Icon + Code & Name */}
        <div className="flex items-center flex-1 min-w-0 py-2.5 px-4">
          <div style={{ width: indent }} className="flex-shrink-0" />
          
          <span className="text-muted-foreground w-6 flex-shrink-0 flex justify-center">
            {hasChildren
              ? (open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>)
              : <span className="w-[2px] h-3 bg-border/40 ml-0.5"/>
            }
          </span>

          <div className="flex items-center gap-3 min-w-0">
            {style.icon}
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md flex-shrink-0 ${style.badge}`}>
              L{node.level}
            </span>
            
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-black text-accent flex-shrink-0">
                  {node.item_code || '---'}
                </span>
                <span className="font-bold text-sm text-foreground truncate">
                  {node.item_name || node.department || 'Nedefinit'}
                </span>
              </div>
              {node.level === 1 && node.department && (
                <span className="text-[10px] text-orange-600 font-bold uppercase tracking-tighter">
                  Departament / Magazie: {node.department}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Columns Aligned End-to-End */}
        <div className="flex items-center gap-6 pr-6">
          {/* Position */}
          <div className="w-16 text-right hidden md:block text-muted-foreground font-mono text-[10px]">
            #{node.position_code || '-'}
          </div>

          {/* Quantity Column - FIXED WIDTH FOR ALIGNMENT */}
          <div className="w-24 flex justify-end">
            {node.level > 1 && (
              <div className="flex items-baseline gap-1 bg-white/60 px-2.5 py-1 rounded-lg border border-white/80 shadow-sm">
                <span className="font-mono font-black text-sm text-foreground">{node.quantity}</span>
                <span className="text-[10px] font-bold text-muted-foreground uppercase">{node.uom || 'buc'}</span>
              </div>
            )}
          </div>

          {/* Cost/Sub-nodes Column - FIXED WIDTH */}
          <div className="w-32 flex justify-end">
            {hasChildren ? (
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-accent/5 text-accent border border-accent/10 whitespace-nowrap">
                {node.children.length} SUB-NODURI
              </span>
            ) : node.acquisition_cost > 0 ? (
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground leading-none mb-0.5">COST TOT.</div>
                <div className="font-mono text-xs font-bold text-foreground">
                  {((node.acquisition_cost || 0) * (node.quantity || 1)).toFixed(2)}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {open && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {node.children.map((child) => (
              <ViewerNode key={child.id || child._id} node={child} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Flatten tree for table print view */
function flattenForPrint(nodes, depth = 0, result = []) {
  nodes.forEach(node => {
    result.push({ ...node, depth });
    if (node.children?.length) flattenForPrint(node.children, depth + 1, result);
  });
  return result;
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BOMViewerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bom, setBom] = useState(null);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/boms/${id}`),
      api.get(`/boms/${id}/tree`),
    ]).then(([bomRes, treeRes]) => {
      setBom(bomRes.data);
      setTree(treeRes.data.tree || []);
    }).catch(() => {
      toast.error('Eroare la încărcarea BOM-ului');
      navigate('/planner/items');
    }).finally(() => setLoading(false));
  }, [id]);

  const navItems = [
    { path: '/planner/gantt',  labelKey: 'sidebar.production_plan', icon: <Box size={16}/> },
    { path: '/planner/items',  labelKey: 'sidebar.items_bom',       icon: <Box size={16}/> },
  ];

  const totalCost   = calcCost(tree);
  const totalNodes  = countNodes(tree);
  const deptCount   = tree.length; // L1 nodes = departments
  const flatData    = flattenForPrint(tree);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar items={navItems} />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-accent/30 border-t-accent rounded-full animate-spin mx-auto"/>
            <p className="text-muted-foreground italic text-sm">Se încarcă structura BOM...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar items={navItems} />
      <main className="flex-1 p-8 overflow-auto">

        {/* ── Breadcrumb + actions ── */}
        <div className="flex items-center justify-between mb-8 print:hidden">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/planner/items')}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
            >
              <ArrowLeft size={16}/> Înapoi la BOM-uri
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-bold text-foreground">{bom?.name}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer size={14} className="mr-1"/> Printează Fișă Operator
            </Button>
            <Button size="sm" onClick={() => navigate('/planner/items', { state: { editBomId: id } })}>
              <Edit2 size={14} className="mr-1"/> Editează BOM
            </Button>
          </div>
        </div>

        {/* ── Header card ── */}
        <Card className="p-6 mb-6 print:hidden">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <Badge className="mb-2">Bill of Materials</Badge>
              <h1 className="font-display text-3xl text-foreground">{bom?.name}</h1>
              {bom?.description && <p className="text-muted-foreground mt-1 text-sm">{bom.description}</p>}
            </div>
            {bom?.parent_code && (
              <div className="bg-muted/30 rounded-2xl px-6 py-4 border border-border text-right">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Produs Finit</div>
                <div className="font-mono font-black text-accent text-lg">{bom.parent_code}</div>
                <div className="font-semibold text-sm">{bom.parent_name}</div>
              </div>
            )}
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-border">
            {[
              { label: 'Departamente',  value: deptCount,             icon: <Layers size={16} className="text-orange-500"/> },
              { label: 'Total Noduri',  value: totalNodes,            icon: <GitBranch size={16} className="text-purple-500"/> },
              { label: 'Cost Standard', value: `${totalCost.toFixed(2)} RON`, icon: <DollarSign size={16} className="text-green-500"/> },
              { label: 'Data emitere',  value: format(new Date(), 'dd.MM.yyyy'), icon: <Box size={16} className="text-blue-500"/> },
            ].map(stat => (
              <div key={stat.label} className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted/40">{stat.icon}</div>
                <div>
                  <div className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">{stat.label}</div>
                  <div className="font-bold text-foreground">{stat.value}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Legend ── */}
        <div className="flex items-center gap-3 mb-4 flex-wrap print:hidden">
          <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Legendă:</span>
          {Object.entries(L).map(([lvl, s]) => (
            <span key={lvl} className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full ${s.badge}`}>
              {s.icon} L{lvl} — {s.label}
            </span>
          ))}
        </div>

        {/* ── BOM Tree ── */}
        <Card className="p-6 print:hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-sm uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <GitBranch size={14}/> Structură BOM
            </h2>
            <div className="flex gap-2">
              <button
                className="text-[10px] font-bold text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted/40 transition-colors"
                onClick={() => { /* expand all — handled by default open state */ toast('Click pe noduri pentru a le extinde/restrânge', { icon: '💡' }); }}
              >
                Extinde tot / Restrânge
              </button>
            </div>
          </div>

          {tree.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground italic text-sm">
              BOM-ul nu are structură definită. Apasă "Editează BOM" pentru a adăuga componente.
            </div>
          ) : (
            <div className="space-y-1">
              {tree.map((node) => (
                <ViewerNode key={node.id || node._id} node={node} depth={0} />
              ))}
            </div>
          )}
        </Card>

        {/* ── PROFESSIONAL PRINT VIEW (Operator Style) ── */}
        <div className="hidden print:block p-4 font-sans text-black">
          {/* Header Print */}
          <div className="flex justify-between items-center border-b-4 border-black pb-4 mb-6">
            <div>
              <h1 className="text-3xl font-black uppercase tracking-tighter">Fișă de Fabricație (BOM)</h1>
              <p className="text-lg font-bold">{bom?.name}</p>
            </div>
            <div className="text-right">
              <h2 className="text-4xl font-black text-gray-300">V1.0</h2>
              <p className="text-xs font-mono">Generat: {format(new Date(), 'dd.MM.yyyy HH:mm')}</p>
            </div>
          </div>

          {/* Info Table Print */}
          <table className="w-full border-collapse border-2 border-black mb-8">
            <tbody>
              <tr>
                <td className="border border-black p-3 bg-gray-100 font-bold w-1/4">PRODUS FINIT:</td>
                <td className="border border-black p-3 text-xl font-black">{bom?.parent_code} - {bom?.parent_name}</td>
                <td className="border border-black p-3 bg-gray-100 font-bold w-1/4">COST STANDARD:</td>
                <td className="border border-black p-3 font-mono">{totalCost.toFixed(2)} RON</td>
              </tr>
              <tr>
                <td className="border border-black p-3 bg-gray-100 font-bold">DESCRIERE:</td>
                <td className="border border-black p-3" colSpan={3}>{bom?.description || '---'}</td>
              </tr>
            </tbody>
          </table>

          {/* Main BOM Table Print */}
          <table className="w-full border-collapse border-2 border-black text-sm">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-black p-2 text-left">NIVEL</th>
                <th className="border border-black p-2 text-left">POZ.</th>
                <th className="border border-black p-2 text-left">COD ARTICOL</th>
                <th className="border border-black p-2 text-left">DENUMIRE COMPONENTĂ</th>
                <th className="border border-black p-2 text-center">CANT.</th>
                <th className="border border-black p-2 text-left">DEPT. / LOCAȚIE</th>
              </tr>
            </thead>
            <tbody>
              {flatData.map((node, i) => (
                <tr key={i} className={node.level === 1 ? 'bg-gray-50 font-bold' : ''}>
                  <td className="border border-black p-2 text-center">
                    {'.'.repeat(node.depth)}{node.level}
                  </td>
                  <td className="border border-black p-2 font-mono text-center">{node.position_code || '-'}</td>
                  <td className="border border-black p-2 font-mono font-bold">{node.item_code || '---'}</td>
                  <td className="border border-black p-2">
                    <span style={{ paddingLeft: node.depth * 10 + 'px' }}>
                      {node.item_name || node.department}
                    </span>
                  </td>
                  <td className="border border-black p-2 text-center font-bold">
                    {node.level > 1 ? node.quantity : ''} {node.level > 1 ? node.uom : ''}
                  </td>
                  <td className="border border-black p-2">
                    {node.level === 1 ? node.department : node.location || '---'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer Print */}
          <div className="mt-12 grid grid-cols-3 gap-8">
            <div className="border-t border-black pt-2 text-center">
              <p className="text-xs uppercase font-bold">Întocmit Planner</p>
              <div className="h-16"></div>
              <p className="text-[10px] font-mono">Semnătură / Ștampilă</p>
            </div>
            <div className="border-t border-black pt-2 text-center">
              <p className="text-xs uppercase font-bold">Verificat Supervizor</p>
              <div className="h-16"></div>
            </div>
            <div className="border-t border-black pt-2 text-center">
              <p className="text-xs uppercase font-bold">Primit Producție</p>
              <div className="h-16"></div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
