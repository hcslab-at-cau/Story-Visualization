import type { StageId } from "@/types/schema"

export function stageKey(stageId: StageId): string {
  return stageId.replace(".", "").toLowerCase()
}
