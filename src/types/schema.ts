/**
 * TypeScript type definitions for the narrative segmentation pipeline.
 * Converted from Story-Decomposition/src/viewer/schema.py (Pydantic → TS interfaces)
 *
 * Phase / Node hierarchy:
 *   PRE   — Text Prep         (PRE.1, PRE.2)
 *   ENT   — Entity Grounding  (ENT.1, ENT.2, ENT.3)
 *   STATE — Scene State       (STATE.1, STATE.2, STATE.3)
 *   SCENE — Scene Repr.       (SCENE.1, SCENE.2, SCENE.3)
 *   VIS   — Visual Rendering  (VIS.1, VIS.2, VIS.3, VIS.4)  [optional branch]
 *   SUB   — Reader Interv.    (SUB.1, SUB.2, SUB.3, SUB.4)  [optional branch]
 *   FINAL — Reader Package    (FINAL.1, FINAL.2)
 */

// ---------------------------------------------------------------------------
// Shared base: every artifact has these fields
// ---------------------------------------------------------------------------

export interface LLMTrialDebug {
  trial_id: number;
  template_name?: string;
  mode: "json" | "multimodal";
  model: string;
  prompt: string;
  raw_response?: string;
  has_image?: boolean;
}

export interface LLMRunDebug {
  trials: LLMTrialDebug[];
}

export interface ArtifactBase {
  run_id: string;
  doc_id: string;
  chapter_id: string;
  stage_id: string;
  llm_debug?: LLMRunDebug;
  parents: Record<string, string>; // stage_id → run_id
}

// ---------------------------------------------------------------------------
// Raw Input
// ---------------------------------------------------------------------------

export interface Paragraph {
  pid: number;
  start: number;
  end: number;
  text: string;
}

export interface ChapterSource {
  type: string; // "toc" | "spine" | "heading"
  toc_title?: string;
  hrefs: string[];
}

export interface RawChapter {
  doc_id: string;
  chapter_id: string;
  title: string;
  source?: ChapterSource;
  text: string;
  paragraphs: Paragraph[];
}

// ---------------------------------------------------------------------------
// PRE.1 — Prepare Raw Chapter
// ---------------------------------------------------------------------------

export interface PreparedChapter extends ArtifactBase {
  stage_id: "PRE.1";
  method: "epub+rule";
  chapter_title: string;
  source_type?: string;
  paragraph_count: number;
  char_count: number;
  raw_chapter: RawChapter;
}

// ---------------------------------------------------------------------------
// PRE.2 — Classify Content
// ---------------------------------------------------------------------------

export type ContentType =
  | "front_matter"
  | "toc"
  | "chapter_heading"
  | "section_heading"
  | "epigraph"
  | "narrative"
  | "non_narrative_other";

export interface ContentUnit {
  pid: number;
  content_type: ContentType;
  is_story_text: boolean;
}

export interface ContentUnits extends ArtifactBase {
  stage_id: "PRE.2";
  model?: string;
  units: ContentUnit[];
}

// ---------------------------------------------------------------------------
// ENT.1 — Detect Mentions
// ---------------------------------------------------------------------------

export type MentionType = "cast" | "place" | "time";

export interface Mention {
  mention_id: string;
  pid: number;
  span: string;
  start_char?: number;
  end_char?: number;
  mention_type: MentionType;
  normalized?: string;
}

export interface MentionCandidates extends ArtifactBase {
  stage_id: "ENT.1";
  method: "llm" | "nlp";
  model?: string;
  source_file?: string;
  mentions: Mention[];
}

// ---------------------------------------------------------------------------
// ENT.2 — Filter Mentions
// ---------------------------------------------------------------------------

export interface ValidatedMention {
  mention_id: string;
  pid: number;
  span: string;
  start_char?: number;
  end_char?: number;
  mention_type: MentionType;
  normalized?: string;
  valid: boolean;
  reason?: string;
}

export interface FilteredMentions extends ArtifactBase {
  stage_id: "ENT.2";
  method: "llm";
  model?: string;
  source_file?: string;
  validated: ValidatedMention[];
}

// ---------------------------------------------------------------------------
// ENT.3 — Resolve Entities
// ---------------------------------------------------------------------------

export interface EntityMention {
  mention_id: string;
  pid: number;
  span: string;
  start_char?: number;
  end_char?: number;
}

export interface Entity {
  entity_id: string;
  canonical_name: string;
  mention_type: MentionType;
  mentions: EntityMention[];
}

export interface EntityGraph extends ArtifactBase {
  stage_id: "ENT.3";
  method: "rule" | "llm";
  model?: string;
  source_file?: string;
  entities: Entity[];
  unresolved_mentions: EntityMention[];
}

// ---------------------------------------------------------------------------
// STATE.1 — Track State
// ---------------------------------------------------------------------------

export interface ObservedEntities {
  cast: string[];
  place: string[];
  time: string[];
}

export interface ActiveState {
  active_cast: string[];
  primary_place?: string;
  current_time?: string;
}

export interface PlaceShift {
  from: string;
  to: string;
}

export interface Transitions {
  cast_enter: string[];
  cast_exit_candidates: string[];
  place_set?: string;
  place_shift?: PlaceShift;
  time_signals: string[];
}

export interface StateFrame {
  pid: number;
  observed: ObservedEntities;
  state: ActiveState;
  transitions: Transitions;
}

export interface StateFrames extends ArtifactBase {
  stage_id: "STATE.1";
  method: "rule";
  source_file?: string;
  frames: StateFrame[];
}

// ---------------------------------------------------------------------------
// STATE.2 — Refine State
// ---------------------------------------------------------------------------

export interface ValidatedState {
  current_place?: string;
  mentioned_place?: string;
  active_cast: string[];
  weak_exit_candidates: string[];
}

export type ValidationActionType = "accepted" | "carry_forward" | "rejected" | "corrected";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface ValidationAction {
  field: "current_place" | "mentioned_place" | "active_cast";
  proposed: unknown;
  final: unknown;
  action: ValidationActionType;
  reason: string;
  confidence: ConfidenceLevel;
}

export interface ValidatedFrame {
  pid: number;
  is_narrative: boolean;
  validated_state: ValidatedState;
  actions: ValidationAction[];
}

export interface RefinedStateFrames extends ArtifactBase {
  stage_id: "STATE.2";
  method: "llm";
  model?: string;
  source_file?: string;
  frames: ValidatedFrame[];
}

// ---------------------------------------------------------------------------
// STATE.3 — Score Boundaries
// ---------------------------------------------------------------------------

export type BoundaryReasonType =
  | "place_shift"
  | "place_set_after_previous_place"
  | "cast_turnover"
  | "time_signal";

export interface BoundaryReason {
  type: BoundaryReasonType;
  from_place?: string;
  to_place?: string;
  delta?: number;
  turnover?: number;
  signals?: string[];
}

export type BoundaryLabel = "scene_boundary" | "weak_boundary_candidate";

export interface BoundaryCandidate {
  boundary_before_pid: number;
  score: number;
  label: BoundaryLabel;
  reasons: BoundaryReason[];
}

export interface SceneSpan {
  scene_id: string;
  start_pid: number;
  end_pid: number;
}

export interface SceneBoundaries extends ArtifactBase {
  stage_id: "STATE.3";
  method: "rule";
  source_file?: string;
  boundaries: BoundaryCandidate[];
  scenes: SceneSpan[];
  scene_titles: Record<string, string>; // scene_id → display title
}

// ---------------------------------------------------------------------------
// SCENE.1 — Pack Scenes
// ---------------------------------------------------------------------------

export interface PhaseMarker {
  boundary_before_pid: number;
  score: number;
  label: string;
}

export interface ScenePacket {
  scene_id: string;
  start_pid: number;
  end_pid: number;
  pids: number[];
  scene_text_with_pid_markers: string;
  start_state: Record<string, unknown>;
  end_state: Record<string, unknown>;
  scene_cast_union: string[];
  scene_current_places: string[];
  scene_mentioned_places: string[];
  scene_time_signals: string[];
  phase_markers: PhaseMarker[];
  entity_registry: Record<string, string>; // canonical_name → entity_id
  previous_scene_id?: string;
  next_scene_id?: string;
}

export interface ScenePackets extends ArtifactBase {
  stage_id: "SCENE.1";
  method: "rule";
  source_file?: string;
  packets: ScenePacket[];
}

// ---------------------------------------------------------------------------
// SCENE.2 — Index Scenes
// ---------------------------------------------------------------------------

export type GroundingType = "explicit" | "strong_inference" | "weak_inference";

export interface GroundedItem {
  evidence_pids: number[];
  evidence_text: string[];
  grounding_type: GroundingType;
  confidence: ConfidenceLevel;
}

export interface SceneEntityItem extends GroundedItem {
  name: string;
}

export interface SceneActionItem extends GroundedItem {
  actor?: string;
  action: string;
}

export interface SceneMentalItem extends GroundedItem {
  holder: string;
  content: string;
}

export interface SceneIndex {
  scene_id: string;
  scene_summary: string;
  scene_place: Record<string, unknown>;
  scene_time: Record<string, unknown>;
  onstage_cast: SceneEntityItem[];
  mentioned_offstage_cast: SceneEntityItem[];
  main_actions: SceneActionItem[];
  goals: SceneMentalItem[];
  relations: Record<string, unknown>[];
  objects: Record<string, unknown>[];
  environment: Record<string, unknown>[];
}

export interface SceneIndexDraft extends ArtifactBase {
  stage_id: "SCENE.2";
  method: "llm";
  model?: string;
  source_file?: string;
  indices: SceneIndex[];
}

// ---------------------------------------------------------------------------
// SCENE.3 — Ground Scene Model
// ---------------------------------------------------------------------------

export interface DroppedItem {
  field: string;
  item: Record<string, unknown>;
  reason: string;
}

export interface DowngradedItem {
  field: string;
  item: Record<string, unknown>;
  from_label: string;
  to_label: string;
  reason: string;
}

export interface GroundedSceneEntry {
  scene_id: string;
  validated_scene_index: Record<string, unknown>;
  dropped_items: DroppedItem[];
  downgraded_items: DowngradedItem[];
  merged_items: Record<string, unknown>[];
  validation_notes: string[];
}

export interface GroundedSceneModel extends ArtifactBase {
  stage_id: "SCENE.3";
  method: "rule+llm";
  model?: string;
  source_file?: string;
  validated: GroundedSceneEntry[];
}

// ---------------------------------------------------------------------------
// VIS.1 — Ground Visual Semantics
// ---------------------------------------------------------------------------

export interface AmbiguityResolution {
  surface_form: string;
  resolved_sense: string;
  render_hint: string;
  avoid: string[];
  reason: string;
  confidence: ConfidenceLevel | string;
}

export interface VisualGroundingPacket {
  scene_id: string;
  environment_type: string; // "indoor" | "outdoor" | "mixed"
  stage_archetype: string;
  canonical_place_key: string;
  ambiguity_resolutions: AmbiguityResolution[];
  grounded_scene_description: string;
  visual_constraints: string[];
  avoid: string[];
}

export interface VisualGrounding extends ArtifactBase {
  stage_id: "VIS.1";
  method: "llm";
  model?: string;
  source_file?: string;
  packets: VisualGroundingPacket[];
}

// ---------------------------------------------------------------------------
// VIS.2 — Build Stage Blueprint
// ---------------------------------------------------------------------------

export interface SceneSetting {
  location: string;
  time_of_day: string;
  atmosphere: string;
  lighting: string;
}

export interface SceneCharacter {
  name: string;
  composition_position: string; // 9-zone: foreground/midground/background + left/center/right
  pose: string;
  expression: string;
  gaze_direction?: string;
  notable_props: string[];
}

export interface SpatialZone {
  name: string;
  role: string;
  priority: "high" | "medium" | "low" | string;
}

export interface GeometrySpec {
  enclosure: string;    // "enclosed" | "open" | "partial" | "shaft_like"
  main_axis: string;    // "horizontal" | "vertical" | "radial" | "none"
  ground_profile: string;
  dominant_geometry: string;
  height_profile: string;
  openness: string;
}

export interface ZoneSpec {
  name: string;
  shape: string;    // "strip" | "patch" | "void" | "band" | "chamber"
  position: string;
  scale: string;    // "dominant" | "secondary" | "minor"
  priority: string; // "high" | "medium" | "low"
}

export interface PresentationSpec {
  perspective_mode: string; // "axonometric_2_5d" | "vertical_section" | "oblique_section" | "plan_oblique"
  section_mode: string;     // "none" | "front_cut" | "side_cut" | "vertical_section" | "hybrid"
  frame_mode: string;       // "full_bleed" | "soft_frame" | "cutaway_box" | "platform" | "thin_panel"
  edge_treatment: string;   // "natural_crop" | "architectural_cut" | "clean_margin"
  coverage: string;         // "edge_to_edge" | "centered_object" | "balanced_margin"
  continuity_beyond_frame: boolean;
  support_base_visibility: string; // "hidden" | "minimal" | "visible"
  symmetry_tolerance: string;      // "low" | "medium" | "high"
  naturalism_bias: string;         // "low" | "medium" | "high"
}

export interface StageBlueprintPacket {
  scene_id: string;
  canonical_place_key: string;
  environment_type: string;
  stage_archetype: string;
  key_moment: string;
  setting: SceneSetting;
  characters: SceneCharacter[];
  structural_elements: string[];
  layout_summary: string;
  spatial_zones: SpatialZone[];
  avoid: string[];
  must_not_show: string[];
  continuity_note: string;
  uncertainties: string[];
  // Stage Grammar (VIS.2 v2)
  geometry?: GeometrySpec;
  presentation?: PresentationSpec;
  zones: ZoneSpec[];
  boundaries: string[];
  repetition: string[];
  forbid: string[];
  // Validation
  blueprint_valid: boolean;
  blueprint_warnings: string[];
}

export interface StageBlueprint extends ArtifactBase {
  stage_id: "VIS.2";
  method: "llm+rule";
  model?: string;
  source_file?: string;
  packets: StageBlueprintPacket[];
}

// ---------------------------------------------------------------------------
// VIS.3 — Compile Render Package
// ---------------------------------------------------------------------------

export interface RenderPackageItem {
  scene_id: string;
  common_style_block: string;
  scene_blueprint_block: string;
  presentation_block: string;
  hard_constraints_block: string;
  failure_patch_block: string;
  full_prompt: string;
  prompt_schema_version: string;
  failure_history: string[];
}

export interface RenderPackage extends ArtifactBase {
  stage_id: "VIS.3";
  method: "rule";
  source_file?: string;
  items: RenderPackageItem[];
}

// ---------------------------------------------------------------------------
// VIS.4 — Render Image
// ---------------------------------------------------------------------------

export interface RenderedImageResult {
  scene_id: string;
  image_path?: string;
  prompt_used: string;
  model: string;
  success: boolean;
  storage_path?: string;
  gs_uri?: string;
  download_url?: string;
  content_type?: string;
  size_bytes?: number;
  error?: string;
}

export interface RenderedImages extends ArtifactBase {
  stage_id: "VIS.4";
  method: "image_api";
  model?: string;
  source_file?: string;
  style: string;
  results: RenderedImageResult[];
}

// ---------------------------------------------------------------------------
// SUB.1 — Propose Subscenes
// ---------------------------------------------------------------------------

export interface SubsceneCandidate {
  candidate_id: string;
  scene_id: string;
  start_pid: number;
  end_pid: number;
  label: string;
  shift_type: string;
  boundary_reason: string;
  trigger_event: string;
  local_focus: string;
  confidence: number;
  evidence: string[];
}

export interface SubsceneProposalItem {
  scene_id: string;
  candidate_subscenes: SubsceneCandidate[];
}

export interface SubsceneProposals extends ArtifactBase {
  stage_id: "SUB.1";
  method: "llm";
  model?: string;
  source_file?: string;
  packets: SubsceneProposalItem[];
}

// ---------------------------------------------------------------------------
// SUB.2 — Model Subscenes
// ---------------------------------------------------------------------------

export interface SubsceneStateRecord {
  candidate_id: string;
  scene_id: string;
  start_pid: number;
  end_pid: number;
  label: string;
  local_goal: string;
  action_summary: string;
  action_mode: string;
  active_cast: string[];
  key_objects: string[];
  problem_state: string;
  emotional_tone: string;
  causal_input: string;
  causal_result: string;
  narrative_importance: string;
  evidence: string[];
}

export interface SubsceneStateItem {
  scene_id: string;
  records: SubsceneStateRecord[];
}

export interface SubsceneStates extends ArtifactBase {
  stage_id: "SUB.2";
  method: "llm";
  model?: string;
  source_file?: string;
  packets: SubsceneStateItem[];
}

// ---------------------------------------------------------------------------
// SUB.3 — Validate and Merge Subscenes
// ---------------------------------------------------------------------------

export type SubsceneDecision = "accepted" | "merged" | "rejected";

export interface ValidatedSubscene {
  subscene_id: string;
  start_pid: number;
  end_pid: number;
  label: string;
  headline: string;
  action_mode: string;
  local_goal: string;
  action_summary: string;
  problem_state: string;
  causal_input: string;
  causal_result: string;
  emotional_tone: string;
  narrative_importance: string;
  active_cast: string[];
  key_objects: string[];
  decision: SubsceneDecision;
  source_candidates: string[];
  validation_notes: string[];
  confidence: number;
}

export interface ValidatedSubsceneItem {
  scene_id: string;
  validated_subscenes: ValidatedSubscene[];
  original_count: number;
  accepted_count: number;
  merged_count: number;
  rejected_count: number;
}

export interface ValidatedSubscenes extends ArtifactBase {
  stage_id: "SUB.3";
  method: "llm";
  model?: string;
  packets: ValidatedSubsceneItem[];
}

// ---------------------------------------------------------------------------
// SUB.4 — Intervention Packaging
// ---------------------------------------------------------------------------

export interface CastButton {
  name: string;
  role: string;
  reveal: string;
}

export type InfoButtonType =
  | "action"
  | "event"
  | "goal"
  | "problem"
  | "object"
  | "why_matters"
  | "what_changed";

export interface InfoButton {
  label: string;
  button_type: InfoButtonType | string;
  reveal: string;
}

export interface InterventionUnit {
  subscene_id: string;
  title: string;
  one_line_summary: string;
  cast_buttons: CastButton[];
  info_buttons: InfoButton[];
  priority: number;
  jump_targets: string[];
}

export interface InterventionPackageItem {
  scene_id: string;
  subscene_ui_units: InterventionUnit[];
}

export interface InterventionPackages extends ArtifactBase {
  stage_id: "SUB.4";
  method: "llm";
  model?: string;
  packets: InterventionPackageItem[];
}

// ---------------------------------------------------------------------------
// FINAL.1 — Scene Reader Package
// ---------------------------------------------------------------------------

export interface OverlayCharacter {
  character_id: string;
  label: string;
  anchor_zone: string;
  anchor_x: number; // 0–100 (% from left)
  anchor_y: number; // 0–100 (% from top)
  anchor_method: "zone_bucket" | "vision";
  panel_key: string;
}

export interface SubsceneButton {
  key: string;  // "goal" | "problem" | "what_changed" | "why_it_matters" | "object"
  label: string;
}

export interface SubsceneView {
  headline: string;
  buttons: SubsceneButton[];
  panels: Record<string, string>;
}

export interface SubsceneNavItem {
  subscene_id: string;
  label: string;
  headline: string;
  body_paragraphs: string[];
}

export interface VisualBlock {
  mode: "image" | "blueprint";
  image_path?: string;
  fallback_blueprint_available: boolean;
  chips: string[];
  overlay_characters: OverlayCharacter[];
}

export interface SceneReaderPacket {
  scene_id: string;
  scene_title: string;
  scene_summary: string;
  body_paragraphs: string[];
  visual: VisualBlock;
  subscene_nav: SubsceneNavItem[];
  subscene_views: Record<string, SubsceneView>;
  character_panels: Record<string, Record<string, string>>;
  default_active_subscene_id: string;
}

export interface SceneReaderPackageLog extends ArtifactBase {
  stage_id: "FINAL.1";
  method: "rule";
  packets: SceneReaderPacket[];
}

// ---------------------------------------------------------------------------
// FINAL.2 — Character Overlay Refinement
// ---------------------------------------------------------------------------

export interface BBoxNorm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OverlayVisibility = "placed" | "approximate" | "fallback" | "not_visible";
export type OverlaySource = "text_image_guided" | "blueprint_guided" | "coarse_fallback";

export interface OverlayRefinementCharacter {
  character_id: string;
  label: string;
  visibility: OverlayVisibility;
  bbox_norm?: BBoxNorm;
  anchor_x: number;
  anchor_y: number;
  confidence: number;
  source: OverlaySource;
  reason: string;
}

export interface OverlayRefinementScene {
  scene_id: string;
  image_path?: string;
  image_available: boolean;
  characters: OverlayRefinementCharacter[];
}

export interface OverlayRefinementResult extends ArtifactBase {
  stage_id: "FINAL.2";
  method: "vision+fallback";
  model?: string;
  scenes: OverlayRefinementScene[];
}

// ---------------------------------------------------------------------------
// Union type: all pipeline artifacts
// ---------------------------------------------------------------------------

export type PipelineArtifact =
  | PreparedChapter
  | ContentUnits
  | MentionCandidates
  | FilteredMentions
  | EntityGraph
  | StateFrames
  | RefinedStateFrames
  | SceneBoundaries
  | ScenePackets
  | SceneIndexDraft
  | GroundedSceneModel
  | VisualGrounding
  | StageBlueprint
  | RenderPackage
  | RenderedImages
  | SubsceneProposals
  | SubsceneStates
  | ValidatedSubscenes
  | InterventionPackages
  | SceneReaderPackageLog
  | OverlayRefinementResult;

export type StageId =
  | "PRE.1"
  | "PRE.2"
  | "ENT.1"
  | "ENT.2"
  | "ENT.3"
  | "STATE.1"
  | "STATE.2"
  | "STATE.3"
  | "SCENE.1"
  | "SCENE.2"
  | "SCENE.3"
  | "VIS.1"
  | "VIS.2"
  | "VIS.3"
  | "VIS.4"
  | "SUB.1"
  | "SUB.2"
  | "SUB.3"
  | "SUB.4"
  | "FINAL.1"
  | "FINAL.2";

// ---------------------------------------------------------------------------
// Run results map (replaces Streamlit session_state.run_results)
// ---------------------------------------------------------------------------

export interface RunResults {
  "PRE.1"?: PreparedChapter;
  "PRE.2"?: ContentUnits;
  "ENT.1"?: MentionCandidates;
  "ENT.2"?: FilteredMentions;
  "ENT.3"?: EntityGraph;
  "STATE.1"?: StateFrames;
  "STATE.2"?: RefinedStateFrames;
  "STATE.3"?: SceneBoundaries;
  "SCENE.1"?: ScenePackets;
  "SCENE.2"?: SceneIndexDraft;
  "SCENE.3"?: GroundedSceneModel;
  "VIS.1"?: VisualGrounding;
  "VIS.2"?: StageBlueprint;
  "VIS.3"?: RenderPackage;
  "VIS.4"?: RenderedImages;
  "SUB.1"?: SubsceneProposals;
  "SUB.2"?: SubsceneStates;
  "SUB.3"?: ValidatedSubscenes;
  "SUB.4"?: InterventionPackages;
  "FINAL.1"?: SceneReaderPackageLog;
  "FINAL.2"?: OverlayRefinementResult;
}
