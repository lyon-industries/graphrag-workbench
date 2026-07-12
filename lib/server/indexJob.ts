import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import fs from 'node:fs/promises'
import { convertPdfToText, convertParquetSubset, convertGraphParquetToJson } from './converters'
import { resolveGraphRagEnv } from './graphragEnv'

export type IndexJobStatus = 'running' | 'succeeded' | 'failed' | 'stopped'

export type IndexJobEvent =
  | { type: 'log'; line: string }
  | { type: 'status'; message: string }
  | { type: 'progress'; value: number }
  | { type: 'partial'; artifacts: string[]; dataVersion: number }
  | { type: 'job'; id: string; status: string }
  | { type: 'done'; ok: boolean; code?: number | string | null }

export type IndexJob = {
  id: string
  method: 'standard' | 'fast'
  child?: ChildProcess
  startedAt: number
  finishedAt?: number
  status: IndexJobStatus
  provider: string
  completionModel: string
  progress: number
  dataVersion: number
  fatalError?: string
  stopRequested?: boolean
  emitter: EventEmitter
}

interface UploadEntry {
  name: string
  size: number
  mtime: number
  type: 'txt' | 'pdf'
  status?: string
  prepared_at?: number
  indexed_at?: number
  removed_at?: number
}

// The job must outlive any single request: SSE subscribers (the Builder
// terminal) attach and detach freely while the pipeline keeps running.
const globalJobs = globalThis as typeof globalThis & { __graphragIndexJob?: IndexJob }

export function getIndexJob() {
  return globalJobs.__graphragIndexJob
}

export function isIndexRunning() {
  return globalJobs.__graphragIndexJob?.status === 'running'
}

/** Forget a finished job so its status doesn't leak into another project. */
export function clearIndexJobRecord() {
  if (globalJobs.__graphragIndexJob && globalJobs.__graphragIndexJob.status !== 'running') {
    globalJobs.__graphragIndexJob = undefined
  }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function processExists(pid: number) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals) {
  try { process.kill(-pid, signal); return true } catch {
    try { process.kill(pid, signal); return true } catch { return false }
  }
}

async function terminateChild(pid: number) {
  signalProcessGroup(pid, 'SIGTERM')
  for (let attempt = 0; attempt < 10 && processExists(pid); attempt++) await wait(100)
  if (processExists(pid)) {
    signalProcessGroup(pid, 'SIGKILL')
    for (let attempt = 0; attempt < 10 && processExists(pid); attempt++) await wait(100)
  }
  return !processExists(pid)
}

/** Stop the running index job, if any. Safe to call when idle. */
export async function stopIndexJob(): Promise<{ ok: boolean; code: string; jobId?: string }> {
  const job = globalJobs.__graphragIndexJob
  if (!job || job.status !== 'running') {
    return { ok: false, code: 'NO_ACTIVE_INDEX_JOB' }
  }
  job.stopRequested = true
  // Dataset preparation happens before the GraphRAG child exists. A project
  // switch during that window must still inhibit the eventual spawn.
  const stopped = job.child?.pid ? await terminateChild(job.child.pid) : true
  if (stopped && job.provider === 'ollama') {
    await new Promise<void>(resolve => execFile('ollama', ['stop', job.completionModel], () => resolve()))
  }
  // Wait for the close handler to record the terminal state so callers that
  // clear or inspect the job right after stopping see a settled status.
  for (let attempt = 0; attempt < 20 && job.status === 'running'; attempt++) await wait(100)
  return { ok: stopped, code: stopped ? 'STOPPED' : 'STOP_FAILED', jobId: job.id }
}

// Fatal provider failures repeat identically on every chunk while GraphRAG
// retries with backoff — a quota-dead key burns ten minutes before dying at
// 8/8 with "No entities detected". Detect the first one and kill the run.
const FATAL_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /insufficient_quota|exceeded your current quota/i,
    message: 'OpenAI quota exhausted (429 insufficient_quota). Every request is being rejected — add credits to the OpenAI project or switch GRAPHRAG_COMPLETION_PROVIDER to ollama in .env, then rebuild.',
  },
  {
    pattern: /invalid_api_key|incorrect api key|AuthenticationError/i,
    message: 'API key rejected (401). Check GRAPHRAG_API_KEY in .env.',
  },
  {
    pattern: /model_not_found|does not exist or you do not have access/i,
    message: 'The configured model is not available to this API key. Check GRAPHRAG_COMPLETION_MODEL / GRAPHRAG_EMBEDDING_MODEL in .env.',
  },
]

// Artifacts become available as their producing workflow completes; convert
// them immediately so the constellation can populate while the build runs.
const WORKFLOW_ARTIFACTS: Record<string, string[]> = {
  finalize_graph: ['entities.parquet', 'relationships.parquet'],
  create_communities: ['communities.parquet'],
  create_community_reports: ['community_reports.parquet'],
  create_final_text_units: ['text_units.parquet'],
}

export function startIndexJob(method: 'standard' | 'fast'): { job?: IndexJob; error?: string } {
  if (isIndexRunning()) return { error: 'INDEX_ALREADY_RUNNING' }

  const providerConfig = resolveGraphRagEnv()
  const job: IndexJob = {
    id: crypto.randomUUID(),
    method,
    startedAt: Date.now(),
    status: 'running',
    provider: providerConfig.provider,
    completionModel: providerConfig.completionModel,
    progress: 0,
    dataVersion: globalJobs.__graphragIndexJob?.dataVersion ?? 0,
    emitter: new EventEmitter(),
  }
  job.emitter.setMaxListeners(50)
  globalJobs.__graphragIndexJob = job

  void runJob(job, providerConfig.env, providerConfig.completionModel, providerConfig.embeddingModel, providerConfig.concurrency)
  return { job }
}

async function runJob(job: IndexJob, env: NodeJS.ProcessEnv, completionModel: string, embeddingModel: string, concurrency: number) {
  const root = process.cwd()
  const logHistoryPath = path.join(root, 'logs_history.log')

  const appendLog = async (line: string) => {
    try {
      await fs.appendFile(logHistoryPath, `${new Date().toISOString()}\t${line.replace(/\r?\n/g, ' ')}\n`)
    } catch {}
  }
  const emit = (event: IndexJobEvent) => {
    try { job.emitter.emit('event', event) } catch {}
  }
  const log = (line: string) => {
    emit({ type: 'log', line })
    void appendLog(line)
  }
  const setProgress = (value: number) => {
    job.progress = Math.max(job.progress, Math.min(100, value))
    emit({ type: 'progress', value: job.progress })
  }
  const finish = (status: IndexJobStatus, ok: boolean, code?: number | string | null) => {
    job.status = status
    job.finishedAt = Date.now()
    emit({ type: 'done', ok, code })
    job.emitter.removeAllListeners()
  }

  let pipelineFailed = false
  let uploadRegistry: UploadEntry[] = []
  const stagedRemovals: Array<{ original: string; staged: string }> = []
  const restoreStagedRemovals = async () => {
    for (const item of stagedRemovals) {
      try {
        await fs.mkdir(path.dirname(item.original), { recursive: true })
        await fs.rename(item.staged, item.original)
      } catch {}
    }
  }

  // Fresh terminal history for this build.
  await fs.writeFile(logHistoryPath, '').catch(() => {})
  emit({ type: 'status', message: 'Preparing dataset…' })
  log(`MODEL · ${job.provider.toUpperCase()} · ${completionModel} · EMBEDDING ${embeddingModel} · CONCURRENCY ${concurrency}`)

  // ---- Dataset preparation: stage removals, convert PDFs to text ----
  const inputDir = path.join(root, 'input')
  const pdfArchive = path.join(inputDir, '_pdfs')
  const pendingDir = path.join(inputDir, '_pending_removal')
  const uploadsPath = path.join(root, 'output', 'uploads.json')
  let hasTextInput = false
  try {
    await fs.mkdir(pdfArchive, { recursive: true }).catch(() => {})
    const registryRaw = await fs.readFile(uploadsPath, 'utf-8').catch(() => '[]')
    const registryParsed = JSON.parse(registryRaw) as unknown
    uploadRegistry = Array.isArray(registryParsed) ? registryParsed as UploadEntry[] : []

    for (const entry of uploadRegistry.filter(item => item.status === 'pending_removal' || item.status === 'removed')) {
      const derivedName = entry.name.replace(/\.pdf$/i, '.txt')
      const candidates = entry.type === 'pdf'
        ? [path.join(inputDir, entry.name), path.join(pdfArchive, entry.name), path.join(inputDir, derivedName)]
        : [path.join(inputDir, entry.name)]
      for (const original of candidates) {
        try {
          await fs.stat(original)
          const staged = path.join(pendingDir, `${stagedRemovals.length}-${path.basename(original)}`)
          await fs.mkdir(pendingDir, { recursive: true })
          await fs.rename(original, staged)
          stagedRemovals.push({ original, staged })
        } catch {}
      }
      entry.status = 'pending_removal'
    }
    if (stagedRemovals.length) log(`PENDING REMOVAL · ${stagedRemovals.length} source artifact(s) excluded from this build.`)

    const ents = await fs.readdir(inputDir, { withFileTypes: true }).catch(() => [])
    const pdfs = ents.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pdf')).map(e => e.name)
    for (const pdf of pdfs) {
      const base = pdf.replace(/\.pdf$/i, '')
      const txtPath = path.join(inputDir, `${base}.txt`)
      let need = false
      try {
        const stat = await fs.stat(txtPath)
        need = stat.size < 512
      } catch { need = true }
      let converted = false
      if (need) {
        log(`Converting PDF to text: ${pdf}`)
        try {
          await convertPdfToText(path.join(inputDir, pdf), inputDir)
          converted = true
        } catch (e) {
          await fs.rm(txtPath, { force: true }).catch(() => {})
          log(`INGEST BLOCKED · ${pdf} · ${String(e)}`)
        }
      }
      if (converted || !need) {
        try {
          await fs.rename(path.join(inputDir, pdf), path.join(pdfArchive, pdf))
          log(`Moved PDF to ${path.join('input', '_pdfs', pdf)}`)
        } catch {}
      }
    }

    // Recover any archived PDFs whose text extraction is missing.
    const archived = await fs.readdir(pdfArchive, { withFileTypes: true }).catch(() => [])
    const archivedPdfs = archived.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pdf')).map(e => e.name)
    for (const pdf of archivedPdfs) {
      const base = pdf.replace(/\.pdf$/i, '')
      const txtPath = path.join(inputDir, `${base}.txt`)
      let need = false
      try {
        const stat = await fs.stat(txtPath)
        need = stat.size < 512
      } catch { need = true }
      if (need) {
        log(`Recovering: converting archived PDF to text: ${pdf}`)
        try {
          await convertPdfToText(path.join(pdfArchive, pdf), inputDir)
        } catch (e) {
          await fs.rm(txtPath, { force: true }).catch(() => {})
          log(`INGEST BLOCKED · ${pdf} · ${String(e)}`)
        }
      }
    }

    const list = await fs.readdir(inputDir, { withFileTypes: true }).catch(() => [])
    hasTextInput = list.some(e => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
    if (!hasTextInput) log('INGEST STOPPED · No usable text input. Upload a text-backed PDF or TXT file.')

    const now = Date.now()
    for (const r of uploadRegistry) { if (r.status !== 'pending_removal') r.status = 'scanning'; r.prepared_at = now }
    await fs.mkdir(path.dirname(uploadsPath), { recursive: true })
    await fs.writeFile(uploadsPath, JSON.stringify(uploadRegistry, null, 2))
  } catch (e) {
    log(`dataset prep warning: ${String(e)}`)
  }

  const writeRegistry = async (mutate: (registry: UploadEntry[]) => UploadEntry[]) => {
    try {
      const next = mutate(uploadRegistry)
      uploadRegistry = next
      await fs.writeFile(uploadsPath, JSON.stringify(next, null, 2))
    } catch {}
  }

  if (!hasTextInput) {
    await restoreStagedRemovals()
    await writeRegistry(reg => { for (const r of reg) if (r.status === 'scanning') r.status = 'pending'; return reg })
    finish('failed', false, 'NO_TEXT_INPUT')
    return
  }

  if (job.stopRequested) {
    await restoreStagedRemovals()
    await writeRegistry(reg => { for (const r of reg) if (r.status === 'scanning') r.status = 'pending'; return reg })
    finish('stopped', false, 'STOPPED')
    return
  }

  emit({ type: 'status', message: `Indexing started with ${job.method} method…` })
  // A full rebuild may switch embedding providers or dimensions. LanceDB
  // cannot append new vectors to an index created by another model.
  if (job.method === 'standard') {
    await fs.rm(path.join(root, 'output', 'lancedb'), { recursive: true, force: true }).catch(() => {})
  }

  // The provider preflight makes a synthetic request some OpenAI projects
  // reject even while real GraphRAG prompts succeed, so validation is
  // skipped; the engine-log watcher below surfaces real provider failures.
  const child = spawn('uv', ['run', 'graphrag', 'index', '--root', root, '--method', job.method, '--skip-validation'], { cwd: root, env, detached: true })
  job.child = child
  emit({ type: 'job', id: job.id, status: 'RUNNING' })
  setProgress(2)

  // ---- Progress tracking from the pipeline's own workflow announcements ----
  let workflowTotal = 0
  let workflowsCompleted = 0

  // ---- Progressive artifact conversion (serialized) ----
  let conversionChain: Promise<void> = Promise.resolve()
  const convertPartial = (workflow: string) => {
    const artifacts = WORKFLOW_ARTIFACTS[workflow]
    if (!artifacts) return
    conversionChain = conversionChain.then(async () => {
      try {
        const { converted } = await convertParquetSubset(path.join(root, 'output'), artifacts)
        if (converted > 0) {
          job.dataVersion += 1
          log(`LIVE VIEW · ${artifacts.map(a => a.replace('.parquet', '')).join(', ')} available in constellation`)
          emit({ type: 'partial', artifacts, dataVersion: job.dataVersion })
        }
      } catch (e) {
        log(`partial conversion warning: ${String(e)}`)
      }
    })
  }

  const handleChildText = (text: string) => {
    if (/Pipeline error:|completed with errors/i.test(text)) pipelineFailed = true
    emit({ type: 'log', line: text })
    text.split(/\r?\n/).forEach(ln => { if (ln.trim()) void appendLog(ln) })

    const pipelineStart = text.match(/Starting pipeline with workflows:\s*(.+)/i)
    if (pipelineStart) {
      workflowTotal = pipelineStart[1].split(',').map(s => s.trim()).filter(Boolean).length
      setProgress(4)
    }
    for (const match of text.matchAll(/Workflow complete:\s*([\w-]+)/gi)) {
      workflowsCompleted += 1
      if (workflowTotal > 0) setProgress(Math.round(4 + 92 * (workflowsCompleted / workflowTotal)))
      convertPartial(match[1])
    }
    // Long workflows report their inner steps as "n / m"; interpolate so the
    // bar keeps moving during a multi-minute extraction instead of stalling.
    const step = text.match(/^\s*(\d+)\s*\/\s*(\d+)\s/m)
    if (step && workflowTotal > 0) {
      const [, done, total] = step
      const fraction = Math.min(1, Number(done) / Math.max(1, Number(total)))
      setProgress(Math.round(4 + 92 * ((workflowsCompleted + fraction) / workflowTotal)))
    }
    if (/Indexing pipeline complete|All workflows completed successfully/.test(text)) setProgress(100)
  }
  child.stdout.on('data', (chunk: Buffer) => handleChildText(chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => handleChildText(chunk.toString()))

  // ---- Engine log watcher: surface errors, fast-fail on fatal ones ----
  // GraphRAG prints only progress dots to stdout; real errors go to
  // logs/indexing-engine.log. Tail it so the Builder terminal shows the
  // actual failure instead of a silent march to "No entities detected".
  const engineLogPath = path.join(root, 'logs', 'indexing-engine.log')
  let engineOffset = await fs.stat(engineLogPath).then(s => s.size).catch(() => 0)
  const seenErrors = new Set<string>()
  let fatalTriggered = false
  let permissionBlipWarned = false
  const pollEngineLog = async () => {
    let text = ''
    try {
      const fh = await fs.open(engineLogPath, 'r')
      try {
        const { size } = await fh.stat()
        if (size < engineOffset) engineOffset = 0 // file was rotated/truncated
        if (size > engineOffset) {
          const buf = Buffer.alloc(size - engineOffset)
          await fh.read(buf, 0, buf.length, engineOffset)
          engineOffset = size
          text = buf.toString('utf-8')
        }
      } finally {
        await fh.close()
      }
    } catch { return }
    if (!text) return

    // Only logged ERROR records are diagnostic. The engine also dumps its
    // full config (including exception-name lists) and long tracebacks into
    // this file; matching those produces false-positive fatals.
    const errorLines: string[] = []
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/ - ERROR - (?:[\w.]+ - )?(.*)$/)
      if (m) {
        errorLines.push(m[1])
        const summary = m[1].slice(0, 240)
        if (!seenErrors.has(summary)) {
          seenErrors.add(summary)
          log(`ENGINE ERROR · ${summary}`)
        }
      }
    }
    if (!errorLines.length) return
    const errorText = errorLines.join('\n')
    if (!permissionBlipWarned && /insufficient permissions for this operation/i.test(errorText)) {
      permissionBlipWarned = true
      log('WARNING · OpenAI intermittently rejected a request with "insufficient permissions" — typical of an account flagged for unusual activity. Requests are retried with backoff; if the build still fails, re-run it (cached responses make retries cheap).')
    }
    if (!fatalTriggered) {
      for (const { pattern, message } of FATAL_PATTERNS) {
        if (pattern.test(errorText)) {
          fatalTriggered = true
          job.fatalError = message
          pipelineFailed = true
          log(`FATAL · ${message}`)
          emit({ type: 'status', message: 'Stopping build — provider rejected all requests' })
          if (child.pid) void terminateChild(child.pid)
          break
        }
      }
    }
  }
  const engineWatcher = setInterval(() => { void pollEngineLog() }, 1500)

  child.on('close', (code) => {
    void (async () => {
      clearInterval(engineWatcher)
      await pollEngineLog().catch(() => {})
      await conversionChain.catch(() => {})
      const succeeded = code === 0 && !pipelineFailed && !job.stopRequested
      emit({ type: 'status', message: succeeded ? 'Indexing finished' : job.stopRequested ? 'Indexing stopped' : 'Indexing failed' })
      if (!succeeded) {
        await restoreStagedRemovals()
        await writeRegistry(reg => { for (const r of reg) if (r.status === 'scanning') r.status = 'pending'; return reg })
        finish(job.stopRequested ? 'stopped' : 'failed', false, job.fatalError ? 'PROVIDER_FATAL' : pipelineFailed ? 'PIPELINE_FAILED' : code)
        return
      }
      try {
        const { converted } = await convertGraphParquetToJson(path.join(root, 'output'))
        log(`Converted ${converted} parquet files to JSON`)
        job.dataVersion += 1
        emit({ type: 'partial', artifacts: ['all'], dataVersion: job.dataVersion })
      } catch (e) {
        log(`conversion error: ${String(e)}`)
      }
      try {
        const now = Date.now()
        const pendingBases = new Set(uploadRegistry
          .filter(item => item.status === 'pending_removal' && item.type === 'pdf')
          .map(item => item.name.replace(/\.pdf$/i, '')))
        await writeRegistry(reg => {
          const retained = reg.filter(item =>
            item.status !== 'pending_removal' &&
            !(item.type === 'txt' && pendingBases.has(item.name.replace(/\.txt$/i, ''))))
          for (const item of retained) { item.status = 'indexed'; item.indexed_at = now }
          return retained
        })
        await fs.rm(pendingDir, { recursive: true, force: true })
      } catch {}
      setProgress(100)
      finish('succeeded', true, code)
    })()
  })
  child.on('error', (err) => {
    void (async () => {
      clearInterval(engineWatcher)
      await restoreStagedRemovals()
      log(`error: ${String(err)}`)
      finish('failed', false, 'SPAWN_FAILED')
    })()
  })
}
