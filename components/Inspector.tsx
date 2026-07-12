'use client'

import React from 'react'
import { Building2, Calendar, Circle, FileText, GitBranch, Link2, MapPin, Network, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Node3D, Link3D } from '../lib/forceSimulation'
import { Community } from '../lib/graphData'

interface InspectorProps {
  selectedNode: Node3D | null
  connectedLinks: Link3D[]
  visibleCommunities: Community[]
  communityMode: 'off' | 'auto' | 'all'
  onClose: () => void
  onNodeSelect: (node: Node3D) => void
  projectName?: string
}

function EntityIcon({ type }: { type: string }) {
  const className = 'h-3.5 w-3.5'
  switch (type.toUpperCase()) {
    case 'ORGANIZATION': return <Building2 className={className} />
    case 'PERSON': return <User className={className} />
    case 'GEO': return <MapPin className={className} />
    case 'EVENT': return <Calendar className={className} />
    default: return <Circle className={className} />
  }
}

function SectionLabel({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b bg-[#05080b]/72 px-4 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground backdrop-blur-md">
      <span className="text-foreground/70">{icon}</span>
      {children}
    </div>
  )
}

export default function Inspector({ selectedNode, connectedLinks, visibleCommunities, communityMode, onClose, onNodeSelect, projectName }: InspectorProps) {
  const hierarchy = React.useMemo(() => {
    if (!selectedNode?.community || communityMode === 'off') return null
    const selected = selectedNode.community
    const parent = selected.parent === null || selected.parent === undefined
      ? undefined
      : visibleCommunities.find(community => String(community.human_readable_id) === String(selected.parent))
    const childIds = new Set((selected.children || []).map(String))
    const children = visibleCommunities
      .filter(community => String(community.parent) === String(selected.human_readable_id) || childIds.has(String(community.human_readable_id)))
      .filter((community, index, all) => all.findIndex(candidate => candidate.id === community.id) === index)
      .sort((a, b) => a.level - b.level)
    return { selected, parent, children }
  }, [selectedNode, visibleCommunities, communityMode])

  const connected = React.useMemo(() => {
    if (!selectedNode) return []
    const nodes = new Map<string, { node: Node3D; weight: number }>()
    connectedLinks.forEach(link => {
      const node = link.source.id === selectedNode.id ? link.target : link.source
      const current = nodes.get(node.id)
      if (!current || link.weight > current.weight) nodes.set(node.id, { node, weight: link.weight })
    })
    return Array.from(nodes.values()).sort((a, b) => b.weight - a.weight)
  }, [selectedNode, connectedLinks])

  const relationships = React.useMemo(
    () => [...connectedLinks].sort((a, b) => b.weight - a.weight),
    [connectedLinks]
  )

  if (!selectedNode) {
    return (
      <aside className="flex h-full min-h-0 flex-col bg-[#05080b]/62 backdrop-blur-2xl" aria-label="Inspector">
        <header className="flex h-12 shrink-0 items-center border-b bg-white/[0.025] px-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Inspector</span>
        </header>
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <div>
            <div className="text-[13px] font-medium">No entity selected</div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Select a node to inspect its evidence, community and strongest relationships.</p>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[#05080b]/62 text-[12px] backdrop-blur-2xl" aria-label="Inspector">
      <header className="flex min-h-12 shrink-0 items-start justify-between border-b bg-white/[0.025] px-4 py-2.5">
        <div className="min-w-0 pr-3">
          {projectName && <div className="mb-1 truncate font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">{projectName}</div>}
          <div className="flex items-center gap-2 text-[13px] font-medium leading-5">
            <EntityIcon type={selectedNode.type} />
            <span className="truncate">{selectedNode.title}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            {selectedNode.type} · ID {selectedNode.human_readable_id}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-none" onClick={onClose} aria-label="Clear selection">
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <section className="grid shrink-0 grid-cols-4 border-b bg-[#05080b]/60 backdrop-blur-md" aria-label="Entity statistics">
        {[
          ['Links', selectedNode.degree],
          ['Frequency', selectedNode.frequency],
          ['Level', selectedNode.community?.level ?? '—'],
          ['Entities', selectedNode.community?.size ?? '—'],
        ].map(([label, value]) => (
          <div key={label} className="border-r px-3 py-2 last:border-r-0">
            <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
            <div className="mt-0.5 font-mono text-[12px] tabular-nums">{value}</div>
          </div>
        ))}
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto" data-hmi-scroll>
        <section>
          <SectionLabel icon={<FileText className="h-3 w-3" />}>Description</SectionLabel>
          <p className="px-4 py-3 text-[12px] leading-5 text-muted-foreground">{selectedNode.description || 'No description available.'}</p>
        </section>

        {hierarchy && communityMode === 'auto' && (
          <section className="border-t">
            <SectionLabel icon={<GitBranch className="h-3 w-3" />}>Community</SectionLabel>
            {hierarchy.parent && (
              <div className="grid grid-cols-[42px_1fr_52px] items-center border-b px-4 py-2">
                <span className="font-mono text-[9px] uppercase text-muted-foreground">Parent</span>
                <span className="truncate text-[11px]">{hierarchy.parent.title}</span>
                <span className="text-right font-mono text-[9px] text-muted-foreground">L{hierarchy.parent.level}</span>
              </div>
            )}
            <div className="grid grid-cols-[42px_1fr_52px] items-center border-b bg-white/[0.025] px-4 py-2">
              <span className="font-mono text-[9px] uppercase text-foreground">Current</span>
              <span className="truncate text-[11px] font-medium">{hierarchy.selected.title}</span>
              <span className="text-right font-mono text-[9px] text-muted-foreground">L{hierarchy.selected.level}</span>
            </div>
            {hierarchy.children.map(community => (
              <div key={community.id} className="grid grid-cols-[42px_1fr_52px] items-center border-b px-4 py-2">
                <span className="font-mono text-[9px] uppercase text-muted-foreground">Child</span>
                <span className="truncate text-[11px]">{community.title}</span>
                <span className="text-right font-mono text-[9px] text-muted-foreground">L{community.level}</span>
              </div>
            ))}
          </section>
        )}

        {relationships.length > 0 && (
          <section className="border-t">
            <SectionLabel icon={<Link2 className="h-3 w-3" />}>Strongest relationships · {relationships.length}</SectionLabel>
            {relationships.slice(0, 8).map(link => {
              const other = link.source.id === selectedNode.id ? link.target : link.source
              return (
                <button key={link.id} className="grid w-full grid-cols-[1fr_42px] border-b px-4 py-2.5 text-left hover:bg-white/[0.035]" onClick={() => onNodeSelect(other)}>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-medium">{other.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-muted-foreground">{link.description}</span>
                  </span>
                  <span className="text-right font-mono text-[10px] tabular-nums text-muted-foreground">{link.weight}</span>
                </button>
              )
            })}
          </section>
        )}

        {connected.length > 0 && (
          <section className="border-t">
            <SectionLabel icon={<Network className="h-3 w-3" />}>Connected entities · {connected.length}</SectionLabel>
            {connected.map(({ node, weight }) => (
              <button key={node.id} className="grid min-h-9 w-full grid-cols-[1fr_48px] items-center border-b px-4 text-left hover:bg-white/[0.035]" onClick={() => onNodeSelect(node)}>
                <span className="min-w-0">
                  <span className="block truncate text-[11px]">{node.title}</span>
                  <span className="block font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">{node.type}</span>
                </span>
                <span className="text-right font-mono text-[9px] tabular-nums text-muted-foreground">{weight}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </aside>
  )
}
