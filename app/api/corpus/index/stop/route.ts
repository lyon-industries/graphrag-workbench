import { NextResponse } from 'next/server'
import { stopIndexJob } from '@/lib/server/indexJob'

export async function POST() {
  const result = await stopIndexJob()
  const status = result.ok ? 200 : result.code === 'NO_ACTIVE_INDEX_JOB' ? 409 : 500
  return NextResponse.json(result, { status })
}
