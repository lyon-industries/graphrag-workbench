'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Cloud, Download, FileInput, FilePlus, FolderInput, FolderOpen, HardDrive, Loader2, Pencil, Plus, RotateCcw, Settings2, Square, Terminal, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProviderSetupDialog, type ProviderStatus } from '@/components/ProviderSetupDialog'

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
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
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
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [providerSetupOpen, setProviderSetupOpen] = useState(false)
  const [providerSetupTab, setProviderSetupTab] = useState<'local' | 'cloud'>('local')
  const [activeBuildProvider, setActiveBuildProvider] = useState<'local' | 'cloud' | null>(null)
  const [jobProjectName, setJobProjectName] = useState<string | null>(null)
  const [anyJobRunning, setAnyJobRunning] = useState(false)
  const [jobModel, setJobModel] = useState<string | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  const logContainerRef = useRef<HTMLDivElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const bundleInputRef = useRef<HTMLInputElement | null>(null)
  const wasAnyJobRunningRef = useRef(false)

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

  const refreshProviders = useCallback(async () => {
    try {
      const response = await fetch('/api/providers', { cache: 'no-store' })
      if (response.ok) setProviderStatus(await response.json())
    } catch {}
  }, [])

  useEffect(() => { void refreshProviders() }, [refreshProviders])

  useEffect(() => {
    importInputRef.current?.setAttribute('webkitdirectory', '')
    importInputRef.current?.setAttribute('directory', '')
  }, [])

  // The index job is server-owned and survives this panel unmounting, so the
  // panel resynchronizes against /status: reattach to a running build, and
  // pick up the terminal outcome of a build that finished while closed.
  useEffect(() => {
    let cancelled = false
    const syncJob = async () => {
      try {
        const response = await fetch('/api/corpus/index/status', { cache: 'no-store' })
        if (!response.ok || cancelled) return
        const job = await response.json() as { running?: boolean; status?: string; startedAt?: number | null; progress?: number; buildProvider?: 'local' | 'cloud' | null; projectName?: string | null; completionModel?: string | null }
        const isRunning = job.running === true
        const selectedProjectIsRunning = isRunning && job.projectName === state.kgName
        setAnyJobRunning(isRunning)
        setJobProjectName(job.projectName ?? null)
        setJobModel(job.completionModel ?? null)
        setRunning(selectedProjectIsRunning)
        setActiveBuildProvider(job.buildProvider ?? null)
        if (typeof job.progress === 'number') setProgress(job.progress)
        if (selectedProjectIsRunning) {
          setRunStatus('running')
          if (job.startedAt) setStartTime(job.startedAt)
          await loadLogs()
        } else {
          if (wasAnyJobRunningRef.current) {
            setStartTime(null)
            await Promise.all([loadLogs(), refresh()])
            if (job.status === 'succeeded' && job.projectName === state.kgName) notifyGraph('graph-data-updated')
          }
          if (job.projectName === state.kgName) {
            setRunStatus(job.status === 'succeeded' ? 'succeeded' : job.status === 'failed' ? 'failed' : 'idle')
          }
        }
        wasAnyJobRunningRef.current = isRunning
      } catch {}
    }
    syncJob()
    const timer = window.setInterval(syncJob, 1000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [loadLogs, refresh, state.kgName])

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
    sseRef.current?.close()
    sseRef.current = null
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

  const importOutput = async (selection: FileList | null) => {
    const files = selection ? Array.from(selection) : []
    if (!files.length || importing) return
    const body = new FormData()
    files.forEach(file => body.append('files', file, file.webkitRelativePath || file.name))
    setImporting(true)
    setImportError(null)
    try {
      const response = await fetch('/api/corpus/import', { method: 'POST', body })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) {
        setImportError(result.error || 'Output import failed.')
        return
      }
      setLiveLogs([])
      await refresh()
      notifyGraph('graph-data-updated')
    } catch {
      setImportError('Output import failed.')
    } finally {
      setImporting(false)
      if (importInputRef.current) importInputRef.current.value = ''
      if (bundleInputRef.current) bundleInputRef.current.value = ''
    }
  }

  const startIndex = (provider: 'local' | 'cloud') => {
    if (anyJobRunning) return
    if (!providerStatus?.[provider].ready) {
      setProviderSetupTab(provider)
      setProviderSetupOpen(true)
      return
    }
    setPersistedLogs([])
    setLiveLogs([])
    setElapsed(0)
    setProgress(0)
    setStartTime(Date.now())
    setRunning(true)
    setRunStatus('running')
    setActiveBuildProvider(provider)
    setJobProjectName(state.kgName || null)
    setAnyJobRunning(true)
    const source = new EventSource(`/api/corpus/index/stream?provider=${provider}`)
    sseRef.current = source
    source.onmessage = event => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'log') setLiveLogs(previous => [...previous, message.line])
        if (message.type === 'progress' && typeof message.value === 'number') setProgress(message.value)
        // Builds run in an isolated workspace. The selected graph updates only
        // after the complete artifact set is published back to its
        // originating project.
        if (message.type === 'done') {
          setAnyJobRunning(false)
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
      setAnyJobRunning(false)
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
    const lines = mergedLogs
      .flatMap(entry => entry.text.split(/[\r\n]+/).filter(Boolean).map(text => ({ ts: entry.ts, text: text.trim() })))
      .filter(line => !/^\d+\s*\/\s*\d+(?:\s+\.*)?$/.test(line.text))
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
      const kind = isError || /ENGINE ERROR|FATAL|PUBLISH FAILED/i.test(line.text)
        ? 'error'
        : /warning/i.test(line.text)
          ? 'warning'
          : complete || /PUBLISHED ·|Pipeline complete|Converted \d+ parquet/i.test(line.text)
            ? 'success'
            : starting
              ? 'workflow'
              : /BUILD ·|Starting pipeline|LIVE VIEW ·|PENDING REMOVAL/i.test(line.text)
                ? 'system'
                : 'output'
      return { ...line, state, kind }
    })
  }, [mergedLogs, runStatus, running])

  const hasName = Boolean(state.kgName?.trim())

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(180px,0.55fr)] bg-[#05080b]/72 text-[12px] backdrop-blur-2xl">
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
              <div className="flex items-center gap-2">
                {anyJobRunning && jobProjectName === state.kgName && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" aria-label="Build running" />}
                <div className="truncate text-[11px] font-medium">{state.kgName}</div>
              </div>
              <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">{anyJobRunning && jobProjectName === state.kgName ? `Building · ${progress}%` : 'Active · local'}</div>
            </div>
          )}
          {archives.map(project => {
            const isEditing = editingArchive === project.name
            const isDeleting = pendingDelete === project.name
            const isBuilding = anyJobRunning && jobProjectName === (project.kgName || project.name)
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
                    <button className="flex w-full items-center gap-2 text-left text-[11px] hover:underline" onClick={() => restoreArchive(project.name)}>
                      {isBuilding && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" aria-label="Build running" />}
                      <span className="truncate">{project.kgName || project.name}</span>
                    </button>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-mono text-[8px] uppercase text-muted-foreground">{isBuilding ? `Building · ${progress}%` : `${project.sizeKB.toFixed(1)} KB`}</span>
                      <div className="flex">
                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-none" disabled={isBuilding} onClick={() => { setEditingArchive(project.name); setArchiveNameDraft(project.kgName || project.name) }} title={isBuilding ? 'Stop the build before renaming' : 'Rename'}><Pencil className="h-3 w-3" /></Button>
                        {isDeleting ? (
                          <Button variant="destructive" size="sm" className="h-6 rounded-none px-2 text-[9px]" onClick={() => deleteArchive(project.name)}>Confirm</Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-none" disabled={isBuilding} onClick={() => setPendingDelete(project.name)} title={isBuilding ? 'Stop the build before deleting' : 'Delete'}><Trash2 className="h-3 w-3" /></Button>
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
                  <div className="flex items-center gap-2"><span className="truncate text-[13px] font-medium">{state.kgName}</span><Button variant="ghost" size="icon" className="h-6 w-6 rounded-none" disabled={running} onClick={() => setEditingCurrentName(true)} title={running ? 'Stop the build before renaming' : 'Rename'}><Pencil className="h-3 w-3" /></Button></div>
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
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={() => setProviderSetupOpen(true)} title="Configure build providers"><Settings2 className="h-3.5 w-3.5" /></Button>
                {running ? (
                  <Button variant="destructive" size="sm" className="h-8 rounded-none text-[10px]" onClick={stopIndex} disabled={stopping}>{stopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />} {stopping ? 'Stopping' : `Stop ${activeBuildProvider || ''}`}</Button>
                ) : anyJobRunning ? (
                  <div className="flex h-8 max-w-[230px] items-center gap-2 border border-white/10 px-3 font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground" title={`Build continues for ${jobProjectName || 'another project'}`}>
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                    <span className="truncate">Background · {jobProjectName}</span>
                  </div>
                ) : (
                  <>
                    <Button variant="outline" size="sm" className="h-8 rounded-none text-[10px]" onClick={() => startIndex('local')} disabled={!files.length}><HardDrive className="h-3 w-3" /> Run with Ollama</Button>
                    <Button size="sm" className="h-8 rounded-none text-[10px]" onClick={() => startIndex('cloud')} disabled={!files.length}><Cloud className="h-3 w-3" /> Run with OpenAI</Button>
                  </>
                )}
              </div>
            </header>

            <section className="grid h-12 shrink-0 grid-cols-4 border-b" aria-label="Project statistics">
              {[["Entities", stats?.entities ?? 0], ["Relations", stats?.relationships ?? 0], ["Communities", stats?.communities ?? 0], ["Text units", stats?.text_units ?? 0]].map(([label, value]) => (
                <div key={label} className="flex flex-col justify-center border-r px-3 last:border-r-0"><div className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div><div className="mt-0.5 font-mono text-[12px] tabular-nums">{loading ? '—' : value}</div></div>
              ))}
            </section>

            <section className={`min-h-0 flex-1 border-b ${dragOver ? 'bg-white/5' : ''}`} onDragOver={event => { event.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={event => { event.preventDefault(); setDragOver(false); if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files) }}>
                <div className="flex h-9 min-w-0 items-center justify-between gap-2 overflow-hidden border-b px-3">
                  <span className={`min-w-0 truncate font-mono text-[9px] uppercase tracking-[0.1em] ${importError ? 'text-red-400' : 'text-muted-foreground'}`}>{importError || `Source files · ${files.length}`}</span>
                  <div className="flex shrink-0 items-center">
                    <Input ref={importInputRef} type="file" multiple accept=".json,.parquet" className="hidden" onChange={event => void importOutput(event.target.files)} />
                    <Input ref={bundleInputRef} type="file" accept=".json,.graphrag.json" className="hidden" onChange={event => void importOutput(event.target.files)} />
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-none" disabled={running || importing} onClick={() => importInputRef.current?.click()} title="Import a GraphRAG output directory">{importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderInput className="h-3 w-3" />}</Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-none" disabled={running || importing} onClick={() => bundleInputRef.current?.click()} title="Import a GraphRAG Workbench bundle"><FileInput className="h-3 w-3" /></Button>
                    <Button asChild variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-none" title="Export this project's graph output"><a href="/api/corpus/export" download><Download className="h-3 w-3" /><span className="sr-only">Export output</span></a></Button>
                    <Input id="project-file-input" type="file" multiple accept=".pdf" className="hidden" onChange={event => event.target.files && uploadFiles(event.target.files)} />
                    <Button variant="ghost" size="sm" className="h-7 shrink-0 whitespace-nowrap rounded-none px-2 text-[10px]" onClick={() => document.getElementById('project-file-input')?.click()}>{uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FilePlus className="h-3 w-3" />} Add PDFs</Button>
                  </div>
                </div>
                <div className="h-[calc(100%-2.25rem)] overflow-auto" data-hmi-scroll>
                  {!files.length ? <button className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground" onClick={() => document.getElementById('project-file-input')?.click()}>Drop PDFs here or choose files</button> : files.map(file => <div key={file.name} className="grid min-h-9 grid-cols-[minmax(0,1fr)_72px_112px_32px] items-center border-b px-4 text-[10px]"><a className="truncate hover:underline" href={`/api/corpus/file?name=${encodeURIComponent(file.name)}`} target="_blank" rel="noreferrer">{file.name}</a><span className="text-right font-mono text-[9px] text-muted-foreground">{formatSize(file.size)}</span><span className="text-right font-mono text-[8px] uppercase text-muted-foreground">{formatUploadStatus(file.status)}</span><Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" disabled={file.status === 'pending_removal'} onClick={() => removeFile(file.name)} title={file.status === 'pending_removal' ? 'Removal scheduled for next successful build' : `Remove ${file.name}`}><Trash2 className="h-3 w-3" /></Button></div>)}
                </div>
            </section>
          </>
        )}
      </main>
      {hasName && (
        <section className="col-span-2 row-start-2 flex min-h-0 min-w-0 flex-col border-t border-white/10 bg-[#030506]/88 text-neutral-200">
          <div className="shrink-0 border-b border-white/10 bg-white/[0.018]">
            <div className="flex h-9 min-w-0 items-center justify-between gap-4 px-3">
              <span className="flex min-w-0 items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-300"><Terminal className="h-3 w-3 shrink-0 text-primary" /> Build log <span className="truncate text-[8px] text-neutral-600">{state.kgName}</span></span>
              <div className="flex min-w-0 items-center gap-3 font-mono text-[8px] uppercase tracking-[0.08em] text-neutral-500">
                {running && <span className="max-w-48 truncate">{activeBuildProvider} · {jobModel}</span>}
                <span className={`shrink-0 tabular-nums ${runStatus === 'failed' ? 'text-red-400' : runStatus === 'succeeded' ? 'text-green-400' : running ? 'text-primary' : ''}`}>{running ? `${formatElapsed(elapsed)} · ${progress}%` : runStatus}</span>
              </div>
            </div>
            <div className="h-px bg-white/[0.04]" aria-hidden><div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${running || runStatus === 'succeeded' ? progress : 0}%` }} /></div>
          </div>
          <div ref={logContainerRef} className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[9px] leading-4" data-hmi-scroll aria-label="Build process output">
            {!terminalLines.length ? <div className="px-4 py-4 text-neutral-600">No build output for this project.</div> : terminalLines.map((entry, index) => (
              <div key={`${entry.ts}-${index}`} className={`grid min-w-0 grid-cols-[54px_18px_minmax(0,1fr)] gap-1 px-3 py-1 ${entry.kind === 'error' ? 'bg-red-500/[0.07] text-red-300' : entry.kind === 'warning' ? 'bg-amber-400/[0.04] text-amber-200/80' : entry.kind === 'success' ? 'text-emerald-300/90' : entry.kind === 'workflow' ? 'text-neutral-100' : entry.kind === 'system' ? 'text-[#9fb9cc]' : 'text-neutral-400'}`}>
                <time className="select-none whitespace-nowrap tabular-nums text-neutral-700">{new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</time>
                <span className="flex items-start justify-center pt-0.5">{entry.state === 'active' ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : entry.state === 'success' ? <Check className="h-3 w-3 text-emerald-400" /> : entry.state === 'error' ? <X className="h-3 w-3 text-red-400" /> : <span className="mt-1 h-1 w-1 rounded-full bg-current opacity-30" />}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{entry.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <ProviderSetupDialog open={providerSetupOpen} onOpenChange={setProviderSetupOpen} status={providerStatus} onStatusChange={setProviderStatus} initialTab={providerSetupTab} />
    </div>
  )
}
