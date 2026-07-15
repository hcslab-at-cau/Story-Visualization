# V3 Grounded QA Answer Design

## Goal

Turn the existing progress-safe hybrid retrieval result into a concise answer that cites only source paragraphs the reader has already reached.

## Scope

- Add query-time answer generation after V3 QA retrieval.
- Use the existing OpenRouter `LLMClient` and prompt loader.
- Ground generation in original PRE.1 paragraph text selected by retrieval spans.
- Validate every paragraph citation and retrieval evidence ID on the server.
- Show the answer and clickable paragraph citations in `Reading QA`.
- Keep retrieval-only API behavior available.

Deferred: conversation history, answer persistence, cross-chapter/full-book orchestration, reranking, streaming tokens, and a new stored pipeline stage.

## Architecture

1. Extract the current run-level retrieval loading code into a server-only helper used by both QA endpoints.
2. `POST /api/pipeline/v3-qa-answer` runs the same progress-safe retrieval as `/v3-qa-retrieve`.
3. A pure answer-contract module selects original paragraphs covered by ranked hits without crossing `progressEndPid`, assigns stable `E1...En` evidence IDs, and enforces a bounded context.
4. The LLM returns JSON with `status`, `answer`, `citation_pids`, and `used_evidence_ids`.
5. The server removes unknown/future citations and unknown evidence IDs. An `answered` response without a non-empty answer, a valid paragraph citation, and a valid evidence ID is downgraded to `insufficient_evidence`.
6. The UI renders the answer first, followed by validated `P#` citation buttons and the existing retrieval diagnostics.

## Answer Contract

```ts
type V3QAAnswerStatus = "answered" | "insufficient_evidence"

interface V3QAGroundedAnswer {
  status: V3QAAnswerStatus
  text: string
  citations: Array<{ pid: number; paragraph_text: string }>
  used_evidence: Array<{
    evidence_id: string
    record_id: string
    record_type: V3RetrievalRecordType
    label: string
  }>
}

interface V3QAAnswerResult {
  retrieval: V3QARetrievalResult
  answer: V3QAGroundedAnswer
}
```

## Context Policy

- Only retrieval hits that survived the progress cutoff may contribute context.
- Only original paragraphs whose PID is both inside a hit span and `<= progressEndPid` may be sent.
- Paragraphs are added in retrieval-rank order and deduplicated by PID.
- The context has a fixed character budget; complete paragraphs are kept and partial paragraphs are not fabricated.
- Retrieved summaries provide event/scene structure, while original paragraphs are the citation authority.

## Failure Behavior

- Missing PRE.1 or retrieval prerequisites: return 400.
- Missing/invalid progress: return 400.
- Stale/corrupt IDX.2: preserve the existing fail-closed 409/error behavior.
- No usable paragraph context: return `insufficient_evidence` without calling the LLM.
- Invalid LLM citation IDs: discard them; downgrade an unsupported answer.
- LLM/provider failure: return an API error and keep the current evidence UI state clear.

## Verification

- Unit tests for paragraph selection, future-PID exclusion, context budget, citation validation, and downgrade behavior.
- Existing V3 retrieval tests remain green.
- Alice runtime question returns a grounded answer with validated citations.
- A progress-limited Alice question contains no citation above the selected PID.
- Playwright verifies answer layout, citation controls, and zero console errors.
