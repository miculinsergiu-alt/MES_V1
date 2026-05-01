import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ChevronRight, ChevronDown, Zap, Package, Layers } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

// ─── Colour palette per level ────────────────────────────────────────────────
const LEVEL_STYLES = {
  1: { bg: 'bg-orange-50',  border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700', label: 'Phantom / Dept',  icon: <Layers size={13} className="text-orange-500"/> },
  2: { bg: 'bg-yellow-50',  border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', label: 'Semifabricat',    icon: <Package size={13} className="text-yellow-600"/> },
  3: { bg: 'bg-blue-50',    border: 'border-blue-200',   badge: 'bg-blue-100   text-blue-700',   label: 'Materie Primă',  icon: <Zap size={13} className="text-blue-500"/> },
  4: { bg: 'bg-slate-50',   border: 'border-slate-200',  badge: 'bg-slate-100  text-slate-700',  label: 'Sub-componentă', icon: <Zap size={13} className="text-slate-500"/> },
};

const MAX_LEVEL = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateId() { return `tmp_${Date.now()}_${Math.random().toString(36).slice(2,7)}`; }

function makeNode(level, overrides = {}) {
  return {
    _id: generateId(),
    item_id: null,
    position_code: '',
    quantity: 1,
    location: '',
    department: '',
    node_type: level === 1 ? 'department' : 'component',
    level,
    sort_order: 0,
    children: [],
    ...overrides,
  };
}

/** Recursively map tree to apply a fn to the node with given _id */
function mapTree(nodes, targetId, fn) {
  return nodes.map(n => {
    if (n._id === targetId) return fn(n);
    if (n.children?.length) return { ...n, children: mapTree(n.children, targetId, fn) };
    return n;
  });
}

/** Recursively remove node with given _id */
function removeFromTree(nodes, targetId) {
  return nodes
    .filter(n => n._id !== targetId)
    .map(n => ({ ...n, children: removeFromTree(n.children || [], targetId) }));
}

/** Convert server tree (with numeric ids) to client tree (with _id) */
export function serverToClient(nodes) {
  return (nodes || []).map(n => ({
    ...n,
    _id: generateId(),
    children: serverToClient(n.children || []),
  }));
}

/** Convert client tree to server format (strip _id, keep children) */
export function clientToServer(nodes) {
  return nodes.map((n, idx) => ({
    item_id: n.item_id,
    position_code: n.position_code || `${(idx + 1) * 10}`,
    quantity: n.quantity,
    location: n.location || '',
    department: n.department || '',
    node_type: n.node_type || 'component',
    level: n.level,
    sort_order: idx,
    children: clientToServer(n.children || []),
  }));
}

// ─── Main export ─────────────────────────────────────────────────────────────
export default function BOMEditor({ tree, onChange, items, warehouses = [] }) {
  const { t } = useTranslation();
  const addDepartment = () => {
    onChange([...tree, makeNode(1)]);
  };

  return (
    <div className="space-y-2">
      {tree.map((node) => (
        <TreeNode
          key={node._id}
          node={node}
          items={items}
          warehouses={warehouses}
          onUpdate={(updated) => onChange(mapTree(tree, node._id, () => updated))}
          onRemove={() => onChange(removeFromTree(tree, node._id))}
          onTreeChange={onChange}
          fullTree={tree}
        />
      ))}

      <button
        type="button"
        onClick={addDepartment}
        className="w-full mt-3 py-2.5 rounded-xl border-2 border-dashed border-orange-300 text-orange-500 text-sm font-semibold hover:bg-orange-50 transition-colors flex items-center justify-center gap-2"
      >
        <Plus size={16} /> {t('items.add_phantom')}
      </button>
    </div>
  );
}

// ─── Single tree node (recursive) ────────────────────────────────────────────
function TreeNode({ node, items, warehouses, onUpdate, onRemove, onTreeChange, fullTree }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [expanding, setExpanding] = useState(false);
  const style = LEVEL_STYLES[node.level] || LEVEL_STYLES[4];
  const selectedItem = items.find(i => i.id === node.item_id);
  const canHaveChildren = node.level < MAX_LEVEL;

  const update = (field, value) => onUpdate({ ...node, [field]: value });

  const addChild = () => {
    const child = makeNode(node.level + 1);
    onUpdate({ ...node, children: [...(node.children || []), child] });
    setExpanded(true);
  };

  const updateChild = (childId, updatedChild) => {
    onUpdate({ ...node, children: mapTree(node.children, childId, () => updatedChild) });
  };

  const removeChild = (childId) => {
    onUpdate({ ...node, children: removeFromTree(node.children || [], childId) });
  };

  // Auto-expand SF BOM
  const expandFromBOM = useCallback(async () => {
    if (!node.item_id) return toast.error(t('items.select_article_first'));
    setExpanding(true);
    try {
      const res = await api.get('/boms');
      const bom = res.data.find(b => b.parent_item_id === node.item_id);
      if (!bom) { toast.error(t('items.no_bom_for_item')); return; }
      const treeRes = await api.get(`/boms/${bom.id}/tree`);
      const childNodes = serverToClient(treeRes.data.tree).map(n => ({
        ...n,
        level: node.level + 1,
        children: (n.children || []).map(c => ({ ...c, level: node.level + 2 })),
      }));
      onUpdate({ ...node, children: [...(node.children || []), ...childNodes] });
      setExpanded(true);
      toast.success(t('items.bom_exploded', { count: treeRes.data.tree.length }));
    } catch (err) {
      toast.error(t('items.bom_explode_error'));
    } finally {
      setExpanding(false);
    }
  }, [node, onUpdate, t]);

  const childLabelMap = { 1: t('items.component'), 2: t('items.sub_component'), 3: t('items.sub_level') };

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} overflow-hidden`}>
      {/* Node header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          {node.children?.length > 0
            ? (expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>)
            : <span className="w-[14px] inline-block"/>}
        </button>

        {/* Level badge */}
        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md flex-shrink-0 ${style.badge}`}>
          L{node.level}
        </span>
        {style.icon}

        {/* Item selector */}
        <select
          className="flex-1 min-w-0 h-8 rounded-lg border border-border bg-white px-2 text-xs outline-none focus:ring-1 ring-accent"
          value={node.item_id || ''}
          onChange={e => update('item_id', e.target.value ? parseInt(e.target.value) : null)}
        >
          <option value="">— {t('items.select_article')} —</option>
          {items.map(i => (
            <option key={i.id} value={i.id}>
              {i.item_code} — {i.name} ({i.type === 'raw_material' ? 'MP' : i.type === 'semi_finished' ? 'SF' : i.type === 'finished_good' ? 'PF' : 'Phantom'})
            </option>
          ))}
        </select>

        {/* Quantity */}
        {node.level > 1 && (
          <>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">×</span>
            <Input
              type="number"
              step="0.001"
              min="0"
              className="h-8 w-20 text-xs text-center flex-shrink-0"
              value={node.quantity}
              onChange={e => update('quantity', parseFloat(e.target.value) || 0)}
            />
            {selectedItem && <span className="text-[10px] text-muted-foreground flex-shrink-0">{selectedItem.uom}</span>}
          </>
        )}

        {/* Warehouse/Dept for level 1 */}
        {node.level === 1 && (
          <Input
            placeholder={t('items.warehouse_placeholder')}
            className="h-8 w-32 text-xs flex-shrink-0"
            value={node.department || ''}
            onChange={e => update('department', e.target.value.toUpperCase())}
          />
        )}

        {/* Position code */}
        <Input
          placeholder={t('items.poz')}
          className="h-8 w-16 text-xs font-mono flex-shrink-0"
          value={node.position_code || ''}
          onChange={e => update('position_code', e.target.value)}
        />

        {/* Actions */}
        <div className="flex gap-1 flex-shrink-0">
          {/* Expand from BOM button (only for SF items) */}
          {canHaveChildren && selectedItem?.type === 'semi_finished' && (
            <button
              type="button"
              onClick={expandFromBOM}
              disabled={expanding}
              title={t('items.expand_bom_title')}
              className="h-8 px-2 text-[10px] font-bold rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-50"
            >
              {expanding ? '...' : '⤵ BOM'}
            </button>
          )}

          {/* Add child */}
          {canHaveChildren && (
            <button
              type="button"
              onClick={addChild}
              title={`${t('common.add')} ${childLabelMap[node.level] || t('items.component')}`}
              className="h-8 px-2 rounded-lg bg-white border border-border hover:bg-muted/40 transition-colors"
            >
              <Plus size={12}/>
            </button>
          )}

          {/* Remove */}
          <button
            type="button"
            onClick={onRemove}
            className="h-8 px-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={12}/>
          </button>
        </div>
      </div>

      {/* Children */}
      {expanded && node.children?.length > 0 && (
        <div className="pl-6 pr-2 pb-2 space-y-1.5 border-t border-dashed border-opacity-50" style={{ borderColor: 'inherit' }}>
          {node.children.map(child => (
            <TreeNode
              key={child._id}
              node={child}
              items={items}
              warehouses={warehouses}
              onUpdate={updated => updateChild(child._id, updated)}
              onRemove={() => removeChild(child._id)}
              onTreeChange={onTreeChange}
              fullTree={fullTree}
            />
          ))}
        </div>
      )}
    </div>
  );
}
