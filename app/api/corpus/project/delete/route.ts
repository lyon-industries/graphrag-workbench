import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { clearIndexJobRecord, stopIndexJob } from '@/lib/server/indexJob'

export async function POST() {
  try {
    await stopIndexJob()
    const root = process.cwd()
    await Promise.all([
      fs.rm(path.join(root, 'input'), { recursive: true, force: true }),
      fs.rm(path.join(root, 'output'), { recursive: true, force: true }),
      fs.rm(path.join(root, 'cache'), { recursive: true, force: true }),
      fs.rm(path.join(root, 'logs'), { recursive: true, force: true }),
      fs.rm(path.join(root, 'logs_history.log'), { force: true }),
    ])

    await Promise.all([
      fs.mkdir(path.join(root, 'input'), { recursive: true }),
      fs.mkdir(path.join(root, 'output'), { recursive: true }),
      fs.writeFile(path.join(root, 'logs_history.log'), ''),
    ])
    await fs.writeFile(path.join(root, 'output', 'kg.json'), JSON.stringify({ name: '' }, null, 2))

    clearIndexJobRecord()
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete project'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
