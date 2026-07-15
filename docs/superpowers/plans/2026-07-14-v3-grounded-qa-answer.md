# V3 Grounded QA Answer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a concise V3 QA answer from progress-safe retrieval evidence and expose only server-validated source paragraph citations.

**Architecture:** Keep answer generation query-time. Share the existing run-level retrieval loader between retrieval and answer routes, then pass a bounded set of original PRE.1 paragraphs and ranked evidence records through the existing JSON-mode LLM client. Normalize the LLM result through a pure contract validator before returning it to the UI.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, OpenRouter/OpenAI SDK, Firebase V3 artifacts, Node test runner, React, Playwright CLI.

---

### Task 1: Answer Context And Contract

**Files:**
- Create: `src/lib/pipeline/v3-qa-answer-types.ts`
- Create: `src/lib/pipeline/v3-qa-answer.ts`
- Create: `tests/v3-qa-answer.test.ts`

- [ ] Write failing tests proving that context paragraphs come only from ranked hit spans at or before `progressEndPid`.
- [ ] Write failing tests proving that unknown/future PIDs and unknown evidence IDs cannot survive normalization.
- [ ] Write a failing test proving unsupported `answered` output becomes `insufficient_evidence`.
- [ ] Implement the minimum context builder and answer normalizer.
- [ ] Run `node --experimental-strip-types --test tests/v3-qa-answer.test.ts` and confirm all tests pass.

### Task 2: Shared Retrieval Service And Answer API

**Files:**
- Create: `src/lib/server/v3-qa-retrieval-service.ts`
- Create: `src/app/api/pipeline/v3-qa-answer/route.ts`
- Modify: `src/app/api/pipeline/v3-qa-retrieve/route.ts`
- Modify: `src/lib/llm-client.ts`
- Create: `prompts/v3_qa_grounded_answer.txt`

- [ ] Move the existing artifact loading, IDX.2 integrity validation, query embedding, and pure retrieval call into the shared server helper without changing response behavior.
- [ ] Add `LLMClient.answerV3Question()` using the prompt loader and JSON mode.
- [ ] Add a prompt that requires same-language, evidence-only answers and the exact JSON contract.
- [ ] Implement the answer route: validate input, run shared retrieval, load PRE.1, build context, skip LLM on empty context, normalize citations, return retrieval plus answer.
- [ ] Verify retrieval-only API behavior remains unchanged.

### Task 3: Reading QA Integration

**Files:**
- Modify: `src/lib/client-data.ts`
- Modify: `src/components/v3/V3ReadingQAView.tsx`

- [ ] Add the typed `answerV3Question()` client request.
- [ ] Change the primary action from evidence-only search to grounded answer generation.
- [ ] Render answer status and text before diagnostics.
- [ ] Render validated `P#` citation buttons that scroll to the matching source paragraph.
- [ ] Keep evidence cards compact and available below the answer.

### Task 4: Verification And Documentation

**Files:**
- Modify: `docs/source/implementation/v3-current-implementation.md`
- Modify: `docs/source/implementation/v3-next-roadmap.md`

- [ ] Run all `tests/v3-*.test.ts` tests.
- [ ] Run TypeScript, ESLint, and production build checks.
- [ ] Run Alice full-progress and limited-progress answer requests; assert all returned PIDs are within progress.
- [ ] Use Playwright to verify the Reading QA answer and citation layout at desktop size with zero console errors.
- [ ] Update implementation and roadmap documents with the implemented answer contract and remaining full-book/history limits.
