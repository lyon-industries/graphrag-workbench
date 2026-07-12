import { NextRequest } from 'next/server'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import { convertPdfToText, convertGraphParquetToJson } from '@/lib/server/converters'
import { clearIndexJob, getIndexJob, setIndexJob } from '@/lib/server/indexJob'
import { resolveGraphRagEnv } from '@/lib/server/graphragEnv'

interface UploadEntry {
  name: string
  size: number
  mtime: number
  type: 'txt'|'pdf'
  status?: string
  prepared_at?: number
  indexed_at?: number
  removed_at?: number
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  const appDir = process.cwd()
  const root = appDir
  const requestedMethod = request.nextUrl.searchParams.get('method')
  const method = requestedMethod === 'fast' ? 'fast' : 'standard'
  
  // OpenAI-only mode; ignore query parameter

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let hasTextInput = false
      let pipelineFailed = false
      let uploadRegistry: UploadEntry[] = []
      const stagedRemovals: Array<{ original: string; staged: string }> = []
      const send = (type: string, payload: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`))
      const restoreStagedRemovals = async () => {
        for (const item of stagedRemovals) {
          try {
            await fs.mkdir(path.dirname(item.original), { recursive: true })
            await fs.rename(item.staged, item.original)
          } catch {}
        }
      }
      send('status', { message: 'Preparing dataset…' })
      // Setup environment based on mode
      const providerConfig = resolveGraphRagEnv()
      const env = providerConfig.env
      send('log', { line: `MODEL · ${providerConfig.provider.toUpperCase()} · ${providerConfig.completionModel} · EMBEDDING ${providerConfig.embeddingModel}` });

      // Pre-convert PDFs -> TXT if needed
      (async () => {
        try {
          const inputDir = path.join(root, 'input')
          const pdfArchive = path.join(inputDir, '_pdfs')
          const pendingDir = path.join(inputDir, '_pending_removal')
          await fs.mkdir(pdfArchive, { recursive: true }).catch(() => {})
          const uploadsPath = path.join(root, 'output', 'uploads.json')
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
          if (stagedRemovals.length) send('log', { line: `PENDING REMOVAL · ${stagedRemovals.length} source artifact(s) excluded from this build.` })

          // 1) Convert any PDFs in input/
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
              send('log', { line: `Converting PDF to text: ${pdf}` })
              try {
                await convertPdfToText(path.join(inputDir, pdf), inputDir)
                converted = true
              } catch (e) {
                await fs.rm(txtPath, { force: true }).catch(() => {})
                send('log', { line: `INGEST BLOCKED · ${pdf} · ${String(e)}` })
              }
            }
            // Move PDF out of ingest folder only if converted or already had .txt
            if (converted || !need) {
              try {
                await fs.rename(path.join(inputDir, pdf), path.join(pdfArchive, pdf))
                send('log', { line: `Moved PDF to ${path.join('input', '_pdfs', pdf)}` })
              } catch {}
            }
          }

          // 2) Attempt conversion for any PDFs in input/_pdfs missing corresponding .txt
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
              send('log', { line: `Recovering: converting archived PDF to text: ${pdf}` })
              try {
                await convertPdfToText(path.join(pdfArchive, pdf), inputDir)
              } catch (e) {
                await fs.rm(txtPath, { force: true }).catch(() => {})
                send('log', { line: `INGEST BLOCKED · ${pdf} · ${String(e)}` })
              }
            }
          }

          // 3) Warn if no .txt files present
          try {
            const list = await fs.readdir(inputDir, { withFileTypes: true }).catch(() => [])
            const txts = list.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
            hasTextInput = txts.length > 0
            if (txts.length === 0) {
              send('log', { line: `INGEST STOPPED · No usable text input. Upload a text-backed PDF or TXT file.` })
            }
          } catch {}
          // Update uploads registry statuses to 'scanning'
          const now = Date.now()
          for (const r of uploadRegistry) { if (r.status !== 'pending_removal') r.status = 'scanning'; r.prepared_at = now }
          await fs.mkdir(path.dirname(uploadsPath), { recursive: true })
          await fs.writeFile(uploadsPath, JSON.stringify(uploadRegistry, null, 2))
        } catch (e) {
          send('log', { line: `dataset prep warning: ${String(e)}` })
        }
      })().then(async () => {
        if (!hasTextInput) {
          await restoreStagedRemovals()
          send('done', { ok: false, code: 'NO_TEXT_INPUT' })
          controller.close()
          return
        }
        if (getIndexJob()) {
          send('done', { ok: false, code: 'INDEX_ALREADY_RUNNING' })
          controller.close()
          return
        }
        // Start indexing after dataset is prepared
        send('status', { message: `Indexing started with ${method} method…` })
        await fs.writeFile(path.join(root, 'logs_history.log'), '').catch(() => {})
        // A full rebuild may switch embedding providers or dimensions. LanceDB
        // cannot append the new vectors to an index created by another model.
        if (method === 'standard') {
          await fs.rm(path.join(root, 'output', 'lancedb'), { recursive: true, force: true }).catch(() => {})
        }
        // The provider preflight makes a synthetic request that Luna can reject
        // even while real GraphRAG prompts succeed. The pipeline itself remains
        // authoritative and every workflow failure is surfaced below.
        const child = spawn('uv', ['run', 'graphrag', 'index', '--root', root, '--method', method, '--skip-validation'], { cwd: root, env, detached: true })
        const jobId = crypto.randomUUID()
        setIndexJob({
          id: jobId,
          child,
          startedAt: Date.now(),
          provider: providerConfig.provider,
          completionModel: providerConfig.completionModel,
        })
        send('job', { id: jobId, status: 'RUNNING' })
        const appendLog = async (line: string) => {
          try {
            const p = path.join(root, 'logs_history.log')
            await fs.appendFile(p, `${new Date().toISOString()}\t${line.replace(/\r?\n/g, '')}\n`)
          } catch {}
        }
        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          if (/Pipeline error:|completed with errors/i.test(text)) pipelineFailed = true
          send('log', { line: text })
          text.split(/\r?\n/).forEach((ln) => { if (ln.trim()) appendLog(ln) })
          if (/Starting pipeline|Running standard indexing|Executing pipeline/.test(text)) send('progress', { value: 5 })
          if (/create_communities/.test(text)) send('progress', { value: 40 })
          if (/create_community_reports/.test(text)) send('progress', { value: 65 })
          if (/generate_text_embeddings/.test(text)) send('progress', { value: 85 })
          if (/Indexing pipeline complete|All workflows completed successfully/.test(text)) send('progress', { value: 100 })
        })
        child.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          if (/Pipeline error:|completed with errors/i.test(text)) pipelineFailed = true
          send('log', { line: text })
          text.split(/\r?\n/).forEach((ln) => { if (ln.trim()) appendLog(ln) })
        })
        child.on('close', async (code) => {
          clearIndexJob(jobId)
          const succeeded = code === 0 && !pipelineFailed
          send('status', { message: succeeded ? 'Indexing finished' : 'Indexing failed' })
          if (!succeeded) {
            await restoreStagedRemovals()
            send('done', { ok: false, code: pipelineFailed ? 'PIPELINE_FAILED' : code })
            controller.close()
            return
          }
          try {
            const outDir = path.join(root, 'output')
            const { converted } = await convertGraphParquetToJson(outDir)
            send('log', { line: `Converted ${converted} parquet files to JSON` })
          } catch (e) {
            send('log', { line: `conversion error: ${String(e)}` })
          }
          try {
            const uploadsPath = path.join(root, 'output', 'uploads.json')
            const now = Date.now()
            const pendingBases = new Set(uploadRegistry
              .filter(item => item.status === 'pending_removal' && item.type === 'pdf')
              .map(item => item.name.replace(/\.pdf$/i, '')))
            const retained = uploadRegistry.filter(item =>
              item.status !== 'pending_removal' &&
              !(item.type === 'txt' && pendingBases.has(item.name.replace(/\.txt$/i, '')))
            )
            for (const item of retained) { item.status = 'indexed'; item.indexed_at = now }
            await fs.writeFile(uploadsPath, JSON.stringify(retained, null, 2))
            await fs.rm(path.join(root, 'input', '_pending_removal'), { recursive: true, force: true })
          } catch {}
          send('done', { ok: true, code })
          controller.close()
        })
        child.on('error', (err) => {
          clearIndexJob(jobId)
          restoreStagedRemovals()
          send('log', { line: `error: ${String(err)}` })
          send('done', { ok: false })
          controller.close()
        })
      }).catch(() => {
        // If prep fails, attempt to run index anyway to surface errors
        send('status', { message: `Indexing started with ${method} method…` })
        spawn('uv', ['run', 'graphrag', 'index', '--root', root, '--method', method, '--skip-validation'], { cwd: root, env })
      });
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
