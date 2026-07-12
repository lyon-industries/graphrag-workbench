import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs/promises'
import { stopIndexJob } from '@/lib/server/indexJob'

async function moveIfExists(src: string, dest: string) {
  try {
    await fs.stat(src)
  } catch { return }
  await fs.mkdir(path.dirname(dest), { recursive: true })
  try {
    await fs.rename(src, dest)
  } catch {
    // fallback: rm if rename fails
    await rmrf(src)
  }
}

async function rmrf(p: string) {
  try { await fs.rm(p, { recursive: true, force: true }) } catch {}
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const confirm: string = String(body?.confirm || '')
    if (confirm !== 'NUKE INDEX') {
      return NextResponse.json({ error: 'Confirmation phrase mismatch' }, { status: 400 })
    }
    await stopIndexJob()
    const root = process.cwd()
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0,19)
    const arch = path.join(root, 'archives', `nuke-${ts}`)
    await fs.mkdir(arch, { recursive: true })

    // Move backend artifacts
    await moveIfExists(path.join(root, 'output'), path.join(arch, 'output'))
    await moveIfExists(path.join(root, 'cache'), path.join(arch, 'cache'))
    await moveIfExists(path.join(root, 'logs'), path.join(arch, 'logs'))

    // Move dataset (input)
    await moveIfExists(path.join(root, 'input'), path.join(arch, 'input'))

    // Recreate empty input dir
    await fs.mkdir(path.join(root, 'input'), { recursive: true })

    // Create clean output dir with no data yet
    await fs.mkdir(path.join(root, 'output'), { recursive: true })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to nuke index'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
