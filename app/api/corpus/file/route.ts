import { NextRequest } from 'next/server'
import path from 'node:path'
import fs from 'node:fs/promises'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const name = url.searchParams.get('name') || ''
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return new Response('Invalid name', { status: 400 })
  }
  const root = process.cwd()
  let filePath = path.join(root, 'input', name)
  try {
    let data: Buffer
    try {
      data = await fs.readFile(filePath)
    } catch {
      // also look in input/_pdfs for archived PDFs
      filePath = path.join(root, 'input', '_pdfs', name)
      data = await fs.readFile(filePath)
    }
    const lower = name.toLowerCase()
    const contentType = lower.endsWith('.pdf') ? 'application/pdf' : 'text/plain; charset=utf-8'
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${name}"`,
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
