import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs/promises'

import { execFile as _execFile, ExecFileOptions } from 'node:child_process'
import { resolveGraphRagEnv } from '@/lib/server/graphragEnv'
function execFileP(file: string, args: string[], options?: ExecFileOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    _execFile(file, args, options ?? {}, (error, stdout, stderr) => {
      if (error) return reject(error)
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

type Entity = { id: string; title: string; description?: string; type?: string }
type Relationship = { source: string; target: string; description?: string; weight?: number }

async function readJson<T = unknown>(p: string): Promise<T> {
  const raw = await fs.readFile(p, 'utf-8')
  return JSON.parse(raw)
}

function normalize(s: string) {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractEntityIdsFromText(answer: string, question: string, entities: Entity[], max = 30): string[] {
  const text = normalize(answer + ' ' + question)
  const hits: string[] = []
  for (const e of entities) {
    const t = (e.title || '').trim()
    if (!t || t.length < 3) continue
    const nt = normalize(t)
    if (!nt || nt.length < 3) continue
    if (text.includes(nt)) {
      hits.push(e.id)
    }
    if (hits.length >= max) break
  }
  return Array.from(new Set(hits))
}

// (removed unused drift helper)

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

// (removed unused OpenAI helper)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const question: string = (body?.message || '').toString()
    const methodRaw: string = String(body?.method || 'drift').toLowerCase()
    const allowedMethods = ['drift', 'local', 'global', 'basic'] as const
    type Method = typeof allowedMethods[number]
    const isMethod = (x: string): x is Method => (allowedMethods as readonly string[]).includes(x)
    const method: Method = isMethod(methodRaw) ? methodRaw : 'drift'
    // const history: { role: string; content: string }[] = Array.isArray(body?.history) ? body.history : []
    if (!question) return NextResponse.json({ error: 'Missing message' }, { status: 400 })

    const appDir = process.cwd()
    const visualizerDir = appDir // we're inside graph-rag-visualizer

    console.info('[chat] start', { method })

    // Load entities for highlighting
    // Use latest indexed entities directly from output/
    const entitiesPath = path.join(visualizerDir, 'output', 'entities.json')
    const entities = await readJson<Entity[]>(entitiesPath).catch(() => [] as Entity[])

    // 1) Run GraphRAG drift query (wrapper)
    let driftOut = ''
    try {
      console.info('[chat] running drift…')
      // Run with selected method via CLI
      const appDir = process.cwd()
      const root = appDir
      try { await fs.mkdir(path.join(root, 'output'), { recursive: true }) } catch {}
      const args = ['query', question, '--method', method, '--root', root, '--data', path.join(root, 'output')]
      const { env } = resolveGraphRagEnv()
      const { stdout } = await execFileP('uv', ['run', 'graphrag', ...args], { cwd: root, timeout: 180000, env })
      driftOut = stdout || ''
    } catch (e) {
      console.warn('[chat] drift failed', e)
      console.warn('[chat] query failed', e)
      return NextResponse.json(
        { error: 'GraphRAG query failed. Review the local server log.', code: 'QUERY_FAILED' },
        { status: 502 },
      )
    }

    // 2) Derive highlights from GraphRAG output (fallback to question)
    const highlights = extractEntityIdsFromText(driftOut || '', question, entities, 30)
    console.info('[chat] highlights', { count: highlights.length })

    // 3) Build compact context from graph JSONs
    console.info('[chat] building context')
    const contextBase = await buildContext(highlights, visualizerDir)
    // Include a trimmed excerpt of the Drift output to provide narrative grounding
    const driftExcerpt = driftOut ? driftOut.slice(Math.max(0, driftOut.length - 4000)) : ''
    const context = driftExcerpt
      ? `${contextBase}\n\n--- Drift Output (excerpt) ---\n${driftExcerpt}`
      : contextBase
    console.info('[chat] context length', { length: context.length })

    // 4) Return GraphRAG Drift prose answer directly (no second LLM call)
    const markers: Record<string, string> = {
      drift: 'DRIFT Search Response:',
      local: 'LOCAL Search Response:',
      global: 'GLOBAL Search Response:',
      basic: 'BASIC Search Response:'
    }
    const genericMarker = 'Search Response:'
    let at = driftOut ? driftOut.lastIndexOf(markers[method] || genericMarker) : -1
    if (at < 0) at = driftOut ? driftOut.lastIndexOf(genericMarker) : -1
    const driftAnswer = at >= 0 ? driftOut.slice(at + (markers[method] || genericMarker).length).trim() : (driftOut || '').trim()
    if (!driftAnswer) {
      return NextResponse.json({ error: 'GraphRAG returned no answer', code: 'EMPTY_QUERY_RESULT' }, { status: 502 })
    }
    return NextResponse.json({ answer: driftAnswer, highlights })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
