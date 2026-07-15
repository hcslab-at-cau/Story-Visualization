import assert from "node:assert/strict"
import { summarizeContentUnits } from "./pre-stage-utils.ts"

const summary = summarizeContentUnits([
  { pid: 1, content_type: "chapter_heading", is_story_text: false },
  { pid: 2, content_type: "narrative", is_story_text: true },
  { pid: 3, content_type: "narrative", is_story_text: true },
])

assert.deepEqual(summary, {
  total: 3,
  story: 2,
  nonStory: 1,
  storyRate: 67,
  byType: {
    chapter_heading: 1,
    narrative: 2,
  },
})
