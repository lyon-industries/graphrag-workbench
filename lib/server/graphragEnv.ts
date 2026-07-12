export type GraphRagProvider = 'configured' | 'openai' | 'ollama'

// GraphRAG's config loader hard-fails on any ${VAR} in settings.yaml that is
// missing from the environment, so every variable referenced there must be
// resolved here with a default before a graphrag process is spawned.
const OPENAI_DEFAULT_CONCURRENCY = '4'
const OLLAMA_DEFAULT_CONCURRENCY = '1'

export function resolveGraphRagEnv(source: NodeJS.ProcessEnv = process.env): {
  env: NodeJS.ProcessEnv
  provider: GraphRagProvider
  completionModel: string
  embeddingModel: string
  concurrency: number
} {
  const env = { ...source }

  let provider: GraphRagProvider
  let completionModel: string
  let embeddingModel: string

  if (env.GRAPHRAG_COMPLETION_PROVIDER) {
    provider = 'configured'
    completionModel = env.GRAPHRAG_COMPLETION_MODEL || 'configured'
    embeddingModel = env.GRAPHRAG_EMBEDDING_MODEL || 'configured'
  } else {
    env.GRAPHRAG_COMPLETION_PROVIDER = 'ollama'
    env.GRAPHRAG_COMPLETION_MODEL = 'gemma4:latest'
    env.GRAPHRAG_COMPLETION_API_BASE = 'http://127.0.0.1:11434'
    env.GRAPHRAG_EMBEDDING_PROVIDER = 'ollama'
    env.GRAPHRAG_EMBEDDING_MODEL = 'nomic-embed-text:latest'
    env.GRAPHRAG_EMBEDDING_API_BASE = 'http://127.0.0.1:11434'
    env.GRAPHRAG_API_KEY = 'ollama'
    provider = 'ollama'
    completionModel = 'gemma4:latest'
    embeddingModel = 'nomic-embed-text:latest'
  }

  const usesOllamaCompletion = env.GRAPHRAG_COMPLETION_PROVIDER === 'ollama'
  if (!env.GRAPHRAG_CONCURRENT_REQUESTS) {
    // A local Ollama server executes one request at a time per model, so
    // extra concurrency only builds queue depth. Hosted APIs benefit from
    // parallel requests; raise via GRAPHRAG_CONCURRENT_REQUESTS in .env.
    env.GRAPHRAG_CONCURRENT_REQUESTS = usesOllamaCompletion
      ? OLLAMA_DEFAULT_CONCURRENCY
      : OPENAI_DEFAULT_CONCURRENCY
  }

  if (!env.GRAPHRAG_EMBEDDING_VECTOR_SIZE) {
    // text-embedding-3-small emits 1536 dims; nomic-embed-text emits 768.
    // LanceDB rejects vectors whose width differs from the table schema.
    env.GRAPHRAG_EMBEDDING_VECTOR_SIZE = env.GRAPHRAG_EMBEDDING_PROVIDER === 'ollama' ? '768' : '1536'
  }

  const concurrency = Number.parseInt(env.GRAPHRAG_CONCURRENT_REQUESTS, 10) || 1

  return { env, provider, completionModel, embeddingModel, concurrency }
}
