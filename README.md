# GraphRAG Workbench

A local workbench for turning documents into an inspectable 3D knowledge graph.

GraphRAG Workbench wraps [Microsoft GraphRAG](https://github.com/microsoft/graphrag) with local document preparation, indexing controls, a live terminal, project management, and the original Three.js graph. It is a dedicated open-source desktop-style web app: clone it, run it, and configure local or cloud models inside the Builder.

## Version 2.0

- Microsoft GraphRAG 3.1.0, pinned with `uv`
- per-build Local / Ollama and Cloud / OpenAI presets configured in the interface
- full-screen 3D graph with search and community isolation
- contextual Inspector for selected entities and their strongest connections
- local Projects sheet for naming, loading, renaming, deleting, files, statistics, builds, and terminal output
- cancellable server-owned indexing with persisted workflow status; builds survive closing the Builder
- live constellation population while a build runs: entities and relationships appear as extraction completes, communities as clustering completes
- engine-log surfacing with fast failure on fatal provider errors (quota, authentication, missing model)
- text-backed PDF validation and transactional file removal
- no account, hosted database, or remote document service

Chat is intentionally absent from 2.0 while its next interaction model is designed.

## Requirements

- Node.js 20.9 or later
- pnpm
- Python 3.12
- [uv](https://docs.astral.sh/uv/)
- no model provider is required before first launch; the Builder walks through Ollama or OpenAI setup

## Install

```bash
git clone https://github.com/lyon-industries/graphrag-workbench.git
cd graphrag-workbench
pnpm install
uv sync --frozen
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Development and production commands bind to the local interface.

## Configure builds in the interface

Open **Projects → Build providers**. Both presets can remain configured at the same time:

- **Local / Ollama** detects the Ollama installation and service, links to the official installer when absent, and pulls the selected completion and embedding models with visible progress. The default preset is Gemma 4 E4B plus Qwen3 Embedding 0.6B at 1,024 dimensions.
- **Cloud / OpenAI** accepts the API key and model names in a modal. The key is saved only on the local server in `.graphrag/providers.json`, which is excluded from Git and restricted to the operating-system account (`0600`). It is never returned to browser code.

Each build has an explicit **Build local** or **Build cloud** command. Local builds avoid provider token charges and keep model processing on the workstation; cloud builds are normally faster and can use a stronger extraction model. Cloud indexing sends document content to the configured provider and can consume substantial model tokens.

During a build the engine log is tailed into the Terminal. Fatal provider failures such as exhausted quota, a rejected key, or a missing model stop the run with the cause and recovery action named.

## Build and inspect a graph

1. Open **Projects**.
2. Give the project a human-readable name.
3. Add one or more text-backed PDFs.
4. Select **Build local** or **Build cloud** and follow each workflow in the Terminal. If that preset is not ready, the setup modal opens at the missing step.
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
