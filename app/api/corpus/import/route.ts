import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'

import { convertParquetSubset } from '@/lib/server/converters'
import { getIndexJob } from '@/lib/server/indexJob'

const GRAPH_ARTIFACTS = ['entities', 'relationships', 'communities', 'community_reports', 'text_units'] as const
const ALLOWED_FILES = new Set([
  ...GRAPH_ARTIFACTS.flatMap(name => [`${name}.json`, `${name}.parquet`]),
  'stats.json',
])
const MAX_IMPORT_BYTES = 750 * 1024 * 1024

async function readArray(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf-8')
  const value = JSON.parse(raw) as unknown
  if (!Array.isArray(value)) throw new Error(`${path.basename(filePath)} must contain a JSON array`)
  return value
}

export async function POST(request: Request) {
  const root = process.cwd()
  const stage = path.join(root, '.imports', crypto.randomUUID())
  try {
    const projectName = await fs.readFile(path.join(root, 'output', 'kg.json'), 'utf-8')
      .then(raw => String((JSON.parse(raw) as { name?: string }).name || '').trim())
      .catch(() => '')
    if (!projectName) return NextResponse.json({ error: 'Name the active project before importing output.' }, { status: 400 })

    const job = getIndexJob()
    if (job?.status === 'running' && job.projectName === projectName) {
      return NextResponse.json({ error: 'Stop this project build before importing output.' }, { status: 409 })
    }

    const form = await request.formData()
    const files = form.getAll('files').filter((entry): entry is File => entry instanceof File)
    if (!files.length) return NextResponse.json({ error: 'No output files selected.' }, { status: 400 })

    const supported = new Map<string, File>()
    const bundle = files.length === 1 && files[0].name.endsWith('.graphrag.json') ? files[0] : null
    let totalBytes = 0
    await fs.mkdir(stage, { recursive: true })
    if (bundle) {
      if (bundle.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: 'Import exceeds the 750 MB limit.' }, { status: 413 })
      const parsed = JSON.parse(await bundle.text()) as { format?: string; version?: number; artifacts?: Record<string, unknown> }
      if (parsed.format !== 'graphrag-workbench-output' || parsed.version !== 1 || !parsed.artifacts) {
        return NextResponse.json({ error: 'Unsupported GraphRAG Workbench bundle.' }, { status: 400 })
      }
      for (const name of GRAPH_ARTIFACTS) {
        const rows = parsed.artifacts[name]
        if (Array.isArray(rows)) await fs.writeFile(path.join(stage, `${name}.json`), JSON.stringify(rows, null, 2))
      }
    } else {
      for (const file of files) {
        const name = path.basename(file.name)
        if (!ALLOWED_FILES.has(name)) continue
        totalBytes += file.size
        if (totalBytes > MAX_IMPORT_BYTES) return NextResponse.json({ error: 'Import exceeds the 750 MB limit.' }, { status: 413 })
        supported.set(name, file)
      }
      const hasEntities = supported.has('entities.json') || supported.has('entities.parquet')
      const hasRelationships = supported.has('relationships.json') || supported.has('relationships.parquet')
      if (!hasEntities || !hasRelationships) {
        return NextResponse.json({ error: 'A GraphRAG output must contain entities and relationships as JSON or parquet.' }, { status: 400 })
      }
      for (const [name, file] of supported) {
        await fs.writeFile(path.join(stage, name), Buffer.from(await file.arrayBuffer()))
      }
    }

    const parquetFiles = [...supported.keys()].filter(name => name.endsWith('.parquet'))
    if (parquetFiles.length) await convertParquetSubset(stage, parquetFiles)

    const entities = await readArray(path.join(stage, 'entities.json'))
    const relationships = await readArray(path.join(stage, 'relationships.json'))
    if (!entities.length) return NextResponse.json({ error: 'The imported entity table is empty.' }, { status: 400 })

    const outputDir = path.join(root, 'output')
    await fs.mkdir(outputDir, { recursive: true })
    for (const name of ALLOWED_FILES) await fs.rm(path.join(outputDir, name), { force: true }).catch(() => {})
    const staged = await fs.readdir(stage)
    for (const name of staged) {
      if (ALLOWED_FILES.has(name)) await fs.copyFile(path.join(stage, name), path.join(outputDir, name))
    }
    await fs.appendFile(
      path.join(root, 'logs_history.log'),
      `${new Date().toISOString()}\tIMPORT · ${projectName} · ${entities.length} entities · ${relationships.length} relationships · ${bundle ? 'Workbench bundle' : `${supported.size} source artifacts`}\n`,
    ).catch(() => {})

    return NextResponse.json({
      ok: true,
      projectName,
      entities: entities.length,
      relationships: relationships.length,
      artifacts: staged.filter(name => ALLOWED_FILES.has(name)),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Output import failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {})
  }
}
