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
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: colors.border }} />
      <div
        onClick={data.onClick}
        style={{ background: colors.bg, borderColor: colors.border }}
        className="px-3 py-2 rounded-xl border-2 shadow-sm cursor-pointer hover:shadow-md transition-shadow min-w-[130px] max-w-[160px] text-center"
      >
        {data.avatar_media_id && (
          <img
            src={mediaApi.fileUrl(data.avatar_media_id)}
            alt={data.label}
            className="w-10 h-10 rounded-full object-cover mx-auto mb-1 border border-white shadow-sm"
          />
        )}
        <div className="font-semibold text-gray-800 text-xs leading-tight">{data.label}</div>
        {(data.date_of_birth || data.date_of_death) && (
          <div className="text-xs text-gray-500 mt-0.5">
            {data.date_of_birth ? `* ${data.date_of_birth.slice(0, 4)}` : ''}
            {data.date_of_death ? ` † ${data.date_of_death.slice(0, 4)}` : ''}
          </div>
        )}
        {!data.is_living && !data.date_of_death && (
          <div className="text-xs text-gray-400">✝</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: colors.border }} />
    </>
  )
}

const nodeTypes = { person: PersonNode }

function buildLayout(
  treeNodes: TreeNode[],
  treeEdges: TreeEdge[],
  onNavigate: (path: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const NODE_W = 170
  const NODE_H = 80
  const H_GAP = 40
  const V_GAP = 80

  // Build parent→child map from parent_child edges
  const childrenOf = new Map<string, string[]>()
  const parentsOf = new Map<string, string[]>()
  treeEdges.filter(e => e.type === 'parent_child').forEach(e => {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, [])
    childrenOf.get(e.source)!.push(e.target)
    if (!parentsOf.has(e.target)) parentsOf.set(e.target, [])
    parentsOf.get(e.target)!.push(e.source)
  })

  // BFS from roots to assign generation levels
  const roots = treeNodes.filter(n => !parentsOf.has(n.id) || parentsOf.get(n.id)!.length === 0)
  const level = new Map<string, number>()
  const queue: Array<{ id: string; lvl: number }> = roots.map(n => ({ id: n.id, lvl: 0 }))
  const visited = new Set<string>()
  while (queue.length) {
    const { id, lvl } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    level.set(id, lvl)
    ;(childrenOf.get(id) ?? []).forEach(cid => queue.push({ id: cid, lvl: lvl + 1 }))
  }
  // Disconnected nodes fall on level 0
  treeNodes.forEach(n => { if (!level.has(n.id)) level.set(n.id, 0) })

  // Group by level, collect all levels
  const byLevel = new Map<number, string[]>()
  level.forEach((lvl, id) => {
    if (!byLevel.has(lvl)) byLevel.set(lvl, [])
    byLevel.get(lvl)!.push(id)
  })

  // Assign x positions: center each level's nodes around 0
  const pos = new Map<string, { x: number; y: number }>()
  byLevel.forEach((ids, lvl) => {
    const totalWidth = ids.length * NODE_W + (ids.length - 1) * H_GAP
    const startX = -totalWidth / 2
    ids.forEach((id, i) => {
      pos.set(id, { x: startX + i * (NODE_W + H_GAP), y: lvl * (NODE_H + V_GAP) })
    })
  })

  const nodes: Node[] = treeNodes.map(n => ({
    id: n.id,
    type: 'person',
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: { ...n, onClick: () => onNavigate(`/persons/${n.id}`) },
  }))

  const edges: Edge[] = treeEdges.map(e => {
    const isPartner = e.type === 'partner'
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: undefined,
      animated: isPartner,
      markerEnd: !isPartner ? { type: MarkerType.ArrowClosed, color: '#6366f1' } : undefined,
      style: isPartner
        ? { stroke: '#ec4899', strokeDasharray: '6,3', strokeWidth: 2 }
        : { stroke: '#6366f1', strokeWidth: 2 },
    }
  })

  return { nodes, edges }
}

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

  if (isLoading) return <div className="text-center py-12 text-gray-500">Lade Stammbaum...</div>

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
