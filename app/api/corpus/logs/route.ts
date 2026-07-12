import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getIndexJob } from '@/lib/server/indexJob'

export async function GET() {
  try {
    const root = process.cwd()
    let logPath = path.join(root, 'logs_history.log')
    const job = getIndexJob()
    if (job?.status === 'running') {
      try {
        const raw = await fs.readFile(path.join(root, 'output', 'kg.json'), 'utf-8')
        const currentName = String((JSON.parse(raw) as { name?: string }).name || '').trim()
        if (currentName === job.projectName) logPath = path.join(job.workRoot, 'logs_history.log')
      } catch {}
    }
    const raw = await fs.readFile(logPath, 'utf-8').catch(() => '')
    if (!raw) return NextResponse.json([])
    const lines = raw.split(/\r?\n/).filter(Boolean)
    const entries = lines.map((l) => {
      const tab = l.indexOf('\t')
      if (tab > 0) {
        const ts = Date.parse(l.slice(0, tab))
        const text = l.slice(tab + 1)
        return { ts: isNaN(ts) ? Date.now() : ts, text }
      }
      return { ts: Date.now(), text: l }
    })
    return NextResponse.json(entries)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to read logs'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
