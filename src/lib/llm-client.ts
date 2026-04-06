/**
 * LLM Client — OpenRouter (OpenAI-compatible) wrapper.
 * Port of Story-Decomposition/src/viewer/llm_client.py
 */

import OpenAI from "openai"
import { jsonrepair as repairJson } from "jsonrepair"
import type { LLMTrialDebug } from "@/types/schema"
import { PromptLoader, formatJsonParam } from "./prompt-loader"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

const OPENAI_COMPAT_PREFIXES = ["openai/", "mistral/", "meta-llama/", "x-ai/"]

function isOpenAICompat(model: string): boolean {
  return OPENAI_COMPAT_PREFIXES.some((p) => model.startsWith(p))
}

/** Remove markdown fences that some models (e.g. Claude) add around JSON. */
function stripMarkdownFence(content: string): string {
  if (!content.startsWith("```")) return content
  const lines = content.split("\n")
  const last = lines[lines.length - 1]
  return lines.slice(1, last === "```" ? -1 : undefined).join("\n").trim()
}

/** Escape literal newlines/tabs inside JSON strings. */
function repairJsonManual(content: string): string {
  let result = ""
  let inString = false
  let escaped = false
  for (const ch of content) {
    if (escaped) {
      escaped = false
      result += ch
    } else if (ch === "\\" && inString) {
      escaped = true
      result += ch
    } else if (ch === '"') {
      inString = !inString
      result += ch
    } else if (inString && ch === "\n") {
      result += "\\n"
    } else if (inString && ch === "\r") {
      result += "\\r"
    } else if (inString && ch === "\t") {
      result += "\\t"
    } else {
      result += ch
    }
  }
  return result
}

export class LLMClient {
  private client: OpenAI
  private model: string
  private maxTokens: number
  private promptLoader: PromptLoader
  private debugTrials: LLMTrialDebug[] = []
  private nextTrialId = 1

  constructor(
    model: string,
    apiKey: string,
    apiBase?: string,
    maxTokens = 16384,
  ) {
    this.model = model
    this.maxTokens = maxTokens
    this.client = new OpenAI({
      apiKey,
      baseURL: apiBase ?? OPENROUTER_BASE_URL,
    })
    this.promptLoader = new PromptLoader()
  }

  getDebugTrials(): LLMTrialDebug[] {
    return this.debugTrials.map((trial) => ({ ...trial }))
  }

  private recordTrial(trial: Omit<LLMTrialDebug, "trial_id" | "model">): LLMTrialDebug {
    const entry: LLMTrialDebug = {
      trial_id: this.nextTrialId++,
      model: this.model,
      ...trial,
    }
    this.debugTrials.push(entry)
    return entry
  }

  private async callJson(
    prompt: string,
    maxRetries = 1,
    templateName?: string,
  ): Promise<Record<string, unknown>> {
    const trial = this.recordTrial({
      template_name: templateName,
      mode: "json",
      prompt,
    })

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      temperature: 0,
      max_tokens: this.maxTokens,
      messages: [
        {
          role: "system",
          content: "Return ONLY valid JSON. Do not wrap in markdown code blocks.",
        },
        { role: "user", content: prompt },
      ],
    }
    if (isOpenAICompat(this.model)) {
      params.response_format = { type: "json_object" }
    }

    let lastError: unknown
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
      }
      try {
        const chat = await this.client.chat.completions.create(params)
        let content = (chat.choices[0].message.content ?? "").trim()
        content = stripMarkdownFence(content)
        trial.raw_response = content

        try {
          return JSON.parse(content) as Record<string, unknown>
        } catch {
          try {
            return JSON.parse(repairJson(content)) as Record<string, unknown>
          } catch {
            return JSON.parse(repairJsonManual(content)) as Record<string, unknown>
          }
        }
      } catch (e) {
        lastError = e
      }
    }
    throw lastError
  }

  private async callJsonMultimodal(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    maxRetries = 1,
    prompt?: string,
    templateName?: string,
  ): Promise<Record<string, unknown>> {
    const trial = this.recordTrial({
      template_name: templateName,
      mode: "multimodal",
      prompt: prompt ?? "",
      has_image: true,
    })

    let lastError: unknown
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
      }
      try {
        const chat = await this.client.chat.completions.create({
          model: this.model,
          temperature: 0,
          max_tokens: this.maxTokens,
          messages,
        })
        let content = (chat.choices[0].message.content ?? "").trim()
        content = stripMarkdownFence(content)
        trial.raw_response = content
        try {
          return JSON.parse(content) as Record<string, unknown>
        } catch {
          return JSON.parse(repairJson(content)) as Record<string, unknown>
        }
      } catch (e) {
        lastError = e
      }
    }
    throw lastError
  }

  // ---------------------------------------------------------------------------
  // PRE.2 (classification prompt template keeps the original file name)
  // ---------------------------------------------------------------------------

  async classifyContent(params: { paragraphs_json: string }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("pre1_content_classify", params)
    return this.callJson(prompt, 1, "pre1_content_classify")
  }

  // ---------------------------------------------------------------------------
  // ENT.1
  // ---------------------------------------------------------------------------

  async extractMentions(params: { chapter_text_with_pids: string }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("ent1_mention_extract", params)
    return this.callJson(prompt, 1, "ent1_mention_extract")
  }

  // ---------------------------------------------------------------------------
  // ENT.2
  // ---------------------------------------------------------------------------

  async validateMentions(params: {
    paragraphs_json: string
    mentions_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("ent2_mention_validate", params)
    return this.callJson(prompt, 1, "ent2_mention_validate")
  }

  // ---------------------------------------------------------------------------
  // ENT.3
  // ---------------------------------------------------------------------------

  async resolveEntities(params: {
    chapter_text: string
    entities_json: string
    unresolved_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("ent3_entity_resolve", params)
    return this.callJson(prompt, 1, "ent3_entity_resolve")
  }

  // ---------------------------------------------------------------------------
  // STATE.2
  // ---------------------------------------------------------------------------

  async validateState(params: {
    entity_inventory_json: string
    chapter_text_with_pids: string
    proposed_frames_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("state2_state_validate", params)
    return this.callJson(prompt, 1, "state2_state_validate")
  }

  // ---------------------------------------------------------------------------
  // STATE.3 — scene titles (optional)
  // ---------------------------------------------------------------------------

  async generateSceneTitles(params: { scenes_json: string }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("state3_scene_titles", params)
    return this.callJson(prompt, 1, "state3_scene_titles")
  }

  // ---------------------------------------------------------------------------
  // SCENE.2
  // ---------------------------------------------------------------------------

  async extractSceneIndex(params: {
    scene_id: string
    start_pid: string
    end_pid: string
    start_state_json: string
    end_state_json: string
    cast_union: string
    current_places: string
    mentioned_places: string
    time_signals: string
    scene_text: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("scene2_scene_index", params)
    return this.callJson(prompt, 1, "scene2_scene_index")
  }

  // ---------------------------------------------------------------------------
  // SCENE.3
  // ---------------------------------------------------------------------------

  async validateSceneIndex(params: {
    scene_id: string
    start_pid: string
    end_pid: string
    entity_registry_json: string
    start_state_json: string
    end_state_json: string
    scene_text: string
    scene_index_json: string
    precheck_issues_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("scene3_scene_validate", params)
    return this.callJson(prompt, 1, "scene3_scene_validate")
  }

  // ---------------------------------------------------------------------------
  // VIS.1
  // ---------------------------------------------------------------------------

  async extractSemanticClarification(params: {
    scene_id: string
    start_pid: string
    end_pid: string
    scene_text: string
    current_places_json: string
    environment_json: string
    start_state_json: string
    onstage_cast_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("vis1_semantic_clarification", params)
    return this.callJson(prompt, 1, "vis1_semantic_clarification")
  }

  // ---------------------------------------------------------------------------
  // VIS.2
  // ---------------------------------------------------------------------------

  async extractImageSupport(params: {
    scene_id: string
    start_pid: string
    end_pid: string
    start_state_json: string
    end_state_json: string
    scene_text: string
    onstage_cast_json: string
    current_places_json: string
    mentioned_places_json: string
    objects_json: string
    environment_json: string
    goals_json: string
    grounded_scene_description: string
    ambiguity_resolutions_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("vis2_image_support", params)
    return this.callJson(prompt, 1, "vis2_image_support")
  }

  // ---------------------------------------------------------------------------
  // SUB.1
  // ---------------------------------------------------------------------------

  async proposeSubscenes(params: {
    scene_id: string
    start_pid: string
    end_pid: string
    scene_text: string
    current_places_json: string
    start_state_json: string
    end_state_json: string
    onstage_cast_json: string
    main_actions_json: string
    goals_json: string
    objects_json: string
    scene_summary: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("sub1_subscene_proposal", params)
    return this.callJson(prompt, 1, "sub1_subscene_proposal")
  }

  // ---------------------------------------------------------------------------
  // SUB.2
  // ---------------------------------------------------------------------------

  async extractSubsceneState(params: {
    scene_id: string
    start_pid: string
    end_pid: string
    scene_text: string
    scene_summary: string
    start_state_json: string
    end_state_json: string
    cast_json: string
    current_places_json: string
    candidates_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("sub2_subscene_state", params)
    return this.callJson(prompt, 1, "sub2_subscene_state")
  }

  // ---------------------------------------------------------------------------
  // SUB.3
  // ---------------------------------------------------------------------------

  async validateSubscenes(params: {
    scene_id: string
    start_pid: string
    end_pid: string
    scene_text: string
    scene_summary: string
    start_state_json: string
    end_state_json: string
    cast_json: string
    candidates_json: string
    state_records_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("sub3_subscene_validation", params)
    return this.callJson(prompt, 1, "sub3_subscene_validation")
  }

  // ---------------------------------------------------------------------------
  // SUB.4
  // ---------------------------------------------------------------------------

  async packageInterventions(params: {
    scene_id: string
    scene_summary: string
    onstage_cast_json: string
    scene_relations_json: string
    prev_end_state_json: string
    subscenes_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("sub4_intervention_packaging", params)
    return this.callJson(prompt, 1, "sub4_intervention_packaging")
  }

  // ---------------------------------------------------------------------------
  // FINAL.2 — Vision API (multimodal)
  // ---------------------------------------------------------------------------

  async refineOverlay(params: {
    scene_id: string
    scene_title: string
    scene_summary: string
    visual_mode: string
    chips_json: string
    subscene_id: string
    subscene_label: string
    subscene_headline: string
    overlay_candidates_json: string
    blueprint_summary: string
    scene_body_text: string
    subscene_body_text: string
    imageDataUrl: string // base64 data URL
  }): Promise<Record<string, unknown>> {
    const { imageDataUrl, ...promptParams } = params
    const prompt = this.promptLoader.load("final2_overlay_refinement", promptParams)

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: "Return ONLY valid JSON. Do not wrap in markdown code blocks." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ]
    return this.callJsonMultimodal(messages, 1, prompt, "final2_overlay_refinement")
  }
}

export { formatJsonParam }
