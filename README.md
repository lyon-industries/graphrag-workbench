# GraphRAG Workbench

A local workbench for turning documents into an inspectable 3D knowledge graph.

GraphRAG Workbench wraps [Microsoft GraphRAG](https://github.com/microsoft/graphrag) with local document preparation, indexing controls, a live terminal, project management, and the original Three.js graph. It is a dedicated open-source desktop-style web app: clone it, configure a model provider, and run it on your machine.

## Version 2.0

- Microsoft GraphRAG 3.1.0, pinned with `uv`
- OpenAI Luna and local Ollama provider configuration
- full-screen 3D graph with search and community isolation
- contextual Inspector for selected entities and their strongest connections
- local Projects sheet for naming, loading, renaming, deleting, files, statistics, builds, and terminal output
- cancellable indexing with persisted workflow status
- text-backed PDF validation and transactional file removal
- no account, hosted database, or remote document service

Chat is intentionally absent from 2.0 while its next interaction model is designed.

## Requirements

- Node.js 20.9 or later
- pnpm
- Python 3.12
- [uv](https://docs.astral.sh/uv/)
- an OpenAI API key or a running [Ollama](https://ollama.com/) installation

## Install

```bash
git clone https://github.com/lyon-industries/graphrag-workbench.git
cd graphrag-workbench
pnpm install
uv sync --frozen
cp .env.example .env
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Development and production commands bind to the local interface.

## OpenAI Luna

Add your key to `.env`; do not commit it.

```dotenv
GRAPHRAG_COMPLETION_PROVIDER=openai
GRAPHRAG_COMPLETION_MODEL=gpt-5.6-luna
GRAPHRAG_COMPLETION_API_BASE=https://api.openai.com/v1
GRAPHRAG_EMBEDDING_PROVIDER=openai
GRAPHRAG_EMBEDDING_MODEL=text-embedding-3-small
GRAPHRAG_EMBEDDING_API_BASE=https://api.openai.com/v1
GRAPHRAG_API_KEY=your_key_here
```

The LanceDB schema is explicitly configured for the embedding model's 1,536 dimensions. Indexing is serial by default because some OpenAI projects reject parallel Luna requests with a misleading permission error. A small text-backed PDF completed every GraphRAG 3.1 workflow on 12 July 2026 and produced 74 entities, 37 relationships, 2 communities, and 4 text units.

Indexing sends document content to the configured provider and can consume substantial model tokens. Start with a small corpus.

## Ollama

```bash
ollama pull gemma4:latest
ollama pull nomic-embed-text:latest
```

Replace the OpenAI values in `.env` with the commented Ollama configuration in `.env.example`. Local completion models must produce GraphRAG's structured extraction format; endpoint availability alone does not guarantee a usable graph.

## Build and inspect a graph

1. Open **Projects**.
2. Give the project a human-readable name.
3. Add one or more text-backed PDFs.
4. Select **Build graph** and follow each workflow in the Terminal.
5. Close Projects to explore the graph.
6. Select a node to open its Inspector; select a connected entity to traverse the graph.

`Cmd/Ctrl + K` focuses entity search. Drag rotates, scroll zooms, and right-drag pans. **Isolate community** focuses the selected hierarchy.

Image-only PDFs are rejected with an explicit terminal message. OCR is not included in 2.0. Removing a source schedules it for deletion; the file and its derived text are deleted only after the replacement graph builds successfully.

## Local data flow

```text
text-backed PDF
  -> local text extraction
  -> Microsoft GraphRAG 3.1
  -> parquet + LanceDB
  -> local JSON conversion
  -> Three.js graph + Inspector
```

Runtime documents, output, caches, logs, and project archives are excluded from Git. Configured model providers still receive the content required for their calls.

## Quality gates

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm audit --prod
uv lock --check
```

## Stack

| Area | Implementation |
| --- | --- |
| Application | Next.js 16.2, React 19.2, TypeScript |
| Graph | React Three Fiber, Three.js, `d3-force-3d` |
| Engine | Microsoft GraphRAG 3.1.0, Python 3.12, `uv` |
| Storage | local filesystem, parquet, JSON, LanceDB |
| Progress | server-sent events and persisted local logs |

## License

[MIT](LICENSE). Microsoft GraphRAG provides extraction, community analysis, and indexing. GraphRAG Workbench provides the local operator interface.

Built by [Lyon Industries](https://lyon-industries.no) in Stavanger, Norway.
