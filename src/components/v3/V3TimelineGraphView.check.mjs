import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const viewSource = readFileSync(new URL("./V3TimelineGraphView.tsx", import.meta.url), "utf8")
const detailPanelSource = readFileSync(new URL("./timeline-graph/detail-panel.tsx", import.meta.url), "utf8")
const source = `${viewSource}\n${detailPanelSource}`

assert.match(source, /function ElementDetailPanel\(/)
assert.doesNotMatch(source, /function ElementDetailModal\(/)
assert.doesNotMatch(source, /fixed inset-0/)
assert.match(source, /xl:grid-cols-\[minmax\(0,1fr\)_360px\]/)
assert.match(source, /<aside/)
