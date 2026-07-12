import { NextRequest } from 'next/server'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import { resolveGraphRagEnv } from '@/lib/server/graphragEnv'

type Entity = { id: string; title: string; description?: string; type?: string }
type Relationship = { source: string; target: string; description?: string; weight?: number }

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function readJson<T>(p: string): Promise<T> {
  const raw = await fs.readFile(p, 'utf-8')
  return JSON.parse(raw) as T
}

function sseEncode(event: string, data: unknown) {
  return `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`
}

function sanitizeLogLine(input: string): string {
  let line = input
  // redact api_key assignments
  line = line.replace(/api_key=['"][^'"\n]+['"]/gi, "api_key='[REDACTED]'")
  // redact sk- style secrets
  line = line.replace(/sk-[A-Za-z0-9_\-]+/g, 'sk-REDACTED')
  return line
}

function extractEntityIdsFromText(answer: string, question: string, entities: Entity[], max = 30): string[] {
  const text = normalize(`${answer} ${question}`)
  const hits: string[] = []
  for (const e of entities) {
    const t = (e.title || '').trim()
    if (!t || t.length < 3) continue
    const nt = normalize(t)
    if (!nt || nt.length < 3) continue
    if (text.includes(nt)) hits.push(e.id)
    if (hits.length >= max) break
  }
  return Array.from(new Set(hits))
}

async function buildContext(ids: string[], baseDir: string): Promise<string> {
  try {
    const entitiesPath = path.join(baseDir, 'output', 'entities.json')
    const relationshipsPath = path.join(baseDir, 'output', 'relationships.json')
    const [entities, relationships] = await Promise.all([
      readJson<Entity[]>(entitiesPath),
      readJson<Relationship[]>(relationshipsPath),
    ])

    const emap = new Map(entities.map(e => [e.id, e]))
    const selected = ids.map(id => emap.get(id)).filter(Boolean) as Entity[]
    const rels = relationships.filter(r => ids.includes(r.source) || ids.includes(r.target)).slice(0, 100)

    const lines: string[] = []
    lines.push('Knowledge Graph Context:')
    for (const e of selected.slice(0, 30)) {
      lines.push(`- Entity: ${e.title}${e.type ? ` [${e.type}]` : ''}`)
      if (e.description) lines.push(`  Desc: ${e.description}`)
    }
    if (rels.length) {
      lines.push('\nRelationships:')
      for (const r of rels.slice(0, 50)) {
        const s = emap.get(r.source)?.title || r.source
        const t = emap.get(r.target)?.title || r.target
        lines.push(`- ${s} —(${r.description || 'related to'})→ ${t}`)
      }
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const question: string = (body?.message || '').toString()
  const useLocalSearch: boolean = Boolean(body?.useLocalSearch)
  const methodRaw: string = String(body?.method || 'drift').toLowerCase()
  const allowedMethods = ['drift', 'local', 'global', 'basic'] as const
  type Method = typeof allowedMethods[number]
  const isMethod = (x: string): x is Method => (allowedMethods as readonly string[]).includes(x)
  const method: Method = isMethod(methodRaw) ? methodRaw : 'drift'
  if (!question) return new Response('Missing message', { status: 400 })

  const encoder = new TextEncoder()
  const appDir = process.cwd()
  const visualizerDir = appDir
  const repoRoot = appDir

  console.info('[chat/stream] start', { method })

  let driftOutput = ''
  let driftErrorText = ''
  let highlights: string[] = []
  let context = ''
  let activeChild: ReturnType<typeof spawn> | undefined

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sseEncode(event, data)))

      const stepStart = (name: string) => {
        console.info(`[chat/stream] step start: ${name}`)
        send('step-start', { name, at: Date.now() })
      }
      const stepEnd = (name: string, extra?: Record<string, unknown>) => {
        console.info(`[chat/stream] step end: ${name}`, extra || {})
        send('step-end', { name, at: Date.now(), ...(extra || {}) })
      }

      // Kickoff
      send('status', { message: 'Starting chat flow…' })

      // Step 1: Run GraphRAG drift
      stepStart('query')
      // Ensure data directory exists to satisfy graphrag CLI path validation
      try { await fs.mkdir(path.join(repoRoot, 'output'), { recursive: true }) } catch {}
      const args = ['query', question, '--method', method, '--root', repoRoot, '--data', path.join(repoRoot, 'output')]
      const { env } = resolveGraphRagEnv()
      const child = spawn('uv', ['run', 'graphrag', ...args], { cwd: repoRoot, env })
      activeChild = child

      let answerStreamStarted = false
      const markers: Record<string, string> = {
        drift: 'DRIFT Search Response:',
        local: 'LOCAL Search Response:',
        global: 'GLOBAL Search Response:',
        basic: 'BASIC Search Response:'
      }
      const genericMarker = 'Search Response:'
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const safe = sanitizeLogLine(text)
        driftOutput += safe
        send('drift-log', { line: safe })
        // If the drift prose answer appears, start streaming it to the chat
        const answerMarker = markers[method] || genericMarker
        if (!answerStreamStarted) {
          let idx = driftOutput.lastIndexOf(answerMarker)
          if (idx < 0) idx = driftOutput.lastIndexOf(genericMarker)
          if (idx >= 0) {
            answerStreamStarted = true
            const initial = driftOutput.slice(idx + answerMarker.length)
            if (initial.trim().length) send('answer-chunk', { text: initial })
            return
          }
        } else {
          // Already streaming; forward incremental chunks
          if (safe.length) send('answer-chunk', { text: safe })
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const safe = sanitizeLogLine(text)
        console.warn('[chat/stream] drift stderr:', safe)
        send('drift-log', { line: safe })
        driftErrorText += safe
      })
      child.on('error', (err) => {
        console.error('[chat/stream] drift error:', err)
        send('error', { message: 'GraphRAG query process could not start.' })
      })
      child.on('close', async (code) => {
        activeChild = undefined
        stepEnd('query', { code, method })

        if (code !== 0) {
          send('fault', {
            code: 'QUERY_FAILED',
            message: 'GraphRAG query failed. Review the local server log.',
            recover: 'Confirm the index and engine configuration, then retry.',
          })
          send('done', { ok: false, code })
          controller.close()
          return
        }

        // Detect embedding mismatch
        const embeddingMismatch = /embeddings are not compatible/i.test(driftErrorText)

        // Step 2: Extract highlights
        stepStart('extract-highlights')
        let entities: Entity[] = []
        try {
          // Read from output/ so we always use the latest indexed entities
          entities = await readJson<Entity[]>(path.join(visualizerDir, 'output', 'entities.json'))
        } catch (e) {
          console.warn('[chat/stream] failed to read entities.json from output/', e)
        }
        highlights = extractEntityIdsFromText(driftOutput || '', question, entities, 30)
        send('highlights', { count: highlights.length, ids: highlights })
        stepEnd('extract-highlights', { count: highlights.length })

        // Step 3: Build context
        stepStart('build-context')
        const baseContext = await buildContext(highlights, visualizerDir)
        // Add a trimmed excerpt of the Drift output for narrative grounding
        const driftExcerpt = driftOutput ? driftOutput.slice(Math.max(0, driftOutput.length - 4000)) : ''
        context = driftExcerpt
          ? `${baseContext}\n\n--- Drift Output (excerpt) ---\n${driftExcerpt}`
          : baseContext
        stepEnd('build-context', { length: context.length })

        // If embedding mismatch, attempt robust fallbacks
        if (embeddingMismatch) {
          send('warning', { message: 'Embedding mismatch between query and KB. Attempting fallback retrieval…' })
          // Fallback A: if we have an OpenAI key, rerun drift with public settings to build context
          if (!process.env.GRAPHRAG_API_KEY) {
            // Fallback B: JSON-only retrieval using simple title match
            stepStart('fallback-json')
            try {
              // naive match: include entities whose titles include any query term
              const q = question.toLowerCase().split(/\W+/).filter(Boolean)
              const ents = entities || []
              const matched = ents.filter(e => {
                const t = (e.title || '').toLowerCase()
                return q.some(tok => t.includes(tok))
              }).slice(0, 30).map(e => e.id)
              if (matched.length) {
                highlights = matched
                send('highlights', { count: highlights.length, ids: highlights })
                context = await buildContext(highlights, visualizerDir)
              }
              stepEnd('fallback-json', { ok: true, highlights: highlights.length })
            } catch {
              stepEnd('fallback-json', { ok: false })
            }
          }
        }

        // Optional Step 3b: local_search for additional grounding
        if (useLocalSearch) {
          stepStart('local-search')
          try {
            const localArgs = ['query', question, '--method', 'local', '--root', repoRoot, '--data', path.join(repoRoot, 'output'), '--response-type', 'Multiple Paragraphs']
            const localChild = spawn('uv', ['run', 'graphrag', ...localArgs], { cwd: repoRoot, env })
            let localOut = ''
            localChild.stdout.on('data', (chunk: Buffer) => {
              localOut += sanitizeLogLine(chunk.toString())
            })
            localChild.stderr.on('data', (chunk: Buffer) => {
              // still collect but don't spam logs
              localOut += '\n' + sanitizeLogLine(chunk.toString())
            })
            localChild.on('close', () => {
              // append to context as a separate section
              if (localOut.trim().length) {
                context += `\n\n--- Local Search Output ---\n${localOut.trim()}`
              }
              stepEnd('local-search', { ok: true })
              // proceed to LLM step
            })
            await new Promise<void>((resolve) => localChild.on('close', () => resolve()))
          } catch {
            stepEnd('local-search', { ok: false })
          }
        }

        // Step 4: Emit the GraphRAG Drift prose answer directly (no second LLM call)
        stepStart('emit-answer')
        try {
          const markers2: Record<string, string> = {
            drift: 'DRIFT Search Response:',
            local: 'LOCAL Search Response:',
            global: 'GLOBAL Search Response:',
            basic: 'BASIC Search Response:'
          }
          const m = markers2[method] || genericMarker
          let at = driftOutput ? driftOutput.lastIndexOf(m) : -1
          if (at < 0) at = driftOutput ? driftOutput.lastIndexOf(genericMarker) : -1
          const answerText = at >= 0 ? driftOutput.slice(at + m.length).trim() : (driftOutput || '').trim()
          if (!answerText) {
            send('fault', {
              code: 'EMPTY_QUERY_RESULT',
              message: 'GraphRAG completed without an answer.',
              recover: 'Inspect the retrieved context or try a different query method.',
            })
            send('done', { ok: false, code: 'EMPTY_QUERY_RESULT' })
            controller.close()
            return
          }
          send('answer', { text: answerText, highlights })
          stepEnd('emit-answer', { ok: true, source: method })
        } catch (e) {
          stepEnd('emit-answer', { ok: false, source: method })
          send('error', { message: e instanceof Error ? e.message : String(e) })
        }

        send('done', { at: Date.now() })
        controller.close()
      })
    },
    cancel() {
      console.info('[chat/stream] client disconnected')
      activeChild?.kill('SIGTERM')
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
