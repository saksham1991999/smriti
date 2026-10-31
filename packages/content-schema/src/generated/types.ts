/* eslint-disable */
/**
 * Generated from packages/content-schema/schemas by scripts/gen-types.ts.
 * Do not edit by hand: change the schema and run `pnpm --filter @smriti/content-schema gen:types`.
 */

/**
 * A language code: English or a scheduled language of India. Phase 1 ships en and hi. Kept in step with KNOWN_LOCALES in src/localize.ts.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Locale".
 */
export type Locale =
  | "en"
  | "hi"
  | "as"
  | "bn"
  | "brx"
  | "doi"
  | "gu"
  | "kn"
  | "ks"
  | "kok"
  | "mai"
  | "ml"
  | "mni"
  | "mr"
  | "ne"
  | "or"
  | "pa"
  | "sa"
  | "sat"
  | "sd"
  | "ta"
  | "te"
  | "ur";
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Slug".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ExamId".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ExamProfileId".
 */
export type Slug = string;
/**
 * Lowercase ASCII, dot-separated, hyphens inside a part. Never changes once published.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "DottedId".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ConceptId".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "TopicId".
 */
export type DottedId = string;
/**
 * {topic_id}:{dd|qr}:{nn}
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "CardId".
 */
export type CardId = string;
/**
 * q.{topic_id}.{nnnn}
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "QuestionId".
 */
export type QuestionId = string;
/**
 * m.{concept_id}.{n}
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MnemonicId".
 */
export type MnemonicId = string;
/**
 * A Phosphor icon name in PascalCase (DESIGN §8), for example HandWaving.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "IconName".
 */
export type IconName = string;
/**
 * cs. cheat sheet, rs. revision sheet, sb. storybook, sg. song, pl. play activity, ex. experiment, rp. role play, mm. mind-map template
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ExtraId".
 */
export type ExtraId = string;
/**
 * A media request id from media/requests/ (never a URL). img. image/diagram/comic, anim. animation, sim. simulation, m3d. 3D model, pano. 360 scene, audio. narration or song.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MediaRef".
 */
export type MediaRef = string;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ImageRef".
 */
export type ImageRef = string;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "AnimationRef".
 */
export type AnimationRef = string;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SimRef".
 */
export type SimRef = string;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Model3dRef".
 */
export type Model3DRef = string;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "PanoRef".
 */
export type PanoRef = string;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "AudioRef".
 */
export type AudioRef = string;
/**
 * {exam_profile}:{subject}:{unit}:{item}, a line of the official syllabus
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SyllabusRef".
 */
export type SyllabusRef = string;
/**
 * L1 basic school, L2 board, L3 competitive basics, L4 advanced, L5 elite (PRD 4.2)
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Depth".
 */
export type Depth = number;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "IsoDate".
 */
export type IsoDate = string;
/**
 * A LaTeX expression without $ delimiters. Rendered to SVG at publish.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Latex".
 */
export type Latex = string;
/**
 * draft -> review -> published (set by the publish job only) -> retired
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Status".
 */
export type Status = "draft" | "review" | "published" | "retired";
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SourceKind".
 */
export type SourceKind =
  | "ncert"
  | "official"
  | "openstax"
  | "pyq"
  | "textbook"
  | "paper"
  | "dataset"
  | "other";
/**
 * Where the Hindi text of the file comes from: official (the conducting body's Hindi document), ncert (NCERT Hindi-medium books) or translation (our translation of the official English).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "HiSource".
 */
export type HiSource = "official" | "ncert" | "translation";
/**
 * A unit symbol, for example m/s, kJ, mol, °C. null for dimensionless.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Unit".
 */
export type Unit = string | null;
/**
 * Colour family from packages/tokens/tokens.json `subject`.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SubjectFamily".
 */
export type SubjectFamily =
  | "physics"
  | "chemistry"
  | "biology"
  | "maths"
  | "history"
  | "polity"
  | "language";
/**
 * content/exams/{exam_id}.json: an exam and its profiles (one per cycle). Projects to content.exams and content.exam_profiles.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ExamFile".
 */
export type ExamFile = FileMeta & {
  schema: "exam@1";
  id: Slug;
  name: I18NText;
  category:
    | "engineering"
    | "medical"
    | "civil_services"
    | "ssc"
    | "banking"
    | "railways"
    | "defence"
    | "state"
    | "school";
  conducting_body?: string | null;
  official_url?: string | null;
  is_active?: boolean;
  /**
   * @minItems 1
   */
  profiles: ExamProfile[];
};
/**
 * content/blueprints/{exam_profile_id}/{paper_code}.v{n}.json, encoded by skills/exam-blueprint from the latest official notification. Projects to content.exam_blueprints.spec. Never edited in place: a pattern change is a new version.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "BlueprintFile".
 */
export type BlueprintFile = FileMeta & {
  schema: "blueprint@1";
  exam_profile: Slug;
  paper_code: Slug;
  version: number;
  effective_from: IsoDate;
  verified_at: IsoDate;
  /**
   * The official notification this blueprint was encoded from.
   */
  source: {
    url: string;
    title: string;
    published: IsoDate;
    retrieved: IsoDate;
    pages?: string;
    /**
     * The official page the notice is linked from (a URL, optionally with the menu path).
     */
    linked_from?: string;
  };
  /**
   * cbt, pen_paper, or mixed when parts of the paper are taken in different modes (each section then says its mode).
   */
  mode: "cbt" | "pen_paper" | "mixed";
  duration_min: number;
  /**
   * @minItems 1
   */
  languages: Locale[];
  /**
   * per_question: the EN/HI toggle shows on every question in full, sectional and PYQ-paper mocks. fixed: the language is chosen once (practice flow 6.4, R44).
   */
  language_switch: "per_question" | "fixed";
  interface: "nta" | "nta_omr" | "upsc_omr" | "ssc_tcs" | "generic";
  /**
   * Buttons, labels and palette states encoded from the official instructions. null: the runner uses the generic profile.
   */
  interface_profile?: null | InterfaceProfile;
  /**
   * Calculator allowed on the paper. null: not stated in the notice; the file then lists an open_questions entry naming this field.
   */
  calculator: "none" | "basic" | "scientific" | null;
  /**
   * How candidates move between sections. null: not stated in the notice; the file then lists an open_questions entry naming this field.
   */
  section_navigation: "free" | "locked_in_order" | "free_within_timer" | null;
  /**
   * Whether a locked section can be submitted before its timer ends. null when the notification is silent.
   */
  early_section_submit?: boolean | null;
  /**
   * How numeric answers are typed. null: not stated in the notice; the file then lists an open_questions entry naming this field.
   */
  numeric_input: "virtual_keypad" | "keyboard" | null;
  /**
   * Questions that count in the paper (after attempt-any rules). null: not stated in the notice; the file then lists an open_questions entry naming this field.
   */
  question_count: number | null;
  max_marks: number;
  /**
   * @minItems 1
   */
  sections: Section[];
  /**
   * The paper's qualifying rule, only as notified. null: none is notified.
   */
  qualifying?: {
    rule: null | QualifyingRule;
    /**
     * The notified rule in our words, with its citation.
     */
    basis?: string;
    source_ref?: string;
  } | null;
  exam_day?: {
    reporting_lead_min?: number | null;
  } | null;
  /**
   * Extra time and other accommodations, only where the official notification defines them.
   */
  accommodations?: {
    extra_time_min_per_hour: number;
    source_ref: string;
  } | null;
  /**
   * Paired papers taken together (JEE Advanced paper 1 and 2, UPSC GS I and CSAT).
   */
  group?: {
    id: Slug;
    order: number;
    break_min?: number | null;
  } | null;
  instructions: I18NText;
};
/**
 * A notified qualifying standard: one value, a value per category, or a standard the conducting body sets later.
 *
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "QualifyingRule".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "QualifyingRule".
 */
export type QualifyingRule =
  | {
      kind: "percent_of_max" | "marks" | "percentile" | "max_error_percent";
      value: number;
      source_ref?: string;
    }
  | {
      kind: "percent_of_max" | "marks" | "percentile" | "max_error_percent";
      /**
       * Category labels as the notice prints them (UR, OBC/EWS, SC, ST, PwBD ...).
       *
       * @minItems 1
       */
      by_category: {
        category: string;
        value: number;
      }[];
      source_ref?: string;
    }
  | {
      kind: "set_by_conducting_body";
      /**
       * What the notice says about how it is set.
       */
      basis: string;
      source_ref?: string;
    };
/**
 * drawing: graded by examiners, never by the mock engine. skill_test: a qualifying skill test (typing, data entry) with no questions or marks.
 *
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "QuestionType".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "QuestionType".
 *
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "QuestionType".
 */
export type QuestionType =
  | "mcq_single"
  | "mcq_multi"
  | "numerical"
  | "integer"
  | "matrix_match"
  | "match_list"
  | "assertion_reason"
  | "statement_based"
  | "paragraph"
  | "fill_blank"
  | "order_steps"
  | "drawing"
  | "skill_test";
/**
 * content/graph/{subject_id}/subject.json: the subject, its units and the ordered chapter list. Projects to content.subjects and content.units; the chapter order gives content.chapters.sort.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SubjectFile".
 */
export type SubjectFile = FileMeta & {
  schema: "subject@1";
  id: Slug;
  name: I18NText;
  color_family: SubjectFamily;
  sort: number;
  /**
   * @minItems 1
   */
  units: {
    id: DottedId;
    name: I18NText;
  }[];
  /**
   * Chapter ids in teaching order (NCERT order where it exists). Each has a graph/{subject}/{chapter_slug}.json file.
   *
   * @minItems 1
   */
  chapters: DottedId[];
};
/**
 * content/graph/{subject_id}/{chapter_slug}.json: chapter -> topics -> subtopics -> concepts (written by syllabus-mapper). Projects to content.chapters, topics, subtopics, concepts and concept_edges.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ChapterFile".
 */
export type ChapterFile = FileMeta & {
  schema: "chapter@1";
  id: DottedId;
  subject: Slug;
  unit: DottedId;
  name: I18NText;
  ncert_ref?: string | null;
  /**
   * @minItems 1
   */
  topics: Topic[];
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ConceptKind".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ConceptKind".
 */
export type ConceptKind =
  | "fact"
  | "definition"
  | "formula"
  | "derivation"
  | "process"
  | "skill"
  | "date"
  | "list"
  | "diagram";
/**
 * content/exam-maps/{exam_profile_id}.json: which concepts an exam profile includes, to what depth, with priority and computed PYQ stats. Projects to content.exam_concepts.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ExamMapFile".
 */
export type ExamMapFile = FileMeta & {
  schema: "exam-map@1";
  exam_profile: Slug;
  /**
   * Set by pyq-ingest: the papers weightage and pyq_count were computed from.
   */
  stats_basis?: {
    /**
     * @minItems 1
     */
    papers: string[];
    computed_at: IsoDate;
    method?: string;
  } | null;
  /**
   * @minItems 1
   */
  concepts: {
    id: DottedId;
    depth: Depth;
    /**
     * core by default, optional only when the syllabus marks it so, high_yield only when computed from real PYQ data.
     */
    priority: "core" | "high_yield" | "optional";
    /**
     * Share of marks over stats_basis.papers. null until pyq-ingest computes it. Never estimated.
     */
    weightage: number | null;
    pyq_count: number | null;
  }[];
};
/**
 * One lesson card (PRD 5.2). Every card has id, type, concepts (at least one) and depth (1-5). Text fields are localised; media fields are media request ids, never URLs.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Card".
 */
export type Card =
  | StoryCard
  | ExplainerCard
  | FormulaCard
  | AnimationCard
  | InteractiveCard
  | SimCard
  | Model3DCard
  | Pano360Card
  | DerivationCard
  | WorkedExampleCard
  | QuestionCard
  | MemoryHookCard
  | RoleplayCard
  | VideoCard
  | ExperimentCard
  | SummaryCard
  | CheatSheetRefCard
  | CommonTrapsCard;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "StoryCard".
 */
export type StoryCard = CardBase & {
  type: "story";
  title: I18NText;
  body: I18NText;
  media?: ImageRef;
  /**
   * Comic strip panels (2-4), each an image request.
   *
   * @minItems 2
   * @maxItems 4
   */
  panels?: {
    media: ImageRef;
    caption?: I18NText;
  }[];
  narration?: LocalizedAudioRef;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "CardType".
 */
export type CardType =
  | "story"
  | "explainer"
  | "formula"
  | "animation"
  | "interactive"
  | "sim"
  | "model3d"
  | "pano360"
  | "derivation"
  | "worked_example"
  | "question"
  | "memory_hook"
  | "roleplay"
  | "video"
  | "experiment"
  | "summary"
  | "cheat_sheet_ref"
  | "common_traps";
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ExplainerCard".
 */
export type ExplainerCard = CardBase & {
  type: "explainer";
  title: I18NText;
  body: I18NText;
  highlights?: {
    term: I18NText;
    definition: I18NText;
  }[];
  media: ImageRef;
  narration?: LocalizedAudioRef;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "FormulaCard".
 */
export type FormulaCard = CardBase & {
  type: "formula";
  title: I18NText;
  latex: Latex;
  spoken?: I18NText;
  /**
   * @minItems 1
   */
  symbols: {
    symbol: Latex;
    meaning: I18NText;
    unit: Unit;
  }[];
  conditions?: I18NText;
  vault_id?: DottedId;
  media?: ImageRef;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "AnimationCard".
 */
export type AnimationCard = CardBase & {
  type: "animation";
  title: I18NText;
  media: AnimationRef;
  poster?: ImageRef;
  caption: I18NText;
  transcript: I18NText;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "InteractiveCard".
 */
export type InteractiveCard = CardBase & {
  type: "interactive";
  prompt: I18NText;
  widget: "drag_sort" | "slider" | "graph" | "tap_reveal" | "label_diagram" | "order_steps";
  config: {};
  feedback?: {
    correct?: I18NText;
    wrong?: I18NText;
  };
  media?: ImageRef;
} & InteractiveCard1;
export type InteractiveCard1 =
  | {
      widget: "drag_sort";
      config: DragSortConfig;
    }
  | {
      widget: "slider";
      config: SliderConfig;
    }
  | {
      widget: "graph";
      config: GraphConfig;
    }
  | {
      widget: "tap_reveal";
      config: TapRevealConfig;
    }
  | {
      widget: "label_diagram";
      config: LabelDiagramConfig;
    }
  | {
      widget: "order_steps";
      config: OrderStepsConfig;
    };
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SimCard".
 */
export type SimCard = CardBase & {
  type: "sim";
  title?: I18NText;
  sim: SimRef;
  params?: {};
  tasks: {
    id: Slug;
    prompt: I18NText;
    /**
     * The measurement name the sim reports (sim-bridge measurement.name).
     */
    measurement: string;
    expected: NumericTarget;
  }[];
  debrief: I18NText;
  fallback: LabFallback;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "YoutubeId".
 */
export type YoutubeId = string;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Model3dCard".
 */
export type Model3DCard = CardBase & {
  type: "model3d";
  model: Model3DRef;
  prompt: I18NText;
  poster?: ImageRef;
  labels: {
    /**
     * Label node name in the GLB, without the label: prefix.
     */
    anchor: string;
    text: I18NText;
  }[];
  exploded_view: boolean;
  fallback: LabFallback;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Pano360Card".
 */
export type Pano360Card = CardBase & {
  type: "pano360";
  pano: PanoRef;
  prompt: I18NText;
  hotspots: {
    id: Slug;
    yaw: number;
    pitch: number;
    title: I18NText;
    body: I18NText;
  }[];
  fallback: LabFallback;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "DerivationCard".
 */
export type DerivationCard = CardBase & {
  type: "derivation";
  title: I18NText;
  /**
   * @minItems 1
   */
  steps: {
    latex: Latex;
    say: I18NText;
    why?: null | I18NText;
  }[];
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "WorkedExampleCard".
 */
export type WorkedExampleCard = CardBase & {
  type: "worked_example";
  problem: I18NText;
  media?: ImageRef;
  hints?: I18NText[];
  /**
   * @minItems 1
   */
  solution_steps: I18NText[];
  answer: I18NText;
  answer_value?: NumericTarget;
  shortcut?: null | I18NText;
  common_trap?: null | I18NText;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "QuestionCard".
 */
export type QuestionCard = CardBase & {
  type: "question";
  question: QuestionId;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MemoryHookCard".
 */
export type MemoryHookCard = CardBase & {
  type: "memory_hook";
  mnemonic: LocalizedRef;
  media?: ImageRef;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "RoleplayCard".
 */
export type RoleplayCard = CardBase & {
  type: "roleplay";
  character: {
    name: I18NText;
    era: I18NText;
    portrait: ImageRef;
  };
  /**
   * Instructions for the role-play model: documented views only, cited sources.
   */
  persona_prompt: string;
  /**
   * @minItems 1
   */
  goals: I18NText[];
  /**
   * @minItems 1
   */
  guardrails: string[];
  opening_line: I18NText;
  /**
   * @maxItems 3
   */
  suggested_replies: I18NText[];
  script?: ExtraId;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "VideoCard".
 */
export type VideoCard = CardBase & {
  type: "video";
  title?: I18NText;
  youtube_id: YoutubeId;
  start_s: number;
  end_s: number;
  concept_timestamps?: {
    concept: DottedId;
    t_s: number;
  }[];
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ExperimentCard".
 */
export type ExperimentCard = CardBase & {
  type: "experiment";
  title: I18NText;
  /**
   * @minItems 1
   */
  materials: I18NText[];
  /**
   * @minItems 1
   */
  steps: I18NText[];
  /**
   * @minItems 1
   */
  safety: I18NText[];
  adult_supervision: boolean;
  why_it_works: I18NText;
  media?: ImageRef;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SummaryCard".
 */
export type SummaryCard = CardBase & {
  type: "summary";
  /**
   * Key points. Each summary card becomes a spaced-repetition card (c:{card_id}).
   *
   * @minItems 1
   */
  points: I18NText[];
  media?: ImageRef;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "CheatSheetRefCard".
 */
export type CheatSheetRefCard = CardBase & {
  type: "cheat_sheet_ref";
  sheet: string;
};
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "CommonTrapsCard".
 */
export type CommonTrapsCard = CardBase & {
  type: "common_traps";
  title?: I18NText;
  /**
   * @minItems 1
   */
  traps: {
    mistake: I18NText;
    correct: I18NText;
  }[];
};
/**
 * content/lessons/{subject}/{chapter_slug}/{topic_slug}.{mode}.json: a Deep Dive or Quick Revision for one topic (lesson-author). Projects to content.content_items (kind lesson) and is built into bundles.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "LessonFile".
 */
export type LessonFile = FileMeta & {
  schema: "lesson@1";
  /**
   * {topic_id}:{mode}
   */
  id: string;
  topic: DottedId;
  mode: LessonMode;
  estimated_minutes: number;
  min_depth: Depth;
  max_depth: Depth;
  /**
   * Set when the lesson uses a card renderer newer than the oldest supported app.
   */
  min_app_version?: string;
  /**
   * @minItems 1
   */
  concepts: DottedId[];
  /**
   * Deep Dive bites of 2-4 minutes, each ending at LES-08. When missing, a bite ends at each summary card. Every card belongs to exactly one bite, in card order.
   *
   * @minItems 1
   */
  bites?: Bite[];
  /**
   * @minItems 1
   */
  cards: Card[];
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "LessonMode".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "LessonMode".
 */
export type LessonMode = "deep_dive" | "quick_revision";
/**
 * content/questions/{subject}/{chapter_slug}/{topic_slug}.json (question-author, pyq-ingest). Projects to content.questions, question_keys and question_concepts. Practice and lesson answers ship in bundles; mock and daily answers never ship to devices.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "QuestionsFile".
 */
export type QuestionsFile = FileMeta & {
  schema: "questions@1";
  topic: DottedId;
  /**
   * @minItems 1
   */
  questions: Question[];
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Question".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Question".
 */
export type Question =
  | McqSingle
  | McqMulti
  | Numerical
  | Integer
  | MatrixMatch
  | MatchList
  | AssertionReason
  | StatementBased
  | Paragraph
  | FillBlank
  | OrderSteps;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "McqSingle".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "McqSingle".
 */
export type McqSingle = QuestionBase & {
  type: "mcq_single";
  options: Options;
  answer: SingleOptionAnswer;
};
/**
 * practice: practice bank and drills. lesson: lesson check cards. placement: Find my level sets. mock and daily: keys stay on the server, so a question with mock or daily cannot also be practice, lesson or placement.
 *
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "QuestionUse".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "QuestionUse".
 */
export type QuestionUse = "practice" | "lesson" | "placement" | "mock" | "daily";
/**
 * @minItems 2
 * @maxItems 6
 *
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Options".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Options".
 */
export type Options = IdText[];
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "McqMulti".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "McqMulti".
 */
export type McqMulti = QuestionBase & {
  type: "mcq_multi";
  options: Options;
  answer: OptionAnswer;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Numerical".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Numerical".
 */
export type Numerical = QuestionBase & {
  type: "numerical";
  answer: {
    value: number;
    tolerance?: Tolerance;
    unit: Unit;
  };
  answer_format?: {
    allow_scientific?: boolean;
    decimals?: number;
  };
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Integer".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Integer".
 */
export type Integer = QuestionBase & {
  type: "integer";
  answer: {
    value: number;
    unit?: Unit;
  };
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "MatrixMatch".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MatrixMatch".
 */
export type MatrixMatch = QuestionBase & {
  type: "matrix_match";
  /**
   * @minItems 2
   */
  rows: IdText[];
  /**
   * @minItems 2
   */
  columns: IdText[];
  answer: {
    /**
     * Each row with the column ids that match it.
     *
     * @minItems 1
     */
    pairs: {
      row: Slug;
      columns: Slug[];
    }[];
  };
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "MatchList".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MatchList".
 */
export type MatchList = QuestionBase & {
  type: "match_list";
  /**
   * @minItems 2
   */
  list_i: IdText[];
  /**
   * @minItems 2
   */
  list_ii: IdText[];
  options?: Options;
  answer:
    | SingleOptionAnswer
    | {
        /**
         * Each list_i id with its list_ii id.
         *
         * @minItems 1
         */
        pairs: {
          left: Slug;
          right: Slug;
        }[];
      };
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AssertionReason".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "AssertionReason".
 */
export type AssertionReason = QuestionBase & {
  type: "assertion_reason";
  assertion: I18NText;
  reason: I18NText;
  options: Options;
  answer: SingleOptionAnswer;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "StatementBased".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "StatementBased".
 */
export type StatementBased = QuestionBase & {
  type: "statement_based";
  /**
   * @minItems 2
   */
  statements: I18NText[];
  options: Options;
  answer: SingleOptionAnswer;
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Paragraph".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Paragraph".
 */
export type Paragraph = QuestionBase & {
  type: "paragraph";
  passage: I18NText;
  /**
   * Child questions sharing the passage, one card each in the player.
   *
   * @minItems 1
   */
  children: ChildQuestion[];
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ChildQuestion".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ChildQuestion".
 */
export type ChildQuestion =
  | McqSingle
  | McqMulti
  | Numerical
  | Integer
  | MatrixMatch
  | MatchList
  | AssertionReason
  | StatementBased
  | FillBlank
  | OrderSteps;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "FillBlank".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "FillBlank".
 */
export type FillBlank = QuestionBase & {
  type: "fill_blank";
  /**
   * Blanks appear in the stem as {{blank:<id>}}.
   *
   * @minItems 1
   */
  blanks: {
    id: Slug;
    /**
     * @minItems 2
     */
    choices?: IdText[];
  }[];
  answer: {
    /**
     * The key for each blank: a choice id, or the accepted typed answers.
     *
     * @minItems 1
     */
    blanks: (
      | {
          blank: Slug;
          choice_id: Slug;
        }
      | {
          blank: Slug;
          /**
           * Accepted typed answers. The event sends only the matched key, never the typed text.
           *
           * @minItems 1
           */
          accepted: {
            key: Slug;
            text: I18NStringList;
          }[];
        }
    )[];
  };
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "OrderSteps".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "OrderSteps".
 */
export type OrderSteps = QuestionBase & {
  type: "order_steps";
  /**
   * @minItems 2
   */
  steps: IdText[];
  answer: {
    /**
     * @minItems 2
     */
    order: Slug[];
  };
};
/**
 * content/pyq/{exam_id}/{paper_id}.json: one previous-year paper from its official source (pyq-ingest). Projects to content.pyq_papers and content.pyq_questions. The questions themselves live in questions/ with source pyq.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "PyqPaperFile".
 */
export type PyqPaperFile = FileMeta & {
  schema: "pyq-paper@1";
  id: Slug;
  exam: Slug;
  year: number;
  session_label?: string | null;
  held_on?: null | IsoDate;
  /**
   * Matches the blueprint paper_code in force on held_on.
   */
  paper_code?: null | Slug;
  /**
   * The blueprint version in force on held_on.
   */
  blueprint?: {
    exam_profile: Slug;
    paper_code: Slug;
    version: number;
  } | null;
  source: {
    kind: "official";
    url: string;
    answer_key_url?: string | null;
    retrieved: IsoDate;
  };
  rights_note: string;
  /**
   * @minItems 1
   */
  items: {
    number: number;
    question: QuestionId;
    section?: string | null;
    /**
     * The official final key as published (option ids, a number, or a note).
     */
    official_answer: string;
    answer_challenged: boolean;
    dropped?: boolean;
  }[];
};
/**
 * content/mnemonics/{subject_id}/{chapter_slug}.json (mnemonic-maker). Each item is written for one locale. Projects to content.mnemonics.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MnemonicsFile".
 */
export type MnemonicsFile = FileMeta & {
  schema: "mnemonics@1";
  chapter?: DottedId;
  /**
   * @minItems 1
   */
  items: Mnemonic[];
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Technique".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Technique".
 */
export type Technique =
  | "acronym"
  | "acrostic"
  | "story"
  | "rhyme"
  | "song"
  | "keyword"
  | "pao"
  | "major_system"
  | "peg"
  | "palace"
  | "chunking"
  | "visual";
/**
 * content/media/requests/{subject_id}/{chapter_slug}.json: every media item the content needs. Content files point to request ids; the media skills fulfil them (image presets go to Agnes through visual-director).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MediaRequestsFile".
 */
export type MediaRequestsFile = FileMeta & {
  schema: "media-requests@1";
  /**
   * @minItems 1
   */
  requests: MediaRequest[];
};
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "MediaKind".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MediaKind".
 */
export type MediaKind =
  | "image"
  | "diagram"
  | "comic"
  | "pano360"
  | "animation_rive"
  | "animation_lottie"
  | "model3d"
  | "sim"
  | "audio_tts"
  | "audio_song";
/**
 * DESIGN.md 6.2 illustration presets (image kinds only).
 *
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Preset".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Preset".
 */
export type Preset =
  | "sunny-object"
  | "sunny-scene"
  | "sunny-diagram"
  | "pet-cat"
  | "pet-dog"
  | "plant-stage"
  | "storybook"
  | "roleplay-portrait"
  | "memory-hook"
  | "pano-360"
  | "badge"
  | "league-tier"
  | "empty-state";
/**
 * sims/{sim_id}/sim.json: a simulation or virtual lab bundle (sim-builder). Projects to content.sims.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SimManifest".
 */
export type SimManifest = FileMeta & {
  schema: "sim@1";
  id: Slug;
  version: string;
  title: I18NText;
  origin: "own" | "phet" | "other_open";
  licence: string;
  attribution?: string | null;
  /**
   * The HTML entry point, relative to the bundle root.
   */
  entry: string;
  bridge_version?: number;
  /**
   * @minItems 1
   */
  locales: Locale[];
  /**
   * JSON Schema for init.params.
   */
  params_schema: {};
  /**
   * Measurements the sim can report, which lesson tasks may check.
   */
  measurements: {
    name: string;
    unit: Unit;
    label?: I18NText;
  }[];
  aspect: "4:3" | "1:1" | "16:9" | "3:4";
  /**
   * Total bundle size. Budget: under 2 MB.
   */
  size_bytes: number;
  supports_low_power?: boolean;
  poster?: ImageRef;
  concepts: DottedId[];
};
/**
 * content/extras/{subject}/{chapter_slug}/...: cheat sheets, revision sheets, storybooks, songs, play activities, experiments, role plays and mind-map templates (lesson-author). Each file holds one item; its schema field picks the shape.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ExtrasFile".
 */
export type ExtrasFile =
  | CheatSheet
  | RevisionSheet
  | Storybook
  | Song
  | Play
  | Experiment
  | Roleplay
  | MindMapTemplate;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "CheatSheet".
 */
export type CheatSheet = FileMeta &
  Scope & {
    schema?: "cheat_sheet@1";
    /**
     * @minItems 1
     */
    key_ideas: I18NText[];
    formulas: SheetFormula[];
    diagram?: ImageRef;
    mnemonics: LocalizedRef[];
    traps: Trap[];
  };
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "RevisionSheet".
 */
export type RevisionSheet = FileMeta &
  Scope & {
    schema?: "revision_sheet@1";
    /**
     * @minItems 1
     */
    points: I18NText[];
    formulas?: SheetFormula[];
    diagram?: ImageRef;
  };
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Storybook".
 */
export type Storybook = FileMeta &
  Scope & {
    schema?: "storybook@1";
    /**
     * @minItems 6
     * @maxItems 12
     */
    pages: {
      text: I18NText;
      media: ImageRef;
      narration?: LocalizedAudioRef;
    }[];
  };
/**
 * A song or rhyme for little learners (PRD §6 'Class 1–5: story, song and play'). Each locale has its own version, written for that language rather than translated, with its own sung audio (an audio_song request with a transcript) and lyric lines. Line timings drive the karaoke highlight once the audio exists.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Song".
 */
export type Song = FileMeta &
  Scope & {
    schema?: "song@1";
    style: "song" | "rhyme" | "chant";
    /**
     * Length for the HOME-06 path node and the little learner plan; the audio's duration_ms is the truth once generated.
     */
    minutes?: number;
    cover?: ImageRef;
    /**
     * Things to do while singing (clap, jump, point). Lines name them by id.
     *
     * @maxItems 8
     */
    actions?: {
      id: Slug;
      cue: I18NText;
      icon: IconName;
    }[];
    /**
     * @minItems 1
     */
    versions: SongVersion[];
  };
/**
 * A play activity for little learners: one to six short rounds of tap, match, sort, drag or trace. There is no score, timer or fail state: a wrong move bounces back with the try_again line, the second wrong move shows the hint, and after that the player shows the move so every round ends with the child doing it (lesson-core playerRules('little')).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Play".
 */
export type Play = FileMeta &
  Scope & {
    schema?: "play@1";
    minutes: number;
    cover?: ImageRef;
    /**
     * Gentle lines the pet says. No negative words (the content check refuses them).
     */
    feedback: {
      success: I18NText;
      try_again: I18NText;
    };
    /**
     * @minItems 1
     * @maxItems 6
     */
    rounds: (TapRound | MatchRound | SortRound | DragRound | TraceRound)[];
  };
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Experiment".
 */
export type Experiment = FileMeta &
  Scope & {
    schema?: "experiment@1";
    /**
     * @minItems 1
     */
    materials: I18NText[];
    /**
     * @minItems 1
     */
    steps: I18NText[];
    /**
     * @minItems 1
     */
    safety: I18NText[];
    adult_supervision: boolean;
    why_it_works: I18NText;
    media?: ImageRef;
  };
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Roleplay".
 */
export type Roleplay = FileMeta &
  Scope & {
    schema?: "roleplay@1";
    character: {
      name: I18NText;
      era: I18NText;
      portrait: ImageRef;
    };
    /**
     * @minItems 1
     */
    documented_views: {
      view: I18NText;
      source: Source;
    }[];
    persona_prompt: string;
    /**
     * @minItems 1
     */
    goals: I18NText[];
    /**
     * @minItems 1
     */
    guardrails: string[];
    opening_line: I18NText;
    suggested_replies?: I18NText[];
  };
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MindMapTemplate".
 */
export type MindMapTemplate = FileMeta &
  Scope & {
    schema?: "mind_map_template@1";
    /**
     * @minItems 1
     */
    nodes: {
      id: Slug;
      label: I18NText;
      concept?: DottedId;
    }[];
    edges: {
      from: Slug;
      to: Slug;
    }[];
  };
/**
 * Inputs to the coverage report, written by syllabus-mapper. coverage/syllabus/{exam_profile_id}.json lists every official syllabus line with its concepts; coverage/inventory/{subject}/{chapter_slug}.json lists every item of the chapter's reference sources with its concept or exclusion reason.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "CoverageInputFile".
 */
export type CoverageInputFile = Syllabus | Inventory;
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Syllabus".
 */
export type Syllabus = FileMeta & {
  schema: "syllabus@1";
  exam_profile: Slug;
  /**
   * @minItems 1
   */
  lines: {
    ref: SyllabusRef;
    text: I18NText;
    concepts: DottedId[];
  }[];
};
/**
 * A chapter inventory (chapter + items) or a subject's list of reference chapters with no graph chapter (subject + excluded_chapters, at coverage/inventory/{subject}/excluded-chapters.json).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Inventory".
 */
export type Inventory = FileMeta &
  Inventory1 & {
    schema: "inventory@1";
    chapter?: DottedId;
    /**
     * @minItems 1
     */
    items?: {
      id: Slug;
      kind?:
        | "definition"
        | "law"
        | "formula"
        | "constant"
        | "named_reaction"
        | "date"
        | "list"
        | "diagram"
        | "solved_example"
        | "exercise_type"
        | "fact";
      /**
       * A plain string (the source language) or localised text.
       */
      title: string | I18NText;
      source_ref: string;
      concepts: DottedId[];
      /**
       * Why the item maps to no concept. Either concepts or this must be set.
       */
      out_of_syllabus?: string | null;
    }[];
    subject?: Slug;
    /**
     * Whole reference chapters with no graph chapter, each with the reason.
     */
    excluded_chapters?: {
      /**
       * The reference chapter, for example ncert:kemh1:5.
       */
      ref: string;
      title: string | I18NText;
      reason: string;
      source_ref: string;
      /**
       * The profiles the reason applies to.
       */
      exam_profiles?: Slug[];
    }[];
  };
export type Inventory1 = {
  [k: string]: unknown | undefined;
};
/**
 * This interface was referenced by `CoverageReport`'s JSON-Schema
 * via the `definition` "Requirement".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Requirement".
 */
export type Requirement =
  | "teaching_card"
  | "revision_card"
  | "practice_question"
  | "srs_card"
  | "formula_card"
  | "worked_example"
  | "memory_hook"
  | "play_activity";
/**
 * content/seed-packs/{variant_id}.json: what ships inside one app variant's build (TRD 3.2): the first chapter of its exam, onboarding lessons, placement sets and the pet and plant art. The whole pack stays under 8 MB.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SeedPackSpecFile".
 */
export type SeedPackSpecFile = FileMeta & {
  schema: "seed-pack-spec@1";
  variant_id: Slug;
  /**
   * Matches examProfileIds in packages/config/variants/{variant_id}.json.
   *
   * @minItems 1
   */
  exam_profiles: Slug[];
  /**
   * @minItems 1
   */
  locales: Locale[];
  /**
   * first: the first chapter (by sort) of the first subject of each profile. Or an explicit list of chapter ids.
   */
  chapters: "first" | DottedId[];
  /**
   * Ship the practice bundles that hold Find my level placement questions.
   */
  include_placement?: boolean;
  /**
   * Media request ids for the pet and plant art and other UI art the app needs offline.
   */
  art: ImageRef[];
  max_bytes?: number;
};
/**
 * content/releases.json: the release gate. Per exam profile, the subjects and chapters released to production. A production publish builds only these and needs every media item in them approved; everything else is skipped and listed in the publish report. The content check fails when a released subject or chapter is below 100% coverage (PRD 14). Staging and local builds publish everything.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ReleasesFile".
 */
export type ReleasesFile = FileMeta & {
  schema: "releases@1";
  /**
   * Exam profile id -> what is released for it. A profile that is not listed has nothing released.
   */
  profiles: {
    [k: string]: ReleaseScope | undefined;
  };
};
/**
 * Lesson bundles (deep_dive, quick_revision), the topic's practice bundle (practice, lesson and placement questions), and the little learner activity bundles (story, song, play: every storybook, song or play activity of the topic, in activities).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "BundleMode".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "BundleMode".
 */
export type BundleMode = "deep_dive" | "quick_revision" | "practice" | "story" | "song" | "play";
/**
 * content/palace-templates/{slug}.json: a memory palace template (memory-labs flow §5.6, gap G3). Rooms in walk order, each an Agnes sunny-scene image (or a pano-360 scene for kind pano360) with 5 to 10 spots in walk order. The app copies the rooms and spots into a new palace (palace_saved, sync v1.5); the room id travels as template_room.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "PalaceTemplateFile".
 */
export type PalaceTemplateFile = FileMeta & {
  schema: "palace_template@1";
  id: PalaceTemplateId;
  /**
   * The MEM-13 tile it appears under. Mix your own rooms (custom) strings rooms of these templates together, so it has no template of its own.
   */
  kind: "home" | "school" | "monument" | "pano360";
  name: I18NText;
  description?: I18NText;
  /**
   * Exam profiles this template is offered in (memory-labs matrix 'Templates per exam'). Missing or empty: every profile.
   */
  exam_profiles?: string[];
  /**
   * @minItems 1
   * @maxItems 20
   */
  rooms: PalaceTemplateRoom[];
};
/**
 * pt. then a slug. Never changes once published: palaces keep it as template_id.
 *
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PalaceTemplateId".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "PalaceTemplateId".
 */
export type PalaceTemplateId = string;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PalaceTemplateRoom".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "PalaceTemplateRoom".
 */
export type PalaceTemplateRoom = {
  id: Slug;
  name: I18NText;
  /**
   * An image request with preset sunny-scene. Its alt text is the room's description for screen readers.
   */
  image?: string;
  /**
   * A pano360 request (pano-360 preset), for kind pano360.
   */
  pano?: string;
  /**
   * @minItems 5
   * @maxItems 10
   */
  spots: PalaceTemplateSpot[];
} & PalaceTemplateRoom1;
export type PalaceTemplateRoom1 = {
  [k: string]: unknown | undefined;
};

/**
 * Localised text keyed by locale, for example { "en": "...", "hi": "..." }. Which locales are required is checked per exam profile by the content check, so a new language adds keys, not schema changes.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "I18nText".
 */
export interface I18NText {
  [k: string]: string | undefined;
}
/**
 * A list of strings per locale (for example accepted fill-in answers).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "I18nStringList".
 */
export interface I18NStringList {
  /**
   * @minItems 1
   */
  [k: string]: string[] | undefined;
}
/**
 * One content id per locale, for content that is written separately per language (mnemonics).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "LocalizedRef".
 */
export interface LocalizedRef {
  [k: string]: string | undefined;
}
/**
 * One audio request per locale (narration is recorded separately for each language).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "LocalizedAudioRef".
 */
export interface LocalizedAudioRef {
  [k: string]: string | undefined;
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Source".
 */
export interface Source {
  kind: SourceKind;
  ref: string;
  url?: string | null;
  retrieved?: IsoDate;
  pages?: string;
  licence?: string;
  /**
   * When the source was published by its author.
   */
  published?: string;
  /**
   * The official page the document is linked from, so a reviewer can find it again (a URL, optionally with the menu path).
   */
  linked_from?: string;
}
/**
 * Fields every content file carries.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "FileMeta".
 */
export interface FileMeta {
  schema: string;
  status: Status;
  sources?: Source[];
  authored_by: string;
  reviewed_by?: string | null;
  updated: IsoDate;
  /**
   * Test data only. Fixture files live under content/fixtures/ and can never be published to a non-local target.
   */
  fixture?: boolean;
  notes?: string;
  /**
   * Facts the official sources do not state. Every exam fact left null names its field here.
   */
  open_questions?: OpenQuestion[];
  hi_source?: HiSource;
}
/**
 * Something the official source does not state (or that could not be checked). A null exam fact must have one, naming the field.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "OpenQuestion".
 */
export interface OpenQuestion {
  /**
   * The field left null or unset because of this question, as a dotted path from the file root. Blueprint sections are addressed by code: sections.gs1.marking.mcq_single.correct. null: a question about the file as a whole.
   */
  field?: string | null;
  question: string;
  /**
   * When the sources were last checked for an answer.
   */
  checked?: string;
  /**
   * Where the answer is expected to appear.
   */
  source_url?: string | null;
}
/**
 * Accepted error. A response passes when |response - value| <= max(abs, rel * |value|).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Tolerance".
 */
export interface Tolerance {
  abs?: number;
  rel?: number;
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "LabelAnchor".
 */
export interface LabelAnchor {
  id: Slug;
  x: number;
  y: number;
}
/**
 * An item with a stable id and localised text (options, list items, steps).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "IdText".
 */
export interface IdText {
  id: Slug;
  text: I18NText;
  media?: ImageRef;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ExamProfile".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ExamProfile".
 */
export interface ExamProfile {
  id: Slug;
  cycle: string;
  name?: I18NText;
  /**
   * little_learner: a class 1–5 profile (learn §5.6). Its coverage needs a story, song or little lesson and a play activity per concept instead of the exam-prep set (PRD §14).
   */
  audience?: "standard" | "little_learner";
  /**
   * Locales every content field used by this profile must have.
   *
   * @minItems 1
   */
  locales: Locale[];
  /**
   * Paper codes; each has a blueprint in blueprints/{profile}/{paper}.v{n}.json.
   */
  papers: Slug[];
  /**
   * Official dates for the cycle, each with its notification URL. null until announced.
   */
  schedule?:
    | {
        kind:
          | "application_open"
          | "application_close"
          | "exam_window_start"
          | "exam_window_end"
          | "exam_day"
          | "result"
          | "correction_window"
          | "admit_card"
          | "city_intimation"
          | "re_exam";
        date: IsoDate;
        source_url: string;
        /**
         * Last day, for a window (application, correction, exam).
         */
        end_date?: string;
        /**
         * The session this date belongs to, when the cycle has several.
         */
        session?: string;
      }[]
    | null;
  is_active?: boolean;
  /**
   * Official paper names by paper code.
   */
  paper_names?: {
    [k: string]: I18NText;
  };
  /**
   * Languages the exam is offered in (ISO 639 codes), which can be more than the app's locales.
   */
  exam_languages?: string[];
  /**
   * Sessions of the cycle, as notified.
   */
  sessions?: {
    id: Slug;
    label: I18NText;
    application_window?: DateWindow;
    late_fee_window?: DateWindow;
    correction_window?: DateWindow;
    city_intimation?: IsoDate;
    admit_card?: IsoDate;
    exam_dates?: IsoDate[];
    source_ref: string;
  }[];
  /**
   * Shift times as notified. null: not stated (they often appear only on the admit card).
   */
  shifts?:
    | {
        id: Slug;
        tz: string;
        /**
         * Paper codes held in this shift; absent for all.
         */
        papers?: Slug[];
        /**
         * @minItems 1
         */
        times: {
          start: string;
          end: string;
          /**
           * The paper length these times are for, when they differ by paper.
           */
          duration_min?: number | null;
        }[];
        source_ref?: string;
      }[]
    | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "DateWindow".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "DateWindow".
 */
export interface DateWindow {
  from: IsoDate;
  to: IsoDate;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "InterfaceProfile".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "InterfaceProfile".
 */
export interface InterfaceProfile {
  /**
   * @minItems 1
   */
  buttons: {
    action:
      | "save_next"
      | "save_mark_review"
      | "mark_review_next"
      | "clear_response"
      | "back"
      | "next"
      | "submit";
    label: I18NText;
  }[];
  /**
   * @minItems 1
   */
  palette_states: PaletteState[];
  /**
   * null: not stated in the official instructions (with an open_questions entry naming interface_profile.save_requires_explicit_action).
   */
  save_requires_explicit_action: boolean | null;
  /**
   * null: not stated in the official instructions (with an open_questions entry naming interface_profile.clear_keeps_mark).
   */
  clear_keeps_mark: boolean | null;
  /**
   * null: not stated in the official instructions (with an open_questions entry naming interface_profile.marked_answer_evaluated).
   */
  marked_answer_evaluated: boolean | null;
  /**
   * null: not stated in the official instructions (with an open_questions entry naming interface_profile.keyboard_disabled_on_exam_day).
   */
  keyboard_disabled_on_exam_day?: boolean | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaletteState".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "PaletteState".
 */
export interface PaletteState {
  id: "not_visited" | "not_answered" | "answered" | "marked" | "answered_marked";
  label: I18NText;
  /**
   * A key under mockPalette in packages/tokens/tokens.json, for example mockPalette.answered.
   */
  colour_token: string;
  shape: "square" | "circle" | "pentagon-up" | "pentagon-down" | "circle-tick";
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Section".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Section".
 */
export interface Section {
  code: Slug;
  title: I18NText;
  subject?: string | null;
  timer_min?: number | null;
  /**
   * null for a qualifying skill test, or when the notice does not state it (then an open_questions entry names sections.{code}.question_count).
   */
  question_count: number | null;
  /**
   * Questions per type, when a section mixes types. Lets the check add up marks.
   */
  type_counts?: {
    [k: string]: number | undefined;
  };
  attempt_rule?: {
    attempt_any: number | null;
    over_attempt?: "block" | "evaluate_first_n" | null;
  };
  optional?: boolean;
  /**
   * Sectional cut-off or qualifying standard, only when notified.
   */
  cutoff?: null | QualifyingRule;
  /**
   * @minItems 1
   */
  question_types: QuestionType[];
  /**
   * Required, except for a section of skill_test questions only.
   */
  marking?: {
    [k: string]: MarkingRule | undefined;
  };
  /**
   * Only in a mixed paper: the mode of this section.
   */
  mode?: "cbt" | "pen_paper";
  /**
   * The section total as notified, when the notice prints it (needed when marks per question are not stated).
   */
  max_marks?: number | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "MarkingRule".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MarkingRule".
 */
export interface MarkingRule {
  /**
   * Marks for a right answer. null: not stated in the notice; the file then lists an open_questions entry naming this field.
   */
  correct: number | null;
  /**
   * Marks for a wrong answer (negative or 0), or a penalty as a fraction of the question's marks (UPSC: one-third).
   */
  wrong:
    | number
    | {
        fraction_of_question_marks: number;
      };
  unattempted: number;
  /**
   * JEE Advanced-style partial marking: per correct option chosen, only when no wrong option is chosen.
   */
  partial?: {
    per_correct_option: number;
    requires_no_wrong: boolean;
  } | null;
  /**
   * Numerical answers: as_notified, or the notified tolerance.
   */
  tolerance?: "as_notified" | Tolerance;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Topic".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Topic".
 */
export interface Topic {
  id: DottedId;
  name: I18NText;
  summary?: I18NText;
  /**
   * @minItems 1
   */
  subtopics: Subtopic[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Subtopic".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Subtopic".
 */
export interface Subtopic {
  id: DottedId;
  name: I18NText;
  /**
   * @minItems 1
   */
  concepts: Concept[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Concept".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Concept".
 */
export interface Concept {
  id: DottedId;
  name: I18NText;
  kind: ConceptKind;
  intrinsic_depth: Depth;
  summary: I18NText;
  /**
   * What a complete explanation must contain; the Feynman tutor grades against them.
   *
   * @minItems 1
   */
  key_points: I18NText[];
  /**
   * Concept ids this concept builds on. Edge kind prerequisite, from this concept to each prerequisite. Must form no cycle.
   */
  prerequisites: DottedId[];
  related?: DottedId[];
  /**
   * Confusable concepts (edge kind contrast).
   */
  contrasts?: DottedId[];
  /**
   * Concepts where this one is applied (edge kind applies_in).
   */
  applies_in?: DottedId[];
  /**
   * Old ids kept after a concept was split or renamed. Never reused.
   */
  aliases?: DottedId[];
  syllabus_refs: SyllabusRef[];
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "CardBase".
 */
export interface CardBase {
  id: CardId;
  type: CardType;
  /**
   * @minItems 1
   */
  concepts: DottedId[];
  depth: Depth;
  source?: Source;
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "DragSortConfig".
 */
export interface DragSortConfig {
  /**
   * @minItems 2
   */
  items: IdText[];
  /**
   * @minItems 2
   * @maxItems 4
   */
  bins: {
    id: Slug;
    label: I18NText;
  }[];
  /**
   * Which bin each item belongs in.
   *
   * @minItems 1
   */
  answer: {
    item: Slug;
    bin: Slug;
  }[];
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SliderConfig".
 */
export interface SliderConfig {
  min: number;
  max: number;
  step: number;
  initial?: number;
  unit: Unit;
  target?: {
    value: number;
    tolerance: Tolerance;
  };
  guidance?: I18NText;
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "GraphConfig".
 */
export interface GraphConfig {
  x: Axis;
  y: Axis;
  handle: "point" | "curve";
  initial?: {
    x: number;
    y: number;
  };
  target?: {
    x: number;
    y: number;
    tolerance: number;
  };
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Axis".
 */
export interface Axis {
  min: number;
  max: number;
  step: number;
  label: I18NText;
  unit?: Unit;
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "TapRevealConfig".
 */
export interface TapRevealConfig {
  /**
   * @minItems 2
   * @maxItems 6
   */
  tiles: {
    id: Slug;
    label: I18NText;
    text: I18NText;
    anchor?: Slug;
  }[];
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "LabelDiagramConfig".
 */
export interface LabelDiagramConfig {
  media: ImageRef;
  /**
   * @minItems 2
   */
  spots: {
    id: Slug;
    anchor: Slug;
  }[];
  /**
   * @minItems 2
   */
  labels: IdText[];
  /**
   * Which label belongs on each spot.
   *
   * @minItems 1
   */
  answer: {
    spot: Slug;
    label: Slug;
  }[];
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "OrderStepsConfig".
 */
export interface OrderStepsConfig {
  /**
   * In the correct order. The player shuffles them.
   *
   * @minItems 2
   */
  steps: IdText[];
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "NumericTarget".
 */
export interface NumericTarget {
  value: number;
  unit: Unit;
  tolerance?: Tolerance;
}
/**
 * What LAB-05 shows when a sim, 3D model or 360 scene cannot load (memory-labs G2).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "LabFallback".
 */
export interface LabFallback {
  media?: ImageRef;
  body: I18NText;
  video_ref?: {
    youtube_id: YoutubeId;
    start_s?: number;
  };
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Bite".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Bite".
 */
export interface Bite {
  id: Slug;
  title: I18NText;
  subtopic?: DottedId;
  /**
   * @minItems 1
   */
  card_ids: CardId[];
  estimated_minutes: number;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "QuestionBase".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "QuestionBase".
 */
export interface QuestionBase {
  id: QuestionId;
  type: QuestionType;
  /**
   * @minItems 1
   */
  concepts: {
    id: DottedId;
    weight: number;
  }[];
  depth: Depth;
  exam_styles?: Slug[];
  stem: I18NText;
  /**
   * Hints for the first wrong try, used when the picked option has no common_traps entry (learn G3).
   */
  hints?: I18NText[];
  solution?: Solution;
  ideal_time_s?: number;
  difficulty_estimate?: "easy" | "medium" | "hard";
  media?: null | ImageRef;
  /**
   * @minItems 1
   */
  use: QuestionUse[];
  source?: "original" | "pyq" | "ncert_exemplar" | "adapted";
  /**
   * Back-link to the paper, required when source is pyq.
   */
  pyq?: {
    paper: string;
    number: number;
  };
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Solution".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Solution".
 */
export interface Solution {
  feynman: I18NText;
  steps: I18NText[];
  shortcut?: null | I18NText;
  shortcut_fails_when?: null | I18NText;
  common_traps?: {
    option_id?: Slug;
    why: I18NText;
  }[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "SingleOptionAnswer".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SingleOptionAnswer".
 */
export interface SingleOptionAnswer {
  /**
   * @minItems 1
   * @maxItems 1
   */
  option_ids: Slug[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "OptionAnswer".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "OptionAnswer".
 */
export interface OptionAnswer {
  /**
   * @minItems 1
   */
  option_ids: Slug[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Mnemonic".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Mnemonic".
 */
export interface Mnemonic {
  id: MnemonicId;
  concept: DottedId;
  technique: Technique;
  /**
   * traditional: widely known (cite where it is commonly taught). system: made by the skill.
   */
  origin: "traditional" | "system";
  /**
   * Where a traditional mnemonic is commonly taught. Required for traditional ones.
   */
  taught_in?: string | null;
  locale: Locale;
  text: string;
  /**
   * The exact facts it encodes, in order, in the mnemonic's locale.
   *
   * @minItems 1
   */
  decodes_to: string[];
  exam_style?: string | null;
  media?: null | ImageRef;
  audio?: null | AudioRef;
  notes?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "MediaRequest".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MediaRequest".
 */
export interface MediaRequest {
  id: MediaRef;
  kind: MediaKind;
  preset?: Preset;
  subject_family?: SubjectFamily;
  brief: string;
  must_show?: string[];
  must_not_show?: string[];
  label_anchors?: LabelAnchor[];
  alt?: I18NText;
  decorative?: boolean;
  transcript?: I18NText;
  locale?: Locale;
  /**
   * Card, question or mnemonic ids that use this request.
   */
  used_by: string[];
  status: "requested" | "generated" | "approved" | "rejected";
  rejected_reason?: string | null;
  result: null | MediaResult;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "MediaResult".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MediaResult".
 */
export interface MediaResult {
  sha256: string;
  asset_id?: string | null;
  reused: boolean;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  /**
   * kind sim: the sims/{sim_id} bundle.
   */
  sim_id?: string;
  sim_version?: string;
  /**
   * Fixture files only: a repo path under design/mocks/assets/ the publisher copies for local output.
   */
  source_path?: string;
  licence?: string;
  attribution?: string | null;
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Scope".
 */
export interface Scope {
  id: ExtraId;
  scope: "topic" | "chapter";
  topic?: DottedId;
  chapter?: DottedId;
  title: I18NText;
  /**
   * @minItems 1
   */
  concepts: DottedId[];
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SheetFormula".
 */
export interface SheetFormula {
  name: I18NText;
  latex: Latex;
  vault_id?: DottedId;
  concept?: DottedId;
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Trap".
 */
export interface Trap {
  mistake: I18NText;
  correct: I18NText;
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SongVersion".
 */
export interface SongVersion {
  locale: Locale;
  audio: AudioRef;
  /**
   * @minItems 1
   * @maxItems 40
   */
  lines: LyricLine[];
}
/**
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "LyricLine".
 */
export interface LyricLine {
  text: string;
  /**
   * When the line starts in this version's audio. Timings are both set or both absent.
   */
  start_ms?: number;
  end_ms?: number;
  /**
   * An actions[] id to do on this line.
   */
  action?: string;
}
/**
 * Tap every picture that fits the prompt ('Tap the red fruits').
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "TapRound".
 */
export interface TapRound {
  kind: "tap";
  prompt: I18NText;
  hint?: I18NText;
  audio?: LocalizedAudioRef;
  /**
   * @minItems 2
   * @maxItems 6
   */
  items: PlayTile[];
  /**
   * @minItems 1
   */
  answer: Slug[];
}
/**
 * Something the child taps, drags or matches: a picture with a spoken label.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "PlayTile".
 */
export interface PlayTile {
  id: Slug;
  label: I18NText;
  media: ImageRef;
}
/**
 * Join each picture on the left to its partner on the right.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "MatchRound".
 */
export interface MatchRound {
  kind: "match";
  prompt: I18NText;
  hint?: I18NText;
  audio?: LocalizedAudioRef;
  /**
   * @minItems 2
   * @maxItems 5
   */
  pairs: {
    left: PlayTile;
    right: PlayTile;
  }[];
}
/**
 * Put each picture in its basket ('Living or non-living?').
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SortRound".
 */
export interface SortRound {
  kind: "sort";
  prompt: I18NText;
  hint?: I18NText;
  audio?: LocalizedAudioRef;
  /**
   * @minItems 2
   * @maxItems 3
   */
  buckets: {
    id: Slug;
    label: I18NText;
    media?: ImageRef;
  }[];
  /**
   * @minItems 2
   * @maxItems 8
   */
  items: {
    id: Slug;
    label: I18NText;
    media: ImageRef;
    bucket: Slug;
  }[];
}
/**
 * Drag pictures onto their places in a scene ('Put the hat on the clown'). Extra items are allowed as gentle distractors.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "DragRound".
 */
export interface DragRound {
  kind: "drag";
  prompt: I18NText;
  hint?: I18NText;
  audio?: LocalizedAudioRef;
  scene: ImageRef;
  /**
   * @minItems 1
   * @maxItems 5
   */
  targets: {
    id: Slug;
    label: I18NText;
    /**
     * Centre, 0-1 of the scene width.
     */
    x: number;
    /**
     * Centre, 0-1 of the scene height.
     */
    y: number;
    /**
     * Drop radius, 0-1 of the scene width; generous for small fingers.
     */
    radius: number;
    /**
     * The items[] id that belongs here.
     */
    accepts: string;
  }[];
  /**
   * @minItems 1
   * @maxItems 6
   */
  items: PlayTile[];
}
/**
 * Trace a letter or digit with a finger. The app draws the glyph from its own font; guide is the stroke-order animation from anim-maker (never hand-drawn paths).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "TraceRound".
 */
export interface TraceRound {
  kind: "trace";
  prompt: I18NText;
  hint?: I18NText;
  audio?: LocalizedAudioRef;
  glyph: string;
  script: "latin" | "devanagari" | "digits";
  guide?: AnimationRef;
  /**
   * Share of the glyph the finger must cover, 0.5-0.95.
   */
  min_coverage: number;
}
/**
 * content/coverage/{exam_profile_id}.json: generated by the content check (quality-bar 1, PRD 14). Never hand-edited. A subject ships only at 100%.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "CoverageReport".
 */
export interface CoverageReport {
  schema: "coverage@1";
  exam_profile: Slug;
  fixture?: boolean;
  totals: Tally;
  syllabus: {
    lines: number;
    mapped: number;
    percent: number;
    unmapped: string[];
  };
  inventory: {
    items: number;
    mapped: number;
    excluded: number;
    percent: number;
    unmapped: string[];
  };
  subjects: {
    id: string;
    released: boolean;
    /**
     * true when every concept, syllabus line and inventory item of the subject is covered.
     */
    ready: boolean;
    tally: Tally;
    chapters: {
      id: string;
      tally: Tally;
      concepts: ConceptCoverage[];
    }[];
  }[];
}
/**
 * This interface was referenced by `CoverageReport`'s JSON-Schema
 * via the `definition` "Tally".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Tally".
 */
export interface Tally {
  concepts: number;
  covered: number;
  percent: number;
}
/**
 * This interface was referenced by `CoverageReport`'s JSON-Schema
 * via the `definition` "ConceptCoverage".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ConceptCoverage".
 */
export interface ConceptCoverage {
  id: string;
  kind: string;
  depth: number;
  covered: boolean;
  met: Requirement[];
  missing: Requirement[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ReleaseScope".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ReleaseScope".
 */
export interface ReleaseScope {
  /**
   * Whole subjects released: every chapter of the subject the exam map includes.
   */
  subjects: Slug[];
  /**
   * Single chapters released, for subjects that are not released whole.
   */
  chapters: DottedId[];
}
/**
 * seed/{variant_id}/{locale}/seed.json: the index of a built seed pack that ships inside the app build. Projects to content.seed_packs.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "SeedPack".
 */
export interface SeedPack {
  schema: "seed-pack@1";
  variant_id: string;
  locale: Locale;
  fixture?: boolean;
  /**
   * sha256 over the sorted file hashes in the pack.
   */
  hash: string;
  total_bytes: number;
  manifests: {
    exam_profile: string;
    path: string;
    hash: string;
    version: number;
  }[];
  bundles: {
    id: string;
    hash: string;
    path: string;
    size_bytes: number;
  }[];
  assets: {
    ref: string;
    sha256: string;
    path: string;
    bytes: number;
  }[];
}
/**
 * A published bundle: one topic x mode x locale, immutable, named {topic}.{mode}.{locale}.{sha256}.json. Text is resolved to the bundle's locale; media and maths are resolved into the media and math maps. Mock and daily answer keys never appear here.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Bundle".
 */
export interface Bundle {
  schema: "bundle@1";
  /**
   * {topic_id}:{mode}:{locale}
   */
  id: string;
  fixture?: boolean;
  topic: {
    id: string;
    chapter: string;
    subject: string;
    name: string;
    summary?: string;
  };
  mode: BundleMode;
  locale: Locale;
  min_app_version: string;
  lesson_id?: string;
  estimated_minutes?: number;
  min_depth?: number;
  max_depth?: number;
  concepts: {
    id: string;
    name: string;
    kind: string;
    intrinsic_depth: number;
    summary: string;
    key_points: string[];
  }[];
  bites: {
    id: string;
    title: string;
    subtopic?: string;
    card_ids: string[];
    estimated_minutes: number;
    /**
     * true when the bite was derived from summary cards because the lesson has no bites[]
     */
    derived?: boolean;
  }[];
  cards: {
    id: string;
    type: CardType;
    concepts: string[];
    depth: number;
  }[];
  questions: {
    [k: string]:
      | {
          id: string;
          type: QuestionType;
        }
      | undefined;
  };
  mnemonics: {
    [k: string]: {} | undefined;
  };
  sheets: {
    [k: string]: {} | undefined;
  };
  /**
   * Activity bundles only: activity id -> the localised storybook@1, song@1 or play@1 item (authoring fields removed). A song carries only this locale's version, as version.
   */
  activities?: {
    [k: string]: {} | undefined;
  };
  /**
   * Papers the bundle's PYQ questions come from, for the Tough one chip ("Asked in {exam_name} {year}").
   */
  pyq_papers?: {
    [k: string]:
      | {
          exam: string;
          exam_name: string;
          year: number;
          session_label?: string | null;
        }
      | undefined;
  };
  media: {
    [k: string]: ResolvedMedia | undefined;
  };
  /**
   * Keyed by the exact TeX source with its delimiters, for example "$x^2$" or "$$E=mc^2$$". Text fields keep their $...$ segments; latex fields are keyed as display maths ($$...$$), formula symbols as inline maths.
   */
  math: {
    [k: string]: RenderedMath | undefined;
  };
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ResolvedMedia".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ResolvedMedia".
 */
export interface ResolvedMedia {
  ref: string;
  kind: MediaKind;
  /**
   * ready: url points to the immutable asset. unavailable: not approved yet (fixtures and local builds only); the player shows the card's fallback or alt text.
   */
  status: "ready" | "unavailable";
  /**
   * Relative to the CDN root, for example assets/{sha256}.webp.
   */
  url: string | null;
  sha256?: string | null;
  mime?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  decorative?: boolean;
  transcript?: string | null;
  label_anchors?: LabelAnchor[];
  sim?: {
    id: string;
    version: string;
    entry: string;
    aspect: string;
    size_bytes: number;
    origin: string;
    licence: string;
    attribution?: string | null;
  } | null;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RenderedMath".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "RenderedMath".
 */
export interface RenderedMath {
  tex: string;
  display: boolean;
  /**
   * Self-contained SVG with glyphs as paths; fill is currentColor so one asset serves light and dark themes.
   */
  svg: string;
  width_ex: number;
  height_ex: number;
  vertical_align_ex: number;
}
/**
 * A published manifest: one exam profile x locale. Lists every subject, chapter and topic with its bundle hashes, sizes and the available delta patches, plus the exam's concept depths so the player can hide cards above the exam's depth. Served at manifests/{profile}.{locale}.json (short TTL) and archived as manifests/{profile}.{locale}.{sha256}.json.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "Manifest".
 */
export interface Manifest {
  schema: "manifest@1";
  exam_profile: string;
  locale: Locale;
  version: number;
  min_app_version: string;
  fixture?: boolean;
  exam: {
    id: string;
    name: string;
    profile_name: string;
    cycle: string;
    category: string;
    conducting_body?: string | null;
  };
  subjects: {
    id: string;
    name: string;
    color_family: string;
    sort: number;
    chapters: {
      id: string;
      name: string;
      sort: number;
      unit: string;
      /**
       * The first 2 chapters of every subject (PRD 11.1). Rotating free chapters come from the flag free.rotating_chapters, added by the API.
       */
      free_deep_dive: boolean;
      topics: string[];
    }[];
  }[];
  topics: {
    [k: string]: TopicEntry | undefined;
  };
  blueprints: {
    paper_code: string;
    version: number;
    effective_from: string;
  }[];
  free: {
    deep_dive_chapters: string[];
  };
}
/**
 * This interface was referenced by `Manifest`'s JSON-Schema
 * via the `definition` "TopicEntry".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "TopicEntry".
 */
export interface TopicEntry {
  name: string;
  chapter: string;
  sort: number;
  /**
   * concept id -> the deepest level this exam needs
   */
  depth: {
    [k: string]: number | undefined;
  };
  bundles: {
    [k: string]: BundleEntry | undefined;
  };
  /**
   * Little learner path nodes for this topic, in path order (story, song, play; then by id). Each opens from the topic's story, song or play bundle.
   */
  activities?: ActivityEntry[];
}
/**
 * This interface was referenced by `Manifest`'s JSON-Schema
 * via the `definition` "BundleEntry".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "BundleEntry".
 */
export interface BundleEntry {
  id: string;
  hash: string;
  path: string;
  size_bytes: number;
  card_count: number;
  min_app_version: string;
  is_free: boolean;
  patches: {
    from_hash: string;
    path: string;
    size_bytes: number;
  }[];
}
/**
 * This interface was referenced by `Manifest`'s JSON-Schema
 * via the `definition` "ActivityEntry".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ActivityEntry".
 */
export interface ActivityEntry {
  id: string;
  kind: "story" | "song" | "play";
  title: string;
  minutes: number | null;
  /**
   * Image request id for the path node thumbnail, or null.
   */
  cover: string | null;
  concepts: string[];
}
/**
 * A delta patch from one bundle version to another (TRD 3.2), at patches/{from_hash}-{to_hash}.json, immutable. Applying it to the from bundle gives exactly the to bundle (same canonical hash).
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "BundlePatch".
 */
export interface BundlePatch {
  schema: "patch@1";
  bundle_id: string;
  from_hash: string;
  to_hash: string;
  /**
   * Top-level fields (other than cards and the keyed maps) whose value changed, with the new value.
   */
  set: {};
  /**
   * Top-level fields removed.
   */
  unset: string[];
  cards: {
    /**
     * Every card id of the new version, in order.
     */
    order: string[];
    /**
     * Added and changed cards, whole.
     */
    upsert: {}[];
    removed: string[];
  };
  /**
   * Changes to the keyed maps (questions, mnemonics, sheets, media, math).
   */
  maps: {
    [k: string]:
      | {
          upsert: {};
          removed: string[];
        }
      | undefined;
  };
}
/**
 * publish-history.json in the output target: every hash ever published per bundle, manifest and content item, so versions stay monotonic and patches can be built from earlier versions. Mirrors content.bundle_history.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "PublishHistory".
 */
export interface PublishHistory {
  schema: "publish-history@1";
  fixture?: boolean;
  bundles: {
    [k: string]:
      | {
          hash: string;
          version: number;
          size_bytes: number;
          published_at: string;
        }[]
      | undefined;
  };
  manifests: {
    [k: string]:
      | {
          hash: string;
          version: number;
          published_at: string;
        }[]
      | undefined;
  };
  items: {
    [k: string]:
      | {
          version: number;
          /**
           * locale -> content hash
           */
          hashes: {
            [k: string]: string | undefined;
          };
          published_at: string;
        }[]
      | undefined;
  };
}
/**
 * A Make it stick draft (memory-labs 5.7, gap G26), shared by POST /v1/ai/memory-cue and the tutor's forge_mnemonic tool.
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "ForgeDraft".
 */
export interface ForgeDraft {
  draft_id: string;
  concept_id?: DottedId;
  card_ref?: string;
  source_card_id?: string;
  locale: Locale;
  exam_style: string | null;
  technique: Technique;
  text: string;
  decode: {
    covered: number;
    total: number;
    in_order: boolean;
    missing: number[];
  };
  image_request?: {
    preset: "memory-hook";
    prompt_ref: string;
  } | null;
  audio_ref?: string | null;
  origin: "ai" | "user";
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PalaceTemplateSpot".
 *
 * This interface was referenced by `SmritiContentTypes`'s JSON-Schema
 * via the `definition` "PalaceTemplateSpot".
 */
export interface PalaceTemplateSpot {
  id: Slug;
  /**
   * Walk order in the room, 0-based and gapless.
   */
  order: number;
  /**
   * {x, y} fractions of the picture for an image room, {yaw, pitch} degrees for a pano room.
   */
  pos:
    | {
        x: number;
        y: number;
      }
    | {
        yaw: number;
        pitch: number;
      };
  label?: I18NText1;
}
/**
 * Localised text keyed by locale, for example { "en": "...", "hi": "..." }. Which locales are required is checked per exam profile by the content check, so a new language adds keys, not schema changes.
 */
export interface I18NText1 {
  [k: string]: string | undefined;
}
