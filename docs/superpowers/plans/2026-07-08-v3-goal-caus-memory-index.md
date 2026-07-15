# V3 Goal Causality Memory Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conservative rule-only `GOAL.1`, `CAUS.1`, `MEM.2`, and `IDX.1` stages after `EVENT.2`.

**Architecture:** Use `MEM.0`, `MEM.1`, and `EVENT.2` as the stable contract layer. Ground goals to the event and actor already present in event frames. Build causal edges only when explicit cause/effect cue text can be linked to existing event text; otherwise preserve unresolved cues without inventing edges. Build progressive memory and retrieval index from these records without vector embeddings yet.

**Tech Stack:** TypeScript, Next.js App Router route handlers, existing V3 stage storage, Node test runner.

---

### Task 1: Rule-Only Builders

**Files:**
- Create: `src/lib/pipeline/v3-narrative-memory-types.ts`
- Create: `src/lib/pipeline/v3-narrative-memory.ts`
- Test: `tests/v3-narrative-memory.test.ts`

- [ ] Write failing tests for goal holder grounding, explicit causal edge linking, progressive memory, and structured index output.
- [ ] Run the focused test and verify the new module is missing.
- [ ] Implement minimal deterministic builders.
- [ ] Run the focused test and verify it passes.

### Task 2: API Routes And Schema

**Files:**
- Create: `src/app/api/pipeline/v3-goals/route.ts`
- Create: `src/app/api/pipeline/v3-causality/route.ts`
- Create: `src/app/api/pipeline/v3-progressive-memory/route.ts`
- Create: `src/app/api/pipeline/v3-retrieval-index/route.ts`
- Modify: `src/types/schema.ts`
- Modify: `src/config/pipeline-graph.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `src/lib/ui-strings.ts`

- [ ] Register `GOAL.1`, `CAUS.1`, `MEM.2`, and `IDX.1`.
- [ ] Wire dependencies `EVENT.2 -> GOAL.1 -> CAUS.1 -> MEM.2 -> IDX.1`.
- [ ] Load only the stage artifacts each builder needs.
- [ ] Save each result under V3 source-aware storage.

### Task 3: Workbench UI

**Files:**
- Modify: `src/components/v3/pre-workbench-state.ts`
- Modify: `src/components/v3/PreMentionWorkbench.tsx`
- Modify: `src/components/v3/PreStageViews.tsx`
- Create: `src/components/v3/V3GoalGroundingStageView.tsx`
- Create: `src/components/v3/V3CausalEdgesStageView.tsx`
- Create: `src/components/v3/V3ProgressiveMemoryStageView.tsx`
- Create: `src/components/v3/V3RetrievalIndexStageView.tsx`

- [ ] Add the four stages after `EVENT.2`.
- [ ] Lock each stage behind its immediate dependency.
- [ ] Treat all four as rule-only with no model input.
- [ ] Clear downstream results on rerun.
- [ ] Show compact, readable summaries instead of JSON dumps.

### Task 4: Verification

**Commands:**

```powershell
node --experimental-strip-types --test tests\v3-narrative-memory.test.ts
node --experimental-strip-types --test tests\v3-*.test.ts
npm run lint
npx tsc --noEmit --pretty false --allowImportingTsExtensions
npm run build
```

Expected result: all commands complete without new errors. Existing unrelated warnings may remain.
