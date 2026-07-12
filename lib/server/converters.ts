import fs from 'node:fs/promises'
import path from 'node:path'
// Avoid top-level import to prevent Turbopack from trying to load test assets from pdf-parse
// Dynamically import inside the function instead
import parquet from 'parquetjs-lite'
import { execFile } from 'node:child_process'

function execFileP(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export async function convertPdfToText(pdfPath: string, outputDir: string, outputName?: string): Promise<string> {
  // Import the inner implementation to avoid debug code in pdf-parse/index.js
  // that tries to read local test assets when module.parent is undefined.
  type PdfParseFn = (buf: Buffer, opts?: unknown) => Promise<{ text: string; numpages?: number }>
  const modUnknown = await import('pdf-parse/lib/pdf-parse.js')
  let pdfParse: PdfParseFn
  if (typeof (modUnknown as unknown as PdfParseFn) === 'function') {
    pdfParse = modUnknown as unknown as PdfParseFn
  } else {
    pdfParse = (modUnknown as { default: PdfParseFn }).default
  }
  const buf = await fs.readFile(pdfPath)
  const data = await pdfParse(buf)
  const extractedText = data.text || ''
  if (extractedText.trim().length < 100) {
    throw new Error('IMAGE_ONLY_PDF: no usable text layer detected; replace this file with a text-backed PDF')
  }
  const base = outputName || path.basename(pdfPath).replace(/\.pdf$/i, '') + '.txt'
  const outPath = path.join(outputDir, base)
  await fs.mkdir(outputDir, { recursive: true })
  const header = `\n${'='.repeat(50)}\nEXTRACTED FROM: ${path.basename(pdfPath)}\nPAGES: ${data.numpages ?? ''}\n${'='.repeat(50)}\n\n`
  await fs.writeFile(outPath, header + extractedText, 'utf-8')
  return outPath
}

async function readParquetAll(filePath: string): Promise<unknown[]> {
  const reader = await parquet.ParquetReader.openFile(filePath)
  try {
    const cursor = reader.getCursor()
    const rows: unknown[] = []
    let rec: unknown
    while ((rec = await cursor.next())) {
      rows.push(rec as unknown)
    }
    return rows
  } finally {
    await reader.close()
  }
}

async function readParquetViaPython(filePath: string): Promise<unknown[]> {
  const code = [
    'import sys, json',
    'import pyarrow.parquet as pq',
    'tbl = pq.read_table(sys.argv[1])',
    'print(json.dumps(tbl.to_pylist()))',
  ].join('; ')
  // PyArrow is pinned in the project's uv environment with GraphRAG. Do not
  // depend on a globally installed Python package.
  const { stdout } = await execFileP('uv', ['run', 'python', '-c', code, filePath], {
    cwd: path.dirname(path.dirname(filePath)),
  })
  try { return JSON.parse(stdout) as unknown[] } catch { return [] }
}

export async function convertGraphParquetToJson(outputDir: string): Promise<{ converted: number }>{
  const targets = [
    'entities.parquet',
    'relationships.parquet',
    'communities.parquet',
    'community_reports.parquet',
    'text_units.parquet',
  ]

  await fs.mkdir(outputDir, { recursive: true })
  let converted = 0
  for (const fname of targets) {
    const parquetPath = path.join(outputDir, fname)
    try {
      await fs.stat(parquetPath)
    } catch {
      continue
    }
    let rows: unknown[] = []
    try {
      rows = await readParquetAll(parquetPath)
    } catch {
      // Fallback to Python (pyarrow/pandas) for parquet versions not supported by parquetjs-lite
      rows = await readParquetViaPython(parquetPath)
    }
    const jsonName = fname.replace(/\.parquet$/i, '.json')
    // Write JSON alongside the parquet in output/ for parity
    const outJsonInOutput = path.join(outputDir, jsonName)
    await fs.writeFile(outJsonInOutput, JSON.stringify(rows, null, 2), 'utf-8')
    converted++
  }
  // optional stats/context already live in output/ if produced
  return { converted }
}
