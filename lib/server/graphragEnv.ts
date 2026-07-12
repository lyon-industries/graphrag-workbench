export type GraphRagProvider = 'configured' | 'openai' | 'ollama'

export function resolveGraphRagEnv(source: NodeJS.ProcessEnv = process.env): {
  env: NodeJS.ProcessEnv
  provider: GraphRagProvider
  completionModel: string
  embeddingModel: string
} {
  const env = { ...source }

  if (env.GRAPHRAG_COMPLETION_PROVIDER) {
    return {
      env,
      provider: 'configured',
      completionModel: env.GRAPHRAG_COMPLETION_MODEL || 'configured',
      embeddingModel: env.GRAPHRAG_EMBEDDING_MODEL || 'configured',
    }
  }

  env.GRAPHRAG_COMPLETION_PROVIDER = 'ollama'
  env.GRAPHRAG_COMPLETION_MODEL = 'gemma4:latest'
  env.GRAPHRAG_COMPLETION_API_BASE = 'http://127.0.0.1:11434'
  env.GRAPHRAG_EMBEDDING_PROVIDER = 'ollama'
  env.GRAPHRAG_EMBEDDING_MODEL = 'nomic-embed-text:latest'
  env.GRAPHRAG_EMBEDDING_API_BASE = 'http://127.0.0.1:11434'
  env.GRAPHRAG_API_KEY = 'ollama'
  return { env, provider: 'ollama', completionModel: 'gemma4:latest', embeddingModel: 'nomic-embed-text:latest' }
}
