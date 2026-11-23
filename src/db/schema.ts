import Dexie, { type EntityTable } from 'dexie';

/** 단계가 만들어진 방법. AI면 어느 엔진인지는 engine에 따로 적는다 */
export type StepSource =
  | 'ai'
  | 'rules' // 기본 규칙 엔진
  | 'template'
  | 'manual'
  | 'legacy'; // localStorage에서 옮겨 온 데이터

/** 단계를 만든 AI 엔진 */
export type AiEngineId =
  | 'chrome' // 웹: Chrome 내장 AI
  | 'webllm' // 웹: WebLLM (선택해서 받기)
  | 'gemini-nano' // 앱: Android 시스템의 Gemini Nano
  | 'native'; // 앱: 기기 내 AI (MediaPipe)

export const STEP_SOURCES: readonly StepSource[] = ['ai', 'rules', 'template', 'manual', 'legacy'];
export const AI_ENGINES: readonly AiEngineId[] = ['chrome', 'webllm', 'gemini-nano', 'native'];

/** 단계의 출처: 방법 + (AI면) 엔진 */
export interface StepOrigin {
  source: StepSource;
  engine?: AiEngineId;
}

/**
 * 저장된 값이나 백업 값을 지금 형식의 출처로 읽는다.
 * DB 버전 2까지의 'ai-chrome'처럼 엔진이 붙은 값은 'ai' + engine으로 나눈다. 모르는 값이면 null.
 */
export function readOrigin(source: unknown, engine?: unknown): StepOrigin | null {
  if (typeof source !== 'string') return null;
  if (source.startsWith('ai-')) {
    const e = source.slice(3) as AiEngineId;
    return AI_ENGINES.includes(e) ? { source: 'ai', engine: e } : null;
  }
  if (!STEP_SOURCES.includes(source as StepSource)) return null;
  if (source !== 'ai') return { source: source as StepSource };
  return AI_ENGINES.includes(engine as AiEngineId) ? { source: 'ai', engine: engine as AiEngineId } : { source: 'ai' };
}

export interface Goal {
  id: string;
  title: string;
  note?: string;
  /** 다 끝내면 나에게 줄 보상 */
  reward?: string;
  /** 목표 완료 축하를 보여 준 시각. 있으면 다시 띄우지 않는다 */
  celebratedAt?: number;
  /** "보상 받기"를 누른 시각 */
  rewardClaimedAt?: number;
  createdAt: number;
  /** 목표나 그 단계가 바뀔 때마다 갱신 */
  updatedAt: number;
}

/** 단계 트리를 평평하게 펼친 행 */
export interface StepRow {
  id: string;
  goalId: string;
  /** null = 최상위 */
  parentId: string | null;
  /** 형제 간 순서. ORDER_GAP 간격 */
  order: number;
  title: string;
  /** 리프에서만 의미 있음 */
  minutes?: number;
  /** 완료 시각. 리프에서만 값이 있음 (불변식 1) */
  doneAt: number | null;
  collapsed?: boolean;
  source: StepSource;
  /** source가 'ai'일 때 만든 엔진 */
  engine?: AiEngineId;
  createdAt: number;
}

/** 사용자가 만든 템플릿. 단계는 초안 트리 그대로 저장한다 */
export interface UserTemplate {
  id: string;
  title: string;
  summary?: string;
  /** 자동 나누기(기본 규칙)가 목표 문장에서 찾는 단어 */
  keywords: string[];
  steps: TemplateStep[];
  createdAt: number;
  updatedAt: number;
}

export interface TemplateStep {
  title: string;
  minutes?: number;
  children?: TemplateStep[];
}

export type SettingKey =
  | 'enginePref'
  | 'migratedFromLocalStorage'
  | 'lastBackupAt'
  | 'persistGranted'
  | 'pinnedGoalId'
  | 'celebration'
  | 'webllmModel';

export interface Setting {
  key: SettingKey;
  value: unknown;
}

export class HalfStepDB extends Dexie {
  goals!: EntityTable<Goal, 'id'>;
  steps!: EntityTable<StepRow, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  templates!: EntityTable<UserTemplate, 'id'>;

  constructor(name = 'halfstep') {
    super(name);
    this.version(1).stores({
      goals: 'id, createdAt',
      steps: 'id, goalId, doneAt',
      settings: 'key',
    });
    // v2 (2026-11-09): 내 템플릿
    this.version(2).stores({
      templates: 'id, updatedAt',
    });
    // v3 (2026-11-23): source 'ai-chrome' 등 → source 'ai' + engine 'chrome'
    this.version(3)
      .stores({})
      .upgrade((tx) =>
        tx
          .table('steps')
          .toCollection()
          .modify((s: { source: unknown; engine?: unknown }) => {
            if (typeof s.source !== 'string' || !s.source.startsWith('ai-')) return;
            const o = readOrigin(s.source) ?? { source: 'ai' };
            s.source = o.source;
            if (o.engine) s.engine = o.engine;
          }),
      );
  }
}

export const db = new HalfStepDB();

export const ORDER_GAP = 1000;

export function newId(): string {
  return crypto.randomUUID();
}
