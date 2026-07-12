import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs/promises'

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const name = String(body?.name || '')
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }
    const root = process.cwd()
    // Keep files until a replacement graph is built successfully. The index
    // pipeline stages pending removals out of its input set, then deletes them
    // only after the new graph has been committed.
    const uploadsPath = path.join(root, 'output', 'uploads.json')
    const raw = await fs.readFile(uploadsPath, 'utf-8').catch(() => '[]')
    const parsed = JSON.parse(raw) as unknown
    const reg: UploadEntry[] = Array.isArray(parsed) ? parsed as UploadEntry[] : []
    const idx = reg.findIndex((r) => r.name === name)
    if (idx >= 0) {
      reg[idx].status = 'pending_removal'
      reg[idx].removed_at = Date.now()
    } else {
      // The file exists on disk but not in the registry (state resurfaces
      // such files); register it so the next build stages the removal.
      reg.push({
        name,
        size: 0,
        mtime: Date.now(),
        type: name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'txt',
        status: 'pending_removal',
        removed_at: Date.now(),
      })
    }
    await fs.mkdir(path.dirname(uploadsPath), { recursive: true })
    await fs.writeFile(uploadsPath, JSON.stringify(reg, null, 2))
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to remove'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
