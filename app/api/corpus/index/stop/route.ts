import { execFile } from 'node:child_process'
import { NextResponse } from 'next/server'
import { clearIndexJob, getIndexJob } from '@/lib/server/indexJob'

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    try {
      process.kill(pid, signal)
      return true
    } catch {
      return false
    }
  }
}

export async function POST() {
  const job = getIndexJob()
  if (!job || !job.child.pid) {
    return NextResponse.json({ ok: false, code: 'NO_ACTIVE_INDEX_JOB' }, { status: 409 })
  }

  const pid = job.child.pid
  signalProcessGroup(pid, 'SIGTERM')

  for (let attempt = 0; attempt < 10 && processExists(pid); attempt++) {
    await wait(100)
  }

  if (processExists(pid)) {
    signalProcessGroup(pid, 'SIGKILL')
    for (let attempt = 0; attempt < 10 && processExists(pid); attempt++) {
      await wait(100)
    }
  }

  if (job.provider === 'ollama') {
    await new Promise<void>(resolve => {
      execFile('ollama', ['stop', job.completionModel], () => resolve())
    })
  }

  const stopped = !processExists(pid)
  if (stopped) clearIndexJob(job.id)

  return NextResponse.json(
    { ok: stopped, code: stopped ? 'STOPPED' : 'STOP_FAILED', jobId: job.id },
    { status: stopped ? 200 : 500 },
  )
}
