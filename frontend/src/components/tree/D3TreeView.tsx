import { useEffect, useRef, useMemo } from 'react'
import { hierarchy, tree as d3tree } from 'd3'
import { zoom as d3zoom, zoomIdentity } from 'd3'
import { select } from 'd3'
import { buildDescendants, buildAncestors, type HierarchyNodeData } from '../../utils/treeHierarchy'
import { useDarkMode } from '../../hooks/useDarkMode'
import type { TreeData } from '../../types'

export type TreeMode = 'descendants' | 'ancestors'

const NW = 155   // node width
const NH = 68    // node height
const PARTNER_GAP = 18
// Horizontal cell: generous to accommodate a potential partner companion
const H_CELL = NW * 2.6
const V_CELL = NH + 90

interface FlatNode {
  key: string
  personId: string
  label: string
  gender?: string
  dateOfBirth?: string
  dateOfDeath?: string
  isLiving: boolean
  avatarId?: string
  x: number
  y: number
  isCompanion: boolean
}

interface FlatLink {
  d: string
  isPartner: boolean
}

function genderColors(gender: string | undefined, dark: boolean) {
  const schemes = dark
    ? {
        male:    { bg: '#1e3a5f', border: '#3b82f6', text: '#bfdbfe' },
        female:  { bg: '#4a1a42', border: '#ec4899', text: '#fbcfe8' },
        other:   { bg: '#2e1065', border: '#818cf8', text: '#e0e7ff' },
        unknown: { bg: '#1f2937', border: '#4b5563', text: '#e5e7eb' },
      }
    : {
        male:    { bg: '#dbeafe', border: '#93c5fd', text: '#1e3a5f' },
        female:  { bg: '#fce7f3', border: '#f9a8d4', text: '#4a1a42' },
        other:   { bg: '#e0e7ff', border: '#a5b4fc', text: '#2e1065' },
        unknown: { bg: '#f3f4f6', border: '#d1d5db', text: '#1f2937' },
      }
  return schemes[gender as keyof typeof schemes] ?? schemes.unknown
}

function yr(d?: string | null) {
  if (!d) return ''
  return /^\d{4}/.test(d) ? d.slice(0, 4) : d.slice(-4)
}

function buildLayout(
  rootId: string,
  data: TreeData,
  mode: TreeMode,
): { nodes: FlatNode[]; links: FlatLink[] } {
  const hierarchyData =
    mode === 'descendants'
      ? buildDescendants(rootId, data)
      : buildAncestors(rootId, data)

  if (!hierarchyData) return { nodes: [], links: [] }

  const root = hierarchy<HierarchyNodeData>(
    hierarchyData,
    d => (d.children.length ? d.children : null),
  )

  const layout = d3tree<HierarchyNodeData>()
    .nodeSize([H_CELL, V_CELL])
    .separation((a, b) => {
      const ap = a.data.partners.length > 0
      const bp = b.data.partners.length > 0
      // nodes with partners need extra breathing room
      if (ap && bp) return 2.2
      if (ap || bp) return 1.7
      return 1.1
    })

  layout(root)

  const nodes: FlatNode[] = []
  const links: FlatLink[] = []

  root.each(d => {
    // d3.tree uses x for breadth, y for depth; we treat y as vertical
    const rawX = d.x ?? 0
    const rawY = d.y ?? 0
    // ancestors mode: flip y so parents appear above the selected person
    const fy = mode === 'ancestors' ? -rawY : rawY
    // shift x so the left edge of the node is at rawX - NW/2
    const fx = rawX - NW / 2

    nodes.push({
      key: `main-${d.data.id}`,
      personId: d.data.id,
      label: d.data.treeNode.label,
      gender: d.data.treeNode.gender,
      dateOfBirth: d.data.treeNode.date_of_birth,
      dateOfDeath: d.data.treeNode.date_of_death,
      isLiving: d.data.treeNode.is_living,
      avatarId: d.data.treeNode.avatar_media_id,
      x: fx,
      y: fy,
      isCompanion: false,
    })

    // Partner companion nodes placed to the right
    d.data.partners.forEach((partner, i) => {
      const px = fx + NW + PARTNER_GAP + i * (NW + PARTNER_GAP)
      nodes.push({
        key: `companion-${d.data.id}-${partner.id}-${i}`,
        personId: partner.id,
        label: partner.label,
        gender: partner.gender,
        dateOfBirth: partner.date_of_birth,
        dateOfDeath: partner.date_of_death,
        isLiving: partner.is_living,
        avatarId: partner.avatar_media_id,
        x: px,
        y: fy,
        isCompanion: true,
      })
      // Dashed partner link (horizontal between person right edge and companion left edge)
      links.push({
        d: `M ${fx + NW},${fy + NH / 2} L ${px},${fy + NH / 2}`,
        isPartner: true,
      })
    })
  })

  // Parent → child curved links
  root.links().forEach(({ source, target }) => {
    const sx = (source.x ?? 0) - NW / 2
    const sy = mode === 'ancestors' ? -(source.y ?? 0) : (source.y ?? 0)
    const tx = (target.x ?? 0) - NW / 2
    const ty = mode === 'ancestors' ? -(target.y ?? 0) : (target.y ?? 0)

    // If source has partners, connect from midpoint between source and first companion
    const hasPartner = source.data.partners.length > 0
    const srcCX = hasPartner
      ? sx + NW + PARTNER_GAP / 2   // midpoint in the gap between person and companion
      : sx + NW / 2

    // For descendants: lines go down from source bottom to target top
    // For ancestors: lines go up from source top to target bottom (flipped)
    const srcY = mode === 'ancestors' ? sy : sy + NH
    const tgtY = mode === 'ancestors' ? ty + NH : ty
    const tgtCX = tx + NW / 2
    const midY = (srcY + tgtY) / 2

    links.push({
      d: `M ${srcCX},${srcY} C ${srcCX},${midY} ${tgtCX},${midY} ${tgtCX},${tgtY}`,
      isPartner: false,
    })
  })

  return { nodes, links }
}

interface D3TreeViewProps {
  data: TreeData
  rootId: string
  mode: TreeMode
  onNavigate: (path: string) => void
}

export default function D3TreeView({ data, rootId, mode, onNavigate }: D3TreeViewProps) {
  const dark = useDarkMode()
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)

  const { nodes, links } = useMemo(
    () => buildLayout(rootId, data, mode),
    [rootId, data, mode],
  )

  // Zoom / pan + initial fit-to-view
  useEffect(() => {
    const svgEl = svgRef.current
    const gEl = gRef.current
    if (!svgEl || !gEl) return

    const svg = select(svgEl)
    const g = select(gEl)

    const zoomer = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.08, 4])
      .on('zoom', e => g.attr('transform', e.transform.toString()))

    svg.call(zoomer).on('dblclick.zoom', null)

    if (nodes.length > 0) {
      const { width: W, height: H } = svgEl.getBoundingClientRect()
      const vW = W || 800
      const vH = H || 600

      const xs = nodes.map(n => n.x)
      const ys = nodes.map(n => n.y)
      const minX = Math.min(...xs) - 24
      const maxX = Math.max(...xs) + NW + 24
      const minY = Math.min(...ys) - 24
      const maxY = Math.max(...ys) + NH + 24

      const tW = maxX - minX
      const tH = maxY - minY
      const scale = Math.min(1, Math.min(vW / tW, vH / tH) * 0.88)
      const tx = vW / 2 - (minX + tW / 2) * scale
      const ty = vH / 2 - (minY + tH / 2) * scale

      svg.call(zoomer.transform, zoomIdentity.translate(tx, ty).scale(scale))
    }

    return () => { svg.on('.zoom', null) }
  }, [nodes])

  function downloadSVG() {
    const svgEl = svgRef.current
    if (!svgEl || nodes.length === 0) return

    const xs = nodes.map(n => n.x)
    const ys = nodes.map(n => n.y)
    const minX = Math.min(...xs) - 32
    const maxX = Math.max(...xs) + NW + 32
    const minY = Math.min(...ys) - 32
    const maxY = Math.max(...ys) + NH + 32
    const w = maxX - minX
    const h = maxY - minY

    const clone = svgEl.cloneNode(true) as SVGSVGElement
    clone.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`)
    clone.setAttribute('width', String(w))
    clone.setAttribute('height', String(h))
    clone.setAttribute('font-family', 'system-ui, -apple-system, sans-serif')
    // Strip zoom transform so the content renders at full scale
    const g = clone.querySelector('g')
    if (g) g.removeAttribute('transform')

    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'stammbaum.svg'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
        Keine Daten für diese Ansicht.
      </div>
    )
  }

  const bgColor = dark ? '#111827' : '#f9fafb'

  return (
    <div className="relative w-full h-full">
    <button
      onClick={downloadSVG}
      title="Als SVG herunterladen"
      className="absolute top-3 right-3 z-10 px-3 py-1.5 text-xs bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm backdrop-blur-sm"
    >
      SVG ↓
    </button>
    <svg
      ref={svgRef}
      className="w-full h-full cursor-grab active:cursor-grabbing select-none"
      style={{ background: bgColor }}
    >
      <g ref={gRef}>
        {/* Parent-child curved links */}
        {links
          .filter(l => !l.isPartner)
          .map((l, i) => (
            <path
              key={`pc-${i}`}
              d={l.d}
              fill="none"
              stroke="#6366f1"
              strokeWidth={1.5}
              opacity={0.65}
            />
          ))}

        {/* Partner dashed links */}
        {links
          .filter(l => l.isPartner)
          .map((l, i) => (
            <path
              key={`pr-${i}`}
              d={l.d}
              fill="none"
              stroke="#ec4899"
              strokeWidth={1.5}
              strokeDasharray="5,3"
              opacity={0.8}
            />
          ))}

        {/* Person nodes */}
        {nodes.map(n => {
          const c = genderColors(n.gender, dark)
          const by = yr(n.dateOfBirth)
          const dy = yr(n.dateOfDeath)
          const lifespan =
            by || dy
              ? `${by ? `* ${by}` : ''}${by && dy ? ' ' : ''}${dy ? `† ${dy}` : ''}`.trim()
              : null
          const displayLabel =
            n.label.length > 19 ? n.label.slice(0, 18) + '…' : n.label

          return (
            <g
              key={n.key}
              transform={`translate(${n.x},${n.y})`}
              onClick={() => onNavigate(`/persons/${n.personId}`)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                width={NW}
                height={NH}
                rx={9}
                fill={c.bg}
                stroke={c.border}
                strokeWidth={n.isCompanion ? 1 : 2}
                opacity={n.isLiving ? 1 : 0.78}
              />
              {/* Avatar image (circular clip via foreignObject-free approach) */}
              {n.avatarId && (
                <image
                  href={`/api/v1/media/${n.avatarId}/file?thumb=true`}
                  x={7}
                  y={NH / 2 - 18}
                  width={36}
                  height={36}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`circle(18px at 25px ${NH / 2}px)`}
                  style={{ borderRadius: '50%' }}
                />
              )}
              <text
                x={n.avatarId ? 50 : NW / 2}
                y={lifespan ? NH / 2 - 5 : NH / 2 + 5}
                textAnchor={n.avatarId ? 'start' : 'middle'}
                dominantBaseline="middle"
                fontSize={11.5}
                fontWeight={600}
                fill={c.text}
              >
                {displayLabel}
              </text>
              {lifespan && (
                <text
                  x={n.avatarId ? 50 : NW / 2}
                  y={NH / 2 + 13}
                  textAnchor={n.avatarId ? 'start' : 'middle'}
                  dominantBaseline="middle"
                  fontSize={10}
                  fill={dark ? '#9ca3af' : '#6b7280'}
                >
                  {lifespan}
                </text>
              )}
              {!n.isLiving && !n.dateOfDeath && (
                <text
                  x={NW - 8}
                  y={12}
                  fontSize={10}
                  fill={dark ? '#9ca3af' : '#9ca3af'}
                  textAnchor="middle"
                >
                  ✝
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
    </div>
  )
}
