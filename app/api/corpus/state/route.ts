import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'

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

// After a build, source PDFs live in input/_pdfs (only their extracted .txt
// stays in input/), so both directories must be scanned or PDF rows vanish
// from the corpus table as soon as a build runs.
async function listInputFiles(root: string) {
  const dirs = [
    { dir: path.join(root, 'input'), types: ['txt', 'pdf'] },
    { dir: path.join(root, 'input', '_pdfs'), types: ['pdf'] },
  ]
  const files: Array<{ name: string; size: number; mtime: number; type: 'pdf'|'txt' }> = []
  for (const { dir, types } of dirs) {
    try {
      const ents = await fs.readdir(dir, { withFileTypes: true })
      for (const e of ents) {
        if (!e.isFile()) continue
        const ext: 'pdf'|'txt' = e.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'txt'
        if (!types.includes(ext)) continue
        const st = await fs.stat(path.join(dir, e.name))
        files.push({ name: e.name, size: st.size, mtime: st.mtimeMs, type: ext })
      }
    } catch {}
  }
  return files.sort((a, b) => b.mtime - a.mtime)
}

async function readStats(root: string) {
  const statsPath = path.join(root, 'output', 'stats.json')
  try {
    const raw = await fs.readFile(statsPath, 'utf-8')
    const j = JSON.parse(raw)
    return {
      entities: j?.entities ?? j?.entity_count,
      relationships: j?.relationships ?? j?.relationship_count,
      communities: j?.communities ?? j?.community_count,
      text_units: j?.text_units ?? j?.text_unit_count,
      last_index_time: j?.last_index_time,
    }
  } catch { return undefined }
}

async function readUploads(root: string): Promise<UploadEntry[]> {
  const p = path.join(root, 'output', 'uploads.json')
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed as UploadEntry[] : []
  } catch {
    return []
  }
}

// Read-only: this endpoint is polled while builds run and must never write
// uploads.json, or it races the pipeline's own registry updates and rows
// get silently dropped. Only upload/remove/build mutate the registry.
export async function GET() {
  const root = process.cwd()
  const inputFiles = await listInputFiles(root)
  let outputStats = await readStats(root)
  let kgName: string | undefined
  try {
    const raw = await fs.readFile(path.join(root, 'output', 'kg.json'), 'utf-8')
    const meta = JSON.parse(raw) as { name?: string }
    if (meta?.name) kgName = String(meta.name)
  } catch {}
  // The generated JSON files are the UI's authoritative dataset. Count them
  // directly so stale GraphRAG stats cannot report a partially empty graph.
  try {
    const dataDir = path.join(root, 'output')
    const safeCount = async (name: string) => {
      try { const raw = await fs.readFile(path.join(dataDir, name), 'utf-8'); const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.length : 0 } catch { return 0 }
    }
    const entities = await safeCount('entities.json')
    const relationships = await safeCount('relationships.json')
    const communities = await safeCount('communities.json')
    const text_units = await safeCount('text_units.json')
    const total = entities + relationships + communities + text_units
    if (total > 0) {
      let last_index_time = outputStats?.last_index_time
      if (!last_index_time) {
        try { const st = await fs.stat(path.join(dataDir, 'entities.json')); last_index_time = new Date(st.mtimeMs).toISOString() } catch {}
      }
      outputStats = { entities, relationships, communities, text_units, last_index_time }
    } else {
      outputStats = undefined
    }
  } catch {}
  const uploads = await readUploads(root)
  const byName = new Map<string, UploadEntry>()
  for (const u of uploads) {
    byName.set(u.name, { ...u, status: u.status === 'removed' ? 'pending_removal' : u.status })
  }
  for (const f of inputFiles) {
    const existing = byName.get(f.name)
    if (existing) {
      existing.size = f.size
      existing.mtime = f.mtime
      existing.type = f.type
    } else {
      // File exists on disk but not in the registry (e.g. registry lost in a
      // project swap). Resurface it; an already-built graph implies indexed.
      byName.set(f.name, { name: f.name, size: f.size, mtime: f.mtime, type: f.type, status: outputStats ? 'indexed' : 'pending' })
    }
  }
  const merged: UploadEntry[] = Array.from(byName.values()).sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
  return NextResponse.json({ uploads: merged, outputStats, queue: [], kgName })
}
