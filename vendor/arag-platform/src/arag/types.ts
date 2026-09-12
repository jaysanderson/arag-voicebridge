/**
 * Types for the Progress Agentic RAG (ARAG / Nuclia) REST API, limited to the shapes the
 * products use. Field names follow the official API (docs.rag.progress.cloud).
 */

export type Author = "USER" | "NUCLIA";
export interface ChatContext {
  author: Author;
  text: string;
}

export type RerankerName = "predict" | "noop" | (string & {});
export type SearchFeature = "keyword" | "semantic" | "relations";

export interface RagStrategy {
  name:
    | "full_resource"
    | "hierarchy"
    | "neighbouring_paragraphs"
    | "field_extension"
    | "metadata_extension"
    | "prequeries";
  [key: string]: unknown;
}

/** OpenAI-function-style schema accepted by `answer_json_schema`. */
export interface AnswerJsonSchema {
  name: string;
  description?: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface CustomPrompt {
  system?: string;
  user?: string;
}

export interface AskRequest {
  query: string;
  context?: ChatContext[];
  chat_history?: ChatContext[];
  features?: SearchFeature[];
  citations?: boolean | "default" | "llm_footnotes";
  citation_threshold?: number;
  resource_filters?: string[];
  filter_expression?: unknown;
  security?: { groups: string[] };
  prompt?: string | CustomPrompt;
  reranker?: RerankerName;
  rag_strategies?: RagStrategy[];
  rag_images_strategies?: unknown[];
  generative_model?: string;
  generative_model_seed?: number;
  max_tokens?: number;
  temperature?: number;
  top_k?: number;
  answer_json_schema?: AnswerJsonSchema;
  search_configuration?: string;
  generate_answer?: boolean;
  rephrase?: boolean;
  prefer_markdown?: boolean;
  extra_context?: string[];
  [key: string]: unknown;
}

/** A paragraph as it appears inside retrieval results. */
export interface RetrievedParagraph {
  id?: string;
  text?: string;
  score?: number;
  position?: {
    start?: number;
    end?: number;
    start_seconds?: number[];
    end_seconds?: number[];
    page_number?: number;
  };
  [key: string]: unknown;
}
export interface RetrievedField {
  paragraphs?: Record<string, RetrievedParagraph>;
  [key: string]: unknown;
}
export interface RetrievedResource {
  id?: string;
  title?: string;
  slug?: string;
  icon?: string;
  origin?: { url?: string; [key: string]: unknown };
  fields?: Record<string, RetrievedField>;
  [key: string]: unknown;
}
export interface RetrievalResults {
  resources?: Record<string, RetrievedResource>;
  [key: string]: unknown;
}

/** One line of the `/ask` NDJSON stream, normalised to `{ item }`. */
export type AskStreamItem =
  | { type: "answer"; text: string }
  | { type: "retrieval"; results: RetrievalResults }
  | { type: "citations"; citations: Record<string, Array<[number, number]>> }
  | { type: "footnote_citations"; citations: Record<string, unknown> }
  | {
      type: "metadata";
      tokens?: Record<string, number>;
      timings?: Record<string, number>;
      [key: string]: unknown;
    }
  | { type: "status"; code?: string; status?: string; details?: string; [key: string]: unknown }
  | { type: "error"; error?: string; details?: string; [key: string]: unknown }
  | { type: "relations"; [key: string]: unknown }
  | { type: "augmented_context"; [key: string]: unknown }
  | { type: "answer_json"; object: unknown }
  | { type: "debug"; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

/** Assembled result of a full `/ask` call. */
export interface AskResult {
  /** Concatenated answer text (empty when `answer_json_schema` was used). */
  answerText: string;
  /** Structured answer when `answer_json_schema` was used. */
  answerJson: unknown;
  retrieval: RetrievalResults;
  /** Citation map: `<rid>/<type>/<field>/<start>-<end>` → answer spans. */
  citations: Record<string, Array<[number, number]>>;
  /** Titles of retrieved resources (deduped, in retrieval order). */
  sourceTitles: string[];
  status: string | undefined;
  errorDetail: string | undefined;
  metadata: Record<string, unknown> | undefined;
  /** ms from request start until the first answer chunk / first retrieval item / end. */
  timings: { firstTokenMs: number; retrieveMs: number; totalMs: number };
  /** Every raw item, kept for callers that need more. */
  items: AskStreamItem[];
}

export interface FindRequest {
  query: string;
  features?: SearchFeature[];
  top_k?: number;
  resource_filters?: string[];
  filter_expression?: unknown;
  security?: { groups: string[] };
  reranker?: RerankerName;
  search_configuration?: string;
  [key: string]: unknown;
}
export interface FindResponse {
  resources?: Record<string, RetrievedResource>;
  [key: string]: unknown;
}

export interface CatalogRequest {
  query?: string;
  page_number?: number;
  page_size?: number;
  filters?: string[];
  filter_expression?: unknown;
  sort?: { field: string; order?: "asc" | "desc"; limit?: number };
  [key: string]: unknown;
}
export interface CatalogResponse {
  resources?: Record<string, ResourceSummary>;
  fulltext?: { page_number?: number; page_size?: number; next_page?: boolean; total?: number };
  [key: string]: unknown;
}

export type ProcessingStatus = "PENDING" | "PROCESSED" | "ERROR" | "BLOCKED" | "EXPIRED" | (string & {});

export interface ResourceSummary {
  id: string;
  slug?: string;
  title?: string;
  icon?: string;
  created?: string;
  modified?: string;
  metadata?: { status?: ProcessingStatus; [key: string]: unknown };
  origin?: Record<string, unknown>;
  extra?: { metadata?: Record<string, unknown> };
  usermetadata?: { classifications?: Array<{ labelset: string; label: string }>; [key: string]: unknown };
  computedmetadata?: {
    field_classifications?: Array<{
      field?: unknown;
      classifications?: Array<{ labelset: string; label: string }>;
    }>;
  };
  [key: string]: unknown;
}

export interface ParagraphMeta {
  start?: number;
  end?: number;
  start_seconds?: number[];
  end_seconds?: number[];
  kind?: string;
  classifications?: Array<{ labelset: string; label: string }>;
  page?: { page?: number };
  [key: string]: unknown;
}

export interface FieldData {
  value?: {
    body?: string;
    format?: string;
    keyvalues?: Array<{ key: string; value: unknown }>;
    [key: string]: unknown;
  };
  extracted?: {
    text?: { text?: string; [key: string]: unknown };
    metadata?: {
      metadata?: {
        paragraphs?: ParagraphMeta[];
        classifications?: Array<{ labelset: string; label: string }>;
        [key: string]: unknown;
      };
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Full resource as returned by GET /resource/{rid}. */
export interface Resource extends ResourceSummary {
  data?: Record<string, Record<string, FieldData> | undefined>;
}

export interface UploadResult {
  uuid: string;
  field_id?: string;
  seqid?: number;
  [key: string]: unknown;
}

export interface CreateResourceRequest {
  title?: string;
  slug?: string;
  icon?: string;
  origin?: Record<string, unknown>;
  extra?: { metadata?: Record<string, unknown> };
  usermetadata?: { classifications?: Array<{ labelset: string; label: string }> };
  texts?: Record<
    string,
    { body: string; format?: "PLAIN" | "MARKDOWN" | "HTML" | "RST" | "JSON" | (string & {}) }
  >;
  [key: string]: unknown;
}

export interface Labelset {
  title: string;
  color?: string;
  multiple?: boolean;
  kind?: Array<"RESOURCES" | "PARAGRAPHS" | (string & {})>;
  labels?: Array<{ title: string; text?: string; uri?: string; related?: string }>;
}
export interface LabelsetsResponse {
  labelsets: Record<string, Labelset>;
}

export interface TaskStartRequest {
  name: string; // labeler | ask | ...
  parameters: Record<string, unknown>;
}
export interface TaskStartResponse {
  id: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}
export interface TaskInfo {
  id: string;
  task?: { name?: string; [key: string]: unknown };
  parameters?: Record<string, unknown>;
  completed?: boolean;
  failed?: boolean;
  stopped?: boolean;
  [key: string]: unknown;
}
export interface TasksListResponse {
  tasks?: unknown[];
  configs?: TaskInfo[];
  running?: TaskInfo[];
  done?: TaskInfo[];
  [key: string]: unknown;
}

export interface SearchConfiguration {
  kind: "ask" | "find";
  config: Record<string, unknown>;
}

export interface RemiRequest {
  user_id: string;
  question: string;
  answer: string;
  contexts: string[];
}
export interface RemiResponse {
  answer_relevance?: { score?: number; reason?: string } | null;
  context_relevance?: Array<number | null> | null;
  groundedness?: Array<number | null> | null;
  [key: string]: unknown;
}
