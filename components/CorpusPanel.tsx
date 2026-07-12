'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FilePlus, FolderOpen, Loader2, Pencil, Play, Plus, RotateCcw, Square, Terminal, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Upload = {
  name: string
  size: number
  mtime: number
  type: 'txt' | 'pdf'
  status?: string
}

type CorpusState = {
  uploads: Upload[]
  outputStats?: {
    entities?: number
    relationships?: number
    communities?: number
    text_units?: number
    last_index_time?: string
  }
  queue: { name: string; status: 'pending' | 'processing' | 'done' | 'error'; message?: string }[]
  kgName?: string
}

type ArchiveEntry = { name: string; kgName?: string; sizeKB: number }

const formatSize = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
const formatUploadStatus = (status?: string) => status === 'pending_removal' ? 'remove after build' : (status || 'pending').replaceAll('_', ' ')
const formatElapsed = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`

export default function CorpusPanel({ onProjectNamed, onProjectDeleted }: { onProjectNamed?: (name: string) => void; onProjectDeleted?: () => void }) {
  const [state, setState] = useState<CorpusState>({ uploads: [], queue: [] })
  const [archives, setArchives] = useState<ArchiveEntry[]>([])
  const [persistedLogs, setPersistedLogs] = useState<{ ts: number; text: string }[]>([])
  const [liveLogs, setLiveLogs] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'failed' | 'succeeded'>('idle')
  const [stopping, setStopping] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(true)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [currentNameDraft, setCurrentNameDraft] = useState('')
  const [editingCurrentName, setEditingCurrentName] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [editingArchive, setEditingArchive] = useState<string | null>(null)
  const [archiveNameDraft, setArchiveNameDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [pendingCurrentDelete, setPendingCurrentDelete] = useState(false)
  const [progress, setProgress] = useState(0)
  const sseRef = useRef<EventSource | null>(null)
  const logContainerRef = useRef<HTMLDivElement | null>(null)
  const wasRunningRef = useRef(false)

  const loadLogs = useCallback(async () => {
    try {
      const response = await fetch('/api/corpus/logs', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      setPersistedLogs(Array.isArray(data) ? data : [])
    } catch {}
  }, [])

  const refreshArchives = useCallback(async () => {
    try {
      const response = await fetch('/api/corpus/archive/list', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      const entries = Array.isArray(data?.archives) ? data.archives : []
      setArchives(entries.map((entry: ArchiveEntry) => ({
        name: String(entry.name || ''),
        kgName: entry.kgName ? String(entry.kgName) : undefined,
        sizeKB: Number(entry.sizeKB || 0),
      })))
    } catch {}
  }, [])

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/corpus/state', { cache: 'no-store' })
      if (response.ok) setState(await response.json())
    } finally {
      setLoading(false)
    }
    await Promise.all([loadLogs(), refreshArchives()])
  }, [loadLogs, refreshArchives])

  useEffect(() => { refresh() }, [refresh])

  // The index job is server-owned and survives this panel unmounting, so the
  // panel resynchronizes against /status: reattach to a running build, and
  // pick up the terminal outcome of a build that finished while closed.
  useEffect(() => {
    let cancelled = false
    const syncJob = async () => {
      try {
        const response = await fetch('/api/corpus/index/status', { cache: 'no-store' })
        if (!response.ok || cancelled) return
        const job = await response.json() as { running?: boolean; status?: string; startedAt?: number | null; progress?: number }
        const isRunning = job.running === true
        setRunning(isRunning)
        if (typeof job.progress === 'number') setProgress(job.progress)
        if (isRunning) {
          setRunStatus('running')
          if (job.startedAt) setStartTime(job.startedAt)
          await loadLogs()
        } else {
          if (wasRunningRef.current) {
            setStartTime(null)
            await Promise.all([loadLogs(), refresh()])
            if (job.status === 'succeeded') notifyGraph('graph-data-updated')
          }
          setRunStatus(job.status === 'succeeded' ? 'succeeded' : job.status === 'failed' ? 'failed' : 'idle')
        }
        wasRunningRef.current = isRunning
      } catch {}
    }
    syncJob()
    const timer = window.setInterval(syncJob, 1000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [loadLogs, refresh])

  useEffect(() => {
    setCurrentNameDraft(state.kgName || '')
    if (!loading && !state.kgName?.trim()) setEditingCurrentName(true)
  }, [loading, state.kgName])

  useEffect(() => {
    if (!running || !startTime) return
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [running, startTime])

  useEffect(() => {
    const element = logContainerRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [persistedLogs, liveLogs])

  const notifyGraph = (event: 'graph-data-updated' | 'graph-data-cleared') => {
    window.dispatchEvent(new Event(event))
  }

  const saveCurrentName = async () => {
    const next = currentNameDraft.trim()
    if (!next || next === state.kgName) return
    const response = await fetch('/api/corpus/kg/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    })
    if (response.ok) {
      setEditingCurrentName(false)
      await refresh()
      onProjectNamed?.(next)
    }
  }

  const newProject = async () => {
    const name = newProjectName.trim()
    if (!name) return
    const response = await fetch('/api/corpus/archive/create', { method: 'POST' })
    if (!response.ok) return
    await fetch('/api/corpus/kg/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setLiveLogs([])
    setRunStatus('idle')
    notifyGraph('graph-data-cleared')
    setNewProjectName('')
    setCreatingProject(false)
    await refresh()
    onProjectNamed?.(name)
  }

  const restoreArchive = async (name: string) => {
    const response = await fetch('/api/corpus/archive/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) return
    // The restored project brings its own terminal history; drop this one's.
    setLiveLogs([])
    setRunStatus('idle')
    const restored = archives.find(project => project.name === name)
    onProjectNamed?.(restored?.kgName || name)
    await refresh()
    notifyGraph('graph-data-updated')
  }

  const renameArchive = async (from: string) => {
    const to = archiveNameDraft.trim()
    if (!to || to === from) return
    const response = await fetch('/api/corpus/archive/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    })
    if (response.ok) {
      setEditingArchive(null)
      setArchiveNameDraft('')
      await refreshArchives()
    }
  }

  const deleteArchive = async (name: string) => {
    const response = await fetch('/api/corpus/archive/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (response.ok) {
      setPendingDelete(null)
      await refreshArchives()
    }
  }

  const deleteCurrentProject = async () => {
    const response = await fetch('/api/corpus/project/delete', { method: 'POST' })
    if (!response.ok) return
    setPendingCurrentDelete(false)
    setLiveLogs([])
    notifyGraph('graph-data-cleared')
    await refresh()
    onProjectDeleted?.()
  }

  const uploadFiles = async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) return
    const body = new FormData()
    pdfs.forEach(file => body.append('files', file))
    setUploading(true)
    try {
      const response = await fetch('/api/corpus/upload', { method: 'POST', body })
      if (response.ok) await refresh()
    } finally {
      setUploading(false)
    }
  }

  const removeFile = async (name: string) => {
    const response = await fetch('/api/corpus/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (response.ok) await refresh()
  }

  const startIndex = () => {
    if (running) return
    setPersistedLogs([])
    setLiveLogs([])
    setElapsed(0)
    setProgress(0)
    setStartTime(Date.now())
    setRunning(true)
    setRunStatus('running')
    const source = new EventSource('/api/corpus/index/stream')
    sseRef.current = source
    source.onmessage = event => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'log') setLiveLogs(previous => [...previous, message.line])
        if (message.type === 'progress' && typeof message.value === 'number') setProgress(message.value)
        // New artifacts were converted mid-build; let the constellation
        // populate immediately instead of waiting for the pipeline to finish.
        if (message.type === 'partial') notifyGraph('graph-data-updated')
        if (message.type === 'done') {
          setRunning(false)
          setRunStatus(message.ok === true ? 'succeeded' : 'failed')
          setStartTime(null)
          source.close()
          refresh()
          if (message.ok === true) notifyGraph('graph-data-updated')
        }
      } catch {}
    }
    source.onerror = () => {
      source.close()
    }
  }

  const stopIndex = async () => {
    if (stopping) return
    setStopping(true)
    try {
      const response = await fetch('/api/corpus/index/stop', { method: 'POST' })
      if (!response.ok) return
      sseRef.current?.close()
      sseRef.current = null
      setRunning(false)
      setRunStatus('idle')
      setStartTime(null)
      await loadLogs()
    } finally {
      setStopping(false)
    }
  }

  const stats = state.outputStats
  const files = state.uploads.filter(file => file.type === 'pdf')
  const mergedLogs = React.useMemo(() => {
    const persistedText = new Set(persistedLogs.map(entry => entry.text.trim()))
    return [
      ...persistedLogs.map(entry => ({ ts: entry.ts, text: entry.text })),
      ...liveLogs.filter(text => !persistedText.has(text.trim())).map((text, index) => ({ ts: Date.now() + index, text })),
    ]
  }, [liveLogs, persistedLogs])
  const terminalLines = React.useMemo(() => {
    const lines = mergedLogs.flatMap(entry => entry.text.split(/\r?\n/).filter(Boolean).map(text => ({ ts: entry.ts, text })))
    const completed = new Set(lines.map(line => line.text.match(/Workflow complete:\s*(.+)/i)?.[1]?.trim()).filter(Boolean) as string[])
    const failed = lines.some(line => /Pipeline error:|completed with errors/i.test(line.text)) || runStatus === 'failed'
    const lastLine = lines.length - 1
    return lines.map((line, index) => {
      const starting = line.text.match(/Starting workflow:\s*(.+)/i)?.[1]?.trim()
      const complete = line.text.match(/Workflow complete:\s*(.+)/i)?.[1]?.trim()
      const isError = /Pipeline error:|completed with errors|INGEST BLOCKED|INGEST STOPPED/i.test(line.text)
      const state: 'active' | 'success' | 'error' | undefined = isError
        ? 'error'
        : complete || (starting && completed.has(starting))
          ? 'success'
          : starting && failed
            ? 'error'
            : starting || (running && index === lastLine)
              ? 'active'
              : undefined
      return { ...line, state }
    })
  }, [mergedLogs, runStatus, running])

  const hasName = Boolean(state.kgName?.trim())

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(180px,0.55fr)] bg-[#05080b]/72 text-[12px] backdrop-blur-2xl" data-hmi-root>
      <nav className="row-start-1 flex min-h-0 flex-col border-r border-white/12 bg-black/20" aria-label="Projects">
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5" /> Projects
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={() => setCreatingProject(true)} title="Create project">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {creatingProject && (
          <form className="border-b p-2" onSubmit={event => { event.preventDefault(); newProject() }}>
            <Input autoFocus value={newProjectName} onChange={event => setNewProjectName(event.target.value)} placeholder="Project name" className="h-8 rounded-none text-[11px]" />
            <div className="mt-1 flex justify-end gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 rounded-none text-[10px]" onClick={() => { setCreatingProject(false); setNewProjectName('') }}>Cancel</Button>
              <Button type="submit" size="sm" className="h-7 rounded-none text-[10px]" disabled={!newProjectName.trim()}>Create</Button>
            </div>
          </form>
        )}

        <div className="min-h-0 flex-1 overflow-auto" data-hmi-scroll>
          {hasName && (
            <div className="flex h-12 flex-col justify-center border-b border-l-2 border-l-primary bg-white/[0.035] px-3">
              <div className="truncate text-[11px] font-medium">{state.kgName}</div>
              <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">Active · local</div>
            </div>
          )}
          {archives.map(project => {
            const isEditing = editingArchive === project.name
            const isDeleting = pendingDelete === project.name
            return (
              <div key={project.name} className="border-b px-3 py-2">
                {isEditing ? (
                  <form className="flex gap-1" onSubmit={event => { event.preventDefault(); renameArchive(project.name) }}>
                    <Input autoFocus value={archiveNameDraft} onChange={event => setArchiveNameDraft(event.target.value)} className="h-7 min-w-0 rounded-none text-[10px]" />
                    <Button type="submit" variant="ghost" size="icon" className="h-7 w-7 rounded-none" aria-label="Save name"><Check className="h-3 w-3" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={() => setEditingArchive(null)} aria-label="Cancel"><X className="h-3 w-3" /></Button>
                  </form>
                ) : (
                  <>
                    <button className="block w-full truncate text-left text-[11px] hover:underline" onClick={() => restoreArchive(project.name)}>{project.kgName || project.name}</button>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-mono text-[8px] uppercase text-muted-foreground">{project.sizeKB.toFixed(1)} KB</span>
                      <div className="flex">
                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-none" onClick={() => { setEditingArchive(project.name); setArchiveNameDraft(project.kgName || project.name) }} title="Rename"><Pencil className="h-3 w-3" /></Button>
                        {isDeleting ? (
                          <Button variant="destructive" size="sm" className="h-6 rounded-none px-2 text-[9px]" onClick={() => deleteArchive(project.name)}>Confirm</Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-none" onClick={() => setPendingDelete(project.name)} title="Delete"><Trash2 className="h-3 w-3" /></Button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {!archives.length && hasName && <div className="px-3 py-3 text-[10px] text-muted-foreground">No other projects.</div>}
        </div>
      </nav>

      <main className="relative row-start-1 flex min-h-0 min-w-0 flex-col bg-[#05080b]/38 backdrop-blur-xl">
        {!hasName ? (
          <div className="flex h-full items-center justify-center p-8">
            <form className="w-full max-w-sm border-y border-white/12 py-6" onSubmit={event => { event.preventDefault(); saveCurrentName() }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-primary">Project identity required</div>
              <h2 className="mt-2 text-[16px] font-medium">Name this project</h2>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Use a human-readable name. It identifies this graph in the local project switcher and archive.</p>
              <Input autoFocus value={currentNameDraft} onChange={event => setCurrentNameDraft(event.target.value)} placeholder="e.g. Offshore autonomy research" className="mt-4 h-9 rounded-none" />
              <Button type="submit" className="mt-2 h-9 w-full rounded-none text-[11px]" disabled={!currentNameDraft.trim()}>Continue</Button>
            </form>
          </div>
        ) : (
          <>
            <header className="flex h-12 shrink-0 items-center justify-between border-b pl-4 pr-12">
              {editingCurrentName ? (
                <form className="flex min-w-0 flex-1 items-center gap-1 pr-4" onSubmit={event => { event.preventDefault(); saveCurrentName() }}>
                  <Input autoFocus value={currentNameDraft} onChange={event => setCurrentNameDraft(event.target.value)} className="h-8 max-w-sm rounded-none text-[12px]" />
                  <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 rounded-none" aria-label="Save name"><Check className="h-3.5 w-3.5" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={() => { setEditingCurrentName(false); setCurrentNameDraft(state.kgName || '') }} aria-label="Cancel"><X className="h-3.5 w-3.5" /></Button>
                </form>
              ) : (
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="truncate text-[13px] font-medium">{state.kgName}</span><Button variant="ghost" size="icon" className="h-6 w-6 rounded-none" onClick={() => setEditingCurrentName(true)} title="Rename"><Pencil className="h-3 w-3" /></Button></div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{running ? `Indexing · ${elapsed}s` : stats ? 'Indexed · local' : 'Not indexed · local'}</div>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={refresh} title="Refresh"><RotateCcw className="h-3.5 w-3.5" /></Button>
                {pendingCurrentDelete ? (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-8 rounded-none text-[9px]" onClick={() => setPendingCurrentDelete(false)}>Cancel</Button>
                    <Button variant="destructive" size="sm" className="h-8 rounded-none text-[9px]" onClick={deleteCurrentProject}>Delete project</Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={() => setPendingCurrentDelete(true)} title="Delete active project"><Trash2 className="h-3.5 w-3.5" /></Button>
                )}
                {running ? <Button variant="destructive" size="sm" className="h-8 rounded-none text-[10px]" onClick={stopIndex} disabled={stopping}>{stopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />} {stopping ? 'Stopping' : 'Stop'}</Button> : <Button size="sm" className="h-8 rounded-none text-[10px]" onClick={startIndex} disabled={!files.length}><Play className="h-3 w-3" /> Build graph</Button>}
              </div>
            </header>

            <section className="grid h-12 shrink-0 grid-cols-4 border-b" aria-label="Project statistics">
              {[["Entities", stats?.entities ?? 0], ["Relations", stats?.relationships ?? 0], ["Communities", stats?.communities ?? 0], ["Text units", stats?.text_units ?? 0]].map(([label, value]) => (
                <div key={label} className="flex flex-col justify-center border-r px-3 last:border-r-0"><div className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div><div className="mt-0.5 font-mono text-[12px] tabular-nums">{loading ? '—' : value}</div></div>
              ))}
            </section>

            <section className={`min-h-0 flex-1 border-b ${dragOver ? 'bg-white/5' : ''}`} onDragOver={event => { event.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={event => { event.preventDefault(); setDragOver(false); if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files) }}>
                <div className="flex h-9 min-w-0 items-center justify-between gap-2 overflow-hidden border-b px-3"><span className="min-w-0 truncate font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Source files · {files.length}</span><div className="shrink-0"><Input id="project-file-input" type="file" multiple accept=".pdf" className="hidden" onChange={event => event.target.files && uploadFiles(event.target.files)} /><Button variant="ghost" size="sm" className="h-7 shrink-0 whitespace-nowrap rounded-none px-2 text-[10px]" onClick={() => document.getElementById('project-file-input')?.click()}>{uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FilePlus className="h-3 w-3" />} Add PDFs</Button></div></div>
                <div className="h-[calc(100%-2.25rem)] overflow-auto" data-hmi-scroll>
                  {!files.length ? <button className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground" onClick={() => document.getElementById('project-file-input')?.click()}>Drop PDFs here or choose files</button> : files.map(file => <div key={file.name} className="grid min-h-9 grid-cols-[minmax(0,1fr)_72px_112px_32px] items-center border-b px-4 text-[10px]"><a className="truncate hover:underline" href={`/api/corpus/file?name=${encodeURIComponent(file.name)}`} target="_blank" rel="noreferrer">{file.name}</a><span className="text-right font-mono text-[9px] text-muted-foreground">{formatSize(file.size)}</span><span className="text-right font-mono text-[8px] uppercase text-muted-foreground">{formatUploadStatus(file.status)}</span><Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" disabled={file.status === 'pending_removal'} onClick={() => removeFile(file.name)} title={file.status === 'pending_removal' ? 'Removal scheduled for next successful build' : `Remove ${file.name}`}><Trash2 className="h-3 w-3" /></Button></div>)}
                </div>
            </section>
          </>
        )}
      </main>
      {hasName && (
        <section className="col-span-2 row-start-2 flex min-h-0 min-w-0 flex-col border-t border-white/10 bg-black/35 text-neutral-200">
          <div className="flex h-9 min-w-0 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-white/10 px-3"><span className="flex min-w-0 items-center gap-2 truncate font-mono text-[9px] uppercase tracking-[0.1em] text-neutral-400"><Terminal className="h-3 w-3 shrink-0" /> Terminal</span><span className={`max-w-[45%] shrink-0 truncate whitespace-nowrap text-right font-mono text-[8px] tabular-nums uppercase ${runStatus === 'failed' ? 'text-red-400' : runStatus === 'succeeded' ? 'text-green-400' : running ? 'text-primary' : 'text-neutral-500'}`}>{running ? `Running ${formatElapsed(elapsed)} · ${progress}%` : runStatus}</span></div>
          <div ref={logContainerRef} className="min-h-0 flex-1 overflow-auto font-mono text-[9px] leading-4" data-hmi-scroll>{!terminalLines.length ? <div className="px-4 py-3 text-neutral-600">No process output.</div> : terminalLines.map((entry, index) => <div key={`${entry.ts}-${index}`} className={`grid min-w-0 grid-cols-[36px_18px_minmax(0,1fr)] border-b border-white/[0.04] px-2 py-0.5 ${entry.state === 'error' ? 'bg-red-500/[0.06] text-red-300' : entry.state === 'success' ? 'text-green-300' : 'text-neutral-300'}`}><span className="select-none pr-2 text-right tabular-nums text-neutral-600">{index + 1}</span><span className="flex items-start justify-center pt-0.5">{entry.state === 'active' ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : entry.state === 'success' ? <Check className="h-3 w-3 text-green-400" /> : entry.state === 'error' ? <X className="h-3 w-3 text-red-400" /> : null}</span><span className="min-w-0 whitespace-pre-wrap break-words">{entry.text.trim()}</span></div>)}</div>
        </section>
      )}
    </div>
  )
}
