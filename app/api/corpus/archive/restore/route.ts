import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'

async function moveDir(src: string, dst: string) {
  try {
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.rename(src, dst)
    return
  } catch {
    // fallback: copy then remove
    await fs.mkdir(dst, { recursive: true })
    const ents = await fs.readdir(src, { withFileTypes: true }).catch(() => [])
    for (const ent of ents) {
      const s = path.join(src, ent.name)
      const d = path.join(dst, ent.name)
      if (ent.isDirectory()) {
        await moveDir(s, d)
      } else if (ent.isFile()) {
        await fs.copyFile(s, d).catch(() => {})
      }
    }
    await fs.rm(src, { recursive: true, force: true }).catch(() => {})
  }
}

async function pathExists(p: string) {
  try { await fs.stat(p); return true } catch { return false }
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json().catch(() => ({})) as { name?: string }
    if (!name || /[\\/]/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    const root = process.cwd()
    const base = path.join(root, 'archives', name)
    // Verify archive exists
    await fs.stat(base)

    let currentKgName = name
    try {
      const raw = await fs.readFile(path.join(root, 'output', 'kg.json'), 'utf-8')
      const meta = JSON.parse(raw) as { name?: string }
      if (meta?.name) currentKgName = String(meta.name)
    } catch {}

    // 1) Swap: first move the target archive aside to a temp location
    const tmp = path.join(root, 'archives', `${name}.__swap__${Date.now()}`)
    await moveDir(base, tmp)

    // 2) Create a new archive folder at the original base path and move CURRENT working set into it
    await fs.mkdir(base, { recursive: true })
    const dirs = ['output', 'cache', 'logs', 'input']
    for (const dir of dirs) {
      const src = path.join(root, dir)
      const dst = path.join(base, dir)
      if (await pathExists(src)) {
        await moveDir(src, dst)
      }
    }
    // Persist current KG name into the new archive's kg.json
    try {
      await fs.writeFile(path.join(base, 'kg.json'), JSON.stringify({ name: currentKgName, archived_at: Date.now() }, null, 2))
    } catch {}
    // Move aggregated root log history into the new archive
    try {
      const rootLog = path.join(root, 'logs_history.log')
      const archLog = path.join(base, 'logs_history.log')
      if (await pathExists(rootLog)) await fs.rename(rootLog, archLog)
    } catch {}

    // 3) Restore: move the TEMP archived dataset back into working root
    for (const dir of dirs) {
      const src = path.join(tmp, dir)
      const dst = path.join(root, dir)
      if (await pathExists(src)) {
        await fs.rm(dst, { recursive: true, force: true }).catch(() => {})
        await moveDir(src, dst)
      }
    }
    // Copy kg.json to working output if present in tmp
    try {
      const metaSrc = path.join(tmp, 'kg.json')
      const metaDst = path.join(root, 'output', 'kg.json')
      if (await pathExists(metaSrc)) {
        const raw = await fs.readFile(metaSrc, 'utf-8')
        await fs.mkdir(path.dirname(metaDst), { recursive: true })
        await fs.writeFile(metaDst, raw)
      }
    } catch {}
    // Move aggregated log history back to root if present
    try {
      const archLog = path.join(tmp, 'logs_history.log')
      const rootLog = path.join(root, 'logs_history.log')
      if (await pathExists(archLog)) await fs.rename(archLog, rootLog)
    } catch {}

    // 4) Remove temp folder; the original archive name now contains the PREVIOUS working set
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to restore'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
