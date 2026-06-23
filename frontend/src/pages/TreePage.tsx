import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDarkMode } from '../hooks/useDarkMode'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  Handle,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  Position,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { treeApi, mediaApi } from '../api/client'
import type { TreeNode, TreeEdge } from '../types'
import D3TreeView, { type TreeMode } from '../components/tree/D3TreeView'
import { defaultRootId } from '../utils/treeHierarchy'

const GENDER_VARS: Record<string, string> = {
  male: 'male', female: 'female', other: 'other', unknown: 'unknown',
}
function nodeVars(gender?: string) {
  const g = GENDER_VARS[gender ?? 'unknown'] ?? 'unknown'
  return { bg: `var(--node-${g}-bg)`, border: `var(--node-${g}-border)` }
}
const yearOf = (d: string) => /^\d{4}/.test(d) ? d.slice(0, 4) : d.slice(-4)

const MINIMAP_COLORS_LIGHT: Record<string, string> = {
  male: '#dbeafe', female: '#fce7f3', other: '#e0e7ff', unknown: '#f3f4f6',
}
const MINIMAP_COLORS_DARK: Record<string, string> = {
  male: '#1e3a5f', female: '#4a1a42', other: '#2e1065', unknown: '#1f2937',
}

function PersonNode({ data }: { data: TreeNode & { onClick: () => void } }) {
  const { bg, border } = nodeVars(data.gender)
  const hs = { background: border, width: 8, height: 8 }
  return (
    <>
      <Handle id="top"    type="target" position={Position.Top}    style={hs} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={hs} />
      <Handle id="left"   type="target" position={Position.Left}   style={{ ...hs, top: '50%' }} />
      <Handle id="right"  type="source" position={Position.Right}  style={{ ...hs, top: '50%' }} />
      <div
        onClick={data.onClick}
        style={{ background: bg, borderColor: border }}
        className="px-3 py-2 rounded-xl border-2 shadow-sm cursor-pointer hover:shadow-md transition-shadow min-w-[130px] max-w-[160px] text-center"
      >
        {data.avatar_media_id && (
          <img src={mediaApi.fileUrl(data.avatar_media_id)} alt={data.label}
            className="w-10 h-10 rounded-full object-cover mx-auto mb-1 border border-white/30 shadow-sm" />
        )}
        <div className="font-semibold text-gray-800 dark:text-gray-100 text-xs leading-tight">{data.label}</div>
        {(data.date_of_birth || data.date_of_death) && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {data.date_of_birth ? `* ${yearOf(data.date_of_birth)}` : ''}
            {data.date_of_death ? ` † ${yearOf(data.date_of_death)}` : ''}
          </div>
        )}
        {!data.is_living && !data.date_of_death && <div className="text-xs text-gray-400 dark:text-gray-500">✝</div>}
      </div>
    </>
  )
}

const nodeTypes = { person: PersonNode }

// ─── Branch filter helpers ────────────────────────────────────────────────────

function getAncestors(personId: string, edges: TreeEdge[]): Set<string> {
  const result = new Set<string>()
  const queue = [personId]
  while (queue.length) {
    const id = queue.shift()!
    if (result.has(id)) continue
    result.add(id)
    edges.filter(e => e.type === 'parent_child' && e.target === id).forEach(e => queue.push(e.source))
  }
  return result
}

function getDescendants(personId: string, edges: TreeEdge[]): Set<string> {
  const result = new Set<string>()
  const queue = [personId]
  while (queue.length) {
    const id = queue.shift()!
    if (result.has(id)) continue
    result.add(id)
    edges.filter(e => e.type === 'parent_child' && e.source === id).forEach(e => queue.push(e.target))
  }
  return result
}

function applyFilter(
  nodes: TreeNode[],
  edges: TreeEdge[],
  mode: 'all' | 'ancestors' | 'descendants',
  focusId: string | null,
): { nodes: TreeNode[]; edges: TreeEdge[] } {
  if (mode === 'all' || !focusId) return { nodes, edges }
  const primary = mode === 'ancestors' ? getAncestors(focusId, edges) : getDescendants(focusId, edges)
  // Include partners of found persons for context
  edges.filter(e => e.type === 'partner').forEach(e => {
    if (primary.has(e.source)) primary.add(e.target)
    if (primary.has(e.target)) primary.add(e.source)
  })
  return {
    nodes: nodes.filter(n => primary.has(n.id)),
    edges: edges.filter(e => primary.has(e.source) && primary.has(e.target)),
  }
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const NODE_W = 170
const NODE_H = 80
const H_GAP  = 50
const COUPLE_GAP = 30
const V_GAP  = 90

function buildLayout(
  treeNodes: TreeNode[],
  treeEdges: TreeEdge[],
  onNavigate: (path: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const childrenOf  = new Map<string, Set<string>>()
  const parentsOf   = new Map<string, Set<string>>()
  const partnersOf  = new Map<string, Set<string>>()

  for (const e of treeEdges) {
    if (e.type === 'parent_child') {
      if (!childrenOf.has(e.source)) childrenOf.set(e.source, new Set())
      childrenOf.get(e.source)!.add(e.target)
      if (!parentsOf.has(e.target))  parentsOf.set(e.target, new Set())
      parentsOf.get(e.target)!.add(e.source)
    } else if (e.type === 'partner') {
      if (!partnersOf.has(e.source)) partnersOf.set(e.source, new Set())
      partnersOf.get(e.source)!.add(e.target)
      if (!partnersOf.has(e.target)) partnersOf.set(e.target, new Set())
      partnersOf.get(e.target)!.add(e.source)
    }
  }

  const level = new Map<string, number>()
  const roots = treeNodes.filter(n => !parentsOf.has(n.id) || parentsOf.get(n.id)!.size === 0)
  const queue: Array<{ id: string; lvl: number }> = roots.map(n => ({ id: n.id, lvl: 0 }))
  const visited = new Set<string>()
  while (queue.length) {
    const { id, lvl } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    level.set(id, lvl)
    childrenOf.get(id)?.forEach(cid => queue.push({ id: cid, lvl: lvl + 1 }))
  }
  treeNodes.forEach(n => { if (!level.has(n.id)) level.set(n.id, 0) })

  const byLevel = new Map<number, string[]>()
  level.forEach((lvl, id) => {
    if (!byLevel.has(lvl)) byLevel.set(lvl, [])
    byLevel.get(lvl)!.push(id)
  })

  const orderedByLevel = new Map<number, string[]>()
  byLevel.forEach((ids, lvl) => {
    const placed = new Set<string>()
    const order: string[] = []
    for (const id of ids) {
      if (placed.has(id)) continue
      order.push(id)
      placed.add(id)
      partnersOf.get(id)?.forEach(pid => {
        if (level.get(pid) === lvl && !placed.has(pid)) {
          order.push(pid)
          placed.add(pid)
        }
      })
    }
    orderedByLevel.set(lvl, order)
  })

  const pos = new Map<string, { x: number; y: number }>()
  orderedByLevel.forEach((ids, lvl) => {
    const gaps: number[] = ids.map((id, i) => {
      if (i === 0) return 0
      const prev = ids[i - 1]
      const areCoupled = partnersOf.get(prev)?.has(id) || partnersOf.get(id)?.has(prev)
      return areCoupled ? COUPLE_GAP : H_GAP
    })
    const totalWidth = ids.length * NODE_W + gaps.reduce((s, g) => s + g, 0)
    let x = -totalWidth / 2
    ids.forEach((id, i) => {
      pos.set(id, { x, y: lvl * (NODE_H + V_GAP) })
      x += NODE_W + (i < ids.length - 1 ? gaps[i + 1] : 0)
    })
  })

  const maxLevel = Math.max(...[...level.values()])
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    const ids = orderedByLevel.get(lvl) ?? []
    const idealX = new Map<string, number>()
    for (const id of ids) {
      const pids = [...(parentsOf.get(id) ?? [])]
      if (pids.length === 0) continue
      const parentXs = pids.map(pid => pos.get(pid)?.x ?? 0)
      idealX.set(id, parentXs.reduce((s, x) => s + x, 0) / parentXs.length)
    }
    if (idealX.size === 0) continue
    const deltas = [...idealX.values()]
    const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length
    const currentCentroid = ids.reduce((s, id) => s + (pos.get(id)?.x ?? 0), 0) / ids.length
    const shift = avgDelta - currentCentroid
    ids.forEach(id => {
      const p = pos.get(id)!
      pos.set(id, { x: p.x + shift, y: p.y })
    })
  }

  const nodes: Node[] = treeNodes.map(n => ({
    id: n.id,
    type: 'person',
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    data: { ...n, onClick: () => onNavigate(`/persons/${n.id}`) },
  }))

  const edges: Edge[] = treeEdges.map(e => {
    if (e.type === 'partner') {
      const srcX = pos.get(e.source)?.x ?? 0
      const tgtX = pos.get(e.target)?.x ?? 0
      const [leftId, rightId] = srcX <= tgtX ? [e.source, e.target] : [e.target, e.source]
      return {
        id: e.id,
        source: leftId,
        target: rightId,
        sourceHandle: 'right',
        targetHandle: 'left',
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#ec4899', strokeDasharray: '6,3', strokeWidth: 2 },
      }
    }
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: 'bottom',
      targetHandle: 'top',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
      style: { stroke: '#6366f1', strokeWidth: 2 },
    }
  })

  return { nodes, edges }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type FilterMode = 'all' | 'ancestors' | 'descendants'

export default function TreePage() {
  const dark = useDarkMode()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['tree'], queryFn: treeApi.get })
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [focusId, setFocusId] = useState<string>('')
  const onNavigate = useCallback((path: string) => { navigate(path) }, [navigate])

  // D3 tree state
  const [viewMode, setViewMode] = useState<'graph' | 'tree'>('graph')
  const [treeMode, setTreeMode] = useState<TreeMode>('descendants')
  const [treeRootId, setTreeRootId] = useState<string>('')

  const sortedPersons = useMemo(() => {
    if (!data) return []
    return [...data.nodes].sort((a, b) => a.label.localeCompare(b.label))
  }, [data])

  // Auto-select a sensible default root when data first loads
  useEffect(() => {
    if (data && data.nodes.length > 0 && !treeRootId) {
      setTreeRootId(defaultRootId(data))
    }
  }, [data, treeRootId])

  useEffect(() => {
    if (!data) return
    const { nodes: tn, edges: te } = applyFilter(data.nodes, data.edges, filterMode, focusId || null)
    const { nodes: n, edges: e } = buildLayout(tn, te, onNavigate)
    setNodes(n)
    setEdges(e)
  }, [data, filterMode, focusId, onNavigate, setNodes, setEdges])

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Lade Stammbaum…</div>

  if (!data || data.nodes.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 dark:text-gray-500">
        <p className="text-lg mb-2">Der Stammbaum ist noch leer.</p>
        <Link to="/persons/new" className="text-indigo-600 dark:text-indigo-400 hover:underline">Erste Person anlegen</Link>
      </div>
    )
  }

  const minimapColors = dark ? MINIMAP_COLORS_DARK : MINIMAP_COLORS_LIGHT

  const pillCls = (active: boolean) =>
    `px-3 py-1 rounded-full text-xs font-medium transition-colors ${
      active
        ? 'bg-indigo-600 text-white'
        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
    }`

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Top bar — view toggle + mode-specific controls */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">

        {/* Graph / Baum toggle */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-full p-0.5 shrink-0">
          <button onClick={() => setViewMode('graph')} className={pillCls(viewMode === 'graph')}>
            Graph
          </button>
          <button onClick={() => setViewMode('tree')} className={pillCls(viewMode === 'tree')}>
            Baum
          </button>
        </div>

        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 shrink-0" />

        {viewMode === 'graph' ? (
          /* Graph mode: existing filter controls */
          <>
            <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">Anzeigen:</span>
            {(['all', 'ancestors', 'descendants'] as FilterMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => { setFilterMode(mode); if (mode === 'all') setFocusId('') }}
                className={pillCls(filterMode === mode)}
              >
                {mode === 'all' ? 'Alle' : mode === 'ancestors' ? 'Vorfahren von' : 'Nachkommen von'}
              </button>
            ))}
            {filterMode !== 'all' && (
              <select
                value={focusId}
                onChange={e => setFocusId(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">– Person wählen –</option>
                {sortedPersons.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            )}
            {filterMode !== 'all' && focusId && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {nodes.length} Person{nodes.length !== 1 ? 'en' : ''} sichtbar
              </span>
            )}
          </>
        ) : (
          /* Tree (Baum) mode controls */
          <>
            <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">Ausgang:</span>
            <select
              value={treeRootId}
              onChange={e => setTreeRootId(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {sortedPersons.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 shrink-0" />

            <button onClick={() => setTreeMode('descendants')} className={pillCls(treeMode === 'descendants')}>
              Nachkommen ↓
            </button>
            <button onClick={() => setTreeMode('ancestors')} className={pillCls(treeMode === 'ancestors')}>
              Vorfahren ↑
            </button>
          </>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        {viewMode === 'graph' ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.2}
          >
            <Background color={dark ? '#374151' : '#e5e7eb'} gap={20} />
            <Controls />
            <MiniMap nodeColor={n => minimapColors[n.data?.gender ?? 'unknown'] ?? minimapColors.unknown} />
          </ReactFlow>
        ) : (
          treeRootId ? (
            <D3TreeView
              data={data}
              rootId={treeRootId}
              mode={treeMode}
              onNavigate={onNavigate}
            />
          ) : null
        )}
      </div>
    </div>
  )
}
