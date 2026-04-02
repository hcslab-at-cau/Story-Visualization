/**
 * LLM Client — OpenRouter (OpenAI-compatible) wrapper.
 * Port of Story-Decomposition/src/viewer/llm_client.py
 */

import OpenAI from "openai"
import { jsonrepair as repairJson } from "jsonrepair"
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

  private async callJson(
    prompt: string,
    maxRetries = 1,
  ): Promise<Record<string, unknown>> {
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
  ): Promise<Record<string, unknown>> {
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

  async classifyContent(params: { buffer_sentences: string }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("pre1_content_classify", params)
    return this.callJson(prompt)
  }

  // ---------------------------------------------------------------------------
  // ENT.1
  // ---------------------------------------------------------------------------

  async extractMentions(params: { chapter_text_with_pids: string }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("ent1_mention_extract", params)
    return this.callJson(prompt)
  }

  // ---------------------------------------------------------------------------
  // ENT.2
  // ---------------------------------------------------------------------------

  async validateMentions(params: {
    paragraphs_json: string
    mentions_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("ent2_mention_validate", params)
    return this.callJson(prompt)
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
    return this.callJson(prompt)
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
    return this.callJson(prompt)
  }

  // ---------------------------------------------------------------------------
  // STATE.3 — scene titles (optional)
  // ---------------------------------------------------------------------------

  async generateSceneTitles(params: { scenes_json: string }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("state3_scene_titles", params)
    return this.callJson(prompt)
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
    return this.callJson(prompt)
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
    return this.callJson(prompt)
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
    return this.callJson(prompt)
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
    return this.callJson(prompt)
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
    return this.callJson(prompt)
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
    onstage_cast_json: string
    current_places_json: string
    candidates_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("sub2_subscene_state", params)
    return this.callJson(prompt)
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
    onstage_cast_json: string
    candidates_json: string
    state_records_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("sub3_subscene_validation", params)
    return this.callJson(prompt)
  }

  // ---------------------------------------------------------------------------
  // SUB.4
  // ---------------------------------------------------------------------------

  async packageInterventions(params: {
    scene_id: string
    scene_summary: string
    onstage_cast_json: string
    prev_end_state_json: string
    subscenes_json: string
  }): Promise<Record<string, unknown>> {
    const prompt = this.promptLoader.load("sub4_intervention_packaging", params)
    return this.callJson(prompt)
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
    overlay_candidates_json: string
    blueprint_summary: string
    scene_body_text: string
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
    return this.callJsonMultimodal(messages)
  }
}

export { formatJsonParam }
