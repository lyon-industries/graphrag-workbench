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

async function listInputFiles(root: string) {
  const dir = path.join(root, 'input')
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true })
    const files = await Promise.all(ents.filter(e => e.isFile()).map(async e => {
      const p = path.join(dir, e.name)
      const st = await fs.stat(p)
      const ext = e.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'txt'
      return { name: e.name, size: st.size, mtime: st.mtimeMs, type: ext as 'pdf'|'txt' }
    }))
    return files.sort((a,b) => b.mtime - a.mtime)
  } catch { return [] }
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

async function writeUploads(root: string, data: UploadEntry[]) {
  const p = path.join(root, 'output', 'uploads.json')
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(data, null, 2))
}

export async function GET() {
  const root = process.cwd()
  const inputFiles = await listInputFiles(root)
  let outputStats = await readStats(root)
  // Read KG name if present
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
  // Merge with uploads registry
  const uploads = await readUploads(root)
  uploads.forEach(upload => {
    if (upload.status === 'removed') upload.status = 'pending_removal'
  })
  const byName = new Map<string, UploadEntry>(uploads.map((u) => [u.name, u]))
  // ensure every file in input has an entry
  inputFiles.forEach((f) => {
    if (!byName.has(f.name)) {
      byName.set(f.name, { name: f.name, size: f.size, mtime: f.mtime, type: f.type, status: 'pending' })
    } else {
      const u = byName.get(f.name)!
      u.size = f.size; u.mtime = f.mtime; u.type = f.type
    }
  })
  const merged: UploadEntry[] = Array.from(byName.values()).sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
  // Persist merged registry
  await writeUploads(root, merged)
  return NextResponse.json({ uploads: merged, outputStats, queue: [], kgName })
}
