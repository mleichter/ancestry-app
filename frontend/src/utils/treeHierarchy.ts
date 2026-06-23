import type { TreeData, TreeNode } from '../types'

export interface HierarchyNodeData {
  id: string
  treeNode: TreeNode
  partners: TreeNode[]
  children: HierarchyNodeData[]
}

function buildMaps(data: TreeData) {
  const nodesById = new Map<string, TreeNode>(data.nodes.map(n => [n.id, n]))
  const childrenOf = new Map<string, string[]>()
  const parentsOf = new Map<string, string[]>()
  const partnersOf = new Map<string, string[]>()

  for (const edge of data.edges) {
    if (edge.type === 'parent_child') {
      if (!childrenOf.has(edge.source)) childrenOf.set(edge.source, [])
      childrenOf.get(edge.source)!.push(edge.target)
      if (!parentsOf.has(edge.target)) parentsOf.set(edge.target, [])
      parentsOf.get(edge.target)!.push(edge.source)
    } else if (edge.type === 'partner') {
      if (!partnersOf.has(edge.source)) partnersOf.set(edge.source, [])
      partnersOf.get(edge.source)!.push(edge.target)
      if (!partnersOf.has(edge.target)) partnersOf.set(edge.target, [])
      partnersOf.get(edge.target)!.push(edge.source)
    }
  }

  return { nodesById, childrenOf, parentsOf, partnersOf }
}

export function buildDescendants(rootId: string, data: TreeData): HierarchyNodeData | null {
  const { nodesById, childrenOf, partnersOf } = buildMaps(data)
  const visited = new Set<string>()

  function build(id: string): HierarchyNodeData | null {
    if (visited.has(id) || !nodesById.has(id)) return null
    visited.add(id)
    const treeNode = nodesById.get(id)!
    const partners = (partnersOf.get(id) ?? [])
      .map(pid => nodesById.get(pid))
      .filter((p): p is TreeNode => p !== undefined)
    const children = (childrenOf.get(id) ?? [])
      .map(cid => build(cid))
      .filter((c): c is HierarchyNodeData => c !== null)
    return { id, treeNode, partners, children }
  }

  return build(rootId)
}

export function buildAncestors(personId: string, data: TreeData): HierarchyNodeData | null {
  const { nodesById, parentsOf } = buildMaps(data)
  const visited = new Set<string>()

  function build(id: string): HierarchyNodeData | null {
    if (visited.has(id) || !nodesById.has(id)) return null
    visited.add(id)
    const treeNode = nodesById.get(id)!
    // Parents become "children" in d3 hierarchy so d3.tree() positions them above (we flip y later)
    const children = (parentsOf.get(id) ?? [])
      .map(pid => build(pid))
      .filter((c): c is HierarchyNodeData => c !== null)
    return { id, treeNode, partners: [], children }
  }

  return build(personId)
}

/** Pick a sensible default root: person with no parents, or the earliest born. */
export function defaultRootId(data: TreeData): string {
  const childIds = new Set(
    data.edges.filter(e => e.type === 'parent_child').map(e => e.target)
  )
  const roots = data.nodes.filter(n => !childIds.has(n.id))
  const candidates = roots.length > 0 ? roots : data.nodes
  // Prefer earliest birth year among candidates
  return candidates.reduce((best, n) => {
    const by = n.date_of_birth ? parseInt(n.date_of_birth.slice(0, 4)) : 9999
    const bb = best.date_of_birth ? parseInt(best.date_of_birth.slice(0, 4)) : 9999
    return by < bb ? n : best
  }).id
}
