/**
 * 한 번의 분해 요청에 필요한 공용 정보: 목표 분석, 쓸 수 있는 템플릿, AI에게 보여 줄 맞춤 예시.
 * decompose()가 한 번 만들어 모든 엔진에 넘긴다.
 */
import type { StepDraft } from '../db/ops';
import { listUserTemplates } from '../db/templates';
import { TEMPLATES } from '../model/templates';
import { analyzeGoal, templateFor, withNote, type GoalAnalysis } from './analyze';
import { AI_EXAMPLES } from './examples';
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
 * AI에게 보여 줄 예시: 맞는 내 템플릿 → 그 유형의 손으로 쓴 예시 답(`AI_EXAMPLES`).
 * 작은 모델은 규칙을 읽는 것보다 예시를 흉내 내는 걸 잘한다. 그래서 기본 규칙의 계획(기본 템플릿, 유형 뼈대)은
 * 예시로 쓰지 않는다. 베끼면 규칙과 같은 답이 되고 규칙 말투("후보 3개 찾기")까지 따라 하기 때문이다.
 * 내 템플릿은 사용자가 원하는 방식이므로 그대로 보여 준다.
 */
export function exampleFor(a: GoalAnalysis, templates: readonly RuleTemplate[]): Example {
  const t = templateFor(a, templates.filter((x) => x.mine));
  if (t) return { goal: t.title, answer: toAnswer(t.steps) };
  const hand = AI_EXAMPLES[a.type];
  return { goal: hand.goal, answer: toAnswer(hand.steps) };
}

export function contextFor(req: DecomposeRequest, templates: readonly RuleTemplate[] = BUILTIN): DecomposeContext {
  const analysis = withNote(analyzeGoal(req.goal), req.note);
  return { analysis, templates: [...templates], example: exampleFor(analysis, templates) };
}

/** 내 템플릿까지 불러와서 만든다 (내 템플릿이 앞) */
export async function makeContext(req: DecomposeRequest): Promise<DecomposeContext> {
  const mine = (await listUserTemplates()).map((t) => ({ id: t.id, title: t.title, keywords: t.keywords, steps: t.steps, mine: true }));
  return contextFor(req, [...mine, ...BUILTIN]);
}
