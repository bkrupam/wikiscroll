'use client'

import { useEffect, useMemo, useState } from 'react'

/* ──────────────────────────────────────────────────────────────────────────
 *  Hierarchical taste profile modal — Base44 spec.
 *
 *  ONE action per pill: clicking the pill body BOTH
 *    (a) boosts the topic (POST /api/preferences) and
 *    (b) toggles inline expansion of its children below.
 *
 *  No chevrons, no "+" affordances, no nested controls inside pills.
 *  Confirmed/Selected = Light Lime fill + Lime Spritz border (never black).
 *  Unselected         = ghost pill (transparent + ash border).
 *
 *  Spacing follows the 4/8/12/16/20/24/36/40 scale literally.
 * ────────────────────────────────────────────────────────────────────────── */

interface NodeData {
  id:          string
  name:        string
  depth:       number
  hasChildren: boolean
  alpha:       number
  beta:        number
  mean:        number
  totalPulls:  number
}

interface TasteModalProps {
  onClose: () => void
}

const C = {
  surface:    '#ffffff',
  ink:        '#000000',
  muted:      '#696f7b',
  ash:        '#cfcfcf',
  divider:    '#f0eee9',
  hover:      '#f5f3ef',
  lime:       '#ade900',
  limeFill:   '#ebffb1',
  shadow:     'rgba(34, 40, 42, 0.04) 0px 3px 10px 0px',
}

const CONFIRMED_THRESHOLD = 0.52

export function TasteModal({ onClose }: TasteModalProps) {
  const [roots, setRoots]                     = useState<NodeData[]>([])
  const [childrenMap, setChildrenMap]         = useState<Record<string, NodeData[]>>({})
  const [loadingNodes, setLoadingNodes]       = useState<Set<string>>(new Set())
  const [expanded, setExpanded]               = useState<Set<string>>(new Set())
  const [boosted, setBoosted]                 = useState<Set<string>>(new Set())
  const [loading, setLoading]                 = useState(true)

  useEffect(() => {
    fetch('/api/taste')
      .then((r) => r.json())
      .then(({ roots }: { roots: NodeData[] }) => {
        setRoots(roots ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const isConfirmed = (n: NodeData) =>
    boosted.has(n.id) || (n.mean > CONFIRMED_THRESHOLD && n.totalPulls >= 2)

  const confirmed = useMemo(
    () => roots.filter(isConfirmed).sort((a, b) => b.mean - a.mean),
    [roots, boosted],
  )

  const explore = useMemo(() => {
    const ids = new Set(confirmed.map((n) => n.id))
    return roots
      .filter((n) => !ids.has(n.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [roots, confirmed])

  async function loadChildren(nodeId: string) {
    if (childrenMap[nodeId]) return
    setLoadingNodes((s) => new Set(s).add(nodeId))
    try {
      const res = await fetch(`/api/taste/children?nodeId=${encodeURIComponent(nodeId)}`)
      const { children } = await res.json() as { children: NodeData[] }
      setChildrenMap((m) => ({ ...m, [nodeId]: children ?? [] }))
    } catch (err) {
      console.error('[TasteModal] loadChildren failed', err)
      setChildrenMap((m) => ({ ...m, [nodeId]: [] }))
    } finally {
      setLoadingNodes((s) => { const n = new Set(s); n.delete(nodeId); return n })
    }
  }

  async function handlePillClick(node: NodeData) {
    // Always boost (fire and forget). Backend already accumulates alpha,
    // so repeat clicks just compound the signal — that's fine.
    if (!boosted.has(node.id)) {
      setBoosted((b) => new Set(b).add(node.id))
    }
    fetch('/api/preferences', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ add: [node.id] }),
    }).catch(console.error)

    // Toggle expansion for non-leaf nodes
    if (node.depth < 2) {
      const isOpen = expanded.has(node.id)
      setExpanded((e) => {
        const next = new Set(e)
        if (isOpen) next.delete(node.id)
        else        next.add(node.id)
        return next
      })
      if (!isOpen) loadChildren(node.id)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.12)', backdropFilter: 'blur(6px)' }}
      />

      <div
        className="relative w-full max-w-[480px] flex flex-col overflow-hidden"
        style={{
          background:   C.surface,
          borderRadius: '13.8541px',
          boxShadow:    C.shadow,
          maxHeight:    '82vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between flex-shrink-0"
             style={{ padding: '24px 24px 16px' }}>
          <div>
            <h2 className="text-[18px] font-semibold leading-tight" style={{ color: C.ink }}>
              Your Taste Profile
            </h2>
            <p className="text-[12px] mt-1 leading-snug" style={{ color: C.muted }}>
              Tap a topic to add it and reveal what&apos;s inside.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.hover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={C.muted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="h-px flex-shrink-0" style={{ background: C.divider, margin: '0 24px' }} />

        {/* Body */}
        <div className="overflow-y-auto flex-1" style={{ padding: '20px 24px 24px' }}>
          {loading ? (
            <div className="flex items-center justify-center" style={{ padding: '64px 0' }}>
              <span className="text-[13px]" style={{ color: C.muted }}>Loading your profile…</span>
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: '24px' }}>
              <Section title="What you like">
                {confirmed.length === 0 ? (
                  <p className="text-[13px] leading-relaxed" style={{ color: C.muted }}>
                    Still learning. Tap topics below to teach us your taste.
                  </p>
                ) : (
                  <PillStack
                    nodes={confirmed}
                    expanded={expanded}
                    boosted={boosted}
                    isConfirmed={isConfirmed}
                    childrenMap={childrenMap}
                    loadingNodes={loadingNodes}
                    onClick={handlePillClick}
                  />
                )}
              </Section>

              {explore.length > 0 && (
                <>
                  <div className="h-px" style={{ background: C.divider }} />
                  <Section title="Explore more">
                    <PillStack
                      nodes={explore}
                      expanded={expanded}
                      boosted={boosted}
                      isConfirmed={isConfirmed}
                      childrenMap={childrenMap}
                      loadingNodes={loadingNodes}
                      onClick={handlePillClick}
                    />
                  </Section>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="flex-shrink-0"
               style={{ padding: '16px 24px', borderTop: `1px solid ${C.divider}` }}>
            <button
              onClick={onClose}
              className="w-full text-[14px] font-medium transition-opacity"
              style={{
                background:   C.limeFill,
                border:       `1px solid ${C.lime}`,
                color:        C.ink,
                borderRadius: '999px',
                padding:      '12px 16px',
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        className="text-[10px] font-semibold tracking-[0.12em] uppercase"
        style={{ color: C.muted, marginBottom: '12px' }}
      >
        {title}
      </p>
      {children}
    </div>
  )
}

interface StackProps {
  nodes:        NodeData[]
  expanded:     Set<string>
  boosted:      Set<string>
  isConfirmed:  (n: NodeData) => boolean
  childrenMap:  Record<string, NodeData[]>
  loadingNodes: Set<string>
  onClick:      (n: NodeData) => void
}

/** A flowing row of pills. When a pill is expanded its children render on the
 *  row directly under it, indented with a soft left divider — no chevrons,
 *  no inline icons inside the pills themselves. */
function PillStack(props: StackProps) {
  const { nodes, expanded, isConfirmed, childrenMap, loadingNodes, onClick } = props

  return (
    <div className="flex flex-col" style={{ gap: '12px' }}>
      {/* The pills themselves wrap freely on one shared row */}
      <div className="flex flex-wrap" style={{ gap: '10px' }}>
        {nodes.map((n) => (
          <Pill
            key={n.id}
            node={n}
            active={isConfirmed(n)}
            onClick={() => onClick(n)}
          />
        ))}
      </div>

      {/* Any expanded node renders its child row underneath, indented */}
      {nodes
        .filter((n) => expanded.has(n.id))
        .map((n) => (
          <ChildBlock
            key={`children-${n.id}`}
            parent={n}
            childrenList={childrenMap[n.id]}
            isLoading={loadingNodes.has(n.id)}
            {...props}
          />
        ))}
    </div>
  )
}

function Pill({
  node, active, onClick,
}: {
  node:    NodeData
  active:  boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-[13px] font-medium transition-colors cursor-pointer select-none"
      style={{
        background:   active ? C.limeFill : 'transparent',
        border:       `1px solid ${active ? C.lime : C.ash}`,
        color:        C.ink,
        borderRadius: '999px',
        padding:      '8px 16px',
        lineHeight:   1.2,
      }}
    >
      {node.name}
    </button>
  )
}

function ChildBlock({
  parent, childrenList, isLoading, ...rest
}: StackProps & {
  parent:       NodeData
  childrenList: NodeData[] | undefined
  isLoading:    boolean
}) {
  return (
    <div
      style={{
        marginLeft:  '12px',
        paddingLeft: '16px',
        borderLeft:  `1px solid ${C.divider}`,
      }}
    >
      <p className="text-[10px] font-semibold tracking-[0.12em] uppercase"
         style={{ color: C.muted, marginBottom: '10px' }}>
        Inside {parent.name}
      </p>

      {isLoading && !childrenList ? (
        <p className="text-[12px]" style={{ color: C.muted }}>Loading…</p>
      ) : childrenList && childrenList.length > 0 ? (
        <PillStack {...rest} nodes={childrenList} />
      ) : (
        <p className="text-[12px]" style={{ color: C.muted }}>Nothing deeper here yet.</p>
      )}
    </div>
  )
}
