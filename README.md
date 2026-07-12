# GraphRAG Workbench

An open workbench for turning a PDF corpus into an inspectable knowledge graph.

GraphRAG Workbench wraps [Microsoft GraphRAG](https://github.com/microsoft/graphrag) with a local document pipeline, a 3D graph viewer, corpus controls, and four query modes. It is built to answer a practical question: once GraphRAG has extracted entities, relationships, and communities, can a person inspect the result well enough to find errors, navigate structure, and ask better questions?

[Open the interface preview](https://graphrag-workbench-web.vercel.app) · [Report an issue](https://github.com/lyon-industries/graphrag-workbench/issues)

![GraphRAG Workbench interface](https://github.com/user-attachments/assets/1f588a45-07ca-4953-92ed-fc888fe28cff)

## What it does

The workbench connects five operations in one interface:

1. Accept PDF files and extract their text locally.
2. Run the GraphRAG indexing pipeline and stream its logs to the browser.
3. Convert GraphRAG parquet output into data the viewer can render.
4. Explore entities, weighted relationships, and community hierarchy in 3D.
5. Query the indexed corpus with GraphRAG's DRIFT, local, global, or basic search.

The graph can be searched, filtered by entity or community, isolated by community level, and archived as a local working state. Node size and link width expose centrality and relationship weight; the inspector shows the underlying entity and relationship records.

## Operating boundary

This is an experimental, local-first system—not a hosted document service.

- Indexing calls the `graphrag` CLI from the Next.js server process.
- Documents, generated indexes, logs, and archives are written to the local filesystem.
- The included configuration uses OpenAI models and can incur API cost. Start with a small corpus and review `settings.yaml` before indexing.
- Graph extraction is probabilistic. A visible relationship is model output to inspect, not a verified fact.
- The hosted Vercel URL proves that the interface is available. Run the repository locally for PDF ingestion, persistent storage, and indexing.

Do not upload confidential, customer, employer, or regulated material without first reviewing the model provider, storage path, retention policy, and your authority to process it.

## Run it locally

### Prerequisites

- Node.js 20 or later
- pnpm
- Python 3.10 or later
- Microsoft GraphRAG available as the `graphrag` command
- An OpenAI API key

### Installation

```bash
git clone https://github.com/lyon-industries/graphrag-workbench.git
cd graphrag-workbench

pnpm install
python -m pip install graphrag
cp .env.example .env
```

Set your key in `.env`:

```dotenv
OPENAI_API_KEY=your_key_here
```

Review `settings.yaml` before the first run. The checked-in configuration currently uses `gpt-4o-mini-2024-07-18` for chat and extraction, `text-embedding-3-small` for embeddings, 1,200-token chunks, and local file storage.

Start the application:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build a graph

1. Open the **Corpus** panel.
2. Add one or more PDFs to the Dataset card.
3. Select **Run Index** and watch the indexing log.
4. Inspect the resulting entities, relationships, and communities in the graph.
5. Open **Chat** and choose DRIFT, local, global, or basic search for the question at hand.

Useful controls:

- `Cmd/Ctrl + K` focuses graph search.
- Drag rotates the graph, scroll zooms, and right-drag pans.
- **Community Isolator** narrows the view to a selected hierarchy.
- **Archives** preserves and restores local corpus/index states.

## How the pipeline fits together

```text
PDF upload
  -> local text extraction
  -> GraphRAG indexing
  -> parquet output
  -> JSON conversion
  -> 3D graph and inspector
  -> GraphRAG query
```

The application does not replace GraphRAG. It provides an operator interface around the upstream index and query commands.

| Area | Implementation |
| --- | --- |
| Web application | Next.js 15, React 19, TypeScript |
| Graph renderer | React Three Fiber, Three.js, `d3-force-3d` |
| Index and query engine | Microsoft GraphRAG CLI |
| PDF extraction | `pdf-parse` |
| Local persistence | Filesystem, parquet, JSON, and LanceDB output |
| Progress transport | Server-sent events from Next.js route handlers |

Key paths:

```text
app/                 Next.js interface and server routes
components/          Graph, corpus, chat, controls, and inspector
lib/                 Graph transforms, force layout, and PDF/parquet conversion
prompts/             GraphRAG extraction, report, and query prompts
settings.yaml        Model, storage, extraction, clustering, and query settings
input/               Local corpus created at runtime
output/              Local GraphRAG and viewer data created at runtime
archives/            Saved local working states created at runtime
```

## Development checks

```bash
pnpm lint
pnpm build
```

## Failure modes

### Indexing does not start

- Confirm `graphrag` resolves in the same shell that starts Next.js: `graphrag --help`.
- Confirm `.env` contains `OPENAI_API_KEY`.
- Review the streamed indexing log for model, rate-limit, prompt, or configuration errors.

### The graph stays empty after indexing

- Check that GraphRAG produced files under `output/`.
- Look for parquet-to-JSON conversion errors at the end of the indexing log.
- Start with a small, text-heavy PDF to separate extraction problems from corpus complexity.

### Queries fail or return weak evidence

- Confirm the index and query use compatible embedding settings.
- Compare query modes; they retrieve and aggregate context differently.
- Inspect the source graph before treating an answer as grounded. Missing or incorrect entities propagate into query results.

### Rendering becomes slow

- Isolate a community or filter entity types before increasing visual effects.
- Reduce the visible graph rather than assuming the force layout will remain readable at every corpus size.
- WebGL 2 support is required.

## Contributing

Open an issue before a major change so the intended test and operating boundary are clear. For a focused fix:

1. Fork the repository.
2. Create a short-lived branch.
3. Run `pnpm lint` and `pnpm build`.
4. Open a pull request that states what changed, how it was tested, and any unresolved failure mode.

## License and upstream work

The repository is available under the [MIT License](LICENSE).

GraphRAG Workbench depends on [Microsoft GraphRAG](https://github.com/microsoft/graphrag) for graph extraction, community analysis, and query workflows. Its interface also uses [React Three Fiber](https://github.com/pmndrs/react-three-fiber), [Three.js](https://threejs.org/), and [shadcn/ui](https://ui.shadcn.com/).

Built by [Lyon Industries](https://lyon-industries.no), an independent research, engineering, and design house in Stavanger.
