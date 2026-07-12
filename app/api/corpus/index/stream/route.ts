import { NextRequest } from 'next/server'
import { getIndexJob, startIndexJob, type IndexJob, type IndexJobEvent } from '@/lib/server/indexJob'

// The index job is owned by the server (lib/server/indexJob.ts) and keeps
// running if this stream disconnects — closing the Builder mid-build must
// never kill the pipeline or skip output finalization. This route only
// starts a job (or attaches to the running one) and forwards its events.
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  const requestedMethod = request.nextUrl.searchParams.get('method')
  const method = requestedMethod === 'fast' ? 'fast' : 'standard'
  const attach = request.nextUrl.searchParams.get('attach') === '1'

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (payload: Record<string, unknown>) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          closed = true
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        try { controller.close() } catch {}
      }

      let job: IndexJob | undefined
      if (attach) {
        job = getIndexJob()
        if (!job || job.status !== 'running') {
          send({ type: 'done', ok: job?.status === 'succeeded', code: job ? job.status.toUpperCase() : 'NO_ACTIVE_INDEX_JOB' })
          close()
          return
        }
      } else {
        const result = startIndexJob(method)
        if (result.error || !result.job) {
          send({ type: 'done', ok: false, code: result.error ?? 'START_FAILED' })
          close()
          return
        }
        job = result.job
      }

      send({ type: 'job', id: job.id, status: 'RUNNING' })
      const onEvent = (event: IndexJobEvent) => {
        send(event as unknown as Record<string, unknown>)
        if (event.type === 'done') {
          job?.emitter.off('event', onEvent)
          close()
        }
      }
      job.emitter.on('event', onEvent)
      request.signal.addEventListener('abort', () => {
        job?.emitter.off('event', onEvent)
        close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
