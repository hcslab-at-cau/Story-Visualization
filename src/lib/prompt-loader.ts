/**
 * Prompt Loader — loads .txt prompt templates from prompts/ directory.
 * Port of Story-Decomposition/src/viewer/prompt_loader.py
 */

import fs from "fs"
import path from "path"

export class PromptLoader {
  private promptsDir: string

  constructor(promptsDir?: string) {
    this.promptsDir = promptsDir ?? path.join(process.cwd(), "prompts")
  }

  /** Load template and substitute {param} placeholders. */
  load(templateName: string, params?: Record<string, string>): string {
    const filePath = path.join(this.promptsDir, `${templateName}.txt`)
    const template = fs.readFileSync(filePath, "utf-8")
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`)
  }

  listTemplates(): string[] {
    return fs
      .readdirSync(this.promptsDir)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => path.basename(f, ".txt"))
  }
}

/** Serialize any value to a pretty-printed JSON string for LLM prompts. */
export function formatJsonParam(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
}

export function normalizePidKey(value: unknown): string {
  return String(value ?? "").trim().replace(/^P/i, "")
}

/** Format paragraphs as [P{pid}] text lines for LLM input. */
export function formatParagraphsForLLM(
  paragraphs: Array<{ pid: number; text: string }>,
  narrativePids?: Set<string | number>,
): string {
  const normalizedNarrativePids = narrativePids
    ? new Set(Array.from(narrativePids, (pid) => normalizePidKey(pid)))
    : undefined

  return paragraphs
    .filter(
      (p) =>
        normalizedNarrativePids === undefined ||
        normalizedNarrativePids.has(normalizePidKey(p.pid)),
    )
    .map((p) => `[P${p.pid}] ${p.text}`)
    .join("\n")
}
