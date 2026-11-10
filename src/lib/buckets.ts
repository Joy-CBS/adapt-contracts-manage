/**
 * 검토 범위(어댑트 전달자료 v1.1 기준).
 * 추정 계약 수 상위 5종은 해당 플레이북으로 깊게 검토하고, 나머지는 모두 "기타"로 묶어
 * 01_COMMON_POSITIONS(전 표준 공통 기준)까지만 검토한다.
 * 화면·스크립트 양쪽에서 쓰므로 파일 시스템에 의존하지 않는다.
 * 유형 이름·정의·추정 건수는 어댑트 자료(taxonomy.json)에서 읽어 DB로만 옮긴다(공개 저장소에 두지 않음).
 */

export const OTHERS_KEY = "others";

export type Bucket = {
  key: string;
  /** 어댑트 플레이북 ID. 표준이 없는 유형은 null */
  standardId: string | null;
  /** 이 유형에 법무팀 확정 표준이 있는가 */
  hasStandard: boolean;
  /** 표준이 없을 때 참고로 함께 보는 플레이북 */
  referenceStandardId?: string;
};

/** 추정 계약 수 순서(상위 5종) + 기타 */
export const BUCKETS: Bucket[] = [
  { key: "inf_paid_en", standardId: "INF-PAID-EN-01", hasStandard: true },
  { key: "tw_inf", standardId: null, hasStandard: false, referenceStandardId: "INF-PAID-EN-01" },
  { key: "adc_crt_kr", standardId: "ADC-CRT-KR-01", hasStandard: true },
  { key: "inf_ttaff_en", standardId: "INF-TTAFF-EN-01", hasStandard: true },
  { key: "adc_agy_kr", standardId: "ADC-AGY-KR-01", hasStandard: true },
  { key: OTHERS_KEY, standardId: null, hasStandard: false },
];

export const OTHERS_NAME = "기타 유형";

export const TOP_KEYS = BUCKETS.filter((b) => b.key !== OTHERS_KEY).map((b) => b.key);

export const bucketOf = (categoryId: string | null | undefined) => (categoryId && TOP_KEYS.includes(categoryId) ? categoryId : OTHERS_KEY);

export const bucketByKey = (key: string) => BUCKETS.find((b) => b.key === key);
