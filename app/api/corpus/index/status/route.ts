import { NextResponse } from 'next/server'
import { getIndexJob } from '@/lib/server/indexJob'

export async function GET() {
  const job = getIndexJob()
  return NextResponse.json({
    running: Boolean(job),
    startedAt: job?.startedAt ?? null,
    jobId: job?.id ?? null,
  })
}
