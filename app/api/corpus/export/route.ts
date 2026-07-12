import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'

const GRAPH_ARTIFACTS = ['entities', 'relationships', 'communities', 'community_reports', 'text_units'] as const

export async function GET() {
  const root = process.cwd()
  const outputDir = path.join(root, 'output')
  try {
    const projectName = await fs.readFile(path.join(outputDir, 'kg.json'), 'utf-8')
      .then(raw => String((JSON.parse(raw) as { name?: string }).name || 'graphrag-project').trim())
      .catch(() => 'graphrag-project')
    const artifacts: Record<string, unknown[]> = {}
    for (const name of GRAPH_ARTIFACTS) {
      const value = await fs.readFile(path.join(outputDir, `${name}.json`), 'utf-8')
        .then(raw => JSON.parse(raw) as unknown)
        .catch(() => undefined)
      if (Array.isArray(value)) artifacts[name] = value
    }
    if (!artifacts.entities?.length || !Array.isArray(artifacts.relationships)) {
      return NextResponse.json({ error: 'This project has no complete graph output to export.' }, { status: 409 })
    }
    const safeName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'graphrag-project'
    const body = JSON.stringify({
      format: 'graphrag-workbench-output',
      version: 1,
      exportedAt: new Date().toISOString(),
      projectName,
      artifacts,
    })
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}.graphrag.json"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Output export failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
