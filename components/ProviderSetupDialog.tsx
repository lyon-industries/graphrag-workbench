'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Cloud, Download, ExternalLink, HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type ProviderStatus = {
  local: {
    ready: boolean
    installed: boolean
    running: boolean
    version: string | null
    models: string[]
    completionModel: string
    embeddingModel: string
    embeddingVectorSize: number
    completionReady: boolean
    embeddingReady: boolean
  }
  cloud: {
    ready: boolean
    keyStored: boolean
    completionModel: string
    embeddingModel: string
  }
}

export function ProviderSetupDialog({ open, onOpenChange, status, onStatusChange, initialTab = 'local' }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ProviderStatus | null
  onStatusChange: (status: ProviderStatus) => void
  initialTab?: 'local' | 'cloud'
}) {
  const [tab, setTab] = useState(initialTab)
  const [apiKey, setApiKey] = useState('')
  const [completionModel, setCompletionModel] = useState('gemma4:latest')
  const [embeddingModel, setEmbeddingModel] = useState('embeddinggemma:latest')
  const [embeddingVectorSize, setEmbeddingVectorSize] = useState(768)
  const [cloudCompletionModel, setCloudCompletionModel] = useState('gpt-5.6-luna')
  const [cloudEmbeddingModel, setCloudEmbeddingModel] = useState('text-embedding-3-small')
  const [saving, setSaving] = useState(false)
  const [pulling, setPulling] = useState<string | null>(null)
  const [pullLog, setPullLog] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => { if (open) setTab(initialTab) }, [initialTab, open])
  useEffect(() => {
    if (!status) return
    setCompletionModel(status.local.completionModel)
    setEmbeddingModel(status.local.embeddingModel)
    setEmbeddingVectorSize(status.local.embeddingVectorSize)
    setCloudCompletionModel(status.cloud.completionModel)
    setCloudEmbeddingModel(status.cloud.embeddingModel)
  }, [status])

  const refresh = useCallback(async () => {
    const response = await fetch('/api/providers', { cache: 'no-store' })
    if (response.ok) onStatusChange(await response.json())
  }, [onStatusChange])

  const saveLocal = async () => {
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'local', completionModel, embeddingModel, embeddingVectorSize }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to save local preset')
      onStatusChange(payload)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save local preset') }
    finally { setSaving(false) }
  }

  const saveCloud = async () => {
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'cloud', apiKey, completionModel: cloudCompletionModel, embeddingModel: cloudEmbeddingModel }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to save cloud preset')
      setApiKey('')
      onStatusChange(payload)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save cloud preset') }
    finally { setSaving(false) }
  }

  const removeCloud = async () => {
    const response = await fetch('/api/providers', { method: 'DELETE' })
    if (response.ok) onStatusChange(await response.json())
  }

  const pullModel = (model: string) => {
    setPulling(model); setPullLog([]); setError('')
    const source = new EventSource(`/api/providers/ollama/pull?model=${encodeURIComponent(model)}`)
    source.onmessage = event => {
      const message = JSON.parse(event.data) as { type: string; line?: string; ok?: boolean; error?: string }
      if (message.type === 'progress' && message.line) setPullLog(previous => [...previous.slice(-40), message.line!])
      if (message.type === 'done') {
        source.close(); setPulling(null)
        if (!message.ok) setError(message.error || `Could not pull ${model}`)
        void refresh()
      }
    }
    source.onerror = () => { source.close(); setPulling(null); setError('Ollama pull connection closed'); void refresh() }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86dvh] max-w-2xl overflow-hidden rounded-none border-white/15 bg-[#05080b] p-0 text-[#eaeef0] shadow-none">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <DialogTitle className="font-normal">Build providers</DialogTitle>
          <DialogDescription>Configure two workbench-wide inference bindings. Every GraphRAG project can run through either provider.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={value => setTab(value as 'local' | 'cloud')} className="min-h-0 gap-0">
          <TabsList className="mx-6 mt-5 grid h-10 w-[calc(100%-3rem)] grid-cols-2 rounded-none bg-white/[0.04] p-0">
            <TabsTrigger value="local" className="rounded-none font-mono text-[10px] uppercase tracking-[0.1em]"><HardDrive /> Local / free</TabsTrigger>
            <TabsTrigger value="cloud" className="rounded-none font-mono text-[10px] uppercase tracking-[0.1em]"><Cloud /> Cloud / faster</TabsTrigger>
          </TabsList>

          <TabsContent value="local" className="min-h-0 overflow-auto px-6 py-5" data-hmi-scroll>
            <div className="grid gap-5">
              <div className="grid grid-cols-3 border border-white/10 text-[11px]">
                <StatusCell label="Ollama" ok={status?.local.installed === true} value={status?.local.installed ? 'Installed' : 'Not installed'} />
                <StatusCell label="Service" ok={status?.local.running === true} value={status?.local.running ? 'Responding' : 'Offline'} />
                <StatusCell label="Preset" ok={status?.local.ready === true} value={status?.local.ready ? 'Ready' : 'Needs setup'} />
              </div>
              {!status?.local.installed && (
                <div className="border border-white/10 p-4">
                  <p className="text-sm">Install Ollama, then return here and check again.</p>
                  <p className="mt-1 text-xs text-[#9fb9cc]">macOS 14+, Windows, and Linux are supported by Ollama.</p>
                  <Button asChild className="mt-4 h-10 rounded-none"><a href="https://ollama.com/download" target="_blank" rel="noreferrer">Open official installer <ExternalLink /></a></Button>
                </div>
              )}
              {status?.local.installed && !status.local.running && (
                <div className="border border-amber-400/30 p-4 text-sm">Ollama is installed but its local service is offline. Open the Ollama application, then press Check again.</div>
              )}
              <div className="grid gap-3">
                <label className="grid gap-1.5 text-xs"><span>Extraction model</span><Input value={completionModel} onChange={event => setCompletionModel(event.target.value)} className="rounded-none" /></label>
                <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3 text-xs"><span className="truncate text-[#9fb9cc]">{status?.local.completionReady ? 'Installed' : 'Required'} · {completionModel}</span><Button variant="outline" size="sm" className="rounded-none" disabled={!status?.local.running || pulling !== null} onClick={() => pullModel(completionModel)}>{pulling === completionModel ? <Loader2 className="animate-spin" /> : <Download />} Pull model</Button></div>
                <label className="grid gap-1.5 text-xs"><span>Embedding model</span><Input value={embeddingModel} onChange={event => setEmbeddingModel(event.target.value)} className="rounded-none" /></label>
                <label className="grid gap-1.5 text-xs"><span>Embedding dimensions</span><Input type="number" min={32} max={8192} value={embeddingVectorSize} onChange={event => setEmbeddingVectorSize(Number(event.target.value))} className="rounded-none" /></label>
                <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3 text-xs"><span className="truncate text-[#9fb9cc]">{status?.local.embeddingReady ? 'Installed' : 'Required'} · {embeddingModel}</span><Button variant="outline" size="sm" className="rounded-none" disabled={!status?.local.running || pulling !== null} onClick={() => pullModel(embeddingModel)}>{pulling === embeddingModel ? <Loader2 className="animate-spin" /> : <Download />} Pull model</Button></div>
              </div>
              {pullLog.length > 0 && <pre className="max-h-32 overflow-auto whitespace-pre-wrap border border-white/10 bg-black/40 p-3 font-mono text-[9px] text-[#9fb9cc]" data-hmi-scroll>{pullLog.join('\n')}</pre>}
              <div className="flex justify-between gap-3"><Button variant="outline" className="rounded-none" onClick={refresh}><RefreshCw /> Check again</Button><Button className="rounded-none" onClick={saveLocal} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Check />} Save local preset</Button></div>
            </div>
          </TabsContent>

          <TabsContent value="cloud" className="min-h-0 overflow-auto px-6 py-5" data-hmi-scroll>
            <div className="grid gap-4">
              <div className="border border-white/10 p-4 text-sm"><p>OpenAI trades provider cost for faster indexing and stronger extraction.</p><p className="mt-1 text-xs text-[#9fb9cc]">This workbench-wide key is available to every GraphRAG project. It is stored in a gitignored file readable only by your operating-system account and never returned to the browser.</p></div>
              <label className="grid gap-1.5 text-xs"><span>OpenAI API key</span><Input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={status?.cloud.ready ? 'Key configured — enter a new key to replace it' : 'sk-…'} className="rounded-none" /></label>
              <label className="grid gap-1.5 text-xs"><span>Extraction model</span><Input value={cloudCompletionModel} onChange={event => setCloudCompletionModel(event.target.value)} className="rounded-none" /></label>
              <label className="grid gap-1.5 text-xs"><span>Embedding model</span><Input value={cloudEmbeddingModel} onChange={event => setCloudEmbeddingModel(event.target.value)} className="rounded-none" /></label>
              <div className="flex items-center justify-between gap-3"><Button variant="ghost" className="rounded-none text-red-300" onClick={removeCloud} disabled={!status?.cloud.keyStored}><Trash2 /> Remove stored key</Button><Button className="rounded-none" onClick={saveCloud} disabled={saving || !apiKey.trim()}>{saving ? <Loader2 className="animate-spin" /> : <Check />} Save cloud preset</Button></div>
            </div>
          </TabsContent>
        </Tabs>
        {error && <p className="border-t border-red-400/20 bg-red-500/[0.06] px-6 py-3 text-xs text-red-300">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}

function StatusCell({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return <div className="border-r border-white/10 p-3 last:border-r-0"><p className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#9fb9cc]">{label}</p><p className={`mt-1 ${ok ? 'text-green-300' : 'text-amber-200'}`}>{value}</p></div>
}
