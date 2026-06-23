import { describe, it, expect } from 'vitest'
import { buildDescendants, buildAncestors, defaultRootId } from '../utils/treeHierarchy'
import type { TreeData, TreeNode } from '../types'

function makeNode(id: string, dob?: string): TreeNode {
  return {
    id,
    label: `Person ${id}`,
    is_living: true,
    date_of_birth: dob,
    date_of_death: undefined,
    gender: undefined,
    avatar_media_id: undefined,
  }
}

function makeData(
  nodes: TreeNode[],
  edges: Array<{ source: string; target: string; type: 'parent_child' | 'partner' }>,
): TreeData {
  return { nodes, edges }
}

// ── buildDescendants ──────────────────────────────────────────────────────────

describe('buildDescendants', () => {
  it('returns null for unknown rootId', () => {
    const data = makeData([makeNode('A')], [])
    expect(buildDescendants('NOPE', data)).toBeNull()
  })

  it('returns single node with no children or partners', () => {
    const data = makeData([makeNode('A')], [])
    const result = buildDescendants('A', data)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('A')
    expect(result!.children).toHaveLength(0)
    expect(result!.partners).toHaveLength(0)
  })

  it('includes direct children', () => {
    const data = makeData(
      [makeNode('parent'), makeNode('child1'), makeNode('child2')],
      [
        { source: 'parent', target: 'child1', type: 'parent_child' },
        { source: 'parent', target: 'child2', type: 'parent_child' },
      ],
    )
    const result = buildDescendants('parent', data)!
    const childIds = result.children.map(c => c.id)
    expect(childIds).toContain('child1')
    expect(childIds).toContain('child2')
  })

  it('includes partners', () => {
    const data = makeData(
      [makeNode('A'), makeNode('B')],
      [{ source: 'A', target: 'B', type: 'partner' }],
    )
    const result = buildDescendants('A', data)!
    expect(result.partners).toHaveLength(1)
    expect(result.partners[0].id).toBe('B')
  })

  it('does not follow partner nodes as descendants', () => {
    const data = makeData(
      [makeNode('A'), makeNode('B'), makeNode('C')],
      [
        { source: 'A', target: 'B', type: 'partner' },
        { source: 'B', target: 'C', type: 'parent_child' },
      ],
    )
    const result = buildDescendants('A', data)!
    // A has no parent_child edges, so no children in the hierarchy
    expect(result.children).toHaveLength(0)
  })

  it('prevents infinite loops from cycles', () => {
    const data = makeData(
      [makeNode('A'), makeNode('B')],
      [
        { source: 'A', target: 'B', type: 'parent_child' },
        { source: 'B', target: 'A', type: 'parent_child' },
      ],
    )
    const result = buildDescendants('A', data)
    expect(result).not.toBeNull()
    // Should not throw or loop forever
  })

  it('builds multi-level hierarchy', () => {
    const data = makeData(
      [makeNode('gp'), makeNode('parent'), makeNode('child')],
      [
        { source: 'gp', target: 'parent', type: 'parent_child' },
        { source: 'parent', target: 'child', type: 'parent_child' },
      ],
    )
    const root = buildDescendants('gp', data)!
    expect(root.children).toHaveLength(1)
    expect(root.children[0].children).toHaveLength(1)
    expect(root.children[0].children[0].id).toBe('child')
  })
})

// ── buildAncestors ────────────────────────────────────────────────────────────

describe('buildAncestors', () => {
  it('returns null for unknown personId', () => {
    const data = makeData([makeNode('A')], [])
    expect(buildAncestors('NOPE', data)).toBeNull()
  })

  it('returns single node with no parents', () => {
    const data = makeData([makeNode('A')], [])
    const result = buildAncestors('A', data)
    expect(result).not.toBeNull()
    expect(result!.children).toHaveLength(0)
  })

  it('includes parents as children in the hierarchy', () => {
    const data = makeData(
      [makeNode('child'), makeNode('parent')],
      [{ source: 'parent', target: 'child', type: 'parent_child' }],
    )
    const result = buildAncestors('child', data)!
    expect(result.children).toHaveLength(1)
    expect(result.children[0].id).toBe('parent')
  })

  it('excludes partners from ancestor view', () => {
    const data = makeData(
      [makeNode('A'), makeNode('B')],
      [{ source: 'A', target: 'B', type: 'partner' }],
    )
    const result = buildAncestors('A', data)!
    expect(result.partners).toHaveLength(0)
  })

  it('builds multi-generation ancestor chain', () => {
    const data = makeData(
      [makeNode('me'), makeNode('parent'), makeNode('gp')],
      [
        { source: 'parent', target: 'me', type: 'parent_child' },
        { source: 'gp', target: 'parent', type: 'parent_child' },
      ],
    )
    const root = buildAncestors('me', data)!
    expect(root.id).toBe('me')
    expect(root.children[0].id).toBe('parent')
    expect(root.children[0].children[0].id).toBe('gp')
  })
})

// ── defaultRootId ─────────────────────────────────────────────────────────────

describe('defaultRootId', () => {
  it('returns the only node when there is one', () => {
    const data = makeData([makeNode('A')], [])
    expect(defaultRootId(data)).toBe('A')
  })

  it('returns a node with no parents (root candidate)', () => {
    const data = makeData(
      [makeNode('parent'), makeNode('child')],
      [{ source: 'parent', target: 'child', type: 'parent_child' }],
    )
    expect(defaultRootId(data)).toBe('parent')
  })

  it('prefers earliest birth year among root candidates', () => {
    const data = makeData(
      [makeNode('newer', '1950-01-01'), makeNode('older', '1900-01-01')],
      [],
    )
    expect(defaultRootId(data)).toBe('older')
  })

  it('falls back to all nodes when no root candidates exist (full cycle)', () => {
    const data = makeData(
      [makeNode('A', '1900-01-01'), makeNode('B', '1950-01-01')],
      [
        { source: 'A', target: 'B', type: 'parent_child' },
        { source: 'B', target: 'A', type: 'parent_child' },
      ],
    )
    // Both are "children" so no roots — picks earliest birth year
    expect(defaultRootId(data)).toBe('A')
  })
})
