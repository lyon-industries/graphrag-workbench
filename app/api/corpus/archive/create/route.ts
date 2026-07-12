import { NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs/promises'

async function moveIfExists(src: string, dest: string) {
  try { await fs.stat(src) } catch { return }
  await fs.mkdir(path.dirname(dest), { recursive: true })
  try { await fs.rename(src, dest) } catch { await fs.rm(src, { recursive: true, force: true }) }
}

export async function POST() {
  try {
    const root = process.cwd()
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0,19)
    const archName = `kg-${ts}`
    const arch = path.join(root, 'archives', archName)
    await fs.mkdir(arch, { recursive: true })

    let name = archName
    try {
      const raw = await fs.readFile(path.join(root, 'output', 'kg.json'), 'utf-8')
      const meta = JSON.parse(raw) as { name?: string }
      if (meta?.name) name = String(meta.name)
    } catch {}

    await moveIfExists(path.join(root, 'output'), path.join(arch, 'output'))
    await moveIfExists(path.join(root, 'cache'), path.join(arch, 'cache'))
    await moveIfExists(path.join(root, 'logs'), path.join(arch, 'logs'))
    await moveIfExists(path.join(root, 'input'), path.join(arch, 'input'))

    // Persist KG name into archive root as kg.json
    const archKgMetaPath = path.join(arch, 'kg.json')
    try {
      await fs.writeFile(archKgMetaPath, JSON.stringify({ name, archived_at: Date.now() }, null, 2))
    } catch {}

    // Move aggregated terminal logs into the archive as well
    try {
      const rootLog = path.join(root, 'logs_history.log')
      const archLog = path.join(arch, 'logs_history.log')
      await fs.rename(rootLog, archLog)
    } catch {}

    // Recreate fresh working dirs
    await fs.mkdir(path.join(root, 'input'), { recursive: true })
    await fs.mkdir(path.join(root, 'output'), { recursive: true })
    // Reset working kg name
    try { await fs.writeFile(path.join(root, 'output', 'kg.json'), JSON.stringify({ name: '' }, null, 2)) } catch {}
    // Reset logs file
    try { await fs.writeFile(path.join(root, 'logs_history.log'), '') } catch {}
    return NextResponse.json({ ok: true, name: archName })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to archive'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
