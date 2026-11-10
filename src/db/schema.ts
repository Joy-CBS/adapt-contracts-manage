import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * 앱 DB 스키마. 원문 해석 결과의 정본은 Studio(Job·Collection)에 있고,
 * 여기는 화면·흐름 제어에 필요한 레지스트리와 Studio ID 연결만 둔다.
 */

export const contractSource = pgEnum("contract_source", ["legacy", "slack", "upload"]);
export const contractStatus = pgEnum("contract_status", [
  "registered", // 업로드만 됨
  "processing", // Studio Job 진행 중
  "analyzed", // 메타데이터·유형 판단 완료
  "reviewed", // 리스크 분석까지 완료
  "failed",
]);
export const categoryOrigin = pgEnum("category_origin", [
  "adapt_standard", // 어댑트 25종 표준계약서
  "derived", // 기존 계약서에서 도출(F2)
  "new", // 신규 인입으로 생성(F3)
]);
export const categoryStatus = pgEnum("category_status", ["draft", "confirmed"]);
/** 유형 분류 확정 상태: AI 제안(미승인) → 담당자 승인 또는 다른 유형으로 변경 */
export const classifyState = pgEnum("classify_state", ["suggested", "approved", "changed"]);
/** 변호사 확인 항목의 진행 상태 */
export const lawyerStatus = pgEnum("lawyer_status", ["open", "requested", "answered"]);
export const templateSource = pgEnum("template_source", [
  "adapt_original", // 어댑트가 제공한 원본
  "representative", // 카테고리 대표 계약서에서 만든 임시 표준안
  "generated_draft", // 신규 유형용 생성 초안
]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Studio Classify의 클래스 값과 동일한 키 */
  classKey: text("class_key").notNull().unique(),
  name: text("name").notNull(),
  definition: text("definition"),
  includeCriteria: text("include_criteria"),
  excludeCriteria: text("exclude_criteria"),
  standardizable: boolean("standardizable").notNull().default(true),
  standardizableReason: text("standardizable_reason"),
  origin: categoryOrigin("origin").notNull(),
  status: categoryStatus("status").notNull().default("draft"),
  /** 어댑트 플레이북 ID(표준 없는 유형은 null) */
  standardId: text("standard_id"),
  hasStandard: boolean("has_standard").notNull().default(false),
  includeSignals: jsonb("include_signals"),
  excludeSignals: jsonb("exclude_signals"),
  /** 어댑트 추정 계약 수 */
  estimate: integer("estimate"),
  /** 어댑트 분류체계 그룹(인플루언서·광고 콘텐츠·유통 등) */
  group: text("group"),
  /** taxonomy status: standard_exists | standard_needed | out_of_scope | new(담당자가 등록한 신규 유형) */
  taxonomyStatus: text("taxonomy_status"),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 어댑트 분류체계(taxonomy.json) 49종. 검토 범위(categories)는 상위 5종 + 기타로 묶는다 */
export const subtypes = pgTable("subtypes", {
  id: text("id").primaryKey(), // category_id
  nameKo: text("name_ko").notNull(),
  group: text("group"),
  standardId: text("standard_id"),
  status: text("status"),
  definition: text("definition"),
  includeSignals: jsonb("include_signals"),
  excludeSignals: jsonb("exclude_signals"),
  /** 이 세부 유형이 속한 검토 범위(categories.class_key) */
  bucket: text("bucket").notNull(),
});

export const standardTemplates = pgTable("standard_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  title: text("title").notNull(),
  source: templateSource("source").notNull(),
  version: integer("version").notNull().default(1),
  /** 표준안 전체(StandardTemplate: 국·영문 조항, 가드레일) */
  body: jsonb("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: contractSource("source").notNull(),
  filename: text("filename").notNull(),
  /** 원본 폴더 기준 상대 경로(legacy) */
  sourcePath: text("source_path"),
  sourceFolder: text("source_folder"),
  sha256: text("sha256").unique(),
  blobUrl: text("blob_url"),
  studioFileId: text("studio_file_id"),
  studioJobId: text("studio_job_id"),
  studioClassifyJobId: text("studio_classify_job_id"),
  status: contractStatus("status").notNull().default("registered"),
  language: text("language"),
  categoryId: uuid("category_id").references(() => categories.id),
  classifyConfidence: doublePrecision("classify_confidence"),
  /** 분류 근거(Studio Classify 결과 + Rationale 신호·발췌 + 근거 수준) */
  classification: jsonb("classification"),
  classifyState: classifyState("classify_state").notNull().default("suggested"),
  classifyDecidedAt: timestamp("classify_decided_at", { withTimezone: true }),
  classifyNote: text("classify_note"),
  /** 어댑트 분류체계 세부 유형(subtypes.id) */
  subtypeId: text("subtype_id"),
  /** 담당자가 유형을 바꿔 다시 검토해야 하는 상태 */
  needsReReview: boolean("needs_re_review").notNull().default(false),
  reReviewJobId: text("re_review_job_id"),
  /**
   * 검토 요청 진행 단계(source가 upload·slack인 요청만):
   * analyzing(AI 분석) → type_check(유형 확인) → reviewing(리스크 검토) → reviewed(결과 확인·변호사 확인) → done(완료) | failed
   */
  stage: text("stage"),
  extractJobId: text("extract_job_id"),
  reviewJobId: text("review_job_id"),
  requestNote: text("request_note"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** F1 추출 메타데이터(당사자·브랜드·금액·기간·조항 요약) */
  metadata: jsonb("metadata"),
  slackChannel: text("slack_channel"),
  slackTs: text("slack_ts"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id")
    .notNull()
    .references(() => contracts.id),
  templateId: uuid("template_id").references(() => standardTemplates.id),
  /** Studio Validate 판정 green/yellow/red */
  verdict: text("verdict"),
  highCount: integer("high_count").notNull().default(0),
  mediumCount: integer("medium_count").notNull().default(0),
  lowCount: integer("low_count").notNull().default(0),
  /** ReviewResult: 요약·의견·조항별 검토 */
  result: jsonb("result"),
  /** Validate check 상세 */
  checks: jsonb("checks"),
  studioJobId: text("studio_job_id"),
  /** v2: 확정 기준 위반(수정 필요)·변호사 확인·참고 항목 수 */
  riskCount: integer("risk_count").notNull().default(0),
  lawyerCount: integer("lawyer_count").notNull().default(0),
  noteCount: integer("note_count").notNull().default(0),
  /** 검토에 쓴 범위(class_key)와 모델 */
  bucket: text("bucket"),
  model: text("model"),
  schemaVersion: integer("schema_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 검토 항목별 담당자 조치: 변호사 확인 요청·답변 기록 */
export const reviewItemStates = pgTable(
  "review_item_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    itemIndex: integer("item_index").notNull(),
    status: lawyerStatus("status").notNull().default("open"),
    /** 요청 메모(담당자) */
    requestNote: text("request_note"),
    /** 변호사 답변: 수용 / 수정 요구 / 기타 */
    resolution: text("resolution"),
    answerNote: text("answer_note"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("review_item_states_review_item").on(t.reviewId, t.itemIndex)],
);

/** Studio 리소스 ID 저장소(Agent·Config·Collection 등). key 예: agent.review */
export const studioResources = pgTable("studio_resources", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
