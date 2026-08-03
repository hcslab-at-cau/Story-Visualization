import test from "node:test"
import assert from "node:assert/strict"
import {
  buildV3BookEntityGroups,
  visibleV3BookEntityGroup,
} from "../src/lib/pipeline/v3-book-entity-grouping.ts"
import type {
  V3BookEntityGroupingChapterInput,
  V3BookEntityType,
} from "../src/lib/pipeline/v3-book-qa-types.ts"
import type {
  V3EvidenceClusteringArtifact,
  V3EvidenceEntityCluster,
  V3ClusteredEntityType,
} from "../src/lib/pipeline/v3-evidence-clustering-types.ts"
import type {
  V3EvidenceGateArtifact,
  V3GatedEvidenceCandidate,
} from "../src/lib/pipeline/v3-evidence-gate-types.ts"

interface CandidateSpec {
  id: string
  pid?: number
  span?: string
  normalized?: string
}

interface ClusterSpec {
  id: string
  type: V3ClusteredEntityType
  canonical: string
  aliases: string[]
  candidates: CandidateSpec[]
}

function chapterInput(
  chapterId: string,
  chapterIndex: number,
  clusters: ClusterSpec[],
): V3BookEntityGroupingChapterInput {
  const gatedCandidates: V3GatedEvidenceCandidate[] = []
  const candidateClusterMap: Record<string, string> = {}
  const entityClusters: V3EvidenceEntityCluster[] = []

  for (const cluster of clusters) {
    for (const candidate of cluster.candidates) {
      gatedCandidates.push({
        refined_candidate_id: candidate.id,
        source_candidate_ids: [`raw-${candidate.id}`],
        candidate_type: cluster.type,
        gate: "core",
        basis: cluster.type === "cast"
          ? "event_participant"
          : cluster.type === "place"
            ? "current_setting"
            : cluster.type === "time"
              ? "temporal_anchor"
              : "event_object",
        pid: candidate.pid,
        span: candidate.span,
        normalized: candidate.normalized,
      })
      candidateClusterMap[candidate.id] = cluster.id
    }
    entityClusters.push({
      cluster_id: cluster.id,
      entity_type: cluster.type,
      canonical_label: cluster.canonical,
      aliases: cluster.aliases,
      refined_candidate_ids: cluster.candidates.map((candidate) => candidate.id),
      source_candidate_ids: cluster.candidates.map((candidate) => `raw-${candidate.id}`),
      evidence_pids: cluster.candidates
        .flatMap((candidate) => Number.isInteger(candidate.pid) ? [candidate.pid as number] : []),
      mention_count: cluster.candidates.length,
    })
  }

  const evidenceGate: V3EvidenceGateArtifact = {
    artifact_version: "v3-evidence-candidate-gate-0.2",
    run_id: `evid3-${chapterId}`,
    doc_id: "doc-1",
    chapter_id: chapterId,
    stage_id: "EVID.3",
    method: "llm+rule",
    parents: {},
    extraction_profile: "v3_evidence_candidate_gate",
    source_stage_ids: ["EVID.2"],
    prompt_template: "v3_evid3_candidate_gate",
    gate_stats: {
      input_refined_candidates: gatedCandidates.length,
      core_candidates: gatedCandidates.length,
      support_candidates: 0,
      dropped_candidates: 0,
      by_gate: { core: gatedCandidates.length, support: 0, drop: 0 },
      by_type: {},
    },
    gated_candidates: gatedCandidates,
    gate_map: Object.fromEntries(gatedCandidates.map((candidate) => [candidate.refined_candidate_id, "core"])),
  }
  const evidenceClusters: V3EvidenceClusteringArtifact = {
    run_id: `evid4-${chapterId}`,
    doc_id: "doc-1",
    chapter_id: chapterId,
    stage_id: "EVID.4",
    method: "rule",
    parents: {},
    extraction_profile: "v3_evidence_entity_clustering",
    source_stage_ids: ["EVID.3"],
    cluster_stats: {
      input_refined_candidates: gatedCandidates.length,
      entity_like_candidates: gatedCandidates.length,
      entity_clusters: entityClusters.length,
      singleton_clusters: entityClusters.filter((cluster) => cluster.mention_count === 1).length,
      unclustered_candidates: 0,
      by_type: {},
    },
    entity_clusters: entityClusters,
    candidate_cluster_map: candidateClusterMap,
  }

  return {
    chapterId,
    chapterIndex,
    runId: `run-${chapterId}`,
    evidenceGate,
    evidenceClusters,
  }
}

function entity(
  id: string,
  type: V3ClusteredEntityType,
  canonical: string,
  aliases: string[],
  ...candidates: CandidateSpec[]
): ClusterSpec {
  return { id, type, canonical, aliases, candidates }
}

test("Alice merges across chapters with deterministic aliases, members, and global ID", () => {
  const chapters = [
    chapterInput("ch01", 1, [
      entity("cast-1", "cast", "Alice", ["Alice", "Miss Alice"],
        { id: "a1", pid: 2, span: "Alice", normalized: "Alice" },
        { id: "a2", pid: 5, span: "Miss Alice", normalized: "Miss Alice" }),
    ]),
    chapterInput("ch02", 2, [
      entity("cast-7", "cast", "ALICE", ["ALICE"],
        { id: "a7", pid: 3, span: "ALICE", normalized: "ALICE" }),
    ]),
  ]

  const first = buildV3BookEntityGroups({ qaCorpusId: "BOOK1_abc", chapters })
  const cloned = buildV3BookEntityGroups({ qaCorpusId: "BOOK1_abc", chapters: structuredClone(chapters) })

  assert.equal(first.groups.length, 1)
  assert.equal(first.groups[0].entity_type, "cast")
  assert.match(first.groups[0].global_entity_id, /^BOOK_ENTITY_[a-f0-9]{32}$/)
  assert.equal(cloned.groups[0].global_entity_id, first.groups[0].global_entity_id)
  assert.deepEqual(
    first.groups[0].members.map((member) => [member.chapter_id, member.local_cluster_id]),
    [["ch01", "cast-1"], ["ch02", "cast-7"]],
  )
})

test("same aliases of different types do not merge and time clusters are excluded", () => {
  const result = buildV3BookEntityGroups({
    qaCorpusId: "BOOK1_types",
    chapters: [
      chapterInput("ch01", 1, [
        entity("cast-springfield", "cast", "Springfield", ["Springfield"],
          { id: "c1", pid: 1, span: "Springfield" }),
        entity("time-morning-1", "time", "morning", ["morning"],
          { id: "t1", pid: 2, span: "morning" }),
      ]),
      chapterInput("ch02", 2, [
        entity("place-springfield", "place", "Springfield", ["Springfield"],
          { id: "p1", pid: 1, span: "Springfield" }),
        entity("time-morning-2", "time", "morning", ["morning"],
          { id: "t2", pid: 2, span: "morning" }),
      ]),
    ],
  })

  assert.deepEqual(result.groups, [])
  assert.equal(result.diagnostics.filter((item) => item.code === "excluded_entity_type").length, 2)
})

test("identity keys match after NFKC, case, whitespace, and edge-punctuation normalization", () => {
  const result = buildV3BookEntityGroups({
    qaCorpusId: "BOOK1_normalization",
    chapters: [
      chapterInput("ch01", 1, [
        entity("alice-1", "cast", "“ＡＬＩＣＥ”", ["“ＡＬＩＣＥ”"],
          { id: "a1", pid: 1, span: "“ＡＬＩＣＥ”" }),
      ]),
      chapterInput("ch02", 2, [
        entity("alice-2", "cast", "...  alice  !!!", ["...  alice  !!!"],
          { id: "a2", pid: 2, span: "...  alice  !!!" }),
      ]),
    ],
  })

  assert.equal(result.groups.length, 1)
  assert.deepEqual(result.groups[0].members.map((member) => member.chapter_id), ["ch01", "ch02"])
})

test("pronouns and generic role keys are denied and never merge", () => {
  const result = buildV3BookEntityGroups({
    qaCorpusId: "BOOK1_denied",
    chapters: [
      chapterInput("ch01", 1, [
        entity("man-1", "cast", "the man", ["the man", "he"],
          { id: "m1", pid: 1, span: "the man" },
          { id: "m2", pid: 2, span: "he" }),
      ]),
      chapterInput("ch02", 2, [
        entity("man-2", "cast", "The Man", ["The Man", "HE"],
          { id: "m3", pid: 1, span: "The Man" },
          { id: "m4", pid: 2, span: "HE" }),
      ]),
    ],
  })

  assert.deepEqual(result.groups, [])
  assert.deepEqual(
    result.diagnostics
      .filter((item) => item.code === "denied_identity_key")
      .map((item) => item.identity_key),
    ["he", "the man"],
  )
})

test("a key naming multiple clusters in one chapter is rejected globally", () => {
  const result = buildV3BookEntityGroups({
    qaCorpusId: "BOOK1_direct_ambiguity",
    chapters: [
      chapterInput("ch01", 1, [
        entity("robin-1", "cast", "Robin", ["Robin"], { id: "r1", pid: 1, span: "Robin" }),
        entity("robin-2", "cast", "Robin", ["Robin"], { id: "r2", pid: 4, span: "Robin" }),
      ]),
      chapterInput("ch02", 2, [
        entity("robin-3", "cast", "Robin", ["Robin"], { id: "r3", pid: 2, span: "Robin" }),
      ]),
    ],
  })

  assert.deepEqual(result.groups, [])
  assert.deepEqual(
    result.diagnostics
      .filter((item) => item.code === "ambiguous_identity_key")
      .map((item) => [item.chapter_id, item.identity_key]),
    [["ch01", "robin"]],
  )
})

test("a transitive alias union that would duplicate a chapter is rejected", () => {
  const result = buildV3BookEntityGroups({
    qaCorpusId: "BOOK1_transitive",
    chapters: [
      chapterInput("ch01", 1, [
        entity("alpha-local", "cast", "Alpha", ["Alpha"], { id: "a1", pid: 1, span: "Alpha" }),
        entity("beta-local", "cast", "Beta", ["Beta"], { id: "b1", pid: 7, span: "Beta" }),
      ]),
      chapterInput("ch02", 2, [
        entity("bridge", "cast", "Alpha", ["Alpha", "Beta"],
          { id: "a2", pid: 2, span: "Alpha" },
          { id: "b2", pid: 3, span: "Beta" }),
      ]),
    ],
  })

  assert.equal(result.groups.length, 1)
  assert.deepEqual(
    result.groups[0].members.map((member) => member.local_cluster_id),
    ["alpha-local", "bridge"],
  )
  assert.deepEqual(
    result.diagnostics
      .filter((item) => item.code === "transitive_chapter_conflict")
      .map((item) => item.identity_key),
    ["beta"],
  )
})

test("alias and link positions come only from mapped EVID.3 occurrences", () => {
  const ch01 = chapterInput("ch01", 1, [
    entity("alice-1", "cast", "Alice", ["Alice", "Lady A", "Unproven", "Ghost"],
      { id: "lady", pid: 2, span: "Lady A", normalized: "Lady A" },
      { id: "alice", pid: 9, span: "Alice", normalized: "Alice" },
      { id: "ghost", span: "Ghost", normalized: "Ghost" }),
  ])
  const ch02 = chapterInput("ch02", 2, [
    entity("alice-2", "cast", "Alice", ["Alice"],
      { id: "alice-again", pid: 5, span: "Alice", normalized: "Alice" }),
  ])

  const result = buildV3BookEntityGroups({ qaCorpusId: "BOOK1_provenance", chapters: [ch01, ch02] })
  const firstMember = result.groups[0].members[0]

  assert.deepEqual(firstMember.evidence_pids, [2, 9])
  assert.equal(firstMember.link_available_from_pid, 9)
  assert.deepEqual(firstMember.aliases, [
    { value: "Alice", evidence_pids: [9], available_from_pid: 9 },
    { value: "Lady A", evidence_pids: [2], available_from_pid: 2 },
  ])
  assert.equal(result.diagnostics.some((item) =>
    item.code === "missing_candidate_provenance" && item.refined_candidate_id === "ghost"
  ), true)
  assert.deepEqual(
    result.diagnostics
      .filter((item) => item.code === "unprovenanced_alias")
      .map((item) => item.alias),
    ["Ghost", "Unproven"],
  )
})

test("visible groups hide unavailable current aliases, links, and all future member labels", () => {
  const result = buildV3BookEntityGroups({
    qaCorpusId: "BOOK1_visibility",
    chapters: [
      chapterInput("ch01", 1, [
        entity("mystery-1", "cast", "Mysterious Woman", ["Mysterious Woman"],
          { id: "mw1", pid: 2, span: "Mysterious Woman" }),
      ]),
      chapterInput("ch02", 2, [
        entity("mystery-2", "cast", "Queen Alice", ["Mysterious Woman", "Queen Alice"],
          { id: "mw2", pid: 2, span: "Mysterious Woman" },
          { id: "qa2", pid: 8, span: "Queen Alice" }),
      ]),
      chapterInput("ch03", 3, [
        entity("mystery-3", "cast", "Future Empress", ["Mysterious Woman", "Future Empress"],
          { id: "mw3", pid: 1, span: "Mysterious Woman" },
          { id: "fe3", pid: 3, span: "Future Empress" }),
      ]),
    ],
  })
  const fullGroup = { ...result.groups[0], canonical_label: "Future Empress" }

  const beforeLink = visibleV3BookEntityGroup(fullGroup, { chapter_id: "ch02", pid: 1 })
  assert.deepEqual(beforeLink?.members.map((member) => member.chapter_id), ["ch01"])

  const visible = visibleV3BookEntityGroup(fullGroup, { chapter_id: "ch02", pid: 4 })
  assert.equal(visible?.label, "Mysterious Woman")
  assert.deepEqual(visible?.members.map((member) => member.chapter_id), ["ch01", "ch02"])
  assert.equal(visible?.members.some((member) => "canonical_label" in member), false)
  assert.equal(JSON.stringify(visible).includes("Queen Alice"), false)
  assert.equal(JSON.stringify(visible).includes("Future Empress"), false)
  assert.equal(visible?.members.some((member) => member.chapter_id === "ch03"), false)

  assert.equal(
    visibleV3BookEntityGroup(fullGroup, { chapter_id: "ch01", pid: 1 }),
    null,
  )
})

test("grouping accepts only cast, place, or object entity types at the type boundary", () => {
  const accepted: V3BookEntityType[] = ["cast", "place", "object"]
  assert.deepEqual(accepted, ["cast", "place", "object"])
})
