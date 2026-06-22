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
import { treeApi } from '../api/client'
import type { TreeNode, TreeEdge } from '../types'

const GENDER_COLORS: Record<string, string> = {
  male: '#dbeafe',
  female: '#fce7f3',
  other: '#e0e7ff',
  unknown: '#f3f4f6',
}

function PersonNode({ data }: { data: TreeNode & { onClick: () => void } }) {
  const bg = GENDER_COLORS[data.gender ?? 'unknown'] ?? '#f3f4f6'
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        onClick={data.onClick}
        style={{ background: bg }}
        className="px-4 py-3 rounded-xl border-2 border-gray-300 shadow cursor-pointer hover:border-indigo-400 transition-colors min-w-[140px] text-center"
      >
        <div className="font-semibold text-gray-800 text-sm">{data.label}</div>
        {data.date_of_birth && (
          <div className="text-xs text-gray-500 mt-0.5">
            * {data.date_of_birth}{data.date_of_death ? ` † ${data.date_of_death}` : ''}
          </div>
        )}
        {!data.is_living && !data.date_of_death && (
          <div className="text-xs text-gray-400 mt-0.5">✝</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  )
}

const nodeTypes = { person: PersonNode }

function buildLayout(treeNodes: TreeNode[], treeEdges: TreeEdge[], navigate: (path: string) => void): { nodes: Node[]; edges: Edge[] } {
  const HGAP = 200
  const VGAP = 120

  // Simple layered layout: find roots (no parent) and arrange by depth
  const childOf = new Map<string, string[]>()
  const parentOf = new Map<string, string[]>()

  treeEdges.filter(e => e.type === 'parent_child').forEach(e => {
    if (!childOf.has(e.source)) childOf.set(e.source, [])
    childOf.get(e.source)!.push(e.target)
    if (!parentOf.has(e.target)) parentOf.set(e.target, [])
    parentOf.get(e.target)!.push(e.source)
  })

  const nodeIds = new Set(treeNodes.map(n => n.id))
  const roots = treeNodes.filter(n => !parentOf.has(n.id) || parentOf.get(n.id)!.length === 0)

  // BFS to assign levels
  const levels = new Map<string, number>()
  const queue = roots.map(n => ({ id: n.id, level: 0 }))
  const visited = new Set<string>()
  while (queue.length > 0) {
    const { id, level } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    levels.set(id, level)
    ;(childOf.get(id) ?? []).forEach(cid => queue.push({ id: cid, level: level + 1 }))
  }
  // Assign remaining nodes (disconnected)
  treeNodes.forEach(n => { if (!levels.has(n.id)) levels.set(n.id, 0) })

  // Group by level
  const byLevel = new Map<number, string[]>()
  levels.forEach((lvl, id) => {
    if (!byLevel.has(lvl)) byLevel.set(lvl, [])
    byLevel.get(lvl)!.push(id)
  })

  const positions = new Map<string, { x: number; y: number }>()
  byLevel.forEach((ids, lvl) => {
    ids.forEach((id, i) => {
      positions.set(id, { x: i * HGAP, y: lvl * VGAP })
    })
  })

  const nodes: Node[] = treeNodes.map(n => ({
    id: n.id,
    type: 'person',
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: { ...n, onClick: () => navigate(`/persons/${n.id}`) },
  }))

  const edges: Edge[] = treeEdges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: e.type === 'partner',
    markerEnd: e.type === 'parent_child' ? { type: MarkerType.ArrowClosed } : undefined,
    style: e.type === 'partner' ? { stroke: '#ec4899', strokeDasharray: '5,5' } : { stroke: '#6366f1' },
  }))

  return { nodes, edges }
}

export default function TreePage() {
  const { data, isLoading } = useQuery({ queryKey: ['tree'], queryFn: treeApi.get })
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const navigate = useCallback((path: string) => { window.location.href = path }, [])

  useEffect(() => {
    if (!data) return
    const { nodes: n, edges: e } = buildLayout(data.nodes, data.edges, navigate)
    setNodes(n)
    setEdges(e)
  }, [data, navigate, setNodes, setEdges])

  if (isLoading) return <div className="text-center py-12 text-gray-500">Lade Stammbaum...</div>

  if (nodes.length === 0) {
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
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
