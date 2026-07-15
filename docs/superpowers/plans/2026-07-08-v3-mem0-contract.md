# V3 MEM.0 Narrative Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rule-only `MEM.0` stage that turns `EVENT.1` and `SCENE.0` into a stable narrative memory contract for later event frames, memory, retrieval, and QA.

**Architecture:** Keep the implementation small and deterministic. Add one pure pipeline builder, one API route, one compact result view, and wire it into the existing V3 workbench stage rail after `SCENE.0`.

**Tech Stack:** TypeScript, Next.js App Router route handlers, existing V3 artifact storage, Node test runner.

---

### Task 1: Contract Logic

**Files:**
- Create: `src/lib/pipeline/v3-memory-contract-types.ts`
- Create: `src/lib/pipeline/v3-memory-contract.ts`
- Test: `tests/v3-memory-contract.test.ts`

- [ ] Write a failing test for event-scene membership and axis leakage diagnostics.
- [ ] Implement the minimal rule-only builder.
- [ ] Run the focused test.

### Task 2: API Route

**Files:**
- Create: `src/app/api/pipeline/v3-memory-contract/route.ts`
- Modify: `src/types/schema.ts`

- [ ] Add `V3MemoryContractArtifact` to the pipeline artifact union and `MEM.0` to `StageId`.
- [ ] Load `EVENT.1` and `SCENE.0` from V3 source.
- [ ] Save the generated `MEM.0` artifact under V3 source.

### Task 3: Workbench Wiring

**Files:**
- Modify: `src/components/v3/pre-workbench-state.ts`
- Modify: `src/components/v3/PreMentionWorkbench.tsx`
- Modify: `src/components/v3/PreStageViews.tsx`
- Create: `src/components/v3/V3MemoryContractStageView.tsx`

- [ ] Add `MEM.0` after `SCENE.0`.
- [ ] Lock it until `SCENE.0` exists.
- [ ] Treat it as rule-only with no model input.
- [ ] Delete `MEM.0` when upstream event or scene results rerun.
- [ ] Display contract stats, diagnostics, scenes, and events.

### Task 4: Verification

**Commands:**

```powershell
node --experimental-strip-types --test tests\v3-memory-contract.test.ts
npm run lint
```

Expected result: focused test passes and lint completes without errors introduced by this change.
