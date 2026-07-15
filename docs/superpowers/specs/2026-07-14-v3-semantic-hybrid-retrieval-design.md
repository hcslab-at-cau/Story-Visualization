# V3 Semantic Hybrid Retrieval Design

## Goal

Add a semantic retrieval layer after `IDX.1` and use it in Reading QA without allowing evidence beyond the reader's selected paragraph.

## Architecture

`IDX.1` remains the canonical structured, graph, and text index. A new `IDX.2` stage embeds each `IDX.1.text_documents` entry with the existing OpenRouter credential and stores only compact metadata in Firestore. The vector payload is gzip-compressed in the V3 Firebase Storage namespace because a chapter-sized embedding matrix can exceed Firestore's document limit.

At query time, the server embeds the question, removes records whose resolved event or scene span ends after `progressEndPid`, and creates lexical and semantic rankings over the remaining records. Reciprocal Rank Fusion combines the two rankings without treating incomparable lexical and cosine scores as if they shared one scale. Existing graph-neighbor expansion runs after fusion.

If `IDX.2` has not been run, Reading QA keeps the current lexical plus graph behavior and labels the result as lexical fallback. This preserves existing V3 runs and makes semantic indexing an explicit, inspectable stage.

## Data Contract

`IDX.2` Firestore artifact:

- embedding provider and model
- vector dimensions and document count
- source `IDX.1` text fingerprint
- vector blob path, content hash, compressed byte size, and content type

Vector blob in Firebase Storage:

- version, model, dimensions
- ordered `{ text_doc_id, embedding }` rows

The query API rejects a vector blob whose model, dimensions, count, or source fingerprint does not match its `IDX.2` metadata.

## Retrieval Contract

Each result exposes:

- retrieval mode: `hybrid` or `lexical_fallback`
- match channel: `hybrid`, `semantic`, `lexical`, or `graph_neighbor`
- semantic cosine similarity when available
- lexical matched terms
- fused ranking score for ordering only
- evidence refs and resolved paragraph span

Progress filtering is a hard pre-ranking constraint. It is not a score penalty.

## Errors

`IDX.2` returns a clear setup error when `OPENROUTER_API_KEY` is unavailable. Reading QA falls back only when the stage is absent; a present but corrupt or mismatched vector artifact is reported as an error so stale embeddings cannot silently affect retrieval.

## Testing

Pure tests cover vector-document construction, cosine similarity, source fingerprint validation, hybrid retrieval of semantically related text with no lexical overlap, lexical fallback, graph expansion, and reader-progress exclusion. Existing V3 tests, TypeScript, lint, build, and an in-app browser pass cover integration and UI behavior.
