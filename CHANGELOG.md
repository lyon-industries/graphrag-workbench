# Changelog

## 2.0.0 - 2026-07-12

- upgraded the pinned indexing engine to Microsoft GraphRAG 3.1.0
- moved index builds into a server-owned job: closing the Builder no longer interrupts a build, skips artifact conversion, or bleeds terminal output across projects
- builds now populate the constellation live: entities and relationships appear when extraction completes, communities when clustering completes
- the engine log is tailed into the Terminal during builds; fatal provider errors (exhausted quota, rejected key, missing model) stop the run immediately with the cause and remedy named
- creating, restoring, or deleting a project stops any running build so logs and artifacts stay with their project
- source PDFs remain visible in the corpus table after builds; the state endpoint is read-only and no longer races the pipeline's registry writes
- request concurrency and embedding vector width are environment-resolved per provider (GRAPHRAG_CONCURRENT_REQUESTS, GRAPHRAG_EMBEDDING_VECTOR_SIZE), fixing Ollama's 768-dimension embeddings and making OpenAI parallelism tunable
- the Projects button shows a live build indicator while the Builder is closed
- the Lyon Industries mark links to lyon-industries.no
- added native OpenAI Luna and Ollama configuration
- rebuilt project, source-file, indexing, and terminal controls
- made indexing cancellable and workflow state persistent
- added safe text-backed PDF validation and transactional removal
- restored and optimized the original full-screen Three.js graph
- added a conditional entity Inspector and community traversal
- removed Chat pending a focused redesign
- applied the Lyon Industries black, white, and Propellant interface system
