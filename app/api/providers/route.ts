import { NextResponse } from 'next/server'
import { getProviderStatus, removeCloudKey, saveCloudConfig, saveLocalConfig } from '@/lib/server/providerConfig'

export async function GET() {
  return NextResponse.json(await getProviderStatus())
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      provider?: 'local' | 'cloud'
      apiKey?: string
      completionModel?: string
      embeddingModel?: string
      embeddingVectorSize?: number
    }
    if (body.provider === 'cloud') {
      await saveCloudConfig({ apiKey: body.apiKey || '', completionModel: body.completionModel, embeddingModel: body.embeddingModel })
    } else if (body.provider === 'local') {
      await saveLocalConfig({ completionModel: body.completionModel, embeddingModel: body.embeddingModel, embeddingVectorSize: body.embeddingVectorSize })
    } else {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
    }
    return NextResponse.json(await getProviderStatus())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save provider' }, { status: 400 })
  }
}

export async function DELETE() {
  await removeCloudKey()
  return NextResponse.json(await getProviderStatus())
}
