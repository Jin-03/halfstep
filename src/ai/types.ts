import type { StepDraft } from '../db/ops';
import type { AiEngineId, StepOrigin } from '../db/schema';

/**
 * 분해 요청 3종
 * - goal: 목표 전체를 단계로 나누기
 * - split: 한 단계를 하위 단계로 더 쪼개기
 * - more: 이미 있는 단계 뒤에 이어 할 단계 더 제안하기
 */
export type DecomposeRequest = (
  | { kind: 'goal'; goal: string }
  | { kind: 'split'; goal: string; step: string; minutes?: number; path: string[] }
  /** doneRatio: 지금 진행률(0~1). 많이 진행됐으면 마무리 단계부터 제안한다 */
  | { kind: 'more'; goal: string; existing: string[]; doneRatio?: number }
) & {
  /** 목표의 메모 (예: "교재는 이미 샀어요"). AI 지시문에 넣고, 기본 규칙은 마감·횟수만 읽는다 */
  note?: string;
  /** decompose()가 채워 넣는 공용 정보 (목표 분석, 템플릿, 맞춤 예시) */
  context?: import('./context').DecomposeContext;
};

/** 규칙 엔진이 고를 수 있는 템플릿 (내 템플릿 + 기본 템플릿) */
export interface RuleTemplate {
  id: string;
  title: string;
  keywords: string[];
  steps: StepDraft[];
  /** 이 템플릿이 어울리는 목표 유형 (없으면 기본 템플릿 표를 본다) */
  types?: import('./rulesData').GoalType[];
  /** 내 템플릿이면 true (키워드를 사용자가 직접 정했으므로 약하게 맞아도 쓴다) */
  mine?: boolean;
}

export type EngineStatus =
  | 'ready' // 바로 쓸 수 있음
  | 'needs-download' // 모델을 받아야 함 (download로 받을 수 있음)
  | 'downloading'
  | 'unsupported'; // 이 기기·브라우저에서는 쓸 수 없음

export interface Availability {
  status: EngineStatus;
  /** ready가 아닐 때 사용자에게 보여 줄 설명 */
  reason?: string;
}

export interface Engine {
  id: 'rules' | AiEngineId;
  /** 화면에 보여 줄 이름 */
  label: string;
  /** 설정 화면에 보여 줄 한 줄 설명 */
  description: string;
  available(): Promise<Availability>;
  /** 모델 받기. 진행률은 0~1 */
  download?(onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<void>;
  /** 받아 둔 모델을 지워 저장 공간을 되찾는다 */
  remove?(): Promise<void>;
  /** 나누기 전에 모델을 메모리에 올린다. 시간 제한(AI_TIMEOUT_MS)에 들어가지 않는다 */
  warmup?(signal?: AbortSignal): Promise<void>;
  decompose(req: DecomposeRequest, signal?: AbortSignal): Promise<StepDraft[]>;
}

/** 이 엔진이 만든 단계에 기록할 출처 */
export function originOf(engine: Engine): StepOrigin {
  return engine.id === 'rules' ? { source: 'rules' } : { source: 'ai', engine: engine.id };
}
