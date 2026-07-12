import { spawn } from 'node:child_process'

const SAFE_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/

export async function GET(request: Request) {
  const model = new URL(request.url).searchParams.get('model')?.trim() || ''
  if (!SAFE_MODEL.test(model)) return new Response('Invalid model', { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (payload: Record<string, unknown>) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)) } catch { closed = true }
      }
      const close = () => {
        if (closed) return
        closed = true
        try { controller.close() } catch {}
      }
      const child = spawn('ollama', ['pull', model], { cwd: process.cwd() })
      const handle = (chunk: Buffer) => {
        for (const line of chunk.toString().replace(/\r/g, '\n').split('\n').map(value => value.trim()).filter(Boolean)) {
          send({ type: 'progress', line })
        }
      }
      child.stdout.on('data', handle)
      child.stderr.on('data', handle)
      child.on('error', error => { send({ type: 'done', ok: false, error: error.message }); close() })
      child.on('close', code => { send({ type: 'done', ok: code === 0, code }); close() })
      request.signal.addEventListener('abort', () => { if (!child.killed) child.kill('SIGTERM'); close() })
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
