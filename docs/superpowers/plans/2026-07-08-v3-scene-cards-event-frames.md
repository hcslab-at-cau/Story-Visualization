# V3 Scene Cards And Event Frames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two rule-only V3 stages after `MEM.0`: `MEM.1` for scene situation cards and `EVENT.2` for event argument frames.

**Architecture:** Reuse the `MEM.0` narrative memory contract instead of rereading the full chapter or adding another LLM pass. `MEM.1` groups scene-level situation anchors from existing evidence refs, and `EVENT.2` converts event axes into conservative predicate-argument frames. Existing V3 storage, stage rail, and result views remain the integration pattern.

**Tech Stack:** TypeScript, Next.js App Router route handlers, existing Firestore stage storage, Node test runner.

---

### Task 1: Pure Pipeline Builders

**Files:**
- Create: `src/lib/pipeline/v3-memory-frames-types.ts`
- Create: `src/lib/pipeline/v3-memory-frames.ts`
- Test: `tests/v3-memory-frames.test.ts`

- [ ] Write failing tests for `MEM.1` scene situation cards and `EVENT.2` event frames.
- [ ] Run `node --experimental-strip-types --test tests\v3-memory-frames.test.ts` and verify the builders are missing.
- [ ] Implement the minimal rule-only builders using `MEM.0` evidence refs and exact hint matching only.
- [ ] Run the focused test and verify it passes.

### Task 2: API Routes And Schema

**Files:**
- Create: `src/app/api/pipeline/v3-scene-cards/route.ts`
- Create: `src/app/api/pipeline/v3-event-frames/route.ts`
- Modify: `src/types/schema.ts`
- Modify: `src/config/pipeline-graph.ts`
- Modify: `src/lib/ui-strings.ts`

- [ ] Add `MEM.1` and `EVENT.2` to `StageId`, `RunResults`, and `PipelineArtifact`.
- [ ] Add pipeline graph edges `MEM.0 -> MEM.1 -> EVENT.2`.
- [ ] Load `MEM.0` for scene cards, and `MEM.0 + MEM.1` for event frames.
- [ ] Save results under V3 source-aware stage keys.

### Task 3: V3 Workbench Wiring

**Files:**
- Modify: `src/components/v3/pre-workbench-state.ts`
- Modify: `src/components/v3/PreMentionWorkbench.tsx`
- Modify: `src/components/v3/PreStageViews.tsx`
- Create: `src/components/v3/V3SceneCardsStageView.tsx`
- Create: `src/components/v3/V3EventFramesStageView.tsx`

- [ ] Add `MEM.1` and `EVENT.2` after `MEM.0` in the stage rail.
- [ ] Lock `MEM.1` until `MEM.0` exists, and lock `EVENT.2` until `MEM.1` exists.
- [ ] Treat both stages as rule-only with no model input.
- [ ] Delete downstream stages when `MEM.0` or `MEM.1` reruns.
- [ ] Display compact result cards for scene situation cards and event frames.

### Task 4: Verification

**Commands:**

```powershell
node --experimental-strip-types --test tests\v3-memory-frames.test.ts
node --experimental-strip-types --test tests\v3-*.test.ts
npm run lint
npx tsc --noEmit --pretty false --allowImportingTsExtensions
npm run build
```

Expected result: all commands complete without new errors. Existing unrelated warnings may remain.
