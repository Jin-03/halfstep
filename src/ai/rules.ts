/**
 * 기본 규칙 엔진. 기기·네트워크와 상관없이 항상 동작하는 마지막 대안.
 * - 목표: 목표 분석 → 맞는 템플릿, 없으면 유형별 뼈대에 대상·마감·횟수·목표치를 채운다
 * - 쪼개기: 다른 종류의 일이면 그 템플릿 → 단계 성격(동사)별 패턴 → 준비·시작·나머지·확인
 * - 더 제안: 진행률이 높으면 마무리 단계부터, 아니면 템플릿·뼈대에서 빠진 단계부터
 * 규칙 데이터는 rulesData.ts에 있다.
 */
import type { StepDraft } from '../db/ops';
import { fillPlan, matchTemplate as match, planFor, type Plan } from './analyze';
import { BUILTIN, contextFor, makeContext, type DecomposeContext } from './context';
import { GOAL_TYPES, MORE_EXTRAS, SPLIT_PATTERNS, WRAP_UP, WRAP_UP_RATIO } from './rulesData';
import type { DecomposeRequest, Engine, RuleTemplate } from './types';

export type { RuleTemplate } from './types';

/** 키워드가 가장 잘 맞는 템플릿 (기본값: 기본 템플릿) */
export function matchTemplate(text: string, templates: readonly RuleTemplate[] = BUILTIN): RuleTemplate | null {
  return match(text, templates);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const roundTo5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/** 일반 유형의 뼈대 (대상 없이) */
export const GENERIC_PLAN: readonly StepDraft[] = GOAL_TYPES.general.plan.map((d) => ({
  ...d,
  title: d.title.replace('{대상} ', ''),
}));

/** 쪼개기 비율: 준비 15%, 시작 40%, 나머지 35%, 확인 10% */
const GENERIC_PARTS: readonly [string, number][] = [
  ['필요한 것 챙기기', 0.15],
  ['앞부분부터 시작하기', 0.4],
  ['나머지 끝내기', 0.35],
  ['확인하고 마무리하기', 0.1],
];
const GENERIC_DEFAULT_MINUTES = [5, 15, 15, 5];
/** 시간이 없는 단계를 패턴으로 나눌 때 가정하는 시간 */
const ASSUMED_MINUTES = 30;
const CHUNK = 25;

export function splitGeneric(minutes?: number): StepDraft[] {
  return GENERIC_PARTS.map(([title, ratio], i) => ({
    title,
    minutes: minutes ? roundTo5(minutes * ratio) : GENERIC_DEFAULT_MINUTES[i],
  }));
}

/**
 * 단계 하나를 성격에 맞게 나눈다 (템플릿은 보지 않음). 결과 검사(refine)도 이걸 쓴다.
 * - 공부·읽기처럼 분량이 있는 일은 30분이 넘으면 25분 묶음으로
 * - 그 밖에는 동사별 패턴, 맞는 게 없으면 준비·시작·나머지·확인
 */
export function splitByPattern(step: string, minutes?: number): StepDraft[] {
  const p = SPLIT_PATTERNS.find((x) => x.match.test(step));
  if (!p) return splitGeneric(minutes);
  if (p.chunkOver && minutes && minutes > p.chunkOver) {
    const n = Math.min(4, Math.max(2, Math.round(minutes / CHUNK)));
    return [
      { title: `오늘 할 분량 ${n}묶음으로 나누기`, minutes: 5 },
      ...Array.from({ length: n }, (_, i) => ({ title: `${i + 1}번째 묶음 ${CHUNK}분 하기`, minutes: CHUNK })),
      { title: '헷갈린 부분 표시하기', minutes: 5 },
    ];
  }
  const total = minutes ?? ASSUMED_MINUTES;
  return p.parts.map(([title, ratio]) => ({ title, minutes: roundTo5(total * ratio) }));
}

function splitStep(req: Extract<DecomposeRequest, { kind: 'split' }>, ctx: DecomposeContext): Plan {
  // 단계 자체가 다른 종류의 일(예: 이직 준비 속 "자소서 쓰기")이면 그 템플릿을 쓴다.
  const t = match(req.step, ctx.templates);
  if (t && t !== match(req.goal, ctx.templates)) return { drafts: structuredClone(t.steps), basis: `‘${t.title}’ 템플릿` };
  const p = SPLIT_PATTERNS.find((x) => x.match.test(req.step));
  return { drafts: splitByPattern(req.step, req.minutes), basis: p ? '단계 성격에 맞춘 쪼개기' : '기본 쪼개기' };
}

const MORE_COUNT = 3;

function suggestMore(req: Extract<DecomposeRequest, { kind: 'more' }>, ctx: DecomposeContext): Plan {
  const have = new Set(req.existing.map(norm));
  const a = ctx.analysis;
  let pool: StepDraft[];
  let basis: string;
  if ((req.doneRatio ?? 0) >= WRAP_UP_RATIO) {
    pool = [...WRAP_UP, ...MORE_EXTRAS];
    basis = '마무리 단계';
  } else {
    const t = match(a.text, ctx.templates);
    if (t) {
      pool = [...t.steps, ...MORE_EXTRAS];
      basis = `‘${t.title}’ 템플릿`;
    } else if (a.type === 'general') {
      // 일반 계획의 시작 단계는 이미 진행 중인 일에 어울리지 않으므로 이어지는 단계부터
      pool = [...MORE_EXTRAS, ...fillPlan(GOAL_TYPES.general.plan, a)];
      basis = '이어지는 단계';
    } else {
      pool = [...fillPlan(GOAL_TYPES[a.type].plan, a), ...MORE_EXTRAS];
      basis = `${a.typeLabel} 유형`;
    }
  }
  const seen = new Set<string>();
  const drafts = pool
    .filter((d) => {
      const k = norm(d.title);
      if (have.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MORE_COUNT);
  return { drafts: structuredClone(drafts), basis };
}

/** 규칙으로 나눈 결과와 그 근거 */
export function rulesPlan(req: DecomposeRequest, ctx: DecomposeContext): Plan {
  switch (req.kind) {
    case 'goal':
      return planFor(ctx.analysis, ctx.templates);
    case 'split':
      return splitStep(req, ctx);
    case 'more':
      return suggestMore(req, ctx);
  }
}

/** 동기 버전 (테스트·내부용). templates를 주지 않으면 기본 템플릿만 */
export function decomposeByRules(req: DecomposeRequest, templates?: readonly RuleTemplate[]): StepDraft[] {
  const ctx = req.context ?? contextFor(req, templates);
  return rulesPlan(req, ctx).drafts;
}

export const rulesEngine: Engine = {
  id: 'rules',
  label: '기본 규칙',
  description: '정해진 패턴으로 나눠요. 어디서나 바로 동작해요.',
  available: async () => ({ status: 'ready' }),
  decompose: async (req) => rulesPlan(req, req.context ?? (await makeContext(req))).drafts,
};
