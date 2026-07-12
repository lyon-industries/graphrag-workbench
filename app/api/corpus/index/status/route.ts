import { NextResponse } from 'next/server'
import { getIndexJob } from '@/lib/server/indexJob'

export async function GET() {
  const job = getIndexJob()
  return NextResponse.json({
    running: job?.status === 'running',
    status: job?.status ?? 'idle',
    startedAt: job?.startedAt ?? null,
    finishedAt: job?.finishedAt ?? null,
    jobId: job?.id ?? null,
    progress: job?.progress ?? 0,
    dataVersion: job?.dataVersion ?? 0,
    provider: job?.provider ?? null,
    completionModel: job?.completionModel ?? null,
    fatalError: job?.fatalError ?? null,
  })
}
