import {
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
  "analyzed", // 메타데이터 추출 완료
  "reviewed", // 리스크 분석·변경기록까지 완료
  "failed",
]);
export const categoryOrigin = pgEnum("category_origin", [
  "adapt_standard", // 어댑트 25종 표준계약서
  "derived", // 기존 계약서에서 도출(F2)
  "new", // 신규 인입으로 생성(F3)
]);
export const categoryStatus = pgEnum("category_status", ["draft", "confirmed"]);
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
  description: text("description"),
  origin: categoryOrigin("origin").notNull(),
  status: categoryStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const standardTemplates = pgTable("standard_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  title: text("title").notNull(),
  source: templateSource("source").notNull(),
  version: integer("version").notNull().default(1),
  /** 조항 구조(JSON): [{ no, title, text, guardrail }] */
  clauses: jsonb("clauses"),
  docxUrl: text("docx_url"),
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
  status: contractStatus("status").notNull().default("registered"),
  language: text("language"),
  categoryId: uuid("category_id").references(() => categories.id),
  classifyConfidence: doublePrecision("classify_confidence"),
  /** F1 추출 메타데이터(당사자·브랜드·금액·기간 등) */
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
  /** Validate 판정 green/yellow/red */
  verdict: text("verdict"),
  /** [{ clause, severity, standard, actual, reason, suggestion }] */
  risks: jsonb("risks"),
  studioJobId: text("studio_job_id"),
  redlineDocxUrl: text("redline_docx_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Studio 리소스 ID 저장소(Agent·Config·Collection 등). key 예: agent.ingest */
export const studioResources = pgTable("studio_resources", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
