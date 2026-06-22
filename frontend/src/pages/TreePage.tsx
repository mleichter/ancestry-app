import { useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
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

const GENDER_COLORS: Record<string, { bg: string; border: string }> = {
  male:    { bg: '#dbeafe', border: '#93c5fd' },
  female:  { bg: '#fce7f3', border: '#f9a8d4' },
  other:   { bg: '#e0e7ff', border: '#a5b4fc' },
  unknown: { bg: '#f3f4f6', border: '#d1d5db' },
}

function PersonNode({ data }: { data: TreeNode & { onClick: () => void } }) {
  const colors = GENDER_COLORS[data.gender ?? 'unknown'] ?? GENDER_COLORS.unknown
  const hs = { background: colors.border, width: 8, height: 8 }
  return (
    <>
      <Handle id="top"    type="target" position={Position.Top}    style={hs} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={hs} />
      <Handle id="left"   type="target" position={Position.Left}   style={{ ...hs, top: '50%' }} />
      <Handle id="right"  type="source" position={Position.Right}  style={{ ...hs, top: '50%' }} />
      <div
        onClick={data.onClick}
        style={{ background: colors.bg, borderColor: colors.border }}
        className="px-3 py-2 rounded-xl border-2 shadow-sm cursor-pointer hover:shadow-md transition-shadow min-w-[130px] max-w-[160px] text-center"
      >
        {data.avatar_media_id && (
          <img src={mediaApi.fileUrl(data.avatar_media_id)} alt={data.label}
            className="w-10 h-10 rounded-full object-cover mx-auto mb-1 border border-white shadow-sm" />
        )}
        <div className="font-semibold text-gray-800 text-xs leading-tight">{data.label}</div>
        {(data.date_of_birth || data.date_of_death) && (
          <div className="text-xs text-gray-500 mt-0.5">
            {data.date_of_birth ? `* ${data.date_of_birth.slice(0, 4)}` : ''}
            {data.date_of_death ? ` † ${data.date_of_death.slice(0, 4)}` : ''}
          </div>
        )}
        {!data.is_living && !data.date_of_death && <div className="text-xs text-gray-400">✝</div>}
      </div>
    </>
  )
}

const nodeTypes = { person: PersonNode }

// ─── layout ──────────────────────────────────────────────────────────────────

const NODE_W = 170
const NODE_H = 80
const H_GAP  = 50   // gap between siblings / unrelated nodes
const COUPLE_GAP = 30  // tighter gap between partners
const V_GAP  = 90

function buildLayout(
  treeNodes: TreeNode[],
  treeEdges: TreeEdge[],
  onNavigate: (path: string) => void,
): { nodes: Node[]; edges: Edge[] } {

  // ── relationship maps ──────────────────────────────────────────────────────
  const childrenOf  = new Map<string, Set<string>>()  // parent  → children
  const parentsOf   = new Map<string, Set<string>>()  // child   → parents
  const partnersOf  = new Map<string, Set<string>>()  // person  → partners

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

  // ── BFS level assignment ───────────────────────────────────────────────────
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

  // ── within each level, order nodes: partners adjacent ─────────────────────
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
      // Place all partners of this node right after it
      partnersOf.get(id)?.forEach(pid => {
        if (level.get(pid) === lvl && !placed.has(pid)) {
          order.push(pid)
          placed.add(pid)
        }
      })
    }
    orderedByLevel.set(lvl, order)
  })

  // ── assign x positions with tighter gaps for adjacent partners ────────────
  const pos = new Map<string, { x: number; y: number }>()

  orderedByLevel.forEach((ids, lvl) => {
    // Pre-compute total width to centre around 0
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

  // ── nudge children toward their parents' midpoint ─────────────────────────
  // For each child, if all its parents are known, shift it toward their x midpoint.
  // Do this level-by-level top-down to avoid cascading distortion.
  const maxLevel = Math.max(...[...level.values()])
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    const ids = orderedByLevel.get(lvl) ?? []
    // Build ideal-x for each id based on parents' current positions
    const idealX = new Map<string, number>()
    for (const id of ids) {
      const pids = [...(parentsOf.get(id) ?? [])]
      if (pids.length === 0) continue
      const parentXs = pids.map(pid => pos.get(pid)?.x ?? 0)
      idealX.set(id, parentXs.reduce((s, x) => s + x, 0) / parentXs.length)
    }
    if (idealX.size === 0) continue
    // Shift all nodes in the level by the average delta, preserving relative order
    const deltas = [...idealX.values()]
    const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length
    const currentCentroid = ids.reduce((s, id) => s + (pos.get(id)?.x ?? 0), 0) / ids.length
    const shift = avgDelta - currentCentroid
    ids.forEach(id => {
      const p = pos.get(id)!
      pos.set(id, { x: p.x + shift, y: p.y })
    })
  }

  // ── build React Flow nodes ─────────────────────────────────────────────────
  const nodes: Node[] = treeNodes.map(n => ({
    id: n.id,
    type: 'person',
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    data: { ...n, onClick: () => onNavigate(`/persons/${n.id}`) },
  }))

  // ── build React Flow edges ─────────────────────────────────────────────────
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

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TreePage() {
  const { data, isLoading } = useQuery({ queryKey: ['tree'], queryFn: treeApi.get })
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const onNavigate = useCallback((path: string) => { window.location.href = path }, [])

  useEffect(() => {
    if (!data) return
    const { nodes: n, edges: e } = buildLayout(data.nodes, data.edges, onNavigate)
    setNodes(n)
    setEdges(e)
  }, [data, onNavigate, setNodes, setEdges])

  if (isLoading) return <div className="text-center py-12 text-gray-500">Lade Stammbaum…</div>

  if (!data || data.nodes.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg mb-2">Der Stammbaum ist noch leer.</p>
        <Link to="/persons/new" className="text-indigo-600 hover:underline">Erste Person anlegen</Link>
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100vh - 120px)' }} className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white">
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
        <Background color="#e5e7eb" gap={20} />
        <Controls />
        <MiniMap nodeColor={n => GENDER_COLORS[n.data?.gender ?? 'unknown']?.bg ?? '#f3f4f6'} />
      </ReactFlow>
    </div>
  )
}
