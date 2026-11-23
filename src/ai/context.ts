/**
 * 한 번의 분해 요청에 필요한 공용 정보: 목표 분석, 쓸 수 있는 템플릿, AI에게 보여 줄 맞춤 예시.
 * decompose()가 한 번 만들어 모든 엔진에 넘긴다.
 */
import type { StepDraft } from '../db/ops';
import { listUserTemplates } from '../db/templates';
import { TEMPLATES } from '../model/templates';
import { analyzeGoal, fillPlan, templateFor, type GoalAnalysis } from './analyze';
import { GOAL_TYPES } from './rulesData';
import type { DecomposeRequest, RuleTemplate } from './types';

export interface Example {
  goal: string;
  /** AI 답 형식(JSON)으로 쓴 예시 답 */
  answer: string;
}

export interface DecomposeContext {
  analysis: GoalAnalysis;
  templates: RuleTemplate[];
  example: Example;
}

/** 기본 템플릿을 규칙 엔진 형식으로 */
export const BUILTIN: RuleTemplate[] = TEMPLATES.map((t) => ({ id: t.id, title: t.title, keywords: t.keywords, steps: t.steps }));

/** 단계 초안 → AI 답 형식 */
export function toAnswer(drafts: readonly StepDraft[]): string {
  return JSON.stringify({
    steps: drafts.map((d) =>
      d.children?.length ? { title: d.title, substeps: d.children.map((c) => c.title) } : { title: d.title },
    ),
  });
}

/** 기존 고정 예시 (유형을 못 정했을 때) */
export const DEFAULT_EXAMPLE: Example = {
  goal: '방 정리하기',
  answer: toAnswer([
    { title: '쓰레기봉투 준비하기' },
    { title: '눈에 보이는 쓰레기 버리기' },
    { title: '구역별로 정리하기', children: [{ title: '책상 위 치우기' }, { title: '옷 개서 넣기' }, { title: '바닥 물건 제자리에 두기' }] },
    { title: '안 쓰는 물건 모으기' },
    { title: '바닥 닦기' },
  ]),
};

/**
 * AI에게 보여 줄 예시: 맞는 템플릿(내 템플릿 우선) → 그 유형의 예시 목표를 뼈대로 채운 답 → 기본 예시.
 * 작은 모델은 규칙을 읽는 것보다 예시를 흉내 내는 걸 잘하므로, 목표와 가까운 예시가 효과가 크다.
 */
export function exampleFor(a: GoalAnalysis, templates: readonly RuleTemplate[]): Example {
  const t = templateFor(a, templates);
  if (t) return { goal: t.title, answer: toAnswer(t.steps) };
  if (a.type === 'general') return DEFAULT_EXAMPLE;
  const rule = GOAL_TYPES[a.type];
  return { goal: rule.example, answer: toAnswer(fillPlan(rule.plan, analyzeGoal(rule.example))) };
}

export function contextFor(req: DecomposeRequest, templates: readonly RuleTemplate[] = BUILTIN): DecomposeContext {
  const analysis = analyzeGoal(req.goal);
  return { analysis, templates: [...templates], example: exampleFor(analysis, templates) };
}

/** 내 템플릿까지 불러와서 만든다 (내 템플릿이 앞) */
export async function makeContext(req: DecomposeRequest): Promise<DecomposeContext> {
  const mine = (await listUserTemplates()).map((t) => ({ id: t.id, title: t.title, keywords: t.keywords, steps: t.steps, mine: true }));
  return contextFor(req, [...mine, ...BUILTIN]);
}
