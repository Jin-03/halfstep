import Dexie, { type EntityTable } from 'dexie';

/** 단계가 만들어진 경로 */
export type StepSource =
  | 'ai-native' // 앱: 기기 내 AI (MediaPipe)
  | 'ai-chrome' // 웹: Chrome 내장 AI
  | 'ai-gemini-nano' // 앱: Android 시스템의 Gemini Nano
  | 'rules' // 기본 규칙 엔진
  | 'template'
  | 'manual'
  | 'legacy'; // localStorage에서 옮겨 온 데이터

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
  | 'celebration';

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
  }
}

export const db = new HalfStepDB();

export const ORDER_GAP = 1000;

export function newId(): string {
  return crypto.randomUUID();
}
